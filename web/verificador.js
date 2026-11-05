// Domoplano — VERIFICADOR de textos montados en un plano DXF (hito H4, «verificador de textos montados»).
// Puerto propio a JavaScript de scripts/tdc_verificar_plano.py (Tienda del Café, E2 v3), con las mismas reglas:
//   TEXTO-TEXTO, TEXTO-TRAZO, TEXTO-RELLENO, TEXTO-BORDE DE HOJA, TINTA-TRAZO (la tinta real de cada letra contra
//   cualquier trazo) y LLAMADA-CRUZA (línea de llamada que atraviesa un símbolo o un texto); además altura mínima de texto
//   (todas, < 2,0 y < 2,5 mm: NC-RA8-001 6.3.1 c pide 2,5 en notas y convenciones), capas, conteo de entidades, imágenes.
// Diferencia única con el script Python: la LETRA. El script medía con romans.shx (archivo de Autodesk, que se va con
// AutoCAD). Aquí se mide con Liberation Sans (libre, OFL, en web/fuentes) tal como Domoplano dibuja e imprime el plano:
//   - estilos SHX / «narrow» (romans, simplex, isocp, txt…): ancho = Liberation Sans × 0,82 (= Arial Narrow, la de pantalla)
//   - estilos TrueType: ancho de Liberation Sans.
//   La altura DXF es la de la mayúscula; el tamaño de letra es 1,38 × altura (igual que dxf.js).
//   o.anchoExtra (p. ej. 1.25) ensancha todas las cajas para una revisión más exigente.
// Código propio, escrito a partir de la referencia pública del formato DXF y de la especificación pública TrueType.
// Sin código ni archivos de Autodesk. No usa el lector de la app (es un revisor independiente, como el script Python).
//
// Uso (navegador o node):  const r = await Verificador.verificar(textoDXF, { fuente: bytesTTF });  r.informe, r.colisiones
//   node:  node cli/verificar.js plano.dxf [salida.txt] [--json] [--ancho 1.25] [--presentacion NOMBRE]
const Verificador = (() => {
  const MARGEN = 0.60;        // mm de aire mínimo entre la caja del texto y cualquier trazo
  const MARGEN_TT = 0.30;     // mm de aire mínimo entre dos textos
  const MARGEN_TINTA = 0.35;  // aire mínimo entre la tinta real de cada letra y cualquier trazo (+ medio grosor)
  const DESC = 1 / 3;         // alineación «Bottom» (valign 1) apoya el descendente: la base sube DESC·h
  const LARGO_SIMBOLO = 12.0; // un trazo ABIERTO más corto que esto es parte de un símbolo
  const DOT_R = 0.35;         // las llamadas terminan en un punto relleno de radio ≤ DOT_R
  const EM = 1.38;            // altura DXF (mayúscula) → tamaño de letra (igual que dxf.js)
  const NARROW = 0.82;        // Arial Narrow / Arial (medido: 0,820 en las 498 líneas del plano TDC v3)
  const HOJA_DEF = [0, 0, 1189, 841];
  const R2D = 180 / Math.PI, D2R = Math.PI / 180;

  // ================================================================== lector DXF mínimo (pares código/valor)
  function decode(u8) {
    if (typeof u8 === 'string') return u8;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); }
  }
  function pares(text) {
    const L = text.split(/\r?\n/); const out = [];
    for (let i = 0; i + 1 < L.length; i += 2) {
      const c = parseInt(L[i], 10);
      if (Number.isNaN(c)) { i -= 1; continue; }
      out.push([c, L[i + 1]]);
    }
    return out;
  }
  function Ent(type, p) { this.type = type; this.p = p; this.sub = []; }
  Ent.prototype.g = function (c, d) { for (const [k, v] of this.p) if (k === c) return v; return d; };
  Ent.prototype.n = function (c, d = 0) { const v = this.g(c); if (v === undefined) return d; const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  Ent.prototype.s = function (c, d = '') { const v = this.g(c); return v === undefined ? d : String(v).trim(); };
  Ent.prototype.has = function (c) { return this.p.some(([k]) => k === c); };

  /** Lee secciones: capas, estilos, bloques, entidades y presentaciones. */
  function leer(text) {
    const P = pares(text);
    const D = { layers: [], styles: new Map(), blocks: new Map(), entities: [], layouts: [], header: {}, brName: new Map() };
    let sec = null, i = 0;
    const recs = (i0, i1) => {
      const out = []; let cur = null;
      for (let k = i0; k < i1; k++) { const [c, v] = P[k]; if (c === 0) { cur = new Ent(v.trim(), []); out.push(cur); } else if (cur) cur.p.push([c, v]); }
      return out;
    };
    while (i < P.length) {
      if (P[i][0] === 0 && P[i][1].trim() === 'SECTION' && P[i + 1] && P[i + 1][0] === 2) {
        sec = P[i + 1][1].trim(); let j = i + 2;
        while (j < P.length && !(P[j][0] === 0 && P[j][1].trim() === 'ENDSEC')) j++;
        const R = recs(i + 2, j);
        if (sec === 'HEADER') {
          let name = null;
          for (let k = i + 2; k < j; k++) { const [c, v] = P[k]; if (c === 9) { name = v.trim(); D.header[name] = {}; } else if (name) D.header[name][c] = v; }
        } else if (sec === 'TABLES') {
          for (const r of R) {
            if (r.type === 'LAYER') D.layers.push(r.s(2));
            if (r.type === 'STYLE') D.styles.set(r.s(2).toUpperCase(), { font: r.s(3).toLowerCase(), width: r.n(41, 1) || 1 });
            if (r.type === 'BLOCK_RECORD') D.brName.set(r.s(5).toUpperCase(), r.s(2));
          }
        } else if (sec === 'BLOCKS') {
          let b = null;
          for (const r of agrupar(R)) {
            if (r.type === 'BLOCK') { b = { name: r.s(2), base: [r.n(10), r.n(20)], ents: [] }; D.blocks.set(b.name.toUpperCase(), b); continue; }
            if (r.type === 'ENDBLK') { b = null; continue; }
            if (b) b.ents.push(r);
          }
        } else if (sec === 'ENTITIES') {
          D.entities = agrupar(R);
        } else if (sec === 'OBJECTS') {
          for (const r of R) if (r.type === 'LAYOUT') {
            // el nombre de la presentación es el código 1 que sigue a «100 AcDbLayout»
            let k = r.p.findIndex(([c, v]) => c === 100 && v.trim() === 'AcDbLayout');
            let name = ''; for (k = k + 1; k > 0 && k < r.p.length; k++) if (r.p[k][0] === 1) { name = r.p[k][1].trim(); break; }
            const owner = [...r.p].reverse().find(([c]) => c === 330);
            const k0 = r.p.findIndex(([c, v]) => c === 100 && v.trim() === 'AcDbLayout'); const t71 = k0 >= 0 ? r.p.slice(k0).find(([c]) => c === 71) : null;
            D.layouts.push({ tab: t71 ? parseInt(t71[1], 10) || 0 : 0, name, br: owner ? owner[1].trim().toUpperCase() : '', paper: [r.n(44, 0), r.n(45, 0)], margins: [r.n(40, 0), r.n(41, 0), r.n(42, 0), r.n(43, 0)], rot: r.n(73, 0) });
          }
        }
        i = j + 1; continue;
      }
      i++;
    }
    return D;
  }
  /** POLYLINE+VERTEX+SEQEND e INSERT+ATTRIB+SEQEND quedan como una sola entidad con sus partes en .sub */
  function agrupar(R) {
    const out = []; let cur = null;
    for (const r of R) {
      if (cur && (r.type === 'VERTEX' || r.type === 'ATTRIB')) { cur.sub.push(r); continue; }
      if (cur && r.type === 'SEQEND') { cur = null; continue; }
      cur = null; out.push(r);
      if (r.type === 'POLYLINE' || (r.type === 'INSERT' && r.n(66, 0) === 1)) cur = r;
    }
    return out;
  }

  // ================================================================== letra (TrueType: anchos y contornos)
  function parseTTF(u8) {
    const d = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const nt = v.getUint16(4); const tab = {};
    for (let i = 0; i < nt; i++) { const o = 12 + 16 * i; tab[String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3])] = v.getUint32(o + 8); }
    const upem = v.getUint16(tab.head + 18), locFmt = v.getInt16(tab.head + 50), numGlyphs = v.getUint16(tab.maxp + 4), nh = v.getUint16(tab.hhea + 34);
    const adv = (g) => v.getUint16(tab.hmtx + 4 * Math.min(g, nh - 1));
    const loca = (g) => (locFmt ? v.getUint32(tab.loca + 4 * g) : 2 * v.getUint16(tab.loca + 2 * g));
    const cmap = new Map(); const cm = tab.cmap, n = v.getUint16(cm + 2); let sub = -1;
    for (let i = 0; i < n; i++) { const pid = v.getUint16(cm + 4 + 8 * i), eid = v.getUint16(cm + 6 + 8 * i), so = cm + v.getUint32(cm + 8 + 8 * i); if (v.getUint16(so) === 4 && ((pid === 3 && eid === 1) || (pid === 0 && sub < 0))) sub = so; }
    if (sub >= 0) {
      const s2 = v.getUint16(sub + 6), E = sub + 14, S = E + s2 + 2, Dl = S + s2, Ro = Dl + s2;
      for (let s = 0; s < s2; s += 2) {
        const e = v.getUint16(E + s), st = v.getUint16(S + s), dl = v.getInt16(Dl + s), ro = v.getUint16(Ro + s);
        for (let c = st; c <= e && c !== 0xFFFF; c++) { let g; if (!ro) g = (c + dl) & 0xFFFF; else { const gi = v.getUint16(Ro + s + ro + 2 * (c - st)); g = gi ? (gi + dl) & 0xFFFF : 0; } if (g) cmap.set(c, g); }
      }
    }
    const cache = new Map();
    /** contornos del glifo: lista de listas de [x, y] (unidades de la letra), curvas cuadráticas aplanadas */
    function contornos(g, prof = 0) {
      if (cache.has(g)) return cache.get(g);
      const out = [];
      if (g < numGlyphs && prof < 6) {
        const o = tab.glyf + loca(g), o1 = tab.glyf + loca(g + 1);
        if (o1 > o) {
          const nc = v.getInt16(o);
          if (nc >= 0) {
            const ends = []; for (let i = 0; i < nc; i++) ends.push(v.getUint16(o + 10 + 2 * i));
            const np = nc ? ends[nc - 1] + 1 : 0; let p = o + 10 + 2 * nc; p += 2 + v.getUint16(p);
            const fl = [];
            while (fl.length < np) { const f = d[p++]; fl.push(f); if (f & 8) { let r = d[p++]; while (r-- > 0) fl.push(f); } }
            const xs = [], ys = []; let x = 0, y = 0;
            for (let i = 0; i < np; i++) { const f = fl[i]; if (f & 2) { const dx = d[p++]; x += f & 16 ? dx : -dx; } else if (!(f & 16)) { x += v.getInt16(p); p += 2; } xs.push(x); }
            for (let i = 0; i < np; i++) { const f = fl[i]; if (f & 4) { const dy = d[p++]; y += f & 32 ? dy : -dy; } else if (!(f & 32)) { y += v.getInt16(p); p += 2; } ys.push(y); }
            let s = 0;
            for (const e of ends) {
              const pts = []; for (let i = s; i <= e; i++) pts.push([xs[i], ys[i], fl[i] & 1]); s = e + 1;
              if (pts.length) out.push(aplanar(pts));
            }
          } else {
            let p = o + 10, more = true;
            while (more) {
              const flags = v.getUint16(p), gi = v.getUint16(p + 2); p += 4;
              let dx, dy; if (flags & 1) { dx = v.getInt16(p); dy = v.getInt16(p + 2); p += 4; } else { dx = v.getInt8(p); dy = v.getInt8(p + 1); p += 2; }
              let a = 1, b = 0, c = 0, e = 1; const f2 = (q) => v.getInt16(q) / 16384;
              if (flags & 8) { a = e = f2(p); p += 2; } else if (flags & 0x40) { a = f2(p); e = f2(p + 2); p += 4; } else if (flags & 0x80) { a = f2(p); b = f2(p + 2); c = f2(p + 4); e = f2(p + 6); p += 8; }
              if (!(flags & 2)) { dx = 0; dy = 0; } // anclaje por puntos: raro en Liberation Sans; se ignora el corrimiento
              for (const ct of contornos(gi, prof + 1)) out.push(ct.map(([x, y]) => [a * x + c * y + dx, b * x + e * y + dy]));
              more = !!(flags & 0x20);
            }
          }
        }
      }
      cache.set(g, out); return out;
    }
    function aplanar(pts) {
      // puntos on/off de TrueType → polilínea cerrada (cada curva cuadrática en 4 tramos)
      const n = pts.length; const P = [];
      let k0 = pts.findIndex((q) => q[2]);
      let start;
      if (k0 < 0) { start = [(pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2]; k0 = 0; } else start = [pts[k0][0], pts[k0][1]];
      P.push(start); let cur = start, ctrl = null;
      for (let j = 1; j <= n; j++) {
        const q = pts[(k0 + j) % n];
        if (q[2]) {
          if (ctrl) { curva(cur, ctrl, q, P); ctrl = null; } else P.push([q[0], q[1]]);
          cur = [q[0], q[1]];
        } else {
          if (ctrl) { const m = [(ctrl[0] + q[0]) / 2, (ctrl[1] + q[1]) / 2]; curva(cur, ctrl, m, P); cur = m; }
          ctrl = [q[0], q[1]];
        }
      }
      if (ctrl) curva(cur, ctrl, start, P);
      if (P.length && (P[0][0] !== P[P.length - 1][0] || P[0][1] !== P[P.length - 1][1])) P.push(P[0]);
      return P;
    }
    function curva(a, c, b, P) { for (let t = 0.25; t <= 1.0001; t += 0.25) { const u = 1 - t; P.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } }
    const glifo = (ch) => cmap.get(ch.codePointAt(0)) || cmap.get(63) || 0;
    return {
      upem,
      ancho(str) { let w = 0; for (const ch of str) w += adv(glifo(ch)); return w / upem; },
      /** segmentos de la tinta del texto con tamaño 1 (em = 1), origen en la línea base */
      tinta(str) {
        const segs = []; let x = 0;
        for (const ch of str) {
          const g = glifo(ch);
          for (const ct of contornos(g)) for (let i = 0; i + 1 < ct.length; i++) segs.push([[(ct[i][0] + x) / upem, ct[i][1] / upem], [(ct[i + 1][0] + x) / upem, ct[i + 1][1] / upem]]);
          x += adv(g);
        }
        return segs;
      },
    };
  }
  let fuenteDef = null;
  async function cargarFuente(o) {
    if (o.fuente) return parseTTF(o.fuente);
    if (fuenteDef) return fuenteDef;
    let bytes;
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require !== 'undefined') {
      bytes = require('fs').readFileSync(require('path').join(__dirname, 'fuentes', 'LiberationSans-Regular.ttf'));
    } else {
      const r = await fetch('fuentes/LiberationSans-Regular.ttf'); if (!r.ok) throw new Error('No se encontró la letra Liberation Sans');
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    fuenteDef = parseTTF(bytes); return fuenteDef;
  }

  // ================================================================== texto DXF
  function textoPlano(s) {
    // códigos de control del TEXT (referencia DXF pública): %%d °, %%p ±, %%c Ø, %%% %, %%u/%%o subrayado (se quitan), %%nnn
    return String(s).replace(/%%(\d{3})/g, (m, n) => String.fromCharCode(+n)).replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
      .replace(/%%[cC]/g, 'Ø').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%').replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  function esNarrow(st) {
    const f = (st && st.font) || '';
    const base = f.replace(/\.(ttf|otf|ttc|shx)$/, '');
    return /arial ?narrow|isocp|isoct|romans|simplex|txt|monotxt|romant|isocpeur/.test(base) || /\.shx$/.test(f) || !f;
  }

  // ================================================================== geometría (igual que el script Python)
  const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
  function segX(p1, p2, p3, p4) {
    const d1 = ccw(p3, p4, p1), d2 = ccw(p3, p4, p2), d3 = ccw(p1, p2, p3), d4 = ccw(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function ptIn(pt, poly) {
    const n = poly.length; let dentro = false; let j = n - 1;
    for (let i = 0; i < n; i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi) dentro = !dentro;
      j = i;
    }
    return dentro;
  }
  function segPoly(p, q, poly) {
    if (ptIn(p, poly) || ptIn(q, poly)) return true;
    for (let i = 0; i < poly.length; i++) if (segX(p, q, poly[i], poly[(i + 1) % poly.length])) return true;
    return false;
  }
  function polyPoly(a, b) {
    if (a.some((p) => ptIn(p, b)) || b.some((p) => ptIn(p, a))) return true;
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segX(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    return false;
  }
  function dpt(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
  }
  const distSS = (a, b, c, d) => (segX(a, b, c, d) ? 0 : Math.min(dpt(a, c, d), dpt(b, c, d), dpt(c, a, b), dpt(d, a, b)));
  function crecer(poly, m) {
    let ux = [poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]]; const lu = Math.hypot(...ux) || 1; ux = [ux[0] / lu, ux[1] / lu];
    let uy = [poly[3][0] - poly[0][0], poly[3][1] - poly[0][1]]; const lv = Math.hypot(...uy) || 1; uy = [uy[0] / lv, uy[1] / lv];
    const s = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return poly.map((p, i) => [p[0] + (s[i][0] * ux[0] + s[i][1] * uy[0]) * m, p[1] + (s[i][0] * ux[1] + s[i][1] * uy[1]) * m]);
  }
  function bb(pts) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; }
  const bbX = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
  function arco(c, r, a0, a1, n = 24) {
    if (a1 < a0) a1 += 360;
    const k = Math.max(4, Math.trunc(n * (a1 - a0) / 360) + 1); const out = [];
    for (let i = 0; i <= k; i++) { const a = (a0 + (a1 - a0) * i / k) * D2R; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    return out;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

  // ================================================================== entidades → trazos
  const grosor = (e) => { const lw = e.n(370, -1); return lw > 0 ? lw / 100 : 0.25; };
  /** Transformación de una inserción (bloque → presentación) */
  function xformInsert(ins, base) {
    const sx = ins.n(41, 1), sy = ins.n(42, 1), rot = ins.n(50, 0) * D2R, px = ins.n(10), py = ins.n(20);
    const c = Math.cos(rot), s = Math.sin(rot);
    const f = ([x, y]) => { const X = (x - base[0]) * sx, Y = (y - base[1]) * sy; return [px + X * c - Y * s, py + X * s + Y * c]; };
    return { f, sx, sy, rot: ins.n(50, 0), mirror: sx * sy < 0 };
  }
  const ident = { f: (p) => p, sx: 1, sy: 1, rot: 0, mirror: false };
  function ptsLW(e) {
    const out = []; let x = null;
    for (const [c, v] of e.p) { if (c === 10) x = parseFloat(v); else if (c === 20 && x !== null) { out.push([x, parseFloat(v)]); x = null; } }
    return out;
  }
  /** trazos(e, T) → { out: [[polilínea, grosor]], rell: [polígonos] } (como trazos() del script Python) */
  function trazos(e, T = ident) {
    const t = e.type, out = [], rell = [], f = T.f;
    if (t === 'LINE') out.push([[f([e.n(10), e.n(20)]), f([e.n(11), e.n(21)])], grosor(e)]);
    else if (t === 'LWPOLYLINE') {
      const pts = ptsLW(e).map(f); if (!pts.length) return { out, rell };
      if (e.n(70, 0) & 1) pts.push(pts[0]);
      out.push([pts, Math.max(grosor(e), e.n(43, 0) || 0)]);
    } else if (t === 'POLYLINE') {
      const pts = e.sub.filter((v) => !(v.n(70, 0) & 16)).map((v) => f([v.n(10), v.n(20)])); if (!pts.length) return { out, rell };
      if (e.n(70, 0) & 1) pts.push(pts[0]);
      out.push([pts, grosor(e)]);
    } else if (t === 'CIRCLE') {
      const c = f([e.n(10), e.n(20)]); const r = e.n(40) * Math.abs(T.sx);
      if (Math.abs(Math.abs(T.sx) - Math.abs(T.sy)) > 1e-9) return { out, rell }; // con escala distinta en x/y sería una elipse
      out.push([arco(c, r, 0, 360, 32), grosor(e)]);
    } else if (t === 'ARC') {
      if (Math.abs(Math.abs(T.sx) - Math.abs(T.sy)) > 1e-9) return { out, rell };
      const c = f([e.n(10), e.n(20)]); const r = e.n(40) * Math.abs(T.sx);
      let a0 = e.n(50), a1 = e.n(51);
      if (T !== ident) {
        if (T.mirror) { // reflejado: los ángulos se reflejan y se invierte el sentido
          const m = (a) => (T.sx < 0 ? 180 - a : -a);
          [a0, a1] = [m(a1), m(a0)];
        }
        a0 += T.rot; a1 += T.rot;
        a0 = ((a0 % 360) + 360) % 360; a1 = ((a1 % 360) + 360) % 360;
      }
      out.push([arco(c, r, a0, a1), grosor(e)]);
    } else if (t === 'SOLID' || t === 'TRACE') {
      const v2 = [e.n(12), e.n(22)], v3 = e.has(13) ? [e.n(13), e.n(23)] : v2;
      const v = [[e.n(10), e.n(20)], [e.n(11), e.n(21)], v3, v2].map(f);
      rell.push(v); out.push([[...v, v[0]], 0.1]);
    } else if (t === 'HATCH') {
      for (const pts of caminosHatch(e)) { const P = pts.map(f); if (P.length >= 3) { rell.push(P); out.push([[...P, P[0]], 0.1]); } }
    }
    return { out, rell };
  }
  /** Contornos del sombreado: polilínea (vértices, sin comba) o aristas línea/arco (como el script Python; elipses y splines no). */
  function caminosHatch(e) {
    const p = e.p; const res = [];
    let i = p.findIndex(([c]) => c === 91); if (i < 0) return res;
    const nPaths = parseInt(p[i][1], 10); i++;
    for (let k = 0; k < nPaths && i < p.length; k++) {
      while (i < p.length && p[i][0] !== 92) i++;
      if (i >= p.length) break;
      const tipo = parseInt(p[i][1], 10); i++;
      const pts = [];
      if (tipo & 2) { // polilínea
        let hasB = 0, nv = 0;
        while (i < p.length && p[i][0] !== 93) { if (p[i][0] === 72) hasB = parseInt(p[i][1], 10); i++; }
        if (i >= p.length) break;
        nv = parseInt(p[i][1], 10); i++;
        for (let v = 0; v < nv && i + 1 < p.length; v++) {
          const x = parseFloat(p[i][1]), y = parseFloat(p[i + 1][1]); i += 2;
          if (hasB && p[i] && p[i][0] === 42) i++;
          pts.push([x, y]);
        }
      } else {
        while (i < p.length && p[i][0] !== 93) i++;
        if (i >= p.length) break;
        const ne = parseInt(p[i][1], 10); i++; // código 93
        for (let ed = 0; ed < ne && i < p.length; ed++) {
          while (i < p.length && p[i][0] !== 72 && p[i][0] !== 97 && p[i][0] !== 92 && p[i][0] !== 75) i++;
          if (i >= p.length || p[i][0] !== 72) break;
          const et = parseInt(p[i][1], 10); i++; // código 72
          const val = {}; const want = et === 1 ? [10, 20, 11, 21] : et === 2 ? [10, 20, 40, 50, 51, 73] : et === 3 ? [10, 20, 11, 21, 40, 50, 51, 73] : null;
          if (!want) { // spline: se salta hasta la siguiente arista o el fin del camino
            while (i < p.length && ![72, 97, 92, 75].includes(p[i][0])) i++;
            continue;
          }
          for (const c of want) {
            while (i < p.length && p[i][0] !== c && p[i][0] !== 97 && p[i][0] !== 92 && p[i][0] !== 75) i++;
            if (i >= p.length || p[i][0] !== c) break;
            val[c] = parseFloat(p[i][1]); i++;
          }
          if (et === 1 && val[21] !== undefined) pts.push([val[10], val[20]], [val[11], val[21]]);
          else if (et === 2 && val[51] !== undefined) pts.push(...arco([val[10], val[20]], val[40], val[50], val[51], 32));
        }
      }
      while (i < p.length && p[i][0] !== 97 && p[i][0] !== 92 && p[i][0] !== 75) i++;
      if (i < p.length && p[i][0] === 97) { const nb = parseInt(p[i][1], 10) || 0; i += 1 + nb; }
      res.push(pts);
    }
    return res;
  }

  // ================================================================== verificar
  async function verificar(entrada, o = {}) {
    const text = decode(entrada);
    const D = leer(text);
    const F = await cargarFuente(o);
    const ANCHO = o.anchoExtra || 1;
    // presentación: la de más entidades (si el modelo tiene más, el modelo), como el script Python
    const porBloque = new Map();
    for (const e of D.entities) {
      const own = (e.s(330) || '').toUpperCase();
      const k = e.n(67, 0) === 1 ? ('P:' + own) : 'MODEL';
      if (!porBloque.has(k)) porBloque.set(k, []); porBloque.get(k).push(e);
    }
    const lays = [];
    for (const L of D.layouts) {
      if (L.name.toUpperCase() === 'MODEL') continue;
      let ents = porBloque.get('P:' + L.br);
      if (!ents) { const bn = D.brName.get(L.br); const b = bn && D.blocks.get(bn.toUpperCase()); ents = b ? b.ents : []; }
      lays.push({ name: L.name, ents, layout: L });
    }
    const model = porBloque.get('MODEL') || [];
    let lay = lays.length ? lays.reduce((a, b) => (b.ents.length > a.ents.length ? b : a)) : { name: 'Model', ents: model };
    if (o.presentacion) lay = lays.find((l) => l.name.toUpperCase() === o.presentacion.toUpperCase()) || (o.presentacion.toUpperCase() === 'MODEL' ? { name: 'Model', ents: model } : lay);
    else if (model.length > lay.ents.length) lay = { name: 'Model', ents: model };
    const avisosPre = [];
    const enModelo = lay.name === 'Model' && !!o.sinBordeEnModelo; // en el Modelo no hay hoja: no se revisa el borde
    if (enModelo) avisosPre.push('En el Modelo no hay hoja: no se revisa el borde y las alturas van en unidades del dibujo. Para la regla de 2,5 mm, verifique en la plancha.');
    let HOJA = o.hoja || HOJA_DEF;
    if (!o.hoja && lay.layout && lay.layout.paper[0] > 0 && lay.layout.paper[1] > 0) {
      const [w, h] = lay.layout.paper; const rot = lay.layout.rot % 2 === 1;
      HOJA = rot ? [0, 0, h, w] : [0, 0, w, h];
    }

    const textos = [], segs = [], rellenos = [], tintaDe = [], puntos = [], candLL = [], duenos = [], avisos = [...avisosPre];
    const tipos = {}, capas = {}; let raster = 0;
    const addSegs = (pl, g) => { for (let i = 0; i + 1 < pl.length; i++) segs.push([pl[i], pl[i + 1], g]); };
    for (const e of lay.ents) {
      const t = e.type; tipos[t] = (tipos[t] || 0) + 1; const ly = e.s(8, '0'); capas[ly] = (capas[ly] || 0) + 1;
      if (t === 'IMAGE' || t === 'OLE2FRAME' || t === 'WIPEOUT') raster++;
      if (t === 'TEXT') {
        const caja = cajaTexto(e, D, F, ANCHO);
        if (caja.s.trim()) { textos.push(caja); tintaDe.push(e); }
      } else if (t === 'MTEXT') {
        for (const c of cajasMText(e, D, F, ANCHO)) { textos.push(c); tintaDe.push(e); }
      } else if (t === 'INSERT') {
        const b = D.blocks.get(e.s(2).toUpperCase());
        if (b) {
          const T = xformInsert(e, b.base);
          const esRot = /ROTULO|CAJETIN|TITLE|TITULO/i.test(b.name);
          if (esRot) for (const a of e.sub) if (a.type === 'ATTRIB' && !(a.n(70, 0) & 1)) { const c = cajaTexto(a, D, F, ANCHO); if (c.s.trim()) { textos.push(c); tintaDe.push(a); } }
          for (const v of b.ents) {
            if (esRot && v.type === 'TEXT') { const c = cajaTexto(v, D, F, ANCHO, T); if (c.s.trim()) { textos.push(c); tintaDe.push(v); } continue; }
            if (v.type === 'INSERT' || v.type === 'ATTDEF' || v.type === 'TEXT' || v.type === 'MTEXT') continue;
            const { out, rell } = trazos(v, T);
            for (const [pl, g] of out) addSegs(pl, g);
            rellenos.push(...rell);
          }
        }
      } else if (t !== 'VIEWPORT') {
        if (t === 'CIRCLE' && e.n(40) <= DOT_R) puntos.push([e.n(10), e.n(20)]);
        if (t === 'LWPOLYLINE' && ptsLW(e).length === 2 && !(e.n(70, 0) & 1)) candLL.push([segs.length, ptsLW(e)]);
        const { out, rell } = trazos(e);
        const col = e.has(62) ? e.n(62) : 256;
        const cerr = t === 'CIRCLE' || (t === 'LWPOLYLINE' && (e.n(70, 0) & 1)) || t === 'HATCH' || t === 'SOLID';
        for (const [pl, g] of out) {
          addSegs(pl, g);
          let largo = 0; for (let i = 0; i + 1 < pl.length; i++) largo += Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]);
          for (let i = 0; i + 1 < pl.length; i++) duenos.push([col, cerr ? pl : null, !!cerr, largo]);
        }
        rellenos.push(...rell);
      }
      while (duenos.length < segs.length) duenos.push([256, null, true, 0]);
    }

    const choq = [];
    const cajas = textos.map((x) => { const c = crecer(x.poly, MARGEN_TT / 2); return [c, bb(c)]; });
    const sb = segs.map((s) => bb([s[0], s[1]]));
    const rb = rellenos.map((r) => bb(r));
    textos.forEach((T, i) => {
      const { poly, s } = T; const [ci, bi] = cajas[i];
      const x0 = r1(poly[0][0]), y0 = r1(poly[0][1]);
      for (let k = i + 1; k < textos.length; k++) { if (T.mtextId && T.mtextId === textos[k].mtextId) continue; const [ck, bk] = cajas[k]; if (bbX(bi, bk) && polyPoly(ci, ck)) choq.push(['TEXTO-TEXTO', s, textos[k].s, x0, y0]); }
      for (let k = 0; k < segs.length; k++) {
        const [p, q, g] = segs[k]; const m = MARGEN + g / 2;
        if (!bbX([bi[0] - m, bi[1] - m, bi[2] + m, bi[3] + m], sb[k])) continue;
        if (segPoly(p, q, crecer(poly, m))) { choq.push(['TEXTO-TRAZO', s, `trazo (${f1(p[0])},${f1(p[1])})-(${f1(q[0])},${f1(q[1])}) g=${g.toFixed(2)}`, x0, y0]); break; }
      }
      for (let k = 0; k < rellenos.length; k++) if (bbX(bi, rb[k]) && polyPoly(poly, rellenos[k])) { choq.push(['TEXTO-RELLENO', s, 'achurado/solido', x0, y0]); break; }
      if (!enModelo && !poly.every(([x, y]) => HOJA[0] + 5 <= x && x <= HOJA[2] - 5 && HOJA[1] + 2 <= y && y <= HOJA[3] - 5)) choq.push(['TEXTO-BORDE DE HOJA', s, '', x0, y0]);
    });
    // textos del modelo que el borde de una ventana de la plancha corta (se verían partidos en el PDF/DWF)
    if (lay.layout && o.ventanas !== false) {
      const modelTxt = model.filter((e) => e.type === 'TEXT').map((e) => cajaTexto(e, D, F, ANCHO)).filter((c) => c.s.trim());
      for (const v of lay.ents) {
        if (v.type !== 'VIEWPORT' || v.n(69, 2) === 1 || v.n(68, 1) === 0) continue;
        const cx = v.n(10), cy = v.n(20), w = v.n(40), h = v.n(41), vh = v.n(45); if (!(w > 0 && h > 0 && vh > 0)) continue;
        const plan = Math.abs(v.n(16, 0)) < 1e-9 && Math.abs(v.n(26, 0)) < 1e-9;
        const tw = v.n(51, 0) * Math.PI / 180, c = Math.cos(tw), sn = Math.sin(tw);
        const d12 = plan ? c * v.n(12) + sn * v.n(22) : v.n(12), d22 = plan ? -sn * v.n(12) + c * v.n(22) : v.n(22); // centro en DCS → WCS (R2-fix)
        const vx = d12 + (plan ? v.n(17, 0) : 0), vy = d22 + (plan ? v.n(27, 0) : 0), k = h / vh;
        const P = ([x, y]) => { const X = (x - vx) * k, Y = (y - vy) * k; return [cx + c * X - sn * Y, cy + sn * X + c * Y]; };
        const R = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
        const dentro = ([x, y]) => x >= R[0] && x <= R[2] && y >= R[1] && y <= R[3];
        for (const T of modelTxt) {
          const q = T.poly.map(P); const n = q.filter(dentro).length;
          if (n > 0 && n < q.length) choq.push(['TEXTO-CORTADO POR VENTANA', T.s, `ventana ${v.n(69, 0)}`, r1(q[0][0]), r1(q[0][1])]);
        }
      }
    }
    // tinta real de las letras contra trazos (rótulos cortados por un marco)
    textos.forEach((T, i) => {
      const bi = cajas[i][1]; const { poly, s } = T;
      const ext = [bi[0] - 1.5, bi[1] - 1.5, bi[2] + 1.5, bi[3] + 1.5];
      const cerca = []; for (let k = 0; k < segs.length; k++) if (bbX(ext, sb[k])) cerca.push(k);
      if (!cerca.length) return;
      let hit = null;
      for (const [p, q] of tintaTexto(T, F)) {
        for (const k of cerca) if (distSS(p, q, segs[k][0], segs[k][1]) < MARGEN_TINTA + segs[k][2] / 2) { hit = segs[k]; break; }
        if (hit) break;
      }
      if (hit && !choq.some((c) => c[1] === s && c[0].startsWith('TEXTO')))
        choq.push(['TINTA-TRAZO', s, `trazo (${f1(hit[0][0])},${f1(hit[0][1])})-(${f1(hit[1][0])},${f1(hit[1][1])})`, r1(poly[0][0]), r1(poly[0][1])]);
    });
    // llamadas (línea de 2 puntos que termina en un punto relleno) que cruzan símbolos o textos
    let nll = 0;
    for (const [k0, [a, b]] of candLL) {
      const fin = [a, b].find((pp) => puntos.some((c) => Math.hypot(pp[0] - c[0], pp[1] - c[1]) < 0.05));
      if (!fin) continue;
      nll++;
      const ini = fin === b ? a : b;
      const L_ = Math.hypot(fin[0] - ini[0], fin[1] - ini[1]);
      if (L_ < 2.5) continue;
      const ux = (fin[0] - ini[0]) / L_, uy = (fin[1] - ini[1]) / L_;
      const q0 = [ini[0] + ux * 0.3, ini[1] + uy * 0.3], q1 = [fin[0] - ux * 2.0, fin[1] - uy * 2.0];
      const bq = bb([q0, q1]);
      const etq = `llamada (${f1(ini[0])},${f1(ini[1])})->(${f1(fin[0])},${f1(fin[1])})`;
      let cruzo = false;
      for (let k = 0; k < segs.length; k++) {
        const [p, q] = segs[k];
        if (k === k0 || !bbX(bq, sb[k])) continue;
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6) continue;
        const [col, recinto, cerr, largo] = duenos[k];
        if (col === 8) continue;                               // fondo gris: ladrillo, vías, otras llamadas
        if (recinto && ptIn(fin, recinto)) continue;           // borde del recinto que contiene el elemento señalado
        if (!cerr && largo >= LARGO_SIMBOLO) continue;         // línea larga (red, vía, cota): no es símbolo
        if (segX(q0, q1, p, q)) { choq.push(['LLAMADA-CRUZA', etq, `trazo (${f1(p[0])},${f1(p[1])})-(${f1(q[0])},${f1(q[1])})`, r1(ini[0]), r1(ini[1])]); cruzo = true; break; }
      }
      if (!cruzo) {
        for (let i = 0; i < textos.length; i++) {
          if (bbX(bq, cajas[i][1]) && segPoly(q0, q1, crecer(textos[i].poly, 0.2))) { choq.push(['LLAMADA-CRUZA', etq, 'texto ' + textos[i].s.slice(0, 40), r1(ini[0]), r1(ini[1])]); break; }
        }
      }
    }
    // alturas (2,5 mm en notas y convenciones: NC-RA8-001 6.3.1 c)
    const alturas = textos.map((x) => Math.round(x.h * 100) / 100).sort((x, y) => x - y);
    const bajas = textos.filter((x) => x.h < 2.495);
    const res = {
      archivo: o.nombre || '', presentacion: lay.name, hoja: HOJA.slice(2), entidades: Object.values(tipos).reduce((x, y) => x + y, 0), tipos, capasUsadas: capas, capasDefinidas: D.layers,
      raster, textos: textos.length, alturaMinima: alturas.length ? alturas[0] : null,
      menores2: alturas.filter((a) => a < 1.995).length, menores25: alturas.filter((a) => a < 2.495).length,
      llamadas: nll, colisiones: choq, avisos, metrica: `Liberation Sans${ANCHO !== 1 ? ' ×' + ANCHO : ''}`,
      textosBajos: bajas.map((x) => ({ texto: x.s, h: x.h, x: r1(x.poly[0][0]), y: r1(x.poly[0][1]) })),
    };
    res.informe = informe(res);
    return res;
  }

  function mtextLineas(s) {
    s = textoPlano(s);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{' || ch === '}') continue;
      if (ch !== '\\') { out += ch; continue; }
      const k = s[i + 1]; if (k === undefined) break;
      if (k === 'P' || k === 'N') { out += '\n'; i++; continue; }
      if (k === '~') { out += ' '; i++; continue; }
      if (k === '\\' || k === '{' || k === '}') { out += k; i++; continue; }
      if ('LlOoKk'.includes(k)) { i++; continue; }
      if (k === 'S') { const end = s.indexOf(';', i); out += (end > 0 ? s.slice(i + 2, end) : '').replace(/[\^#]/, '/'); i = end > 0 ? end : i + 1; continue; }
      const end = s.indexOf(';', i);
      if (end > 0 && 'ACcFfHQTWpX'.includes(k)) { i = end; continue; }
      i++;
    }
    return out.replace(/\r/g, '').split('\n');
  }
  function cajasMText(e0, D, F, ANCHO, T = ident) {
    const cut = e0.p.findIndex(([c]) => c === 101);
    const e = cut >= 0 ? new Ent(e0.type, e0.p.slice(0, cut)) : e0;
    let raw = ''; for (const [c, v] of e.p) if (c === 3 || c === 1) raw += v;
    const lines = mtextLineas(raw);
    if (!lines.some((l) => l.trim())) return [];
    const h = e.n(40, 2.5) * Math.abs(T.sy || 1), wf = 1;
    const st = D.styles.get(e.s(7, 'STANDARD').toUpperCase());
    const k = (esNarrow(st) ? NARROW : 1) * ANCHO;
    const refW = e.n(41, 0) * Math.abs(T.sx || 1);
    const att = parseInt(e.g(71, '1'), 10) || 1;
    const rot0 = e.has(11) ? Math.atan2(e.n(21), e.n(11)) : e.n(50, 0) * D2R;
    const a = rot0 + (T.rot || 0) * D2R, ca = Math.cos(a), sa = Math.sin(a);
    const wOf = (str) => F.ancho(str) * EM * h * wf * k;
    const spacing = h * 1.667 * (e.n(44, 1) || 1);
    const out = [];
    for (const ln of lines) {
      if (refW > 0 && wOf(ln) > refW * 1.02) {
        let cur = '';
        for (const word of ln.split(/(\s+)/)) {
          if (cur && wOf(cur + word) > refW) { out.push(cur.trimEnd()); cur = word.trimStart(); } else cur += word;
        }
        out.push(cur);
      } else out.push(ln);
    }
    const col = (att - 1) % 3, row = Math.floor((att - 1) / 3);
    const totalH = h + spacing * (out.length - 1);
    const topY = row === 0 ? 0 : row === 1 ? totalH / 2 : totalH;
    const ref = T.f([e.n(10), e.n(20)]);
    const res = [];
    out.forEach((str, i) => {
      if (!str.trim()) return;
      const w = wOf(str);
      const dx = col === 0 ? 0 : col === 1 ? -w / 2 : -w;
      const dy = topY - h - spacing * i;
      const d = /[gjpqy,;()]/.test(str) ? 0.22 * h : 0.05 * h;
      const pts = [[dx, dy - d], [dx + w, dy - d], [dx + w, dy + h], [dx, dy + h]];
      const poly = pts.map(([x, y]) => [ref[0] + x * ca - y * sa, ref[1] + x * sa + y * ca]);
      res.push({ poly, s: str, h, k, wf, ref, dx, dy, a, mtextId: e0 });
    });
    return res;
  }
  function cajaTexto(e, D, F, ANCHO, T = ident) {
    const str = textoPlano(e.g(1, ''));
    const h = e.n(40) * Math.abs(T.sy || 1), wf = e.n(41, 1) || 1;
    const st = D.styles.get(e.s(7, 'STANDARD').toUpperCase());
    const k = (esNarrow(st) ? NARROW : 1) * ANCHO;
    const w = F.ancho(str) * EM * h * wf * k;
    const ha = e.n(72, 0), va = e.n(73, 0);
    const ref = T.f((ha || va) && e.has(11) ? [e.n(11), e.n(21)] : [e.n(10), e.n(20)]);
    const dx = { 0: 0, 1: -w / 2, 2: -w, 4: -w / 2 }[ha] || 0;
    let dy = { 0: 0, 1: DESC * h, 2: -h / 2, 3: -h }[va] || 0;
    if (ha === 4) dy = -h / 2;
    const d = /[gjpqy,;()]/.test(str) ? 0.22 * h : 0.05 * h;
    const pts = [[dx, dy - d], [dx + w, dy - d], [dx + w, dy + h], [dx, dy + h]];
    const a = (e.n(50, 0) + (T.rot || 0)) * D2R, ca = Math.cos(a), sa = Math.sin(a);
    const poly = pts.map(([x, y]) => [ref[0] + x * ca - y * sa, ref[1] + x * sa + y * ca]);
    return { poly, s: str, h, k, wf, ref, dx, dy, a };
  }
  function tintaTexto(T, F) {
    const { s, h, k, wf, ref, dx, dy, a } = T; const ca = Math.cos(a), sa = Math.sin(a); const em = EM * h;
    return F.tinta(s).map(([p, q]) => [p, q].map(([x, y]) => { const X = x * em * wf * k + dx, Y = y * em + dy; return [ref[0] + X * ca - Y * sa, ref[1] + X * sa + Y * ca]; }));
  }

  function informe(r) {
    const L = [
      `archivo: ${r.archivo}`, `presentacion: ${r.presentacion} (hoja ${r.hoja.join(' x ')} mm)`,
      `entidades: ${r.entidades} ${JSON.stringify(Object.fromEntries(Object.entries(r.tipos).sort()))}`,
      `capas usadas: ${JSON.stringify(r.capasUsadas)}`, `capas definidas: ${JSON.stringify(r.capasDefinidas)}`, `raster/OLE: ${r.raster}`,
      `textos: ${r.textos} | altura minima: ${r.alturaMinima === null ? 'None' : r.alturaMinima.toFixed(1)} mm | < 2,0 mm: ${r.menores2} | < 2,5 mm: ${r.menores25}`,
      `llamadas revisadas: ${r.llamadas}`, `letra de medida: ${r.metrica}`,
      ...r.avisos.map((a) => 'AVISO ' + a),
      `COLISIONES: ${r.colisiones.length}`, ...r.colisiones.map((c) => '  ' + c.map((v) => (typeof v === 'number' ? v.toFixed(1) : v)).join(' | ')),
    ];
    return L.join('\n');
  }

  return { verificar, leer, parseTTF, textoPlano, informe, _geo: { segX, ptIn, polyPoly, crecer, arco } };
})();
if (typeof module !== 'undefined') module.exports = Verificador; else self.Verificador = Verificador;
