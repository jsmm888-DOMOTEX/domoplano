// Domoplano — hito H3 «Dibujo EPM»: SIMETRIA, MATRIZ, EMPALME, CHAFLAN, BLOQUE, ATRDEF, DESCOMPONER, cotas (DIMENSION con
// su bloque), estilo de cota, DIRECTRIZ, SOMBREA (patrones propios, contorno por objetos o por punto interior con islas) y TABLA.
// Código propio a partir de la referencia pública del formato DXF y del comportamiento descrito en la ayuda pública de
// AutoCAD. Ni código ni archivos de Autodesk: los patrones de sombreado están dibujados por nosotros y tienen nombres propios.
const Dibujo = (() => {
  const S = Edit.Session.prototype;
  const F = (v) => Edit.fmt(v);
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const n2 = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
  const hnd = (r) => String(r.get(5, r.get(105, '')) || '').trim();
  const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]], sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]], mul2 = (a, k) => [a[0] * k, a[1] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1], len = (a) => Math.hypot(a[0], a[1]);
  const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const perp = (a) => [-a[1], a[0]];
  const TEXTOS = new Set(['TEXT', 'ATTRIB', 'ATTDEF']);
  const need2000 = (s) => (s.r12() ? { error: 'Esta función necesita un DXF 2000 o posterior (este es R12). Guárdelo como DXF 2010.' } : null);

  // ================================================================ transformaciones conformes (con reflexión)
  // C = {refl, deg, s, dx, dy}: p' = s·R(deg)·(refl ? (x, −y) : (x, y)) + (dx, dy)
  const reflOps = { pt: (x, y) => [x, -y], vec: (x, y) => [x, -y], s: 1, ang: (a) => Edit.norm360(-a), arc: (a0, a1, ccw) => [a0, a1, ccw ? 0 : 1], ell: (a0, a1, ccw) => [a0, a1, ccw ? 0 : 1], bulge: (b) => -b };
  function setOrInsert(p, code, v, afterCodes) {
    const i = p.findIndex((q) => q[0] === code);
    if (i >= 0) { p[i][1] = v; return; }
    let k = -1; for (const a of afterCodes) { k = p.findIndex((q) => q[0] === a); if (k >= 0) break; }
    p.splice(k < 0 ? p.length : k + 1, 0, [code, v]);
  }
  /** Reflexión respecto al eje X (y → −y). Las entidades reflejadas en OCS (extrusión −Z) quedan normales (+Z). */
  function reflectX(type, pairs, mir) {
    if (mir && Edit.OCS.has(type)) {
      const out = Edit.transformPairs(type, pairs, Edit.similarity({ deg: 180 }), false);
      return out ? out.map(([c, v]) => (c === 230 ? [230, '1.0'] : [c, v])) : null;
    }
    if (!Edit.MOVABLE.has(type)) return null;
    const out = pairs.map((q) => q.slice());
    if (type === 'HATCH') return Edit.hatchOps(out, reflOps);
    const R = Edit.RULES[type] || {};
    let embedded = false;
    for (let i = 0; i < out.length; i++) {
      const c = out[i][0];
      if (c === 101) { embedded = true; continue; }
      const pts = embedded ? [10, 11] : [...(R.pt || []), ...(R.vec || [])];
      if (pts.includes(c)) { for (let j = i + 1; j < out.length && j < i + 4; j++) if (out[j][0] === c + 10) { out[j][1] = F(-parseFloat(out[j][1])); break; } continue; }
      if (embedded) continue;
      if (c === 42 && (type === 'LWPOLYLINE' || type === 'VERTEX')) out[i][1] = F(-parseFloat(out[i][1]));
      else if (c === 50 && TEXTOS.has(type)) out[i][1] = F(Edit.norm360(-parseFloat(out[i][1])));
      else if (c === 50 && type === 'MTEXT') out[i][1] = F(-parseFloat(out[i][1]));
    }
    if (type === 'ARC') { const a0 = parseFloat(out.find((q) => q[0] === 50)[1]), a1 = parseFloat(out.find((q) => q[0] === 51)[1]);
      out.find((q) => q[0] === 50)[1] = F(Edit.norm360(-a1)); out.find((q) => q[0] === 51)[1] = F(Edit.norm360(-a0)); }
    if (type === 'ELLIPSE') { const g = (c, d) => { const q = out.find((x) => x[0] === c); return q ? parseFloat(q[1]) : d; };
      const s0 = g(41, 0), s1 = g(42, TAU); setOrInsert(out, 41, F(n2(-s1)), [40]); setOrInsert(out, 42, F(n2(-s0) || TAU), [41]); }
    if (type === 'INSERT') {
      const g = (c, d) => { const q = out.find((x) => x[0] === c); return q ? parseFloat(q[1]) : d; };
      const sx = g(41, 1), a = g(50, 0);
      setOrInsert(out, 41, F(-sx), [30, 20]); setOrInsert(out, 42, F(g(42, 1)), [41]); setOrInsert(out, 43, F(g(43, 1)), [42]);
      setOrInsert(out, 50, F(Edit.norm360(180 - a)), [43, 42, 41]);
    }
    return out;
  }
  /** Texto legible después de reflejar (MIRRTEXT = 0, como AutoCAD por omisión): se elige la orientación más cercana a la
   *  original y se cambia la justificación (izquierda↔derecha o arriba↔abajo) para que el texto ocupe el mismo lugar. */
  const angDist = (a, b) => { const d = Math.abs(Edit.norm360(a - b)); return Math.min(d, 360 - d); };
  function legible(type, orig, out) {
    const og = (c, d) => { const q = orig.find((x) => x[0] === c); return q ? parseFloat(q[1]) : d; };
    const p = out;
    const g = (c, d) => { const q = p.find((x) => x[0] === c); return q ? parseFloat(q[1]) : d; };
    if (type === 'MTEXT') {
      const has11 = p.some((q) => q[0] === 11);
      const a0 = orig.some((q) => q[0] === 11) ? Math.atan2(og(21, 0), og(11, 1)) / DEG : og(50, 0) / DEG;
      const f = has11 ? Math.atan2(g(21, 0), g(11, 1)) / DEG : g(50, 0) / DEG;
      const att = Math.min(9, Math.max(1, Math.round(g(71, 1)))); let col = (att - 1) % 3, row = Math.floor((att - 1) / 3);
      let rot = f;
      if (angDist(f + 180, a0) < angDist(f, a0) - 1e-9) { rot = f + 180; col = 2 - col; } else row = 2 - row;
      setOrInsert(p, 71, String(row * 3 + col + 1), [41, 40]);
      if (has11) { const i = p.findIndex((q) => q[0] === 11); p[i][1] = F(Math.cos(rot * DEG)); p[i + 1][1] = F(Math.sin(rot * DEG)); }
      else setOrInsert(p, 50, F(rot * DEG), [41, 40]);
      return p;
    }
    const a0 = og(50, 0), f = g(50, 0);
    const vcode = type === 'TEXT' ? 73 : 74;
    const ha = Math.round(og(72, 0)), va = Math.round(og(vcode, 0));
    const P10 = [g(10, 0), g(20, 0)], P11 = p.some((q) => q[0] === 11) ? [g(11, 0), g(21, 0)] : P10;
    const anchor = ha === 0 && va === 0 ? P10 : P11;
    let nh = ha, nv = va, rot = f;
    if (angDist(f + 180, a0) < angDist(f, a0) - 1e-9) {
      rot = f + 180;
      if (ha === 3 || ha === 5) { // alineado / ajustado: se invierte la línea base
        const i10 = p.findIndex((q) => q[0] === 10), i11 = p.findIndex((q) => q[0] === 11);
        if (i11 >= 0) { const t0 = p[i10][1], t1 = p[i10 + 1][1]; p[i10][1] = p[i11][1]; p[i10 + 1][1] = p[i11 + 1][1]; p[i11][1] = t0; p[i11 + 1][1] = t1; }
      } else nh = { 0: 2, 2: 0 }[ha] ?? ha;
    } else if (!(ha === 3 || ha === 5)) nv = { 0: 3, 1: 3, 3: 0 }[va] ?? va;
    setOrInsert(p, 50, F(Edit.norm360(rot)), [1, 40]);
    if (nh !== ha) setOrInsert(p, 72, String(nh), [50, 41, 1]);
    if (nv !== va) {
      if (type === 'TEXT') { // 73 va después del segundo «100 AcDbText»
        const i = p.findIndex((q) => q[0] === 73); if (i >= 0) p[i][1] = String(nv);
        else { let k = -1; p.forEach((q, j) => { if (q[0] === 100 && String(q[1]).trim() === 'AcDbText') k = j; }); p.splice(k < 0 ? p.length : k + 1, 0, [73, String(nv)]); }
      } else setOrInsert(p, 74, String(nv), [70, 2]);
    }
    if (nh !== 0 || nv !== 0) { // el punto de alineación (11) es el que manda
      if (p.some((q) => q[0] === 11)) { const i = p.findIndex((q) => q[0] === 11); if (!(ha === 3 || ha === 5)) { p[i][1] = F(anchor[0]); p[i + 1][1] = F(anchor[1]); } }
      else { const k = p.findIndex((q) => q[0] === 72); const at = k >= 0 ? k + 1 : p.findIndex((q) => q[0] === 1) + 1; p.splice(at, 0, [11, F(anchor[0])], [21, F(anchor[1])], [31, '0.0']); }
    } else { const i = p.findIndex((q) => q[0] === 10); p[i][1] = F(anchor[0]); p[i + 1][1] = F(anchor[1]); }
    return p;
  }
  function conform(type, pairs, C, mir) {
    const T = Edit.similarity({ deg: C.deg, s: C.s, dx: C.dx, dy: C.dy });
    if (!C.refl) return Edit.transformPairs(type, pairs, T, mir);
    const r = reflectX(type, pairs, mir); if (!r) return null;
    let out = Edit.transformPairs(type, r, T, false);
    if (out && !mir && (TEXTOS.has(type) || type === 'MTEXT')) out = legible(type, pairs, out);
    return out;
  }
  const cPt = (C, x, y) => { const yy = C.refl ? -y : y; const r = C.deg * DEG, c = Math.cos(r) * C.s, s = Math.sin(r) * C.s; return [c * x - s * yy + C.dx, s * x + c * yy + C.dy]; };
  const cAng = (C, a) => (C.refl ? C.deg - a : a + C.deg); // grados
  const fromT = (T) => ({ refl: false, deg: T.deg, s: T.s, dx: T.m[4], dy: T.m[5] });
  /** Reflexión respecto a la recta p1→p2. */
  function mirrorC(p1, p2) {
    const phi = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const C = { refl: true, deg: 2 * phi / DEG, s: 1, dx: 0, dy: 0 };
    const q = cPt(C, p1[0], p1[1]); C.dx = p1[0] - q[0]; C.dy = p1[1] - q[1];
    return C;
  }
  const xfOf = (C) => { const f = (type, p, mir) => conform(type, p, C, mir); f.C = C; return f; };

  /** SIMETRIA (MIRROR): copia reflejada respecto a la recta p1–p2; borrar = quita los originales. Textos legibles (MIRRTEXT 0). */
  S.simetria = function (recs, p1, p2, borrar, page) {
    if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 1e-12) return { error: 'Los dos puntos de la línea de simetría son iguales.' };
    const xf = xfOf(mirrorC(p1, p2));
    if (borrar) { const r = this.transform(recs, null, 'Simetría', xf); return { ok: r.done > 0, n: r.done, refused: r.refused }; }
    const res = this.copyRecs(recs, null, page, xf);
    if (!res.recs.length) return { ok: false, n: 0, refused: res.refused };
    this.commit(`Simetría ${res.copied}`, { adds: res.recs, newBlocks: res.newBlocks });
    return { ok: true, n: res.copied, refused: res.refused, recs: res.recs };
  };

  // ================================================================ MATRIZ (ARRAY clásico: copias independientes)
  /** Rectangular: filas × columnas con distancias (negativas = hacia abajo / izquierda), girada ang grados. */
  S.matrizRect = function (recs, filas, cols, dFila, dCol, page, ang = 0) {
    filas = Math.round(filas); cols = Math.round(cols);
    if (!(filas >= 1 && cols >= 1) || filas * cols < 2) return { error: 'Se necesitan al menos 2 elementos (filas × columnas).' };
    if (filas * cols > 10000) return { error: 'Demasiados elementos (máximo 10 000).' };
    const c = Math.cos(ang * DEG), s = Math.sin(ang * DEG);
    const adds = [], newBlocks = []; let refused = [];
    for (let i = 0; i < filas; i++) for (let j = 0; j < cols; j++) {
      if (!i && !j) continue;
      const x = j * dCol, y = i * dFila;
      const r = this.copyRecs(recs, Edit.similarity({ dx: c * x - s * y, dy: s * x + c * y }), page);
      adds.push(...r.recs); newBlocks.push(...r.newBlocks); refused = r.refused;
    }
    if (!adds.length) return { error: 'No se pudo copiar ningún objeto.', refused };
    this.commit(`Matriz ${filas}×${cols}`, { adds, newBlocks });
    return { ok: true, n: filas * cols - 1, refused };
  };
  /** Polar: n elementos alrededor del centro en `total` grados (360 = vuelta completa); rotar = girar cada copia. base =
   *  punto de referencia de los objetos cuando no se giran. */
  S.matrizPolar = function (recs, centro, n, total, rotar, page, base) {
    n = Math.round(n);
    if (!(n >= 2)) return { error: 'Se necesitan al menos 2 elementos.' };
    if (n > 10000) return { error: 'Demasiados elementos (máximo 10 000).' };
    if (!total) return { error: 'El ángulo a llenar no puede ser 0.' };
    const paso = Math.abs(Math.abs(total) - 360) < 1e-9 ? total / n : total / (n - 1);
    const adds = [], newBlocks = []; let refused = [];
    for (let k = 1; k < n; k++) {
      const a = paso * k; let T;
      if (rotar) T = Edit.similarity({ base: centro, deg: a });
      else { const b = base || centro; const r = a * DEG; const q = [centro[0] + Math.cos(r) * (b[0] - centro[0]) - Math.sin(r) * (b[1] - centro[1]), centro[1] + Math.sin(r) * (b[0] - centro[0]) + Math.cos(r) * (b[1] - centro[1])]; T = Edit.similarity({ dx: q[0] - b[0], dy: q[1] - b[1] }); }
      const r = this.copyRecs(recs, T, page);
      adds.push(...r.recs); newBlocks.push(...r.newBlocks); refused = r.refused;
    }
    if (!adds.length) return { error: 'No se pudo copiar ningún objeto.', refused };
    this.commit(`Matriz polar ${n}`, { adds, newBlocks });
    return { ok: true, n: n - 1, refused };
  };

  // ================================================================ EMPALME y CHAFLAN
  const lineEnds = (r) => [[r.num(10), r.num(20)], [r.num(11), r.num(21)]];
  function lineX(a1, b1, a2, b2) {
    const d1 = sub2(b1, a1), d2 = sub2(b2, a2), den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12 * len(d1) * len(d2)) return null;
    const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
    return add2(a1, mul2(d1, t));
  }
  const setLine = (rec, a, b) => { const m = { 10: a[0], 20: a[1], 11: b[0], 21: b[1] }; const done = new Set(); return rec.p.map(([c, v]) => (c in m && !done.has(c) ? (done.add(c), [c, F(m[c])]) : [c, v])); };
  const propsCopia = (rec) => rec.p.filter((q) => [6, 62, 370, 48, 420].includes(q[0])).map((q) => q.slice());
  /**
   * EMPALME (FILLET) o CHAFLAN (CHAMFER) entre dos LÍNEAS. pick1/pick2 = puntos donde se designó cada línea (indican el lado
   * que queda). o = {radio} o {d1, d2}. Radio 0 = esquina viva (recortar/alargar hasta el cruce).
   */
  S.esquina = function (r1, pick1, r2, pick2, o, page) {
    if (r1 === r2) return { error: 'Designe dos objetos distintos.' };
    if (r1.type !== 'LINE' || r2.type !== 'LINE') return { error: 'EMPALME/CHAFLAN entre dos objetos trabaja con líneas (para polilíneas use la opción Polilínea).' };
    const [a1, b1] = lineEnds(r1), [a2, b2] = lineEnds(r2);
    const P = lineX(a1, b1, a2, b2); if (!P) return { error: 'Las líneas son paralelas.' };
    const lado = (a, b, pick) => {
      const d = unit(sub2(b, a)); let s = dot(sub2(pick, P), d);
      if (Math.abs(s) < 1e-12) s = Math.abs(dot(sub2(a, P), d)) > Math.abs(dot(sub2(b, P), d)) ? dot(sub2(a, P), d) : dot(sub2(b, P), d);
      const u = s >= 0 ? d : mul2(d, -1);
      const far = dot(sub2(a, P), u) >= dot(sub2(b, P), u) ? 'a' : 'b';
      return { u, far, farLen: Math.max(dot(sub2(a, P), u), dot(sub2(b, P), u)) };
    };
    const L1 = lado(a1, b1, pick1), L2 = lado(a2, b2, pick2);
    const cosf = Math.max(-1, Math.min(1, dot(L1.u, L2.u))), phi = Math.acos(cosf);
    if (phi < 1e-9 || Math.PI - phi < 1e-9) return { error: 'Las líneas son paralelas.' };
    let t1, t2, extra = null;
    const esChaflan = o.d1 !== undefined;
    if (esChaflan) { t1 = o.d1; t2 = o.d2 ?? o.d1; }
    else { const r = o.radio || 0; t1 = t2 = r > 0 ? r / Math.tan(phi / 2) : 0; }
    if (t1 > L1.farLen + 1e-9 || t2 > L2.farLen + 1e-9) return { error: esChaflan ? 'Las distancias de chaflán son mayores que las líneas.' : 'El radio es demasiado grande para esas líneas.' };
    const T1 = add2(P, mul2(L1.u, t1)), T2 = add2(P, mul2(L2.u, t2));
    const mods = [
      { rec: r1, pairs: L1.far === 'a' ? setLine(r1, a1, T1) : setLine(r1, T1, b1) },
      { rec: r2, pairs: L2.far === 'a' ? setLine(r2, a2, T2) : setLine(r2, T2, b2) },
    ];
    const layer = (r1.get(8, '0') || '0').trim();
    if (esChaflan && (t1 > 0 || t2 > 0)) extra = this.make(page, 'LINE', 'AcDbLine', [...propsCopia(r1), [10, T1[0]], [20, T1[1]], [30, 0], [11, T2[0]], [21, T2[1]], [31, 0]], layer);
    else if (!esChaflan && o.radio > 0) {
      const C = add2(P, mul2(unit(add2(L1.u, L2.u)), o.radio / Math.sin(phi / 2)));
      let g0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), g1 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
      if (n2(g1 - g0) > Math.PI) [g0, g1] = [g1, g0];
      extra = this.make(page, 'ARC', 'AcDbCircle', [...propsCopia(r1), [10, C[0]], [20, C[1]], [30, 0], [40, o.radio], [100, 'AcDbArc'], [50, Edit.norm360(g0 / DEG)], [51, Edit.norm360(g1 / DEG)]], layer);
    }
    this.commit(esChaflan ? 'Chaflán' : 'Empalme', { mods, adds: extra ? [extra] : [] });
    return { ok: true, nuevo: extra };
  };
  /** EMPALME/CHAFLAN de todos los vértices de una polilínea (opción Polilínea de AutoCAD). */
  S.esquinaPol = function (rec, o) {
    if (rec.type !== 'LWPOLYLINE') return { error: 'Designe una polilínea.' };
    const { verts, closed } = Geom.lwSegs(rec);
    const n = verts.length; if (n < 3) return { error: 'La polilínea necesita al menos 3 vértices.' };
    const esChaflan = o.d1 !== undefined;
    const out = []; let hechos = 0, cortos = 0;
    for (let k = 0; k < n; k++) {
      const V = verts[k];
      const prevI = k - 1 < 0 ? (closed ? n - 1 : -1) : k - 1, nextI = k + 1 >= n ? (closed ? 0 : -1) : k + 1;
      if (prevI < 0 || nextI < 0 || Math.abs(verts[prevI][2]) > 1e-12 || Math.abs(V[2]) > 1e-12) { out.push(V.slice()); continue; }
      const A = verts[prevI], B = verts[nextI];
      const u1 = unit(sub2(A, V)), u2 = unit(sub2(B, V));
      const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
      if (phi < 1e-9 || Math.PI - phi < 1e-6) { out.push(V.slice()); continue; }
      const l1 = len(sub2(A, V)), l2 = len(sub2(B, V));
      const lim1 = l1 * ((!closed && prevI === 0) ? 1 : 0.5), lim2 = l2 * ((!closed && nextI === n - 1) ? 1 : 0.5);
      let t1, t2; if (esChaflan) { t1 = o.d1; t2 = o.d2 ?? o.d1; } else t1 = t2 = (o.radio || 0) / Math.tan(phi / 2);
      if (!(t1 > 0 || t2 > 0)) { out.push(V.slice()); continue; }
      if (t1 > lim1 + 1e-9 || t2 > lim2 + 1e-9) { cortos++; out.push(V.slice()); continue; }
      const T1 = add2(V, mul2(u1, t1)), T2 = add2(V, mul2(u2, t2));
      const turn = Math.sign((V[0] - A[0]) * (B[1] - V[1]) - (V[1] - A[1]) * (B[0] - V[0]));
      out.push([T1[0], T1[1], esChaflan ? 0 : turn * Math.tan((Math.PI - phi) / 4)], [T2[0], T2[1], 0]);
      hechos++;
    }
    if (!hechos) return { error: cortos ? 'Los tramos son demasiado cortos para ese radio o distancia.' : 'No hay esquinas que empalmar.' };
    this.commit(esChaflan ? 'Chaflán polilínea' : 'Empalme polilínea', { mods: [{ rec, pairs: Geom.lwPairs(rec, out, closed) }] });
    return { ok: true, n: hechos, cortos };
  };

  // ================================================================ BLOQUES
  /** Arma (sin agregar) un bloque nuevo: registro de BLOCK_RECORD + BLOCK/ENDBLK. Devuelve {b, br}. */
  S._bloqueNuevo = function (name, base, flags) {
    const t = this.tbl('BLOCK_RECORD');
    const brH = this.newHandle();
    const br = this.tableRec('BLOCK_RECORD', 'BLOCK_RECORD', [[5, brH], [330, (t.head.get(5, '0') || '0').trim()], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbBlockTableRecord'],
      [2, name], [340, '0'], [70, '0'], [280, '1'], [281, '0']]);
    const head = new DXF.Rec('BLOCK', [[5, this.newHandle()], [330, brH], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbBlockBegin'], [2, name], [70, String(flags)],
      [10, F(base[0])], [20, F(base[1])], [30, '0.0'], [3, name], [1, '']]);
    const end = new DXF.Rec('ENDBLK', [[5, this.newHandle()], [330, brH], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbBlockEnd']]);
    return { b: { name, base: base.slice(), flags, owner: brH, ents: [], head, end, isNew: true, deleted: true }, br };
  };
  /** Pares de una entidad que pasa a otro dueño (bloque o plancha): handle nuevo, dueño 330 y marca de espacio papel. */
  S._retarget = function (pairs, owner, paper) {
    let p = Edit.stripReactors(pairs).filter((q) => q[0] !== 67 && q[0] !== 5);
    const k0 = p.findIndex((q) => q[0] === 100); p = p.filter((q, i) => !(q[0] === 330 && (k0 < 0 || i < k0)));
    const k = p.findIndex((q) => q[0] === 100 && String(q[1]).trim() === 'AcDbEntity');
    const head = [[5, this.newHandle()], [330, owner]];
    if (k >= 0) { p.splice(k + 1, 0, ...(paper ? [[67, '1']] : [])); return [...head, ...p]; }
    return [...head, ...p];
  };
  /** Nombre libre del estilo «*D7» (bloques anónimos de cotas) o de un nombre base. */
  S._nombreLibre = function (base, anon) {
    const usados = new Set([...this.D.blocks.keys()]); this.tblRecs('BLOCK_RECORD').forEach((r) => usados.add(up(r.get(2, ''))));
    if (anon) { let k = 1; for (const n of usados) { const m = /^\*D(\d+)$/.exec(n); if (m) k = Math.max(k, +m[1] + 1); } while (usados.has('*D' + k)) k++; return '*D' + k; }
    let n = base, k = 2; while (usados.has(up(n))) n = `${base}_${k++}`; return n;
  };
  /**
   * BLOQUE (BLOCK): crea un bloque con nombre a partir de los objetos y el punto base. modo = 'convertir' (por omisión: los
   * objetos se reemplazan por una inserción del bloque), 'retener' (quedan como estaban) o 'borrar'.
   */
  S.crearBloque = function (name, base, recs, page, modo = 'convertir') {
    const e = need2000(this); if (e) return e;
    name = String(name || '').trim();
    const err = this.validName(name); if (err) return { error: err };
    if (name.startsWith('*')) return { error: 'El nombre no puede empezar con *.' };
    if (this.D.blocks.has(up(name)) && !this.D.blocks.get(up(name)).deleted) return { error: `Ya existe el bloque «${name}».` };
    if (this.D.blocksEndLine == null) return { error: 'Este DXF no tiene sección BLOCKS.' };
    const lista = [...new Set(recs)].filter((r) => !r.deleted);
    if (!lista.length) return { error: 'No hay objetos designados.' };
    const attdefs = lista.filter((r) => r.type === 'ATTDEF');
    const { b, br } = this._bloqueNuevo(name, base, attdefs.length ? 2 : 0);
    for (const r of lista) {
      const group = this.withSeq(r); const hmap = new Map(); const made = [];
      for (const q of group) {
        const n = new DXF.Rec(q.type, this._retarget(q.p, b.owner, false));
        hmap.set(hnd(q), n.get(5)); made.push(n);
      }
      for (const n of made.slice(1)) n.p = n.p.map(([c, v]) => (c === 330 && hmap.has(String(v).trim()) ? [330, hmap.get(String(v).trim())] : [c, v]));
      b.ents.push(...made);
    }
    const adds = [br]; const dels = modo === 'retener' ? [] : lista;
    let ins = null;
    if (modo === 'convertir') {
      ins = this._insercion(page, b, base, 1, 0, attdefs.map((a) => (a.get(1, '') || '').trim()));
      adds.push(...ins);
    }
    this.commit(`Bloque ${name}`, { adds, dels, newBlocks: [b], tables: true });
    return { ok: true, block: b, insert: ins ? ins[0] : null, n: lista.length };
  };
  /** INSERT (+ ATTRIB + SEQEND) de un bloque en la hoja: registros sin agregar. valores = textos de los atributos. */
  S._insercion = function (page, b, at, s, rot, valores = [], layer) {
    const attdefs = b.ents.filter((r) => r.type === 'ATTDEF' && !r.deleted && !(r.int(70) & 2));
    const has = attdefs.length > 0;
    const body = []; if (has) body.push([66, 1]);
    body.push([2, b.name], [10, at[0]], [20, at[1]], [30, 0]);
    if (s !== 1) body.push([41, s], [42, s], [43, s]);
    if (rot) body.push([50, rot]);
    const L = layer || this.capaActual();
    const ins = this.make(page, 'INSERT', 'AcDbBlockReference', body, L);
    const out = [ins];
    if (has) {
      const T = Edit.similarity({ base: b.base, deg: rot, s, dx: at[0] - b.base[0], dy: at[1] - b.base[1] });
      attdefs.forEach((a, k) => {
        const tp = attdefAttrib(a, valores[k] !== undefined ? valores[k] : (a.get(1, '') || '').trim());
        const moved = Edit.transformPairs('ATTRIB', tp, T, false) || tp;
        const lay = (a.get(8, '0') || '0').trim();
        out.push(this.make(page, 'ATTRIB', null, moved, lay === '0' ? L : lay, ins.get(5)));
      });
      out.push(this.make(page, 'SEQEND', null, [], L, ins.get(5)));
    }
    return out;
  };
  /** Pares de un ATTRIB a partir de su ATTDEF (desde el primer «100 AcDbText»). */
  function attdefAttrib(a, value) {
    const out = []; let sub = 0, tag = '', flags = 0, valign = null;
    for (const [code, v] of a.p) {
      if (code === 100) { const t = String(v).trim(); if (t === 'AcDbText') sub++; else if (t === 'AcDbAttributeDefinition') sub = 9; continue; }
      if (sub === 1) { if (code === 1) out.push([1, value]); else out.push([code, v]); }
      else if (sub === 2) { if (code === 73) valign = v; }
      else if (sub === 9) { if (code === 2) tag = v; else if (code === 70) flags = v; else if (code === 74) valign = v; }
    }
    out.unshift([100, 'AcDbText']);
    out.push([100, 'AcDbAttribute'], [2, tag], [70, flags]);
    if (valign != null) out.push([74, valign]);
    return out;
  }
  /** INSERTAR por código: bloque por nombre, escala y giro, con valores de atributos. */
  S.insertarBloque = function (page, name, at, s = 1, rot = 0, valores = []) {
    const b = this.D.blocks.get(up(name)); if (!b || b.deleted) return { error: `No existe el bloque «${name}».` };
    const recs = this._insercion(page, b, at, s, rot, valores);
    this.commit(`Insertar ${b.name}`, { adds: recs });
    return { ok: true, rec: recs[0], recs };
  };
  /** ATRDEF (ATTDEF): definición de atributo. o = {at, h, rot, tag, prompt, def, just}. */
  S.crearAtrdef = function (page, o) {
    const tag = String(o.tag || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!tag) return { error: 'Escriba la etiqueta del atributo.' };
    const st = this.estiloActual();
    const body = [[10, o.at[0]], [20, o.at[1]], [30, 0], [40, o.h || 2.5], [1, o.def ?? '']];
    if (o.rot) body.push([50, o.rot]);
    if (this.findRec('STYLE', st)) body.push([7, st]);
    const [ha, va] = (Documento.JUST[o.just || 'I'] || [0, 0]);
    if (ha) body.push([72, ha]);
    if (ha || va) body.push([11, o.at[0]], [21, o.at[1]], [31, 0]);
    body.push([100, 'AcDbAttributeDefinition'], [3, o.prompt ?? tag], [2, tag], [70, o.constante ? 2 : 0]);
    if (va) body.push([74, va]);
    const rec = this.make(page, 'ATTDEF', 'AcDbText', body, this.capaActual());
    this.commit(`Atributo ${tag}`, { adds: [rec] });
    return { ok: true, rec };
  };
  /** Transformación de una inserción: {C} conforme o {M} afín (escala no uniforme). */
  function insertXf(ins, b) {
    const sx = ins.num(41, 1) || 1, sy = ins.num(42, 1) || 1, rot = ins.num(50, 0);
    const at = [ins.num(10), ins.num(20)];
    if (Edit.mirrored(ins)) return null;
    if (Math.abs(Math.abs(sx) - Math.abs(sy)) < 1e-9 * Math.max(Math.abs(sx), 1)) {
      const k = Math.abs(sx); let C;
      if (sx > 0 && sy > 0) C = { refl: false, deg: rot, s: k };
      else if (sx < 0 && sy < 0) C = { refl: false, deg: rot + 180, s: k };
      else if (sy < 0) C = { refl: true, deg: rot, s: k };
      else C = { refl: true, deg: rot + 180, s: k };
      C.dx = 0; C.dy = 0; const q = cPt(C, b.base[0], b.base[1]); C.dx = at[0] - q[0]; C.dy = at[1] - q[1];
      return { C };
    }
    const r = rot * DEG, c = Math.cos(r), s = Math.sin(r);
    const M = (x, y) => { const X = (x - b.base[0]) * sx, Y = (y - b.base[1]) * sy; return [at[0] + c * X - s * Y, at[1] + s * X + c * Y]; };
    return { M };
  }
  function affinePairs(type, pairs, M) {
    const pts = { LINE: [10, 11], POINT: [10], LWPOLYLINE: [10], SOLID: [10, 11, 12, 13], TRACE: [10, 11, 12, 13] }[type];
    if (!pts) return null;
    if (type === 'LWPOLYLINE' && pairs.some((q) => q[0] === 42 && Math.abs(parseFloat(q[1])) > 1e-12)) return null;
    const out = pairs.map((q) => q.slice());
    for (let i = 0; i < out.length; i++) if (pts.includes(out[i][0])) { const j = out.findIndex((q, k) => k > i && q[0] === out[i][0] + 10); if (j < 0) continue; const [a, b] = M(parseFloat(out[i][1]), parseFloat(out[j][1])); out[i][1] = F(a); out[j][1] = F(b); }
    return out;
  }
  /** DESCOMPONER (EXPLODE): una inserción pasa a sus objetos (un nivel, como AutoCAD); los atributos vuelven a ser sus
   *  definiciones. También descompone polilíneas en líneas y arcos, y cotas en sus líneas y textos. */
  S.descomponer = function (recs, page) {
    const adds = [], dels = [], refused = new Set(); let n = 0;
    const owner = page.edit.owner, paper = page.edit.paper;
    const nuevo = (like, type, pairs) => { const r = new DXF.Rec(type, this._retarget(pairs, owner, paper)); r.isNew = true; r.home = page.edit.container; r.insertLine = page.edit.insertLine; return r; };
    for (const r of recs) {
      if (r.deleted) continue;
      if (r.type === 'INSERT' || r.type === 'DIMENSION') {
        const b = this.D.blocks.get(up(r.get(2, ''))); if (!b) { refused.add(r.type); continue; }
        if (r.type === 'INSERT' && (r.int(70, 1) > 1 || r.int(71, 1) > 1)) { refused.add('MINSERT'); continue; }
        const X = r.type === 'DIMENSION' ? { C: { refl: false, deg: 0, s: 1, dx: 0, dy: 0 } } : insertXf(r, b);
        if (!X) { refused.add('INSERT reflejado en Z'); continue; }
        const made = []; let ok = true;
        const ents = b.ents.filter((q) => !q.deleted);
        for (let i = 0; i < ents.length; i++) {
          const q = ents[i];
          const grp = [q]; if (q.type === 'POLYLINE' || (q.type === 'INSERT' && q.int(66, 0) === 1)) while (i + 1 < ents.length && ['VERTEX', 'ATTRIB', 'SEQEND'].includes(ents[i + 1].type)) { grp.push(ents[++i]); if (ents[i].type === 'SEQEND') break; }
          const mir = Edit.mirrored(grp[0]);
          const hm = new Map(); const g2 = [];
          for (const e of grp) {
            const p = X.C ? conform(e.type, e.p, X.C, e.type === 'ATTRIB' ? Edit.mirrored(e) : mir) : affinePairs(e.type, e.p, X.M);
            if (!p) { ok = false; refused.add(e.type); break; }
            const nr = nuevo(r, e.type, p); hm.set(hnd(e), nr.get(5)); g2.push(nr);
          }
          if (!ok) break;
          for (const nr of g2.slice(1)) nr.p = nr.p.map(([c, v]) => (c === 330 && hm.has(String(v).trim()) ? [330, hm.get(String(v).trim())] : [c, v]));
          made.push(...g2);
        }
        if (!ok) continue;
        // capa 0 dentro del bloque: queda en 0 (como AutoCAD); los objetos PorBloque toman el color de la inserción
        adds.push(...made); dels.push(r); n++;
      } else if (r.type === 'LWPOLYLINE') {
        const { segs } = Geom.lwSegs(r);
        const base = r.p.filter((q) => [8, 6, 62, 370, 48, 420].includes(q[0]));
        for (const sg of segs) {
          const A = Geom.segArc(sg);
          if (!A) adds.push(nuevo(r, 'LINE', [[100, 'AcDbEntity'], ...base, [100, 'AcDbLine'], [10, F(sg.a[0])], [20, F(sg.a[1])], [30, '0.0'], [11, F(sg.b[0])], [21, F(sg.b[1])], [31, '0.0']]));
          else { let g0 = A.as, g1 = A.as + A.th; if (A.th < 0) [g0, g1] = [g1, g0];
            adds.push(nuevo(r, 'ARC', [[100, 'AcDbEntity'], ...base, [100, 'AcDbCircle'], [10, F(A.c[0])], [20, F(A.c[1])], [30, '0.0'], [40, F(A.r)], [100, 'AcDbArc'], [50, F(Edit.norm360(g0 / DEG))], [51, F(Edit.norm360(g1 / DEG))]])); }
        }
        dels.push(r); n++;
      } else refused.add(r.type);
    }
    if (!n) return { error: 'No hay nada que descomponer' + (refused.size ? ` (no se pueden: ${[...refused].join(', ')})` : '') + '.' };
    this.commit(`Descomponer ${n}`, { adds, dels });
    return { ok: true, n, recs: adds, refused: [...refused] };
  };

  // ================================================================ COTAS (DIMENSION con su bloque) y ESTILOCOTA
  const MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 14: 100 };
  S.unidadDibujo = function () { const u = parseInt(this.hdrGet('$INSUNITS', 70, '4'), 10); return MM[u] ? u : 4; };
  /** Valores de un estilo de cota (con los de omisión de Domoplano). */
  S.estiloCota = function (name) {
    name = name || this.hdrGet('$DIMSTYLE', 2, 'Standard');
    const r = this.findRec('DIMSTYLE', name) || this.findRec('DIMSTYLE', 'Standard');
    const g = (c, d) => (r && r.get(c) !== undefined ? r.num(c, d) : d);
    const gi = (c, d) => (r && r.get(c) !== undefined ? r.int(c, d) : d);
    let txsty = null;
    const sh = r && (r.get(340, '') || '').trim();
    if (sh) { const st = this.tblRecs('STYLE').find((x) => up(x.get(5, '')) === up(sh)); if (st) txsty = st.get(2).trim(); }
    return { name: r ? r.get(2).trim() : 'Standard', existe: !!r, scale: g(40, 1) || 1, asz: g(41, 2.5), exo: g(42, 0.625), exe: g(44, 1.25), txt: g(140, 2.5), tsz: g(142, 0),
      lfac: g(144, 1) || 1, gap: Math.abs(g(147, 0.625)), tad: gi(77, 1), dec: gi(271, 2), adec: gi(179, 0), dsep: gi(278, 44), post: r ? String(r.get(3, '') || '') : '',
      txsty: txsty || this.estiloActual() };
  };
  /**
   * ESTILOCOTA (DIMSTYLE): crea o cambia un estilo de cota. o = {txt (altura de texto), asz (flecha), flecha: 'flecha'|'marca',
   * unidades: 'mm'|'cm'|'m', dec (decimales), escala (DIMSCALE), actual (ponerlo actual)}. Unidades = cómo se muestra la medida;
   * el factor se calcula con las unidades del dibujo ($INSUNITS).
   */
  S.crearEstiloCota = function (name, o = {}) {
    const e = need2000(this); if (e) return e;
    name = String(name || '').trim(); const err = this.validName(name); if (err) return { error: err };
    const T = this.tbl('DIMSTYLE'); if (!T) return { error: 'Este DXF no tiene tabla de estilos de cota.' };
    const prev = this.findRec('DIMSTYLE', name);
    const base = this.estiloCota(prev ? name : null);
    // R2-fix F-5: sin unidades explícitas, un estilo nuevo copia el factor (DIMLFAC) y el sufijo del estilo base, que ya
    // respetan las unidades del dibujo (en un plano en metros, «Standard» mide en metros). Antes se forzaba 'mm' → ×1000.
    const uni = o.unidades || null;
    let lfac = o.lfac > 0 ? o.lfac : base.lfac, post = o.post !== undefined ? String(o.post) : base.post;
    if (uni) { const f = { mm: 1, cm: 10, m: 1000 }[uni]; if (!f) return { error: 'Unidades: mm, cm o m.' }; lfac = MM[this.unidadDibujo()] / f; post = uni === 'mm' ? '' : ' ' + uni; }
    const v = { txt: o.txt ?? base.txt, asz: o.asz ?? base.asz, exo: base.exo, exe: base.exe, gap: base.gap, scale: o.escala ?? base.scale,
      tsz: o.flecha ? (o.flecha === 'marca' ? (o.asz ?? base.asz) * 0.5 : 0) : base.tsz, dec: o.dec ?? base.dec, adec: o.adec ?? base.adec };
    if (!(v.txt > 0 && v.asz > 0 && v.scale > 0)) return { error: 'Las medidas del estilo deben ser mayores que 0.' };
    const st = this.findRec('STYLE', base.txsty) || this.tblRecs('STYLE')[0];
    const h = prev ? (prev.get(105) || prev.get(5)).trim() : this.newHandle();
    const pairs = [[105, h], [330, (T.head.get(5, '0') || '0').trim()], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbDimStyleTableRecord'], [2, name], [70, '0'],
      [3, post], [40, F(v.scale)], [41, F(v.asz)], [42, F(v.exo)], [44, F(v.exe)], [73, '0'], [74, '0'], [77, '1'], [140, F(v.txt)], [141, F(v.txt)], [142, F(v.tsz)], [144, F(lfac)],
      [147, F(v.gap)], [179, String(v.adec)], [271, String(v.dec)], [272, String(v.dec)], [278, '44'], ...(st ? [[340, hnd(st)]] : [])];
    const hdr = o.actual === false ? [] : [{ name: '$DIMSTYLE', code: 2, value: name }];
    if (prev) this.commit(`Estilo de cota ${name}`, { mods: [{ rec: prev, pairs }], hdr, tables: true });
    else { const rec = this.tableRec('DIMSTYLE', 'DIMSTYLE', pairs); this.commit(`Estilo de cota ${name}`, { adds: [rec], hdr, tables: true }); }
    return { ok: true, nuevo: !prev };
  };

  function fmtNum(v, dec, sep) { let s = v.toFixed(Math.max(0, Math.min(8, dec))); if (sep && sep !== 46) s = s.replace('.', String.fromCharCode(sep)); return s; }
  function textoMedida(st, meas, kind, override) {
    let s;
    if (kind === 'ang') s = fmtNum(meas / DEG, st.adec, st.dsep) + '%%d';
    else { s = fmtNum(meas * st.lfac, st.dec, st.dsep); s = st.post.includes('<>') ? st.post.replace('<>', s) : s + st.post; }
    if (kind === 'rad') s = 'R' + s; else if (kind === 'diam') s = '%%c' + s;
    if (override) return override.includes('<>') ? override.replace('<>', s) : override;
    return s;
  }
  const legDir = (u) => { let a = Math.atan2(u[1], u[0]); if (a > Math.PI / 2 + 1e-9 || a <= -Math.PI / 2 + 1e-9) a += Math.PI; return a; };
  /**
   * Geometría de una cota: d = {tipo: 0 girada | 1 alineada | 5 angular | 4 radio | 3 diámetro, p13, p14, p15, p10, p11,
   * ang (grados, tipo 0), userText (11 fijado por el usuario), override}. Devuelve {ents: [[tipo, subclase, pares, capa]],
   * p10, p11, meas} o {error}.
   */
  function generarCota(d, st) {
    const k = st.scale, asz = st.asz * k, exo = st.exo * k, exe = st.exe * k, h = st.txt * k, gap = st.gap * k, tsz = st.tsz * k;
    const ents = [];
    const line = (a, b) => { if (len(sub2(b, a)) > 1e-12) ents.push(['LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], '0']); };
    const arrow = (tip, w) => {
      if (tsz > 0) { const q = unit(add2(w, perp(w))); line(sub2(tip, mul2(q, tsz)), add2(tip, mul2(q, tsz))); return; }
      const b = sub2(tip, mul2(w, asz)), n = mul2(perp(w), asz / 6);
      ents.push(['SOLID', 'AcDbTrace', [[10, tip[0]], [20, tip[1]], [30, 0], [11, b[0] + n[0]], [21, b[1] + n[1]], [31, 0], [12, b[0] - n[0]], [22, b[1] - n[1]], [32, 0], [13, b[0] - n[0]], [23, b[1] - n[1]], [33, 0]], '0']);
    };
    const text = (pos, rot, str, just = 'MC') => {
      const [ha, va] = Documento.JUST[just];
      ents.push(['TEXT', 'AcDbText', [[10, pos[0]], [20, pos[1]], [30, 0], [40, h], [1, str], [50, Edit.norm360(rot / DEG)], [7, st.txsty], [72, ha], [11, pos[0]], [21, pos[1]], [31, 0], [73, va]], '0']);
    };
    const point = (p) => ents.push(['POINT', 'AcDbPoint', [[10, p[0]], [20, p[1]], [30, 0]], 'Defpoints']);
    const tw = (s) => 0.75 * h * String(s).replace(/%%./g, 'x').length;
    let p10, p11, meas;
    if (d.tipo === 0 || d.tipo === 1) {
      const p1 = d.p13, p2 = d.p14;
      let u;
      if (d.tipo === 1) { if (len(sub2(p2, p1)) < 1e-12) return { error: 'Los dos puntos son iguales.' }; u = unit(sub2(p2, p1)); }
      else u = [Math.cos(d.ang * DEG), Math.sin(d.ang * DEG)];
      const n = perp(u), L = d.p10;
      const d1 = add2(p1, mul2(n, dot(sub2(L, p1), n))), d2 = add2(p2, mul2(n, dot(sub2(L, p2), n)));
      meas = Math.abs(dot(sub2(p2, p1), u));
      if (meas < 1e-12) return { error: 'La medida es cero en esa dirección.' };
      for (const [p, q] of [[p1, d1], [p2, d2]]) {
        const v = sub2(q, p), l = len(v); if (l <= exo) continue;
        const e = unit(v); line(add2(p, mul2(e, exo)), add2(q, mul2(e, exe)));
      }
      const w1 = unit(sub2(d1, d2)), w2 = mul2(w1, -1);
      const dentro = len(sub2(d2, d1)) >= 2.2 * asz;
      const str = textoMedida(st, meas, 'lin', d.override);
      const ut = [Math.cos(legDir(u)), Math.sin(legDir(u))], nt = perp(ut);
      const mid = mul2(add2(d1, d2), 0.5);
      p11 = d.userText && d.p11 ? d.p11 : (st.tad ? add2(mid, mul2(nt, gap + h / 2)) : mid);
      if (!st.tad && !d.userText && len(sub2(d2, d1)) > tw(str) + 2 * gap) { // texto centrado: la línea se corta
        const half = (tw(str) / 2 + gap); line(d1, add2(mid, mul2(w1, half))); line(add2(mid, mul2(w2, half)), d2);
      } else line(d1, d2);
      if (dentro) { arrow(d1, w1); arrow(d2, w2); }
      else { arrow(d1, w2); arrow(d2, w1); line(d1, add2(d1, mul2(w1, 2 * asz))); line(d2, add2(d2, mul2(w2, 2 * asz))); }
      text(p11, legDir(u), str);
      point(p1); point(p2); point(d2);
      p10 = d2;
    } else if (d.tipo === 5) {
      const V = d.p15, A = d.p10;
      const g1 = Math.atan2(d.p13[1] - V[1], d.p13[0] - V[0]), g2 = Math.atan2(d.p14[1] - V[1], d.p14[0] - V[0]), gA = Math.atan2(A[1] - V[1], A[0] - V[0]);
      const R = len(sub2(A, V)); if (R < 1e-12) return { error: 'El arco de cota pasa por el vértice.' };
      let as = g1, span = n2(g2 - g1);
      if (n2(gA - g1) > span + 1e-12) { as = g2; span = TAU - span; }
      if (span < 1e-12) return { error: 'Las dos líneas tienen la misma dirección.' };
      meas = span;
      for (const [P, g] of [[d.p13, g1], [d.p14, g2]]) {
        const r = len(sub2(P, V)), u = [Math.cos(g), Math.sin(g)];
        if (R > r + exo) line(add2(V, mul2(u, r + exo)), add2(V, mul2(u, R + exe)));
      }
      ents.push(['ARC', 'AcDbCircle', [[10, V[0]], [20, V[1]], [30, 0], [40, R], [100, 'AcDbArc'], [50, Edit.norm360(as / DEG)], [51, Edit.norm360((as + span) / DEG)]], '0']);
      const ae = as + span, S0 = [V[0] + R * Math.cos(as), V[1] + R * Math.sin(as)], S1 = [V[0] + R * Math.cos(ae), V[1] + R * Math.sin(ae)];
      if (R * span >= 2.2 * asz) { arrow(S0, [Math.sin(as), -Math.cos(as)]); arrow(S1, [-Math.sin(ae), Math.cos(ae)]); }
      else { arrow(S0, [-Math.sin(as), Math.cos(as)]); arrow(S1, [Math.sin(ae), -Math.cos(ae)]); }
      const am = as + span / 2, um = [Math.cos(am), Math.sin(am)];
      p11 = d.userText && d.p11 ? d.p11 : add2(V, mul2(um, R + gap + h / 2));
      text(p11, legDir(perp(um)), textoMedida(st, meas, 'ang', d.override));
      point(d.p13); point(d.p14); point(V);
      p10 = A;
    } else if (d.tipo === 4 || d.tipo === 3) {
      const diam = d.tipo === 3;
      const P = d.p15, C = diam ? mul2(add2(d.p15, d.p10), 0.5) : d.p10;
      const r = len(sub2(P, C)); if (r < 1e-12) return { error: 'Radio cero.' };
      meas = diam ? 2 * r : r;
      const u = unit(sub2(P, C));
      const T = d.p11 || add2(C, mul2(u, r + 3 * asz));
      const str = textoMedida(st, meas, diam ? 'diam' : 'rad', d.override);
      const dist = len(sub2(T, C));
      if (dist > r + 1e-9) { // texto afuera: directriz desde la curva hasta el texto
        const v = unit(sub2(T, C)), Pv = add2(C, mul2(v, r)), E = add2(C, mul2(v, dist));
        line(Pv, E); arrow(Pv, mul2(v, -1));
        const sgn = v[0] >= 0 ? 1 : -1, H2 = add2(E, [sgn * asz, 0]);
        line(E, H2);
        text(add2(H2, [sgn * gap, 0]), 0, str, sgn > 0 ? 'MI' : 'MD');
        const cm = 2.5 * k; line(sub2(C, [cm / 2, 0]), add2(C, [cm / 2, 0])); line(sub2(C, [0, cm / 2]), add2(C, [0, cm / 2]));
        p11 = T;
      } else {
        const v = unit(sub2(T, C)); const Pv = add2(C, mul2(v, r));
        if (diam) { const Q = sub2(C, mul2(v, r)); line(Q, Pv); arrow(Pv, v); arrow(Q, mul2(v, -1)); }
        else { line(C, Pv); arrow(Pv, v); }
        const ut = [Math.cos(legDir(v)), Math.sin(legDir(v))];
        text(add2(T, mul2(perp(ut), gap + h / 2)), legDir(v), str);
        p11 = T;
      }
      point(P); point(diam ? d.p10 : C);
      p10 = diam ? d.p10 : C;
    } else return { error: 'Tipo de cota no soportado.' };
    return { ents, p10, p11, meas };
  }
  /** Datos de definición de una DIMENSION existente. */
  function leerCota(rec) {
    const pt = (c) => (rec.get(c) !== undefined ? [rec.num(c), rec.num(c + 10)] : null);
    const f = rec.int(70, 0);
    return { tipo: f & 7, user: !!(f & 128), p10: pt(10), p11: pt(11), p13: pt(13), p14: pt(14), p15: pt(15), p16: pt(16), ang: rec.num(50, 0),
      override: String(rec.get(1, '') || ''), estilo: String(rec.get(3, 'Standard') || 'Standard').trim() };
  }
  function cotaPares(d, blk, g, estilo) {
    const flags = d.tipo | 32 | (d.userText ? 128 : 0);
    const body = [[2, blk], [10, g.p10[0]], [20, g.p10[1]], [30, 0], [11, g.p11[0]], [21, g.p11[1]], [31, 0], [70, flags], [71, 5], [42, g.meas], [1, d.override || ''], [3, estilo]];
    if (d.tipo === 0 || d.tipo === 1) {
      body.push([100, 'AcDbAlignedDimension'], [13, d.p13[0]], [23, d.p13[1]], [33, 0], [14, d.p14[0]], [24, d.p14[1]], [34, 0]);
      if (d.tipo === 0) body.push([50, d.ang], [100, 'AcDbRotatedDimension']);
    } else if (d.tipo === 5) body.push([100, 'AcDb3PointAngularDimension'], [13, d.p13[0]], [23, d.p13[1]], [33, 0], [14, d.p14[0]], [24, d.p14[1]], [34, 0], [15, d.p15[0]], [25, d.p15[1]], [35, 0]);
    else if (d.tipo === 4) body.push([100, 'AcDbRadialDimension'], [15, d.p15[0]], [25, d.p15[1]], [35, 0], [40, 0]);
    else if (d.tipo === 3) body.push([100, 'AcDbDiametricDimension'], [15, d.p15[0]], [25, d.p15[1]], [35, 0], [40, 0]);
    return body;
  }
  /** Entidades del bloque de una cota (registros listos, dueño = bloque). */
  S._entsCota = function (b, g) {
    return g.ents.map(([type, sub, body, layer]) => {
      const p = [[5, this.newHandle()], [330, b.owner], [100, 'AcDbEntity'], [8, layer], [62, '0'], [100, sub]];
      for (const q of body) p.push([q[0], Edit.val(q[0], q[1])]);
      if (type === 'TEXT') { const k = p.findIndex((q) => q[0] === 73); const v = k >= 0 ? p.splice(k, 1)[0] : null; p.push([100, 'AcDbText']); if (v) p.push(v); }
      const r = new DXF.Rec(type, p); r.inBlock = true; r.home = b.ents;
      if (!b.isNew) { r.isNew = true; r.insertLine = b.endLine; }
      return r;
    });
  };
  /**
   * Crea una cota. tipo: 'lineal' {p1, p2, ubic, ang?} (sin ang: horizontal o vertical según dónde se ubique, como AutoCAD),
   * 'alineada' {p1, p2, ubic}, 'angular' {v, p1, p2, ubic}, 'radio' / 'diametro' {c, r, punto (sobre la curva o dirección), ubic?}.
   * o = {estilo, texto (reemplazo, «<>» = medida)}.
   */
  S.crearCota = function (page, tipo, dt, o = {}) {
    const e = need2000(this); if (e) return e;
    if (this.D.blocksEndLine == null) return { error: 'Este DXF no tiene sección BLOCKS.' };
    let estilo = o.estilo || this.hdrGet('$DIMSTYLE', 2, 'Standard');
    const pre = [];
    if (!this.findRec('DIMSTYLE', estilo)) { // sin estilo: se crea «Standard» con los valores de Domoplano
      const r = this.crearEstiloCota('Standard', { actual: true }); if (r.error) return r; estilo = 'Standard'; pre.push(1);
    }
    const st = this.estiloCota(estilo);
    let d;
    if (tipo === 'lineal' || tipo === 'alineada') {
      const { p1, p2, ubic } = dt;
      let ang = dt.ang;
      if (tipo === 'lineal' && ang === undefined) {
        const mid = mul2(add2(p1, p2), 0.5);
        const dx = Math.abs(ubic[0] - mid[0]) - Math.abs(p2[0] - p1[0]) / 2, dy = Math.abs(ubic[1] - mid[1]) - Math.abs(p2[1] - p1[1]) / 2;
        ang = dy >= dx ? 0 : 90;
      }
      d = { tipo: tipo === 'lineal' ? 0 : 1, p13: p1, p14: p2, p10: ubic, ang: ang || 0 };
    } else if (tipo === 'angular') {
      d = { tipo: 5, p13: dt.p1, p14: dt.p2, p15: dt.v, p10: dt.ubic };
    } else if (tipo === 'radio' || tipo === 'diametro') {
      const u = unit(sub2(dt.punto, dt.c)); const P = add2(dt.c, mul2(u, dt.r));
      d = tipo === 'radio' ? { tipo: 4, p10: dt.c, p15: P } : { tipo: 3, p15: P, p10: sub2(dt.c, mul2(u, dt.r)) };
      if (dt.ubic) { d.p11 = dt.ubic; d.userText = true; }
    } else return { error: 'Tipo de cota desconocido.' };
    d.override = o.texto || '';
    const g = generarCota(d, st); if (g.error) { if (pre.length) this.undo(); return g; }
    const { b, br } = this._bloqueNuevo(this._nombreLibre(null, true), [0, 0], 1);
    b.ents.push(...this._entsCota(b, g));
    const rec = this.make(page, 'DIMENSION', 'AcDbDimension', cotaPares(d, b.name, g, st.name), this.capaActual());
    this.commit(`Cota ${tipo}`, { adds: [br, rec], newBlocks: [b], tables: true });
    return { ok: true, rec, block: b, meas: g.meas, texto: textoMedida(st, g.meas, d.tipo === 5 ? 'ang' : d.tipo === 4 ? 'rad' : d.tipo === 3 ? 'diam' : 'lin', d.override) };
  };
  /** Datos de la cota transformados con C (conforme). */
  function cotaXf(d, C) {
    const m = (p) => (p ? cPt(C, p[0], p[1]) : p);
    const o = { ...d, p10: m(d.p10), p11: m(d.p11), p13: m(d.p13), p14: m(d.p14), p15: m(d.p15), p16: m(d.p16), userText: d.user };
    if (d.tipo === 0) o.ang = Edit.norm360(cAng(C, d.ang));
    return o;
  }
  const COTAS_OK = new Set([0, 1, 3, 4, 5]);
  // Mover, girar, escalar, simetría y copias de cotas: se trasladan tal cual o se regeneran con su estilo.
  Edit.dimHook = {
    transform(s, rec, T, xf) {
      const b = s.D.blocks.get(up(rec.get(2, '')));
      const C = xf ? xf.C : fromT(T);
      const translation = !C.refl && Math.abs(C.deg) < 1e-12 && C.s === 1;
      const ptsDim = (p) => p.map(([c, v], i) => [c, v]);
      if (translation) {
        const map = (c) => [10, 11, 12, 13, 14, 15, 16].includes(c);
        const out = ptsDim(rec.p); let sub = '';
        for (let i = 0; i < out.length; i++) {
          const c = out[i][0]; if (c === 100) { sub = String(out[i][1]).trim(); continue; }
          if (map(c) && out[i + 1] && out[i + 1][0] === c + 10) { out[i][1] = F(parseFloat(out[i][1]) + C.dx); out[i + 1][1] = F(parseFloat(out[i + 1][1]) + C.dy); i++; }
        }
        const mods = [{ rec, pairs: out }];
        if (b) for (const e of b.ents) { if (e.deleted) continue; const p = Edit.transformPairs(e.type, e.p, Edit.similarity({ dx: C.dx, dy: C.dy }), Edit.mirrored(e)); if (p) mods.push({ rec: e, pairs: p }); }
        return { mods };
      }
      const d = leerCota(rec); if (!COTAS_OK.has(d.tipo) || !b) return null;
      const nd = cotaXf(d, C); nd.override = d.override;
      const g = generarCota(nd, s.estiloCota(d.estilo)); if (g.error) return null;
      const adds = s._entsCota(b, g);
      return { mods: [{ rec, pairs: rebuildDim(rec, nd, g) }], adds, dels: b.ents.filter((e) => !e.deleted) };
    },
    copy(s, rec, T, xf, page) {
      const b0 = s.D.blocks.get(up(rec.get(2, ''))); if (!b0) return null;
      const C = xf ? xf.C : fromT(T);
      const d = leerCota(rec);
      const { b, br } = s._bloqueNuevo(s._nombreLibre(null, true), [0, 0], 1);
      let pairs;
      const translation = !C.refl && Math.abs(C.deg) < 1e-12 && C.s === 1;
      if (translation || !COTAS_OK.has(d.tipo)) {
        if (!translation) return null;
        for (const e of b0.ents) if (!e.deleted) { const p = Edit.transformPairs(e.type, e.p, Edit.similarity({ dx: C.dx, dy: C.dy }), Edit.mirrored(e)); if (!p) return null; const n = new DXF.Rec(e.type, s._retarget(p, b.owner, false)); b.ents.push(n); }
        pairs = s.D ? Edit.dimHook.transform(s, rec, T, xf).mods[0].pairs : null;
      } else {
        const nd = cotaXf(d, C); nd.override = d.override;
        const g = generarCota(nd, s.estiloCota(d.estilo)); if (g.error) return null;
        b.ents.push(...s._entsCota(b, g));
        pairs = rebuildDim(rec, nd, g);
      }
      pairs = pairs.map(([c, v]) => (c === 2 ? [2, b.name] : [c, v]));
      const n = s.clone(rec, 'DIMENSION', pairs, page);
      b.extraAdds = [br];
      // el registro del bloque va con la cota: se agrega en el mismo paso de deshacer
      n.companion = br;
      return { rec: n, block: b, extra: br };
    },
  };
  /** H6-B pinzamientos: puntos de una cota que se pueden arrastrar ({k: 13|14|15|10|11, p}). */
  S.cotaPuntos = function (rec) {
    const d = leerCota(rec); if (!COTAS_OK.has(d.tipo)) return [];
    return [13, 14, 15, 10, 11].filter((k) => d['p' + k] && !(k === 10 && (d.tipo === 3 || d.tipo === 4)) && !(k === 15 && d.tipo < 3)).map((k) => ({ k, p: d['p' + k] }));
  };
  /** La cota rehecha con su punto k en p (11 = texto, queda «movido por el usuario»). {mods, adds, dels} o null. */
  S.cotaPinzamiento = function (rec, k, p) {
    const b = this.D.blocks.get(up(rec.get(2, ''))); const d = leerCota(rec);
    if (!b || !COTAS_OK.has(d.tipo)) return null;
    const nd = { ...d, userText: d.user || k === 11, override: d.override };
    nd['p' + k] = [p[0], p[1]];
    const g = generarCota(nd, this.estiloCota(d.estilo)); if (g.error) return null;
    let pairs = rebuildDim(rec, nd, g);
    if (nd.userText) pairs = pairs.map(([c, v]) => (c === 70 ? [70, String(parseInt(v, 10) | 128)] : [c, v]));
    return { mods: [{ rec, pairs }], adds: this._entsCota(b, g), dels: b.ents.filter((e) => !e.deleted) };
  };
  function rebuildDim(rec, nd, g) {
    const set = new Map([[10, g.p10], [11, g.p11], [13, nd.p13], [14, nd.p14], [15, nd.p15], [16, nd.p16]]);
    const out = rec.p.map((q) => q.slice());
    for (let i = 0; i < out.length; i++) {
      const c = out[i][0];
      if (set.has(c) && set.get(c) && out[i + 1] && out[i + 1][0] === c + 10) { const p = set.get(c); out[i][1] = F(p[0]); out[i + 1][1] = F(p[1]); i++; }
      else if (c === 42) out[i][1] = F(g.meas);
      else if (c === 50 && nd.tipo === 0) out[i][1] = F(nd.ang);
    }
    return out;
  }

  // ================================================================ DIRECTRIZ (LEADER simple + texto)
  /** DIRECTRIZ (LEADER / MLEADER simple): flecha en el primer punto, quiebre horizontal y texto al final. */
  S.crearDirectriz = function (page, pts, texto, o = {}) {
    const e = need2000(this); if (e) return e;
    if (pts.length < 2) return { error: 'Precise al menos dos puntos.' };
    let estilo = o.estilo || this.hdrGet('$DIMSTYLE', 2, 'Standard'); // H6-A: o.estilo = estilo «ANOT 1-N» (escala de anotación)
    if (!this.findRec('DIMSTYLE', estilo)) { const r = this.crearEstiloCota('Standard', { actual: true }); if (r.error) return r; estilo = 'Standard'; }
    const st = this.estiloCota(estilo); const k = st.scale, h = (o.h || st.txt) * k, asz = st.asz * k, gap = st.gap * k;
    const P = pts.map((p) => p.slice());
    const last = P[P.length - 1], prev = P[P.length - 2];
    const sgn = last[0] >= prev[0] ? 1 : -1;
    if (Math.abs(last[1] - prev[1]) > 1e-9 * Math.max(1, Math.abs(last[1]))) P.push([last[0] + sgn * asz, last[1]]); // quiebre (landing)
    const end = P[P.length - 1];
    const body = [[3, estilo], [71, 1], [72, 0], [73, 3], [74, 0], [75, 0], [40, h], [41, 0], [76, P.length]];
    for (const p of P) body.push([10, p[0]], [20, p[1]], [30, 0]);
    const L = this.capaActual();
    const adds = [this.make(page, 'LEADER', 'AcDbLeader', body, L)];
    if (String(texto || '').length) {
      const tp = [end[0] + sgn * gap, end[1]];
      adds.push(this.make(page, 'TEXT', 'AcDbText', Documento.textoPares(tp, h, 0, texto, { just: sgn > 0 ? 'MI' : 'MD', style: this.findRec('STYLE', st.txsty) ? st.txsty : null }), L));
    }
    this.commit('Directriz', { adds });
    return { ok: true, recs: adds };
  };

  // ================================================================ SOMBREA (HATCH)
  // Patrones propios de Domoplano (no son los .pat de Autodesk). Cada familia: a = ángulo, base = [x, y],
  // off = [a lo largo, perpendicular] (como en un archivo de patrón), dash = trazos (+ línea, − espacio, 0 punto).
  const PATRONES = {
    SOLIDO: { desc: 'Relleno sólido', solido: true },
    DIAGONAL: { desc: 'Líneas a 45° (tipo ANSI31)', f: [{ a: 45, base: [0, 0], off: [0, 3], dash: [] }] },
    CRUZADO: { desc: 'Cuadrícula a 45° (tipo ANSI37)', f: [{ a: 45, base: [0, 0], off: [0, 3], dash: [] }, { a: 135, base: [0, 0], off: [0, 3], dash: [] }] },
    HORIZONTAL: { desc: 'Líneas horizontales', f: [{ a: 0, base: [0, 0], off: [0, 3], dash: [] }] },
    CUADRICULA: { desc: 'Cuadrícula', f: [{ a: 0, base: [0, 0], off: [0, 3], dash: [] }, { a: 90, base: [0, 0], off: [0, 3], dash: [] }] },
    TIERRA: { desc: 'Terreno natural', f: [{ a: 45, base: [0, 0], off: [0, 6], dash: [] }, { a: 135, base: [0, 0], off: [0, 6], dash: [2, -4] }, { a: 135, base: [0, 1], off: [0, 6], dash: [2, -4] }] },
    CONCRETO: { desc: 'Concreto (puntos y trazos)', f: [{ a: 45, base: [0, 0], off: [1.5, 4], dash: [0.8, -3.2] }, { a: 135, base: [1, 1], off: [2, 5], dash: [0, -5] }, { a: 0, base: [2, 0.5], off: [2.5, 3.5], dash: [0, -6] }] },
    ARENA: { desc: 'Arena (puntos)', f: [{ a: 30, base: [0, 0], off: [1, 1.6], dash: [0, -2.2] }, { a: 120, base: [0.5, 0.3], off: [0.9, 1.9], dash: [0, -2.7] }] },
    GRAVA: { desc: 'Grava (trazos cortos)', f: [{ a: 15, base: [0, 0], off: [3, 2.5], dash: [0.8, -4] }, { a: 105, base: [1.5, 0.6], off: [2.5, 3], dash: [0.7, -4.5] }, { a: 60, base: [0.7, 1.4], off: [2, 3.5], dash: [0.6, -5] }] },
    LADRILLO: { desc: 'Ladrillo / mampostería', f: [{ a: 0, base: [0, 0], off: [0, 5], dash: [] }, { a: 90, base: [0, 0], off: [5, 5], dash: [5, -5] }] },
  };
  // nombres de AutoCAD que la gente escribe → nuestro patrón equivalente
  const ALIAS_PATRON = { SOLID: 'SOLIDO', ANSI31: 'DIAGONAL', ANSI37: 'CRUZADO', NET: 'CUADRICULA', LINE: 'HORIZONTAL', EARTH: 'TIERRA', 'AR-CONC': 'CONCRETO', 'AR-SAND': 'ARENA', GRAVEL: 'GRAVA', 'AR-B816': 'LADRILLO', BRICK: 'LADRILLO' };
  const patron = (n) => { const k = up(n); const p = PATRONES[k] ? k : ALIAS_PATRON[k]; return p ? { nombre: p, ...PATRONES[p] } : null; };
  function lineasPatron(P, escala, angulo) {
    const H = angulo * DEG, cH = Math.cos(H), sH = Math.sin(H);
    return P.f.map((L) => {
      const a = (L.a * DEG) + H, ca = Math.cos(a), sa = Math.sin(a);
      return { a: Edit.norm360(L.a + angulo), bx: (cH * L.base[0] - sH * L.base[1]) * escala, by: (sH * L.base[0] + cH * L.base[1]) * escala,
        ox: (ca * L.off[0] - sa * L.off[1]) * escala, oy: (sa * L.off[0] + ca * L.off[1]) * escala, dash: L.dash.map((v) => v * escala) };
    });
  }
  /** Pares de un HATCH con contornos de polilínea: paths = [[[x, y, comba], …], …] (el primero = exterior). */
  function hatchBody(paths, P, escala, angulo, semillas) {
    const body = [[10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1], [2, P.solido ? 'SOLID' : P.nombre], [70, P.solido ? 1 : 0], [71, 0], [91, paths.length]];
    paths.forEach((vs, i) => {
      const hasB = vs.some((v) => Math.abs(v[2] || 0) > 1e-12) ? 1 : 0;
      body.push([92, 2 | (i === 0 ? 1 : 0)], [72, hasB], [73, 1], [93, vs.length]);
      for (const v of vs) { body.push([10, v[0]], [20, v[1]]); if (hasB) body.push([42, v[2] || 0]); }
      body.push([97, 0]);
    });
    body.push([75, 0], [76, P.solido ? 1 : 2]);
    if (!P.solido) {
      const L = lineasPatron(P, escala, angulo);
      body.push([52, angulo], [41, escala], [77, 0], [78, L.length]);
      for (const l of L) { body.push([53, l.a], [43, l.bx], [44, l.by], [45, l.ox], [46, l.oy], [79, l.dash.length]); for (const v of l.dash) body.push([49, v]); }
    }
    body.push([98, semillas.length]); for (const s of semillas) body.push([10, s[0]], [20, s[1]]);
    return body;
  }
  /** Contorno cerrado (vértices con comba, WCS) de un objeto designado, o null. */
  function contornoDe(rec) {
    if (rec.type === 'CIRCLE') { const m = Edit.mirrored(rec); const c = [m ? -rec.num(10) : rec.num(10), rec.num(20)], r = rec.num(40); return [[c[0] + r, c[1], 1], [c[0] - r, c[1], 1]]; }
    if (rec.type === 'LWPOLYLINE') {
      const { segs, closed, verts } = Geom.lwSegs(rec);
      const cerrada = closed || (verts.length > 2 && Math.hypot(verts[0][0] - verts[verts.length - 1][0], verts[0][1] - verts[verts.length - 1][1]) < 1e-9);
      if (!cerrada || !segs.length) return null;
      const vs = verts.map((v) => v.slice()); if (!closed) vs.pop();
      return vs;
    }
    if (rec.type === 'ELLIPSE' || rec.type === 'SPLINE') return null;
    return null;
  }
  /**
   * SOMBREA por objetos: cada objeto cerrado designado (polilínea cerrada o círculo) es un contorno; los de adentro son islas
   * (estilo Normal: se alternan). o = {patron, escala, angulo}.
   */
  S.sombrearObjetos = function (page, recs, o = {}) {
    const e = need2000(this); if (e) return e;
    const P = patron(o.patron || 'DIAGONAL'); if (!P) return { error: `No conozco el patrón «${o.patron}». Patrones: ${Object.keys(PATRONES).join(', ')}.` };
    const paths = []; const malos = [];
    for (const r of recs) { const c = contornoDe(r); if (c) paths.push(c); else malos.push(r.type); }
    if (!paths.length) return { error: 'Ninguno de los objetos es un contorno cerrado (polilínea cerrada o círculo).' };
    paths.sort((a, b) => Math.abs(areaVs(b)) - Math.abs(areaVs(a)));
    return this._hatch(page, paths, P, o);
  };
  S._hatch = function (page, paths, P, o) {
    const escala = o.escala > 0 ? o.escala : 1, angulo = o.angulo || 0;
    if (!P.solido) { // patrones muy densos para el área: avisar (se dibujarían miles de líneas)
      const bb = bbVs(paths[0]), area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
      const sep = Math.min(...lineasPatron(P, escala, angulo).map((l) => Math.abs(-Math.sin(l.a * DEG) * l.ox + Math.cos(l.a * DEG) * l.oy) || Infinity));
      if (area / (sep * sep) > 4e6) return { error: 'La escala del patrón es muy pequeña para esa área (saldrían millones de líneas). Aumente la escala.' };
    }
    const semillas = o.semilla ? [o.semilla] : [];
    const rec = this.make(page, 'HATCH', 'AcDbHatch', hatchBody(paths, P, escala, angulo, semillas), o.capa || this.capaActual());
    this.commit(`Sombrear ${P.nombre}`, { adds: [rec] });
    return { ok: true, rec, contornos: paths.length, patron: P.nombre };
  };
  function sampleVs(vs) { // polígono aproximado (arcos en tramos) de un contorno con combas
    const out = [];
    for (let k = 0; k < vs.length; k++) {
      const a = vs[k], b = vs[(k + 1) % vs.length];
      const A = Geom.segArc({ a, b, bulge: a[2] || 0 });
      out.push([a[0], a[1]]);
      if (A) { const n = Math.max(4, Math.ceil(Math.abs(A.th) / (TAU / 64))); for (let i = 1; i < n; i++) { const g = A.as + A.th * i / n; out.push([A.c[0] + A.r * Math.cos(g), A.c[1] + A.r * Math.sin(g)]); } }
    }
    return out;
  }
  function areaPoly(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - a[1] * b[0]; } return s / 2; }
  const areaVs = (vs) => areaPoly(sampleVs(vs));
  function bbVs(vs) { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of sampleVs(vs)) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return b; }
  function inPoly(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /** Bordes de los objetos (WCS) para buscar contornos: segmentos y arcos de líneas, polilíneas, círculos, arcos. */
  function bordesDe(recs) {
    const E = [];
    for (const r of recs) {
      if (r.deleted) continue;
      if (r.type === 'LWPOLYLINE') { for (const sg of Geom.lwSegs(r).segs) E.push(Geom.segEdge(sg)); continue; }
      if (['LINE', 'CIRCLE', 'ARC'].includes(r.type)) for (const e of Geom.edges(r)) E.push(e);
    }
    return E.filter((e) => (e.k === 'seg' ? len(sub2(e.b, e.a)) > 1e-12 : e.r > 1e-12));
  }
  const edgeBB = (e) => (e.k === 'seg' ? [Math.min(e.a[0], e.b[0]), Math.min(e.a[1], e.b[1]), Math.max(e.a[0], e.b[0]), Math.max(e.a[1], e.b[1])] : [e.c[0] - e.r, e.c[1] - e.r, e.c[0] + e.r, e.c[1] + e.r]);
  /** Busca la región cerrada más pequeña que contiene (x, y) y sus islas. Devuelve {paths} o {error}. */
  function regionEn(E0, x, y) {
    if (!E0.length) return { error: 'No hay objetos alrededor del punto.' };
    let all = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of E0) { const b = edgeBB(e); all = [Math.min(all[0], b[0]), Math.min(all[1], b[1]), Math.max(all[2], b[2]), Math.max(all[3], b[3])]; }
    const ext = Math.max(all[2] - all[0], all[3] - all[1]) || 1;
    for (let R = ext / 64; ; R *= 2) {
      const W = [x - R, y - R, x + R, y + R];
      const E = E0.filter((e) => { const b = edgeBB(e); return !(b[2] < W[0] || b[0] > W[2] || b[3] < W[1] || b[1] > W[3]); });
      const res = E.length > 6000 ? { error: 'Demasiados objetos alrededor del punto; designe los contornos con la opción Seleccionar objetos.' } : caras(E, x, y, ext);
      if (res.error && res.fatal) return res;
      const cubre = W[0] <= all[0] && W[1] <= all[1] && W[2] >= all[2] && W[3] >= all[3];
      if (res.paths) { const b = res.bb; if (cubre || (b[0] > W[0] && b[1] > W[1] && b[2] < W[2] && b[3] < W[3])) return res; }
      if (cubre) return res.paths ? res : { error: res.error || 'No se encontró un contorno cerrado alrededor del punto.' };
    }
  }
  function caras(E, px, py, ext) {
    const tol = ext * 1e-9 + 1e-12;
    // 1) cortes entre todos los bordes (parámetro t 0–1 en segmentos, u en radianes desde a0 en arcos)
    const cuts = E.map((e) => (e.k === 'arc' && e.full ? [0, Math.PI, TAU] : [0, e.k === 'seg' ? 1 : n2(e.a1 - e.a0) || TAU]));
    const span = (e) => (e.k === 'seg' ? 1 : e.full ? TAU : n2(e.a1 - e.a0) || TAU);
    const param = (e, x, y) => (e.k === 'seg' ? (Math.abs(e.b[0] - e.a[0]) > Math.abs(e.b[1] - e.a[1]) ? (x - e.a[0]) / (e.b[0] - e.a[0]) : (y - e.a[1]) / (e.b[1] - e.a[1])) : n2(Math.atan2(y - e.c[1], x - e.c[0]) - (e.full ? 0 : e.a0)));
    const BB = E.map(edgeBB);
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const a = BB[i], b = BB[j];
      if (a[2] < b[0] - tol || b[2] < a[0] - tol || a[3] < b[1] - tol || b[3] < a[1] - tol) continue;
      const ei = E[i], ej = E[j]; let pts = [];
      if (ei.k === 'seg') pts = Geom.lineHits(ei.a, ei.b, ej).filter((h) => h.t >= -1e-9 && h.t <= 1 + 1e-9).map((h) => [h.x, h.y]);
      else if (ej.k === 'seg') pts = Geom.lineHits(ej.a, ej.b, ei).filter((h) => h.t >= -1e-9 && h.t <= 1 + 1e-9).map((h) => [h.x, h.y]);
      else pts = Geom.circleHits(ei.c, ei.r, ej).filter((g) => ei.full || n2(g - ei.a0) <= n2(ei.a1 - ei.a0) + 1e-9).map((g) => [ei.c[0] + ei.r * Math.cos(g), ei.c[1] + ei.r * Math.sin(g)]);
      for (const [x, y] of pts) {
        const ti = param(ei, x, y), tj = param(ej, x, y);
        if (ti > -1e-9 && ti < span(ei) + 1e-9) cuts[i].push(Math.min(span(ei), Math.max(0, ti)));
        if (tj > -1e-9 && tj < span(ej) + 1e-9) cuts[j].push(Math.min(span(ej), Math.max(0, tj)));
      }
    }
    // 2) piezas y vértices
    const V = []; const grid = new Map(); const cell = tol * 1e3;
    const vid = (p) => {
      const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of grid.get((gx + dx) + ',' + (gy + dy)) || []) if (Math.hypot(V[k][0] - p[0], V[k][1] - p[1]) < cell) return k;
      V.push(p); const key = gx + ',' + gy; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(V.length - 1); return V.length - 1;
    };
    const P = []; const seen = new Set();
    E.forEach((e, i) => {
      const ts = [...new Set(cuts[i].map((t) => +t.toFixed(12)))].sort((a, b) => a - b);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1]; if (t1 - t0 < 1e-10) continue;
        let piece;
        if (e.k === 'seg') { const A = [e.a[0] + (e.b[0] - e.a[0]) * t0, e.a[1] + (e.b[1] - e.a[1]) * t0], B = [e.a[0] + (e.b[0] - e.a[0]) * t1, e.a[1] + (e.b[1] - e.a[1]) * t1]; if (len(sub2(B, A)) < cell) continue; piece = { a: A, b: B, bulge: 0 }; }
        else { const g0 = (e.full ? 0 : e.a0) + t0, g1 = (e.full ? 0 : e.a0) + t1; const A = [e.c[0] + e.r * Math.cos(g0), e.c[1] + e.r * Math.sin(g0)], B = [e.c[0] + e.r * Math.cos(g1), e.c[1] + e.r * Math.sin(g1)]; piece = { a: A, b: B, bulge: Math.tan((t1 - t0) / 4) }; }
        const u = vid(piece.a), v = vid(piece.b); if (u === v) continue;
        const mid = Geom.segPt(piece, 0.5); const key = [Math.min(u, v), Math.max(u, v), Math.round(mid[0] / cell), Math.round(mid[1] / cell)].join(',');
        if (seen.has(key)) continue; seen.add(key);
        P.push({ u, v, piece });
      }
    });
    // 3) quitar colgantes
    let alive = P.map(() => true);
    for (let changed = true; changed;) {
      changed = false; const deg = new Map();
      P.forEach((p, i) => { if (!alive[i]) return; deg.set(p.u, (deg.get(p.u) || 0) + 1); deg.set(p.v, (deg.get(p.v) || 0) + 1); });
      P.forEach((p, i) => { if (alive[i] && (deg.get(p.u) === 1 || deg.get(p.v) === 1)) { alive[i] = false; changed = true; } });
    }
    const PP = P.filter((_, i) => alive[i]);
    if (!PP.length) return { error: 'No se encontró un contorno cerrado alrededor del punto.' };
    // 4) medias aristas ordenadas por ángulo en cada vértice
    const HE = []; const out = new Map();
    PP.forEach((p, i) => {
      for (const fwd of [true, false]) {
        const h = { i, fwd, from: fwd ? p.u : p.v, to: fwd ? p.v : p.u };
        const pr = fwd ? p.piece : { a: p.piece.b, b: p.piece.a, bulge: -p.piece.bulge };
        h.seg = pr; const q = Geom.segPt(pr, 1e-3), o = V[h.from];
        h.ang = Math.atan2(q[1] - o[1], q[0] - o[0]);
        HE.push(h); if (!out.has(h.from)) out.set(h.from, []); out.get(h.from).push(h);
      }
    });
    for (const l of out.values()) l.sort((a, b) => a.ang - b.ang);
    const twin = (h) => out.get(h.to).find((g) => g.i === h.i && g.fwd !== h.fwd);
    const used = new Set(); const faces = [];
    for (const h0 of HE) {
      if (used.has(h0)) continue;
      const f = []; let h = h0; let guard = 0;
      while (h && !used.has(h) && guard++ < 100000) {
        used.add(h); f.push(h);
        const t = twin(h), l = out.get(h.to), k = l.indexOf(t);
        h = l[(k - 1 + l.length) % l.length];
      }
      const vs = f.map((g) => [g.seg.a[0], g.seg.a[1], g.seg.bulge]);
      const poly = sampleVs(vs);
      faces.push({ vs, poly, area: areaPoly(poly), verts: new Set(f.map((g) => g.from)) });
    }
    // 5) cara más pequeña que contiene el punto
    const dentro = faces.filter((f) => f.area > 0 && inPoly(f.poly, px, py)).sort((a, b) => a.area - b.area);
    if (!dentro.length) return { error: 'No se encontró un contorno cerrado alrededor del punto.' };
    const F0 = dentro[0];
    // 6) islas: el contorno exterior de cada grupo conectado que queda dentro de la región (y no la toca)
    const comp = new Map(); let nc = 0; // vértice → grupo
    const adj = new Map(); PP.forEach((p) => { (adj.get(p.u) || adj.set(p.u, []).get(p.u)).push(p.v); (adj.get(p.v) || adj.set(p.v, []).get(p.v)).push(p.u); });
    for (const v0 of adj.keys()) { if (comp.has(v0)) continue; const st = [v0]; comp.set(v0, nc); while (st.length) { const v = st.pop(); for (const w of adj.get(v)) if (!comp.has(w)) { comp.set(w, nc); st.push(w); } } nc++; }
    const c0 = comp.get([...F0.verts][0]);
    const islas = faces.filter((f) => f.area < 0 && comp.get([...f.verts][0]) !== c0 && f.poly.every(([x, y]) => inPoly(F0.poly, x, y)));
    const paths = [F0.vs, ...islas.map((f) => f.vs)];
    let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of F0.poly) bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
    return { paths, bb, islas: islas.length };
  }
  /** SOMBREA por punto interior: busca el contorno cerrado más pequeño alrededor de (x, y) entre `recs` (con islas). */
  S.sombrearPunto = function (page, recs, pt, o = {}) {
    const e = need2000(this); if (e) return e;
    const P = patron(o.patron || 'DIAGONAL'); if (!P) return { error: `No conozco el patrón «${o.patron}». Patrones: ${Object.keys(PATRONES).join(', ')}.` };
    const reg = regionEn(bordesDe(recs), pt[0], pt[1]);
    if (reg.error) return reg;
    const r = this._hatch(page, reg.paths, P, { ...o, semilla: pt });
    if (r.ok) r.islas = reg.islas;
    return r;
  };

  // ================================================================ TABLA simple (líneas + textos)
  /**
   * TABLA: cuadro con filas y columnas hecho de LÍNEAS y TEXTOS (lo que cualquier CAD lee). o = {at (esquina superior
   * izquierda), datos: [[celda, …], …], anchos: [mm…] o un número, alto (de fila), h (altura de texto), titulo, alinear:
   * 'I'|'C' (por columna, arreglo o letra)}. El texto que no cabe se angosta (factor de ancho) hasta 0,7; si aún no cabe,
   * se parte en renglones y la fila crece (no se sale de la celda).
   */
  S.crearTabla = function (page, o) {
    const datos = (o.datos || []).map((f) => (Array.isArray(f) ? f : String(f).split(';')).map((c) => String(c ?? '').trim()));
    const ncol = Math.max(o.columnas || 0, ...datos.map((f) => f.length), 1);
    const nfil = Math.max(o.filas || 0, datos.length) + (o.titulo ? 1 : 0);
    if (nfil < 1) return { error: 'La tabla necesita al menos una fila.' };
    if (ncol * nfil > 5000) return { error: 'Tabla demasiado grande (máximo 5000 celdas).' };
    const h = o.h > 0 ? o.h : 2.5, alto = o.alto > 0 ? o.alto : h * 2;
    const anchos = Array.isArray(o.anchos) ? Array.from({ length: ncol }, (_, i) => o.anchos[i] ?? o.anchos[o.anchos.length - 1]) : Array(ncol).fill(o.anchos > 0 ? o.anchos : 30);
    if (anchos.some((w) => !(w > 0))) return { error: 'Los anchos de columna deben ser mayores que 0.' };
    const W = anchos.reduce((a, b) => a + b, 0);
    const [x0, y0] = o.at; const L = o.capa || this.capaActual();
    const st = this.estiloActual(); const style = this.findRec('STYLE', st) ? st : null;
    const adds = [];
    const margen = Math.min(h * 0.5, alto * 0.2);
    let x = x0; const xs = [x0]; for (const w of anchos) { x += w; xs.push(x); }
    const cw = (t) => 0.75 * h * t.length; // ancho estimado del texto (conservador)
    /** Renglones de una celda: si el texto no cabe ni angostado a 0,7, se parte en varios renglones (la fila crece). */
    const partir = (txt, ancho) => {
      if (!txt || cw(txt) * 0.7 <= ancho || ancho <= 0) return [txt];
      const max = Math.max(1, Math.floor(ancho / (0.75 * h * 0.7)));
      const out = []; let cur = '';
      for (let w of txt.split(/\s+/)) {
        while (w.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
        if (!w) continue;
        if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; }
      }
      if (cur) out.push(cur);
      return out;
    };
    const al = (j) => (Array.isArray(o.alinear) ? o.alinear[j] : o.alinear) || (j === 0 ? 'I' : 'C');
    // filas: [{celdas: [{lineas, x0, x1, just}]}] y su alto
    const filas = [];
    if (o.titulo) filas.push([{ lineas: partir(String(o.titulo), W - 2 * margen), x0, x1: x0 + W, just: 'C' }]);
    for (let i = 0; i < nfil - (o.titulo ? 1 : 0); i++) { const f = datos[i] || []; filas.push(f.slice(0, ncol).map((t, j) => ({ lineas: partir(t, anchos[j] - 2 * margen), x0: xs[j], x1: xs[j + 1], just: al(j) }))); }
    const paso = h * 1.5;
    const altos = filas.map((f) => Math.max(alto, ...f.map((c) => (c.lineas.length > 1 ? (c.lineas.length - 1) * paso + h + 2 * margen + h * 0.4 : alto))));
    const ys = [y0]; for (const a of altos) ys.push(ys[ys.length - 1] - a);
    const H = y0 - ys[ys.length - 1];
    const ln = (a, b) => adds.push(this.make(page, 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], L));
    for (const yy of ys) ln([x0, yy], [x0 + W, yy]);
    xs.forEach((xx, j) => { if (o.titulo && j > 0 && j < ncol) ln([xx, ys[1]], [xx, y0 - H]); else ln([xx, y0], [xx, y0 - H]); });
    const texto = (txt, cx0, cx1, yc, just) => {
      const ancho = cx1 - cx0 - 2 * margen;
      const est = cw(txt); const wf = est > ancho && ancho > 0 ? Math.max(0.5, ancho / est) : 1;
      const p = just === 'C' ? [(cx0 + cx1) / 2, yc] : [cx0 + margen, yc];
      const body = Documento.textoPares(p, h, 0, txt, { just: just === 'C' ? 'MC' : 'MI', style });
      if (wf < 1) body.splice(body.findIndex((q) => q[0] === 1) + 1, 0, [41, +wf.toFixed(4)]);
      adds.push(this.make(page, 'TEXT', 'AcDbText', body, L));
    };
    filas.forEach((f, i) => f.forEach((c) => {
      if (!c.lineas[0]) return;
      const mid = (ys[i] + ys[i + 1]) / 2, n = c.lineas.length;
      c.lineas.forEach((t, k) => texto(t, c.x0, c.x1, mid + ((n - 1) / 2 - k) * paso, c.just));
    }));
    this.commit(`Tabla ${nfil}×${ncol}`, { adds });
    return { ok: true, recs: adds, ancho: W, alto: H, filas: nfil, columnas: ncol };
  };

  // ================================================================ Símbolos EPM y redes (biblioteca de simbolos_epm.js)
  /** Agrega al plano la definición de un bloque dado como pares sin handles ({nombre, base, ents: [[[0, tipo], …], …]}).
   *  Devuelve los registros sin guardar en el deshacer: {b, br}. */
  S._bloqueDePares = function (def) {
    const { b, br } = this._bloqueNuevo(def.nombre, def.base || [0, 0], 0);
    for (const e of def.ents) {
      const type = String(e[0][1]).trim();
      const pairs = e.slice(1).filter((q) => q[0] !== 5 && q[0] !== 330).map(([c, v]) => [c, String(v)]);
      const r = new DXF.Rec(type, [[5, this.newHandle()], [330, b.owner], ...pairs]); r.inBlock = true; r.home = b.ents;
      b.ents.push(r);
    }
    if (b.ents.some((r) => r.type === 'ATTDEF')) { b.flags = 2; b.head.p = b.head.p.map(([c, v]) => (c === 70 ? [70, '2'] : [c, v])); }
    return { b, br };
  };
  /** Define (si falta) un símbolo EPM en el plano. Un paso de deshacer. */
  S.definirSimbolo = function (nombre) {
    const e = need2000(this); if (e) return e;
    if (typeof SimbolosEPM === 'undefined') return { error: 'No está cargada la biblioteca de símbolos EPM.' };
    const ya = this.D.blocks.get(up(nombre)); if (ya && !ya.deleted) return { ok: true, ya: true, block: ya };
    const def = SimbolosEPM.paresBloque(nombre); if (!def) return { error: `No existe el símbolo «${nombre}».` };
    const { b, br } = this._bloqueDePares(def);
    this.commit(`Definir símbolo ${def.nombre}`, { adds: [br], newBlocks: [b], tables: true });
    return { ok: true, block: b };
  };
  /** INSERTARSIMBOLO por código: define el símbolo si falta y lo inserta (un solo paso de deshacer). */
  S.insertarSimbolo = function (page, nombre, at, s = 1, rot = 0, valores = []) {
    const e = need2000(this); if (e) return e;
    if (typeof SimbolosEPM === 'undefined') return { error: 'No está cargada la biblioteca de símbolos EPM.' };
    let b = this.D.blocks.get(up(nombre)); const adds = [], newBlocks = [];
    if (!b || b.deleted) {
      const def = SimbolosEPM.paresBloque(nombre); if (!def) return { error: `No existe el símbolo «${nombre}».` };
      const x = this._bloqueDePares(def); b = x.b; adds.push(x.br); newBlocks.push(b);
    }
    const recs = this._insercion(page, b, at, s, rot, valores);
    this.commit(`Insertar ${b.name}`, { adds: [...adds, ...recs], newBlocks, tables: newBlocks.length > 0 });
    return { ok: true, rec: recs[0], recs, nuevo: newBlocks.length > 0 };
  };
  /** REDEPM: dibuja una red (MT/BT…) con su convención a lo largo de los puntos. escala = 1 en planchas (mm), 0,5 en el
   *  modelo en metros a 1:500. */
  S.trazarRedEPM = function (page, tipo, estado, pts, o = {}) {
    if (typeof SimbolosEPM === 'undefined') return { error: 'No está cargada la biblioteca de símbolos EPM.' };
    if (!SimbolosEPM.REDES[tipo]) return { error: `Tipo de red desconocido: ${tipo}. Tipos: ${Object.keys(SimbolosEPM.REDES).join(', ')}.` };
    if (pts.length < 2) return { error: 'Precise al menos dos puntos.' };
    const L = o.capa || this.capaActual(); const adds = [];
    const lz = {
      tipo: 'modelo',
      linea: (a, b) => adds.push(this.make(page, 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], L)),
      polilinea: (q) => { const body = [[90, q.length], [70, 0], [43, 0]]; for (const p of q) body.push([10, p[0]], [20, p[1]]); adds.push(this.make(page, 'LWPOLYLINE', 'AcDbPolyline', body, L)); },
    };
    SimbolosEPM.trazarRed(lz, tipo, estado, pts, { escala: o.escala || 1, capa: L });
    if (!adds.length) return { error: 'La red quedó vacía (¿puntos repetidos?).' };
    this.commit(`Red ${tipo}`, { adds });
    return { ok: true, n: adds.length, recs: adds };
  };

  return { PATRONES, ALIAS_PATRON, patron, conform, mirrorC, reflectX, generarCota, leerCota, regionEn, bordesDe, contornoDe, textoMedida, hatchBody };
})();
if (typeof module !== 'undefined') module.exports = Dibujo; else self.Dibujo = Dibujo;
