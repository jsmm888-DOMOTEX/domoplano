// Domoplano — geometría para RECORTA, ALARGA, DESFASE y ESTIRA (código propio).
// Todo en coordenadas del dibujo (WCS). Las entidades reflejadas (extrusión -Z) se pasan a WCS y se devuelven a OCS.
const Geom = (() => {
  const TAU = Math.PI * 2, EPS = 1e-9;
  const n2 = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
  const deg = (r) => r * 180 / Math.PI, rad = (d) => d * Math.PI / 180;
  const mir = (rec) => rec.num(230, 1) < 0;

  // ---------------------------------------------------------------- bordes de una entidad
  // seg: {k:'seg', a:[x,y], b:[x,y]}   arc: {k:'arc', c:[x,y], r, a0, a1 (radianes, antihorario), full}
  function lwVerts(rec) {
    const vs = []; let cur = null;
    for (const [c, v] of rec.p) {
      if (c === 10) { cur = [parseFloat(v), 0, 0]; vs.push(cur); } else if (c === 20 && cur) cur[1] = parseFloat(v); else if (c === 42 && cur) cur[2] = parseFloat(v);
    }
    return vs;
  }
  function bulgeEdge(a, b, bulge) {
    const th = 4 * Math.atan(bulge), d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < EPS) return null;
    const r = d / (2 * Math.sin(Math.abs(th) / 2));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const h = Math.sqrt(Math.max(0, r * r - d * d / 4)) * Math.sign(bulge) * (Math.abs(th) > Math.PI ? -1 : 1);
    const ux = -(b[1] - a[1]) / d, uy = (b[0] - a[0]) / d;
    const c = [mx + ux * h, my + uy * h];
    let a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
    if (bulge < 0) [a0, a1] = [a1, a0];
    return { k: 'arc', c, r, a0: n2(a0), a1: n2(a1) };
  }
  function edges(rec) {
    const t = rec.type, m = mir(rec);
    const X = (x) => (m ? -x : x);
    if (t === 'LINE') return [{ k: 'seg', a: [rec.num(10), rec.num(20)], b: [rec.num(11), rec.num(21)] }];
    if (t === 'CIRCLE') return [{ k: 'arc', c: [X(rec.num(10)), rec.num(20)], r: rec.num(40), a0: 0, a1: TAU, full: true }];
    if (t === 'ARC') {
      let a0 = rad(rec.num(50)), a1 = rad(rec.num(51));
      if (m) [a0, a1] = [Math.PI - a1, Math.PI - a0];
      return [{ k: 'arc', c: [X(rec.num(10)), rec.num(20)], r: rec.num(40), a0: n2(a0), a1: n2(a1) }];
    }
    if (t === 'LWPOLYLINE') {
      const vs = lwVerts(rec).map(([x, y, b]) => [X(x), y, m ? -b : b]);
      const out = []; const closed = (rec.int(70) & 1) === 1;
      const n = closed ? vs.length : vs.length - 1;
      for (let k = 0; k < n; k++) {
        const a = vs[k], b = vs[(k + 1) % vs.length];
        if (Math.abs(a[2]) > 1e-12) { const e = bulgeEdge(a, b, a[2]); if (e) out.push(e); } else out.push({ k: 'seg', a: [a[0], a[1]], b: [b[0], b[1]] });
      }
      return out;
    }
    return [];
  }

  const onArc = (e, ang) => e.full || n2(ang - e.a0) <= n2(e.a1 - e.a0) + 1e-9;
  /** Intersecciones de la recta a+t(b−a) con un borde. Devuelve [{t, x, y}] (t sin límites: la recta es infinita). */
  function lineHits(a, b, e) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const out = [];
    if (e.k === 'seg') {
      const ex = e.b[0] - e.a[0], ey = e.b[1] - e.a[1];
      const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-14) return out;
      const t = ((e.a[0] - a[0]) * ey - (e.a[1] - a[1]) * ex) / den;
      const u = ((e.a[0] - a[0]) * dy - (e.a[1] - a[1]) * dx) / den;
      if (u >= -1e-9 && u <= 1 + 1e-9) out.push({ t, x: a[0] + t * dx, y: a[1] + t * dy });
    } else {
      const fx = a[0] - e.c[0], fy = a[1] - e.c[1];
      const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - e.r * e.r;
      const disc = B * B - 4 * A * C; if (disc < 0 || A < 1e-20) return out;
      const sq = Math.sqrt(disc);
      for (const t of disc < 1e-14 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        const x = a[0] + t * dx, y = a[1] + t * dy;
        if (onArc(e, Math.atan2(y - e.c[1], x - e.c[0]))) out.push({ t, x, y });
      }
    }
    return out;
  }
  /** Intersecciones del círculo (c, r) con un borde, como ángulos sobre ese círculo. */
  function circleHits(c, r, e) {
    if (e.k === 'seg') return lineHits(e.a, e.b, { k: 'arc', c, r, full: true }).filter((h) => h.t >= -1e-9 && h.t <= 1 + 1e-9).map((h) => Math.atan2(h.y - c[1], h.x - c[0]));
    const d = Math.hypot(e.c[0] - c[0], e.c[1] - c[1]);
    if (d < 1e-12 || d > r + e.r + 1e-9 || d < Math.abs(r - e.r) - 1e-9) return [];
    const a = (r * r - e.r * e.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r * r - a * a));
    const px = c[0] + a * (e.c[0] - c[0]) / d, py = c[1] + a * (e.c[1] - c[1]) / d;
    const ox = -h * (e.c[1] - c[1]) / d, oy = h * (e.c[0] - c[0]) / d;
    const pts = h < 1e-12 ? [[px, py]] : [[px + ox, py + oy], [px - ox, py - oy]];
    return pts.filter(([x, y]) => onArc(e, Math.atan2(y - e.c[1], x - e.c[0]))).map(([x, y]) => Math.atan2(y - c[1], x - c[0]));
  }

  // ---------------------------------------------------------------- pares DXF de salida
  const F = (v) => Edit.fmt(v);
  function setPairs(p, map) { // map: código -> valor (primera aparición)
    const done = new Set();
    return p.map(([c, v]) => { if (c in map && !done.has(c)) { done.add(c); return [c, F(map[c])]; } return [c, v]; });
  }
  function linePairs(rec, a, b) { return setPairs(rec.p, { 10: a[0], 20: a[1], 11: b[0], 21: b[1] }); }
  /** Pares de un ARC con el arco WCS (a0→a1 antihorario), reutilizando capa/color del original (CIRCLE o ARC). */
  function arcPairs(rec, a0, a1) {
    let s0 = a0, s1 = a1;
    if (mir(rec)) [s0, s1] = [Math.PI - a1, Math.PI - a0];
    const map = { 50: deg(n2(s0)), 51: deg(n2(s1)) };
    if (rec.type === 'ARC') return setPairs(rec.p, map);
    const p = rec.p.filter(([c]) => c !== 5 && c !== 50 && c !== 51);
    p.push([100, 'AcDbArc'], [50, F(map[50])], [51, F(map[51])]);
    return p;
  }

  // ---------------------------------------------------------------- RECORTA
  /** Corta la parte de `rec` donde se hizo clic (px,py) usando como bordes `others` (registros). Devuelve
   *  {mods:[{rec,pairs}], adds:[{type,pairs,like}], dels:[rec]} o {error}. */
  function trim(rec, px, py, others) {
    const E = others.flatMap(edges);
    if (rec.type === 'LINE') {
      const a = [rec.num(10), rec.num(20)], b = [rec.num(11), rec.num(21)];
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2; if (L2 < 1e-20) return { error: 'Línea de largo cero.' };
      const tp = ((px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1])) / L2;
      const ts = E.flatMap((e) => lineHits(a, b, e)).map((h) => h.t).filter((t) => t > 1e-9 && t < 1 - 1e-9);
      if (!ts.length) return { error: 'Ningún objeto corta esa línea.' };
      const lo = Math.max(-Infinity, ...ts.filter((t) => t < tp)), hi = Math.min(Infinity, ...ts.filter((t) => t > tp));
      const P = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const pieces = [];
      if (lo > -Infinity) pieces.push([0, lo]);
      if (hi < Infinity) pieces.push([hi, 1]);
      if (!pieces.length) return { dels: [rec] };
      const res = { mods: [{ rec, pairs: linePairs(rec, P(pieces[0][0]), P(pieces[0][1])) }], adds: [] };
      if (pieces[1]) res.adds.push({ type: 'LINE', like: rec, pairs: linePairs(rec, P(pieces[1][0]), P(pieces[1][1])) });
      return res;
    }
    if (rec.type === 'CIRCLE' || rec.type === 'ARC') {
      const e = edges(rec)[0];
      const ap = Math.atan2(py - e.c[1], px - e.c[0]);
      const span = e.full ? TAU : n2(e.a1 - e.a0) || TAU;
      const u = (ang) => n2(ang - e.a0);
      const us = [...new Set(E.flatMap((q) => circleHits(e.c, e.r, q)).map((ang) => +u(ang).toFixed(12)))]
        .filter((x) => (e.full ? true : x > 1e-9 && x < span - 1e-9));
      if (e.full) {
        if (us.length < 2) return { error: 'Un círculo necesita dos cortes para recortarse.' };
        const up = u(ap); const sorted = us.sort((x, y) => x - y);
        let lo = sorted.filter((x) => x < up).pop(); let hi = sorted.find((x) => x > up);
        if (lo === undefined) lo = sorted[sorted.length - 1] - TAU;
        if (hi === undefined) hi = sorted[0] + TAU;
        // queda el arco de hi a lo (+2π)
        return { dels: [rec], adds: [{ type: 'ARC', like: rec, pairs: arcPairs(rec, e.a0 + hi, e.a0 + lo + TAU) }] };
      }
      if (!us.length) return { error: 'Ningún objeto corta ese arco.' };
      const up = u(ap);
      const lo = Math.max(-Infinity, ...us.filter((x) => x < up)), hi = Math.min(Infinity, ...us.filter((x) => x > up));
      const pieces = [];
      if (lo > -Infinity) pieces.push([0, lo]);
      if (hi < Infinity) pieces.push([hi, span]);
      if (!pieces.length) return { dels: [rec] };
      const res = { mods: [{ rec, pairs: arcPairs(rec, e.a0 + pieces[0][0], e.a0 + pieces[0][1]) }], adds: [] };
      if (pieces[1]) res.adds.push({ type: 'ARC', like: rec, pairs: arcPairs(rec, e.a0 + pieces[1][0], e.a0 + pieces[1][1]) });
      return res;
    }
    if (rec.type === 'LWPOLYLINE') return trimLw(rec, px, py, E);
    return { error: `RECORTA todavía no trabaja con ${rec.type} (sí con líneas, arcos, círculos y polilíneas).` };
  }

  // ---------------------------------------------------------------- ALARGA
  function extend(rec, px, py, others) {
    const E = others.flatMap(edges);
    if (rec.type === 'LINE') {
      const a = [rec.num(10), rec.num(20)], b = [rec.num(11), rec.num(21)];
      const endB = Math.hypot(px - b[0], py - b[1]) < Math.hypot(px - a[0], py - a[1]);
      const ts = E.flatMap((e) => lineHits(a, b, e)).map((h) => h.t);
      const t = endB ? Math.min(Infinity, ...ts.filter((x) => x > 1 + 1e-9)) : Math.max(-Infinity, ...ts.filter((x) => x < -1e-9));
      if (!isFinite(t)) return { error: 'No hay ningún objeto en esa dirección para alargar la línea.' };
      const P = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      return { mods: [{ rec, pairs: endB ? linePairs(rec, a, P) : linePairs(rec, P, b) }] };
    }
    if (rec.type === 'ARC') {
      const e = edges(rec)[0];
      const pa = [e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0)], pb = [e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1)];
      const endB = Math.hypot(px - pb[0], py - pb[1]) < Math.hypot(px - pa[0], py - pa[1]);
      const angs = E.flatMap((q) => circleHits(e.c, e.r, q));
      const span = n2(e.a1 - e.a0);
      if (endB) {
        const ds = angs.map((g) => n2(g - e.a1)).filter((d) => d > 1e-9 && d < TAU - span - 1e-9);
        if (!ds.length) return { error: 'No hay ningún objeto en esa dirección para alargar el arco.' };
        return { mods: [{ rec, pairs: arcPairs(rec, e.a0, e.a1 + Math.min(...ds)) }] };
      }
      const ds = angs.map((g) => n2(e.a0 - g)).filter((d) => d > 1e-9 && d < TAU - span - 1e-9);
      if (!ds.length) return { error: 'No hay ningún objeto en esa dirección para alargar el arco.' };
      return { mods: [{ rec, pairs: arcPairs(rec, e.a0 - Math.min(...ds), e.a1) }] };
    }
    if (rec.type === 'LWPOLYLINE') return extendLw(rec, px, py, E);
    return { error: `ALARGA todavía no trabaja con ${rec.type} (sí con líneas, arcos y polilíneas abiertas).` };
  }

  // ---------------------------------------------------------------- DESFASE
  /** Copia paralela a distancia d, hacia el lado del punto (sx, sy). Devuelve {type, pairs} o {error}. */
  function offset(rec, d, sx, sy) {
    if (rec.type === 'LINE') {
      const a = [rec.num(10), rec.num(20)], b = [rec.num(11), rec.num(21)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-12) return { error: 'Línea de largo cero.' };
      const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
      const side = Math.sign((sx - a[0]) * nx + (sy - a[1]) * ny) || 1;
      return { type: 'LINE', pairs: linePairs(rec, [a[0] + nx * d * side, a[1] + ny * d * side], [b[0] + nx * d * side, b[1] + ny * d * side]) };
    }
    if (rec.type === 'CIRCLE' || rec.type === 'ARC') {
      const e = edges(rec)[0];
      const out = Math.hypot(sx - e.c[0], sy - e.c[1]) > e.r;
      const r = e.r + (out ? d : -d);
      if (r <= 1e-9) return { error: 'El desfase hacia adentro es mayor que el radio.' };
      return { type: rec.type, pairs: setPairs(rec.p, { 40: r }) };
    }
    if (rec.type === 'LWPOLYLINE') {
      const m = mir(rec);
      const vs = lwVerts(rec);
      if (vs.some((v) => Math.abs(v[2]) > 1e-12)) return offsetLw(rec, d, sx, sy);
      const closed = (rec.int(70) & 1) === 1;
      const P = vs.map((v) => [v[0], v[1]]);
      const sxo = m ? -sx : sx; // el punto del lado, en el sistema de la polilínea
      // segmento más cercano al punto, para saber el lado
      let best = 0, bd = Infinity;
      const nseg = closed ? P.length : P.length - 1;
      for (let k = 0; k < nseg; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1e-20;
        const t = Math.max(0, Math.min(1, ((sxo - a[0]) * (b[0] - a[0]) + (sy - a[1]) * (b[1] - a[1])) / L2));
        const dd = Math.hypot(sxo - a[0] - t * (b[0] - a[0]), sy - a[1] - t * (b[1] - a[1]));
        if (dd < bd) { bd = dd; best = k; }
      }
      const a = P[best], b = P[(best + 1) % P.length];
      const side = Math.sign((b[0] - a[0]) * (sy - a[1]) - (b[1] - a[1]) * (sxo - a[0])) || 1; // + = izquierda
      const off = (k) => { const p0 = P[k], p1 = P[(k + 1) % P.length]; const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const nx = -(p1[1] - p0[1]) / L * d * side, ny = (p1[0] - p0[0]) / L * d * side; return [[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny]]; };
      const segs = []; for (let k = 0; k < nseg; k++) segs.push(off(k));
      const cross = (s1, s2) => { const h = lineHits(s1[0], s1[1], { k: 'seg', a: [s2[0][0] - (s2[1][0] - s2[0][0]) * 1e6, s2[0][1] - (s2[1][1] - s2[0][1]) * 1e6], b: [s2[1][0] + (s2[1][0] - s2[0][0]) * 1e6, s2[1][1] + (s2[1][1] - s2[0][1]) * 1e6] });
        return h.length ? [h[0].x, h[0].y] : s1[1]; };
      const Q = [];
      for (let k = 0; k < P.length; k++) {
        if (!closed && k === 0) { Q.push(segs[0][0]); continue; }
        if (!closed && k === P.length - 1) { Q.push(segs[nseg - 1][1]); continue; }
        const prev = segs[(k - 1 + nseg) % nseg], next = segs[k % nseg];
        Q.push(cross(prev, next));
      }
      let i = 0;
      const pairs = rec.p.map(([c, v]) => {
        if (c === 10) return [10, F(Q[i][0])];
        if (c === 20) { const q = [20, F(Q[i][1])]; i++; return q; }
        return [c, v];
      });
      return { type: 'LWPOLYLINE', pairs };
    }
    return { error: `DESFASE todavía no trabaja con ${rec.type} (sí con líneas, círculos, arcos y polilíneas rectas).` };
  }

  // ---------------------------------------------------------------- POLILÍNEAS con arcos (recortar, alargar, desfase, empalme)
  /** Segmentos de una LWPOLYLINE en WCS: [{a, b, bulge}] y si es cerrada. */
  function lwSegs(rec) {
    const m = mir(rec);
    const vs = lwVerts(rec).map(([x, y, b]) => [m ? -x : x, y, m ? -b : b]);
    const closed = (rec.int(70) & 1) === 1;
    const n = closed ? vs.length : vs.length - 1;
    const segs = [];
    for (let k = 0; k < n; k++) { const a = vs[k], b = vs[(k + 1) % vs.length]; segs.push({ a: [a[0], a[1]], b: [b[0], b[1]], bulge: a[2] }); }
    return { segs, closed, verts: vs };
  }
  /** Geometría de un segmento con comba: centro, radio, ángulo inicial y barrido con signo. */
  function segArc(sg) {
    if (Math.abs(sg.bulge) < 1e-12) return null;
    const [a, b] = [sg.a, sg.b]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 1e-12) return null;
    const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d, bu = sg.bulge;
    const k = d * (1 - bu * bu) / (4 * bu);
    const c = [(a[0] + b[0]) / 2 - uy * k, (a[1] + b[1]) / 2 + ux * k];
    const r = d * (1 + bu * bu) / (4 * Math.abs(bu));
    return { c, r, as: Math.atan2(a[1] - c[1], a[0] - c[0]), th: 4 * Math.atan(bu) };
  }
  function segPt(sg, t) {
    const A = segArc(sg);
    if (!A) return [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
    const g = A.as + A.th * t; return [A.c[0] + A.r * Math.cos(g), A.c[1] + A.r * Math.sin(g)];
  }
  function segEdge(sg) {
    const A = segArc(sg);
    if (!A) return { k: 'seg', a: sg.a, b: sg.b };
    return A.th > 0 ? { k: 'arc', c: A.c, r: A.r, a0: n2(A.as), a1: n2(A.as + A.th) } : { k: 'arc', c: A.c, r: A.r, a0: n2(A.as + A.th), a1: n2(A.as) };
  }
  /** Parámetro t (0–1) de un ángulo sobre el arco del segmento, o null si cae fuera. */
  function segT(A, ang) { const t = A.th > 0 ? n2(ang - A.as) / A.th : n2(A.as - ang) / -A.th; return t >= -1e-9 && t <= 1 + 1e-9 ? t : null; }
  /** Cortes de los bordes E sobre cada segmento: lista de parámetros globales T = k + t. */
  function segHits(segs, E) {
    const out = [];
    segs.forEach((sg, k) => {
      const A = segArc(sg);
      for (const e of E) {
        if (!A) { for (const h of lineHits(sg.a, sg.b, e)) if (h.t >= -1e-9 && h.t <= 1 + 1e-9) out.push(k + Math.min(1, Math.max(0, h.t))); }
        else for (const g of circleHits(A.c, A.r, e)) { const t = segT(A, g); if (t !== null) out.push(k + Math.min(1, Math.max(0, t))); }
      }
    });
    return out.sort((x, y) => x - y);
  }
  /** Parámetro global del punto de la polilínea más cercano a (px, py). */
  function segNearest(segs, px, py) {
    let best = 0, bd = Infinity;
    segs.forEach((sg, k) => {
      const A = segArc(sg); let t;
      if (!A) { const L2 = (sg.b[0] - sg.a[0]) ** 2 + (sg.b[1] - sg.a[1]) ** 2 || 1e-20; t = Math.max(0, Math.min(1, ((px - sg.a[0]) * (sg.b[0] - sg.a[0]) + (py - sg.a[1]) * (sg.b[1] - sg.a[1])) / L2)); }
      else { const tt = segT(A, Math.atan2(py - A.c[1], px - A.c[0])); t = tt === null ? (Math.hypot(px - sg.a[0], py - sg.a[1]) < Math.hypot(px - sg.b[0], py - sg.b[1]) ? 0 : 1) : tt; }
      const q = segPt(sg, t); const d = Math.hypot(q[0] - px, q[1] - py);
      if (d < bd) { bd = d; best = k + t; }
    });
    return best;
  }
  /** Vértices [x, y, comba] del tramo T0→T1 (T1 puede pasar de n en polilíneas cerradas). */
  function subVerts(segs, T0, T1) {
    const n = segs.length, out = [];
    let T = T0;
    while (T < T1 - 1e-12) {
      const k = Math.floor(T + 1e-12), kk = ((k % n) + n) % n, sg = segs[kk];
      const t0 = T - k, t1 = Math.min(T1 - k, 1);
      const A = segArc(sg);
      out.push([...segPt(sg, t0), A ? Math.tan(A.th * (t1 - t0) / 4) : 0]);
      T = k + t1; if (t1 >= 1) T = k + 1;
    }
    const k = Math.floor(T1 - 1e-12), kk = ((k % n) + n) % n;
    out.push([...segPt(segs[kk], T1 - k), 0]);
    return out;
  }
  /** Pares de la LWPOLYLINE `rec` con vértices nuevos (WCS) y cerrada o no. Quita anchos por vértice. */
  function lwPairs(rec, verts, closed) {
    const m = mir(rec);
    const head = []; let seen = false;
    for (const q of rec.p) {
      if (q[0] === 10) { seen = true; continue; }
      if (seen && [20, 30, 40, 41, 42, 91].includes(q[0])) continue;
      if (q[0] === 90) { head.push([90, String(verts.length)]); continue; }
      if (q[0] === 70) { const f = parseInt(q[1], 10) || 0; head.push([70, String(closed ? f | 1 : f & ~1)]); continue; }
      if (!seen) head.push(q.slice()); else head.push(q.slice());
    }
    // los vértices van donde estaba el primero (antes de 210/XDATA)
    let at = head.findIndex((q) => q[0] === 210 || q[0] >= 1000); if (at < 0) at = head.length;
    const vp = [];
    for (const [x, y, b] of verts) { vp.push([10, F(m ? -x : x)], [20, F(y)]); if (Math.abs(b) > 1e-12) vp.push([42, F(m ? -b : b)]); }
    head.splice(at, 0, ...vp);
    return head;
  }
  function trimLw(rec, px, py, E) {
    const { segs, closed } = lwSegs(rec); const n = segs.length;
    if (!n) return { error: 'Polilínea vacía.' };
    const Tc = segNearest(segs, px, py);
    let Ts = segHits(segs, E).filter((T, i, a) => i === 0 || T - a[i - 1] > 1e-9);
    if (!closed) Ts = Ts.filter((T) => T > 1e-9 && T < n - 1e-9);
    if (!Ts.length) return { error: 'Ningún objeto corta esa polilínea.' };
    if (closed) {
      if (Ts.length < 2) return { error: 'Una polilínea cerrada necesita dos cortes para recortarse.' };
      let lo = Ts.filter((T) => T < Tc).pop(), hi = Ts.find((T) => T > Tc);
      if (lo === undefined) lo = Ts[Ts.length - 1] - n;
      if (hi === undefined) hi = Ts[0] + n;
      return { mods: [{ rec, pairs: lwPairs(rec, subVerts(segs, hi, lo + n), false) }] };
    }
    const lo = Ts.filter((T) => T < Tc).pop(), hi = Ts.find((T) => T > Tc);
    const pieces = [];
    if (lo !== undefined) pieces.push([0, lo]);
    if (hi !== undefined) pieces.push([hi, n]);
    const res = { mods: [{ rec, pairs: lwPairs(rec, subVerts(segs, pieces[0][0], pieces[0][1]), false) }], adds: [] };
    if (pieces[1]) res.adds.push({ type: 'LWPOLYLINE', like: rec, pairs: lwPairs(rec, subVerts(segs, pieces[1][0], pieces[1][1]), false) });
    return res;
  }
  function extendLw(rec, px, py, E) {
    const { segs, closed, verts } = lwSegs(rec); const n = segs.length;
    if (closed) return { error: 'Una polilínea cerrada no se puede alargar.' };
    if (!n) return { error: 'Polilínea vacía.' };
    const atEnd = Math.hypot(px - segs[n - 1].b[0], py - segs[n - 1].b[1]) < Math.hypot(px - segs[0].a[0], py - segs[0].a[1]);
    const sg = atEnd ? segs[n - 1] : segs[0];
    const A = segArc(sg);
    const V = verts.map((v) => v.slice());
    if (!A) {
      const ts = E.flatMap((e) => lineHits(sg.a, sg.b, e)).map((h) => h.t);
      const t = atEnd ? Math.min(Infinity, ...ts.filter((x) => x > 1 + 1e-9)) : Math.max(-Infinity, ...ts.filter((x) => x < -1e-9));
      if (!isFinite(t)) return { error: 'No hay ningún objeto en esa dirección para alargar la polilínea.' };
      const P = [sg.a[0] + t * (sg.b[0] - sg.a[0]), sg.a[1] + t * (sg.b[1] - sg.a[1])];
      if (atEnd) { V[n][0] = P[0]; V[n][1] = P[1]; } else { V[0][0] = P[0]; V[0][1] = P[1]; }
    } else {
      const angs = E.flatMap((q) => circleHits(A.c, A.r, q));
      const dir = Math.sign(A.th), span = Math.abs(A.th);
      // ángulo extra más pequeño más allá del extremo, en el sentido del arco
      const endAng = atEnd ? A.as + A.th : A.as;
      const ds = angs.map((g) => (atEnd ? n2(dir * (g - endAng)) : n2(dir * (endAng - g)))).filter((d) => d > 1e-9 && d < TAU - span - 1e-9);
      if (!ds.length) return { error: 'No hay ningún objeto en esa dirección para alargar la polilínea.' };
      const ex = Math.min(...ds), th = dir * (span + ex);
      if (atEnd) { const g = A.as + th; V[n][0] = A.c[0] + A.r * Math.cos(g); V[n][1] = A.c[1] + A.r * Math.sin(g); V[n - 1][2] = Math.tan(th / 4); }
      else { const g = A.as - dir * ex; V[0][0] = A.c[0] + A.r * Math.cos(g); V[0][1] = A.c[1] + A.r * Math.sin(g); V[0][2] = Math.tan(th / 4); }
    }
    return { mods: [{ rec, pairs: lwPairs(rec, V, false) }] };
  }
  /** Intersecciones de dos elementos desfasados (recta infinita o circunferencia completa). */
  function elemHits(e1, e2) {
    const big = (e) => { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1]; return { k: 'seg', a: [e.a[0] - dx * 1e6, e.a[1] - dy * 1e6], b: [e.b[0] + dx * 1e6, e.b[1] + dy * 1e6] }; };
    const circ = (e) => ({ k: 'arc', c: e.c, r: e.r, a0: 0, a1: TAU, full: true });
    if (!e1.c && !e2.c) return lineHits(e1.a, e1.b, big(e2)).map((h) => [h.x, h.y]);
    if (!e1.c) return lineHits(e1.a, e1.b, circ(e2)).map((h) => [h.x, h.y]);
    if (!e2.c) return lineHits(e2.a, e2.b, circ(e1)).map((h) => [h.x, h.y]);
    return circleHits(e1.c, e1.r, circ(e2)).map((g) => [e1.c[0] + e1.r * Math.cos(g), e1.c[1] + e1.r * Math.sin(g)]);
  }
  function offsetLw(rec, d, sx, sy) {
    const { segs, closed } = lwSegs(rec); const n = segs.length;
    if (!n) return { error: 'Polilínea vacía.' };
    const k0 = Math.floor(Math.min(n - 1e-9, segNearest(segs, sx, sy)));
    const s0 = segs[k0], A0 = segArc(s0);
    let side;
    if (!A0) side = Math.sign((s0.b[0] - s0.a[0]) * (sy - s0.a[1]) - (s0.b[1] - s0.a[1]) * (sx - s0.a[0])) || 1;
    else { const inside = Math.hypot(sx - A0.c[0], sy - A0.c[1]) < A0.r; side = (A0.th > 0) === inside ? 1 : -1; }
    const el = segs.map((sg) => {
      const A = segArc(sg);
      if (!A) { const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) || 1; const nx = -(sg.b[1] - sg.a[1]) / L * d * side, ny = (sg.b[0] - sg.a[0]) / L * d * side;
        return { a: [sg.a[0] + nx, sg.a[1] + ny], b: [sg.b[0] + nx, sg.b[1] + ny] }; }
      const r = A.r - d * side * Math.sign(A.th);
      if (r <= 1e-9) return { error: true };
      const k = r / A.r;
      return { c: A.c, r, th: A.th, a: [A.c[0] + (sg.a[0] - A.c[0]) * k, A.c[1] + (sg.a[1] - A.c[1]) * k], b: [A.c[0] + (sg.b[0] - A.c[0]) * k, A.c[1] + (sg.b[1] - A.c[1]) * k] };
    });
    if (el.some((e) => e.error)) return { error: 'El desfase es mayor que el radio de un arco de la polilínea.' };
    const tol = Math.max(1e-9, d * 1e-7);
    const joint = (e1, e2) => {
      if (Math.hypot(e1.b[0] - e2.a[0], e1.b[1] - e2.a[1]) < tol) return { p: e1.b };
      const ref = [(e1.b[0] + e2.a[0]) / 2, (e1.b[1] + e2.a[1]) / 2];
      const c = elemHits(e1, e2).sort((p, q) => Math.hypot(p[0] - ref[0], p[1] - ref[1]) - Math.hypot(q[0] - ref[0], q[1] - ref[1]))[0];
      if (c && Math.hypot(c[0] - ref[0], c[1] - ref[1]) < 4 * d + Math.hypot(e1.b[0] - e2.a[0], e1.b[1] - e2.a[1])) return { p: c };
      return { gap: true };
    };
    const J = []; // J[k] = unión entre el elemento k y el k+1
    for (let k = 0; k < (closed ? n : n - 1); k++) J.push(joint(el[k], el[(k + 1) % n]));
    const V = [];
    for (let k = 0; k < n; k++) {
      const e = el[k];
      const jin = k > 0 ? J[k - 1] : closed ? J[n - 1] : null;
      const jout = k < n - 1 || closed ? J[k] : null;
      const S = jin && jin.p ? jin.p : e.a, E2 = jout && jout.p ? jout.p : e.b;
      let b = 0;
      if (e.c) { const g0 = Math.atan2(S[1] - e.c[1], S[0] - e.c[0]), g1 = Math.atan2(E2[1] - e.c[1], E2[0] - e.c[0]);
        let th = e.th > 0 ? n2(g1 - g0) : -n2(g0 - g1); if (Math.abs(th) < 1e-12 && Math.abs(e.th) > Math.PI) th = Math.sign(e.th) * TAU; b = Math.tan(th / 4); }
      V.push([S[0], S[1], b]);
      if (jout && jout.gap) V.push([e.b[0], e.b[1], 0]);
      if (!closed && k === n - 1) V.push([E2[0], E2[1], 0]);
    }
    return { type: 'LWPOLYLINE', pairs: lwPairs(rec, V, closed) };
  }

  // ---------------------------------------------------------------- ESTIRA
  /** Mueve los puntos de `rec` que caen dentro de la ventana. Devuelve pares nuevos, 'all' (moverla entera) o null. */
  function stretchPairs(rec, inside, dx, dy) {
    const t = rec.type, m = mir(rec);
    if (t === 'LINE') {
      const ia = inside(rec.num(10), rec.num(20)), ib = inside(rec.num(11), rec.num(21));
      if (ia && ib) return 'all';
      if (!ia && !ib) return null;
      const map = ia ? { 10: rec.num(10) + dx, 20: rec.num(20) + dy } : { 11: rec.num(11) + dx, 21: rec.num(21) + dy };
      return setPairs(rec.p, map);
    }
    if (t === 'LWPOLYLINE') {
      let any = false, all = true; let cx = null;
      const ddx = m ? -dx : dx;
      const pairs = rec.p.map(([c, v]) => [c, v]);
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] !== 10) continue;
        const j = pairs.findIndex((q, k) => k > i && q[0] === 20); if (j < 0) continue;
        const x = parseFloat(pairs[i][1]), y = parseFloat(pairs[j][1]);
        if (inside(m ? -x : x, y)) { any = true; pairs[i][1] = F(x + ddx); pairs[j][1] = F(y + dy); } else all = false;
      }
      cx = all ? 'all' : any ? pairs : null;
      return cx;
    }
    // el resto se mueve entero si su punto de inserción/centro queda dentro
    const x = rec.num(10), y = rec.num(20);
    return inside(m && ['CIRCLE', 'ARC', 'TEXT', 'INSERT'].includes(t) ? -x : x, y) ? 'all' : null;
  }

  /** Arco por tres puntos: {c, r, a0, a1} (antihorario de a0 a a1) o null si están alineados. */
  function arco3(p1, p2, p3) {
    const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)); if (Math.abs(d) < 1e-12 * Math.max(1, Math.hypot(bx - ax, by - ay) ** 2)) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const g = (p) => Math.atan2(p[1] - uy, p[0] - ux) * 180 / Math.PI;
    const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0; // giro p1→p2→p3 antihorario
    return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy), a0: ccw ? g(p1) : g(p3), a1: ccw ? g(p3) : g(p1) };
  }
  return { arco3, edges, trim, extend, offset, stretchPairs, lineHits, circleHits, lwSegs, segArc, segPt, segEdge, subVerts, lwPairs, bulgeEdge, n2, segNearest, lwVerts };
})();
if (typeof module !== 'undefined') module.exports = Geom; else self.Geom = Geom;
