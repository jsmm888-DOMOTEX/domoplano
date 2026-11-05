// Lector de DWF 6 (zip con secciones ePlot, cada una con un stream W2D) y DWF antiguos (stream W2D directo).
const DWF = (() => {
  const { EMPTY, bbXform, bbUnion } = Scene;

  const attr = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
  const decodeEntities = (s) => s && s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

  async function open(u8) {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 12));
    let zip = null;
    try { zip = Zip.open(u8); } catch (e) { zip = null; }
    if (!zip) {
      if (!/^\(DWF V/.test(head)) throw new Error('Formato DWF no reconocido.');
      // DWF antiguo: todo el archivo es el stream W2D
      return { kind: 'DWF ' + head.slice(6, 11), pages: [{ title: 'Hoja 1', w2d: () => u8, desc: null, build: null }].map(finishPage) };
    }
    const manifest = await zip.text('manifest.xml');
    if (!manifest) throw new Error('El DWF no tiene manifest.xml.');
    const pages = [];
    const secRe = /<dwf:Section\b([^>]*)>([\s\S]*?)<\/dwf:Section>/g;
    let m;
    while ((m = secRe.exec(manifest))) {
      const tag = m[1];
      const type = attr(tag, 'type');
      if (type !== 'com.autodesk.dwf.ePlot') {
        if (type === 'com.autodesk.dwf.eModel') pages.push(finishPage({ title: decodeEntities(attr(tag, 'title')) || 'Modelo 3D', unsupported: 'Las secciones 3D (eModel) no se pueden ver todavía.' }));
        continue;
      }
      const title = decodeEntities(attr(tag, 'title')) || `Hoja ${pages.length + 1}`;
      const res = [...m[2].matchAll(/<dwf:Resource\b[^>]*>/g)].map(r => r[0]);
      const byRole = (role) => res.map(r => (attr(r, 'role') === role ? attr(r, 'href') : null)).find(Boolean);
      // El plano es el recurso "2d streaming graphics"; los DWF revisados en Design Review traen además
      // "2d vector markup" (el dibujo de las marcas) y "markup private" (XML con el texto de cada marca).
      const w2dHref = byRole('2d streaming graphics') || res.map(r => (attr(r, 'mime') === 'application/x-w2d' ? attr(r, 'href') : null)).find(Boolean);
      const descHref = byRole('descriptor');
      const desc = descHref ? await zip.text(descHref) : null;
      const info = parseDescriptor(desc, w2dHref);
      if (!w2dHref) continue;
      const markupW2d = byRole('2d vector markup');
      const markupXml = byRole('markup private');
      pages.push(finishPage({ title, order: info.order, info, w2d: () => zip.read(w2dHref),
        markup: (markupW2d || markupXml) ? {
          w2d: markupW2d ? () => zip.read(markupW2d) : null,
          transform: markupW2d ? resourceTransform(desc, markupW2d) : null,
          xml: markupXml ? () => zip.text(markupXml) : null,
        } : null }));
    }
    pages.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
    return { kind: 'DWF', pages };
  }

  /** Matriz 4x4 (16 números) del recurso con ese href en el descriptor de la hoja. */
  function resourceTransform(xml, href) {
    if (!xml || !href) return null;
    for (const t of xml.match(/<ePlot:GraphicResource\b[^>]*>/g) || []) {
      if (decodeEntities(attr(t, 'href')) === href && attr(t, 'transform')) return attr(t, 'transform').split(/\s+/).map(Number);
    }
    return null;
  }

  function parseDescriptor(xml, w2dHref) {
    const out = { order: null, paper: null, transform: null, background: '#ffffff' };
    if (!xml) return out;
    const page = (/<ePlot:Page\b[^>]*>/.exec(xml) || [])[0];
    if (page) out.order = parseFloat(attr(page, 'plotOrder'));
    const paper = (/<ePlot:Paper\b[^>]*>/.exec(xml) || [])[0];
    if (paper) {
      out.paper = { w: parseFloat(attr(paper, 'width')), h: parseFloat(attr(paper, 'height')), units: attr(paper, 'units') || 'mm' };
      const c = attr(paper, 'color');
      if (c) { const [r, g, b] = c.split(/\s+/).map(Number); out.background = `rgb(${r},${g},${b})`; }
    }
    out.transform = resourceTransform(xml, w2dHref);
    if (!out.transform) {
      const gr = (/<ePlot:GraphicResource\b[^>]*>/.exec(xml) || [])[0];
      if (gr && attr(gr, 'transform')) out.transform = attr(gr, 'transform').split(/\s+/).map(Number);
    }
    return out;
  }

  function finishPage(p) {
    const info = p.info || {};
    const paper = info.paper;
    return {
      title: p.title, order: p.order, unsupported: p.unsupported,
      width: paper ? paper.w : 0, height: paper ? paper.h : 0,
      units: paper ? paper.units : null,
      background: info.background || '#ffffff',
      build: p.unsupported ? null : async function () {
        const data = await p.w2d();
        const r = await W2D.parse(data);
        const root = await toScene(r, info, this);
        if (!p.markup) return root;
        // Marcas de revisión (Design Review): el dibujo de las marcas va en un grupo aparte, encima del plano.
        const out = { k: 'g', m: null, ch: [root], bb: root.bb.slice(), layers: root.layers, stats: root.stats };
        try {
          if (p.markup.w2d && p.markup.transform) {
            const mr = await W2D.parse(await p.markup.w2d());
            const mroot = await toScene(mr, { ...info, transform: p.markup.transform }, this);
            mroot.markup = true;
            // las capas del dibujo de marcas tienen su propia numeración: no mezclarlas con las del plano
            (function strip(n) { delete n.layer; if (n.ch) n.ch.forEach(strip); })(mroot);
            mroot.layers = {};
            out.ch.push(mroot); bbUnion(out.bb, mroot.bb);
          }
          if (p.markup.xml) out.markups = parseMarkupXml(await p.markup.xml(), this.height);
        } catch (e) { (out.stats.warnings = out.stats.warnings || []).push('Marcas de revisión: ' + e.message); }
        return out;
      },
    };
  }

  // Convierte el resultado de W2D.parse en nodos de escena (página en mm, y hacia abajo).
  async function toScene(r, info, page) {
    let s = 1, tx = 0, ty = 0;
    const T = info.transform;
    if (T && T.length === 16) {
      s = T[0]; tx = T[12] || T[3] || 0; ty = T[13] || T[7] || 0;
    }
    if (!info.paper || !page.width) {
      // Sin papel: encuadrar a los límites del dibujo
      const b = r.bounds;
      s = 1; tx = -b.minX; ty = -b.minY;
      page.width = (b.maxX - b.minX) || 1; page.height = (b.maxY - b.minY) || 1;
    }
    const H = page.height;
    const m = [s, 0, 0, -s, tx, H - ty];
    const toPage = (bb) => bbXform(bb, m);

    const ch = [];
    const imgJobs = [];
    // Regiones de recorte (ventanas gráficas): agrupar elementos consecutivos con el mismo clip
    const clipPaths = (r.clips || []).map(cs => {
      const p = new Path2D(); const bb = EMPTY();
      for (const c of cs || []) { if (c.length >= 4) { p.addPath(polyPath(c, true)); bbUnion(bb, ptsBB(c)); } }
      return { p, bb };
    });
    let cur = null;
    for (const it of r.items) {
      const n = convert(it, imgJobs);
      if (!n) continue;
      if (it.layer != null) n.layer = it.layer;
      n.bb = toPage(n.bb);
      const ci = it.clip != null && clipPaths[it.clip] ? it.clip : null;
      if (ci == null) { cur = null; ch.push(n); continue; }
      if (!cur || cur.ci !== ci) {
        const cb = toPage(clipPaths[ci].bb);
        cur = { k: 'g', m: null, clip: { p: clipPaths[ci].p, rule: 'evenodd', logical: true }, ci, ch: [], bb: EMPTY(), cbb: cb };
        ch.push(cur);
      }
      cur.ch.push(n); bbUnion(cur.bb, n.bb);
    }
    for (const g of ch) if (g.cbb) {
      g.bb = [Math.max(g.bb[0], g.cbb[0]), Math.max(g.bb[1], g.cbb[1]), Math.min(g.bb[2], g.cbb[2]), Math.min(g.bb[3], g.cbb[3])];
    }
    await Promise.all(imgJobs);
    const root = { k: 'g', m, ch, bb: EMPTY() };
    for (const c of ch) bbUnion(root.bb, c.bb);
    root.layers = r.layers || {};
    root.stats = { items: r.items.length, warnings: r.warnings || [] };
    return root;
  }


  // ---------- Marcas de revisión (XML "markup private" de Autodesk Design Review) ----------
  // Coordenadas en PULGADAS de papel con origen abajo-izquierda → mm de página con y hacia abajo.
  function parseMarkupXml(xml, pageH) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const root = doc.documentElement;
    if (!root || root.nodeName === 'parsererror') return [];
    const IN = 25.4;
    const X = (v) => parseFloat(v) * IN, Y = (v) => pageH - parseFloat(v) * IN;
    const boxC = (el) => { // CenterX/CenterY/Width/Height → [x0,y0,x1,y1]
      const cx = parseFloat(el.getAttribute('CenterX')), cy = parseFloat(el.getAttribute('CenterY'));
      const w = parseFloat(el.getAttribute('Width')), h = parseFloat(el.getAttribute('Height'));
      return [X(cx - w / 2), Y(cy + h / 2), X(cx + w / 2), Y(cy - h / 2)];
    };
    const boxXY = (el) => { // X/Y = esquina inferior izquierda
      const x = parseFloat(el.getAttribute('X')), y = parseFloat(el.getAttribute('Y'));
      const w = parseFloat(el.getAttribute('Width')), h = parseFloat(el.getAttribute('Height'));
      return [X(x), Y(y + h), X(x + w), Y(y)];
    };
    const ptsBox = (str) => {
      const v = (str || '').trim().split(/\s+/).map(Number); const bb = EMPTY();
      for (let i = 0; i + 1 < v.length; i += 2) bbUnion(bb, [X(v[i]), Y(v[i + 1]), X(v[i]), Y(v[i + 1])]);
      return bb;
    };
    const textOf = (el) => [...el.getElementsByTagName('TextPhrase')]
      .map((p) => (p.getAttribute('String') || '').replace(/\r\n?/g, '\n')).join('').trim();
    const out = [];
    for (const el of root.children) {
      const t = el.nodeName;
      if (t === 'Shape2D') {
        const bb = EMPTY(); let target = null, tag = null;
        for (const c of el.getElementsByTagName('*')) {
          if (c.nodeName === 'Tag') { tag = boxC(c); bbUnion(bb, tag); }
          else if (c.nodeName === 'Target') { target = boxC(c); bbUnion(bb, target); }
          else if (c.nodeName === 'Text') bbUnion(bb, boxXY(c));
          else if (c.nodeName === 'Leader' || c.nodeName === 'AdditionalLeader') bbUnion(bb, ptsBox(c.getAttribute('Points')));
        }
        out.push({ tipo: 'llamada', texto: textOf(el), bb, focus: target || tag || bb });
      } else if (t === 'Text2D') {
        const b = el.hasAttribute('X') ? boxXY(el) : EMPTY();
        out.push({ tipo: 'texto', texto: textOf(el), bb: b, focus: b });
      } else if (t === 'Rectangle2D') {
        const b = boxC(el);
        out.push({ tipo: /cloud/i.test(el.getAttribute('Type') || '') ? 'nube' : 'rectángulo', texto: '', bb: b, focus: b });
      } else if (t === 'CustomStamp') {
        const x = parseFloat(el.getAttribute('TranslationX')), y = parseFloat(el.getAttribute('TranslationY'));
        out.push({ tipo: 'sello', texto: el.getAttribute('Name') || 'Sello', bb: [X(x) - 5, Y(y) - 5, X(x) + 5, Y(y) + 5], focus: [X(x) - 15, Y(y) - 15, X(x) + 15, Y(y) + 15] });
      } else if (t === 'Polyline2D') {
        const b = ptsBox(el.getAttribute('Points'));
        out.push({ tipo: /highlight/i.test(el.getAttribute('Type') || '') ? 'resaltado' : 'línea', texto: '', bb: b, focus: b });
      }
    }
    // Numerar solo las observaciones con texto (llamadas y notas), en el orden en que EPM las creó.
    let n = 0;
    for (const m of out) if (m.texto && m.tipo !== 'sello') m.num = ++n;
    return out.filter((m) => isFinite(m.bb[0]));
  }

  function ptsBB(pts) {
    const bb = EMPTY();
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (x < bb[0]) bb[0] = x; if (x > bb[2]) bb[2] = x;
      if (y < bb[1]) bb[1] = y; if (y > bb[3]) bb[3] = y;
    }
    return bb;
  }

  function polyPath(pts, close) {
    const p = new Path2D();
    p.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
    if (close) p.closePath();
    return p;
  }

  function convert(it, jobs) {
    switch (it.t) {
      case 'line': {
        if (!it.pts || it.pts.length < 4) return null;
        const bb = ptsBB(it.pts); const pad = (it.lw || 0) / 2;
        return { k: 'p', p: polyPath(it.pts, false), stroke: it.color, lw: it.lw || 0, cap: it.cap, join: it.join, bb: [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad] };
      }
      case 'poly': {
        if (!it.pts || it.pts.length < 6) return null;
        return { k: 'p', p: polyPath(it.pts, true), fill: it.color, bb: ptsBB(it.pts) };
      }
      case 'tris': {
        const q = it.pts; if (!q || q.length < 6) return null;
        const p = new Path2D();
        for (let i = 0; i + 5 < q.length; i += 2) {
          p.moveTo(q[i], q[i + 1]); p.lineTo(q[i + 2], q[i + 3]); p.lineTo(q[i + 4], q[i + 5]); p.closePath();
        }
        return { k: 'p', p, fill: it.color, stroke: it.color, lw: 0, bb: ptsBB(q) };
      }
      case 'contours': {
        const p = new Path2D(); const bb = EMPTY();
        for (const c of it.contours || []) { if (c.length >= 4) { p.addPath(polyPath(c, true)); bbUnion(bb, ptsBB(c)); } }
        if (!isFinite(bb[0])) return null;
        return { k: 'p', p, fill: it.color, rule: 'evenodd', bb };
      }
      case 'ellipse': {
        const p = new Path2D();
        const full = Math.abs((it.end ?? 2 * Math.PI) - (it.start ?? 0)) >= 2 * Math.PI - 1e-9;
        p.ellipse(it.cx, it.cy, Math.abs(it.rx), Math.abs(it.ry), it.rot || 0, it.start || 0, it.end ?? 2 * Math.PI, false);
        if (it.fill && !full) { p.lineTo(it.cx, it.cy); p.closePath(); }
        const r = Math.max(Math.abs(it.rx), Math.abs(it.ry)) + (it.lw || 0) / 2;
        const n = { k: 'p', p, bb: [it.cx - r, it.cy - r, it.cx + r, it.cy + r] };
        if (it.fill) n.fill = it.color; else { n.stroke = it.color; n.lw = it.lw || 0; }
        return n;
      }
      case 'text': {
        if (!it.str) return null;
        const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
        const h = it.h || 1;
        const obl = it.oblique ? Math.tan(it.oblique) : 0;
        // local: x a lo largo de la línea base, y hacia abajo (canvas) = -arriba
        const m = [c, s, s + obl * c, -c + obl * s, it.x, it.y];
        const w = h * 0.7 * it.str.length * (it.widthScale || 1);
        const x0 = it.halign === 'center' ? -w / 2 : it.halign === 'right' ? -w : 0;
        return {
          k: 'g', m, ch: [{
            k: 't', str: it.str, x: 0, y: 0, size: h * fontEm(it.font), sx: it.widthScale || 1,
            align: it.halign === 'center' ? 'center' : it.halign === 'right' ? 'right' : 'left',
            family: fontFamily(it.font), weight: it.bold ? 'bold' : 'normal', style: it.italic ? 'italic' : 'normal',
            fill: it.color,
          }],
          bb: bbXform([x0, -h * 1.2, x0 + w, h * 0.4], m),
        };
      }
      case 'image': {
        const x0 = Math.min(it.x0, it.x1), x1 = Math.max(it.x0, it.x1);
        const y0 = Math.min(it.y0, it.y1), y1 = Math.max(it.y0, it.y1);
        const node = { k: 'i', img: null, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        jobs.push((async () => {
          try {
            if (it.data) node.img = await createImageBitmap(new Blob([it.data], { type: it.mime || 'image/png' }));
            else if (it.rgba) node.img = await createImageBitmap(new ImageData(it.rgba, it.w, it.h));
          } catch (e) { /* imagen no soportada */ }
        })());
        return { k: 'g', m: [1, 0, 0, -1, 0, y0 + y1], ch: [node], bb: [x0, y0, x1, y1] };
      }
    }
    return null;
  }

  // h es la altura de celda (ascendente+descendente); el tamaño CSS es ~0.89·h en Arial.
  const fontEm = (name) => /tahoma|verdana/i.test(name || '') ? 0.83 : 0.89;

  function fontFamily(name) {
    const n = (name || '').replace(/["']/g, '').trim();
    const fb = /narrow|isocp|romans|simplex|txt|iso/i.test(n) ? '"Arial Narrow", Arial, sans-serif' : 'Arial, Helvetica, sans-serif';
    return n ? `"${n}", ${fb}` : fb;
  }

  return { open };
})();
if (typeof module !== 'undefined') module.exports = DWF; else self.DWF = DWF;
