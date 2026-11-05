// Domoplano — lector de DXF (ASCII) y conversión a la escena de dibujo.
// Código propio, escrito a partir de la referencia pública del formato DXF. Sin código de Autodesk.
//
// Modelo (igual que el propio DXF): el espacio modelo y cada plancha son BLOQUES; las entidades viven dentro de un
// bloque; las planchas muestran el modelo a través de ventanas (VIEWPORT) con escala.
// Escena: grupos "locales" (bb en coordenadas del grupo) para poder reutilizar un bloque en muchas inserciones y el
// modelo completo en varias ventanas. Coordenadas DXF con y hacia arriba; la página final se voltea.
const DXF = (() => {
  const { EMPTY, bbXform, bbUnion, mul } = Scene;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- lectura de pares código/valor
  let lastEncoding = 'utf-8';
  /** Codificación del archivo. DXF anteriores a 2007 (< AC1021) van en la página de códigos de $DWGCODEPAGE (ANSI_1252):
   *  si el archivo no trae letras fuera de ASCII, se marca como Windows-1252 para que al guardar una Ñ o una tilde se
   *  escriban como los lee AutoCAD (y lo que no quepa, como \U+XXXX). Los de 2007 o posteriores van en UTF-8. */
  function decode(u8) {
    let txt;
    try { lastEncoding = 'utf-8'; txt = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { lastEncoding = 'windows-1252'; return new TextDecoder('windows-1252').decode(u8); }
    const head = txt.slice(0, 20000);
    const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head);
    const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head);
    let ascii = true; for (let i = 0; i < u8.length; i++) if (u8[i] > 127) { ascii = false; break; }
    if (ascii && ver && ver[1] < 'AC1021' && !(cp && /UTF/i.test(cp[1]))) lastEncoding = 'windows-1252';
    return txt;
  }

  function tokenize(text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const codes = new Int16Array(Math.floor(lines.length / 2) + 2);
    const vals = new Array(codes.length);
    const li = new Int32Array(codes.length); // línea del código de cada par
    let n = 0;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c = parseInt(lines[i], 10);
      if (Number.isNaN(c)) { i -= 1; continue; } // línea suelta: resincronizar
      codes[n] = c; vals[n] = lines[i + 1]; li[n] = i; n++;
    }
    li[n] = lines.length; // centinela
    return { codes, vals, n, li, lines, eol };
  }

  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const int = (v) => parseInt(v, 10) || 0;

  /** Una entidad/objeto = lista de pares [código, valor] desde su "0 TIPO" hasta el siguiente "0". */
  function Rec(type, pairs) { this.type = type; this.p = pairs; }
  Rec.prototype.get = function (code, def) { for (const [c, v] of this.p) if (c === code) return v; return def; };
  Rec.prototype.num = function (code, def = 0) { const v = this.get(code); return v === undefined ? def : num(v); };
  Rec.prototype.int = function (code, def = 0) { const v = this.get(code); return v === undefined ? def : int(v); };
  Rec.prototype.all = function (code) { const o = []; for (const [c, v] of this.p) if (c === code) o.push(v); return o; };

  function readRecords(tk, i0, i1) {
    const recs = []; let cur = null;
    for (let i = i0; i < i1; i++) {
      const c = tk.codes[i], v = tk.vals[i];
      if (c === 0) { if (cur) cur.L1 = tk.li[i]; cur = new Rec(v.trim(), []); cur.L0 = tk.li[i]; recs.push(cur); }
      else if (cur) cur.p.push([c, v]);
    }
    if (cur) cur.L1 = tk.li[i1];
    return recs;
  }

  /** Capas, tipos de línea, estilos y registros de bloque a partir de los registros de TABLES (se repite tras editar). */
  function deriveTables(D) {
    const T = (n) => (D.tables[n] ? D.tables[n].recs.filter((r) => !r.deleted) : []);
    D.layers = new Map(); D.ltypes = new Map(); D.styles = new Map(); D.blockRecords = new Map(); D.dimstyles = new Map();
    for (const r of T('LAYER')) {
      if (r._idx === undefined) r._idx = D.layerSeq++;
      const color = r.int(62, 7), name = (r.get(2, '0') || '0').trim();
      D.layers.set(name, { name, color: Math.abs(color) || 7, off: color < 0, frozen: (r.int(70) & 1) === 1, locked: (r.int(70) & 4) === 4,
        tc: r.get(420), ltype: (r.get(6, 'Continuous') || '').trim(), lw: r.int(370, -3), plot: r.int(290, 1) !== 0, idx: r._idx, rec: r });
    }
    for (const r of T('LTYPE')) D.ltypes.set(r.get(2, '').trim().toUpperCase(), { name: r.get(2, '').trim(), desc: (r.get(3, '') || '').trim(), pattern: r.all(49).map(num), rec: r });
    for (const r of T('STYLE')) {
      D.styles.set(r.get(2, '').trim().toUpperCase(), { name: r.get(2, '').trim(), font: (r.get(3, '') || '').trim(),
        width: r.num(41, 1) || 1, oblique: r.num(50, 0), height: r.num(40, 0), flags: r.int(70), rec: r });
    }
    for (const r of T('BLOCK_RECORD')) D.blockRecords.set(r.get(5, '').trim(), { handle: r.get(5, '').trim(), name: r.get(2, '').trim(), layout: (r.get(340, '') || '').trim(), rec: r });
    for (const r of T('DIMSTYLE')) D.dimstyles.set(r.get(2, '').trim().toUpperCase(), r);
    if (!D.layers.has('0')) D.layers.set('0', { name: '0', color: 7, off: false, frozen: false, ltype: 'Continuous', lw: -3, plot: true, idx: D.layerIdx0 ?? (D.layerIdx0 = D.layerSeq++) });
    D.ltscale = num(D.header.$LTSCALE && D.header.$LTSCALE[40] !== undefined ? D.header.$LTSCALE[40] : 1) || 1;
  }

  /** Presentaciones (LAYOUT) a partir de los registros de OBJECTS (se repite tras crear, borrar o cambiar planchas). */
  function deriveLayouts(D) {
    D.layouts = [];
    for (const r of D.objects || []) {
      if (r.type !== 'LAYOUT' || r.deleted) continue;
      let sub = ''; const o = { name: '', tab: 0, paperW: 0, paperH: 0, rot: 0, lim: null, brec: '', punits: 1, rec: r, media: '' };
      const lim = [0, 0, 0, 0];
      for (const [c, v] of r.p) {
        if (c === 100) { sub = v.trim(); continue; }
        if (sub === 'AcDbPlotSettings') {
          if (c === 44) o.paperW = num(v); else if (c === 45) o.paperH = num(v); else if (c === 73) o.rot = int(v); else if (c === 72) o.punits = int(v);
          else if (c === 4) o.media = String(v).trim();
        } else if (sub === 'AcDbLayout') {
          if (c === 1) o.name = v.trim(); else if (c === 71) o.tab = int(v);
          else if (c === 10) lim[0] = num(v); else if (c === 20) lim[1] = num(v);
          else if (c === 11) lim[2] = num(v); else if (c === 21) lim[3] = num(v);
          else if (c === 330) o.brec = v.trim();
        }
      }
      if (lim[2] > lim[0] && lim[3] > lim[1]) o.lim = lim;
      D.layouts.push(o);
    }
  }

  function parse(text) {
    const tk = tokenize(text);
    const sections = {};
    for (let i = 0; i < tk.n; i++) {
      if (tk.codes[i] === 0 && tk.vals[i].trim() === 'SECTION' && tk.codes[i + 1] === 2) {
        const name = tk.vals[i + 1].trim();
        let j = i + 2;
        while (j < tk.n && !(tk.codes[j] === 0 && tk.vals[j].trim() === 'ENDSEC')) j++;
        sections[name] = [i + 2, j];
        i = j;
      }
    }
    const D = { tk, header: {}, headerTok: {}, sections, layers: new Map(), ltypes: new Map(), styles: new Map(), blockRecords: new Map(),
      blocks: new Map(), blockList: [], entities: [], layouts: [], imagedefs: new Map(), dimstyles: new Map() };
    if (sections.HEADER) D.headerEndLine = tk.li[sections.HEADER[1]];

    // HEADER
    if (sections.HEADER) {
      let name = null;
      for (let i = sections.HEADER[0]; i < sections.HEADER[1]; i++) {
        const c = tk.codes[i], v = tk.vals[i];
        if (c === 9) { name = v.trim(); D.header[name] = {}; D.headerTok[name] = {}; }
        else if (name) { D.header[name][c] = v; D.headerTok[name][c] = i; }
      }
    }
    const hv = (n, c, def) => (D.header[n] && D.header[n][c] !== undefined ? D.header[n][c] : def);
    D.insunits = int(hv('$INSUNITS', 70, 0));
    D.ltscale = num(hv('$LTSCALE', 40, 1)) || 1;
    D.lwdefault = int(hv('$LWDEFAULT', 370, 25));
    D.acadver = (hv('$ACADVER', 1, '') || '').trim();

    // TABLES — se guardan los registros con su posición en el archivo para poder editarlos (capas, tipos de línea, estilos)
    D.tables = {};
    if (sections.TABLES) {
      let cur = null;
      for (const r of readRecords(tk, sections.TABLES[0], sections.TABLES[1])) {
        if (r.type === 'TABLE') { cur = { name: (r.get(2, '') || '').trim().toUpperCase(), head: r, recs: [], endLine: null }; D.tables[cur.name] = cur; continue; }
        if (r.type === 'ENDTAB') { if (cur) cur.endLine = r.L0; cur = null; continue; }
        if (cur) cur.recs.push(r);
      }
    }
    D.layerSeq = 0;
    deriveTables(D);
    // BLOCKS
    if (sections.BLOCKS) {
      let cur = null;
      for (const r of readRecords(tk, sections.BLOCKS[0], sections.BLOCKS[1])) {
        if (r.type === 'BLOCK') {
          cur = { name: r.get(2, '').trim(), base: [r.num(10), r.num(20)], flags: r.int(70), owner: (r.get(330, '') || '').trim(), ents: [], head: r };
          D.blocks.set(cur.name.toUpperCase(), cur); D.blockList.push(cur);
        } else if (r.type === 'ENDBLK') { if (cur) { cur.endLine = r.L0; cur.end = r; } cur = null; }
        else if (cur) cur.ents.push(r);
      }
    }
    if (sections.BLOCKS) D.blocksEndLine = tk.li[sections.BLOCKS[1]];
    // ENTITIES
    if (sections.ENTITIES) { D.entities = readRecords(tk, sections.ENTITIES[0], sections.ENTITIES[1]); D.entitiesEndLine = tk.li[sections.ENTITIES[1]]; }

    // OBJECTS: se guardan los registros (para editar planchas, imágenes y diccionarios) y se leen LAYOUT e IMAGEDEF
    D.objects = [];
    if (sections.OBJECTS) { D.objects = readRecords(tk, sections.OBJECTS[0], sections.OBJECTS[1]); D.objects.endLine = tk.li[sections.OBJECTS[1]]; }
    for (const r of D.objects) if (r.type === 'IMAGEDEF') D.imagedefs.set(r.get(5, '').trim(), { file: (r.get(1, '') || '').trim(), w: r.num(10), h: r.num(20) });
    deriveLayouts(D);
    return D;
  }

  // ---------------------------------------------------------------- textos
  function decodeText(s) {
    if (!s) return '';
    return s
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\M\+[0-9A-Fa-f]{5}/g, '')
      .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
      .replace(/%%[uUoOkK]/g, '').replace(/%%(\d{3})/g, (_, d) => String.fromCharCode(+d)).replace(/%%%/g, '%')
      .replace(/\^I/g, '    ').replace(/\^J/g, '\n').replace(/\^ /g, '^'); // notación de control de DXF (^I = tabulador)
  }

  // Quita los códigos de formato de MTEXT y devuelve las líneas (párrafos con \P).
  function mtextPlain(s) {
    s = decodeText(s);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{' || ch === '}') continue;
      if (ch !== '\\') { out += ch; continue; }
      const k = s[i + 1];
      if (k === undefined) break;
      if (k === 'P' || k === 'N') { out += '\n'; i++; continue; }
      if (k === '~') { out += ' '; i++; continue; }
      if (k === '\\' || k === '{' || k === '}') { out += k; i++; continue; }
      if ('LlOoKk'.includes(k)) { i++; continue; }
      if (k === 'S') { // fracción apilada \Sa^b; o a/b; o a#b;
        const end = s.indexOf(';', i);
        const body = end > 0 ? s.slice(i + 2, end) : '';
        out += body.replace(/[\^#]/, '/'); i = end > 0 ? end : i + 1; continue;
      }
      // códigos con argumento hasta ';': \A \C \c \F \f \H \Q \T \W \p
      const end = s.indexOf(';', i);
      if (end > 0 && 'ACcFfHQTWpX'.includes(k)) { i = end; continue; }
      i++;
    }
    return out.replace(/\r/g, '').split('\n');
  }

  function fontFamily(style) {
    const f = ((style && style.font) || '').toLowerCase();
    const base = f.replace(/\.(ttf|otf|ttc|shx)$/, '');
    if (/arial ?narrow|isocp|isoct|romans|simplex|txt|monotxt|romant|isocpeur/.test(base) || /\.shx$/.test(f) || !f)
      return '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    if (/opensans/.test(base.replace(/[-_ ]/g, ''))) return '"Open Sans", "Helvetica Neue", Arial, sans-serif';
    if (/liberationsans|arial|helvet/.test(base.replace(/[-_ ]/g, ''))) return 'Arial, "Helvetica Neue", sans-serif';
    if (/times|serif|roman/.test(base)) return '"Times New Roman", Times, serif';
    if (/mono|courier/.test(base)) return '"Courier New", monospace';
    return `"${base.split(/[-_]/)[0]}", Arial, sans-serif`;
  }
  const weightOf = (style) => (/bold|black|semibold/i.test((style && style.font) || '') ? 'bold' : 'normal');
  const italicOf = (style) => (/italic|oblique/i.test((style && style.font) || '') ? 'italic' : 'normal');
  const EM = 1.38; // altura de texto DXF (≈ altura de mayúscula) → tamaño de letra

  let measureCtx = null;
  function measure(str, font) {
    if (!measureCtx) { const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(4, 4) : document.createElement('canvas'); measureCtx = c.getContext('2d'); }
    measureCtx.font = font; return measureCtx.measureText(str).width;
  }

  // ---------------------------------------------------------------- geometría
  function bulgeArc(path, x0, y0, x1, y1, b, ext) {
    if (!b) { path.lineTo(x1, y1); ext(x1, y1); return; }
    const theta = 4 * Math.atan(b);
    const dx = x1 - x0, dy = y1 - y0, c = Math.hypot(dx, dy);
    if (c < 1e-12) return;
    const r = c / (2 * Math.sin(Math.abs(theta) / 2));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const h = r * Math.cos(theta / 2) * Math.sign(b); // distancia del centro a la cuerda (con signo)
    const cx = mx - (dy / c) * h, cy = my + (dx / c) * h; // centro sobre la normal izquierda de la cuerda
    const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
    path.arc(cx, cy, Math.abs(r), a0, a1, b < 0);
    ext(cx - Math.abs(r), cy - Math.abs(r)); ext(cx + Math.abs(r), cy + Math.abs(r));
  }

  // NURBS por de Boor (muestreo)
  function nurbs(ctrl, knots, weights, degree, samples) {
    const n = ctrl.length;
    if (n < 2) return ctrl.slice();
    if (!knots || knots.length !== n + degree + 1) { // nodos uniformes "clamped"
      knots = [];
      for (let i = 0; i <= degree; i++) knots.push(0);
      for (let i = 1; i < n - degree; i++) knots.push(i);
      for (let i = 0; i <= degree; i++) knots.push(Math.max(1, n - degree));
    }
    const w = weights && weights.length === n ? weights : null;
    const t0 = knots[degree], t1 = knots[n];
    const out = [];
    for (let s = 0; s <= samples; s++) {
      const t = t0 + (t1 - t0) * (s / samples);
      let k = degree;
      while (k < n - 1 && knots[k + 1] <= t) k++;
      const d = [];
      for (let j = 0; j <= degree; j++) {
        const p = ctrl[k - degree + j], ww = w ? w[k - degree + j] : 1;
        d.push([p[0] * ww, p[1] * ww, ww]);
      }
      for (let r = 1; r <= degree; r++) for (let j = degree; j >= r; j--) {
        const i = k - degree + j;
        const den = knots[i + degree - r + 1] - knots[i];
        const a = den === 0 ? 0 : (t - knots[i]) / den;
        for (let q = 0; q < 3; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q];
      }
      out.push([d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]]);
    }
    return out;
  }

  function ptsPath(pts, close) {
    const p = new Path2D(); const bb = EMPTY();
    pts.forEach(([x, y], i) => { if (i) p.lineTo(x, y); else p.moveTo(x, y); bbUnion(bb, [x, y, x, y]); });
    if (close) p.closePath();
    return { p, bb };
  }

  // ---------------------------------------------------------------- de DXF a escena
  function build(D, opts = {}) {
    const resolveURL = opts.resolveURL || ((f) => f);
    const imageJobs = [];
    const layerIdx = new Map([...D.layers.values()].map((l) => [l.name.toUpperCase(), l.idx]));
    const layerOf = (name) => D.layers.get(name) || D.layers.get([...D.layers.keys()].find((k) => k.toUpperCase() === (name || '').toUpperCase())) || D.layers.get('0');
    const blockCache = new Map();
    const stats = { entities: 0, skipped: {}, warnings: new Set() };

    const css = (rgb) => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');
    const aciCss = (i) => (i === 7 || i === 255 ? '#000000' : css(ACI[i] ?? 0)); // el 7 se dibuja negro sobre papel blanco

    /** Propiedades efectivas de una entidad dentro de un contexto (capa/color/tipo de línea del bloque que la inserta). */
    function props(e, ctx) {
      let lname = (e.get(8, '0') || '0').trim();
      if (lname === '0' && ctx.layer) lname = ctx.layer; // capa 0 dentro de un bloque toma la capa de la inserción
      const L = layerOf(lname);
      let color;
      const tc = e.get(420), ci = e.int(62, 256);
      if (tc !== undefined) color = css(int(tc));
      else if (ci === 0) color = ctx.color || aciCss(7); // PorBloque
      else if (ci === 256 || ci < 0) color = L.tc !== undefined ? css(int(L.tc)) : aciCss(L.color); // PorCapa
      else color = aciCss(ci);
      let lt = (e.get(6, 'BYLAYER') || 'BYLAYER').trim().toUpperCase();
      if (lt === 'BYLAYER') lt = (L.ltype || 'CONTINUOUS').toUpperCase();
      else if (lt === 'BYBLOCK') lt = (ctx.ltype || 'CONTINUOUS').toUpperCase();
      let lw = e.int(370, -1);
      if (lw === -1) lw = L.lw; else if (lw === -2) lw = ctx.lw ?? -3;
      if (lw === -3 || lw === -1 || lw === -2) lw = D.lwdefault;
      const hiddenLayer = L.off || L.frozen;
      return { layer: L, lname: L.name, color, ltype: lt, lwmm: Math.max(0, lw) / 100, ltscale: e.num(48, 1), hidden: hiddenLayer };
    }

    function dashFor(pr) {
      const t = D.ltypes.get(pr.ltype);
      if (!t || !t.pattern.length) return null;
      const s = D.ltscale * (pr.ltscale || 1);
      const a = [];
      for (const v of t.pattern) a.push(v === 0 ? 0.0001 : Math.abs(v) * s);
      if (a.length % 2) a.push(a[a.length - 1]);
      return a.some((v) => v > 0) ? a : null;
    }

    const strokeNode = (p, bb, pr) => ({ k: 'p', p, stroke: pr.color, lwmm: pr.lwmm, dash: dashFor(pr), layer: pr.layer.idx, bb });
    const fillNode = (p, bb, pr, rule) => ({ k: 'p', p, fill: pr.color, rule, layer: pr.layer.idx, bb });

    // OCS con extrusión (0,0,-1): espejo en X (bloques reflejados)
    const mirrored = (e) => e.num(230, 1) < 0;

    function textNode(e, pr, isAttrib) {
      let str = decodeText(e.get(1, ''));
      if (!str.trim()) return null;
      const st = D.styles.get((e.get(7, 'STANDARD') || 'STANDARD').trim().toUpperCase());
      const h = e.num(40, (st && st.height) || 2.5) || 2.5;
      const wf = e.num(41, (st && st.width) || 1) || 1;
      let rot = e.num(50, 0) * DEG;
      const ha = e.int(72, 0), va = isAttrib ? e.int(74, 0) : e.int(73, 0);
      let x = e.num(10), y = e.num(20);
      if (ha !== 0 || va !== 0) { if (e.get(11) !== undefined) { x = e.num(11); y = e.num(21); } }
      const family = fontFamily(st), size = h * EM;
      let sx = wf, align = 'left';
      if (ha === 1 || ha === 4) align = 'center'; else if (ha === 2) align = 'right';
      if (ha === 3 || ha === 5) { // alineado / ajustado entre dos puntos
        const x0 = e.num(10), y0 = e.num(20), x1 = e.num(11, x0), y1 = e.num(21, y0);
        const L = Math.hypot(x1 - x0, y1 - y0);
        rot = Math.atan2(y1 - y0, x1 - x0); x = x0; y = y0; align = 'left';
        const w = measure(str, `${size}px ${family}`);
        if (w > 0 && L > 0) sx = L / w;
      }
      let dy = 0; // desplazamiento vertical en coordenadas locales (y hacia abajo = -arriba)
      if (ha === 4 || va === 2) dy = h / 2; else if (va === 3) dy = h; else if (va === 1) dy = -h * 0.28;
      if (mirrored(e)) { x = -x; rot = Math.PI - rot; }
      const obl = (e.num(51, st ? st.oblique : 0) || 0) * DEG;
      const c = Math.cos(rot), s = Math.sin(rot);
      const m = [c, s, s + Math.tan(obl) * c, -c + Math.tan(obl) * s, x, y];
      const w = h * 0.75 * str.length * sx;
      const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
      return { k: 'g', m, local: true, layer: pr.layer.idx, ch: [{ k: 't', str, x: 0, y: dy, size, sx, align, family, weight: weightOf(st), style: italicOf(st), fill: pr.color }],
        bb: bbXform([x0, -h * 1.3 + dy, x0 + w, h * 0.4 + dy], m) };
    }

    function mtextNode(e0, pr) {
      // AutoCAD 2018+ agrega al final una sección "Embedded Object" (código 101) que repite códigos 10/11/21
      // con otro significado: se ignora todo lo que viene después.
      const cut = e0.p.findIndex(([c]) => c === 101);
      const e = cut >= 0 ? new Rec(e0.type, e0.p.slice(0, cut)) : e0;
      let raw = e.all(3).join('') + (e.get(1, '') || '');
      const lines = mtextPlain(raw);
      if (!lines.some((l) => l.trim())) return null;
      const st = D.styles.get((e.get(7, 'STANDARD') || 'STANDARD').trim().toUpperCase());
      const h = e.num(40, 2.5) || 2.5;
      const refW = e.num(41, 0);
      const att = e.int(71, 1);
      let rot = e.num(50, 0) * DEG;
      if (e.get(11) !== undefined) rot = Math.atan2(e.num(21), e.num(11));
      const family = fontFamily(st), size = h * EM, font = `${size}px ${family}`;
      const spacing = h * 1.667 * (e.num(44, 1) || 1);
      // ajuste de línea por ancho de referencia
      const out = [];
      for (const ln of lines) {
        if (refW > 0 && measure(ln, font) > refW * 1.02) {
          let cur = '';
          for (const word of ln.split(/(\s+)/)) {
            if (cur && measure(cur + word, font) > refW) { out.push(cur.trimEnd()); cur = word.trimStart(); } else cur += word;
          }
          out.push(cur);
        } else out.push(ln);
      }
      const col = (att - 1) % 3, row = Math.floor((att - 1) / 3); // 0 izq/arriba
      const align = col === 0 ? 'left' : col === 1 ? 'center' : 'right';
      const totalH = h + spacing * (out.length - 1);
      const top = row === 0 ? 0 : row === 1 ? -totalH / 2 : -totalH; // y local (hacia abajo) de la primera línea base menos h
      let x = e.num(10), y = e.num(20);
      if (mirrored(e)) x = -x;
      const c = Math.cos(rot), s = Math.sin(rot);
      const m = [c, s, s, -c, x, y];
      const ch = out.map((t, i) => ({ k: 't', str: t, x: 0, y: top + h + spacing * i, size, align, family, weight: weightOf(st), style: italicOf(st), fill: pr.color }));
      const w = Math.max(refW, ...out.map((t) => measure(t, font)));
      const x0 = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w;
      return { k: 'g', m, local: true, layer: pr.layer.idx, ch, bb: bbXform([x0, top - h * 0.2, x0 + w, top + totalH + h * 0.3], m) };
    }

    function hatchNode(e, pr) {
      // recorrido secuencial de los pares (los códigos se repiten por contorno)
      const P = e.p; let i = 0;
      const path = new Path2D(); const bb = EMPTY();
      const ext = (x, y) => bbUnion(bb, [x, y, x, y]);
      let solid = 0, pname = '', lines = [], nPaths = 0;
      const mir = mirrored(e);
      const X = (x) => (mir ? -x : x);
      while (i < P.length) {
        const [c, v] = P[i];
        if (c === 2 && !pname) pname = v.trim();
        else if (c === 70) solid = int(v);
        else if (c === 91) { nPaths = int(v); i++; break; }
        i++;
      }
      for (let pth = 0; pth < nPaths && i < P.length; pth++) {
        while (i < P.length && P[i][0] !== 92) i++;
        if (i >= P.length) break;
        const flags = int(P[i][1]); i++;
        if (flags & 2) { // polilínea
          let hasB = 0, closed = 1, n = 0;
          while (i < P.length && P[i][0] !== 93) { if (P[i][0] === 72) hasB = int(P[i][1]); if (P[i][0] === 73) closed = int(P[i][1]); i++; }
          n = int(P[i][1]); i++;
          const vs = [];
          while (vs.length < n && i < P.length) {
            if (P[i][0] === 10) { const x = X(num(P[i][1])), y = num(P[i + 1][1]); i += 2; let b = 0; if (hasB && P[i] && P[i][0] === 42) { b = num(P[i][1]); i++; } vs.push([x, y, mir ? -b : b]); }
            else i++;
          }
          vs.forEach(([x, y, b], k) => {
            if (k === 0) { path.moveTo(x, y); ext(x, y); }
            const prev = vs[k - 1];
            if (k > 0) bulgeArc(path, prev[0], prev[1], x, y, prev[2], ext);
          });
          if (vs.length > 1) { const l = vs[vs.length - 1]; bulgeArc(path, l[0], l[1], vs[0][0], vs[0][1], l[2], ext); }
          path.closePath();
        } else { // aristas
          while (i < P.length && P[i][0] !== 93) i++;
          const ne = int(P[i][1]); i++;
          let first = true;
          for (let k = 0; k < ne && i < P.length; k++) {
            while (i < P.length && P[i][0] !== 72) i++;
            const et = int(P[i][1]); i++;
            const g = {}; const rd = (code) => { while (i < P.length && P[i][0] !== code) i++; const v = num(P[i] && P[i][1]); i++; return v; };
            if (et === 1) {
              const x0 = X(rd(10)), y0 = rd(20), x1 = X(rd(11)), y1 = rd(21);
              if (first) { path.moveTo(x0, y0); first = false; } path.lineTo(x1, y1); ext(x0, y0); ext(x1, y1);
            } else if (et === 2 || et === 3) {
              const cx = X(rd(10)), cy = rd(20);
              let mx = 0, my = 0, r, ratio = 1;
              if (et === 2) r = rd(40); else { mx = rd(11); my = rd(21); ratio = rd(40); r = Math.hypot(mx, my); if (mir) mx = -mx; }
              let a0 = rd(50), a1 = rd(51);
              const ccw = (P[i] && P[i][0] === 73) ? int(P[i][1]) : 1; if (P[i] && P[i][0] === 73) i++;
              let rot = et === 3 ? Math.atan2(my, mx) : 0;
              if (et === 3) { a0 = a0; a1 = a1; } // grados en ambos casos (ezdxf: arcos y elipses en grados)
              let s0 = a0 * DEG, s1 = a1 * DEG;
              if (!ccw) { s0 = -s0; s1 = -s1; }
              if (mir) { s0 = Math.PI - s0; s1 = Math.PI - s1; }
              const anticlock = mir ? !!ccw : !ccw;
              const sx0 = cx + Math.cos(rot) * r * Math.cos(s0) - Math.sin(rot) * r * ratio * Math.sin(s0);
              const sy0 = cy + Math.sin(rot) * r * Math.cos(s0) + Math.cos(rot) * r * ratio * Math.sin(s0);
              if (first) { path.moveTo(sx0, sy0); first = false; }
              path.ellipse(cx, cy, r, r * ratio, rot, s0, s1, anticlock);
              ext(cx - r, cy - r); ext(cx + r, cy + r);
            } else if (et === 4) { // spline
              const deg = rd(94); while (i < P.length && P[i][0] !== 95) i++; const nk = int(P[i][1]); i++;
              const nc = int(P[i][1]); i++;
              const knots = [], ctrl = [], wts = [];
              while (i < P.length && (P[i][0] === 40 || P[i][0] === 10 || P[i][0] === 20 || P[i][0] === 42)) {
                if (P[i][0] === 40) knots.push(num(P[i][1]));
                else if (P[i][0] === 10) ctrl.push([X(num(P[i][1])), num(P[i + 1][1])]), i++;
                else if (P[i][0] === 42) wts.push(num(P[i][1]));
                i++;
              }
              const pts = nurbs(ctrl, knots.length === nk ? knots : null, wts, Math.max(1, deg), Math.max(8, nc * 6));
              pts.forEach(([x, y]) => { if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y); ext(x, y); });
            }
          }
          path.closePath();
        }
      }
      if (!isFinite(bb[0])) return null;
      // definición del patrón (ya transformada por ángulo y escala en el propio HATCH)
      if (!solid) {
        while (i < P.length && P[i][0] !== 78) i++;
        if (i < P.length) {
          const nl = int(P[i][1]); i++;
          for (let k = 0; k < nl && i < P.length; k++) {
            const L = { a: 0, bx: 0, by: 0, ox: 0, oy: 0, d: [] };
            while (i < P.length && P[i][0] !== 53) i++;
            if (i >= P.length) break;
            L.a = num(P[i][1]); i++;
            for (; i < P.length; i++) {
              const [c, v] = P[i];
              if (c === 43) L.bx = num(v); else if (c === 44) L.by = num(v); else if (c === 45) L.ox = num(v); else if (c === 46) L.oy = num(v);
              else if (c === 79) {} else if (c === 49) L.d.push(num(v)); else break;
            }
            if (mir) { L.a = 180 - L.a; L.bx = -L.bx; L.ox = -L.ox; }
            lines.push(L);
          }
        }
        if (!lines.length) lines = [{ a: 45, bx: 0, by: 0, ox: 0, oy: Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 40, d: [] }];
        const seg = patternLines(lines, bb);
        if (seg) return { k: 'h', p: path, rule: 'evenodd', lines: seg, color: pr.color, layer: pr.layer.idx, bb };
        stats.warnings.add('Sombreado con patrón muy denso: se rellenó de color suave.');
        return { k: 'g', op: 0.25, layer: pr.layer.idx, ch: [fillNode(path, bb, pr, 'evenodd')], bb };
      }
      return fillNode(path, bb, pr, 'evenodd');
    }

    // Líneas del patrón sobre la caja del contorno (el contorno recorta al dibujar).
    function patternLines(defs, bb) {
      const p = new Path2D(); let segs = 0; const LIMIT = 30000;
      const cxb = (bb[0] + bb[2]) / 2, cyb = (bb[1] + bb[3]) / 2, R = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 1e-9;
      for (const L of defs) {
        const a = L.a * DEG, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
        const sp = L.ox * nx + L.oy * ny; // separación entre líneas (normal)
        const sh = L.ox * ux + L.oy * uy; // corrimiento a lo largo de la línea
        if (Math.abs(sp) < 1e-9) continue;
        const dist0 = (cxb - L.bx) * nx + (cyb - L.by) * ny; // distancia normal del centro de la caja a la línea base
        const k0 = Math.floor((dist0 - R) / sp), k1 = Math.ceil((dist0 + R) / sp);
        const kmin = Math.min(k0, k1), kmax = Math.max(k0, k1);
        if (kmax - kmin > 4000) return null;
        const dashLen = L.d.reduce((s, v) => s + Math.abs(v), 0);
        for (let k = kmin; k <= kmax; k++) {
          const px = L.bx + k * L.ox, py = L.by + k * L.oy;
          const t = (cxb - px) * ux + (cyb - py) * uy; // proyección del centro sobre la línea
          let t0 = t - R, t1 = t + R;
          if (!L.d.length || dashLen <= 0) {
            p.moveTo(px + ux * t0, py + uy * t0); p.lineTo(px + ux * t1, py + uy * t1); segs++;
          } else {
            let s = Math.floor(t0 / dashLen) * dashLen; // los guiones arrancan en el punto base de cada línea
            while (s < t1) {
              for (const v of L.d) {
                const len = Math.abs(v);
                if (v >= 0) { const a0 = Math.max(s, t0), a1 = Math.min(s + Math.max(len, 1e-6), t1); if (a1 > a0 || v === 0) { p.moveTo(px + ux * a0, py + uy * a0); p.lineTo(px + ux * (v === 0 ? a0 + 1e-6 : a1), py + uy * (v === 0 ? a0 + 1e-6 : a1)); segs++; } }
                s += len;
                if (segs > LIMIT) return null;
              }
            }
          }
          if (segs > LIMIT) return null;
        }
      }
      return p;
    }

    /** Convierte una entidad en nodo(s). ctx = contexto de inserción (capa/color PorBloque). Devuelve nodo o null. */
    function convert(e, ctx, seq) {
      if (e.deleted) return null;
      const t = e.type;
      if (t === 'VIEWPORT' || t === 'ATTDEF' || t === 'SEQEND' || t === 'VERTEX' || t === 'ATTRIB') return null;
      const pr = props(e, ctx);
      if (pr.hidden) return null;
      if (e.int(60, 0) === 1) return null; // invisible
      stats.entities++;
      const mir = mirrored(e);
      switch (t) {
        case 'LINE': {
          const x0 = e.num(10), y0 = e.num(20), x1 = e.num(11), y1 = e.num(21);
          const p = new Path2D(); p.moveTo(x0, y0); p.lineTo(x1, y1);
          return strokeNode(p, [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], pr);
        }
        case 'LWPOLYLINE': {
          const vs = []; let cur = null;
          for (const [c, v] of e.p) {
            if (c === 10) { cur = [num(v), 0, 0]; vs.push(cur); }
            else if (c === 20 && cur) cur[1] = num(v);
            else if (c === 42 && cur) cur[2] = num(v);
          }
          if (mir) vs.forEach((q) => { q[0] = -q[0]; q[2] = -q[2]; });
          return polyNode(vs, (e.int(70) & 1) === 1, pr, e.num(43, 0));
        }
        case 'POLYLINE': {
          const vs = (seq || []).filter((v) => v.type === 'VERTEX' && !(v.int(70) & 16) && !(v.int(70) & 128 && !(v.int(70) & 64)))
            .map((v) => [v.num(10), v.num(20), v.num(42)]);
          if (mir) vs.forEach((q) => { q[0] = -q[0]; q[2] = -q[2]; });
          return vs.length > 1 ? polyNode(vs, (e.int(70) & 1) === 1, pr, e.num(40, 0)) : null;
        }
        case 'CIRCLE': {
          let x = e.num(10), y = e.num(20); const r = e.num(40); if (mir) x = -x;
          const p = new Path2D(); p.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
          return strokeNode(p, [x - r, y - r, x + r, y + r], pr);
        }
        case 'ARC': {
          let x = e.num(10), y = e.num(20); const r = e.num(40);
          let a0 = e.num(50) * DEG, a1 = e.num(51) * DEG;
          if (mir) { x = -x; const b0 = Math.PI - a1, b1 = Math.PI - a0; a0 = b0; a1 = b1; }
          const p = new Path2D(); p.arc(x, y, r, a0, a1, false);
          return strokeNode(p, [x - r, y - r, x + r, y + r], pr);
        }
        case 'ELLIPSE': {
          let cx = e.num(10), cy = e.num(20), mx = e.num(11), my = e.num(21);
          const ratio = e.num(40, 1); let s0 = e.num(41, 0), s1 = e.num(42, Math.PI * 2);
          let rot = Math.atan2(my, mx); const r = Math.hypot(mx, my);
          if (mir) { cx = -cx; rot = Math.PI - rot; const b0 = -s1, b1 = -s0; s0 = b0; s1 = b1; }
          const p = new Path2D(); p.ellipse(cx, cy, r, r * ratio, rot, s0, s1, false);
          return strokeNode(p, [cx - r, cy - r, cx + r, cy + r], pr);
        }
        case 'SPLINE': {
          const ctrl = [], fit = [];
          let cur = null, fcur = null;
          for (const [c, v] of e.p) {
            if (c === 10) { cur = [num(v), 0]; ctrl.push(cur); } else if (c === 20 && cur) cur[1] = num(v);
            else if (c === 11) { fcur = [num(v), 0]; fit.push(fcur); } else if (c === 21 && fcur) fcur[1] = num(v);
          }
          const deg = e.int(71, 3);
          let pts = ctrl.length >= 2 ? nurbs(ctrl, e.all(40).map(num), e.all(41).map(num), Math.max(1, deg), Math.max(16, ctrl.length * 8)) : fit;
          if (mir) pts = pts.map(([x, y]) => [-x, y]);
          if (pts.length < 2) return null;
          const { p, bb } = ptsPath(pts, (e.int(70) & 1) === 1);
          return strokeNode(p, bb, pr);
        }
        case 'TEXT': return textNode(e, pr, false);
        case 'MTEXT': return mtextNode(e, pr);
        case 'SOLID': case 'TRACE': case '3DFACE': {
          const q = [[e.num(10), e.num(20)], [e.num(11), e.num(21)], [e.num(13, e.num(12)), e.num(23, e.num(22))], [e.num(12), e.num(22)]];
          if (mir) q.forEach((v) => { v[0] = -v[0]; });
          const { p, bb } = ptsPath(t === '3DFACE' ? [q[0], q[1], q[3], q[2]] : q, true);
          return t === '3DFACE' ? strokeNode(p, bb, pr) : fillNode(p, bb, pr, 'nonzero');
        }
        case 'HATCH': return hatchNode(e, pr);
        case 'POINT': {
          const x = e.num(10), y = e.num(20); const p = new Path2D(); p.moveTo(x, y); p.lineTo(x + 1e-9, y);
          return { ...strokeNode(p, [x, y, x, y], pr), lwmm: null, lw: 0 };
        }
        case 'LEADER': {
          const vs = []; let cur = null;
          for (const [c, v] of e.p) { if (c === 10) { cur = [num(v), 0]; vs.push(cur); } else if (c === 20 && cur) cur[1] = num(v); }
          if (vs.length < 2) return null;
          const { p, bb } = ptsPath(vs, false);
          if (e.int(71, 1)) { // flecha rellena del tamaño del estilo de cota (DIMASZ × DIMSCALE)
            const ds = D.dimstyles.get((e.get(3, 'STANDARD') || 'STANDARD').trim().toUpperCase());
            const asz = ds ? (ds.num(41, 2.5) || 2.5) * (ds.num(40, 1) || 1) : 2.5;
            const [x0, y0] = vs[0], [x1, y1] = vs[1]; const L = Math.hypot(x1 - x0, y1 - y0) || 1;
            const sz = Math.min(L * 0.5, asz);
            const ux = (x1 - x0) / L, uy = (y1 - y0) / L, w = sz / 6;
            const a = new Path2D(); a.moveTo(x0, y0); a.lineTo(x0 + ux * sz - uy * w, y0 + uy * sz + ux * w); a.lineTo(x0 + ux * sz + uy * w, y0 + uy * sz - ux * w); a.closePath();
            return { k: 'g', ch: [strokeNode(p, bb, pr), fillNode(a, bb, pr, 'nonzero')], bb };
          }
          return strokeNode(p, bb, pr);
        }
        case 'INSERT': return insertNode(e, pr, ctx, seq);
        case 'DIMENSION': case 'ACAD_TABLE': {
          const name = (e.get(2, '') || '').trim();
          const b = D.blocks.get(name.toUpperCase());
          if (!b) return null;
          return blockRef(b, [1, 0, 0, 1, 0, 0], { layer: pr.lname, color: pr.color, ltype: pr.ltype, lw: Math.round(pr.lwmm * 100) }, pr);
        }
        case 'IMAGE': {
          const def = D.imagedefs.get((e.get(340, '') || '').trim());
          const ix = e.num(10), iy = e.num(20), ux = e.num(11), uy = e.num(21), vx = e.num(12), vy = e.num(22);
          const w = e.num(13, def ? def.w : 1), h = e.num(23, def ? def.h : 1);
          const m = [ux, uy, -vx, -vy, ix + vx * h, iy + vy * h];
          const node = { k: 'i', img: null, x: 0, y: 0, w, h };
          if (def && def.file) {
            const url = resolveURL(def.file);
            node.src = url; // el escritor DWF vuelve a leer los bytes originales (PNG/JPEG ya comprimidos)
            imageJobs.push(loadImage(url).then((img) => { node.img = img; }).catch(() => stats.warnings.add('Imagen no encontrada: ' + def.file)));
          }
          return { k: 'g', m, local: true, layer: pr.layer.idx, ch: [node], bb: bbXform([0, 0, w, h], m) };
        }
        case 'WIPEOUT': try { return wipeoutNode(e, pr); } catch (err) { return null; }
        case 'MULTILEADER': case 'MLEADER': try { return mleaderNode(e, pr, ctx); } catch (err) { return null; }
        default:
          stats.skipped[t] = (stats.skipped[t] || 0) + 1;
          return null;
      }
    }

    /** WIPEOUT: polígono que tapa con el color del papel lo dibujado ANTES (el orden de entidades ya es el orden de dibujo).
     *  Vértices 14/24 normalizados (−0,5…0,5, origen en el centro, Y invertida); a WCS con el punto 10/20, los vectores
     *  U 11/21 y V 12/22 y el tamaño 13/23 (mismo modelo que IMAGE; igual que boundary_path_wcs() de ezdxf).
     *  Nodo: {k:'p', fill:'#ffffff', bg:true} — los dibujantes lo pintan siempre blanco (también en mono/grises). */
    function wipeoutNode(e, pr) {
      let vs = []; let cur = null;
      for (const [c, v] of e.p) { if (c === 14) { cur = [num(v), 0]; vs.push(cur); } else if (c === 24 && cur) cur[1] = num(v); }
      if (vs.length === 2 || (e.int(71, 2) === 1 && vs.length >= 2)) { // rectángulo por dos esquinas
        const [a, b] = vs; vs = [a, [b[0], a[1]], b, [a[0], b[1]]];
      }
      if (vs.length < 3) return null;
      const ix = e.num(10), iy = e.num(20), ux = e.num(11, 1), uy = e.num(21), vx = e.num(12), vy = e.num(22, 1);
      const h = e.num(23, 1) || 1;
      const ox = ix + ux * 0.5 - vx * 0.5, oy = iy + uy * 0.5 - vy * 0.5;
      let pts = vs.map(([x, y]) => [ox + ux * x + vx * (h - y), oy + uy * x + vy * (h - y)]);
      if (mirrored(e)) pts = pts.map(([x, y]) => [-x, y]);
      if (!pts.every(([x, y]) => isFinite(x) && isFinite(y))) return null;
      const { p, bb } = ptsPath(pts, true);
      return { k: 'p', p, fill: '#ffffff', bg: true, rule: 'nonzero', layer: pr.layer.idx, bb };
    }

    /** MULTILEADER (MLEADER): se lee la sección CONTEXT_DATA{ … } (referencia pública DXF de MLEADER):
     *  40 escala, 41 altura de texto, 140 tamaño de flecha, 290 tiene MTEXT, 304 texto, 340 estilo, 12/22 posición,
     *  13/23 dirección, 42 rotación, 43 ancho, 45 interlineado, 171 punto de anclaje; 296 tiene bloque, 341 bloque,
     *  15/25 posición, 16/26 escala, 46 rotación. Cada LEADER{ trae 10/20 último punto, 11/21 vector y 40 largo del
     *  quiebre (dogleg) y sus LEADER_LINE{ 10/20 vértices }. Fuera del contexto: 170 tipo de línea (0 = invisible),
     *  291 tiene quiebre, 342 flecha. Flecha rellena en el primer vértice de cada línea. */
    function mleaderNode(e, pr, ctx) {
      const P = e.p;
      const i0 = P.findIndex(([c, v]) => c === 300 && String(v).trim() === 'CONTEXT_DATA{');
      if (i0 < 0) return null;
      const C = { scale: 1, h: 0, arrow: 0, hasText: false, hasBlock: false, text: '', style: '', tx: 0, ty: 0, dx: 1, dy: 0, rot: 0, tw: 0, ls: 1, att: 1,
        bh: '', bx: 0, by: 0, bsx: 1, bsy: 1, brot: 0, leaders: [] };
      let i = i0 + 1, L = null, line = null;
      for (; i < P.length; i++) {
        const [c, raw] = P[i]; const v = String(raw).trim();
        if (c === 301 && v === '}') { i++; break; }
        if (c === 302 && v === 'LEADER{') { L = { lines: [], last: null, hasLast: true, dog: [1, 0], dl: 0 }; C.leaders.push(L); continue; }
        if (c === 303 && v === '}') { L = null; continue; }
        if (c === 304 && v === 'LEADER_LINE{' && L) { line = []; L.lines.push(line); continue; }
        if (c === 305 && v === '}') { line = null; continue; }
        if (line) { if (c === 10) line.push([num(v), 0]); else if (c === 20 && line.length) line[line.length - 1][1] = num(v); continue; }
        if (L) {
          if (c === 290) L.hasLast = int(v) !== 0;
          else if (c === 10) L.last = [num(v), L.last ? L.last[1] : 0]; else if (c === 20 && L.last) L.last[1] = num(v);
          else if (c === 11) L.dog[0] = num(v); else if (c === 21) L.dog[1] = num(v);
          else if (c === 40) L.dl = num(v);
          continue;
        }
        switch (c) {
          case 40: C.scale = num(v); break;
          case 41: C.h = num(v); break;
          case 140: C.arrow = num(v); break;
          case 290: C.hasText = int(v) !== 0; break;
          case 296: C.hasBlock = int(v) !== 0; break;
          case 304: C.text = raw; break;
          case 340: C.style = v; break;
          case 12: C.tx = num(v); break; case 22: C.ty = num(v); break;
          case 13: C.dx = num(v); break; case 23: C.dy = num(v); break;
          case 42: C.rot = num(v); break;
          case 43: C.tw = num(v); break;
          case 45: C.ls = num(v) || 1; break;
          case 171: C.att = int(v) || 1; break;
          case 341: C.bh = v; break;
          case 15: C.bx = num(v); break; case 25: C.by = num(v); break;
          case 16: C.bsx = num(v) || 1; break; case 26: C.bsy = num(v) || 1; break;
          case 46: C.brot = num(v); break;
        }
      }
      // propiedades fuera del contexto (AcDbMLeader)
      let ltype = 1, hasDog = true, arrowH = '', ctype = 0, arrowSz = 0;
      for (; i < P.length; i++) {
        const [c, raw] = P[i]; const v = String(raw).trim();
        if (c === 170) ltype = int(v); else if (c === 291) hasDog = int(v) !== 0; else if (c === 342) arrowH = v;
        else if (c === 172) ctype = int(v); else if (c === 42) arrowSz = num(v);
      }
      const ch = [];
      const asz = C.arrow || arrowSz * (C.scale || 1) || 2.5;
      const arrowName = arrowH && D.blockRecords.get(arrowH) ? D.blockRecords.get(arrowH).name.toUpperCase() : '';
      const noArrow = arrowName === '_NONE';
      for (const Ld of C.leaders) {
        const last = Ld.hasLast && Ld.last ? Ld.last : null;
        if (ltype !== 0) for (const ln of Ld.lines) {
          const vs = ln.slice(); if (last) vs.push(last);
          if (vs.length < 2) continue;
          const { p, bb } = ptsPath(vs, false);
          ch.push(strokeNode(p, bb, pr));
          if (!noArrow) {
            const [x0, y0] = vs[0]; let k = 1; while (k < vs.length - 1 && Math.hypot(vs[k][0] - x0, vs[k][1] - y0) < 1e-12) k++;
            const [x1, y1] = vs[k]; const D0 = Math.hypot(x1 - x0, y1 - y0);
            if (D0 > 1e-12 && asz > 0) {
              const ux = (x1 - x0) / D0, uy = (y1 - y0) / D0, w = asz / 6;
              const a = new Path2D(); a.moveTo(x0, y0); a.lineTo(x0 + ux * asz - uy * w, y0 + uy * asz + ux * w); a.lineTo(x0 + ux * asz + uy * w, y0 + uy * asz - ux * w); a.closePath();
              ch.push(fillNode(a, [Math.min(x0, x0 + ux * asz) - w, Math.min(y0, y0 + uy * asz) - w, Math.max(x0, x0 + ux * asz) + w, Math.max(y0, y0 + uy * asz) + w], pr, 'nonzero'));
            }
          }
        }
        if (last && hasDog && Ld.dl > 0 && ltype !== 0) { // quiebre (dogleg)
          const dn = Math.hypot(Ld.dog[0], Ld.dog[1]) || 1;
          const x1 = last[0] + Ld.dog[0] / dn * Ld.dl, y1 = last[1] + Ld.dog[1] / dn * Ld.dl;
          const { p, bb } = ptsPath([last, [x1, y1]], false);
          ch.push(strokeNode(p, bb, pr));
        }
      }
      if (C.hasText && ctype !== 1 && String(C.text || '').trim()) {
        const st = [...D.styles.values()].find((s) => s.rec && (s.rec.get(5, '') || '').trim() === C.style);
        const pairs = [[1, C.text], [10, String(C.tx)], [20, String(C.ty)], [40, String(C.h || 2.5)], [41, String(C.tw || 0)], [71, String(C.att)], [44, String(C.ls)]];
        if (Math.hypot(C.dx, C.dy) > 1e-12) pairs.push([11, String(C.dx)], [21, String(C.dy)]); else pairs.push([50, String(C.rot / DEG)]);
        if (st) pairs.push([7, st.name]);
        const tn = mtextNode(new Rec('MTEXT', pairs), pr);
        if (tn) ch.push(tn);
      }
      if (C.hasBlock && C.bh) {
        const br = D.blockRecords.get(C.bh); const b = br && D.blocks.get(br.name.toUpperCase());
        if (b) {
          const c = Math.cos(C.brot), s = Math.sin(C.brot);
          const m = [c * C.bsx, s * C.bsx, -s * C.bsy, c * C.bsy, 0, 0];
          m[4] = C.bx - (m[0] * b.base[0] + m[2] * b.base[1]); m[5] = C.by - (m[1] * b.base[0] + m[3] * b.base[1]);
          const bn = blockRef(b, m, { layer: pr.lname, color: pr.color, ltype: pr.ltype, lw: Math.round(pr.lwmm * 100) }, pr);
          if (bn) ch.push(bn);
        }
      }
      if (!ch.length) return null;
      const bb = EMPTY(); ch.forEach((q) => bbUnion(bb, q.bb));
      if (!isFinite(bb[0])) return null;
      return { k: 'g', layer: pr.layer.idx, ch, bb };
    }

    function polyNode(vs, closed, pr, constW) {
      if (vs.length < 2) return null;
      const p = new Path2D(); const bb = EMPTY(); const ext = (x, y) => bbUnion(bb, [x, y, x, y]);
      p.moveTo(vs[0][0], vs[0][1]); ext(vs[0][0], vs[0][1]);
      for (let k = 1; k < vs.length; k++) bulgeArc(p, vs[k - 1][0], vs[k - 1][1], vs[k][0], vs[k][1], vs[k - 1][2], ext);
      if (closed) { const l = vs[vs.length - 1]; bulgeArc(p, l[0], l[1], vs[0][0], vs[0][1], l[2], ext); p.closePath(); }
      const n = strokeNode(p, bb, pr);
      if (constW > 0) { n.lw = constW; n.lwmm = null; n.cap = 'butt'; }
      return n;
    }

    function insertNode(e, pr, ctx, attribs) {
      const name = (e.get(2, '') || '').trim();
      const b = D.blocks.get(name.toUpperCase());
      if (!b) { stats.warnings.add('Bloque no encontrado: ' + name); return null; }
      let x = e.num(10), y = e.num(20);
      let sx = e.num(41, 1) || 1, sy = e.num(42, 1) || 1;
      let rot = e.num(50, 0) * DEG;
      if (mirrored(e)) { x = -x; sx = -sx; rot = -rot; }
      const cols = Math.max(1, e.int(70, 1)), rows = Math.max(1, e.int(71, 1));
      const dc = e.num(44, 0), dr = e.num(45, 0);
      const c = Math.cos(rot), s = Math.sin(rot);
      const inner = { layer: pr.lname, color: pr.color, ltype: pr.ltype, lw: Math.round(pr.lwmm * 100) };
      const parts = [];
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const ox = i * dc, oy = j * dr;
        const tx = x + c * ox - s * oy, ty = y + s * ox + c * oy;
        // T(pos) · R(rot) · S(sx,sy) · T(-base)
        const m = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
        m[4] = tx - (m[0] * b.base[0] + m[2] * b.base[1]);
        m[5] = ty - (m[1] * b.base[0] + m[3] * b.base[1]);
        const n = blockRef(b, m, inner, pr);
        if (n) parts.push(n);
      }
      // atributos (vienen después del INSERT, en coordenadas del dibujo)
      for (const a of attribs || []) {
        if (a.type !== 'ATTRIB' || (a.int(70) & 1)) continue;
        const apr = props(a, ctx);
        if (apr.hidden) continue;
        const tn = textNode(a, apr, true);
        if (tn) parts.push(tn);
      }
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      const bb = EMPTY(); parts.forEach((q) => bbUnion(bb, q.bb));
      return { k: 'g', ch: parts, bb, local: true };
    }

    /** Planos georreferenciados (coordenadas de millones): se dibujan restando un origen local, porque el
     *  navegador guarda los trazos en precisión simple y las líneas finas se pierden. El archivo no cambia. */
    function convertShifted(e, ctx, seq) {
      if (e.deleted) return null;
      const [ox, oy] = ctx.shift;
      const T = Edit.similarity({ dx: -ox, dy: -oy });
      const p = Edit.transformPairs(e.type, e.p, T, mirrored(e));
      if (p) {
        const se = new Rec(e.type, p);
        const sq = seq && seq.map((q) => { const qp = Edit.transformPairs(q.type, q.p, T, q.type === 'VERTEX' ? mirrored(e) : mirrored(q)); return qp ? new Rec(q.type, qp) : q; });
        return convert(se, ctx, sq);
      }
      // tipos que todavía no se transforman (cotas, tablas…): se dibujan tal cual y se corren como grupo
      const n = convert(e, ctx, seq);
      if (!n) return n;
      return { k: 'g', m: [1, 0, 0, 1, -ox, -oy], local: true, ch: [n], bb: [n.bb[0] - ox, n.bb[1] - oy, n.bb[2] - ox, n.bb[3] - oy] };
    }

    function blockRef(b, m, inner, pr) {
      const key = b.name + '|' + inner.layer + '|' + inner.color + '|' + inner.ltype + '|' + inner.lw;
      let content = blockCache.get(key);
      if (content === undefined) {
        blockCache.set(key, null); // evita recursión infinita
        content = entitiesNode(b.ents, inner);
        blockCache.set(key, content);
      }
      if (!content) return null;
      return { k: 'g', m, local: true, ch: [content], bb: bbXform(content.bb, m) };
    }

    /** ATTDEF fuera de un bloque: se dibuja como un TEXT con la etiqueta (como AutoCAD). */
    function attdefComoTexto(e) {
      const p = []; let sub = 0;
      for (const [c, v] of e.p) {
        if (c === 100) { const t = String(v).trim(); if (t === 'AcDbAttributeDefinition') sub = 9; continue; }
        if (sub === 9) { if (c === 74) p.push([73, v]); continue; }
        if (c === 1) continue;
        p.push([c, v]);
      }
      p.push([1, (e.get(2, '') || '').trim() || '?']);
      return new Rec('TEXT', p);
    }

    /** Lista de entidades → grupo (agrupa POLYLINE+VERTEX y INSERT+ATTRIB con su SEQEND). */
    function entitiesNode(ents, ctx, top) {
      const ch = []; const bb = EMPTY();
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        let seq = null;
        if ((e.type === 'POLYLINE') || (e.type === 'INSERT' && e.int(66, 0) === 1)) {
          seq = [];
          while (i + 1 < ents.length && ents[i + 1].type !== 'SEQEND' && (ents[i + 1].type === 'VERTEX' || ents[i + 1].type === 'ATTRIB')) seq.push(ents[++i]);
          if (i + 1 < ents.length && ents[i + 1].type === 'SEQEND') i++;
        }
        let n = null;
        try {
          const ee = top && e.type === 'ATTDEF' && !e.deleted ? attdefComoTexto(e) : e; // definición de atributo suelta: se ve su etiqueta
          if (ctx.shift) n = convertShifted(ee, ctx, seq);
          else n = convert(ee, ctx, seq);
        } catch (err) { stats.warnings.add(`${e.type}: ${err.message}`); }
        if (n && n.bb && isFinite(n.bb[0])) { if (top) { n.rec = e; e.node = n; } ch.push(n); bbUnion(bb, n.bb); }
      }
      if (!ch.length) return null;
      return { k: 'g', ch, bb, local: true };
    }

    return { entitiesNode, blockRef, imageJobs, stats, layerIdx, clearCache: () => blockCache.clear() };
  }

  function loadImage(url) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => createImageBitmap(b));
  }

  // ---------------------------------------------------------------- documento: páginas (Modelo + planchas)
  const UNITS = { 0: null, 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 14: 'dm' };

  async function open(u8, { resolveURL } = {}) {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 22));
    if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF binario: todavía no se soporta. Guárdelo como DXF ASCII.');
    const D = parse(decode(u8));
    const B = build(D, { resolveURL });

    // Registros de bloque por nombre (para el dueño "330" de las entidades nuevas)
    const brecByName = new Map([...D.blockRecords.values()].map((r) => [r.name.toUpperCase(), r]));
    const modelBlock = D.blocks.get('*MODEL_SPACE');
    const modelOwner = (brecByName.get('*MODEL_SPACE') || {}).handle || '';
    // Las listas se recalculan en cada armado (el usuario puede borrar/agregar)
    const modelEnts = () => [...(modelBlock ? modelBlock.ents : []), ...D.entities.filter((e) => e.int(67, 0) !== 1)];
    const paperEntsActive = () => D.entities.filter((e) => e.int(67, 0) === 1);

    // Origen local del modelo si las coordenadas son muy grandes (planos georreferenciados)
    const origin = (() => {
      if (typeof Edit === 'undefined') return null;
      const xs = [], ys = [];
      const ex = D.header.$EXTMIN;
      if (ex && Number.isFinite(num(ex[10])) && Math.abs(num(ex[10])) < 1e12) { xs.push(num(ex[10])); ys.push(num(ex[20])); }
      for (const e of modelEnts().slice(0, 200)) { const x = e.num(10, NaN), y = e.num(20, NaN); if (Number.isFinite(x) && Number.isFinite(y) && (x || y)) { xs.push(x); ys.push(y); } }
      if (!xs.length) return null;
      xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
      const mx = xs[xs.length >> 1], my = ys[ys.length >> 1];
      if (Math.abs(mx) < 1e5 && Math.abs(my) < 1e5) return null;
      return [Math.round(mx / 1000) * 1000, Math.round(my / 1000) * 1000];
    })();
    let modelNode = null;
    const getModel = () => {
      if (modelNode !== null) return modelNode;
      const inner = B.entitiesNode(modelEnts(), origin ? { shift: origin } : {}, true);
      if (!inner) return (modelNode = false);
      if (!origin) return (modelNode = inner);
      const [ox, oy] = origin;
      modelNode = { k: 'g', m: [1, 0, 0, 1, ox, oy], local: true, ch: [inner], bb: [inner.bb[0] + ox, inner.bb[1] + oy, inner.bb[2] + ox, inner.bb[3] + oy], inner };
      return modelNode;
    };

    const pages = [];
    const finish = async (root, page) => {
      await Promise.all(B.imageJobs.splice(0));
      const layerNames = {}; for (const l of D.layers.values()) layerNames[l.idx] = l.name; // se recalcula: las capas se pueden crear o renombrar
      root.layers = layerNames;
      root.noPlot = new Set([...D.layers.values()].filter((l) => l.plot === false || l.name.toUpperCase() === 'DEFPOINTS').map((l) => l.idx)); // no salen en PDF/DWF
      root.stats = { items: B.stats.entities, warnings: [...B.stats.warnings, ...Object.entries(B.stats.skipped).map(([k, v]) => `${v} ${k} sin soporte todavía`)] };
      return root;
    };

    // Modelo
    pages.push({
      title: 'Modelo', units: UNITS[D.insunits] || null, background: '#ffffff', width: 0, height: 0,
      edit: { space: 'model', container: D.entities, owner: modelOwner, insertLine: D.entitiesEndLine, paper: false },
      build: async function () {
        const mn = getModel();
        if (!this.frame) { // el marco se fija la primera vez: editar no mueve la vista
          const lmn = D.header.$LIMMIN, lmx = D.header.$LIMMAX; // dibujo vacío (plano nuevo): el marco son los límites
          const bb = mn ? mn.bb : (lmn && lmx && num(lmx[10]) > num(lmn[10]) ? [num(lmn[10]), num(lmn[20]), num(lmx[10]), num(lmx[20])] : [0, 0, 100, 100]);
          const pad = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.02 || 1;
          this.frame = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
          this.frameVacio = !mn;
        } else if (mn && isFinite(mn.bb[0]) && this.frameVacio) { // plano vacío: el marco pasa a ser lo dibujado (coordenadas reales, Magna)
          const b = mn.bb, pad = Math.max(b[2] - b[0], b[3] - b[1]) * 0.02 || 1;
          this.frame = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]; this.frameVacio = false;
        } else if (mn && isFinite(mn.bb[0])) { // lo dibujado fuera del marco lo amplía (el visor compensa para que la vista no se mueva)
          const f = this.frame, b = mn.bb;
          if (b[0] < f[0] || b[1] < f[1] || b[2] > f[2] || b[3] > f[3]) this.frame = [Math.min(f[0], b[0]), Math.min(f[1], b[1]), Math.max(f[2], b[2]), Math.max(f[3], b[3])];
        }
        const [x0, y0, x1, y1] = this.frame;
        this.width = x1 - x0; this.height = y1 - y0;
        const m = [1, 0, 0, -1, -x0, y1];
        this.rootM = m;
        this.editNode = mn ? (mn.inner || mn) : null;
        this.editOrigin = origin || [0, 0]; // las cajas y trazos de editNode van restando este origen
        const root = { k: 'g', m, local: true, ch: mn ? [mn] : [], bb: [0, 0, this.width, this.height] };
        if (mn) bbUnion(root.bb, bbXform(mn.bb, m));
        return finish(root, this);
      },
    });

    // Planchas (presentaciones), en orden de pestaña. Se pueden volver a armar (crear, borrar, renombrar u ordenar planchas).
    const layerByHandle = () => { const m = new Map(); for (const l of D.layers.values()) if (l.rec) m.set(String(l.rec.get(5, '') || '').trim().toUpperCase(), l.idx); return m; };
    /** Matriz modelo (WCS) → papel de una ventana, o null. Centro de la vista en DCS (origen = punto objetivo, vista en planta). */
    function vpMatrix(v) {
      const cx = v.num(10), cy = v.num(20), w = v.num(40), h = v.num(41), vh = v.num(45);
      if (!(w > 0 && h > 0 && vh > 0)) return null;
      const plan = Math.abs(v.num(16, 0)) < 1e-9 && Math.abs(v.num(26, 0)) < 1e-9;
      const twist = v.num(51, 0) * DEG;
      // R2-fix: el centro de la vista (12, 22) está en DCS: con giro (51) hay que desgirarlo antes de sumarle el punto
      // objetivo (17, 27). Antes se sumaba sin girar y las ventanas giradas de terceros (D-PHI-042) salían vacías.
      let dx = v.num(12), dy = v.num(22);
      if (twist && plan) { const c = Math.cos(-twist), s = Math.sin(-twist); [dx, dy] = [c * dx - s * dy, s * dx + c * dy]; }
      const vcx = dx + (plan ? v.num(17, 0) : 0), vcy = dy + (plan ? v.num(27, 0) : 0);
      const k = h / vh;
      let m = [k, 0, 0, k, cx - k * vcx, cy - k * vcy];
      if (twist) { const c = Math.cos(twist), s = Math.sin(twist); m = mul([c, s, -s, c, cx - (c * cx - s * cy), cy - (s * cx + c * cy)], m); }
      return { m, k, rect: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], center: [vcx, vcy], twist: v.num(51, 0) };
    }
    /** Contorno de recorte de una ventana (VPCLIP): fábrica de Path2D del objeto del papel con ese handle, o null. */
    function contornoClip(ents, h) {
      if (!h || h === '0') return null;
      const i = ents.findIndex((e) => !e.deleted && String(e.get(5, '') || '').trim().toUpperCase() === h); if (i < 0) return null;
      const e = ents[i]; const no = () => {};
      if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        let vs = [];
        if (e.type === 'LWPOLYLINE') { let cur = null; for (const [c, v] of e.p) { if (c === 10) { cur = [num(v), 0, 0]; vs.push(cur); } else if (c === 20 && cur) cur[1] = num(v); else if (c === 42 && cur) cur[2] = num(v); } }
        else for (let j = i + 1; j < ents.length && ents[j].type === 'VERTEX'; j++) { const q = ents[j]; if (!(q.int(70, 0) & 16)) vs.push([q.num(10), q.num(20), q.num(42, 0)]); }
        if (vs.length < 3 && !(vs.length === 2 && vs.some((q) => q[2]))) return null;
        return () => { const p = new Path2D(); p.moveTo(vs[0][0], vs[0][1]); for (let k = 1; k < vs.length; k++) bulgeArc(p, vs[k - 1][0], vs[k - 1][1], vs[k][0], vs[k][1], vs[k - 1][2], no); const l = vs[vs.length - 1]; bulgeArc(p, l[0], l[1], vs[0][0], vs[0][1], l[2], no); p.closePath(); return p; };
      }
      if (e.type === 'CIRCLE') { const x = e.num(10), y = e.num(20), r = e.num(40); if (!(r > 0)) return null; return () => { const p = new Path2D(); p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2, false); p.closePath(); return p; }; }
      if (e.type === 'ELLIPSE') {
        const x = e.num(10), y = e.num(20), mx = e.num(11), my = e.num(21), ra = e.num(40, 1); const R = Math.hypot(mx, my); if (!(R > 0)) return null;
        return () => { const p = new Path2D(); p.ellipse(x, y, R, R * ra, Math.atan2(my, mx), 0, Math.PI * 2); p.closePath(); return p; };
      }
      if (e.type === 'SPLINE') { // aproximado por sus puntos de ajuste o de control
        const P = []; let cur = null; const cod = e.p.some(([c]) => c === 11) ? 11 : 10;
        for (const [c, v] of e.p) { if (c === cod) { cur = [num(v), 0]; P.push(cur); } else if (c === cod + 10 && cur) cur[1] = num(v); }
        if (P.length < 3) return null;
        return () => { const p = new Path2D(); p.moveTo(P[0][0], P[0][1]); for (const q of P.slice(1)) p.lineTo(q[0], q[1]); p.closePath(); return p; };
      }
      return null;
    }
    const vpOn = (e) => e.type === 'VIEWPORT' && !e.deleted && e.int(69, 2) !== 1 && e.int(68, 1) !== 0 && !(e.int(90, 0) & 131072);
    function paperPages() {
      const out = [];
      const layouts = D.layouts.filter((l) => l.name && l.name.toUpperCase() !== 'MODEL').sort((a, b) => a.tab - b.tab);
      let firstPaper = true;
      for (const L of layouts) {
        const rec = D.blockRecords.get(L.brec);
        const bname = rec ? rec.name : null;
        const blk = bname ? D.blocks.get(bname.toUpperCase()) : null;
        // La plancha activa guarda sus entidades en ENTITIES (código 67=1); las demás, en su bloque *Paper_Space*
        const isActive = (bname && bname.toUpperCase() === '*PAPER_SPACE') || (!blk && firstPaper);
        const entsOf = () => (isActive ? [...(blk ? blk.ents : []), ...paperEntsActive()] : (blk ? blk.ents : []));
        firstPaper = false;
        let lim = L.lim;
        if (!lim && L.paperW > 0) lim = (L.rot % 2) ? [0, 0, L.paperH, L.paperW] : [0, 0, L.paperW, L.paperH];
        // mm de papel por unidad del espacio papel: tamaño de hoja (siempre en mm en el DXF) / ancho de los límites.
        let mmPerUnit = L.punits === 0 ? 25.4 : 1;
        if (lim && L.paperW > 0) {
          const wmm = Math.max(L.paperW, L.paperH), wun = Math.max(lim[2] - lim[0], lim[3] - lim[1]);
          const r = wmm / wun;
          if (r > 0.5 && r < 2) mmPerUnit = 1; else if (r > 15 && r < 40) mmPerUnit = 25.4; else if (r > 0) mmPerUnit = r;
        }
        out.push({
          title: L.name, layout: L, units: mmPerUnit === 1 ? 'mm' : mmPerUnit === 25.4 ? 'in' : 'mm', unitMM: mmPerUnit, background: '#ffffff', width: 0, height: 0,
          edit: isActive
            ? { space: 'paper', container: D.entities, owner: L.brec, insertLine: D.entitiesEndLine, paper: true, layout: L.name }
            : { space: 'paper', container: blk ? blk.ents : [], owner: L.brec, insertLine: blk ? blk.endLine : D.entitiesEndLine, paper: false, layout: L.name, block: blk },
          ents: () => entsOf().filter((e) => !e.deleted),
          /** Plancha sin nada dibujado (solo la ventana general): no sale al exportar «todas». */
          vacia: () => !entsOf().some((e) => !e.deleted && e.type !== 'SEQEND' && (e.type !== 'VIEWPORT' || e.int(69, 2) !== 1)),
          build: async function () {
            const ents = entsOf();
            const drawable = ents.filter((e) => e.type !== 'VIEWPORT');
            const vps = ents.filter(vpOn);
            const content = B.entitiesNode(drawable, {}, true) || { k: 'g', ch: [], bb: EMPTY(), local: true };
            const ch = [];
            const lbh = layerByHandle();
            this.vpInfo = [];
            // ventanas al modelo (capas inutilizadas en cada ventana = VPLAYER, código 331)
            for (const v of vps) {
              const mn = getModel();
              const X = vpMatrix(v); if (!X) continue;
              const [x0, y0, x1, y1] = X.rect;
              const hl = new Set(); for (const hh of v.all(331)) { const i = lbh.get(String(hh).trim().toUpperCase()); if (i != null) hl.add(i); }
              this.vpInfo.push({ rec: v, ...X, frozen: hl, locked: (v.int(90, 0) & 16384) !== 0 });
              // R2-fix VPCLIP: ventana con recorte de polígono (90 & 65536 + 340 = handle del contorno en el papel)
              const poly = (v.int(90, 0) & 65536) ? contornoClip(ents, String(v.get(340, '') || '').trim().toUpperCase()) : null;
              // borde de la ventana: se ve en pantalla y se puede designar; no sale en PDF ni DWF
              const bp = poly ? poly() : new Path2D(); if (!poly) bp.rect(x0, y0, x1 - x0, y1 - y0);
              const border = { k: 'p', p: bp, stroke: '#7d8590', lwmm: 0, dash: null, layer: (D.layers.get((v.get(8, '0') || '0').trim()) || D.layers.get('0')).idx, bb: [x0, y0, x1, y1], screenOnly: true, rec: v };
              v.node = border; content.ch.push(border); bbUnion(content.bb, border.bb);
              if (!mn) continue;
              const clip = poly ? poly() : new Path2D(); if (!poly) clip.rect(x0, y0, x1 - x0, y1 - y0);
              ch.push({ k: 'g', clip: { p: clip }, local: true, bb: X.rect.slice(), hideLayers: hl.size ? hl : null, ch: [{ k: 'g', m: X.m, local: true, ch: [mn], bb: bbXform(mn.bb, X.m) }] });
            }
            if (content.ch.length) ch.push(content);
            if (!this.frame) {
              const bb = EMPTY(); ch.forEach((c) => bbUnion(bb, c.bb));
              this.frame = lim || (isFinite(bb[0]) ? bb : [0, 0, 420, 297]);
            }
            const pl = this.frame;
            this.width = pl[2] - pl[0]; this.height = pl[3] - pl[1];
            const m = [1, 0, 0, -1, -pl[0], pl[3]];
            this.rootM = m;
            this.editNode = content.ch.length ? content : null;
            this.editOrigin = [0, 0];
            const bb = EMPTY(); ch.forEach((c) => bbUnion(bb, c.bb));
            const root = { k: 'g', m, local: true, mm: mmPerUnit, ch, bb: bbXform(isFinite(bb[0]) ? bb : pl, m) };
            bbUnion(root.bb, [0, 0, this.width, this.height]);
            return finish(root, this);
          },
        });
      }
      return out;
    }
    pages.push(...paperPages());
    const firstFull = pages.findIndex((p, i) => i > 0 && !p.vacia());
    const doc = {
      kind: 'DXF ' + (D.acadver || ''), pages, startPage: firstFull > 0 ? firstFull : (pages.length > 1 && pages.length === 2 ? 1 : 0), dxf: D, encoding: lastEncoding,
      vpMatrix,
      /** Modelo armado (para trabajar dentro de una ventana): {node, inner, origin}. */
      modelo() { const mn = getModel(); return mn ? { node: mn, inner: mn.inner || mn, origin: origin || [0, 0] } : null; },
      /** Vuelve a leer las presentaciones y arma de nuevo la lista de hojas (el Modelo se conserva). */
      refreshPages() {
        deriveLayouts(D);
        const old = new Map(pages.slice(1).map((p) => [p.layout && p.layout.rec, p]));
        const nuevas = paperPages();
        for (const p of nuevas) { const o = old.get(p.layout.rec); if (o && o.frame && o.layout.paperW === p.layout.paperW && o.layout.paperH === p.layout.paperH && String(o.layout.lim) === String(p.layout.lim)) p.frame = o.frame; }
        pages.splice(1, pages.length - 1, ...nuevas);
        this.pagesDirty = false;
        return pages;
      },
      layerNames: () => [...D.layers.values()].map((l) => l.name),
      /** Tras editar: el modelo se vuelve a armar (los bloques no cambian y quedan en caché). */
      invalidate(full, op) { if (!(op && op.keepModel)) modelNode = null; if (full) B.clearCache(); if (op && op.layouts) this.pagesDirty = true; },
      /** Bloques que se pueden insertar (sin anónimos, referencias externas ni los de cotas). */
      blockNames: () => [...D.blocks.values()].filter((b) => !b.deleted && b.name && !b.name.startsWith('*') && !b.name.startsWith('_') && !(b.flags & 1) && !(b.flags & 4) && b.ents.some((e) => e.type !== 'ATTDEF'))
        .map((b) => b.name).sort((x, y) => x.localeCompare(y, 'es', { numeric: true })),
      /** Dibujo de un bloque en sus coordenadas (para vista previa y miniaturas). */
      blockNode(name) {
        const b = D.blocks.get(String(name).toUpperCase()); if (!b) return null;
        const n = B.entitiesNode(b.ents.filter((e) => e.type !== 'ATTDEF'), {});
        return n ? { node: n, base: b.base, name: b.name, attdefs: b.ents.filter((e) => e.type === 'ATTDEF') } : null;
      },
    };
    return doc;
  }

  return { open, parse, mtextPlain, decodeText, Rec, deriveTables, deriveLayouts };
})();
if (typeof module !== 'undefined') module.exports = DXF; else self.DXF = DXF;
