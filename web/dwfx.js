// Lector de DWFx (paquete XPS/OPC): FixedDocumentSequence → FixedDocument → FixedPage.
const DWFX = (() => {
  const { EMPTY, mul, bbXform, bbUnion, parsePathData } = Scene;

  const dirOf = (p) => p.replace(/[^/]*$/, '');
  function resolve(base, ref) {
    if (!ref) return ref;
    if (ref.startsWith('/')) return ref.slice(1);
    const parts = (dirOf(base) + ref).split('/');
    const out = [];
    for (const s of parts) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s); }
    return out.join('/');
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('XML inválido: ' + err.textContent.slice(0, 200));
    return doc;
  }

  function color(s) {
    if (!s) return null;
    s = s.trim();
    if (s[0] === '#') {
      const h = s.slice(1);
      if (h.length === 8) { // #AARRGGBB
        const a = parseInt(h.slice(0, 2), 16) / 255;
        if (a === 0) return null;
        return `rgba(${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${parseInt(h.slice(6, 8), 16)},${a.toFixed(3)})`;
      }
      return '#' + h;
    }
    if (s.startsWith('sc#')) {
      const v = s.slice(3).split(',').map(Number);
      const c = (x) => Math.round(Math.max(0, Math.min(1, x)) ** (1 / 2.2) * 255);
      if (v.length === 4) return `rgba(${c(v[1])},${c(v[2])},${c(v[3])},${v[0]})`;
      return `rgb(${c(v[0])},${c(v[1])},${c(v[2])})`;
    }
    return s;
  }

  const matrix = (s) => s ? s.split(/[\s,]+/).filter(Boolean).map(Number) : null;
  const isIdentity = (m) => !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);

  // Fuentes ofuscadas (.odttf): XOR de los primeros 32 bytes con la GUID del nombre.
  function deobfuscate(data, name) {
    const g = (name.match(/[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/) || [])[0];
    if (!g) return data;
    const hex = g.replace(/-/g, '');
    const key = [];
    for (let i = 0; i < 16; i++) key.push(parseInt(hex.substr(i * 2, 2), 16));
    const out = new Uint8Array(data);
    for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[15 - (i % 16)];
    return out;
  }

  async function open(zip) {
    const pages = [];
    // Ubicar la secuencia de documentos desde _rels/.rels
    let seqPath = 'FixedDocumentSequence.fdseq';
    const rels = await zip.text('_rels/.rels');
    if (rels) {
      const m = rels.match(/Target="([^"]+)"[^>]*Type="[^"]*fixedrepresentation"/i) ||
                rels.match(/Type="[^"]*fixedrepresentation"[^>]*Target="([^"]+)"/i);
      if (m) seqPath = resolve('', m[1]);
    }
    const seqText = await zip.text(seqPath);
    if (!seqText) throw new Error('El DWFx no tiene FixedDocumentSequence.');
    const seq = parseXml(seqText);
    const titles = await sectionTitles(zip);
    for (const dr of seq.getElementsByTagName('DocumentReference')) {
      const docPath = resolve(seqPath, dr.getAttribute('Source'));
      const fdoc = parseXml(await zip.text(docPath));
      for (const pc of fdoc.getElementsByTagName('PageContent')) {
        const pagePath = resolve(docPath, pc.getAttribute('Source'));
        const sec = (pagePath.match(/sections\/([^/]+)\//) || [])[1];
        pages.push({
          title: titles[sec] || `Hoja ${pages.length + 1}`,
          width: parseFloat(pc.getAttribute('Width')) || 0,
          height: parseFloat(pc.getAttribute('Height')) || 0,
          units: 'px96', // 1/96 de pulgada
          background: '#ffffff',
          build: () => buildPage(zip, pagePath),
        });
      }
    }
    return { kind: 'DWFx', pages };
  }

  async function sectionTitles(zip) {
    const t = {};
    for (const n of zip.names()) {
      if (!/manifest\.xml$/i.test(n)) continue;
      const txt = await zip.text(n);
      const re = /<dwf:Section\b[^>]*>/g; let m;
      while ((m = re.exec(txt))) {
        const name = (m[0].match(/\bname="([^"]*)"/) || [])[1];
        const title = (m[0].match(/\btitle="([^"]*)"/) || [])[1];
        if (name && title) t[name] = decodeEntities(title);
      }
    }
    return t;
  }
  const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

  async function buildPage(zip, pagePath) {
    const doc = parseXml(await zip.text(pagePath));
    const fp = doc.documentElement;
    const fonts = new Map();   // uri → family
    const images = new Map();  // uri → ImageBitmap
    const pending = [];
    const stats = { paths: 0, glyphs: 0, warnings: new Set() };

    async function loadFont(uri) {
      const full = resolve(pagePath, uri);
      if (fonts.has(full)) return fonts.get(full);
      const family = 'xps_' + (fonts.size + 1);
      fonts.set(full, family);
      pending.push((async () => {
        try {
          let data = await zip.read(full);
          if (!data) return;
          if (/\.odttf$/i.test(full)) data = deobfuscate(data, full.split('/').pop());
          const ff = new FontFace(family, data);
          await ff.load();
          document.fonts.add(ff);
        } catch (e) { stats.warnings.add('Fuente no cargada: ' + uri); }
      })());
      return family;
    }

    function loadImage(uri, base) {
      const full = resolve(base, uri);
      if (!images.has(full)) {
        const ref = { img: null };
        images.set(full, ref);
        pending.push((async () => {
          try {
            const data = await zip.read(full);
            if (!data) return;
            const mime = /\.png$/i.test(full) ? 'image/png' : /\.tiff?$/i.test(full) ? 'image/tiff' : 'image/jpeg';
            ref.img = await createImageBitmap(new Blob([data], { type: mime }));
          } catch (e) { stats.warnings.add('Imagen no cargada: ' + uri); }
        })());
      }
      return images.get(full);
    }

    // Diccionarios de recursos (pila por nivel)
    async function readResources(el, base, dict) {
      for (const rc of el.children) {
        if (!rc.localName.endsWith('.Resources')) continue;
        for (const rd of rc.children) {
          if (rd.localName !== 'ResourceDictionary') continue;
          let node = rd, b = base;
          const src = rd.getAttribute('Source');
          if (src) {
            b = resolve(base, src);
            const txt = await zip.text(b);
            if (!txt) continue;
            node = parseXml(txt).documentElement;
          }
          for (const r of node.children) {
            const key = r.getAttribute('x:Key') || r.getAttributeNS('http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key', 'Key');
            if (key) dict[key] = { el: r, base: b };
          }
        }
      }
    }

    function lookup(val, dicts) {
      const m = /^\{StaticResource\s+([^}]+)\}$/.exec(val || '');
      if (!m) return null;
      for (let i = dicts.length - 1; i >= 0; i--) if (dicts[i][m[1]]) return dicts[i][m[1]];
      return null;
    }

    function brush(el, base) {
      if (!el) return null;
      switch (el.localName) {
        case 'SolidColorBrush': {
          const c = color(el.getAttribute('Color'));
          const op = parseFloat(el.getAttribute('Opacity') ?? '1');
          if (!c) return null;
          return op < 1 ? withAlpha(c, op) : c;
        }
        case 'ImageBrush': {
          const ref = loadImage(el.getAttribute('ImageSource'), base);
          const vp = (el.getAttribute('Viewport') || '0,0,1,1').split(/[\s,]+/).map(Number);
          const vb = (el.getAttribute('Viewbox') || '0,0,1,1').split(/[\s,]+/).map(Number);
          let m = [vp[2] / (vb[2] || 1), 0, 0, vp[3] / (vb[3] || 1), vp[0] - vb[0] * vp[2] / (vb[2] || 1), vp[1] - vb[1] * vp[3] / (vb[3] || 1)];
          const t = matrix(el.getAttribute('Transform'));
          if (t) m = mul(t, m);
          const b = { pattern: null, m };
          Object.defineProperty(b, 'pattern', { get: () => ref.img });
          return b;
        }
        case 'LinearGradientBrush': case 'RadialGradientBrush': {
          const stop = el.getElementsByTagName('GradientStop')[0];
          return stop ? color(stop.getAttribute('Color')) : null;
        }
      }
      stats.warnings.add('Pincel no soportado: ' + el.localName);
      return null;
    }

    function withAlpha(c, a) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
      if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
      return c;
    }

    function paintAttr(el, attr, base, dicts) {
      const v = el.getAttribute(attr);
      if (v) {
        const r = lookup(v, dicts);
        if (r) return brush(r.el, r.base);
        return color(v);
      }
      const child = childProp(el, attr);
      if (child && child.firstElementChild) return brush(child.firstElementChild, base);
      return null;
    }

    const childProp = (el, prop) => {
      for (const c of el.children) if (c.localName === el.localName + '.' + prop) return c;
      return null;
    };

    function geometry(el, attr, dicts) {
      let v = el.getAttribute(attr);
      if (v) {
        const r = lookup(v, dicts);
        if (r) return geomFromElement(r.el);
        return { ...parsePathData(v), m: null };
      }
      const child = childProp(el, attr);
      if (child && child.firstElementChild) return geomFromElement(child.firstElementChild);
      return null;
    }

    function geomFromElement(g) {
      if (!g || g.localName !== 'PathGeometry') return null;
      let d = '';
      const rule = g.getAttribute('FillRule');
      if (g.getAttribute('Figures')) d += g.getAttribute('Figures') + ' ';
      for (const f of g.getElementsByTagName('PathFigure')) {
        d += 'M' + f.getAttribute('StartPoint') + ' ';
        for (const s of f.children) {
          const pts = s.getAttribute('Points') || s.getAttribute('Point') || '';
          switch (s.localName) {
            case 'PolyLineSegment': d += 'L' + pts + ' '; break;
            case 'PolyBezierSegment': d += 'C' + pts + ' '; break;
            case 'PolyQuadraticBezierSegment': d += 'Q' + pts + ' '; break;
            case 'ArcSegment': {
              const sz = s.getAttribute('Size');
              d += `A${sz} ${s.getAttribute('RotationAngle') || 0} ${s.getAttribute('IsLargeArc') === 'true' ? 1 : 0} ${s.getAttribute('SweepDirection') === 'Clockwise' ? 1 : 0} ${pts} `;
              break;
            }
          }
        }
        if (f.getAttribute('IsClosed') === 'true') d += 'Z ';
      }
      const r = parsePathData(d);
      if (rule) r.evenodd = rule === 'EvenOdd';
      const t = matrix(g.getAttribute('Transform'));
      return { ...r, m: t };
    }

    function renderTransform(el) {
      let m = matrix(el.getAttribute('RenderTransform'));
      if (!m) {
        const c = childProp(el, 'RenderTransform');
        const mt = c && c.firstElementChild;
        if (mt) m = matrix(mt.getAttribute('Matrix'));
      }
      return isIdentity(m) ? null : m;
    }

    async function walk(el, base, absM, dicts) {
      const out = [];
      for (const c of el.children) {
        switch (c.localName) {
          case 'Canvas': {
            const m = renderTransform(c);
            const local = [...dicts, {}];
            await readResources(c, base, local[local.length - 1]);
            const abs = mul(absM, m);
            const g = { k: 'g', m, clip: null, op: parseFloat(c.getAttribute('Opacity') ?? '1'), ch: [], bb: EMPTY() };
            const clip = geometry(c, 'Clip', local);
            if (clip) g.clip = { p: clip.path, rule: clip.evenodd ? 'evenodd' : 'nonzero' };
            g.ch = await walk(c, base, abs, local);
            for (const ch of g.ch) bbUnion(g.bb, ch.bb);
            if (clip) { // recortar bb al clip
              const cb = bbXform(clip.bb, abs);
              g.bb = [Math.max(g.bb[0], cb[0]), Math.max(g.bb[1], cb[1]), Math.min(g.bb[2], cb[2]), Math.min(g.bb[3], cb[3])];
            }
            if (g.ch.length) out.push(g);
            break;
          }
          case 'Path': {
            stats.paths++;
            const geo = geometry(c, 'Data', dicts);
            if (!geo || !isFinite(geo.bb[0])) break;
            const fill = paintAttr(c, 'Fill', base, dicts);
            const stroke = paintAttr(c, 'Stroke', base, dicts);
            if (!fill && !stroke) break;
            const lw = parseFloat(c.getAttribute('StrokeThickness') ?? '1');
            const dashA = c.getAttribute('StrokeDashArray');
            const p = {
              k: 'p', p: geo.path, rule: geo.evenodd ? 'evenodd' : 'nonzero', fill, stroke, lw,
              cap: capOf(c.getAttribute('StrokeStartLineCap')), join: joinOf(c.getAttribute('StrokeLineJoin')),
              miter: parseFloat(c.getAttribute('StrokeMiterLimit') || '10'),
              dash: dashA && dashA.trim() ? dashA.trim().split(/[\s,]+/).map(v => +v * lw) : null,
            };
            const opacity = parseFloat(c.getAttribute('Opacity') ?? '1');
            const m = mul(renderTransform(c), geo.m);
            const pad = stroke ? lw / 2 : 0;
            const lbb = [geo.bb[0] - pad, geo.bb[1] - pad, geo.bb[2] + pad, geo.bb[3] + pad];
            if (m || opacity < 1) {
              const abs = mul(absM, m);
              p.bb = bbXform(lbb, abs);
              out.push({ k: 'g', m, op: opacity, ch: [p], bb: p.bb });
            } else {
              p.bb = bbXform(lbb, absM);
              out.push(p);
            }
            break;
          }
          case 'Glyphs': {
            stats.glyphs++;
            let str = c.getAttribute('UnicodeString') || '';
            if (str.startsWith('{}')) str = str.slice(2);
            if (!str.trim()) break;
            const size = parseFloat(c.getAttribute('FontRenderingEmSize') || '12');
            const family = await loadFont(c.getAttribute('FontUri'));
            const sim = c.getAttribute('StyleSimulations') || '';
            const x = parseFloat(c.getAttribute('OriginX') || '0');
            const y = parseFloat(c.getAttribute('OriginY') || '0');
            const t = {
              k: 't', str, x, y, size, family: `"${family}", Arial, sans-serif`,
              weight: /Bold/.test(sim) ? 'bold' : 'normal', style: /Italic/.test(sim) ? 'italic' : 'normal',
              fill: paintAttr(c, 'Fill', base, dicts) || '#000',
              adv: advances(c.getAttribute('Indices'), str, size),
              m: renderTransform(c),
            };
            const w = t.adv ? t.adv.reduce((a, b) => a + b, 0) : size * 0.6 * str.length;
            t.bb = bbXform([x, y - size, x + w, y + size * 0.3], mul(absM, t.m));
            out.push(t);
            break;
          }
        }
      }
      return out;
    }

    const capOf = (v) => v === 'Flat' ? 'butt' : v === 'Square' ? 'square' : 'round';
    const joinOf = (v) => v === 'Miter' ? 'miter' : v === 'Bevel' ? 'bevel' : 'round';

    function advances(indices, str, size) {
      if (!indices || /[()]/.test(indices)) return null;
      const parts = indices.split(';');
      if (parts.length < [...str].length) return null;
      const adv = [];
      for (const p of parts) {
        const a = p.split(',')[1];
        if (a === undefined || a === '') return null;
        adv.push(parseFloat(a) * size / 100);
      }
      return adv;
    }

    const dicts = [{}];
    await readResources(fp, pagePath, dicts[0]);
    const root = { k: 'g', m: null, ch: await walk(fp, pagePath, null, dicts), bb: EMPTY() };
    for (const ch of root.ch) bbUnion(root.bb, ch.bb);
    await Promise.all(pending);
    root.stats = { paths: stats.paths, glyphs: stats.glyphs, warnings: [...stats.warnings] };
    return root;
  }

  return { open, deobfuscate };
})();
if (typeof module !== 'undefined') module.exports = DWFX; else self.DWFX = DWFX;
