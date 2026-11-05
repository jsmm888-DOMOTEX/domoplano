// Domoplano — H6-E: COMPARAR (comparador de versiones de un plano, como DWGCOMPARE) — código propio.
// Compara dos DXF (versión anterior A y versión nueva B) por entidades: lo que no cambió, lo NUEVO (solo en B), lo
// BORRADO (solo en A) y lo CAMBIADO (mismo objeto con otra capa/color, otro texto, otros atributos o movido).
// También compara capas (nuevas, quitadas, con otro color/tipo de línea/grosor/estado), bloques y planchas, y hace la
// lista de textos nuevos, quitados y editados. Para DWF: compara dos DWF hoja por hoja (trazos y textos) y lista las
// MARCAS de revisión (Design Review) que trae el DWF nuevo; las marcas de un DWF también se pueden poner encima de un DXF.
// Sin código ni archivos de Autodesk: lee el DXF según su referencia pública (pares código/valor).
//
// Uso:  Comparador.compararDXF(textoA, textoB, { nombreA, nombreB }) → { items, espacios, capas, bloques, planchas, textos, informe }
//       await Comparador.compararDWF(bytesA, bytesB) · Comparador.marcasEnPapel(marcas, altoHoja) · Comparador.informeMD(r)
const Comparador = (() => {
  const V = (typeof Verificador !== 'undefined') ? Verificador : require('./verificador.js');
  const R2D = 180 / Math.PI, D2R = Math.PI / 180;

  // ================================================================ firma de una entidad
  const SALTAR = new Set([5, 105, 330, 340, 350, 360, 102, 100, 67, 410, 347, 348, 390, 92, 160, 310, 1000, 1001, 1002, 1003, 1004, 1005]);
  const PROPS = new Set([8, 6, 62, 370, 48, 420, 430, 440, 60, 284]);
  const DEF_PROPS = { 62: '256', 6: 'BYLAYER', 370: '-1', 48: '1', 60: '0', 284: '0' };
  const DEF_GEO = { 39: '0', 210: '0', 220: '0', 230: '1', 38: '0' };
  const DEF_TIPO = {
    TEXT: { 41: '1', 50: '0', 51: '0', 71: '0', 72: '0', 73: '0', 74: '0', 7: 'STANDARD' },
    ATTDEF: { 41: '1', 50: '0', 51: '0', 71: '0', 72: '0', 73: '0', 74: '0', 7: 'STANDARD' },
    ATTRIB: { 41: '1', 50: '0', 51: '0', 71: '0', 72: '0', 73: '0', 74: '0', 7: 'STANDARD' },
    MTEXT: { 50: '0', 7: 'STANDARD', 44: '1' },
    INSERT: { 41: '1', 42: '1', 43: '1', 50: '0', 70: '0', 71: '0', 44: '0', 45: '0', 66: '0' },
    LWPOLYLINE: { 43: '0', 70: '0', 40: '0', 41: '0', 42: '0', 90: '*' },
    DIMENSION: { 2: '*', 1: '', 3: '*' },
  };
  const esReal = (c) => (c >= 10 && c <= 59) || (c >= 110 && c <= 149) || (c >= 210 && c <= 239) || (c >= 460 && c <= 469) || (c >= 1010 && c <= 1059);
  const esEntero = (c) => (c >= 60 && c <= 99) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 370 && c <= 389) || (c >= 400 && c <= 409) || (c >= 1060 && c <= 1071);
  function norm(c, v, dec) {
    const s = String(v).trim();
    if (esReal(c)) { const x = parseFloat(s); if (!Number.isFinite(x)) return s; const r = +x.toFixed(dec); return String(Object.is(r, -0) ? 0 : r); }
    if (esEntero(c)) { const x = parseInt(s, 10); return Number.isFinite(x) ? String(x) : s; }
    return (c === 8 || c === 6 || c === 7 || c === 2) ? s.toUpperCase() : s;
  }
  /** Firma de una entidad: { geo, props, attrs } (cadenas comparables). dec = decimales al comparar coordenadas. */
  function firma(e, dec) {
    const T = DEF_TIPO[e.type] || {};
    const geo = [], props = {};
    const textoAlineado = (e.type === 'TEXT' || e.type === 'ATTRIB' || e.type === 'ATTDEF');
    let al72 = '0', al73 = '0';
    for (const [c, v] of e.p) if (c === 72) al72 = String(parseInt(v, 10) || 0); else if (c === 73) al73 = String(parseInt(v, 10) || 0);
    for (const [c, v0] of e.p) {
      if (SALTAR.has(c) || c >= 1000) continue;
      const v = norm(c, v0, dec);
      if (PROPS.has(c)) { if (DEF_PROPS[c] !== v.toUpperCase()) props[c] = c === 8 || c === 6 ? v.toUpperCase() : v; continue; }
      if (c === 7) { if (v.toUpperCase() !== 'STANDARD') props[7] = v.toUpperCase(); continue; }
      if (DEF_GEO[c] === v) continue;
      if (T[c] === '*' || T[c] === v) continue;
      if (textoAlineado && al72 === '0' && al73 === '0' && (c === 11 || c === 21 || c === 31)) continue;
      geo.push(c + '=' + v);
    }
    const attrs = [];
    for (const s of e.sub) {
      if (s.type === 'ATTRIB') attrs.push(s.s(2).toUpperCase() + '=' + s.s(1));
      else if (s.type === 'VERTEX') geo.push('V' + norm(10, s.g(10, 0), dec) + ',' + norm(20, s.g(20, 0), dec) + (s.n(42, 0) ? ',' + norm(42, s.g(42), dec) : ''));
    }
    const pk = Object.keys(props).sort().map((k) => k + '=' + props[k]).join(';');
    return { geo: e.type + '|' + geo.join(';'), props: pk, propsObj: props, attrs: attrs.join(';') };
  }

  // ================================================================ lectura: espacios (Modelo y planchas)
  /** Entidades de cada espacio: Map nombre → [entidades]. El Modelo se llama «Modelo». */
  function espaciosDe(D) {
    const porBloque = new Map();
    for (const e of D.entities) {
      const own = (e.g(330, '') || '').trim().toUpperCase();
      const k = e.n(67, 0) === 1 ? ('P:' + own) : 'MODEL';
      if (!porBloque.has(k)) porBloque.set(k, []); porBloque.get(k).push(e);
    }
    const out = new Map(); out.set('Modelo', porBloque.get('MODEL') || []);
    for (const L of D.layouts) {
      if (!L.name || L.name.toUpperCase() === 'MODEL') continue;
      let ents = porBloque.get('P:' + L.br);
      if (!ents) { const bn = D.brName.get(L.br); const b = bn && D.blocks.get(bn.toUpperCase()); ents = b ? b.ents : []; }
      out.set(L.name, ents);
    }
    // planchas sin objeto LAYOUT (DXF viejos): todo el papel junto
    if (out.size === 1) { const p = [...porBloque.entries()].filter(([k]) => k !== 'MODEL').flatMap(([, v]) => v); if (p.length) out.set('Papel', p); }
    return out;
  }
  /** Tabla de capas completa: nombre → {color, tipolin, grosor, apagada, inutilizada, bloqueada, imprime}. */
  function capasDe(text) {
    const L = text.split(/\r?\n/); const capas = new Map();
    let enTablas = false, cur = null;
    const cerrar = () => { if (cur && cur.nombre) capas.set(cur.nombre.toUpperCase(), cur); cur = null; };
    for (let i = 0; i + 1 < L.length; i += 2) {
      const c = parseInt(L[i], 10), v = (L[i + 1] || '').trim();
      if (Number.isNaN(c)) { i -= 1; continue; }
      if (c === 2 && L[i - 1] !== undefined && parseInt(L[i - 2], 10) === 0 && (L[i - 1] || '').trim() === 'SECTION') enTablas = v === 'TABLES';
      if (!enTablas) continue;
      if (c === 0) { cerrar(); if (v === 'LAYER') cur = { nombre: '', color: 7, tipolin: 'CONTINUOUS', grosor: -3, apagada: false, inutilizada: false, bloqueada: false, imprime: true }; if (v === 'ENDSEC') enTablas = false; continue; }
      if (!cur) continue;
      if (c === 2) cur.nombre = v;
      else if (c === 62) { const k = parseInt(v, 10); cur.color = Math.abs(k); cur.apagada = k < 0; }
      else if (c === 6) cur.tipolin = v.toUpperCase();
      else if (c === 370) cur.grosor = parseInt(v, 10);
      else if (c === 70) { const f = parseInt(v, 10) || 0; cur.inutilizada = !!(f & 1); cur.bloqueada = !!(f & 4); }
      else if (c === 290) cur.imprime = v !== '0';
    }
    cerrar();
    return capas;
  }
  const INSUNITS_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

  // ================================================================ geometría (para resaltar y ubicar)
  function arcoPts(cx, cy, r, a0, a1, n) {
    let s = a0 * D2R, e = a1 * D2R; while (e <= s) e += Math.PI * 2;
    const k = Math.max(4, Math.ceil(n * (e - s) / (Math.PI * 2))); const out = [];
    for (let i = 0; i <= k; i++) { const t = s + (e - s) * i / k; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    return out;
  }
  function bulgeTramo(a, b, bu, out) {
    if (!bu) { out.push(b); return; }
    const th = 4 * Math.atan(bu), d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 1e-12) { out.push(b); return; }
    const r = d / (2 * Math.sin(th / 2)); const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const h = r * Math.cos(th / 2); const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
    const cx = mx - uy * h, cy = my + ux * h; // centro a la izquierda para comba positiva
    const a0 = Math.atan2(a[1] - cy, a[0] - cx); const n = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 12)));
    for (let i = 1; i <= n; i++) { const t = a0 + th * i / n; out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]); }
    out[out.length - 1] = b;
  }
  const ident = { f: (p) => p, k: 1 };
  function xform(ins, base, T) {
    const sx = ins.n(41, 1) || 1, sy = ins.n(42, 1) || 1, rot = ins.n(50, 0) * D2R, c = Math.cos(rot), s = Math.sin(rot);
    const px = ins.n(10), py = ins.n(20), bx = base[0], by = base[1];
    const f = (p) => { const x = (p[0] - bx) * sx, y = (p[1] - by) * sy; return T.f([px + c * x - s * y, py + s * x + c * y]); };
    return { f, k: T.k * Math.sqrt(Math.abs(sx * sy)) };
  }
  /** Ancho aproximado de un texto (Liberation Sans ≈ 0,62 × altura por letra). */
  const anchoTexto = (s, h, wf = 1) => 0.62 * h * wf * Math.max(1, String(s).length);
  function cajaTxt(x, y, w, h, rot, dx = 0, dy = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [[dx, dy], [dx + w, dy], [dx + w, dy + h], [dx, dy + h], [dx, dy]].map(([u, v]) => [x + c * u - s * v, y + s * u + c * v]);
  }
  const limpiarMT = (s) => String(s || '').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/[{}]/g, '').replace(/\\~/g, ' ').trim();
  /** Texto legible de una entidad (TEXT/MTEXT/ATTDEF/INSERT con atributos). */
  function textoDe(e) {
    if (e.type === 'TEXT' || e.type === 'ATTDEF' || e.type === 'ATTRIB') return V.textoPlano(e.s(1));
    if (e.type === 'MTEXT') { let s = ''; for (const [c, v] of e.p) if (c === 3 || c === 1) s += v; return limpiarMT(s); }
    if (e.type === 'INSERT') return e.sub.filter((x) => x.type === 'ATTRIB').map((x) => V.textoPlano(x.s(1))).join(' · ');
    return '';
  }
  /** Polilíneas [[x,y]…] que dibujan la entidad (INSERT: su bloque transformado, hasta 3 niveles). */
  function geometria(e, D, T = ident, nivel = 0) {
    const f = T.f; const out = [];
    const P = (x, y) => f([x, y]);
    switch (e.type) {
      case 'LINE': out.push([P(e.n(10), e.n(20)), P(e.n(11), e.n(21))]); break;
      case 'LWPOLYLINE': {
        const vs = []; let cur = null;
        for (const [c, v] of e.p) { if (c === 10) { cur = [parseFloat(v), 0, 0]; vs.push(cur); } else if (c === 20 && cur) cur[1] = parseFloat(v); else if (c === 42 && cur) cur[2] = parseFloat(v) || 0; }
        if (!vs.length) break;
        const cerr = e.n(70, 0) & 1; const pts = [[vs[0][0], vs[0][1]]];
        for (let i = 0; i + 1 < vs.length + (cerr ? 1 : 0); i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; bulgeTramo([a[0], a[1]], [b[0], b[1]], a[2], pts); }
        out.push(pts.map((p) => f(p))); break;
      }
      case 'POLYLINE': {
        const vs = e.sub.filter((v) => v.type === 'VERTEX' && !(v.n(70, 0) & 16)).map((v) => [v.n(10), v.n(20), v.n(42, 0)]); if (!vs.length) break;
        const cerr = e.n(70, 0) & 1; const pts = [[vs[0][0], vs[0][1]]];
        for (let i = 0; i + 1 < vs.length + (cerr ? 1 : 0); i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; bulgeTramo([a[0], a[1]], [b[0], b[1]], a[2], pts); }
        out.push(pts.map((p) => f(p))); break;
      }
      case 'CIRCLE': out.push(arcoPts(e.n(10), e.n(20), e.n(40), 0, 360, 36).map((p) => f(p))); break;
      case 'ARC': out.push(arcoPts(e.n(10), e.n(20), e.n(40), e.n(50), e.n(51), 36).map((p) => f(p))); break;
      case 'ELLIPSE': {
        const cx = e.n(10), cy = e.n(20), mx = e.n(11), my = e.n(21), k = e.n(40, 1); let t0 = e.n(41, 0), t1 = e.n(42, Math.PI * 2); if (t1 <= t0) t1 += Math.PI * 2;
        const pts = []; for (let i = 0; i <= 36; i++) { const t = t0 + (t1 - t0) * i / 36; pts.push(f([cx + mx * Math.cos(t) - my * k * Math.sin(t), cy + my * Math.cos(t) + mx * k * Math.sin(t)])); }
        out.push(pts); break;
      }
      case 'SOLID': case 'TRACE': case '3DFACE': {
        const q = [[e.n(10), e.n(20)], [e.n(11), e.n(21)], [e.n(13, e.n(12)), e.n(23, e.n(22))], [e.n(12), e.n(22)]];
        out.push([...q, q[0]].map((p) => f(p))); break;
      }
      case 'POINT': { const x = e.n(10), y = e.n(20), d = 0.5 / (T.k || 1); out.push([P(x - d, y), P(x + d, y)], [P(x, y - d), P(x, y + d)]); break; }
      case 'TEXT': case 'ATTDEF': case 'ATTRIB': case 'MTEXT': {
        const s = textoDe(e); if (!s) break;
        const h = e.n(40, 2.5) || 2.5; const rot = (e.type === 'MTEXT' ? (e.has(11) ? Math.atan2(e.n(21), e.n(11)) : e.n(50, 0) * D2R) : e.n(50, 0) * D2R);
        if (e.type === 'MTEXT') {
          const w = e.n(41, 0) > 0 ? Math.min(e.n(41), anchoTexto(s, h)) : anchoTexto(s, h); const lineas = Math.max(1, Math.ceil(anchoTexto(s, h) / Math.max(w, 1e-9)));
          const alto = lineas * h * 1.6; const at = e.n(71, 1); const col = (at - 1) % 3, fila = Math.floor((at - 1) / 3);
          out.push(cajaTxt(e.n(10), e.n(20), w, alto, rot, -w * col / 2, -alto * (1 - fila / 2)).map((p) => f(p)));
        } else {
          const w = anchoTexto(s, h, e.n(41, 1) || 1); const h72 = e.n(72, 0), v73 = e.n(73, 0);
          const usa11 = (h72 || v73) && e.has(11); const x = usa11 ? e.n(11) : e.n(10), y = usa11 ? e.n(21) : e.n(20);
          const dx = h72 === 1 || h72 === 4 ? -w / 2 : h72 === 2 ? -w : 0; const dy = v73 === 2 ? -h / 2 : v73 === 3 ? -h : 0;
          out.push(cajaTxt(x, y, w, h, rot, dx, dy).map((p) => f(p)));
        }
        break;
      }
      case 'INSERT': {
        const b = D.blocks.get(e.s(2).toUpperCase());
        if (b && nivel < 3) { const T2 = xform(e, b.base, T); for (const v of b.ents) if (v.type !== 'ATTDEF') out.push(...geometria(v, D, T2, nivel + 1)); }
        for (const a of e.sub) if (a.type === 'ATTRIB') out.push(...geometria(a, D, T, nivel + 1));
        if (!out.length) { const x = e.n(10), y = e.n(20), d = 1; out.push([P(x - d, y - d), P(x + d, y + d)], [P(x - d, y + d), P(x + d, y - d)]); }
        break;
      }
      case 'DIMENSION': {
        const b = D.blocks.get(e.s(2).toUpperCase());
        if (b && b.ents.length && nivel < 3) { for (const v of b.ents) out.push(...geometria(v, D, T, nivel + 1)); break; }
        const p13 = [e.n(13), e.n(23)], p14 = [e.n(14), e.n(24)], p10 = [e.n(10), e.n(20)];
        out.push([f(p13), f(p14)], [f(p14), f(p10)]); break;
      }
      case 'IMAGE': case 'WIPEOUT': {
        const x = e.n(10), y = e.n(20), ux = e.n(11), uy = e.n(21), vx = e.n(12), vy = e.n(22), w = e.n(13, 1), h = e.n(23, 1);
        const q = [[x, y], [x + ux * w, y + uy * w], [x + ux * w + vx * h, y + uy * w + vy * h], [x + vx * h, y + vy * h], [x, y]];
        out.push(q.map((p) => f(p))); break;
      }
      case 'VIEWPORT': { const cx = e.n(10), cy = e.n(20), w = e.n(40) / 2, h = e.n(41) / 2; out.push([[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h]].map((p) => f(p))); break; }
      case 'SPLINE': case 'LEADER': case 'HATCH': case 'MULTILEADER': case 'MLINE': default: {
        // contorno aproximado: los puntos 10/20 (y 11/21 de los splines con puntos de ajuste) en su orden
        const pts = []; let x = null;
        for (const [c, v] of e.p) { if (c === 10 || (e.type === 'SPLINE' && c === 11)) x = parseFloat(v); else if ((c === 20 || (e.type === 'SPLINE' && c === 21)) && x !== null) { pts.push(f([x, parseFloat(v)])); x = null; } }
        if (e.type === 'HATCH' && pts.length > 1) pts.shift(); // el primer 10/20 del sombreado es el punto de elevación
        if (pts.length) out.push(pts);
      }
    }
    return out.filter((pl) => pl.length && pl.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  }
  function bbDe(geo) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const pl of geo) for (const [x, y] of pl) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    return Number.isFinite(a) ? [a, b, c, d] : null;
  }
  /** Reduce la geometría para dibujarla encima (máx. ~600 puntos por objeto). */
  function recortarGeo(geo) {
    let n = 0; for (const pl of geo) n += pl.length;
    if (n <= 600) return geo.map((pl) => pl.map(([x, y]) => [r4(x), r4(y)]));
    const b = bbDe(geo); return b ? [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] : [];
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const r2 = (v) => Math.round(v * 100) / 100;

  // ================================================================ comparar dos DXF
  const ETQ = { 62: 'color', 8: 'capa', 6: 'tipo de línea', 370: 'grosor', 48: 'escala de tipo de línea', 420: 'color verdadero', 440: 'transparencia', 60: 'visibilidad', 7: 'estilo de texto' };
  function difProps(pa, pb) {
    const ks = new Set([...Object.keys(pa), ...Object.keys(pb)]); const out = [];
    const def = (k) => (k === '8' ? '0' : DEF_PROPS[k] || (k === '7' ? 'STANDARD' : '—'));
    for (const k of ks) if ((pa[k] || def(k)) !== (pb[k] || def(k))) out.push(`${ETQ[k] || 'código ' + k}: ${pa[k] || def(k)} → ${pb[k] || def(k)}`);
    return out;
  }
  const centroDe = (bb) => (bb ? [r2((bb[0] + bb[2]) / 2), r2((bb[1] + bb[3]) / 2)] : null);

  /**
   * Compara dos DXF. o.decimales (4) = precisión de coordenadas; o.tolMover = distancia máxima para emparejar un objeto
   * movido (por omisión 2 % del tamaño del espacio, mínimo 1 unidad).
   */
  function compararDXF(textoA, textoB, o = {}) {
    const tA = decode(textoA);
    const tB = typeof textoB === 'string' ? textoB : decode(textoB);
    const DA = V.leer(tA), DB = V.leer(tB);
    const dec = o.decimales ?? 4;
    const EA = espaciosDe(DA), EB = espaciosDe(DB);
    const items = []; const espacios = [];
    const nombres = [...new Set([...EA.keys(), ...EB.keys()])];
    const planchas = { agregadas: [...EB.keys()].filter((k) => !EA.has(k)), borradas: [...EA.keys()].filter((k) => !EB.has(k)) };
    for (const esp of nombres) {
      const a = (EA.get(esp) || []).filter((e) => e.type !== 'VIEWPORT' || e.n(69, 2) !== 1);
      const b = (EB.get(esp) || []).filter((e) => e.type !== 'VIEWPORT' || e.n(69, 2) !== 1);
      const fa = a.map((e) => firma(e, dec)), fb = b.map((e) => firma(e, dec));
      const usadoA = new Uint8Array(a.length), usadoB = new Uint8Array(b.length);
      const cuenta = { iguales: 0, agregados: 0, borrados: 0, cambiados: 0 };
      const indice = (keyFn, arr, usado) => { const m = new Map(); arr.forEach((x, i) => { if (usado[i]) return; const k = keyFn(x, i); if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }); return m; };
      const emparejar = (keyA, keyB, fn) => {
        const m = indice(keyB, fb, usadoB);
        fa.forEach((x, i) => { if (usadoA[i]) return; const k = keyA(x, i); if (k == null) return; const L = m.get(k); if (!L) return; while (L.length && usadoB[L[0]]) L.shift(); if (!L.length) return; const j = L.shift(); usadoA[i] = 1; usadoB[j] = 1; fn(i, j); });
      };
      const geoA = (i) => geometria(a[i], DA), geoB = (j) => geometria(b[j], DB);
      const nuevoItem = (tipo, i, j, detalle) => {
        const eB = j != null ? b[j] : null, eA = i != null ? a[i] : null; const e = eB || eA;
        const gB = j != null ? geoB(j) : null, gA = i != null ? geoA(i) : null;
        const bb = bbDe(gB && gB.length ? gB : gA || []) || [e.n(10), e.n(20), e.n(10), e.n(20)];
        const it = { n: 0, tipo, espacio: esp, ent: e.type, capa: (e.s(8, '0') || '0'), detalle, centro: centroDe(bb), bb: bb.map(r2),
          handleA: eA ? eA.s(5) : null, handleB: eB ? eB.s(5) : null, texto: textoDe(e).slice(0, 160) };
        if (gB) it.geo = recortarGeo(gB); if (gA && tipo !== 'agregado') it.geoA = recortarGeo(gA);
        items.push(it); cuenta[tipo === 'agregado' ? 'agregados' : tipo === 'borrado' ? 'borrados' : 'cambiados']++;
      };
      // 1) idénticos
      emparejar((x) => x.geo + '#' + x.props + '#' + x.attrs, (x) => x.geo + '#' + x.props + '#' + x.attrs, () => { cuenta.iguales++; });
      // 2) misma geometría, otras propiedades (capa, color, tipo de línea, grosor, estilo)
      emparejar((x) => x.geo + '#' + x.attrs, (x) => x.geo + '#' + x.attrs, (i, j) => nuevoItem('cambiado', i, j, 'propiedades: ' + difProps(fa[i].propsObj, fb[j].propsObj).join(', ')));
      // 3) mismo bloque/texto en el mismo sitio con otros atributos u otro texto
      const sitio = (E) => (x, i) => { const e = E[i]; if (!/^(TEXT|MTEXT|ATTDEF|INSERT)$/.test(e.type)) return null; return e.type + '|' + (e.type === 'INSERT' ? e.s(2).toUpperCase() + '|' : '') + r2(e.n(10)) + ',' + r2(e.n(20)); };
      emparejar(sitio(a), sitio(b), (i, j) => {
        const ea = a[i], eb = b[j];
        if (ea.type === 'INSERT') {
          const ta = new Map(ea.sub.filter((s) => s.type === 'ATTRIB').map((s) => [s.s(2).toUpperCase(), V.textoPlano(s.s(1))]));
          const cambios = []; for (const s of eb.sub) if (s.type === 'ATTRIB') { const k = s.s(2).toUpperCase(), v = V.textoPlano(s.s(1)); if (ta.get(k) !== v) cambios.push(`${k}: «${ta.has(k) ? ta.get(k) : '—'}» → «${v}»`); }
          const otros = fa[i].geo !== fb[j].geo ? ['escala, giro u otros datos del bloque'] : [];
          const pr = difProps(fa[i].propsObj, fb[j].propsObj);
          nuevoItem('cambiado', i, j, [cambios.length ? 'atributos: ' + cambios.join('; ') : '', ...otros, pr.length ? 'propiedades: ' + pr.join(', ') : ''].filter(Boolean).join(' · ') || 'bloque cambiado');
        } else {
          const sa = textoDe(ea), sb = textoDe(eb);
          const pr = difProps(fa[i].propsObj, fb[j].propsObj);
          const ha = r2(ea.n(40, 0)), hb = r2(eb.n(40, 0)), ga = r2(ea.n(50, 0)), gb = r2(eb.n(50, 0));
          const otro = [ha !== hb ? `altura ${ha} → ${hb}` : '', ga !== gb ? `giro ${ga}° → ${gb}°` : ''].filter(Boolean).join(', ') || 'justificación, ancho o estilo';
          const det = [sa !== sb ? `texto: «${sa.slice(0, 120)}» → «${sb.slice(0, 120)}»` : otro, pr.length ? 'propiedades: ' + pr.join(', ') : ''].filter(Boolean).join(' · ');
          nuevoItem('cambiado', i, j, det);
          if (sa !== sb) items[items.length - 1].textoAntes = sa.slice(0, 160);
        }
      });
      // 4) movido o con otra forma: mismo tipo y capa, centro cercano y tamaño parecido (el más cercano primero)
      {
        const bbsA = a.map((e, i) => (usadoA[i] ? null : bbDe(geoA(i)))), bbsB = b.map((e, j) => (usadoB[j] ? null : bbDe(geoB(j))));
        let ext = null; for (const x of [...bbsA, ...bbsB]) if (x) ext = ext ? [Math.min(ext[0], x[0]), Math.min(ext[1], x[1]), Math.max(ext[2], x[2]), Math.max(ext[3], x[3])] : x.slice();
        const tol = o.tolMover ?? Math.max(1, ext ? 0.02 * Math.hypot(ext[2] - ext[0], ext[3] - ext[1]) : 1);
        const pares = [];
        const porTipo = new Map(); b.forEach((e, j) => { if (usadoB[j] || !bbsB[j]) return; const k = e.type + '|' + e.s(8, '0').toUpperCase(); if (!porTipo.has(k)) porTipo.set(k, []); porTipo.get(k).push(j); });
        a.forEach((e, i) => {
          if (usadoA[i] || !bbsA[i]) return; const L = porTipo.get(e.type + '|' + e.s(8, '0').toUpperCase()); if (!L) return;
          const ba = bbsA[i]; const ca = [(ba[0] + ba[2]) / 2, (ba[1] + ba[3]) / 2]; const ta = Math.hypot(ba[2] - ba[0], ba[3] - ba[1]);
          for (const j of L) {
            const bq = bbsB[j]; const cb = [(bq[0] + bq[2]) / 2, (bq[1] + bq[3]) / 2]; const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]); if (d > tol) continue;
            const tb = Math.hypot(bq[2] - bq[0], bq[3] - bq[1]); if (Math.abs(ta - tb) > Math.max(0.25 * Math.max(ta, tb), tol)) continue;
            // un texto solo se empareja si dice lo mismo (movido); un bloque, si es el mismo bloque
            if (/^(TEXT|MTEXT|ATTDEF)$/.test(e.type) && textoDe(e) !== textoDe(b[j])) continue;
            if (e.type === 'INSERT' && e.s(2).toUpperCase() !== b[j].s(2).toUpperCase()) continue;
            pares.push([d, i, j]);
          }
        });
        pares.sort((x, y) => x[0] - y[0]);
        for (const [d, i, j] of pares) {
          if (usadoA[i] || usadoB[j]) continue; usadoA[i] = 1; usadoB[j] = 1;
          const ba = bbsA[i], bq = bbsB[j]; const dx = (bq[0] + bq[2]) / 2 - (ba[0] + ba[2]) / 2, dy = (bq[1] + bq[3]) / 2 - (ba[1] + ba[3]) / 2;
          const sa = textoDe(a[i]), sb = textoDe(b[j]);
          const det = [d > 1e-6 ? `movido ${r2(Math.hypot(dx, dy))} (Δx ${r2(dx)}, Δy ${r2(dy)})` : 'otra forma o tamaño', sa !== sb ? `texto: «${sa.slice(0, 80)}» → «${sb.slice(0, 80)}»` : '', ...difProps(fa[i].propsObj, fb[j].propsObj)].filter(Boolean).join(' · ');
          nuevoItem('cambiado', i, j, det);
          if (sa !== sb) items[items.length - 1].textoAntes = sa.slice(0, 160);
        }
      }
      // 5) lo que quedó: nuevo (B) o borrado (A)
      b.forEach((e, j) => { if (!usadoB[j]) nuevoItem('agregado', null, j, 'nuevo en la versión nueva'); });
      a.forEach((e, i) => { if (!usadoA[i]) nuevoItem('borrado', i, null, 'quitado (estaba en la versión anterior)'); });
      espacios.push({ nombre: esp, objetosA: a.length, objetosB: b.length, ...cuenta, soloEn: !EA.has(esp) ? 'nueva' : !EB.has(esp) ? 'anterior' : null });
    }
    const orden = { borrado: 0, cambiado: 1, agregado: 2 };
    items.sort((x, y) => (x.espacio === y.espacio ? 0 : x.espacio === 'Modelo' ? -1 : y.espacio === 'Modelo' ? 1 : x.espacio < y.espacio ? -1 : 1) || orden[x.tipo] - orden[y.tipo] || (y.centro ? y.centro[1] : 0) - (x.centro ? x.centro[1] : 0) || (x.centro ? x.centro[0] : 0) - (y.centro ? y.centro[0] : 0));
    items.forEach((it, k) => { it.n = k + 1; });

    // capas
    const CA = capasDe(tA), CB = capasDe(tB);
    const capas = { agregadas: [], borradas: [], cambiadas: [] };
    for (const [k, c] of CB) if (!CA.has(k)) capas.agregadas.push(c.nombre);
    for (const [k, c] of CA) if (!CB.has(k)) capas.borradas.push(c.nombre);
    for (const [k, cb] of CB) {
      const ca = CA.get(k); if (!ca) continue; const d = [];
      if (ca.color !== cb.color) d.push(`color ${ca.color} → ${cb.color}`);
      if (ca.tipolin !== cb.tipolin) d.push(`tipo de línea ${ca.tipolin} → ${cb.tipolin}`);
      if (ca.grosor !== cb.grosor) d.push(`grosor ${ca.grosor} → ${cb.grosor}`);
      for (const [p, t] of [['apagada', 'apagada'], ['inutilizada', 'inutilizada'], ['bloqueada', 'bloqueada']]) if (ca[p] !== cb[p]) d.push(`${cb[p] ? '' : 'no '}${t}`);
      if (ca.imprime !== cb.imprime) d.push(cb.imprime ? 'ahora imprime' : 'ya no imprime');
      if (d.length) capas.cambiadas.push({ capa: cb.nombre, cambios: d });
    }
    // bloques (definiciones con nombre; sin los *Model/*Paper/*D…)
    const nb = (D) => new Map([...D.blocks.entries()].filter(([k]) => !k.startsWith('*')));
    const BA = nb(DA), BB = nb(DB);
    const bloques = { agregados: [], borrados: [], cambiados: [] };
    for (const [k, bl] of BB) {
      if (!BA.has(k)) { bloques.agregados.push(bl.name); continue; }
      const fx = (L) => L.map((e) => { const f = firma(e, dec); return f.geo + '#' + f.props; }).sort().join('\n');
      if (fx(BA.get(k).ents) !== fx(bl.ents)) bloques.cambiados.push(bl.name);
    }
    for (const [k, bl] of BA) if (!BB.has(k)) bloques.borrados.push(bl.name);
    // textos (por contenido, sin importar dónde estén)
    const textosDe = (E) => { const m = new Map(); for (const L of E.values()) for (const e of L) { const s = textoDe(e).trim(); if (s) m.set(s, (m.get(s) || 0) + 1); } return m; };
    const TA = textosDe(EA), TB = textosDe(EB);
    const textos = {
      nuevos: [...TB.keys()].filter((s) => (TB.get(s) || 0) > (TA.get(s) || 0)),
      quitados: [...TA.keys()].filter((s) => (TA.get(s) || 0) > (TB.get(s) || 0)),
      editados: items.filter((it) => it.textoAntes !== undefined).map((it) => ({ n: it.n, antes: it.textoAntes, ahora: it.texto, espacio: it.espacio, centro: it.centro })),
    };
    const unidades = (D) => { const h = D.header.$INSUNITS; return h ? parseInt(h[70], 10) || 0 : 0; };
    const r = {
      tipo: 'DXF', anterior: o.nombreA || 'A', nueva: o.nombreB || 'B', unidades: { anterior: unidades(DA), nueva: unidades(DB) },
      resumen: { iguales: espacios.reduce((s, e) => s + e.iguales, 0), agregados: espacios.reduce((s, e) => s + e.agregados, 0), borrados: espacios.reduce((s, e) => s + e.borrados, 0), cambiados: espacios.reduce((s, e) => s + e.cambiados, 0) },
      espacios, planchas, capas, bloques, textos, items,
    };
    r.sinCambios = !items.length && !capas.agregadas.length && !capas.borradas.length && !capas.cambiadas.length && !bloques.agregados.length && !bloques.borrados.length && !bloques.cambiados.length;
    r.informe = informe(r);
    return r;
  }
  function decode(u8) {
    if (typeof u8 === 'string') return u8;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); }
  }

  // ================================================================ comparar dos DWF (hoja por hoja)
  /** Hojas de un DWF: [{titulo, ancho, alto, trazos: [{k, color, texto, bb}], marcas: [...]}] (mm de papel, y hacia abajo). */
  async function hojasDWF(u8) {
    const Dw = (typeof DWF !== 'undefined') ? DWF : null; if (!Dw) throw new Error('No está cargado el lector de DWF (web/dwf.js).');
    const doc = await Dw.open(u8); const out = [];
    for (const p of doc.pages) {
      if (!p.build) continue;
      const root = await p.build(); const trazos = [];
      const ver = (n, enMarca) => {
        if (!n) return;
        if (n.markup) enMarca = true;
        if (n.k === 'g' && n.ch && n.ch.length === 1 && n.ch[0].k === 't') { if (!enMarca) trazos.push({ k: 't', color: n.ch[0].fill || '', texto: n.ch[0].str, bb: n.bb }); return; }
        if (n.k === 'g' && n.ch && n.ch.length === 1 && n.ch[0].k === 'i') { if (!enMarca) trazos.push({ k: 'i', color: '', texto: '', bb: n.bb }); return; }
        if (n.k === 'g') { for (const c of n.ch || []) ver(c, enMarca); return; }
        if (n.k === 'p' && !enMarca) trazos.push({ k: n.fill && !n.stroke ? 'relleno' : 'trazo', color: n.stroke || n.fill || '', texto: '', bb: n.bb });
      };
      ver(root, false);
      out.push({ titulo: p.title, ancho: p.width, alto: p.height, trazos, marcas: root.markups || [] });
    }
    return out;
  }
  async function compararDWF(u8A, u8B, o = {}) {
    const HA = await hojasDWF(u8A), HB = await hojasDWF(u8B);
    const items = []; const espacios = [];
    const clave = (t) => t.k + '|' + t.color + '|' + t.texto + '|' + t.bb.map((v) => Math.round(v * 5) / 5).join(',');
    const pares = HB.map((hb, i) => [HA.find((ha) => ha.titulo === hb.titulo) || (HA.length === HB.length ? HA[i] : null), hb]);
    for (const [ha, hb] of pares) {
      const nombre = hb.titulo; const cuenta = { iguales: 0, agregados: 0, borrados: 0, cambiados: 0 };
      const ta = ha ? ha.trazos : [], tb = hb.trazos;
      const m = new Map(); ta.forEach((t, i) => { const k = clave(t); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
      const usadoA = new Uint8Array(ta.length);
      const nuevos = [];
      tb.forEach((t) => { const L = m.get(clave(t)); if (L && L.length) { usadoA[L.shift()] = 1; cuenta.iguales++; } else nuevos.push(t); });
      const quitados = ta.filter((t, i) => !usadoA[i]);
      // textos que cambiaron en el mismo sitio
      const usadoQ = new Uint8Array(quitados.length);
      for (const t of nuevos) {
        let tipo = 'agregado', det = 'nuevo en el DWF nuevo', antes;
        if (t.k === 't') {
          const q = quitados.findIndex((x, i) => !usadoQ[i] && x.k === 't' && Math.abs(x.bb[0] - t.bb[0]) < 0.5 && Math.abs(x.bb[3] - t.bb[3]) < 0.5);
          if (q >= 0) { usadoQ[q] = 1; tipo = 'cambiado'; antes = quitados[q].texto; det = `texto: «${antes}» → «${t.texto}»`; }
        }
        items.push({ tipo, espacio: nombre, ent: t.k === 't' ? 'TEXTO' : t.k === 'i' ? 'IMAGEN' : t.k.toUpperCase(), capa: '', detalle: det, texto: t.texto, textoAntes: antes, bb: t.bb.map(r2), centro: centroDe(t.bb) });
        cuenta[tipo === 'agregado' ? 'agregados' : 'cambiados']++;
      }
      quitados.forEach((t, i) => { if (usadoQ[i]) return; items.push({ tipo: 'borrado', espacio: nombre, ent: t.k === 't' ? 'TEXTO' : t.k.toUpperCase(), capa: '', detalle: 'quitado (estaba en el DWF anterior)', texto: t.texto, bb: t.bb.map(r2), centro: centroDe(t.bb) }); cuenta.borrados++; });
      // marcas de revisión que trae el DWF nuevo y no el anterior (las observaciones de EPM)
      const mk = (x) => x.tipo + '|' + x.texto + '|' + x.bb.map((v) => Math.round(v)).join(',');
      // (y las del DWF anterior que no están en el nuevo: el DWF devuelto por EPM puede ser cualquiera de los dos)
      const yaA = new Set((ha ? ha.marcas : []).map(mk)), yaB = new Set(hb.marcas.map(mk));
      const marca = (x, origen) => items.push({ tipo: 'marca', origen, espacio: nombre, ent: 'MARCA ' + x.tipo, capa: '', numero: x.num || null, detalle: (x.texto ? `observación${x.num ? ' ' + x.num : ''}: ${x.texto}` : x.tipo) + (origen === 'anterior' ? ' (en el DWF anterior)' : ''), texto: x.texto || '', bb: x.bb.map(r2), centro: centroDe(x.focus || x.bb) });
      for (const x of hb.marcas) if (!yaA.has(mk(x))) marca(x, 'nueva');
      for (const x of (ha ? ha.marcas : [])) if (!yaB.has(mk(x))) marca(x, 'anterior');
      espacios.push({ nombre, objetosA: ta.length, objetosB: tb.length, ...cuenta, marcas: items.filter((i) => i.tipo === 'marca' && i.espacio === nombre).length, soloEn: ha ? null : 'nueva', ancho: hb.ancho, alto: hb.alto, anterior: ha ? ha.titulo : null });
    }
    const orden = { marca: 0, borrado: 1, cambiado: 2, agregado: 3 };
    items.sort((x, y) => (x.espacio < y.espacio ? -1 : x.espacio > y.espacio ? 1 : 0) || orden[x.tipo] - orden[y.tipo] || (x.numero || 1e9) - (y.numero || 1e9) || (x.centro ? x.centro[1] : 0) - (y.centro ? y.centro[1] : 0));
    items.forEach((it, k) => { it.n = k + 1; });
    const r = { tipo: 'DWF', anterior: o.nombreA || 'A', nueva: o.nombreB || 'B', coordenadas: 'mm de papel desde la esquina SUPERIOR izquierda (y hacia abajo)',
      resumen: { iguales: espacios.reduce((s, e) => s + e.iguales, 0), agregados: espacios.reduce((s, e) => s + e.agregados, 0), borrados: espacios.reduce((s, e) => s + e.borrados, 0), cambiados: espacios.reduce((s, e) => s + e.cambiados, 0), marcas: items.filter((i) => i.tipo === 'marca').length },
      espacios, planchas: { agregadas: pares.filter(([a]) => !a).map(([, b]) => b.titulo), borradas: HA.filter((h) => !pares.some(([a]) => a === h)).map((h) => h.titulo) },
      capas: { agregadas: [], borradas: [], cambiadas: [] }, bloques: { agregados: [], borrados: [], cambiados: [] },
      textos: { nuevos: items.filter((i) => i.tipo === 'agregado' && i.texto).map((i) => i.texto), quitados: items.filter((i) => i.tipo === 'borrado' && i.texto).map((i) => i.texto), editados: items.filter((i) => i.textoAntes !== undefined).map((i) => ({ n: i.n, antes: i.textoAntes, ahora: i.texto, espacio: i.espacio, centro: i.centro })) },
      items };
    r.sinCambios = !items.length;
    r.informe = informe(r);
    return r;
  }
  /** Marcas de un DWF (mm de papel, y hacia abajo) pasadas a coordenadas de la plancha DXF (mm, y hacia arriba). */
  function marcasEnPapel(marcas, altoHoja, espacio = '') {
    return marcas.map((m, k) => {
      const f = (b) => [r2(b[0]), r2(altoHoja - b[3]), r2(b[2]), r2(altoHoja - b[1])];
      const bb = f(m.bb), fo = f(m.focus || m.bb);
      return { n: k + 1, tipo: 'marca', espacio, ent: 'MARCA ' + m.tipo, capa: '', numero: m.num || null, detalle: m.texto ? `observación${m.num ? ' ' + m.num : ''}: ${m.texto}` : m.tipo, texto: m.texto || '', bb, centro: centroDe(fo),
        geo: [[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]], [bb[0], bb[1]]]] };
    });
  }

  // ================================================================ informes
  const NOMBRE = { agregado: 'NUEVO', borrado: 'BORRADO', cambiado: 'CAMBIADO', marca: 'MARCA EPM' };
  function informe(r) {
    const L = [];
    L.push(`COMPARAR (${r.tipo})  anterior: ${r.anterior}  ·  nueva: ${r.nueva}`);
    const s = r.resumen;
    L.push(`Sin cambios: ${s.iguales} · nuevos: ${s.agregados} · borrados: ${s.borrados} · cambiados: ${s.cambiados}${s.marcas != null ? ' · marcas de revisión: ' + s.marcas : ''}`);
    for (const e of r.espacios) L.push(`  ${e.anterior && e.anterior !== e.nombre ? e.anterior + ' → ' : ''}${e.nombre}${e.soloEn ? ` (solo en la ${e.soloEn})` : ''}: ${e.objetosA} → ${e.objetosB} objetos · ${e.agregados} nuevos · ${e.borrados} borrados · ${e.cambiados} cambiados`);
    if (r.planchas.agregadas.length || r.planchas.borradas.length) L.push(`Planchas nuevas: ${r.planchas.agregadas.join(', ') || '—'} · quitadas: ${r.planchas.borradas.join(', ') || '—'}`);
    if (r.capas.agregadas.length || r.capas.borradas.length || r.capas.cambiadas.length) {
      L.push(`Capas nuevas: ${r.capas.agregadas.join(', ') || '—'} · quitadas: ${r.capas.borradas.join(', ') || '—'}`);
      for (const c of r.capas.cambiadas) L.push(`  capa ${c.capa}: ${c.cambios.join(', ')}`);
    }
    if (r.bloques.agregados.length || r.bloques.borrados.length || r.bloques.cambiados.length) L.push(`Bloques nuevos: ${r.bloques.agregados.join(', ') || '—'} · quitados: ${r.bloques.borrados.join(', ') || '—'} · con otro dibujo: ${r.bloques.cambiados.join(', ') || '—'}`);
    if (r.textos.editados.length) { L.push(`Textos editados (${r.textos.editados.length}):`); for (const t of r.textos.editados.slice(0, 60)) L.push(`  #${t.n} «${t.antes}» → «${t.ahora}»`); }
    if (r.textos.nuevos.length) { L.push(`Textos nuevos (${r.textos.nuevos.length}):`); for (const t of r.textos.nuevos.slice(0, 60)) L.push(`  + ${t}`); }
    if (r.textos.quitados.length) { L.push(`Textos quitados (${r.textos.quitados.length}):`); for (const t of r.textos.quitados.slice(0, 60)) L.push(`  − ${t}`); }
    L.push('Lista:');
    for (const it of r.items.slice(0, 400)) L.push(`  ${it.n}. ${NOMBRE[it.tipo]} ${it.ent}${it.capa ? ' [' + it.capa + ']' : ''} en ${it.espacio} (${it.centro ? it.centro.join(', ') : '—'}): ${it.detalle}${it.tipo !== 'cambiado' && it.tipo !== 'marca' && it.texto ? ' «' + it.texto.slice(0, 80) + '»' : ''}`);
    if (r.items.length > 400) L.push(`  … y ${r.items.length - 400} más.`);
    if (r.sinCambios) L.push('Las dos versiones son iguales.');
    return L.join('\n');
  }
  function informeMD(r) {
    const s = r.resumen; const L = [];
    L.push(`# Comparación de versiones (${r.tipo})`, '', `- **Anterior:** ${r.anterior}`, `- **Nueva:** ${r.nueva}`, `- **Resumen:** ${s.iguales} sin cambios · 🟢 ${s.agregados} nuevos · 🔴 ${s.borrados} borrados · 🟠 ${s.cambiados} cambiados${s.marcas != null ? ' · 🟣 ' + s.marcas + ' marcas de revisión' : ''}`, '');
    L.push('| Hoja | Objetos antes → ahora | Nuevos | Borrados | Cambiados |', '|---|---|---|---|---|');
    for (const e of r.espacios) L.push(`| ${e.nombre}${e.soloEn ? ` (solo en la ${e.soloEn})` : ''} | ${e.objetosA} → ${e.objetosB} | ${e.agregados} | ${e.borrados} | ${e.cambiados} |`);
    if (r.capas.agregadas.length || r.capas.borradas.length || r.capas.cambiadas.length) {
      L.push('', '## Capas', `- Nuevas: ${r.capas.agregadas.join(', ') || '—'}`, `- Quitadas: ${r.capas.borradas.join(', ') || '—'}`);
      for (const c of r.capas.cambiadas) L.push(`- ${c.capa}: ${c.cambios.join(', ')}`);
    }
    if (r.textos.editados.length || r.textos.nuevos.length || r.textos.quitados.length) {
      L.push('', '## Textos');
      for (const t of r.textos.editados) L.push(`- #${t.n} «${t.antes}» → «${t.ahora}»`);
      for (const t of r.textos.nuevos.slice(0, 200)) L.push(`- ➕ ${t}`);
      for (const t of r.textos.quitados.slice(0, 200)) L.push(`- ➖ ${t}`);
    }
    L.push('', '## Lista de diferencias', '', '| # | Qué | Objeto | Hoja | Dónde (x, y) | Detalle |', '|---|---|---|---|---|---|');
    const ic = { agregado: '🟢 nuevo', borrado: '🔴 borrado', cambiado: '🟠 cambiado', marca: '🟣 marca EPM' };
    for (const it of r.items) L.push(`| ${it.n} | ${ic[it.tipo]} | ${it.ent}${it.capa ? ' (' + it.capa + ')' : ''} | ${it.espacio} | ${it.centro ? it.centro.join(', ') : '—'} | ${String(it.detalle + (it.tipo !== 'cambiado' && it.tipo !== 'marca' && it.texto ? ' «' + it.texto.slice(0, 80) + '»' : '')).replace(/\|/g, '/')} |`);
    if (r.sinCambios) L.push('', 'Las dos versiones son iguales.');
    return L.join('\n') + '\n';
  }

  return { compararDXF, compararDWF, hojasDWF, marcasEnPapel, informe, informeMD, geometria, bbDe, textoDe, espaciosDe, capasDe, firma, xform, ident, INSUNITS_MM };
})();
if (typeof module !== 'undefined') module.exports = Comparador; else self.Comparador = Comparador;
