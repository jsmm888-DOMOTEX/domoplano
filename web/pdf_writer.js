// Domoplano — escritor PROPIO de PDF vectorial (una plancha por archivo, tamaño de hoja real).
// Código propio, escrito a partir de la especificación pública de PDF (ISO 32000-1). Sin librerías externas ni nada
// de Autodesk. Mismo recorrido de la escena que dwf_writer.js (el DXF se arma con el motor que lo dibuja en pantalla
// y un Path2D que anota los trazos), pero aquí casi todo es nativo del PDF:
//   líneas y polilíneas como trazos; arcos y círculos como curvas Bézier (vectoriales, no se rasteriza nada);
//   rellenos y sólidos con su regla (no-cero / par-impar); sombreados con patrón recortados al contorno con un
//   recorte del propio PDF; ventanas de plancha como recorte; tipos de línea como raya del PDF; grosor de línea por
//   entidad/capa en mm de papel; texto como TEXTO REAL (seleccionable y buscable) con Liberation Sans (licencia OFL)
//   incrustada solo con las letras usadas; imágenes PNG/JPEG (firma) sin pérdida; capas como capas del PDF (OCG).
// Opciones de color: 'color' (como en pantalla), 'mono' (todo negro, para EPM) o 'grises'.
const PDFWriter = (() => {
  'use strict';
  const PT = 72 / 25.4;                 // puntos PDF por mm
  const TWO_PI = Math.PI * 2;
  const G = typeof self !== 'undefined' ? self : globalThis;
  const IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function';

  // ------------------------------------------------------------------ Path2D que anota los trazos (igual que el DWF)
  const NativePath = typeof Path2D !== 'undefined' ? Path2D : null;
  const Base = NativePath || class {};
  class RecPath extends Base {
    constructor() { super(); this.ops = []; }
    moveTo(x, y) { if (NativePath) super.moveTo(x, y); this.ops.push(['M', x, y]); }
    lineTo(x, y) { if (NativePath) super.lineTo(x, y); this.ops.push(['L', x, y]); }
    closePath() { if (NativePath) super.closePath(); this.ops.push(['Z']); }
    rect(x, y, w, h) { if (NativePath) super.rect(x, y, w, h); this.ops.push(['R', x, y, w, h]); }
    arc(x, y, r, a0, a1, ccw) { if (NativePath) super.arc(x, y, r, a0, a1, ccw); this.ops.push(['E', x, y, r, r, 0, a0, a1, !!ccw]); }
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) { if (NativePath) super.ellipse(x, y, rx, ry, rot, a0, a1, ccw); this.ops.push(['E', x, y, rx, ry, rot, a0, a1, !!ccw]); }
    bezierCurveTo(a, b, c, d, x, y) { if (NativePath) super.bezierCurveTo(a, b, c, d, x, y); this.ops.push(['C', a, b, c, d, x, y]); }
    quadraticCurveTo(a, b, x, y) { if (NativePath) super.quadraticCurveTo(a, b, x, y); this.ops.push(['Q', a, b, x, y]); }
    addPath(p, m) { if (NativePath) super.addPath(p, m); if (p && p.ops) this.ops.push(...p.ops); }
  }
  async function withRecording(fn) {
    const prev = G.Path2D;
    G.Path2D = RecPath;
    try { return await fn(); } finally { G.Path2D = prev; }
  }

  // ------------------------------------------------------------------ utilidades
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const inv = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-30; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  function bbX(bb, m) {
    if (!m || !isFinite(bb[0])) return bb;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) {
      const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    return [x0, y0, x1, y1];
  }
  const overlap = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  const inside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
  function parseColor(c) {
    if (typeof c !== 'string') return [0, 0, 0];
    let m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) { const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
    m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
    m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
    if (m) return [+m[1], +m[2], +m[3]];
    return [0, 0, 0];
  }
  // número PDF corto (puntos: 3 decimales = 0,001 pt ≈ 0,0004 mm)
  const f3 = (v) => { const r = Math.round(v * 1000) / 1000; return (Object.is(r, -0) ? 0 : r).toString(); };
  const f2 = (v) => { const r = Math.round(v * 100) / 100; return (Object.is(r, -0) ? 0 : r).toString(); };
  const f6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return (Object.is(r, -0) ? 0 : r).toString(); };
  const enc = new TextEncoder();
  const latin1 = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
  // cadena PDF de texto (UTF-16BE con BOM si hace falta)
  function pdfText(s) {
    s = String(s);
    if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
    let h = 'FEFF'; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return '<' + h + '>';
  }
  const pdfName = (s) => '/' + String(s).replace(/[^A-Za-z0-9_.\-]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0').slice(-2));

  // ------------------------------------------------------------------ aplanar trazos (para recortar), en puntos PDF
  function flattenOps(ops, M, tol) {
    const subs = []; let cur = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const k = scaleOf(M);
    const push = (x, y) => { cur.p.push(M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]); lx = x; ly = y; };
    const start = (x, y) => { cur = { p: [], closed: false }; subs.push(cur); sx = x; sy = y; push(x, y); };
    for (const o of ops) {
      if (o[0] === 'M') start(o[1], o[2]);
      else if (o[0] === 'L') { if (!cur) start(o[1], o[2]); else push(o[1], o[2]); }
      else if (o[0] === 'Z') { if (cur) { push(sx, sy); cur.closed = true; cur = null; } }
      else if (o[0] === 'R') { const [, x, y, w, h] = o; start(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h); push(x, y); cur.closed = true; cur = null; }
      else if (o[0] === 'E') {
        const [, x, y, rx, ry, rot, a0, a1, ccw] = o; let d = a1 - a0;
        if (!ccw) { if (d >= TWO_PI) d = TWO_PI; else { d %= TWO_PI; if (d < 0) d += TWO_PI; } } else { if (-d >= TWO_PI) d = -TWO_PI; else { d %= TWO_PI; if (d > 0) d -= TWO_PI; } }
        const R = Math.max(Math.abs(rx), Math.abs(ry)) * k, step = R > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / R)) : Math.PI / 2;
        const n = Math.min(2000, Math.max(2, Math.ceil(Math.abs(d) / Math.max(step, 1e-3)))), c = Math.cos(rot), s = Math.sin(rot);
        for (let i = 0; i <= n; i++) { const a = a0 + d * i / n, ex = rx * Math.cos(a), ey = ry * Math.sin(a), px = x + c * ex - s * ey, py = y + s * ex + c * ey; if (i === 0 && !cur) start(px, py); else push(px, py); }
      } else if (o[0] === 'C' || o[0] === 'Q') {
        if (!cur) start(o[1], o[2]);
        const x0 = lx, y0 = ly, cub = o[0] === 'C';
        const [ax, ay, bx, by, ex, ey] = cub ? o.slice(1) : [o[1], o[2], o[1], o[2], o[3], o[4]];
        for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; push(cub ? u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex : u * u * x0 + 2 * u * t * ax + t * t * ex, cub ? u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey : u * u * y0 + 2 * u * t * ay + t * t * ey); }
      }
    }
    return subs;
  }
  // Línea de patrón de sombreado recortada por los contornos (regla par-impar), como en el escritor DWF.
  function clipSegToPolys(x0, y0, x1, y1, polys, out) {
    const ts = [0, 1];
    const dx = x1 - x0, dy = y1 - y0;
    for (const P of polys) {
      const n = P.length;
      for (let i = 0; i < n; i += 2) {
        const ax = P[i], ay = P[i + 1], bx = P[(i + 2) % n], by = P[(i + 3) % n];
        const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((ax - x0) * ey - (ay - y0) * ex) / den, u = ((ax - x0) * dy - (ay - y0) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
      }
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i++) {
      const a = ts[i], b = ts[i + 1];
      if (b - a < 1e-9) continue;
      const m = (a + b) / 2, mx = x0 + dx * m, my = y0 + dy * m;
      let c = false;
      for (const P of polys) {
        const n = P.length;
        for (let j = 0, k = n - 2; j < n; k = j, j += 2) {
          const yi = P[j + 1], yj = P[k + 1];
          if ((yi > my) !== (yj > my) && mx < (P[k] - P[j]) * (my - yi) / (yj - yi) + P[j]) c = !c;
        }
      }
      if (c) out.push([x0 + dx * a, y0 + dy * a, x0 + dx * b, y0 + dy * b]);
    }
  }

  // ------------------------------------------------------------------ compresión (zlib, la que usa el PDF)
  async function deflate(d) {
    if (IS_NODE) return new Uint8Array(require('zlib').deflateSync(d, { level: 9 }));
    if (typeof CompressionStream !== 'undefined') {
      const s = new Blob([d]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return null;
  }
  async function inflate(d) {
    if (IS_NODE) return new Uint8Array(require('zlib').inflateSync(d));
    const s = new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // ------------------------------------------------------------------ fuentes TrueType (Liberation Sans, OFL)
  const FONT_FILES = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf'];
  const FONT_NAMES = ['LiberationSans', 'LiberationSans-Bold', 'LiberationSans-Italic', 'LiberationSans-BoldItalic'];
  const fontCache = new Map();
  async function defaultLoadFont(file) {
    if (IS_NODE) return new Uint8Array(require('fs').readFileSync(require('path').join(__dirname, 'fuentes', file)));
    const r = await fetch('fuentes/' + file); if (!r.ok) throw new Error('fuente ' + file);
    return new Uint8Array(await r.arrayBuffer());
  }
  function parseTTF(d) {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const nt = v.getUint16(4); const tab = {};
    for (let i = 0; i < nt; i++) { const o = 12 + 16 * i; tab[String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3])] = { off: v.getUint32(o + 8), len: v.getUint32(o + 12) }; }
    const head = tab.head.off;
    const upem = v.getUint16(head + 18);
    const bbox = [v.getInt16(head + 36), v.getInt16(head + 38), v.getInt16(head + 40), v.getInt16(head + 42)];
    const locFmt = v.getInt16(head + 50);
    const numGlyphs = v.getUint16(tab.maxp.off + 4);
    const hh = tab.hhea.off, ascent = v.getInt16(hh + 4), descent = v.getInt16(hh + 6), nh = v.getUint16(hh + 34);
    const adv = new Uint16Array(numGlyphs);
    for (let g = 0; g < numGlyphs; g++) adv[g] = v.getUint16(tab.hmtx.off + 4 * Math.min(g, nh - 1));
    const loca = new Uint32Array(numGlyphs + 1);
    for (let g = 0; g <= numGlyphs; g++) loca[g] = locFmt ? v.getUint32(tab.loca.off + 4 * g) : 2 * v.getUint16(tab.loca.off + 2 * g);
    // cmap: formato 4 (BMP) o 12
    const cmap = new Map(); const cm = tab.cmap.off, n = v.getUint16(cm + 2); let sub = -1, sub12 = -1;
    for (let i = 0; i < n; i++) {
      const pid = v.getUint16(cm + 4 + 8 * i), eid = v.getUint16(cm + 6 + 8 * i), so = cm + v.getUint32(cm + 8 + 8 * i), fm = v.getUint16(so);
      if (fm === 12 && (pid === 3 || pid === 0)) sub12 = so; else if (fm === 4 && ((pid === 3 && eid === 1) || (pid === 0 && sub < 0))) sub = so;
    }
    if (sub12 >= 0) {
      const ng = v.getUint32(sub12 + 12);
      for (let i = 0; i < ng; i++) { const o = sub12 + 16 + 12 * i, s0 = v.getUint32(o), s1 = v.getUint32(o + 4), g0 = v.getUint32(o + 8); for (let c = s0; c <= s1 && c - s0 < 65536; c++) cmap.set(c, g0 + c - s0); }
    } else if (sub >= 0) {
      const segX2 = v.getUint16(sub + 6), ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const e = v.getUint16(ends + s), st = v.getUint16(starts + s), dl = v.getInt16(deltas + s), ro = v.getUint16(ranges + s);
        for (let c = st; c <= e && c !== 0xFFFF; c++) {
          let g;
          if (!ro) g = (c + dl) & 0xFFFF;
          else { const gi = v.getUint16(ranges + s + ro + 2 * (c - st)); g = gi ? (gi + dl) & 0xFFFF : 0; }
          if (g) cmap.set(c, g);
        }
      }
    }
    let capH = Math.round(ascent * 0.7), italic = 0;
    if (tab['OS/2'] && tab['OS/2'].len >= 90 && v.getUint16(tab['OS/2'].off) >= 2) capH = v.getInt16(tab['OS/2'].off + 88);
    if (tab.post) italic = v.getInt32(tab.post.off + 4) / 65536;
    return { d, v, tab, upem, bbox, numGlyphs, ascent, descent, adv, loca, cmap, capH, italic };
  }
  async function getFont(i, loadFont) {
    const key = FONT_FILES[i];
    if (!fontCache.has(key)) fontCache.set(key, (async () => parseTTF(await (loadFont || defaultLoadFont)(key)))());
    return fontCache.get(key);
  }

  // Subconjunto: se conservan los números de glifo (CIDToGIDMap identidad) y se vacían los glifos no usados.
  function subsetTTF(F, used) {
    const { d, v, tab, loca, numGlyphs } = F;
    const keep = new Set([0, ...used]);
    const gl = tab.glyf.off;
    const stack = [...keep];
    while (stack.length) { // glifos compuestos: incluir sus piezas
      const g = stack.pop(); const s = loca[g], e = loca[g + 1];
      if (e <= s) continue;
      if (v.getInt16(gl + s) >= 0) continue;
      let p = gl + s + 10, more = true;
      while (more) {
        const flags = v.getUint16(p), cg = v.getUint16(p + 2);
        if (!keep.has(cg)) { keep.add(cg); stack.push(cg); }
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        more = !!(flags & 0x20);
      }
    }
    const parts = []; const newLoca = new Uint32Array(numGlyphs + 1); let off = 0;
    for (let g = 0; g < numGlyphs; g++) {
      newLoca[g] = off;
      if (keep.has(g) && loca[g + 1] > loca[g]) { let b = d.subarray(gl + loca[g], gl + loca[g + 1]); parts.push(b); off += b.length; if (off & 3) { const pad = 4 - (off & 3); parts.push(new Uint8Array(pad)); off += pad; } }
    }
    newLoca[numGlyphs] = off;
    const glyf = new Uint8Array(off); { let p = 0; for (const b of parts) { glyf.set(b, p); p += b.length; } }
    const locaB = new Uint8Array(4 * (numGlyphs + 1)); const lv = new DataView(locaB.buffer);
    for (let g = 0; g <= numGlyphs; g++) lv.setUint32(4 * g, newLoca[g]);
    const headB = d.slice(tab.head.off, tab.head.off + tab.head.len); new DataView(headB.buffer).setInt16(50, 1); new DataView(headB.buffer).setUint32(8, 0);
    const T = { head: headB, hhea: null, maxp: null, hmtx: null, cvt: null, fpgm: null, prep: null, loca: locaB, glyf };
    const copy = (n) => (tab[n] ? d.slice(tab[n].off, tab[n].off + tab[n].len) : null);
    T.hhea = copy('hhea'); T.maxp = copy('maxp'); T.hmtx = copy('hmtx'); T['cvt '] = copy('cvt '); T.fpgm = copy('fpgm'); T.prep = copy('prep');
    delete T.cvt;
    const names = Object.keys(T).filter((k) => T[k]).sort();
    const n = names.length; let pos = 12 + 16 * n;
    const dir = new Uint8Array(pos); const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x00010000); dv.setUint16(4, n);
    let es = 0; while ((1 << (es + 1)) <= n) es++;
    dv.setUint16(6, 16 << es); dv.setUint16(8, es); dv.setUint16(10, n * 16 - (16 << es));
    const body = [];
    names.forEach((k, i) => {
      const b = T[k]; let sum = 0;
      const padded = new Uint8Array((b.length + 3) & ~3); padded.set(b);
      const pv = new DataView(padded.buffer); for (let j = 0; j < padded.length; j += 4) sum = (sum + pv.getUint32(j)) >>> 0;
      const o = 12 + 16 * i;
      for (let j = 0; j < 4; j++) dir[o + j] = k.charCodeAt(j);
      dv.setUint32(o + 4, sum); dv.setUint32(o + 8, pos); dv.setUint32(o + 12, b.length);
      body.push(padded); pos += padded.length;
    });
    const out = new Uint8Array(pos); out.set(dir); let p = dir.length; for (const b of body) { out.set(b, p); p += b.length; }
    return out;
  }

  // ------------------------------------------------------------------ imágenes (PNG decodificado → RGB + alfa; JPEG tal cual)
  async function imageXObject(data) {
    if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) {
      for (let p = 2; p + 9 < data.length;) {
        if (data[p] !== 0xff) { p++; continue; }
        const mk = data[p + 1], len = (data[p + 2] << 8) | data[p + 3];
        if (mk >= 0xc0 && mk <= 0xc3) {
          const h = (data[p + 5] << 8) | data[p + 6], w = (data[p + 7] << 8) | data[p + 8], nc = data[p + 9];
          return { w, h, filter: 'DCTDecode', cs: nc === 1 ? 'DeviceGray' : nc === 4 ? 'DeviceCMYK' : 'DeviceRGB', bpc: 8, data, decode: nc === 4 ? '[1 0 1 0 1 0 1 0]' : null };
        }
        p += 2 + len;
      }
      throw new Error('JPEG sin cabecera de tamaño');
    }
    if (!(data.length > 33 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)) throw new Error('formato no soportado (solo PNG o JPEG)');
    return pngDecode(data, true);
  }
  /** PNG → píxeles sin comprimir {w, h, gray, col (1 o 3 muestras de 8 bits por píxel), alpha (o null)}. */
  async function pngPixels(data) {
    const r = await pngDecode(data, false);
    return { w: r.w, h: r.h, gray: r.gray, col: r.col, alpha: r.alpha };
  }
  async function pngDecode(data, forPDF) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let p = 8, w = 0, h = 0, bd = 8, ct = 0, il = 0, plte = null, trns = null; const idat = [];
    while (p + 8 <= data.length) {
      const len = dv.getUint32(p), type = String.fromCharCode(data[p + 4], data[p + 5], data[p + 6], data[p + 7]), c = data.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); bd = data[p + 16]; ct = data[p + 17]; il = data[p + 20]; }
      else if (type === 'PLTE') plte = c; else if (type === 'tRNS') trns = c; else if (type === 'IDAT') idat.push(c); else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (il) throw new Error('PNG entrelazado no soportado');
    let tot = 0; for (const c of idat) tot += c.length; const z = new Uint8Array(tot); { let q = 0; for (const c of idat) { z.set(c, q); q += c.length; } }
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    // PNG sin transparencia (gris o color, 8 bits): sus datos comprimidos van TAL CUAL (el PDF entiende los filtros PNG)
    if (forPDF && !trns && (ct === 0 || ct === 2) && bd === 8) return { w, h, filter: 'FlateDecode', cs: ct ? 'DeviceRGB' : 'DeviceGray', bpc: 8, data: z, parms: `<< /Predictor 15 /Colors ${ch} /BitsPerComponent 8 /Columns ${w} >>` };
    const raw = await inflate(z);
    const bpp = Math.max(1, (ch * bd) >> 3), stride = (w * ch * bd + 7) >> 3;
    const px = new Uint8Array(stride * h); let prev = new Uint8Array(stride);
    for (let y = 0, ip = 0; y < h; y++) { // quitar filtros PNG
      const ft = raw[ip++]; const row = px.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < stride; x++) {
        const r = raw[ip++], a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
        let v;
        switch (ft) { case 1: v = r + a; break; case 2: v = r + b; break; case 3: v = r + ((a + b) >> 1); break;
          case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: v = r; }
        row[x] = v & 255;
      }
      prev = row;
    }
    const sample = (y, x, k) => { // muestra de 8 bits
      if (bd === 16) return px[y * stride + 2 * (x * ch + k)];
      if (bd === 8) return px[y * stride + x * ch + k];
      const bit = (x * ch + k) * bd, byte = px[y * stride + (bit >> 3)], v = (byte >> (8 - bd - (bit & 7))) & ((1 << bd) - 1);
      return ct === 3 ? v : Math.round(v * 255 / ((1 << bd) - 1));
    };
    const gray = ct === 0 || ct === 4;
    const nc = gray ? 1 : 3;
    const col = new Uint8Array(w * h * nc); let alpha = null, anyA = false;
    if (ct === 4 || ct === 6 || trns) alpha = new Uint8Array(w * h).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (ct === 3) {
        const k = sample(y, x, 0); col[3 * i] = plte[3 * k]; col[3 * i + 1] = plte[3 * k + 1]; col[3 * i + 2] = plte[3 * k + 2];
        if (alpha && trns && k < trns.length) { alpha[i] = trns[k]; if (trns[k] < 255) anyA = true; }
      } else if (gray) {
        const g = sample(y, x, 0); col[i] = g;
        if (ct === 4) { alpha[i] = sample(y, x, 1); if (alpha[i] < 255) anyA = true; }
        else if (trns && bd <= 8 && g === Math.round(((trns[0] << 8) | trns[1]) * 255 / ((1 << bd) - 1))) { alpha[i] = 0; anyA = true; }
      } else {
        for (let k = 0; k < 3; k++) col[3 * i + k] = sample(y, x, k);
        if (ct === 6) { alpha[i] = sample(y, x, 3); if (alpha[i] < 255) anyA = true; }
        else if (trns && bd === 8 && col[3 * i] === trns[1] && col[3 * i + 1] === trns[3] && col[3 * i + 2] === trns[5]) { alpha[i] = 0; anyA = true; }
      }
    }
    if (!forPDF) return { w, h, gray, col, alpha: anyA ? alpha : null };
    return { w, h, filter: 'FlateDecode', cs: gray ? 'DeviceGray' : 'DeviceRGB', bpc: 8, data: await deflate(col), smask: anyA ? await deflate(alpha) : null };
  }

  // ------------------------------------------------------------------ medir texto (el mismo lienzo que usa dxf.js)
  let mctx = null;
  function measure(str, font) {
    if (!mctx) { const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(4, 4) : document.createElement('canvas'); mctx = c.getContext('2d'); }
    mctx.font = font; return mctx.measureText(str).width;
  }

  // ------------------------------------------------------------------ tamaño de hoja (nombre para el informe)
  const HOJAS = [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['Carta', 215.9, 279.4], ['Oficio', 215.9, 355.6], ['Pliego 70×100', 700, 1000], ['ANSI D', 558.8, 863.6], ['ANSI E', 863.6, 1117.6]];
  function nombreHoja(wmm, hmm) {
    const a = Math.min(wmm, hmm), b = Math.max(wmm, hmm);
    for (const [n, x, y] of HOJAS) if (Math.abs(a - x) <= 2 && Math.abs(b - y) <= 2) return `${n} ${wmm > hmm ? 'horizontal' : 'vertical'}`;
    return `${Math.round(wmm)} × ${Math.round(hmm)} mm`;
  }

  // ------------------------------------------------------------------ escena → contenido PDF
  /**
   * page: {width, height, unitMM}; root: escena armada con RecPath. o: {color: 'color'|'mono'|'grises', grosorMinimoMM,
   * capas (true), images: Map src→bytes, loadFont}. Devuelve {content, fonts, images, layers, stats, Wpt, Hpt}.
   */
  async function writeContent(page, root, o = {}) {
    const unitMM = page.unitMM || 1;
    const k0 = unitMM * PT;
    const Wpt = page.width * k0, Hpt = page.height * k0;
    const T0 = [k0, 0, 0, -k0, 0, Hpt];        // página (unidades, y hacia abajo) → PDF (puntos, y hacia arriba)
    const modo = o.color || 'color';
    const minLW = (o.grosorMinimoMM ?? 0.05) * PT;
    const capas = o.capas !== false;
    const layerNames = root.layers || {};
    const noPlot = root.noPlot || new Set();   // capas «no trazar» y Defpoints: no salen (como al trazar en AutoCAD)
    const images = o.images || new Map();
    const stats = { lines: 0, paths: 0, arcs: 0, fills: 0, texts: 0, images: 0, hatches: 0, hatchSegs: 0, clips: 0, culled: 0, glyphsMissing: 0, noPlot: 0, warnings: new Set() };
    const parts = []; let buf = '';
    const emit = (s) => { buf += s; if (buf.length > 65536) { parts.push(buf); buf = ''; } };

    // ---- estado (se guarda/restaura con q/Q)
    let st = { fill: null, stroke: null, lw: null, dash: null, cap: null, join: null };
    const stack = [];
    let openLayer = null;
    const layerUse = new Map();          // índice de capa → nombre del recurso /OCn
    const closeLayer = () => { if (openLayer != null) { emit('EMC\n'); openLayer = null; } };
    const setLayer = (idx) => {
      if (!capas) return;
      const key = idx == null ? null : idx;
      if (openLayer === key) return;
      closeLayer();
      if (key == null) return;
      if (!layerUse.has(key)) layerUse.set(key, 'OC' + layerUse.size);
      emit(`/OC /${layerUse.get(key)} BDC\n`); openLayer = key;
    };
    const push = () => { closeLayer(); stack.push(st); st = { ...st }; emit('q\n'); };
    const pop = () => { closeLayer(); st = stack.pop(); emit('Q\n'); };

    const colorOf = (rgb, op) => {
      let [r, g, b] = rgb;
      if (modo === 'mono') { r = g = b = 0; }
      else if (modo === 'grises') { const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b); r = g = b = Math.min(l, 200); }
      if (op < 1) { r = Math.round(255 - (255 - r) * op); g = Math.round(255 - (255 - g) * op); b = Math.round(255 - (255 - b) * op); }
      return [r, g, b];
    };
    const rgbStr = (c) => c.map((v) => f3(v / 255)).join(' ');
    const setFill = (rgb, op) => { const s = rgbStr(colorOf(rgb, op)); if (st.fill !== s) { st.fill = s; emit(s + ' rg\n'); } };
    const setFillRaw = (rgb) => { const s = rgbStr(rgb); if (st.fill !== s) { st.fill = s; emit(s + ' rg\n'); } };
    const setStroke = (rgb, op) => { const s = rgbStr(colorOf(rgb, op)); if (st.stroke !== s) { st.stroke = s; emit(s + ' RG\n'); } };
    const setLW = (v) => { const s = f3(Math.max(v, minLW)); if (st.lw !== s) { st.lw = s; emit(s + ' w\n'); } };
    const setDash = (pat) => { const s = pat ? '[' + pat.map(f3).join(' ') + '] 0' : '[] 0'; if (st.dash !== s) { st.dash = s; emit(s + ' d\n'); } };
    const setCap = (c) => { const v = c === 'butt' ? 0 : c === 'square' ? 2 : 1; if (st.cap !== v) { st.cap = v; emit(v + ' J\n'); } };
    const setJoin = (j) => { const v = j === 'miter' ? 0 : j === 'bevel' ? 2 : 1; if (st.join !== v) { st.join = v; emit(v + ' j\n'); } };

    // ---- trazos: ops (coordenadas locales) → operadores PDF en puntos
    const LIM = 14000;   // puntos; más allá se recorta (límite práctico de los lectores PDF ≈ 32 767)
    function pathOps(ops, M) {
      let s = '', cur = false, sx = 0, sy = 0, lx = 0, ly = 0, pend = null, big = false;
      const X = (x, y) => M[0] * x + M[2] * y + M[4], Y = (x, y) => M[1] * x + M[3] * y + M[5];
      const P = (x, y) => { const a = X(x, y), b = Y(x, y); if (a < -LIM || a > LIM || b < -LIM || b > LIM) big = true; return f2(a) + ' ' + f2(b); };
      const mv = (x, y) => { s += P(x, y) + ' m\n'; cur = true; sx = x; sy = y; lx = x; ly = y; pend = null; };
      const ln = (x, y) => { if (!cur) { if (pend) mv(pend[0], pend[1]); else { mv(x, y); return; } } s += P(x, y) + ' l\n'; lx = x; ly = y; };
      const cb = (a, b, c, d, x, y) => { s += P(a, b) + ' ' + P(c, d) + ' ' + P(x, y) + ' c\n'; lx = x; ly = y; };
      for (const o of ops) {
        switch (o[0]) {
          case 'M': mv(o[1], o[2]); break;
          case 'L': ln(o[1], o[2]); break;
          case 'Z': if (cur) { s += 'h\n'; cur = false; pend = [sx, sy]; lx = sx; ly = sy; } break;
          case 'R': { const [, x, y, w, h] = o; mv(x, y); ln(x + w, y); ln(x + w, y + h); ln(x, y + h); s += 'h\n'; cur = false; pend = [x, y]; break; }
          case 'E': {
            const [, x, y, rx, ry, rot, a0, a1, ccw] = o;
            let d = a1 - a0;
            if (!ccw) { if (d >= TWO_PI) d = TWO_PI; else { d %= TWO_PI; if (d < 0) d += TWO_PI; } }
            else { if (-d >= TWO_PI) d = -TWO_PI; else { d %= TWO_PI; if (d > 0) d -= TWO_PI; } }
            const c = Math.cos(rot), sn = Math.sin(rot);
            const pt = (a) => { const ex = rx * Math.cos(a), ey = ry * Math.sin(a); return [x + c * ex - sn * ey, y + sn * ex + c * ey]; };
            const dv = (a) => { const ex = -rx * Math.sin(a), ey = ry * Math.cos(a); return [c * ex - sn * ey, sn * ex + c * ey]; };
            const p0 = pt(a0);
            if (cur) { if (Math.abs(p0[0] - lx) + Math.abs(p0[1] - ly) > 1e-12 * (1 + Math.abs(lx) + Math.abs(ly))) ln(p0[0], p0[1]); }
            else if (pend) { mv(pend[0], pend[1]); ln(p0[0], p0[1]); }
            else mv(p0[0], p0[1]);
            const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2) - 1e-9));
            const da = d / n, al = 4 / 3 * Math.tan(da / 4);
            for (let i = 0; i < n; i++) {
              const ta = a0 + da * i, tb = ta + da, A = pt(ta), B = pt(tb), dA = dv(ta), dB = dv(tb);
              cb(A[0] + al * dA[0], A[1] + al * dA[1], B[0] - al * dB[0], B[1] - al * dB[1], B[0], B[1]);
            }
            break;
          }
          case 'C': if (!cur) { if (pend) mv(pend[0], pend[1]); else mv(o[1], o[2]); } cb(o[1], o[2], o[3], o[4], o[5], o[6]); break;
          case 'Q': {
            if (!cur) { if (pend) mv(pend[0], pend[1]); else mv(o[1], o[2]); }
            const [, qx, qy, x, y] = o;
            cb(lx + 2 / 3 * (qx - lx), ly + 2 / 3 * (qy - ly), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
            break;
          }
        }
      }
      return { s, big };
    }
    // Trazo demasiado grande (líneas del modelo que salen muy lejos de la ventana): se aplana y se recorta.
    function flattenClip(ops, M, rect, closedFill) {
      const subs = flattenOps(ops, M, 0.05).map((q) => q.p);
      let s = '';
      if (closedFill) { // Sutherland–Hodgman contra el rectángulo
        for (let P of subs) {
          for (const [ax, val, keepGreater] of [[0, rect[0], true], [0, rect[2], false], [1, rect[1], true], [1, rect[3], false]]) {
            const Q = []; const n = P.length / 2;
            for (let i = 0; i < n; i++) {
              const ax0 = P[2 * i], ay0 = P[2 * i + 1], j = (i + 1) % n, bx0 = P[2 * j], by0 = P[2 * j + 1];
              const va = ax ? ay0 : ax0, vb = ax ? by0 : bx0;
              const ina = keepGreater ? va >= val : va <= val, inb = keepGreater ? vb >= val : vb <= val;
              if (ina) Q.push(ax0, ay0);
              if (ina !== inb) { const t = (val - va) / (vb - va); Q.push(ax0 + (bx0 - ax0) * t, ay0 + (by0 - ay0) * t); }
            }
            P = Q; if (!P.length) break;
          }
          if (P.length >= 6) { s += f3(P[0]) + ' ' + f3(P[1]) + ' m\n'; for (let i = 2; i < P.length; i += 2) s += f3(P[i]) + ' ' + f3(P[i + 1]) + ' l\n'; s += 'h\n'; }
        }
        return s;
      }
      for (const p of subs) { // Liang–Barsky por tramo
        let open = false;
        for (let i = 2; i < p.length; i += 2) {
          const x0 = p[i - 2], y0 = p[i - 1], dx = p[i] - x0, dy = p[i + 1] - y0;
          let t0 = 0, t1 = 1, ok = true;
          for (const [pp, q] of [[-dx, x0 - rect[0]], [dx, rect[2] - x0], [-dy, y0 - rect[1]], [dy, rect[3] - y0]]) {
            if (pp === 0) { if (q < 0) { ok = false; break; } }
            else { const t = q / pp; if (pp < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; } }
          }
          if (!ok) { open = false; continue; }
          if (!open || t0 > 0) s += f3(x0 + dx * t0) + ' ' + f3(y0 + dy * t0) + ' m\n';
          s += f3(x0 + dx * t1) + ' ' + f3(y0 + dy * t1) + ' l\n';
          open = t1 >= 1;
        }
      }
      return s;
    }
    const BIGRECT = [-2000, -2000, Wpt + 2000, Hpt + 2000];
    const pathStr = (ops, M, fill, clipRect) => {
      const r = pathOps(ops, M);
      if (!r.big) return r.s;
      const cr = clipRect ? [Math.max(clipRect[0], BIGRECT[0]) - 10, Math.max(clipRect[1], BIGRECT[1]) - 10, Math.min(clipRect[2], BIGRECT[2]) + 10, Math.min(clipRect[3], BIGRECT[3]) + 10] : BIGRECT;
      return flattenClip(ops, M, cr, fill);
    };

    // ---- fuentes usadas
    const fontsUsed = new Map();   // índice 0..3 → {F, glyphs:Map gid→unicode, res:'F0'}
    async function fontFor(bold, ital) {
      const i = (bold ? 1 : 0) + (ital ? 2 : 0);
      if (!fontsUsed.has(i)) {
        let F;
        try { F = await getFont(i, o.loadFont); } catch (e) { if (i) return fontFor(false, false); throw e; }
        fontsUsed.set(i, { i, F, glyphs: new Map(), res: 'F' + i });
      }
      return fontsUsed.get(i);
    }

    // ---- texto
    async function text(n, M, op) {
      const str = String(n.str || '').replace(/\t/g, '    ').replace(/[\r\n]/g, ' ');
      if (!str.trim()) return;
      const bold = n.weight === 'bold' || +n.weight >= 600, ital = n.style === 'italic' || n.style === 'oblique';
      const fu = await fontFor(bold, ital); const F = fu.F;
      const sx = n.sx || 1;
      const css = `${n.style || 'normal'} ${n.weight || 'normal'} ${n.size}px ${n.family}`;
      let hex = '', wl = 0;
      for (const ch of str) {
        const cp = ch.codePointAt(0);
        let g = F.cmap.get(cp);
        if (!g) { g = F.cmap.get(0x3F) || 0; stats.glyphsMissing++; stats.warnings.add('Letra sin glifo en Liberation Sans: U+' + cp.toString(16).toUpperCase().padStart(4, '0')); }
        else fu.glyphs.set(g, ch);
        if (!fu.glyphs.has(g)) fu.glyphs.set(g, '?');
        hex += g.toString(16).padStart(4, '0');
        wl += F.adv[g];
      }
      wl = wl / F.upem * n.size;
      let wo = 0;
      try { wo = measure(str, css); } catch (e) { /* sin medidor */ }
      if (!(wo > 0)) wo = wl;
      const off = n.align === 'center' ? wo * sx / 2 : n.align === 'right' ? wo * sx : 0;
      const hs = sx * (wl > 0 ? wo / wl : 1);
      const Tm = mul(M, [n.size * hs, 0, 0, -n.size, (n.x || 0) - off, n.y || 0]);
      if (!(Math.abs(Tm[0] * Tm[3] - Tm[1] * Tm[2]) > 1e-12)) return;
      setFill(parseColor(n.fill || '#000'), op);
      stats.texts++;
      emit(`BT /${fu.res} 1 Tf ${f6(Tm[0])} ${f6(Tm[1])} ${f6(Tm[2])} ${f6(Tm[3])} ${f3(Tm[4])} ${f3(Tm[5])} Tm <${hex}> Tj ET\n`);
    }

    // ---- imágenes
    const imgObjs = new Map();   // src → {res, x}
    async function image(n, M) {
      const data = n.src ? images.get(n.src) : null;
      if (!data) { stats.warnings.add('Imagen sin datos: ' + (n.src || '?')); return; }
      let im = imgObjs.get(n.src);
      if (!im) {
        try { im = { res: 'Im' + imgObjs.size, x: await imageXObject(data) }; }
        catch (e) { stats.warnings.add('Imagen ' + n.src + ': ' + e.message); imgObjs.set(n.src, { bad: true }); return; }
        imgObjs.set(n.src, im);
      }
      if (im.bad) return;
      const Mi = mul(M, [n.w, 0, 0, -n.h, n.x || 0, (n.y || 0) + n.h]);
      stats.images++;
      push();
      emit(`${f6(Mi[0])} ${f6(Mi[1])} ${f6(Mi[2])} ${f6(Mi[3])} ${f3(Mi[4])} ${f3(Mi[5])} cm /${im.res} Do\n`);
      pop();
    }

    // ---- recorrido (mismas reglas que Scene.render y el escritor DWF)
    async function walk(n, M, s) {
      if (n.bb && !overlap(n.bb, s.view)) { stats.culled++; return; }
      if (n.markup || n.screenOnly) return; // marcas y bordes de ventana: solo en pantalla
      if (n.layer != null && s.hl && s.hl.has(n.layer)) return; // capa inutilizada en esta ventana (VPLAYER)
      const layer = n.layer != null ? n.layer : s.layer;
      if (n.k !== 'g' && layer != null && noPlot.has(layer)) { stats.noPlot++; return; }
      switch (n.k) {
        case 'g': {
          let M2 = M, view = s.view, mm = s.mm, op = s.op, clipRect = s.clipRect;
          if (n.m) {
            M2 = mul(M, n.m);
            const sc = Math.sqrt(Math.abs(n.m[0] * n.m[3] - n.m[1] * n.m[2]));
            if (n.local) view = bbX(view, inv(n.m));
            if (mm != null) mm *= sc;
          }
          if (n.mm !== undefined) mm = n.mm;
          if (n.op != null && n.op < 1) op *= n.op;
          const gbb = n.bb ? bbX(n.bb, M) : null;
          if (clipRect && gbb && !overlap(gbb, clipRect)) { stats.culled++; return; }
          let clipped = false;
          if (n.clip && n.clip.p && n.clip.p.ops) {
            const cbb = bbX(boundsOf(n.clip.p.ops), M2);
            const nr = clipRect ? [Math.max(clipRect[0], cbb[0]), Math.max(clipRect[1], cbb[1]), Math.min(clipRect[2], cbb[2]), Math.min(clipRect[3], cbb[3])] : cbb;
            if (nr[0] > nr[2] || nr[1] > nr[3]) { stats.culled++; return; }
            { const lb = boundsOf(n.clip.p.ops); view = [Math.max(view[0], lb[0]), Math.max(view[1], lb[1]), Math.min(view[2], lb[2]), Math.min(view[3], lb[3])]; }
            push(); stats.clips++;
            emit(pathOps(n.clip.p.ops, M2).s + (n.clip.rule === 'evenodd' ? 'W* n\n' : 'W n\n'));
            clipRect = nr; clipped = true;
          }
          const s2 = { view, mm, op, clipRect, layer, hl: n.hideLayers ? new Set([...(s.hl || []), ...n.hideLayers]) : s.hl };
          for (const c of n.ch) await walk(c, M2, s2);
          if (clipped) pop();
          return;
        }
        case 'p': {
          if (!n.p || !n.p.ops || !n.p.ops.length) return;
          if (s.clipRect && n.bb) { const b = bbX(n.bb, M); if (!overlap(b, s.clipRect)) { stats.culled++; return; } }
          if (n.fill) {
            const ps = pathStr(n.p.ops, M, true, s.clipRect);
            // bg (WIPEOUT): tapa de fondo, siempre blanca — también en 'mono' y 'grises' (colorOf la volvería negra)
            if (ps) { setLayer(layer); if (n.bg) setFillRaw([255, 255, 255]); else setFill(typeof n.fill === 'string' ? parseColor(n.fill) : [128, 128, 128], s.op); emit(ps + (n.rule === 'evenodd' ? 'f*\n' : 'f\n')); stats.fills++; }
          }
          if (n.stroke) {
            let lw = n.lw || 0;
            if (n.lwmm != null) lw = s.mm != null ? n.lwmm / s.mm : 0;
            const k = scaleOf(M);
            const ps = pathStr(n.p.ops, M, false, s.clipRect);
            if (!ps) return;
            setLayer(layer);
            setStroke(typeof n.stroke === 'string' ? parseColor(n.stroke) : [128, 128, 128], s.op);
            setLW(lw * k); setCap(n.cap || 'round'); setJoin(n.join || 'round');
            setDash(n.dash && n.dash.length ? n.dash.map((d) => d * k) : null);
            emit(ps + 'S\n');
            if (n.p.ops.some((q) => q[0] === 'E')) stats.arcs++; else if (n.p.ops.length <= 2) stats.lines++; else stats.paths++;
          }
          return;
        }
        case 'h': {
          if (!n.p || !n.lines || !n.p.ops || !n.lines.ops) return;
          // las líneas del patrón se recortan aquí al contorno (más liviano que mandar todo el patrón con un recorte)
          const polys = flattenOps(n.p.ops, M, 0.02).map((q) => q.p).filter((p) => p.length >= 6);
          const segs = flattenOps(n.lines.ops, M, 0.02);
          let out = [];
          for (const q of segs) for (let i = 2; i < q.p.length; i += 2) clipSegToPolys(q.p[i - 2], q.p[i - 1], q.p[i], q.p[i + 1], polys, out);
          if (s.clipRect) out = out.filter((p) => overlap([Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])], s.clipRect));
          if (!out.length) return;
          setLayer(layer);
          setStroke(parseColor(n.color || '#000'), s.op); setLW(0); setCap('butt'); setDash(null);
          let ls = '';
          for (const p of out) ls += f2(p[0]) + ' ' + f2(p[1]) + ' m ' + f2(p[2]) + ' ' + f2(p[3]) + ' l\n';
          emit(ls + 'S\n');
          stats.hatches++; stats.hatchSegs += out.length;
          return;
        }
        case 't': {
          const Mt = n.m ? mul(M, n.m) : M;
          setLayer(layer);
          await text(n, Mt, s.op);
          return;
        }
        case 'i': {
          setLayer(layer);
          await image(n, n.m ? mul(M, n.m) : M);
          return;
        }
      }
    }
    function boundsOf(ops) {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      const e = (x, y) => { if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; };
      for (const o of ops) {
        if (o[0] === 'R') { e(o[1], o[2]); e(o[1] + o[3], o[2] + o[4]); }
        else if (o[0] === 'E') { const r = Math.max(Math.abs(o[3]), Math.abs(o[4])); e(o[1] - r, o[2] - r); e(o[1] + r, o[2] + r); }
        else for (let i = 1; i + 1 < o.length; i += 2) if (typeof o[i] === 'number') e(o[i], o[i + 1]);
      }
      return b;
    }

    emit('1 J 1 j\n'); st.cap = 1; st.join = 1;
    await walk(root, T0, { view: [0, 0, page.width, page.height], mm: null, op: 1, clipRect: null, layer: null });
    closeLayer();
    parts.push(buf);
    const layers = [...layerUse.entries()].map(([idx, res]) => ({ res, name: String(layerNames[idx] ?? ('Capa ' + idx)) }));
    stats.warnings = [...stats.warnings];
    return { content: parts.join(''), fonts: fontsUsed, images: imgObjs, layers, stats, Wpt, Hpt };
  }

  // ------------------------------------------------------------------ armar el archivo PDF
  async function buildPDF(cIn, o = {}) {
    const cs = Array.isArray(cIn) ? cIn : [cIn];   // una página por contenido (varias planchas = un PDF de varias páginas)
    const objs = [];                         // objs[i] = Uint8Array del objeto (i+1)
    const reserve = () => { objs.push(null); return objs.length; };
    const set = (id, s) => { objs[id - 1] = typeof s === 'string' ? enc.encode(s) : s; };
    const concat = (arr) => { let n = 0; for (const a of arr) n += a.length; const out = new Uint8Array(n); let p = 0; for (const a of arr) { out.set(a, p); p += a.length; } return out; };
    async function stream(id, dict, data, compress = true) {
      let bytes = typeof data === 'string' ? latin1(data) : data, filt = '';
      if (compress) { const z = await deflate(bytes); if (z && z.length < bytes.length) { bytes = z; filt = ' /Filter /FlateDecode'; } }
      set(id, concat([enc.encode(`<< ${dict}${filt} /Length ${bytes.length} >>\nstream\n`), bytes, enc.encode('\nendstream')]));
    }
    const catalog = reserve(), pages = reserve(), info = reserve();
    const ocByName = new Map();              // capas del PDF compartidas entre páginas (por nombre)
    const pageIds = [];
    for (const c of cs) {
    const pageId = reserve(), contentId = reserve();
    pageIds.push(pageId);

    // fuentes
    const fontRes = [];
    for (const fu of c.fonts.values()) {
      const F = fu.F, sc = 1000 / F.upem;
      const tag = 'DMP' + String.fromCharCode(65 + fu.i, 65 + (fu.glyphs.size % 26), 65 + ((fu.glyphs.size >> 3) % 26)) + 'A';
      const base = tag + '+' + FONT_NAMES[fu.i];
      const ff = reserve(), fd = reserve(), cid = reserve(), tu = reserve(), t0 = reserve();
      const sub = subsetTTF(F, [...fu.glyphs.keys()]);
      const z = await deflate(sub);
      set(ff, concat([enc.encode(`<< /Length1 ${sub.length}${z ? ' /Filter /FlateDecode' : ''} /Length ${(z || sub).length} >>\nstream\n`), z || sub, enc.encode('\nendstream')]));
      const flags = 32 | (F.italic ? 64 : 0);
      set(fd, `<< /Type /FontDescriptor /FontName /${base} /Flags ${flags} /FontBBox [${F.bbox.map((v) => Math.round(v * sc)).join(' ')}] /ItalicAngle ${f3(F.italic)} /Ascent ${Math.round(F.ascent * sc)} /Descent ${Math.round(F.descent * sc)} /CapHeight ${Math.round(F.capH * sc)} /StemV ${fu.i & 1 ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      const gids = [...fu.glyphs.keys()].sort((a, b) => a - b);
      const W = gids.map((g) => `${g} [${Math.round(F.adv[g] * sc)}]`).join(' ');
      set(cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /DW 0 /W [${W}] /CIDToGIDMap /Identity >>`);
      let cm = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let i = 0; i < gids.length; i += 100) {
        const ch = gids.slice(i, i + 100);
        cm += `${ch.length} beginbfchar\n` + ch.map((g) => { const u = fu.glyphs.get(g); let h = ''; for (let j = 0; j < u.length; j++) h += u.charCodeAt(j).toString(16).padStart(4, '0'); return `<${g.toString(16).padStart(4, '0')}> <${h}>`; }).join('\n') + '\nendbfchar\n';
      }
      cm += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      await stream(tu, '', cm);
      set(t0, `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
      fontRes.push(`/${fu.res} ${t0} 0 R`);
    }
    // imágenes
    const imgRes = [];
    for (const im of c.images.values()) {
      if (im.bad) continue;
      const x = im.x, id = reserve();
      let sm = '';
      if (x.smask) { const sid = reserve(); set(sid, concat([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${x.w} /Height ${x.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${x.smask.length} >>\nstream\n`), x.smask, enc.encode('\nendstream')])); sm = ` /SMask ${sid} 0 R`; }
      set(id, concat([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${x.w} /Height ${x.h} /ColorSpace /${x.cs} /BitsPerComponent ${x.bpc} /Filter /${x.filter}${x.parms ? ' /DecodeParms ' + x.parms : ''}${x.decode ? ' /Decode ' + x.decode : ''}${sm} /Interpolate true /Length ${x.data.length} >>\nstream\n`), x.data, enc.encode('\nendstream')]));
      imgRes.push(`/${im.res} ${id} 0 R`);
    }
    // capas (grupos de contenido opcional)
    const ocRes = [];
    for (const L of c.layers) {
      let id = ocByName.get(L.name);
      if (!id) { id = reserve(); set(id, `<< /Type /OCG /Name ${pdfText(L.name)} >>`); ocByName.set(L.name, id); }
      ocRes.push(`/${L.res} ${id} 0 R`);
    }

    await stream(contentId, '', c.content);
    const res = [`/ProcSet [/PDF /Text /ImageC /ImageB]`];
    if (fontRes.length) res.push(`/Font << ${fontRes.join(' ')} >>`);
    if (imgRes.length) res.push(`/XObject << ${imgRes.join(' ')} >>`);
    if (ocRes.length) res.push(`/Properties << ${ocRes.join(' ')} >>`);
    set(pageId, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${f3(c.Wpt)} ${f3(c.Hpt)}] /Resources << ${res.join(' ')} >> /Contents ${contentId} 0 R >>`);
    }
    set(pages, `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`);
    const ocIds = [...ocByName.values()];
    const order = [...ocByName.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true })).map((x) => x[1] + ' 0 R').join(' ');
    const oc = ocIds.length ? ` /OCProperties << /OCGs [${ocIds.map((i) => i + ' 0 R').join(' ')}] /D << /Order [${order}] /ON [${ocIds.map((i) => i + ' 0 R').join(' ')}] >> >> /PageMode /UseOC` : '';
    set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R${oc} >>`);
    const now = o.when || new Date();
    const p2 = (v) => String(v).padStart(2, '0');
    const tz = -now.getTimezoneOffset();
    const date = `D:${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}${tz === 0 ? 'Z' : (tz > 0 ? '+' : '-') + p2(Math.floor(Math.abs(tz) / 60)) + "'" + p2(Math.abs(tz) % 60) + "'"}`;
    const infoD = [['Title', o.title || 'Plano'], ['Author', o.author || ''], ['Subject', o.subject || ''], ['Creator', 'Domoplano (DOMOTEX)'], ['Producer', 'Domoplano — escritor PDF propio'], ['Keywords', o.keywords || '']]
      .filter(([, v]) => v !== '').map(([k, v]) => `/${k} ${pdfText(v)}`).join(' ');
    set(info, `<< ${infoD} /CreationDate (${date}) /ModDate (${date}) >>`);

    // salida con tabla xref
    const chunks = [latin1('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n')]; let off = chunks[0].length; const offs = [];
    objs.forEach((b, i) => {
      const h = enc.encode(`${i + 1} 0 obj\n`), t = enc.encode('\nendobj\n');
      offs.push(off); chunks.push(h, b, t); off += h.length + b.length + t.length;
    });
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const v of offs) x += String(v).padStart(10, '0') + ' 00000 n \n';
    const idh = [...crypto32(String(now.getTime()) + (o.title || ''))].map((v) => v.toString(16).padStart(8, '0')).join('');
    x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${idh}> <${idh}>] >>\nstartxref\n${off}\n%%EOF\n`;
    chunks.push(enc.encode(x));
    return concat(chunks);
  }
  function crypto32(s) { // identificador del archivo (no es seguridad): 4 sumas FNV
    const out = []; for (let k = 0; k < 4; k++) { let h = 2166136261 ^ k; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } out.push(h >>> 0); }
    return out;
  }

  // ------------------------------------------------------------------ de DXF a PDF (una plancha por archivo)
  /**
   * u8: bytes del DXF. o: {plancha (nombre o índice), resolveURL, loadBytes(src)→Uint8Array, loadFont(file)→Uint8Array,
   *   color: 'color'|'mono'|'grises', grosorMinimoMM, capas, title, author}. Devuelve {bytes, page, stats, hoja}.
   */
  async function fromDXF(u8, o = {}) {
    if (typeof DXF === 'undefined') throw new Error('Falta el lector DXF.');
    let doc, page, root;
    if (Array.isArray(o.planchas) && o.planchas.length > 1) { // varias planchas → un PDF de varias páginas
      const list = [];
      await withRecording(async () => {
        doc = await DXF.open(u8, { resolveURL: o.resolveURL });
        const papers = doc.pages.filter((p) => p.title !== 'Modelo' && p.title !== 'Model');
        for (const pl of o.planchas) {
          const pg = typeof pl === 'number' ? papers[pl] : papers.find((p) => p.title.toUpperCase() === String(pl).toUpperCase());
          if (!pg) throw new Error(`No existe la plancha «${pl}». Planchas: ${papers.map((p) => p.title).join(', ')}`);
          list.push({ page: pg, root: await pg.build() });
        }
      });
      return fromScenes(list, o);
    }
    if (Array.isArray(o.planchas) && o.planchas.length === 1) o = { ...o, plancha: o.planchas[0] };
    await withRecording(async () => {
      doc = await DXF.open(u8, { resolveURL: o.resolveURL });
      const papers = doc.pages.filter((p) => p.title !== 'Modelo' && p.title !== 'Model');
      if (o.plancha != null && o.plancha !== '') {
        page = typeof o.plancha === 'number' ? papers[o.plancha] : papers.find((p) => p.title.toUpperCase() === String(o.plancha).toUpperCase());
        if (!page) throw new Error(`No existe la plancha «${o.plancha}». Planchas: ${papers.map((p) => p.title).join(', ')}`);
      } else page = papers.find((p) => !p.vacia || !p.vacia()) || papers[0] || doc.pages[0];
      root = await page.build();
    });
    return fromScene(page, root, o);
  }

  /** Escena ya armada con RecPath → PDF. */
  async function fromScene(page, root, o = {}) {
    const r = await fromScenes([{ page, root }], { ...o, subject: o.subject || 'Plancha «' + page.title + '»' });
    return { ...r, page };
  }
  /** Varias escenas (planchas) → un PDF con una página por plancha, cada una de su tamaño real. */
  async function fromScenes(list, o = {}) {
    const images = new Map();
    const srcs = new Set();
    for (const { root } of list) (function find(n) { if (!n) return; if (n.k === 'i' && n.src) srcs.add(n.src); if (n.ch) n.ch.forEach(find); })(root);
    const load = o.loadBytes || (async (src) => new Uint8Array(await (await fetch(src)).arrayBuffer()));
    for (const s of srcs) { try { images.set(s, await load(s)); } catch (e) { /* se avisa al escribir */ } }
    const cs = [];
    for (const { page, root } of list) cs.push(await writeContent(page, root, { ...o, images }));
    const titles = list.map((x) => x.page.title);
    const bytes = await buildPDF(cs, { title: o.title || titles[0], author: o.author, subject: o.subject || (titles.length > 1 ? 'Planchas: ' + titles.join(', ') : 'Plancha «' + titles[0] + '»'), when: o.when });
    // estadísticas sumadas
    const stats = {}; const warn = new Set();
    for (const c of cs) for (const [k, v] of Object.entries(c.stats)) { if (k === 'warnings') v.forEach((w) => warn.add(w)); else stats[k] = (stats[k] || 0) + v; }
    stats.warnings = [...warn];
    const hojas = list.map(({ page }) => { const u = page.unitMM || 1; return nombreHoja(page.width * u, page.height * u); });
    return { bytes, page: list[0].page, pages: list.map((x) => x.page), paginas: list.length, stats, hoja: [...new Set(hojas)].join(' · '), contentSize: cs.reduce((a, c) => a + c.content.length, 0) };
  }

  return { fromDXF, fromScene, fromScenes, writeContent, buildPDF, withRecording, RecPath, subsetTTF, parseTTF, imageXObject, pngPixels, nombreHoja, inflate, deflate };
})();
if (typeof module !== 'undefined') module.exports = PDFWriter; else self.PDFWriter = PDFWriter;
