// Domoplano — H6-B: edición e inspección P2 para iluminación y edificios (código propio, comportamiento según la ayuda
// pública de AutoCAD). Consultas (LIST, ID, AREA), selección (SELECSIMILAR, SELECRAPIDA), pinzamientos, UNIR, PARTIR,
// EDITPOL, SUPRIMEDUPL, COBERTURA (WIPEOUT), TEXTOM (MTEXT), copiar y pegar entre planos, CANTIDADES y calco de mapa OSM.
// Todo trabaja sobre los registros del DXF (sin pérdidas) y cada orden es UN paso de deshacer.
const P2 = (() => {
  const S = Edit.Session.prototype;
  const TAU = Math.PI * 2, EPS = 1e-9;
  const F = (v) => Edit.fmt(v);
  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
  const n2 = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
  const mir = (r) => r.num(230, 1) < 0;
  const hnd = (r) => String(r.get(5, '') || '').trim();
  const f4 = (v) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
  const near = (a, b, t) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= t;

  /** Pares con los códigos `map` cambiados (primera aparición); los que no estén se agregan antes de XDATA. */
  function setPairs(p, map) {
    const out = p.map((q) => q.slice()); const done = new Set();
    for (const q of out) if (map[q[0]] !== undefined && !done.has(q[0])) { q[1] = typeof map[q[0]] === 'number' ? F(map[q[0]]) : String(map[q[0]]); done.add(q[0]); }
    let at = out.findIndex((q) => q[0] >= 1000); if (at < 0) at = out.length;
    for (const k of Object.keys(map)) if (!done.has(+k)) out.splice(at++, 0, [+k, typeof map[k] === 'number' ? F(map[k]) : String(map[k])]);
    return out;
  }
  /** Una sola operación de deshacer para todo lo que haga fn (que puede llamar varias operaciones de la sesión). */
  S.agrupar = function (label, fn) {
    const n0 = this.undoStack.length; let res;
    try { res = fn(this); } catch (e) { while (this.undoStack.length > n0) this.undo(); this.redoStack.length = 0; throw e; }
    if (res && res.error) { while (this.undoStack.length > n0) this.undo(); this.redoStack.length = 0; return res; }
    const ops = this.undoStack.splice(n0);
    if (ops.length > 1) this.undoStack.push({ label, full: ops.some((o) => o.full), keepModel: ops.every((o) => o.keepModel), layouts: ops.some((o) => o.layouts),
      apply: () => ops.forEach((o) => o.apply()), revert: () => ops.slice().reverse().forEach((o) => o.revert()) });
    else if (ops.length === 1) this.undoStack.push(ops[0]);
    this.redoStack.length = 0;
    return res;
  };

  // ================================================================ geometría común
  /** Vértices WCS [x, y, comba] de una LWPOLYLINE. */
  const lwV = (r) => Geom.lwVerts(r).map(([x, y, b]) => (mir(r) ? [-x, y, -b] : [x, y, b]));
  function segLen(a, b, bu) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (Math.abs(bu) < 1e-12 || d < EPS) return d;
    const th = 4 * Math.atan(Math.abs(bu)); return d / (2 * Math.sin(th / 2)) * th;
  }
  /** Área con signo y perímetro de un contorno de vértices con comba (cerrado). */
  function areaVerts(vs, closed = true) {
    let A = 0, P = 0; const n = vs.length;
    const m = closed ? n : n - 1;
    for (let k = 0; k < m; k++) {
      const a = vs[k], b = vs[(k + 1) % n];
      A += a[0] * b[1] - b[0] * a[1];
      P += segLen(a, b, a[2] || 0);
      const bu = a[2] || 0;
      if (Math.abs(bu) > 1e-12) { const th = 4 * Math.atan(bu); const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > EPS) { const r = d / (2 * Math.sin(Math.abs(th) / 2)); A += r * r * (th - Math.sin(th)); } }
    }
    if (!closed && n > 1) { const a = vs[n - 1], b = vs[0]; A += a[0] * b[1] - b[0] * a[1]; } // AREA de un objeto abierto: se cierra con una recta
    return { signed: A / 2, area: Math.abs(A / 2), perim: P };
  }
  /** Contornos de un sombreado (HATCH) como vértices con comba. */
  function lazosHatch(r) {
    const P = r.p; let i = P.findIndex((q) => q[0] === 91); if (i < 0) return [];
    const nL = parseInt(P[i][1], 10) || 0; i++;
    const num = (k) => parseFloat(P[k][1]);
    const rd = (code) => { while (i < P.length && P[i][0] !== code) i++; const v = i < P.length ? num(i) : 0; i++; return v; };
    const lazos = [];
    for (let L = 0; L < nL && i < P.length; L++) {
      while (i < P.length && P[i][0] !== 92) i++; if (i >= P.length) break;
      const flags = parseInt(P[i][1], 10) || 0; i++;
      const vs = [];
      if (flags & 2) {
        while (i < P.length && P[i][0] !== 93) i++;
        const n = parseInt(P[i][1], 10) || 0; i++;
        while (vs.length < n && i < P.length) {
          if (P[i][0] === 10) { const v = [num(i), num(i + 1), 0]; i += 2; if (P[i] && P[i][0] === 42) { v[2] = num(i); i++; } vs.push(v); } else i++;
        }
      } else {
        while (i < P.length && P[i][0] !== 93) i++;
        const ne = parseInt(P[i][1], 10) || 0; i++;
        for (let k = 0; k < ne && i < P.length; k++) {
          while (i < P.length && P[i][0] !== 72) i++;
          const et = parseInt(P[i][1], 10); i++;
          if (et === 1) { const x0 = rd(10), y0 = rd(20); rd(11); rd(21); vs.push([x0, y0, 0]); }
          else if (et === 2) {
            const cx = rd(10), cy = rd(20), R = rd(40), a0 = rd(50) * Math.PI / 180, a1 = rd(51) * Math.PI / 180;
            const ccw = P[i] && P[i][0] === 73 ? parseInt(P[i][1], 10) : 1; if (P[i] && P[i][0] === 73) i++;
            const sw = n2(a1 - a0) || TAU; const s0 = ccw ? a0 : -a0;
            vs.push([cx + R * Math.cos(s0), cy + R * Math.sin(s0), (ccw ? 1 : -1) * Math.tan(sw / 4)]);
          } else if (et === 3) {
            const cx = rd(10), cy = rd(20), mx = rd(11), my = rd(21), ratio = rd(40), a0 = rd(50) * Math.PI / 180, a1 = rd(51) * Math.PI / 180;
            const ccw = P[i] && P[i][0] === 73 ? parseInt(P[i][1], 10) : 1; if (P[i] && P[i][0] === 73) i++;
            const R = Math.hypot(mx, my), rot = Math.atan2(my, mx), sw = n2(a1 - a0) || TAU;
            for (let s = 0; s < 24; s++) { const t = (ccw ? a0 : -a0) + (ccw ? 1 : -1) * sw * s / 24; const ex = R * Math.cos(t), ey = R * ratio * Math.sin(t); vs.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot), 0]); }
          } else if (et === 4) {
            while (i < P.length && P[i][0] !== 96) i++; const nc = parseInt(P[i] ? P[i][1] : '0', 10); i++;
            let c = 0; while (i < P.length && c < nc) { if (P[i][0] === 10) { vs.push([num(i), num(i + 1), 0]); i += 2; c++; } else i++; }
          }
        }
      }
      if (vs.length >= 2) lazos.push(vs);
    }
    return lazos;
  }
  const dentro = (pt, vs) => { let c = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { const a = vs[i], b = vs[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

  /** Longitud de un objeto (líneas, arcos, círculos, polilíneas, elipses). null si no aplica. */
  function longitud(r) {
    switch (r.type) {
      case 'LINE': return Math.hypot(r.num(11) - r.num(10), r.num(21) - r.num(20));
      case 'ARC': return r.num(40) * (n2((r.num(51) - r.num(50)) * Math.PI / 180) || TAU);
      case 'CIRCLE': return TAU * r.num(40);
      case 'LWPOLYLINE': { const v = lwV(r); return areaVerts(v, (r.int(70) & 1) === 1).perim; }
      case 'ELLIPSE': {
        const a = Math.hypot(r.num(11), r.num(21)), b = a * r.num(40, 1); const h = ((a - b) / (a + b)) ** 2;
        const full = Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
        return full * ((n2(r.num(42, TAU) - r.num(41, 0)) || TAU) / TAU);
      }
      default: return null;
    }
  }
  /** Área y perímetro de un objeto (como AREA › Objeto). */
  function medir(r) {
    switch (r.type) {
      case 'CIRCLE': { const R = r.num(40); return { area: Math.PI * R * R, perim: TAU * R, cerrado: true }; }
      case 'ELLIPSE': { const a = Math.hypot(r.num(11), r.num(21)), b = a * r.num(40, 1); return { area: Math.PI * a * b, perim: longitud(r), cerrado: true }; }
      case 'LWPOLYLINE': { const c = (r.int(70) & 1) === 1; const m = areaVerts(lwV(r), c); return { area: m.area, perim: m.perim, cerrado: c }; }
      case 'ARC': {
        const R = r.num(40), a0 = r.num(50) * Math.PI / 180, sw = n2(r.num(51) * Math.PI / 180 - a0) || TAU;
        return { area: R * R / 2 * (sw - Math.sin(sw)), perim: R * sw, cerrado: false };
      }
      case 'HATCH': {
        const L = lazosHatch(r); if (!L.length) return { error: 'No pude leer el contorno del sombreado.' };
        let A = 0, P = 0;
        for (const vs of L) {
          const m = areaVerts(vs, true); P += m.perim;
          const depth = L.filter((o) => o !== vs && dentro(vs[0], o)).length;
          A += (depth % 2 ? -1 : 1) * m.area;
        }
        return { area: Math.abs(A), perim: P, cerrado: true };
      }
      case 'LINE': return { area: 0, perim: longitud(r), cerrado: false };
      default: return { error: `AREA no mide ${r.type} (sí círculos, polilíneas, sombreados, elipses y arcos).` };
    }
  }
  /** Área y perímetro de un polígono de puntos (AREA por puntos; se cierra solo). */
  function areaPuntos(pts) { const m = areaVerts(pts.map((p) => [p[0], p[1], 0]), true); return { area: m.area, perim: m.perim }; }
  /** Texto de unidades de área: «12,5000 m²» o, si el dibujo va en mm, también en m². */
  function txtArea(a, u) {
    if (u === 'mm') return `${f4(a)} mm² (${f4(a / 1e6)} m²)`;
    if (u === 'cm') return `${f4(a)} cm² (${f4(a / 1e4)} m²)`;
    return `${f4(a)}${u ? ' ' + u + '²' : ''}`;
  }

  // ================================================================ LIST (LISTA)
  const NOMBRE_TIPO = { LINE: 'LÍNEA', LWPOLYLINE: 'POLILÍNEA', POLYLINE: 'POLILÍNEA 2D', CIRCLE: 'CÍRCULO', ARC: 'ARCO', TEXT: 'TEXTO', MTEXT: 'TEXTO DE PÁRRAFO (MTEXT)',
    INSERT: 'REFERENCIA A BLOQUE', HATCH: 'SOMBREADO', DIMENSION: 'COTA', LEADER: 'DIRECTRIZ', MULTILEADER: 'DIRECTRIZ MÚLTIPLE', IMAGE: 'IMAGEN', WIPEOUT: 'COBERTURA',
    VIEWPORT: 'VENTANA', ELLIPSE: 'ELIPSE', SPLINE: 'SPLINE', POINT: 'PUNTO', SOLID: 'SÓLIDO 2D', ATTDEF: 'DEFINICIÓN DE ATRIBUTO' };
  /** Renglones con los datos de un objeto (como LIST de AutoCAD). o = {unidades, S}. */
  function info(r, o = {}) {
    const u = o.unidades || '', Ses = o.S;
    const pt = (c) => `X=${f4(r.num(c))}  Y=${f4(r.num(c + 10))}  Z=${f4(r.num(c + 20))}`;
    const pp = Documento.propsDe(r);
    const L = [`${NOMBRE_TIPO[r.type] || r.type} (${r.type})   Capa: «${pp.layer}»   Espacio: ${r.int(67, 0) === 1 ? 'Papel' : 'Modelo'}${r.inBlock ? ' (dentro de un bloque)' : ''}`,
      `   Handle = ${hnd(r) || '—'}   Color: ${pp.color === 'RGB' ? 'RGB ' + r.get(420) : Documento.nombreColor(pp.color)}   Tipo de línea: ${pp.ltype}   Grosor: ${Documento.nombreGrosor(pp.lw)}${pp.ltscale !== 1 ? `   Escala TL: ${pp.ltscale}` : ''}`];
    const add = (s) => L.push('   ' + s);
    switch (r.type) {
      case 'LINE': {
        const dx = r.num(11) - r.num(10), dy = r.num(21) - r.num(20);
        add(`desde el punto ${pt(10)}`); add(`hasta el punto ${pt(11)}`);
        add(`Longitud = ${f4(Math.hypot(dx, dy))}${u ? ' ' + u : ''},  Ángulo en el plano XY = ${f4(Edit.norm360(Math.atan2(dy, dx) * 180 / Math.PI))}°`);
        add(`Incremento X = ${f4(dx)},  Incremento Y = ${f4(dy)}`); break;
      }
      case 'CIRCLE': add(`centro ${pt(10)}`); add(`radio ${f4(r.num(40))}`); add(`circunferencia ${f4(TAU * r.num(40))}`); add(`área ${txtArea(Math.PI * r.num(40) ** 2, u)}`); break;
      case 'ARC': { const m = medir(r); add(`centro ${pt(10)}`); add(`radio ${f4(r.num(40))}`); add(`ángulo inicial ${f4(r.num(50))}°   ángulo final ${f4(r.num(51))}°`); add(`longitud ${f4(m.perim)}   área (segmento) ${txtArea(m.area, u)}`); break; }
      case 'ELLIPSE': add(`centro ${pt(10)}`); add(`eje mayor ${f4(2 * Math.hypot(r.num(11), r.num(21)))}   relación ${f4(r.num(40, 1))}`); add(`longitud ${f4(longitud(r))}`); break;
      case 'LWPOLYLINE': {
        const c = (r.int(70) & 1) === 1, v = lwV(r), m = areaVerts(v, c);
        add(`${c ? 'Cerrada' : 'Abierta'}   Grosor constante ${f4(r.num(43, 0))}   ${v.length} vértices`);
        add(`área ${txtArea(m.area, u)}${c ? '' : ' (cerrándola con una recta)'}`); add(`${c ? 'perímetro' : 'longitud'} ${f4(m.perim)}`);
        v.slice(0, 60).forEach((q, k) => add(`vértice ${k + 1}: X=${f4(q[0])}  Y=${f4(q[1])}${Math.abs(q[2]) > 1e-12 ? `  comba ${f4(q[2])}` : ''}`));
        if (v.length > 60) add(`… y ${v.length - 60} vértices más`); break;
      }
      case 'TEXT': case 'ATTRIB': case 'ATTDEF': {
        add(`Estilo = «${(r.get(7, 'Standard') || '').trim()}»   altura ${f4(r.num(40))}   rotación ${f4(r.num(50))}°   factor de ancho ${f4(r.num(41, 1))}`);
        add(`punto inicial ${pt(10)}`); if (r.get(11) !== undefined) add(`punto de justificación ${pt(11)}`);
        if (r.type !== 'TEXT') add(`etiqueta «${(r.get(2, '') || '').trim()}»`);
        add(`texto «${Documento.textoDe(r)}»`); break;
      }
      case 'MTEXT': add(`Estilo = «${(r.get(7, 'Standard') || '').trim()}»   altura ${f4(r.num(40))}   ancho de columna ${f4(r.num(41))}   punto de enganche ${r.int(71, 1)}`); add(`punto de inserción ${pt(10)}`); add(`texto «${Documento.textoDe(r).replace(/\\P/g, '¶')}»`); break;
      case 'INSERT': {
        add(`Bloque «${(r.get(2, '') || '').trim()}»   punto de inserción ${pt(10)}`);
        add(`escala X ${f4(r.num(41, 1))}   escala Y ${f4(r.num(42, 1))}   rotación ${f4(r.num(50))}°`);
        if (Ses) for (const a of Ses.withSeq(r).filter((q) => q.type === 'ATTRIB' && !q.deleted)) add(`atributo ${(a.get(2, '') || '').trim()} = «${Documento.textoDe(a)}»`);
        break;
      }
      case 'HATCH': { const m = medir(r); add(`Patrón «${(r.get(2, '') || '').trim()}»   ${r.int(70) ? 'sólido' : `escala ${f4(r.num(41, 1))}   ángulo ${f4(r.num(52, 0))}°`}   ${r.int(71) ? 'asociativo' : 'no asociativo'}`); if (!m.error) add(`área ${txtArea(m.area, u)}   perímetro ${f4(m.perim)}`); break; }
      case 'DIMENSION': add(`Estilo de cota «${(r.get(3, '') || '').trim()}»   medida ${f4(r.num(42))}${r.get(1) ? `   texto «${r.get(1)}»` : ''}`); add(`punto de la línea de cota ${pt(10)}`); add(`posición del texto ${pt(11)}`); break;
      case 'IMAGE': case 'WIPEOUT': { const w = Math.hypot(r.num(11), r.num(21)) * r.num(13, 1), h = Math.hypot(r.num(12), r.num(22)) * r.num(23, 1); add(`punto de inserción ${pt(10)}`); add(`ancho ${f4(w)}   alto ${f4(h)}`); break; }
      case 'VIEWPORT': add(`centro ${pt(10)}   ancho ${f4(r.num(40))}   alto ${f4(r.num(41))}`); add(`altura de la vista en el modelo ${f4(r.num(45))}`); break;
      case 'LEADER': { const v = []; let c = null; for (const [k, x] of r.p) { if (k === 10) { c = [parseFloat(x), 0]; v.push(c); } else if (k === 20 && c) c[1] = parseFloat(x); } v.forEach((q, k) => add(`vértice ${k + 1}: X=${f4(q[0])}  Y=${f4(q[1])}`)); break; }
      default: if (r.get(10) !== undefined) add(`punto ${pt(10)}`);
    }
    return L;
  }

  // ================================================================ SELECSIMILAR y SELECRAPIDA
  const TIPOS_ES = { LINEA: 'LINE', LÍNEA: 'LINE', POLILINEA: 'LWPOLYLINE', POLILÍNEA: 'LWPOLYLINE', PL: 'LWPOLYLINE', CIRCULO: 'CIRCLE', CÍRCULO: 'CIRCLE', ARCO: 'ARC',
    TEXTO: 'TEXT', TEXTOM: 'MTEXT', PARRAFO: 'MTEXT', BLOQUE: 'INSERT', INSERCION: 'INSERT', SOMBREADO: 'HATCH', SOMBREA: 'HATCH', COTA: 'DIMENSION', DIRECTRIZ: 'LEADER',
    IMAGEN: 'IMAGE', COBERTURA: 'WIPEOUT', ELIPSE: 'ELLIPSE', PUNTO: 'POINT', VENTANA: 'VIEWPORT', DIRECTRIZM: 'MULTILEADER', MLEADER: 'MULTILEADER' };
  const tipoDXF = (t) => { const k = up(t); return TIPOS_ES[k] || k; };
  const nombreBloque = (r) => (r.type === 'INSERT' ? up(r.get(2, '')) : '');
  /** Objetos parecidos al base: mismo tipo y capa (y mismo bloque si es una inserción), como SELECSIMILAR. */
  function similares(bases, cands) {
    const firmas = new Set(bases.map((b) => `${b.type}|${up(b.get(8, '0'))}|${nombreBloque(b)}`));
    return cands.filter((r) => firmas.has(`${r.type}|${up(r.get(8, '0'))}|${nombreBloque(r)}`));
  }
  const comodin = (pat) => new RegExp('^' + up(pat).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const PROP_QS = { T: 'tipo', TIPO: 'tipo', TYPE: 'tipo', OBJETO: 'tipo', C: 'capa', CA: 'capa', CAPA: 'capa', LAYER: 'capa', CO: 'color', COLOR: 'color', B: 'bloque', BLOQUE: 'bloque', NOMBRE: 'bloque', BLOCK: 'bloque',
    TL: 'tipolin', TIPOLIN: 'tipolin', LINETYPE: 'tipolin', E: 'estilo', ESTILO: 'estilo', TX: 'texto', TEXTO: 'texto' };
  /** SELECRAPIDA: filtra por propiedad. prop = tipo|capa|color|bloque|tipolin|estilo|texto; valor admite * y ?; «<>valor» = distinto. */
  function filtrar(cands, prop, valor) {
    prop = PROP_QS[up(prop)] || String(prop).toLowerCase();
    let v = String(valor == null ? '' : valor).trim(); let neg = false;
    if (v.startsWith('<>') || v.startsWith('!=')) { neg = true; v = v.slice(2).trim(); } else if (v.startsWith('=')) v = v.slice(1).trim();
    let test;
    if (prop === 'tipo') { const tipos = v.split(/[;,]/).map(tipoDXF); test = (r) => tipos.some((t) => comodin(t).test(r.type) || (t === 'LWPOLYLINE' && r.type === 'POLYLINE')); }
    else if (prop === 'capa') { const re = comodin(v); test = (r) => re.test(up(r.get(8, '0'))); }
    else if (prop === 'color') { const c = Documento.parseColor(v); if (c === null) return { error: `Color no válido: «${v}».` }; test = (r) => { const pc = Documento.propsDe(r).color; return pc === c; }; }
    else if (prop === 'bloque') { const re = comodin(v); test = (r) => r.type === 'INSERT' && re.test(nombreBloque(r)); }
    else if (prop === 'tipolin') { const re = comodin(v); test = (r) => re.test(up(r.get(6, 'BYLAYER'))); }
    else if (prop === 'estilo') { const re = comodin(v); test = (r) => ['TEXT', 'MTEXT', 'ATTDEF'].includes(r.type) && re.test(up(r.get(7, 'STANDARD'))); }
    else if (prop === 'texto') { const re = new RegExp(comodin(v).source.slice(1, -1), 'i'); test = (r) => ['TEXT', 'MTEXT'].includes(r.type) && re.test(up(Documento.textoDe(r))); }
    else return { error: `Propiedad desconocida «${prop}». Use Tipo, Capa, Color, Bloque, TipoLin, Estilo o Texto.` };
    return { recs: cands.filter((r) => (neg ? !test(r) : test(r))), prop, valor: v, neg };
  }
  /** Valores que hay en el dibujo para una propiedad (la lista de «?»). */
  function valores(cands, prop) {
    prop = PROP_QS[up(prop)] || String(prop).toLowerCase();
    const cnt = new Map(); const k = (x) => cnt.set(x, (cnt.get(x) || 0) + 1);
    for (const r of cands) {
      if (prop === 'tipo') k(r.type); else if (prop === 'capa') k((r.get(8, '0') || '0').trim()); else if (prop === 'bloque') { if (r.type === 'INSERT') k((r.get(2, '') || '').trim()); }
      else if (prop === 'color') k(Documento.nombreColor(Documento.propsDe(r).color)); else if (prop === 'tipolin') k((r.get(6, 'ByLayer') || '').trim()); else if (prop === 'estilo') { if (r.get(7) !== undefined) k(r.get(7).trim()); }
    }
    return [...cnt].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`);
  }

  // ================================================================ PINZAMIENTOS (grips)
  /** Puntos de pinzamiento de un objeto: [{x, y, k, i}]. k: v = vértice, m = punto medio, c = centro, q = cuadrante, mv = mover,
   *  a0/a1/am = extremos y medio de arco, d = punto de cota (i = código), lv = vértice de directriz. bb = caja (para sombreados). */
  function grips(r, Ses, bb) {
    const G = []; const g = (x, y, k, i) => G.push({ x, y, k, i });
    const t = r.type;
    if (mir(r) && !['LINE', 'TEXT', 'MTEXT', 'INSERT', 'POINT', 'IMAGE', 'WIPEOUT', 'HATCH'].includes(t)) return G;
    if (t === 'LINE') { const a = [r.num(10), r.num(20)], b = [r.num(11), r.num(21)]; g(a[0], a[1], 'v', 0); g(b[0], b[1], 'v', 1); g((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'm', 0); }
    else if (t === 'LWPOLYLINE') {
      const v = lwV(r), c = (r.int(70) & 1) === 1;
      v.forEach((q, k) => g(q[0], q[1], 'v', k));
      const n = c ? v.length : v.length - 1;
      for (let k = 0; k < n; k++) { const a = v[k], b = v[(k + 1) % v.length]; const q = Geom.segPt({ a, b, bulge: a[2] }, 0.5); g(q[0], q[1], 'm', k); }
    } else if (t === 'CIRCLE') { const x = r.num(10), y = r.num(20), R = r.num(40); g(x, y, 'c'); g(x + R, y, 'q'); g(x, y + R, 'q'); g(x - R, y, 'q'); g(x, y - R, 'q'); }
    else if (t === 'ARC') {
      const x = r.num(10), y = r.num(20), R = r.num(40), a0 = r.num(50) * Math.PI / 180, sw = n2(r.num(51) * Math.PI / 180 - a0) || TAU;
      g(x, y, 'c'); g(x + R * Math.cos(a0), y + R * Math.sin(a0), 'a0'); g(x + R * Math.cos(a0 + sw), y + R * Math.sin(a0 + sw), 'a1'); g(x + R * Math.cos(a0 + sw / 2), y + R * Math.sin(a0 + sw / 2), 'am');
    } else if (t === 'TEXT' || t === 'ATTDEF') { const j = r.int(72, 0) || r.int(73, 0); const c = j && r.get(11) !== undefined ? 11 : 10; g(r.num(c) * (mir(r) ? -1 : 1), r.num(c + 10), 'mv'); }
    else if (['MTEXT', 'INSERT', 'POINT', 'IMAGE', 'WIPEOUT', 'ELLIPSE'].includes(t)) g(r.num(10) * (mir(r) && t === 'INSERT' ? -1 : 1), r.num(20), 'mv');
    else if (t === 'HATCH' && bb) g((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, 'mv');
    else if (t === 'DIMENSION' && Ses && Ses.cotaPuntos) for (const d of Ses.cotaPuntos(r)) g(d.p[0], d.p[1], 'd', d.k);
    else if (t === 'LEADER') { let k = 0, c = null; for (const [cd, x] of r.p) { if (cd === 10) c = [parseFloat(x)]; else if (cd === 20 && c) { g(c[0], parseFloat(x), 'lv', k++); c = null; } } }
    return G;
  }
  /** Reemplaza el i-ésimo par de vértice (10/20) de una polilínea o directriz. */
  function setVert(p, i, x, y, xs = 1) {
    const out = p.map((q) => q.slice()); let k = -1;
    for (let j = 0; j < out.length; j++) if (out[j][0] === 10 && ++k === i) { out[j][1] = F(x * xs); const y2 = out.findIndex((q, m) => m > j && q[0] === 20); if (y2 >= 0) out[y2][1] = F(y); break; }
    return out;
  }
  /** Mueve un pinzamiento del objeto al punto p (WCS). Un solo paso de deshacer. */
  S.moverPinzamiento = function (r, G, p) {
    const d = [p[0] - G.x, p[1] - G.y];
    if (Math.hypot(d[0], d[1]) < 1e-12) return { ok: true, sinCambio: true };
    const t = r.type;
    const mod = (pairs, label = 'Pinzamiento') => { this.commit(label, { mods: [{ rec: r, pairs }] }); return { ok: true }; };
    if (G.k === 'mv' || G.k === 'c' && t === 'CIRCLE' || G.k === 'c' && t === 'ARC') { const res = this.move([r], d[0], d[1]); return res.moved ? { ok: true } : { error: `No se puede mover ${t} todavía.` }; }
    if (t === 'LINE') {
      if (G.k === 'm') return mod(setPairs(r.p, { 10: r.num(10) + d[0], 20: r.num(20) + d[1], 11: r.num(11) + d[0], 21: r.num(21) + d[1] }));
      return mod(setPairs(r.p, G.i === 0 ? { 10: p[0], 20: p[1] } : { 11: p[0], 21: p[1] }));
    }
    if (t === 'LWPOLYLINE') {
      const v = lwV(r), xs = mir(r) ? -1 : 1;
      if (G.k === 'v') return mod(setVert(r.p, G.i, p[0], p[1], xs));
      const a = v[G.i], j = (G.i + 1) % v.length, b = v[j];
      if (Math.abs(a[2]) > 1e-12) { // tramo con arco: el arco pasa por el punto nuevo
        const A = Geom.arco3(a, p, b); if (!A) { v[G.i][2] = 0; return mod(Geom.lwPairs(r, v, (r.int(70) & 1) === 1)); }
        const sa = Math.atan2(a[1] - A.c[1], a[0] - A.c[0]), sm = Math.atan2(p[1] - A.c[1], p[0] - A.c[0]), sb = Math.atan2(b[1] - A.c[1], b[0] - A.c[0]);
        const ccw = n2(sm - sa) < n2(sb - sa); const sw = ccw ? n2(sb - sa) : -n2(sa - sb);
        v[G.i][2] = Math.tan(sw / 4); return mod(Geom.lwPairs(r, v, (r.int(70) & 1) === 1));
      }
      let q = setVert(r.p, G.i, a[0] + d[0], a[1] + d[1], xs); q = setVert(q, j, b[0] + d[0], b[1] + d[1], xs);
      return mod(q);
    }
    if (t === 'CIRCLE' && G.k === 'q') { const R = Math.hypot(p[0] - r.num(10), p[1] - r.num(20)); if (R < EPS) return { error: 'El radio debe ser mayor que 0.' }; return mod(setPairs(r.p, { 40: R })); }
    if (t === 'ARC') {
      const gs = grips(r); const P0 = gs.find((x) => x.k === 'a0'), P1 = gs.find((x) => x.k === 'a1'), PM = gs.find((x) => x.k === 'am');
      const q = (o) => [o.x, o.y];
      const tri = G.k === 'a0' ? [p, q(PM), q(P1)] : G.k === 'a1' ? [q(P0), q(PM), p] : [q(P0), p, q(P1)];
      const A = Geom.arco3(...tri); if (!A) return { error: 'Los tres puntos del arco quedan alineados.' };
      return mod(setPairs(r.p, { 10: A.c[0], 20: A.c[1], 40: A.r, 50: Edit.norm360(A.a0), 51: Edit.norm360(A.a1) }));
    }
    if (t === 'DIMENSION' && G.k === 'd') { const x = this.cotaPinzamiento(r, G.i, p); if (!x) return { error: 'Esta cota no se puede estirar.' }; this.commit('Pinzamiento de cota', { ...x, full: true }); return { ok: true }; }
    if (t === 'LEADER' && G.k === 'lv') return mod(setVert(r.p, G.i, p[0], p[1]));
    return { error: `Ese pinzamiento de ${t} todavía no se mueve.` };
  };

  // ================================================================ UNIR (JOIN)
  /** Pieza encadenable: vértices WCS con comba. */
  function pieza(r) {
    if (mir(r)) return null;
    if (r.type === 'LINE') return [[r.num(10), r.num(20), 0], [r.num(11), r.num(21), 0]];
    if (r.type === 'ARC') {
      const c = [r.num(10), r.num(20)], R = r.num(40), a0 = r.num(50) * Math.PI / 180, sw = n2(r.num(51) * Math.PI / 180 - a0);
      if (sw < 1e-9) return null;
      return [[c[0] + R * Math.cos(a0), c[1] + R * Math.sin(a0), Math.tan(sw / 4)], [c[0] + R * Math.cos(a0 + sw), c[1] + R * Math.sin(a0 + sw), 0]];
    }
    if (r.type === 'LWPOLYLINE' && !(r.int(70) & 1)) { const v = lwV(r); return v.length >= 2 ? v : null; }
    return null;
  }
  function invertir(v) { const n = v.length; const out = []; for (let k = 0; k < n; k++) { const o = v[n - 1 - k]; out.push([o[0], o[1], k < n - 1 ? -(v[n - 2 - k][2] || 0) : 0]); } return out; }
  /** Pares de entidad nueva con las propiedades (capa, color, tipo, grosor, escala TL) de `like`. */
  function conProps(Ses, page, type, sub, body, like) {
    const rec = Ses.make(page, type, sub, body, (like.get(8, '0') || '0').trim());
    const k = rec.p.findIndex((q) => q[0] === 8);
    const fin = like.p.findIndex((x) => x[0] === 100 && String(x[1]).trim() !== 'AcDbEntity'); // zona AcDbEntity (antes del subtipo)
    const extra = like.p.slice(0, fin < 0 ? like.p.length : fin).filter((q) => [6, 62, 370, 48, 420, 440, 60].includes(q[0])).map((q) => q.slice());
    rec.p.splice(k + 1, 0, ...extra);
    if (like.home && like.home !== rec.home) { rec.home = like.home; } // mismo contenedor que el original
    return rec;
  }
  const lwBody = (v, closed, w) => { const b = [[90, v.length], [70, closed ? 1 : 0], [43, w || 0]]; for (const q of v) { b.push([10, q[0]], [20, q[1]]); if (Math.abs(q[2] || 0) > 1e-12) b.push([42, q[2]]); } return b; };
  /** UNIR: líneas colineales en una línea; líneas, arcos y polilíneas abiertas que comparten extremo, en una polilínea. */
  S.unir = function (recs, page, tol = 1e-4) {
    const cand = recs.filter((r) => !r.deleted && pieza(r));
    if (cand.length < 2) return { error: 'UNIR necesita al menos dos líneas, arcos o polilíneas abiertas.' };
    // 1) todas líneas y colineales → una sola línea (aunque haya huecos), como AutoCAD
    if (cand.every((r) => r.type === 'LINE')) {
      const a = [cand[0].num(10), cand[0].num(20)], b = [cand[0].num(11), cand[0].num(21)]; const Lg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (Lg > EPS) {
        const u = [(b[0] - a[0]) / Lg, (b[1] - a[1]) / Lg]; const ts = [];
        const col = cand.every((r) => [[r.num(10), r.num(20)], [r.num(11), r.num(21)]].every((q) => { const dx = q[0] - a[0], dy = q[1] - a[1]; ts.push(dx * u[0] + dy * u[1]); return Math.abs(dx * u[1] - dy * u[0]) <= tol; }));
        if (col) {
          const t0 = Math.min(...ts), t1 = Math.max(...ts);
          this.commit(`Unir ${cand.length}`, { mods: [{ rec: cand[0], pairs: setPairs(cand[0].p, { 10: a[0] + u[0] * t0, 20: a[1] + u[1] * t0, 11: a[0] + u[0] * t1, 21: a[1] + u[1] * t1 }) }], dels: cand.slice(1) });
          return { ok: true, unidos: cand.length, resultado: 'línea', recs: [cand[0]] };
        }
      }
    }
    // 2) cadenas por extremos comunes
    const libres = cand.map((r) => ({ r, v: pieza(r) }));
    const cadenas = [];
    while (libres.length) {
      const first = libres.shift(); let v = first.v.map((q) => q.slice()); const miembros = [first.r];
      for (let cambio = true; cambio;) {
        cambio = false;
        for (let k = 0; k < libres.length; k++) {
          const P = libres[k]; const e = v[v.length - 1], s = v[0];
          let add = null, pre = null;
          if (near(e, P.v[0], tol)) add = P.v; else if (near(e, P.v[P.v.length - 1], tol)) add = invertir(P.v);
          else if (near(s, P.v[P.v.length - 1], tol)) pre = P.v; else if (near(s, P.v[0], tol)) pre = invertir(P.v);
          if (!add && !pre) continue;
          if (add) v = [...v.slice(0, -1), ...add.map((q) => q.slice())]; else v = [...pre.slice(0, -1).map((q) => q.slice()), ...v];
          miembros.push(P.r); libres.splice(k, 1); k--; cambio = true;
        }
      }
      if (miembros.length > 1) cadenas.push({ v, miembros });
    }
    if (!cadenas.length) return { error: 'Ningún objeto comparte extremo con otro (tolerancia ' + tol + ').' };
    const mods = [], adds = [], dels = []; const out = [];
    for (const c of cadenas) {
      let v = c.v; let closed = false;
      if (v.length > 2 && near(v[0], v[v.length - 1], tol)) { closed = true; v = v.slice(0, -1); }
      const base = c.miembros.find((r) => r.type === 'LWPOLYLINE');
      if (base) { mods.push({ rec: base, pairs: Geom.lwPairs(base, v, closed) }); dels.push(...c.miembros.filter((r) => r !== base)); out.push(base); }
      else { const n = conProps(this, page, 'LWPOLYLINE', 'AcDbPolyline', lwBody(v, closed), c.miembros[0]); adds.push(n); dels.push(...c.miembros); out.push(n); }
    }
    this.commit(`Unir ${cadenas.reduce((s, c) => s + c.miembros.length, 0)}`, { mods, adds, dels });
    return { ok: true, unidos: cadenas.reduce((s, c) => s + c.miembros.length, 0), polilineas: cadenas.length, resultado: 'polilínea', recs: out };
  };

  // ================================================================ PARTIR (BREAK)
  /** Parte un objeto entre p1 y p2 (p2 = null o igual a p1: lo parte en un punto). */
  S.partir = function (r, p1, p2, page) {
    const unPunto = !p2 || near(p1, p2, 1e-12); if (!p2) p2 = p1;
    if (mir(r)) return { error: 'Los objetos reflejados (extrusión −Z) todavía no se parten.' };
    const label = unPunto ? 'Partir en un punto' : 'Partir';
    const done = (pieces) => { // pieces = [{type, pairs}] la primera reemplaza al original
      if (!pieces.length) { this.commit(label, { dels: [r] }); return { ok: true, piezas: 0 }; }
      const [a, ...rest] = pieces;
      const mods = [], adds = [], dels = [];
      if (a.type === r.type) mods.push({ rec: r, pairs: a.pairs }); else { dels.push(r); adds.push(this.clone(r, a.type, a.pairs, page)); }
      for (const x of rest) adds.push(this.clone(r, x.type, x.pairs, page));
      this.commit(label, { mods, adds, dels }); return { ok: true, piezas: pieces.length, recs: [mods.length ? r : adds[0], ...adds.slice(mods.length ? 0 : 1)] };
    };
    if (r.type === 'LINE') {
      const a = [r.num(10), r.num(20)], b = [r.num(11), r.num(21)]; const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 1e-20) return { error: 'Línea de largo cero.' };
      const tp = (p) => Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      const [t1, t2] = [tp(p1), tp(p2)].sort((x, y) => x - y); const P = (t) => [a[0] + dx * t, a[1] + dy * t];
      if (unPunto && (t1 < 1e-9 || t1 > 1 - 1e-9)) return { error: 'El punto está en el extremo: no hay nada que partir.' };
      const out = [];
      if (t1 > 1e-9 || unPunto) out.push({ type: 'LINE', pairs: setPairs(r.p, { 11: P(t1)[0], 21: P(t1)[1] }) });
      if (t2 < 1 - 1e-9 || unPunto) out.push({ type: 'LINE', pairs: setPairs(r.p, { 10: P(t2)[0], 20: P(t2)[1] }) });
      return done(out);
    }
    if (r.type === 'ARC' || r.type === 'CIRCLE') {
      const c = [r.num(10), r.num(20)]; const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI;
      if (r.type === 'CIRCLE') {
        if (unPunto) return { error: 'Un círculo no se puede partir en un solo punto (sería un arco de 360°).' };
        // se borra la parte que va en sentido antihorario del primer al segundo punto
        const a1 = ang(p1), a2 = ang(p2); if (Math.abs(n2((a2 - a1) * Math.PI / 180)) < 1e-9) return { error: 'Los dos puntos coinciden.' };
        let pairs = r.p.map((q) => q.slice()); let at = pairs.findIndex((q) => q[0] >= 1000 || q[0] === 210); if (at < 0) at = pairs.length;
        pairs.splice(at, 0, [100, 'AcDbArc'], [50, F(Edit.norm360(a2))], [51, F(Edit.norm360(a1))]);
        return done([{ type: 'ARC', pairs }]);
      }
      const a0 = r.num(50), sw = n2((r.num(51) - a0) * Math.PI / 180) * 180 / Math.PI || 360;
      const up_ = (p) => { const u = n2((ang(p) - a0) * Math.PI / 180) * 180 / Math.PI; return u <= sw ? u : (u - sw < 360 - u ? sw : 0); };
      const [u1, u2] = [up_(p1), up_(p2)].sort((x, y) => x - y);
      if (unPunto && (u1 < 1e-9 || u1 > sw - 1e-9)) return { error: 'El punto está en el extremo: no hay nada que partir.' };
      const out = [];
      if (u1 > 1e-9 || unPunto) out.push({ type: 'ARC', pairs: setPairs(r.p, { 51: Edit.norm360(a0 + u1) }) });
      if (u2 < sw - 1e-9 || unPunto) out.push({ type: 'ARC', pairs: setPairs(r.p, { 50: Edit.norm360(a0 + u2) }) });
      return done(out);
    }
    if (r.type === 'LWPOLYLINE') {
      const { segs, closed, verts } = Geom.lwSegs(r); const n = segs.length; if (!n) return { error: 'Polilínea vacía.' };
      const T1 = Geom.segNearest(segs, p1[0], p1[1]), T2 = Geom.segNearest(segs, p2[0], p2[1]);
      const sub = (A, B) => Geom.subVerts(segs, A, B);
      if (closed) {
        if (unPunto) return done([{ type: 'LWPOLYLINE', pairs: Geom.lwPairs(r, sub(T1, T1 + n), false) }]);
        const keep = T1 < T2 ? sub(T2, T1 + n) : sub(T2, T1); // se borra lo que va del primer punto al segundo en el sentido de los vértices
        return done([{ type: 'LWPOLYLINE', pairs: Geom.lwPairs(r, keep, false) }]);
      }
      const [A, B] = [T1, T2].sort((x, y) => x - y);
      if (unPunto && (A < 1e-9 || A > n - 1e-9)) return { error: 'El punto está en el extremo: no hay nada que partir.' };
      const out = [];
      if (A > 1e-9) out.push({ type: 'LWPOLYLINE', pairs: Geom.lwPairs(r, sub(0, A), false) });
      if (B < n - 1e-9) out.push({ type: 'LWPOLYLINE', pairs: Geom.lwPairs(r, sub(B, n), false) });
      void verts; return done(out);
    }
    return { error: `PARTIR todavía no trabaja con ${r.type} (sí con líneas, arcos, círculos y polilíneas).` };
  };

  // ================================================================ EDITPOL (PEDIT)
  /** Convierte LINE o ARC en LWPOLYLINE (mismas propiedades). */
  S.polConvertir = function (r, page) {
    const v = pieza(r); if (!v || r.type === 'LWPOLYLINE') return { error: 'Solo se convierten líneas y arcos.' };
    const n = conProps(this, page, 'LWPOLYLINE', 'AcDbPolyline', lwBody(v, false), r);
    this.commit('Convertir en polilínea', { adds: [n], dels: [r] }); return { ok: true, rec: n };
  };
  S.polCerrar = function (r, cerrar) {
    if (r.type !== 'LWPOLYLINE') return { error: 'No es una polilínea.' };
    const f = r.int(70, 0); if (!!(f & 1) === !!cerrar) return { ok: true, sinCambio: true };
    if (cerrar && Geom.lwVerts(r).length < 2) return { error: 'La polilínea necesita al menos dos vértices.' };
    this.commit(cerrar ? 'Cerrar polilínea' : 'Abrir polilínea', { mods: [{ rec: r, pairs: setPairs(r.p, { 70: String(cerrar ? f | 1 : f & ~1) }) }] }); return { ok: true };
  };
  S.polGrosor = function (r, w) {
    if (r.type !== 'LWPOLYLINE') return { error: 'No es una polilínea.' };
    if (!(w >= 0)) return { error: 'El grosor no puede ser negativo.' };
    let p = r.p.filter((q) => q[0] !== 40 && q[0] !== 41); p = setPairs(p, { 43: w });
    this.commit(`Grosor de polilínea ${w}`, { mods: [{ rec: r, pairs: p }] }); return { ok: true };
  };
  S.polInvertir = function (r) {
    if (r.type !== 'LWPOLYLINE' || mir(r)) return { error: 'No es una polilínea que se pueda invertir.' };
    const v = lwV(r), c = (r.int(70) & 1) === 1;
    let nv;
    if (c) { const n = v.length; nv = []; for (let k = 0; k < n; k++) { const o = v[(n - k) % n]; const prev = v[(n - k - 1 + n) % n]; nv.push([o[0], o[1], -(prev[2] || 0)]); } }
    else nv = invertir(v);
    this.commit('Invertir polilínea', { mods: [{ rec: r, pairs: Geom.lwPairs(r, nv, c) }] }); return { ok: true };
  };
  S.polDecurvar = function (r) {
    if (r.type !== 'LWPOLYLINE') return { error: 'No es una polilínea.' };
    const v = lwV(r).map((q) => [q[0], q[1], 0]);
    this.commit('Decurvar polilínea', { mods: [{ rec: r, pairs: Geom.lwPairs(r, v, (r.int(70) & 1) === 1) }] }); return { ok: true };
  };

  // ================================================================ SUPRIMEDUPL (OVERKILL)
  const firmaProps = (r) => [r.type === 'LWPOLYLINE' || r.type === 'LINE' ? 'L' : r.type, up(r.get(8, '0')), r.get(62, ''), up(r.get(6, '')), r.get(370, ''), r.get(420, '')].join('|');
  function firmaGeom(r, tol) {
    const q = (v) => Math.round(v / tol);
    const pts = (a) => a.map((p) => `${q(p[0])},${q(p[1])}`);
    switch (r.type) {
      case 'LINE': return 'LINE:' + pts([[r.num(10), r.num(20)], [r.num(11), r.num(21)]]).sort().join(';');
      case 'CIRCLE': return `CIRCLE:${pts([[r.num(10), r.num(20)]])}:${q(r.num(40))}`;
      case 'ARC': return `ARC:${pts([[r.num(10), r.num(20)]])}:${q(r.num(40))}:${Math.round(r.num(50) * 1e4)}:${Math.round(r.num(51) * 1e4)}`;
      case 'LWPOLYLINE': {
        const v = lwV(r); const c = (r.int(70) & 1) === 1;
        const s1 = v.map((p) => `${q(p[0])},${q(p[1])},${Math.round((p[2] || 0) * 1e6)}`).join(';'); const s2 = invertir(v).map((p) => `${q(p[0])},${q(p[1])},${Math.round((p[2] || 0) * 1e6)}`).join(';');
        return `PL${c ? 'C' : 'A'}:${q(r.num(43, 0))}:${s1 < s2 ? s1 : s2}`;
      }
      case 'TEXT': case 'MTEXT': return `${r.type}:${pts([[r.num(10), r.num(20)]])}:${q(r.num(40))}:${Math.round(r.num(50) * 1e4)}:${Documento.textoDe(r)}`;
      case 'INSERT': return `INSERT:${up(r.get(2))}:${pts([[r.num(10), r.num(20)]])}:${Math.round(r.num(41, 1) * 1e6)}:${Math.round(r.num(42, 1) * 1e6)}:${Math.round(r.num(50) * 1e4)}`;
      case 'POINT': return `POINT:${pts([[r.num(10), r.num(20)]])}`;
      default: return null;
    }
  }
  /** SUPRIMEDUPL: borra objetos repetidos (misma capa y propiedades) y une líneas colineales que se montan. */
  S.suprimirDuplicados = function (recs, tol = 1e-4) {
    const vivos = recs.filter((r) => !r.deleted && !mir(r));
    const vistos = new Map(); const dels = new Set();
    for (const r of vivos) {
      const g = firmaGeom(r, tol); if (!g) continue;
      const k = firmaProps(r) + '#' + g;
      if (r.type === 'INSERT' && this.withSeq(r).some((a) => a.type === 'ATTRIB')) { const at = this.withSeq(r).filter((a) => a.type === 'ATTRIB').map((a) => Documento.textoDe(a)).join('|'); if (vistos.has(k + at)) dels.add(r); else vistos.set(k + at, r); continue; }
      if (vistos.has(k)) dels.add(r); else vistos.set(k, r);
    }
    // líneas colineales que se montan o se tocan → una sola
    const grupos = new Map();
    for (const r of vivos) {
      if (r.type !== 'LINE' || dels.has(r)) continue;
      const a = [r.num(10), r.num(20)], b = [r.num(11), r.num(21)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < EPS) continue;
      let ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; if (ux < -1e-12 || (Math.abs(ux) < 1e-12 && uy < 0)) { ux = -ux; uy = -uy; }
      const off = a[0] * uy - a[1] * ux;
      const k = `${firmaProps(r)}#${Math.round(Math.atan2(uy, ux) * 1e6)}#${Math.round(off / tol)}`;
      const t0 = a[0] * ux + a[1] * uy, t1 = b[0] * ux + b[1] * uy;
      if (!grupos.has(k)) grupos.set(k, { u: [ux, uy], off, items: [] });
      grupos.get(k).items.push({ r, t0: Math.min(t0, t1), t1: Math.max(t0, t1) });
    }
    const mods = []; let unidas = 0;
    for (const g of grupos.values()) {
      if (g.items.length < 2) continue;
      g.items.sort((x, y) => x.t0 - y.t0);
      let cur = { ...g.items[0], n: [g.items[0].r] };
      const cierra = (c) => {
        if (c.n.length < 2) return;
        const [ux, uy] = g.u; const P = (t) => [t * ux + g.off * uy, t * uy - g.off * ux];
        const A = P(c.t0), B = P(c.t1);
        mods.push({ rec: c.n[0], pairs: setPairs(c.n[0].p, { 10: A[0], 20: A[1], 11: B[0], 21: B[1] }) });
        c.n.slice(1).forEach((x) => dels.add(x)); unidas += c.n.length - 1;
      };
      for (const it of g.items.slice(1)) {
        if (it.t0 <= cur.t1 + tol) { cur.t1 = Math.max(cur.t1, it.t1); cur.n.push(it.r); }
        else { cierra(cur); cur = { ...it, n: [it.r] }; }
      }
      cierra(cur);
    }
    if (!dels.size && !mods.length) return { ok: true, borrados: 0, unidas: 0 };
    this.commit(`Suprimir duplicados (${dels.size})`, { mods, dels: [...dels] });
    return { ok: true, borrados: dels.size - unidas, unidas, total: dels.size };
  };

  // ================================================================ COBERTURA (WIPEOUT)
  /** Clases y diccionario que pide AutoCAD para los WIPEOUT (se agregan una vez). Devuelve {adds, mods} para el commit. */
  S._preparaWipeout = function () {
    const D = this.D; const adds = [], mods = [];
    if (!D.sections.OBJECTS) return { adds, mods };
    const objs = Documento.seccion(D, 'OBJECTS', 'objects');
    if (D.sections.CLASSES) {
      const clases = Documento.seccion(D, 'CLASSES', 'classes');
      const v2004 = String(D.acadver || '') >= 'AC1018';
      const tiene = new Set(clases.filter((r) => !r.deleted).map((r) => up(r.get(1, ''))));
      for (const [n, cpp, flags, ent] of [['WIPEOUT', 'AcDbWipeout', 127, 1], ['WIPEOUTVARIABLES', 'AcDbWipeoutVariables', 0, 0]]) {
        if (tiene.has(n)) continue;
        const r = new DXF.Rec('CLASS', [[1, n], [2, cpp], [3, 'WipeOut'], [90, String(flags)], ...(v2004 ? [[91, '0']] : []), [280, '0'], [281, String(ent)]]);
        r.isNew = true; r.home = clases; r.insertLine = clases.endLine; adds.push(r);
      }
    }
    const root = objs.find((r) => !r.deleted && r.type === 'DICTIONARY');
    if (root && !root.p.some((q, i) => q[0] === 3 && up(q[1]) === 'ACAD_WIPEOUT_VARS')) {
      const rootH = hnd(root); const h = this.newHandle();
      const r = new DXF.Rec('WIPEOUTVARIABLES', [[5, h], [102, '{ACAD_REACTORS'], [330, rootH], [102, '}'], [330, rootH], [100, 'AcDbWipeoutVariables'], [70, '0']]);
      r.isNew = true; r.home = objs; r.insertLine = objs.endLine; adds.push(r);
      mods.push({ rec: root, pairs: [...root.p.map((q) => q.slice()), [3, 'ACAD_WIPEOUT_VARS'], [350, h]] });
    }
    return { adds, mods };
  };
  /** Pares del WIPEOUT para un polígono WCS (mismo modelo que una IMAGEN de 1×1 píxel). */
  function wipeoutBody(pts) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys); const sx = Math.max(...xs) - x0 || EPS, sy = Math.max(...ys) - y0 || EPS;
    const v = pts.map((p) => [(p[0] - x0) / sx - 0.5, 0.5 - (p[1] - y0) / sy]);
    if (!near(v[0], v[v.length - 1], 1e-12)) v.push(v[0].slice());
    const body = [[90, 0], [10, x0], [20, y0], [30, 0], [11, sx], [21, 0], [31, 0], [12, 0], [22, sy], [32, 0], [13, 1], [23, 1], [340, '0'], [70, 7], [280, 1], [281, 50], [282, 50], [283, 0], [360, '0'], [71, 2], [91, v.length]];
    for (const q of v) body.push([14, q[0]], [24, q[1]]);
    return body;
  }
  /** COBERTURA: crea un WIPEOUT (tapa con el color del papel lo que está dibujado antes). o.antesDe = objeto que debe quedar
   *  encima (la cobertura se pone justo antes en el orden de dibujo: así tapa la trama pero no el texto). */
  S.crearCobertura = function (page, pts, o = {}) {
    if (this.r12()) return { error: 'La cobertura necesita DXF 2000 o posterior.' };
    if (pts.length < 3) return { error: 'La cobertura necesita al menos tres puntos.' };
    if (areaPuntos(pts).area < 1e-12) return { error: 'El contorno no encierra área.' };
    const pre = this._preparaWipeout();
    const w = this.make(page, 'WIPEOUT', 'AcDbWipeout', wipeoutBody(pts), o.capa || this.capaActual());
    const ante = o.antesDe;
    if (ante) { const loc = this.locate(ante); if (loc) { w.home = loc.list; w.insertLine = ante.isNew ? ante.insertLine : (ante.L0 != null ? ante.L0 : w.insertLine); } }
    this.commit('Cobertura', { adds: [...pre.adds, w], mods: pre.mods, full: true });
    if (ante) { const L = w.home; const i = L.indexOf(w), j = L.indexOf(ante); if (i > j && j >= 0) { L.splice(i, 1); L.splice(j, 0, w); } }
    if (o.borrar) this.commit('Borrar contorno', { dels: [o.borrar] });
    return { ok: true, rec: w };
  };
  /** Rectángulo (girado) alrededor de un texto: caja alineada bb, rotación en grados y margen. */
  function rectTexto(bb, rotDeg, margen) {
    const c = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], W = bb[2] - bb[0], Hh = bb[3] - bb[1];
    const a = rotDeg * Math.PI / 180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    let w = W, h = Hh; const det = ca * ca - sa * sa;
    if (Math.abs(det) > 0.05) { w = (W * ca - Hh * sa) / det; h = (Hh * ca - W * sa) / det; }
    w = Math.max(w, 0) + 2 * margen; h = Math.max(h, 0) + 2 * margen;
    const ux = [Math.cos(a), Math.sin(a)], uy = [-Math.sin(a), Math.cos(a)];
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + ux[0] * w / 2 * i + uy[0] * h / 2 * j, c[1] + ux[1] * w / 2 * i + uy[1] * h / 2 * j]);
  }

  // ================================================================ TEXTOM (MTEXT)
  /** Texto de párrafo escapado para MTEXT: «\» → «\\», llaves → «\{ \}», saltos de renglón → «\P». */
  const mtextEsc = (s) => String(s).replace(/\\(?!P)/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\P');
  /** TEXTOM: o = {at (punto de enganche), ancho, h, att (1–9), texto (renglones con \n), estilo, capa}. */
  S.crearTextoM = function (page, o) {
    if (this.r12()) return { error: 'El texto de párrafo necesita DXF 2000 o posterior.' };
    const s = mtextEsc(o.texto || ''); if (!s.length) return { error: 'El texto está vacío.' };
    const body = [[10, o.at[0]], [20, o.at[1]], [30, 0], [40, o.h || 2.5], [41, Math.max(0, o.ancho || 0)], [71, o.att || 1], [72, 1]];
    let rest = s; while (rest.length > 250) { let k = 250; if (rest[k - 1] === '\\') k--; body.push([3, rest.slice(0, k)]); rest = rest.slice(k); }
    body.push([1, rest]);
    const st = o.estilo || this.estiloActual(); if (st && this.findRec('STYLE', st)) body.push([7, st]);
    if (o.rot) body.push([50, o.rot]);
    body.push([73, 1], [44, 1]);
    const rec = this.make(page, 'MTEXT', 'AcDbMText', body, o.capa || this.capaActual());
    this.commit('Texto de párrafo', { adds: [rec] }); return { ok: true, rec };
  };
  /** Punto de enganche (1–9) y su punto en la caja de dos esquinas. */
  const ATT = { SI: 1, SC: 2, SD: 3, MI: 4, MC: 5, MD: 6, II: 7, IC: 8, ID: 9, I: 1, C: 2, D: 3 };
  function puntoCaja(a, b, att) {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const col = (att - 1) % 3, fila = Math.floor((att - 1) / 3);
    return [[x0, (x0 + x1) / 2, x1][col], [y1, (y0 + y1) / 2, y0][fila]];
  }

  // ================================================================ COPIAR / PEGAR entre planos
  const CLAVE = 'domoplano.clipboard'; let memoria = null;
  const portapapeles = {
    escribir(obj) { const s = JSON.stringify(obj); memoria = s; try { if (typeof localStorage !== 'undefined') localStorage.setItem(CLAVE, s); } catch (e) { /* sin almacenamiento */ } return s.length; },
    leer() { let s = null; try { if (typeof localStorage !== 'undefined') s = localStorage.getItem(CLAVE); } catch (e) { s = null; } s = s || memoria; if (!s) return null; try { const o = JSON.parse(s); return o && o.domoplano === 1 ? o : null; } catch (e) { return null; } },
  };
  const sinCabeza = (p) => Edit.stripReactors(p).filter((q) => q[0] !== 5 && q[0] !== 330 && q[0] !== 105);
  const NO_COPIA = new Set(['VIEWPORT', 'IMAGE', 'MULTILEADER', 'OLE2FRAME', 'ACAD_TABLE', 'ACAD_PROXY_ENTITY']);
  /** COPIAPORTA: guarda lo designado (con sus capas, tipos de línea, estilos y bloques) en el portapapeles de Domoplano. */
  S.copiarPortapapeles = function (recs, base, unidades) {
    const ents = [], usadosL = new Set(), usadosT = new Set(), usadosE = new Set(), bloques = new Map(); const rechazados = new Set();
    const D = this.D;
    const nota = (r) => { usadosL.add((r.get(8, '0') || '0').trim()); const t = r.get(6); if (t && !/^BY(LAYER|BLOCK)$/i.test(t.trim())) usadosT.add(t.trim()); const e = r.get(7); if (e && ['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(r.type)) usadosE.add(e.trim()); };
    const conBloque = (name) => {
      const k = up(name); if (!k || bloques.has(k)) return; const b = D.blocks.get(k); if (!b || b.deleted) return;
      const def = { name: b.name, base: b.base || [b.head ? b.head.num(10) : 0, b.head ? b.head.num(20) : 0], flags: b.head ? b.head.int(70, 0) : 0, ents: [] };
      bloques.set(k, def);
      for (const e of b.ents) { if (e.deleted || NO_COPIA.has(e.type)) continue; nota(e); def.ents.push({ type: e.type, p: sinCabeza(e.p) }); if (e.type === 'INSERT' || e.type === 'DIMENSION') conBloque(e.get(2, '')); }
    };
    let n = 0;
    for (const r of recs) {
      if (r.deleted) continue;
      if (NO_COPIA.has(r.type)) { rechazados.add(r.type); continue; }
      const g = this.withSeq(r); g.forEach(nota); n++;
      ents.push(g.map((q) => ({ type: q.type, p: sinCabeza(q.p) })));
      if (r.type === 'INSERT' || r.type === 'DIMENSION') conBloque(r.get(2, ''));
    }
    if (!n) return { error: rechazados.size ? `No se copian todavía: ${[...rechazados].join(', ')}.` : 'No hay objetos para copiar.' };
    for (const b of bloques.values()) for (const e of b.ents) { /* ya anotado */ void e; }
    const capas = [...usadosL].map((name) => { const L = this.findRec('LAYER', name); return L ? { name: L.get(2).trim(), color: L.int(62, 7), ltype: (L.get(6, 'Continuous') || '').trim(), lw: L.int(370, -3), plot: L.int(290, 1) !== 0 } : { name }; });
    capas.forEach((c) => { if (c.ltype && !/^continuous$/i.test(c.ltype)) usadosT.add(c.ltype); });
    const tipos = [...usadosT].map((name) => { const t = this.findRec('LTYPE', name); return t ? { name: t.get(2).trim(), p: sinCabeza(t.p).filter((q) => q[0] !== 100 && q[0] !== 340) } : null; }).filter(Boolean);
    const estilos = [...usadosE].map((name) => { const s = this.findRec('STYLE', name); return s ? { name: s.get(2).trim(), font: (s.get(3, '') || '').trim(), height: s.num(40, 0), width: s.num(41, 1) } : null; }).filter(Boolean);
    const obj = { domoplano: 1, unidades: unidades || '', base, n, ents, capas, tipos, estilos, bloques: [...bloques.values()] };
    const bytes = portapapeles.escribir(obj);
    return { ok: true, n, bloques: bloques.size, capas: capas.length, rechazados: [...rechazados], bytes, json: obj };
  };
  /** Pares de una entidad pegada: handle nuevo, dueño, marca de espacio papel; sombreados sin asociatividad. */
  function paresPegados(Ses, type, p, owner, paper) {
    let out = p.map((q) => q.slice());
    if (type === 'HATCH') { // los objetos de contorno del otro plano no existen aquí
      const fixed = []; let skip = 0;
      for (const q of out) {
        if (skip > 0 && q[0] === 330) { skip--; continue; }
        if (q[0] === 97) { skip = parseInt(q[1], 10) || 0; fixed.push([97, '0']); continue; }
        if (q[0] === 71) { fixed.push([71, '0']); continue; }
        fixed.push(q);
      }
      out = fixed;
    }
    if (type === 'LEADER') out = out.filter((q) => q[0] !== 340);
    out = out.filter((q) => q[0] !== 67);
    const k = out.findIndex((q) => q[0] === 100 && String(q[1]).trim() === 'AcDbEntity');
    if (paper) out.splice(k >= 0 ? k + 1 : 0, 0, [67, '1']);
    return [[5, Ses.newHandle()], [330, owner], ...out];
  }
  const traslada = (type, p, dx, dy) => {
    if (type === 'DIMENSION') {
      const out = p.map((q) => q.slice());
      for (let i = 0; i < out.length - 1; i++) { const c = out[i][0]; if (c >= 10 && c <= 16 && out[i + 1][0] === c + 10) { out[i][1] = F(parseFloat(out[i][1]) + dx); out[i + 1][1] = F(parseFloat(out[i + 1][1]) + dy); i++; } }
      return out;
    }
    if (type === 'SEQEND') return p.map((q) => q.slice());
    const r = new DXF.Rec(type, p);
    return Edit.transformPairs(type, p, Edit.similarity({ dx, dy }), Edit.mirrored(r));
  };
  /** PEGAPORTA / PEGAORIG: pega el portapapeles con su punto base en `at` (sin `at` = mismas coordenadas). */
  S.pegarPortapapeles = function (page, clip, at) {
    if (!clip) return { error: 'El portapapeles de Domoplano está vacío (use COPIAPORTA o ⌘C en otro plano).' };
    if (this.r12()) return { error: 'Pegar necesita DXF 2000 o posterior.' };
    const dx = at ? at[0] - clip.base[0] : 0, dy = at ? at[1] - clip.base[1] : 0;
    const res = { capas: 0, tipos: 0, estilos: 0, bloques: 0, n: 0 };
    return this.agrupar(`Pegar ${clip.n}`, () => {
      for (const t of clip.tipos || []) if (!this.findRec('LTYPE', t.name)) { const rec = this.tableRec('LTYPE', 'LTYPE', [...this.symHead('LTYPE', 'AcDbLinetypeTableRecord'), ...t.p]); if (rec) { this.commit(`Tipo de línea ${t.name}`, { adds: [rec], tables: true }); res.tipos++; } }
      for (const c of clip.capas || []) if (!this.findRec('LAYER', c.name)) { const r = this.crearCapa(c.name, { color: Math.abs(c.color ?? 7), ltype: c.ltype && this.findRec('LTYPE', c.ltype) && !/^continuous$/i.test(c.ltype) ? c.ltype : undefined, lw: c.lw, plot: c.plot }); if (!r.error) res.capas++; }
      for (const e of clip.estilos || []) if (!this.findRec('STYLE', e.name)) { const r = this.estilo(e.name, { font: e.font || undefined, height: e.height, width: e.width }); if (!r.error) res.estilos++; }
      // bloques: los que ya existen con ese nombre se usan como están (como AutoCAD); los anónimos (*D, *U…) van con nombre nuevo
      const nombres = new Map(); const nuevos = []; const brs = [];
      const usados = new Set([...this.D.blocks.keys()]);
      const libre = (pref) => { let k = 1; while (usados.has(`${pref}${k}`)) k++; usados.add(`${pref}${k}`); return `${pref}${k}`; };
      for (const b of clip.bloques || []) {
        const anon = b.name.startsWith('*');
        if (!anon && this.D.blocks.has(up(b.name)) && !this.D.blocks.get(up(b.name)).deleted) { nombres.set(up(b.name), b.name); continue; }
        nombres.set(up(b.name), anon ? libre(up(b.name).replace(/\d+$/, '')) : b.name);
      }
      const renombra = (type, p) => ((type === 'INSERT' || type === 'DIMENSION') ? p.map(([c, v]) => (c === 2 && nombres.has(up(v)) ? [2, nombres.get(up(v))] : [c, v])) : p);
      for (const b of clip.bloques || []) {
        const nn = nombres.get(up(b.name)); if (!b.name.startsWith('*') && this.D.blocks.has(up(nn)) && !this.D.blocks.get(up(nn)).deleted) continue;
        const anonDim = /^\*D/i.test(b.name); // el bloque de una cota está en coordenadas del dibujo: se traslada con ella
        const { b: nb, br } = this._bloqueNuevo(nn, b.base, b.flags || 0);
        let parent = null;
        for (const e of b.ents) {
          const child = ['ATTRIB', 'VERTEX', 'SEQEND'].includes(e.type);
          let p = renombra(e.type, e.p); if (anonDim) p = traslada(e.type, p, dx, dy) || p;
          const pairs = paresPegados(this, e.type, p, child && parent ? parent : nb.owner, false);
          const rec = new DXF.Rec(e.type, pairs); rec.inBlock = true; rec.home = nb.ents; nb.ents.push(rec);
          if (!child) parent = pairs[0][1];
        }
        nuevos.push(nb); brs.push(br); res.bloques++;
      }
      if (nuevos.length) this.commit('Bloques pegados', { adds: brs, newBlocks: nuevos, tables: true });
      // entidades
      const adds = []; const owner = page.edit.owner || '0'; const paper = !!page.edit.paper;
      const dimst = (p) => p.map(([c, v]) => (c === 3 && !this.findRec('DIMSTYLE', v) ? [3, this.hdrGet('$DIMSTYLE', 2, 'Standard')] : [c, v]));
      for (const g of clip.ents) {
        let parentH = null; const grupo = [];
        for (const e of g) {
          let p = renombra(e.type, e.p); if (e.type === 'DIMENSION' || e.type === 'LEADER') p = dimst(p);
          const tp = traslada(e.type, p, dx, dy); if (!tp) { grupo.length = 0; break; }
          const child = ['ATTRIB', 'VERTEX', 'SEQEND'].includes(e.type);
          const pairs = paresPegados(this, e.type, tp, child && parentH ? parentH : owner, paper);
          const rec = new DXF.Rec(e.type, pairs); rec.isNew = true; rec.home = page.edit.container; rec.insertLine = page.edit.insertLine;
          if (!child) parentH = pairs[0][1];
          grupo.push(rec);
        }
        if (grupo.length) { adds.push(...grupo); res.n++; }
      }
      if (!adds.length) return { error: 'No se pudo pegar ningún objeto.' };
      this.commit(`Pegar ${res.n}`, { adds });
      return { ok: true, ...res, recs: adds.filter((r) => !['ATTRIB', 'VERTEX', 'SEQEND'].includes(r.type)), avisoUnidades: clip.unidades };
    });
  };

  // ================================================================ CANTIDADES (extracción de datos)
  /** Cuenta bloques (por nombre, capa y atributos) y suma longitudes por capa. recs = objetos del Modelo o de la selección. */
  function cantidades(recs, Ses) {
    const bl = new Map(), lon = new Map();
    for (const r of recs) {
      if (r.deleted) continue;
      const capa = (r.get(8, '0') || '0').trim();
      if (r.type === 'INSERT') {
        const nombre = (r.get(2, '') || '').trim(); if (nombre.startsWith('*')) continue;
        const atts = Ses ? Ses.withSeq(r).filter((a) => a.type === 'ATTRIB' && !a.deleted).map((a) => `${(a.get(2, '') || '').trim()}=${Documento.textoDe(a)}`).join('; ') : '';
        const k = `${nombre}|${capa}|${atts}`; const x = bl.get(k) || { nombre, capa, atributos: atts, n: 0 }; x.n++; bl.set(k, x);
      } else if (['LINE', 'LWPOLYLINE', 'ARC', 'POLYLINE'].includes(r.type)) {
        let L = r.type === 'POLYLINE' && Ses ? (() => { const v = Ses.withSeq(r).filter((q) => q.type === 'VERTEX').map((q) => [q.num(10), q.num(20), q.num(42)]); return areaVerts(v, (r.int(70) & 1) === 1).perim; })() : longitud(r);
        if (!Number.isFinite(L)) continue;
        const k = capa; const x = lon.get(k) || { capa, n: 0, L: 0 }; x.n++; x.L += L; lon.set(k, x);
      }
    }
    const bloques = [...bl.values()].sort((a, b) => a.nombre.localeCompare(b.nombre) || a.capa.localeCompare(b.capa) || a.atributos.localeCompare(b.atributos));
    const longitudes = [...lon.values()].sort((a, b) => a.capa.localeCompare(b.capa));
    return { bloques, longitudes };
  }
  // R2-fix M-11: lo que NO es obra no entra a las cantidades (convenciones, marco, rótulo, cuadros de la plantilla y capas que
  // no se imprimen). Patrones de capa y de bloque que se dejan por fuera por omisión:
  const CAPAS_NO_OBRA = /^EPM-(CONVENCIONES|ESPACIOS|FIRMA|MARCO|ROTULO|TABLAS|TEXTO|VENTANAS)$|CONVENCI|R[OÓ]TULO|CAJET[IÍ]N|MARCO|MARGEN|^DEFPOINTS$|TITLE|BORDER|VENTANA|VIEWPORT/i;
  const BLOQUES_NO_OBRA = /R[OÓ]TULO|CAJET[IÍ]N|TITLE|CONVENC|MARCO|SELLO/i;
  /** Convierte «RED*, POSTES» en una prueba de nombre de capa (comodín * y ?). */
  function pruebaCapas(lista) {
    const pats = String(lista || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
      .map((x) => new RegExp('^' + x.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
    return pats.length ? (n) => pats.some((re) => re.test(n)) : null;
  }
  /**
   * Filtra los objetos para CANTIDADES. o = {capas: 'RED*,POSTES' (solo esas; sin esto = automático), zona: [x0,y0,x1,y1]
   * (solo lo que cae dentro, por el punto de inserción o el centro), todo: true (sin quitar nada)}. Por omisión deja por
   * fuera las capas de la plantilla que no son obra, las capas que no se imprimen, apagadas o inutilizadas, y los
   * bloques de rótulo/convenciones. Devuelve {recs, fuera: [{capa, n, razon}]}.
   */
  function filtroCantidades(recs, Ses, o = {}) {
    if (o.todo) return { recs: recs.filter((r) => !r.deleted), fuera: [] };
    const solo = pruebaCapas(o.capas); const fuera = new Map(); const out = [];
    const capaInfo = new Map();
    const info = (n) => {
      if (capaInfo.has(n)) return capaInfo.get(n);
      const L = Ses && Ses.findRec ? Ses.findRec('LAYER', n) : null;
      let razon = null;
      if (L) { if (L.get(290) !== undefined && L.int(290, 1) === 0) razon = 'no se imprime'; else if ((L.int(70, 0) & 1) === 1) razon = 'inutilizada'; else if (L.int(62, 7) < 0) razon = 'apagada'; }
      if (!razon && !solo && CAPAS_NO_OBRA.test(n)) razon = 'plantilla (no es obra)';
      capaInfo.set(n, razon); return razon;
    };
    const centro = (r) => { if (r.get(10) !== undefined) { if (r.type === 'LINE') return [(r.num(10) + r.num(11)) / 2, (r.num(20) + r.num(21)) / 2]; return [r.num(10), r.num(20)]; } return null; };
    const z = o.zona ? [Math.min(o.zona[0], o.zona[2]), Math.min(o.zona[1], o.zona[3]), Math.max(o.zona[0], o.zona[2]), Math.max(o.zona[1], o.zona[3])] : null;
    const marca = (capa, razon) => { const k = capa + '|' + razon; const x = fuera.get(k) || { capa, razon, n: 0 }; x.n++; fuera.set(k, x); };
    for (const r of recs) {
      if (r.deleted) continue;
      const capa = (r.get(8, '0') || '0').trim();
      if (solo && !solo(capa)) continue; // no es de las capas pedidas: ni se cuenta ni se avisa
      const razon = info(capa); if (razon) { marca(capa, razon); continue; }
      if (r.type === 'INSERT' && BLOQUES_NO_OBRA.test((r.get(2, '') || '').trim())) { marca(capa, `bloque ${(r.get(2, '') || '').trim()}`); continue; }
      if (z) { const c = centro(r); if (!c || c[0] < z[0] || c[0] > z[2] || c[1] < z[1] || c[1] > z[3]) continue; }
      out.push(r);
    }
    return { recs: out, fuera: [...fuera.values()].sort((a, b) => a.capa.localeCompare(b.capa)) };
  }
  const coma = (v, d = 2) => String((+v).toFixed(d)).replace('.', ',');
  /** Filas para TABLA y texto TSV (Excel). */
  function cantidadesTabla(q, unidades) {
    const filas = [['ELEMENTO', 'CAPA', 'DETALLE', 'CANTIDAD']];
    for (const b of q.bloques) filas.push([b.nombre, b.capa, b.atributos || '—', String(b.n)]);
    for (const l of q.longitudes) filas.push([`Longitud (${l.n} tramo${l.n === 1 ? '' : 's'})`, l.capa, unidades || 'unid.', coma(l.L)]);
    const tsv = filas.map((f) => f.map((c) => String(c).replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n');
    return { filas, tsv };
  }

  // ================================================================ MAPAOSM (calco de OpenStreetMap)
  /** Lee datos OSM: XML (.osm) o JSON de Overpass (con «geometry» o con nodos y «nodes»). → [{tags, pts: [[lat, lon]], cerrada}] */
  function leerOSM(texto) {
    const s = String(texto).trim(); const ways = [];
    if (s.startsWith('{')) {
      const d = JSON.parse(s); const nodos = new Map();
      for (const e of d.elements || []) if (e.type === 'node') nodos.set(e.id, [e.lat, e.lon]);
      for (const e of d.elements || []) {
        if (e.type !== 'way') continue;
        const pts = e.geometry ? e.geometry.map((g) => [g.lat, g.lon]) : (e.nodes || []).map((id) => nodos.get(id)).filter(Boolean);
        if (pts.length >= 2) ways.push({ tags: e.tags || {}, pts, cerrada: e.nodes ? e.nodes[0] === e.nodes[e.nodes.length - 1] : near(pts[0], pts[pts.length - 1], 1e-12) });
      }
      return ways;
    }
    const nodos = new Map();
    for (const m of s.matchAll(/<node\b([^>]*?)\/?>/g)) { const a = m[1]; const id = /\bid="([^"]+)"/.exec(a), la = /\blat="([^"]+)"/.exec(a), lo = /\blon="([^"]+)"/.exec(a); if (id && la && lo) nodos.set(id[1], [+la[1], +lo[1]]); }
    for (const m of s.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
      const body = m[1]; const refs = [...body.matchAll(/<nd\b[^>]*\bref="([^"]+)"/g)].map((x) => x[1]);
      const tags = {}; for (const t of body.matchAll(/<tag\b[^>]*\bk="([^"]*)"[^>]*\bv="([^"]*)"/g)) tags[t[1]] = t[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'");
      const pts = refs.map((r) => nodos.get(r)).filter(Boolean);
      if (pts.length >= 2) ways.push({ tags, pts, cerrada: refs.length > 2 && refs[0] === refs[refs.length - 1] });
    }
    return ways;
  }
  const ANDEN = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'sidewalk', 'corridor']);
  /** Capa de un elemento OSM: vías, andenes o predios (construcciones, manzanas, usos del suelo). null = se ignora. */
  function capaOSM(tags) {
    if (tags.highway) return ANDEN.has(tags.highway) || tags.footway === 'sidewalk' ? 'URB_ANDENES' : 'URB_VIAS';
    if (tags.building || tags.landuse || tags.place === 'block' || tags['building:part'] || tags.leisure || tags.amenity) return 'URB_PREDIOS';
    return null;
  }
  /** Proyección al plano tangente local (como tdc_mapa_osm.py): metros desde (lat0, lon0). f = metros por unidad del dibujo. */
  function proyectarOSM(ways, lat0, lon0, f = 1) {
    if (lat0 == null) { let n = 0, la = 0, lo = 0; for (const w of ways) for (const p of w.pts) { la += p[0]; lo += p[1]; n++; } lat0 = la / (n || 1); lon0 = lo / (n || 1); }
    const KX = Math.cos(lat0 * Math.PI / 180) * 111320.0, KY = 110574.0;
    const xy = (p) => [(p[1] - lon0) * KX / f, (p[0] - lat0) * KY / f];
    const out = [];
    for (const w of ways) {
      const capa = capaOSM(w.tags); if (!capa) continue;
      let pts = w.pts.map(xy); const cerrada = w.cerrada && capa === 'URB_PREDIOS';
      if (cerrada && near(pts[0], pts[pts.length - 1], 1e-9)) pts = pts.slice(0, -1);
      out.push({ capa, pts, cerrada, nombre: w.tags.name || null });
    }
    return { items: out, lat0, lon0 };
  }
  /** Consulta para Overpass (vías, construcciones y usos del suelo en un radio, metros). */
  const consultaOverpass = (lat, lon, radio) => `[out:json][timeout:25];(way["highway"](around:${radio},${lat},${lon});way["building"](around:${radio},${lat},${lon});way["landuse"](around:${radio},${lat},${lon});way["place"="block"](around:${radio},${lat},${lon}););out geom;`;
  /** MAPAOSM: dibuja lo proyectado en las capas URB_VIAS, URB_ANDENES y URB_PREDIOS, con el origen (lat0, lon0) en `at`. */
  S.calcarOSM = function (page, proy, at = [0, 0], o = {}) {
    if (!proy.items.length) return { error: 'Los datos no traen vías ni construcciones.' };
    const COL = { URB_VIAS: 8, URB_ANDENES: 9, URB_PREDIOS: 30 };
    return this.agrupar('Calco de mapa OSM', () => {
      for (const c of Object.keys(COL)) if (!this.findRec('LAYER', c)) { const r = this.crearCapa(c, { color: COL[c] }); if (r.error) return r; }
      const adds = []; const cuenta = { URB_VIAS: 0, URB_ANDENES: 0, URB_PREDIOS: 0 }; const h = o.alturaTexto || 0;
      for (const it of proy.items) {
        const v = it.pts.map((p) => [p[0] + at[0], p[1] + at[1], 0]);
        adds.push(this.make(page, 'LWPOLYLINE', 'AcDbPolyline', lwBody(v, it.cerrada), it.capa)); cuenta[it.capa]++;
        if (h > 0 && it.nombre && it.capa === 'URB_VIAS' && v.length >= 2) { // nombre de la vía en el tramo más largo
          let best = 0, bl = -1; for (let k = 0; k < v.length - 1; k++) { const L = Math.hypot(v[k + 1][0] - v[k][0], v[k + 1][1] - v[k][1]); if (L > bl) { bl = L; best = k; } }
          const a = v[best], b = v[best + 1]; let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
          adds.push(this.make(page, 'TEXT', 'AcDbText', Documento.textoPares([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h, ang, it.nombre, { just: 'MC' }), 'URB_VIAS'));
        }
      }
      this.commit(`Mapa OSM (${proy.items.length})`, { adds });
      return { ok: true, ...cuenta, total: proy.items.length, textos: adds.filter((r) => r.type === 'TEXT').length, origen: [proy.lat0, proy.lon0] };
    });
  };

  return { setPairs, longitud, medir, areaPuntos, txtArea, info, similares, filtrar, valores, tipoDXF, grips, pieza, invertir, rectTexto, wipeoutBody, mtextEsc, ATT, puntoCaja,
    portapapeles, cantidades, cantidadesTabla, filtroCantidades, CAPAS_NO_OBRA, leerOSM, capaOSM, proyectarOSM, consultaOverpass, f4 };
})();
if (typeof module !== 'undefined') module.exports = P2; else self.P2 = P2;
