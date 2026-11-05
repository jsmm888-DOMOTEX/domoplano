// Domoplano — escritor PROPIO de DWF clásico «DWF V06.00» (una hoja ePlot con su dibujo W2D), el formato que EPM abre.
// Código propio, escrito a partir de la especificación pública de DWF/W2D, de nuestro lector w2d.js y de la estructura de
// los DWF nuestros que EPM abrió y devolvió. No usa código, bibliotecas ni fuentes de Autodesk.
//
// Cómo funciona: el DXF se arma con el MISMO motor que lo dibuja en pantalla (dxf.js → escena), pero con un Path2D que
// además anota cada trazo (RecPath). Luego se recorre la escena y cada cosa se escribe en W2D binario:
//   líneas/polilíneas (coordenadas relativas de 16 bits cuando caben), círculos y arcos como arcos de verdad,
//   rellenos y sombreados sólidos como contornos, sombreados con patrón recortados al contorno, texto como TEXTO real
//   (fuente TrueType «Arial», misma medida que la libre Liberation Sans; nada de SHX), imágenes como PNG comprimido,
//   ventanas de plancha como «Viewport» con su escala (para medir en el visor), capas y grosor de línea por capa.
// Paquete: cabecera «(DWF V06.00)» + ZIP con manifest.xml, descriptor.xml y el .w2d — igual que los que aceptó EPM.
const DWFWriter = (() => {
  'use strict';
  const U = 1200 / 25.4;              // unidades W2D por mm de papel (igual que AutoCAD: 0,021166… mm por unidad)
  const TWO_PI = Math.PI * 2;
  const FLAT_MM = 0.03;               // tolerancia para aplanar curvas (mm de papel)
  const G = typeof self !== 'undefined' ? self : globalThis;

  // ------------------------------------------------------------------ Path2D que anota los trazos
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

  /** Ejecuta fn con Path2D = RecPath (para armar la escena «anotada»). */
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
  function uuid() {
    const b = new Uint8Array(16);
    if (G.crypto && G.crypto.getRandomValues) G.crypto.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (v) => { const r = Math.round(v * 1e9) / 1e9; return String(r); };

  // ------------------------------------------------------------------ aplanar trazos (coordenadas W2D, reales)
  function flatten(ops, M, tolW) {
    const subs = []; let cur = null, sx = 0, sy = 0, lx = 0, ly = 0, pend = null;
    const k = scaleOf(M) || 1;
    const push = (x, y) => { cur.p.push(M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]); lx = x; ly = y; };
    const start = (x, y) => { cur = { p: [], closed: false }; subs.push(cur); sx = x; sy = y; pend = null; push(x, y); };
    const lineTo = (x, y) => { if (!cur) { if (pend) start(pend[0], pend[1]); else { start(x, y); return; } } push(x, y); };
    for (const o of ops) {
      switch (o[0]) {
        case 'M': start(o[1], o[2]); break;
        case 'L': lineTo(o[1], o[2]); break;
        case 'Z': if (cur) { cur.closed = true; cur = null; pend = [sx, sy]; lx = sx; ly = sy; } break;
        case 'R': { const [, x, y, w, h] = o; start(x, y); push(x + w, y); push(x + w, y + h); push(x, y + h); cur.closed = true; cur = null; pend = [x, y]; break; }
        case 'E': {
          const [, x, y, rx, ry, rot, a0, a1, ccw] = o;
          let d = a1 - a0;
          if (!ccw) { if (d >= TWO_PI) d = TWO_PI; else { d %= TWO_PI; if (d < 0) d += TWO_PI; } }
          else { if (-d >= TWO_PI) d = -TWO_PI; else { d %= TWO_PI; if (d > 0) d -= TWO_PI; } }
          const R = Math.max(Math.abs(rx), Math.abs(ry)) * k;
          const step = R > tolW ? 2 * Math.acos(Math.max(-1, 1 - tolW / R)) : Math.PI / 2;
          const n = Math.min(720, Math.max(2, Math.ceil(Math.abs(d) / Math.max(step, 1e-3))));
          const c = Math.cos(rot), s = Math.sin(rot);
          for (let i = 0; i <= n; i++) {
            const a = a0 + d * (i / n), ex = rx * Math.cos(a), ey = ry * Math.sin(a);
            const px = x + c * ex - s * ey, py = y + s * ex + c * ey;
            if (i === 0) { if (cur) push(px, py); else if (pend) { start(pend[0], pend[1]); push(px, py); } else start(px, py); }
            else push(px, py);
          }
          break;
        }
        case 'C': case 'Q': {
          if (!cur) { if (pend) start(pend[0], pend[1]); else start(o[1], o[2]); }
          const x0 = lx, y0 = ly;
          const cub = o[0] === 'C';
          const [ax, ay, bx, by, ex, ey] = cub ? o.slice(1) : [o[1], o[2], o[1], o[2], o[3], o[4]];
          const len = (Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(ex - bx, ey - by)) * k;
          const n = Math.min(64, Math.max(2, Math.ceil(Math.sqrt(len / Math.max(tolW, 1e-6)))));
          for (let i = 1; i <= n; i++) {
            const t = i / n, u = 1 - t;
            let px, py;
            if (cub) { px = u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex; py = u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey; }
            else { px = u * u * x0 + 2 * u * t * ax + t * t * ex; py = u * u * y0 + 2 * u * t * ay + t * t * ey; }
            push(px, py);
          }
          break;
        }
      }
    }
    return subs;
  }

  // Raya y espacio (como setLineDash del lienzo): parte una polilínea en tramos visibles.
  function dashed(p, pat, out) {
    let total = 0; for (const v of pat) total += v;
    if (!(total > 0)) { out.push(p); return; }
    let idx = 0, left = pat[0], on = true, cur = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      let x0 = p[i - 2], y0 = p[i - 1]; const x1 = p[i], y1 = p[i + 1];
      let seg = Math.hypot(x1 - x0, y1 - y0);
      while (seg > 0) {
        if (left >= seg) { left -= seg; if (on) cur.push(x1, y1); seg = 0; }
        else {
          const t = left / seg, xm = x0 + (x1 - x0) * t, ym = y0 + (y1 - y0) * t;
          if (on) { cur.push(xm, ym); out.push(cur); cur = null; } else cur = [xm, ym];
          seg -= left; x0 = xm; y0 = ym;
          idx = (idx + 1) % pat.length; left = pat[idx]; on = !on;
          if (on && !cur) cur = [x0, y0];
        }
      }
    }
    if (on && cur && cur.length >= 4) out.push(cur);
  }

  // Recorta una polilínea a un rectángulo (Liang–Barsky por tramo); devuelve tramos dentro.
  function clipPoly(p, r, out) {
    let cur = null;
    for (let i = 2; i < p.length; i += 2) {
      let x0 = p[i - 2], y0 = p[i - 1], x1 = p[i], y1 = p[i + 1];
      const dx = x1 - x0, dy = y1 - y0;
      let t0 = 0, t1 = 1, ok = true;
      for (const [pp, q] of [[-dx, x0 - r[0]], [dx, r[2] - x0], [-dy, y0 - r[1]], [dy, r[3] - y0]]) {
        if (pp === 0) { if (q < 0) { ok = false; break; } }
        else { const t = q / pp; if (pp < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; } }
      }
      if (!ok) { if (cur) { out.push(cur); cur = null; } continue; }
      const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
      if (!cur || t0 > 0) { if (cur) out.push(cur); cur = [ax, ay]; }
      cur.push(bx, by);
      if (t1 < 1) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
  }

  // Líneas de patrón recortadas por contornos (regla par-impar).
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

  // ------------------------------------------------------------------ flujo binario W2D
  class Out {
    constructor() { this.b = new Uint8Array(1 << 16); this.n = 0; this.cx = 0; this.cy = 0; }
    need(k) { if (this.n + k > this.b.length) { let L = this.b.length * 2; while (L < this.n + k) L *= 2; const nb = new Uint8Array(L); nb.set(this.b.subarray(0, this.n)); this.b = nb; } }
    u8(v) { this.need(1); this.b[this.n++] = v & 255; }
    u16(v) { this.need(2); this.b[this.n++] = v & 255; this.b[this.n++] = (v >> 8) & 255; }
    i32(v) { this.need(4); v |= 0; this.b[this.n++] = v & 255; this.b[this.n++] = (v >> 8) & 255; this.b[this.n++] = (v >> 16) & 255; this.b[this.n++] = (v >>> 24) & 255; }
    bytes(a) { this.need(a.length); this.b.set(a, this.n); this.n += a.length; }
    ascii(s) { this.need(s.length); for (let i = 0; i < s.length; i++) this.b[this.n++] = s.charCodeAt(i) & 255; }
    count(c) { if (c > 0 && c <= 255) this.u8(c); else { this.u8(0); this.u16(c - 256); } }
    pt32(x, y) { this.i32(x - this.cx); this.i32(y - this.cy); this.cx = x; this.cy = y; }
    pt16(x, y) { this.u16(x - this.cx); this.u16(y - this.cy); this.cx = x; this.cy = y; }
    fits16(pts) { let cx = this.cx, cy = this.cy; for (let i = 0; i < pts.length; i += 2) { const dx = pts[i] - cx, dy = pts[i + 1] - cy; if (dx < -32768 || dx > 32767 || dy < -32768 || dy > 32767) return false; cx = pts[i]; cy = pts[i + 1]; } return true; }
    // texto: 'ansi' entre comillas simples, o {n UTF-16} si trae tildes/Ñ/°
    str(s) {
      if (/^[\x20-\x7e]*$/.test(s)) { this.ascii("'" + s.replace(/[\\']/g, (c) => '\\' + c) + "'"); return; }
      this.ascii('{'); this.i32(s.length); this.need(2 * s.length);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); this.b[this.n++] = c & 255; this.b[this.n++] = c >> 8; }
      this.ascii('}');
    }
    out() { return this.b.slice(0, this.n); }
  }

  // ------------------------------------------------------------------ medir texto (el mismo lienzo que usa dxf.js)
  let mctx = null;
  function measure(str, font) {
    if (!mctx) { const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(4, 4) : document.createElement('canvas'); mctx = c.getContext('2d'); }
    mctx.font = font; return mctx.measureText(str).width;
  }

  // ------------------------------------------------------------------ escena → W2D
  function pngSize(d) {
    if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47)
      return { fmt: 12, w: (d[16] << 24 | d[17] << 16 | d[18] << 8 | d[19]) >>> 0, h: (d[20] << 24 | d[21] << 16 | d[22] << 8 | d[23]) >>> 0 };
    if (d[0] === 0xff && d[1] === 0xd8) {
      for (let p = 2; p + 9 < d.length;) {
        if (d[p] !== 0xff) { p++; continue; }
        const mk = d[p + 1], len = (d[p + 2] << 8) | d[p + 3];
        if (mk >= 0xc0 && mk <= 0xc3) return { fmt: 8, h: (d[p + 5] << 8) | d[p + 6], w: (d[p + 7] << 8) | d[p + 8] };
        p += 2 + len;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ imágenes giradas: el W2D solo tiene imágenes
  // derechas (un rectángulo), así que la imagen girada se vuelve a muestrear ya girada (fondo transparente) y se
  // guarda como PNG comprimido propio. Mismo resultado que en pantalla y en el PDF.
  const esGirada = (M) => Math.abs(M[1]) > 1e-9 * Math.abs(M[0]) || Math.abs(M[2]) > 1e-9 * Math.abs(M[3]);
  async function zlibDeflate(d) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') return new Uint8Array(require('zlib').deflateSync(d, { level: 9 }));
    const s = new Blob([d]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  /** Píxeles RGBA de un PNG o JPEG: {w, h, rgba} o null. */
  async function decodeRGBA(data) {
    const PW = G.PDFWriter || (typeof require === 'function' && typeof process !== 'undefined' ? (() => { try { return require('./pdf_writer.js'); } catch (e) { return null; } })() : null);
    if (PW && PW.pngPixels && data[0] === 0x89 && data[1] === 0x50) {
      const p = await PW.pngPixels(data); const n = p.w * p.h; const rgba = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        if (p.gray) { rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = p.col[i]; } else { rgba[4 * i] = p.col[3 * i]; rgba[4 * i + 1] = p.col[3 * i + 1]; rgba[4 * i + 2] = p.col[3 * i + 2]; }
        rgba[4 * i + 3] = p.alpha ? p.alpha[i] : 255;
      }
      return { w: p.w, h: p.h, rgba };
    }
    if (typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') { // JPEG (o PNG) en la app
      const bmp = await createImageBitmap(new Blob([data]));
      const cv = new OffscreenCanvas(bmp.width, bmp.height); const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, rgba: new Uint8Array(cx.getImageData(0, 0, bmp.width, bmp.height).data.buffer) };
    }
    return null;
  }
  async function encodePNG(w, h, rgba) {
    let gray = true; for (let i = 0; i < w * h && gray; i++) if (rgba[4 * i] !== rgba[4 * i + 1] || rgba[4 * i] !== rgba[4 * i + 2]) gray = false;
    const ch = gray ? 2 : 4, stride = w * ch + 1, raw = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      raw[y * stride] = 0;
      for (let x = 0; x < w; x++) { const i = 4 * (y * w + x), o = y * stride + 1 + x * ch; if (gray) { raw[o] = rgba[i]; raw[o + 1] = rgba[i + 3]; } else { raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; raw[o + 3] = rgba[i + 3]; } }
    }
    const z = await zlibDeflate(raw);
    const chunk = (type, d) => { const t = new TextEncoder().encode(type), out = new Uint8Array(12 + d.length), dv = new DataView(out.buffer); dv.setUint32(0, d.length); out.set(t, 4); out.set(d, 8);
      const c = new Uint8Array(4 + d.length); c.set(t); c.set(d, 4); dv.setUint32(8 + d.length, crc32(c)); return out; };
    const ih = new Uint8Array(13); const dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = gray ? 4 : 6;
    const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let q = 0; for (const p of parts) { out.set(p, q); q += p.length; }
    return out;
  }
  /** Imagen n (coordenadas del nodo) con matriz M (nodo → W2D) girada: PNG nuevo ya girado y su caja en W2D. */
  async function rotarImagen(n, M, data) {
    const src = await decodeRGBA(data);
    if (!src) return { why: 'formato que no se puede volver a muestrear aquí' };
    const bb = bbX([n.x, n.y, n.x + n.w, n.y + n.h], M);
    const kx = src.w / n.w, ky = src.h / n.h;
    let ps = scaleOf(M) / Math.sqrt(kx * ky);              // tamaño de un píxel de la imagen, en unidades W2D
    const MAXP = 4000;
    ps = Math.max(ps, (bb[2] - bb[0]) / MAXP, (bb[3] - bb[1]) / MAXP);
    const ow = Math.max(1, Math.ceil((bb[2] - bb[0]) / ps)), oh = Math.max(1, Math.ceil((bb[3] - bb[1]) / ps));
    const Mi = inv(M), out = new Uint8Array(ow * oh * 4);
    for (let j = 0; j < oh; j++) {
      const Y = bb[3] - (j + 0.5) * ps;
      for (let i = 0; i < ow; i++) {
        const X = bb[0] + (i + 0.5) * ps;
        const nx = Mi[0] * X + Mi[2] * Y + Mi[4], ny = Mi[1] * X + Mi[3] * Y + Mi[5];
        const px = Math.floor((nx - n.x) * kx), py = Math.floor((ny - n.y) * ky);
        if (px < 0 || py < 0 || px >= src.w || py >= src.h) continue;
        const a = 4 * (py * src.w + px), b = 4 * (j * ow + i);
        out[b] = src.rgba[a]; out[b + 1] = src.rgba[a + 1]; out[b + 2] = src.rgba[a + 2]; out[b + 3] = src.rgba[a + 3];
      }
    }
    return { data: await encodePNG(ow, oh, out), bb: [bb[0], bb[3] - oh * ps, bb[0] + ow * ps, bb[3]] };
  }
  /** Recorre la escena como writeW2D y prepara las imágenes giradas. */
  async function prepararGiradas(page, root, images) {
    const unitMM = page.unitMM || 1, k0 = unitMM * U;
    const T0 = [k0, 0, 0, -k0, 0, page.height * k0];
    const out = new Map(), jobs = [];
    (function walk(n, M) {
      if (!n) return;
      if (n.k === 'g') { const M2 = n.m ? mul(M, n.m) : M; for (const c of n.ch) walk(c, M2); return; }
      if (n.k === 'i' && n.src && images.get(n.src)) {
        const Mi = n.m ? mul(M, n.m) : M;
        if (esGirada(Mi)) jobs.push(rotarImagen(n, Mi, images.get(n.src)).then((r) => out.set(n, r)).catch((e) => out.set(n, { why: e.message })));
      }
    })(root, T0);
    await Promise.all(jobs);
    return out;
  }

  /**
   * Escribe el W2D de una hoja ya armada (con RecPath).
   * page: {width, height, unitMM}, root: nodo raíz de la escena. images: Map src → bytes.
   */
  function writeW2D(page, root, o = {}) {
    const unitMM = page.unitMM || 1;
    const k0 = unitMM * U;
    const Wd = Math.round(page.width * k0), Hd = Math.round(page.height * k0);
    const T0 = [k0, 0, 0, -k0, 0, page.height * k0]; // página (mm, y hacia abajo) → W2D (y hacia arriba)
    const tolW = FLAT_MM * U;
    const w = new Out();
    const st = { color: null, lw: null, layer: null, vp: null, font: null };
    const layersDone = new Map();
    const layerNames = root.layers || {};
    const noPlot = root.noPlot || new Set();   // capas «no trazar» y Defpoints: no salen
    const rotadas = o.rotadas || new Map();    // imágenes giradas ya re-muestreadas (nodo → {data, bb})
    const images = o.images || new Map();
    const stats = { lines: 0, polylines: 0, arcs: 0, fills: 0, texts: 0, images: 0, hatchSegs: 0, culled: 0, warnings: new Set() };
    const fmt = (v) => (Math.round(v * 1e9) / 1e9).toString();

    // ---- cabecera (igual a la de los DWF que EPM aceptó)
    const title = (o.title || '').replace(/[\\']/g, ' ');
    w.ascii(`(W2D V06.01)(Title '${title}')`);
    w.ascii(`(Units 'mm' ((${fmt(U)} 0 0 0)(0 ${fmt(U)} 0 0)(0 0 1 0)(0 0 0 1)))`);   // unidades de papel: el visor mide en mm de la hoja
    w.ascii(`(NamedView 0,0 ${Wd},${Hd} INITIAL)(View 0,0 ${Wd},${Hd})`);
    const pw = page.width * unitMM, ph = page.height * unitMM;
    w.ascii(`(PlotInfo show 0 mm ${fmt(pw)} ${fmt(ph)} 0 0 ${fmt(pw)} ${fmt(ph)} ((${fmt(1 / U)} 0 0)(0 ${fmt(1 / U)} 0)(0 0 1)))(PlotOptimized 1)`);
    w.ascii('(LineStyle (LineJoin round) (LineStartCap round) (LineEndCap round))');

    // ---- estado de dibujo
    const setColor = (rgb, op) => {
      let [r, g, b] = rgb;
      if (op < 1) { r = Math.round(255 - (255 - r) * op); g = Math.round(255 - (255 - g) * op); b = Math.round(255 - (255 - b) * op); }
      const key = (r << 16) | (g << 8) | b;
      if (st.color === key) return;
      st.color = key; w.u8(0x03); w.u8(r); w.u8(g); w.u8(b); w.u8(255);
    };
    const setLW = (v) => { v = Math.max(0, Math.round(v)); if (st.lw === v) return; st.lw = v; w.u8(0x17); w.i32(v); };
    const setLayer = (idx) => {
      if (idx == null) return;
      const num = idx + 1;
      if (st.layer === num) return;
      st.layer = num;
      if (!layersDone.has(num)) {
        layersDone.set(num, true);
        const nm = String(layerNames[idx] ?? ('Capa ' + idx)).replace(/[\\']/g, ' ');
        w.ascii(`(Layer ${num} '${/^[\x20-\x7e]*$/.test(nm) ? nm : nm.normalize('NFD').replace(/[^\x20-\x7e]/g, '')}')`);
      } else { w.u8(0xAC); w.count(num); }
    };
    const setViewport = (vp) => {
      const key = vp ? vp.id : 'page';
      if (st.vp === key) return;
      if (!vp && st.vp === null) { st.vp = key; return; }
      st.vp = key;
      const c = vp ? vp.contour : [0, 0, Wd, 0, Wd, Hd, 0, Hd];
      let s = `(Viewport '' (Contour 1 4 ${[0, 2, 4, 6].map((i) => Math.round(c[i]) + ',' + Math.round(c[i + 1])).join(' ')})`;
      if (vp && vp.units) { const m = vp.units; s += ` (Units '' ((${fmt(m[0])} ${fmt(m[1])} 0 0)(${fmt(m[2])} ${fmt(m[3])} 0 0)(0 0 1 0)(${fmt(m[4])} ${fmt(m[5])} 0 1)))`; }
      w.ascii(s + ')');
    };

    // ---- primitivas
    const R = (v) => Math.round(v);
    function polyline(pf) { // pf: reales W2D
      const p = [];
      for (let i = 0; i < pf.length; i += 2) {
        const x = R(pf[i]), y = R(pf[i + 1]);
        if (p.length && p[p.length - 2] === x && p[p.length - 1] === y) continue;
        p.push(x, y);
      }
      if (p.length === 2) p.push(p[0], p[1]); // punto: línea de largo cero
      const n = p.length / 2;
      if (n === 2) {
        stats.lines++;
        if (w.fits16(p)) { w.u8(0x0C); w.pt16(p[0], p[1]); w.pt16(p[2], p[3]); }
        else { w.u8(0x6C); w.pt32(p[0], p[1]); w.pt32(p[2], p[3]); }
        return;
      }
      stats.polylines++;
      const MAX = 65000;
      for (let s = 0; s < n - 1; s += MAX - 1) {
        const q = p.slice(2 * s, 2 * Math.min(n, s + MAX));
        const c = q.length / 2;
        if (w.fits16(q)) { w.u8(0x10); w.count(c); for (let i = 0; i < q.length; i += 2) w.pt16(q[i], q[i + 1]); }
        else { w.u8(0x70); w.count(c); for (let i = 0; i < q.length; i += 2) w.pt32(q[i], q[i + 1]); }
      }
    }
    function contours(cs) {
      const list = [];
      for (const pf of cs) {
        const p = [];
        for (let i = 0; i < pf.length; i += 2) {
          const x = R(pf[i]), y = R(pf[i + 1]);
          if (p.length && p[p.length - 2] === x && p[p.length - 1] === y) continue;
          p.push(x, y);
        }
        if (p.length > 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p.length -= 2;
        if (p.length >= 6 && p.length / 2 <= 65000) list.push(p);
      }
      if (!list.length) return;
      stats.fills++;
      const all = [].concat(...list);
      const is16 = w.fits16(all);
      w.u8(is16 ? 0x0B : 0x6B); w.count(list.length);
      for (const p of list) w.count(p.length / 2);
      for (let i = 0; i < all.length; i += 2) (is16 ? w.pt16 : w.pt32).call(w, all[i], all[i + 1]);
    }
    const ang16 = (a) => { let v = Math.round(((a % TWO_PI) + TWO_PI) % TWO_PI / TWO_PI * 65536); return v & 0xFFFF; };

    // ¿El trazo es un solo círculo/arco y la transformación no deforma? → arco W2D de verdad
    function asArc(ops, M) {
      if (ops.length !== 1 && !(ops.length === 2 && ops[0][0] === 'M')) return null;
      const o = ops[ops.length - 1];
      if (o[0] !== 'E' || Math.abs(o[3] - o[4]) > 1e-9 * Math.abs(o[3])) return null;
      if (Math.abs(M[0] - M[3]) + Math.abs(M[1] + M[2]) > 1e-9 * (Math.abs(M[0]) + Math.abs(M[1])) &&
          Math.abs(M[0] + M[3]) + Math.abs(M[1] - M[2]) > 1e-9 * (Math.abs(M[0]) + Math.abs(M[1]))) return null;
      const [, x, y, r, , rot, a0, a1, ccw] = o;
      let d = a1 - a0;
      if (!ccw) { if (d >= TWO_PI) d = TWO_PI; else { d %= TWO_PI; if (d < 0) d += TWO_PI; } }
      else { if (-d >= TWO_PI) d = -TWO_PI; else { d %= TWO_PI; if (d > 0) d -= TWO_PI; } }
      let s = a0 + rot, e = s + d;
      if (d < 0) { const t = s; s = e; e = t; }
      const k = scaleOf(M), det = M[0] * M[3] - M[1] * M[2], th = Math.atan2(M[1], M[0]);
      let S, E;
      if (det > 0) { S = s + th; E = e + th; } else { S = th - e; E = th - s; }
      return { cx: M[0] * x + M[2] * y + M[4], cy: M[1] * x + M[3] * y + M[5], r: Math.abs(r) * k, full: Math.abs(d) >= TWO_PI - 1e-9, S, E };
    }
    function arc(a) {
      const cx = R(a.cx), cy = R(a.cy), r = R(a.r);
      if (r <= 0) return false;
      if (a.full) {
        stats.arcs++;
        const dx = cx - w.cx, dy = cy - w.cy;
        if (dx >= -32768 && dx <= 32767 && dy >= -32768 && dy <= 32767 && r < 65536) { w.u8(0x12); w.pt16(cx, cy); w.u16(r); }
        else { w.u8(0x72); w.pt32(cx, cy); w.i32(r); }
        return true;
      }
      const s = ang16(a.S), e = ang16(a.E);
      if (s === e) return false;
      stats.arcs++;
      w.u8(0x65); w.pt32(cx, cy); w.i32(r); w.i32(r); w.u16(s); w.u16(e); w.u16(0);
      return true;
    }

    // ---- texto
    function text(n, M, color, op) {
      const str = String(n.str || '').replace(/\t/g, '    ').replace(/[\r\n]/g, ' ');
      if (!str.trim()) return;
      const sx = n.sx || 1;
      const css = `${n.style || 'normal'} ${n.weight || 'normal'} ${n.size}px ${n.family}`;
      const bold = n.weight === 'bold', ital = n.style === 'italic';
      const arialCss = `${ital ? 'italic' : 'normal'} ${bold ? 'bold' : 'normal'} ${n.size}px Arial`;
      let wOrig = 0, wArial = 0;
      try { wOrig = measure(str, css); wArial = measure(str, arialCss); } catch (e) { /* sin medidor */ }
      if (!(wOrig > 0)) wOrig = n.size * 0.5 * str.length;
      if (!(wArial > 0)) wArial = wOrig;
      const off = n.align === 'center' ? wOrig * sx / 2 : n.align === 'right' ? wOrig * sx : 0;
      const lx = n.x - off, ly = n.y;
      const X = M[0] * lx + M[2] * ly + M[4], Y = M[1] * lx + M[3] * ly + M[5];
      const b = [M[0], M[1]], v = [M[2], M[3]];          // eje x local; eje y local (hacia abajo del texto)
      const bl = Math.hypot(b[0], b[1]) || 1;
      const bh = [b[0] / bl, b[1] / bl], nrm = [bh[1], -bh[0]];
      let hv = v[0] * nrm[0] + v[1] * nrm[1];
      if (Math.abs(hv) < 1e-12) return;
      const mirrored = hv < 0; hv = Math.abs(hv);
      const t = (v[0] * bh[0] + v[1] * bh[1]) / hv;
      const rot = Math.atan2(b[1], b[0]);
      const height = Math.round(n.size * hv / 0.89);     // altura de celda (el lector usa 0,89 × celda = tamaño de letra)
      if (height < 1) return;
      const ws = (bl / hv) * sx * (wOrig / wArial);
      const font = { h: height, rot: ang16(rot), ws: Math.max(1, Math.min(65535, Math.round(ws * 1024))), obl: ang16(Math.atan(mirrored ? -t : t)), style: (bold ? 1 : 0) | (ital ? 2 : 0) };
      const f0 = st.font;
      let fields = 0;
      if (!f0) fields = 0x0001 | 0x0002 | 0x0010 | 0x0020 | 0x0040 | 0x0080 | 0x0100 | 0x0200;
      else {
        if (f0.style !== font.style) fields |= 0x0010;
        if (f0.h !== font.h) fields |= 0x0020;
        if (f0.rot !== font.rot) fields |= 0x0040;
        if (f0.ws !== font.ws) fields |= 0x0080;
        if (f0.obl !== font.obl) fields |= 0x0200;
      }
      setColor(color, op);
      if (fields) {
        w.u8(0x06); w.u16(fields);
        if (fields & 0x0001) w.str('Arial');
        if (fields & 0x0002) w.u8(0);
        if (fields & 0x0010) w.u8(font.style);
        if (fields & 0x0020) w.i32(font.h);
        if (fields & 0x0040) w.u16(font.rot);
        if (fields & 0x0080) w.u16(font.ws);
        if (fields & 0x0100) w.u16(1024);
        if (fields & 0x0200) w.u16(font.obl);
        st.font = font;
      }
      stats.texts++;
      w.u8(0x78); w.pt32(R(X), R(Y)); w.str(str);
    }

    // ---- imagen (PNG/JPEG tal cual: ya viene comprimida)
    function image(n, M, view) {
      let data = n.src ? images.get(n.src) : null;
      if (!data) { stats.warnings.add('Imagen sin datos: ' + (n.src || '?')); return; }
      let info = pngSize(data);
      if (!info) { stats.warnings.add('Imagen en formato no soportado (solo PNG o JPEG): ' + n.src); return; }
      let bb = bbX([n.x, n.y, n.x + n.w, n.y + n.h], M);
      const rot = rotadas.get(n);
      if (rot && rot.data) { data = rot.data; info = pngSize(data); bb = rot.bb; }
      else if (esGirada(M)) stats.warnings.add('Imagen girada: se escribe derecha' + (rot && rot.why ? ' (' + rot.why + ')' : '') + '.');
      const x0 = R(bb[0]), y0 = R(bb[1]), x1 = R(bb[2]), y1 = R(bb[3]);
      stats.images++;
      const size = 2 + 2 + 2 + 8 + 8 + 4 + 4 + data.length + 1;
      w.ascii('{'); w.i32(size); w.u16(info.fmt); w.u16(info.w); w.u16(info.h);
      w.pt32(x0, y0); w.pt32(x1, y1); w.i32(stats.images); w.i32(data.length); w.bytes(data); w.ascii('}');
    }

    // ---- recorrido (mismas reglas que Scene.render)
    let vpSeq = 0;
    function walk(n, M, s) {
      if (n.bb && !overlap(n.bb, s.view)) { stats.culled++; return; }
      if (n.screenOnly || (n.layer != null && s.hl && s.hl.has(n.layer))) return; // borde de ventana (solo pantalla) o capa inutilizada en la ventana
      const layer = n.layer != null ? n.layer : s.layer;
      if (n.k !== 'g' && layer != null && noPlot.has(layer)) return;
      switch (n.k) {
        case 'g': {
          let M2 = M, view = s.view, mm = s.mm, op = s.op, clip = s.clip;
          if (n.m) {
            M2 = mul(M, n.m);
            const sc = Math.sqrt(Math.abs(n.m[0] * n.m[3] - n.m[1] * n.m[2]));
            if (n.local) view = bbX(view, inv(n.m));
            if (mm != null) mm *= sc;
          }
          if (n.mm !== undefined) mm = n.mm;
          if (n.op != null && n.op < 1) op *= n.op;
          if (n.clip && n.clip.p && n.clip.p.ops) {
            const subs = flatten(n.clip.p.ops, [1, 0, 0, 1, 0, 0], 1e-6);
            const lb = [Infinity, Infinity, -Infinity, -Infinity];
            for (const sp of subs) for (let i = 0; i < sp.p.length; i += 2) { const x = sp.p[i], y = sp.p[i + 1]; if (x < lb[0]) lb[0] = x; if (x > lb[2]) lb[2] = x; if (y < lb[1]) lb[1] = y; if (y > lb[3]) lb[3] = y; }
            view = [Math.max(view[0], lb[0]), Math.max(view[1], lb[1]), Math.min(view[2], lb[2]), Math.min(view[3], lb[3])];
            if (view[0] > view[2] || view[1] > view[3]) return;
            const cw = [lb[0], lb[1], lb[2], lb[1], lb[2], lb[3], lb[0], lb[3]].map((v, i, a) => (i % 2 ? M2[1] * a[i - 1] + M2[3] * v + M2[5] : M2[0] * v + M2[2] * a[i + 1] + M2[4]));
            const rectW = [Math.min(cw[0], cw[2], cw[4], cw[6]), Math.min(cw[1], cw[3], cw[5], cw[7]), Math.max(cw[0], cw[2], cw[4], cw[6]), Math.max(cw[1], cw[3], cw[5], cw[7])];
            const axis = Math.abs(M2[1]) < 1e-9 * Math.abs(M2[0]) || Math.abs(M2[0]) < 1e-9 * Math.abs(M2[1]);
            let units = null;
            if (n.ch.length === 1 && n.ch[0].k === 'g' && n.ch[0].m) units = mul(M2, n.ch[0].m);
            clip = { id: ++vpSeq, contour: cw, rect: rectW, axis, units };
          }
          const gbb = n.bb ? bbX(n.bb, M) : s.gbb;
          if (clip && gbb && !overlap(gbb, clip.rect)) { stats.culled++; return; }
          const s2 = { view, mm, op, clip, layer, gbb, hl: n.hideLayers ? new Set([...(s.hl || []), ...n.hideLayers]) : s.hl };
          for (const c of n.ch) walk(c, M2, s2);
          return;
        }
        case 'p': {
          if (!n.p || !n.p.ops) return;
          const bbW = bbX(n.bb || [-Infinity, -Infinity, Infinity, Infinity], M);
          if (s.clip && isFinite(bbW[0]) && !overlap(bbW, s.clip.rect)) { stats.culled++; return; }
          const needClip = s.clip && !(isFinite(bbW[0]) && inside(bbW, s.clip.rect));
          if (n.fill) {
            const subs = flatten(n.p.ops, M, tolW);
            // bg (WIPEOUT): tapa de fondo, siempre blanca
            if (subs.length) { setLayer(layer); setViewport(needClip ? s.clip : null); setColor(n.bg ? [255, 255, 255] : parseColor(n.fill), n.bg ? 1 : s.op); contours(subs.map((q) => q.p)); }
          }
          if (n.stroke) {
            let lw = n.lw || 0;
            if (n.lwmm != null) lw = s.mm != null ? n.lwmm / s.mm : 0;
            const lwW = lw * scaleOf(M);
            const a = !n.dash ? asArc(n.p.ops, M) : null;
            setLayer(layer);
            if (a && !(needClip && s.clip.axis && !inside([a.cx - a.r, a.cy - a.r, a.cx + a.r, a.cy + a.r], s.clip.rect))) {
              setViewport(needClip ? s.clip : null); setColor(parseColor(n.stroke), s.op); setLW(lwW);
              if (arc(a)) return;
            }
            const subs = flatten(n.p.ops, M, tolW);
            let lines = [];
            for (const q of subs) {
              let p = q.p;
              if (q.closed && p.length >= 4) p = p.concat([p[0], p[1]]);
              if (p.length < 2) continue;
              if (n.dash && n.dash.length) {
                const k = scaleOf(M), pat = n.dash.map((d) => Math.max(d * k, 0.5));
                let total = 0; for (const d of pat) total += d;
                let len = 0; for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
                if (total >= 4 && len / total < 5000) dashed(p, pat, lines); else lines.push(p);
              } else lines.push(p);
            }
            if (needClip && s.clip.axis) { const o2 = []; for (const p of lines) clipPoly(p, s.clip.rect, o2); lines = o2; }
            if (!lines.length) return;
            setViewport(needClip && !s.clip.axis ? s.clip : null);
            setColor(parseColor(n.stroke), s.op); setLW(lwW);
            for (const p of lines) polyline(p);
          }
          return;
        }
        case 'h': {
          if (!n.p || !n.lines) return;
          const polys = flatten(n.p.ops, M, tolW).map((q) => q.p).filter((p) => p.length >= 6);
          const segs = flatten(n.lines.ops, M, tolW);
          const out = [];
          for (const q of segs) for (let i = 2; i < q.p.length; i += 2) clipSegToPolys(q.p[i - 2], q.p[i - 1], q.p[i], q.p[i + 1], polys, out);
          if (!out.length) return;
          let lines = out;
          if (s.clip && s.clip.axis) { const o2 = []; for (const p of out) clipPoly(p, s.clip.rect, o2); lines = o2; }
          if (!lines.length) return;
          setLayer(layer); setViewport(s.clip && !s.clip.axis ? s.clip : null);
          setColor(parseColor(n.color || '#000'), s.op); setLW(0);
          stats.hatchSegs += lines.length;
          for (const p of lines) polyline(p);
          return;
        }
        case 't': {
          const Mt = n.m ? mul(M, n.m) : M;
          const p = [Mt[0] * n.x + Mt[2] * n.y + Mt[4], Mt[1] * n.x + Mt[3] * n.y + Mt[5]];
          if (s.clip && !(p[0] >= s.clip.rect[0] && p[0] <= s.clip.rect[2] && p[1] >= s.clip.rect[1] && p[1] <= s.clip.rect[3])) {
            // el punto de inserción queda afuera: se escribe solo si la caja toca la ventana (con recorte del visor)
            const bbW = s.gbb;
            if (bbW && !overlap(bbW, s.clip.rect)) { stats.culled++; return; }
          }
          setLayer(layer);
          const bbW = s.gbb;
          setViewport(s.clip && !(bbW && inside(bbW, s.clip.rect)) ? s.clip : null);
          text(n, Mt, parseColor(n.fill || '#000'), s.op);
          return;
        }
        case 'i': {
          setLayer(layer); setViewport(s.clip || null);
          image(n, n.m ? mul(M, n.m) : M, s.view);
          return;
        }
      }
    }
    const view0 = [0, 0, page.width, page.height];
    walk(root, T0, { view: view0, mm: null, op: 1, clip: null, layer: null });
    w.ascii('(EndOfDWF)');
    stats.warnings = [...stats.warnings];
    return { w2d: w.out(), stats, Wd, Hd };
  }

  // ------------------------------------------------------------------ ZIP (deflate) — propio
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflateRaw(d) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
      return new Uint8Array(require('zlib').deflateRawSync(d, { level: 9 }));
    }
    if (typeof CompressionStream !== 'undefined') {
      const s = new Blob([d]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return null; // sin compresor: se guarda sin comprimir
  }
  async function zipWithHeader(head, entries, when) {
    const d = when || new Date();
    const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [head]; let off = head.length; const cen = [];
    const le = (n, bytes) => { const a = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) a[i] = (n >>> (8 * i)) & 255; return a; };
    for (const e of entries) {
      const name = new TextEncoder().encode(e.name);
      const crc = crc32(e.data);
      let comp = await deflateRaw(e.data), method = 8;
      if (!comp || comp.length >= e.data.length) { comp = e.data; method = 0; }
      const lh = [le(0x04034b50, 4), le(20, 2), le(0, 2), le(method, 2), le(dosT, 2), le(dosD, 2), le(crc, 4), le(comp.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2), name];
      const start = off;
      for (const x of lh) { parts.push(x); off += x.length; }
      parts.push(comp); off += comp.length;
      cen.push([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(method, 2), le(dosT, 2), le(dosD, 2), le(crc, 4), le(comp.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0x20, 4), le(start, 4), name]);
    }
    const cdStart = off; let cdSize = 0;
    for (const c of cen) for (const x of c) { parts.push(x); cdSize += x.length; }
    parts.push(le(0x06054b50, 4), le(0, 2), le(0, 2), le(entries.length, 2), le(entries.length, 2), le(cdSize, 4), le(cdStart, 4), le(0, 2));
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total); let p = 0;
    for (const x of parts) { out.set(x, p); p += x.length; }
    return out;
  }

  // ------------------------------------------------------------------ paquete DWF V06.00 (una hoja)
  async function packageDWF(w2d, o) {
    const sec = 'com.autodesk.dwf.ePlot_' + uuid();
    const w2dName = sec + '\\' + uuid() + '.w2d';
    const descName = sec + '\\descriptor.xml';
    const title = o.title || 'Plano';
    const now = o.when || new Date();
    const tz = -now.getTimezoneOffset(), tzs = (tz >= 0 ? '+' : '-') + String(Math.floor(Math.abs(tz) / 60)).padStart(2, '0') + ':' + String(Math.abs(tz) % 60).padStart(2, '0');
    const p2 = (v) => String(v).padStart(2, '0');
    const iso = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}.000${tz === 0 ? 'Z' : tzs}`;
    const W = num(o.paperW), H = num(o.paperH);
    const manifest = `<dwf:Manifest xmlns:dwf="DWF-Manifest:6.0" version="6.0" objectId="${uuid()}"><dwf:Interfaces><dwf:Interface objectId="715941D4-1AC2-4545-8185-BC40E053B551" name="ePlot" href="http://www.autodesk.com/viewers"/></dwf:Interfaces><dwf:Properties><dwf:Property name="SourceProductName" value="Domoplano"/><dwf:Property name="SourceProductVendor" value="DOMOTEX"/></dwf:Properties><dwf:Sections><dwf:Section type="com.autodesk.dwf.ePlot" name="${sec}" title="${xmlEsc(title)}"><dwf:Source provider="Domoplano" href="${xmlEsc(o.sourceName || '')}"/><dwf:Toc><dwf:Resource role="2d streaming graphics" mime="application/x-w2d" href="${xmlEsc(w2dName)}"/><dwf:Resource role="descriptor" mime="text/xml" href="${xmlEsc(descName)}"/></dwf:Toc></dwf:Section></dwf:Sections></dwf:Manifest>`;
    const props = [['Layout Name', o.layout || title], ['Title', title], ['Author', o.author || ''], ['Creator', 'Domoplano (escritor DWF propio de DOMOTEX)'], ['File Name', o.sourceName || '']]
      .filter(([, v]) => v !== '').map(([k, v]) => `<ePlot:Property name="${k}" value="${xmlEsc(v)}" category="AutoCAD Drawing"/>`).join('');
    const tr = `${1 / U} 0 0 0 0 ${1 / U} 0 0 0 0 1 0 0 0 0 1`;
    const descriptor = `<ePlot:Page xmlns:ePlot="DWF-ePlot:1.2" version="1.2" objectId="${uuid()}" name="${xmlEsc(title)}" plotOrder="1" color="255 255 255"><ePlot:Paper units="mm" width="${W}" height="${H}" color="255 255 255" clip="0 0 ${W} ${H}"/><ePlot:Properties id="${uuid()}">${props}<ePlot:Property name="Creation Time" value="${iso}" type="timeInstant"/></ePlot:Properties><ePlot:Resources><ePlot:GraphicResource role="2d streaming graphics" mime="application/x-w2d" href="${xmlEsc(w2dName)}" title="${xmlEsc(title)}.w2d" size="${w2d.length}" objectId="${w2dName.slice(sec.length + 1, -4)}" transform="${tr}"/></ePlot:Resources></ePlot:Page>`;
    const enc = new TextEncoder();
    return zipWithHeader(enc.encode('(DWF V06.00)'), [
      { name: 'manifest.xml', data: enc.encode(manifest) },
      { name: descName, data: enc.encode(descriptor) },
      { name: w2dName, data: w2d },
    ], now);
  }

  // ------------------------------------------------------------------ de DXF a DWF (una plancha por archivo)
  /**
   * u8: bytes del DXF. o: {plancha (nombre o índice), resolveURL, loadBytes(src)→Uint8Array, title, author, sourceName}
   * Devuelve {bytes, page, stats, w2dSize}.
   */
  async function fromDXF(u8, o = {}) {
    if (typeof DXF === 'undefined') throw new Error('Falta el lector DXF.');
    let doc, page, root;
    await withRecording(async () => {
      doc = await DXF.open(u8, { resolveURL: o.resolveURL });
      const papers = doc.pages.filter((p) => p.title !== 'Modelo' && p.title !== 'Model');
      if (o.plancha != null && o.plancha !== '') {
        page = typeof o.plancha === 'number' ? papers[o.plancha] : papers.find((p) => p.title.toUpperCase() === String(o.plancha).toUpperCase());
        if (!page) throw new Error(`No existe la plancha «${o.plancha}». Planchas: ${papers.map((p) => p.title).join(', ')}`);
      } else page = papers.find((p) => !p.vacia || !p.vacia()) || papers[0] || doc.pages[0];
      root = await page.build();
    });
    return fromScene(page, root, { ...o, layout: page.title });
  }

  /** Escena ya armada con RecPath → DWF. */
  async function fromScene(page, root, o = {}) {
    // imágenes: se leen los bytes originales (PNG/JPEG ya comprimidos)
    const images = new Map();
    const srcs = new Set();
    (function find(n) { if (!n) return; if (n.k === 'i' && n.src) srcs.add(n.src); if (n.ch) n.ch.forEach(find); })(root);
    const load = o.loadBytes || (async (src) => new Uint8Array(await (await fetch(src)).arrayBuffer()));
    for (const s of srcs) { try { images.set(s, await load(s)); } catch (e) { /* se avisa al escribir */ } }
    const title = o.title || page.title;
    const rotadas = await prepararGiradas(page, root, images);
    const r = writeW2D(page, root, { title, images, rotadas });
    const unitMM = page.unitMM || 1;
    const bytes = await packageDWF(r.w2d, { title, layout: o.layout || page.title, author: o.author, sourceName: o.sourceName, paperW: page.width * unitMM, paperH: page.height * unitMM, when: o.when });
    return { bytes, page, stats: r.stats, w2dSize: r.w2d.length };
  }

  return { fromDXF, fromScene, writeW2D, packageDWF, withRecording, RecPath, crc32, encodePNG, decodeRGBA };
})();
if (typeof module !== 'undefined') module.exports = DWFWriter; else self.DWFWriter = DWFWriter;
