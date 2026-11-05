// Domoplano — GENERADOR de DXF completos (AC1024 / formato 2010) para la biblioteca de símbolos EPM y la plantilla EPM.
// Código propio escrito a partir de la referencia pública del formato DXF. Sin código ni archivos de Autodesk:
// los tipos de línea, la letra (Liberation Sans, OFL) y todo lo dibujado son nuestros.
// (No reemplaza el escritor de la app —documento.js / edit.js, hito H1—: este arma archivos NUEVOS de cero.)
//
// Uso:
//   const D = new DXFGen.Dibujo({ papel: [1000, 707], plancha: 'PLANO 01 DE 01' });
//   D.capa('EPM-POSTES', { color: 7, tipo: 'Continuous', grosor: 25 });
//   const b = D.bloque('EPM_POSTE_CONCRETO_EXIST', { base: [0, 0] }); b.circulo([0, 0], 2, { capa: '0' });
//   D.plancha.insertar('EPM_POSTE_CONCRETO_EXIST', [100, 100]); D.modelo.linea([0, 0], [10, 0]);
//   const texto = D.toString();
const DXFGen = (() => {
  const FUENTE = 'LiberationSans-Regular.ttf';
  const fmt = (x) => { const v = Math.round(x * 1e6) / 1e6; return Number.isInteger(v) ? v.toFixed(1) : String(v); };

  // ---------------------------------------------------------------- un contenedor de entidades (modelo, plancha o bloque)
  class Lienzo {
    constructor(dib, tipo, nombre) { this.dib = dib; this.tipo = tipo; this.nombre = nombre; this.ents = []; }
    _e(type, sub, pares, o = {}) {
      const head = [[8, o.capa || this.dib.capaActual || '0']];
      if (o.tipo) head.push([6, o.tipo]);
      if (o.color != null) head.push([62, o.color]);
      if (o.grosor != null) head.push([370, o.grosor]);
      if (o.escalaTipo != null) head.push([48, fmt(o.escalaTipo)]);
      const e = { type, head, sub, pares, extra: o._extra || null };
      this.ents.push(e); return e;
    }
    linea(a, b, o) { return this._e('LINE', 'AcDbLine', [[10, fmt(a[0])], [20, fmt(a[1])], [30, '0.0'], [11, fmt(b[0])], [21, fmt(b[1])], [31, '0.0']], o); }
    circulo(c, r, o) { return this._e('CIRCLE', 'AcDbCircle', [[10, fmt(c[0])], [20, fmt(c[1])], [30, '0.0'], [40, fmt(r)]], o); }
    /** arco en sentido antihorario de a0 a a1 (grados) */
    arco(c, r, a0, a1, o) { return this._e('ARC', 'AcDbCircle', [[10, fmt(c[0])], [20, fmt(c[1])], [30, '0.0'], [40, fmt(r)], [100, 'AcDbArc'], [50, fmt(a0)], [51, fmt(a1)]], o); }
    /** pts = [[x, y] | [x, y, comba]]; o.cerrada; o.ancho (ancho constante, mm) */
    polilinea(pts, o = {}) {
      const p = [[90, pts.length], [70, o.cerrada ? 1 : 0]];
      if (o.ancho) p.push([43, fmt(o.ancho)]);
      for (const q of pts) { p.push([10, fmt(q[0])], [20, fmt(q[1])]); if (q[2]) p.push([42, fmt(q[2])]); }
      return this._e('LWPOLYLINE', 'AcDbPolyline', p, o);
    }
    rect(x0, y0, x1, y1, o) { return this.polilinea([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { ...o, cerrada: true }); }
    /** relleno sólido (HATCH SOLID). contornos = [[ [x,y] | [x,y,comba] ... ], ...] cerrados */
    relleno(contornos, o = {}) {
      const p = [[10, '0.0'], [20, '0.0'], [30, '0.0'], [210, '0.0'], [220, '0.0'], [230, '1.0'], [2, 'SOLID'], [70, 1], [71, 0], [91, contornos.length]];
      contornos.forEach((pts, i) => {
        const comba = pts.some((q) => q[2]);
        p.push([92, i === 0 ? 3 : 2], [72, comba ? 1 : 0], [73, 1], [93, pts.length]);
        for (const q of pts) { p.push([10, fmt(q[0])], [20, fmt(q[1])]); if (comba) p.push([42, fmt(q[2] || 0)]); }
        p.push([97, 0]);
      });
      p.push([75, 0], [76, 1], [98, 0]);
      return this._e('HATCH', 'AcDbHatch', p, o);
    }
    /** círculo relleno (dos medias vueltas con comba 1) */
    circuloLleno(c, r, o) { return this.relleno([[[c[0] - r, c[1], 1], [c[0] + r, c[1], 1]]], o); }
    /** texto de una línea. just: I (izq., base) | C | D | MC (medio centro) | MI | MD | SI | SC | SD | II | IC | ID */
    texto(p, h, s, o = {}) { return this._e('TEXT', 'AcDbText', textoPares(p, h, s, o), o); }
    /** definición de atributo (solo dentro de un bloque) */
    atributo(tag, prompt, def, p, h, o = {}) {
      const tp = textoPares(p, h, def, o);
      const va = tp._va; delete tp._va;
      const e = this._e('ATTDEF', 'AcDbText', tp, o);
      e.post = [[100, 'AcDbAttributeDefinition'], [280, 0], [3, prompt], [2, tag], [70, o.invisible ? 1 : 0], ...(va ? [[74, va]] : [])];
      e.vaInText = false;
      return e;
    }
    /** inserta un bloque. o.escala (número o [sx, sy]), o.rot (grados), o.atributos = { TAG: 'valor' } */
    insertar(nombre, p, o = {}) {
      const [sx, sy] = Array.isArray(o.escala) ? o.escala : [o.escala || 1, o.escala || 1];
      const pr = [[2, nombre], [10, fmt(p[0])], [20, fmt(p[1])], [30, '0.0']];
      if (sx !== 1) pr.push([41, fmt(sx)]); if (sy !== 1) pr.push([42, fmt(sy)]); if (sx !== 1 || sy !== 1) pr.push([43, fmt(1)]);
      if (o.rot) pr.push([50, fmt(o.rot)]);
      const e = this._e('INSERT', 'AcDbBlockReference', pr, o);
      e.insert = { nombre, p, sx, sy, rot: o.rot || 0, atributos: o.atributos || null };
      return e;
    }
    /** ventana de plancha: centro y tamaño en el papel (mm); muestra el modelo centrado en cm con escala 1:esc (modelo en m → 1000/esc) */
    ventana(centro, ancho, alto, cm, mmPorUnidad) {
      const e = this._e('VIEWPORT', 'AcDbViewport', [], { capa: 'VIEWPORTS' });
      e.vp = { centro, ancho, alto, cm, alturaVista: alto / mmPorUnidad };
      return e;
    }
  }
  function textoPares(p, h, s, o) {
    const J = { I: [0, 0], C: [1, 0], D: [2, 0], M: [4, 0], SI: [0, 3], SC: [1, 3], SD: [2, 3], MI: [0, 2], MC: [1, 2], MD: [2, 2], II: [0, 1], IC: [1, 1], ID: [2, 1] };
    const [ha, va] = J[o.just || 'I'] || J.I;
    const pr = [[10, fmt(p[0])], [20, fmt(p[1])], [30, '0.0'], [40, fmt(h)], [1, s]];
    if (o.rot) pr.push([50, fmt(o.rot)]);
    pr.push([7, o.estilo || 'Standard']);
    if (ha) pr.push([72, ha]);
    if (ha || va) pr.push([11, fmt(p[0])], [21, fmt(p[1])], [31, '0.0']);
    pr._va = va;
    return pr;
  }

  // ---------------------------------------------------------------- el documento
  class Dibujo {
    constructor({ papel = [1000, 707], plancha = 'PLANO 01 DE 01', nombrePapel = null, unidades = 4 } = {}) {
      this.papel = papel; this.unidades = unidades; /* $INSUNITS del modelo (4 = mm, 6 = m) */ this.nombrePlancha = plancha; this.nombrePapel = nombrePapel || `${papel[0]} x ${papel[1]} mm`;
      this.capas = new Map([['0', { color: 7, tipo: 'Continuous', grosor: -3 }], ['Defpoints', { color: 7, tipo: 'Continuous', grosor: -3, noImprime: true }]]);
      this.tipos = new Map(); this.estilos = new Map([['Standard', FUENTE]]);
      this.bloques = new Map(); this.capaActual = '0';
      this.modelo = new Lienzo(this, 'modelo', '*Model_Space');
      this.plancha = new Lienzo(this, 'plancha', '*Paper_Space');
      this.limitesModelo = null;
    }
    capa(nombre, o = {}) { this.capas.set(nombre, { color: o.color ?? 7, tipo: o.tipo || 'Continuous', grosor: o.grosor ?? -3, noImprime: !!o.noImprime }); return this; }
    /** patrón en mm: positivo = trazo, negativo = espacio, 0 = punto */
    tipoLinea(nombre, desc, patron) { this.tipos.set(nombre, { desc, patron }); return this; }
    bloque(nombre, o = {}) {
      const b = new Lienzo(this, 'bloque', nombre); b.base = o.base || [0, 0]; b.desc = o.desc || '';
      this.bloques.set(nombre, b); return b;
    }

    toString() {
      const L = [];
      const g = (c, v) => { L.push(String(c).padStart(3, ' '), String(v)); };
      const all = (arr) => arr.forEach(([c, v]) => g(c, v));
      let seq = 0x20; const H = () => (seq++).toString(16).toUpperCase();
      const [PW, PH] = this.papel;
      // handles fijos
      const T = { VPORT: H(), LTYPE: H(), LAYER: H(), STYLE: H(), VIEW: H(), UCS: H(), APPID: H(), DIMSTYLE: H(), BLOCK_RECORD: H() };
      const root = H(), grp = H(), lay = H(), mls = H(), pset = H(), psn = H(), normal = H(), mlsStd = H(), loM = H(), loP = H();
      const brM = H(), brP = H();
      const bloques = [...this.bloques.values()].map((b) => ({ b, br: H(), beg: H(), end: H() }));
      const brDe = new Map(bloques.map((x) => [x.b.nombre.toUpperCase(), x.br]));
      // capa VIEWPORTS (no imprime) si hay ventanas
      if (this.plancha.ents.some((e) => e.type === 'VIEWPORT') && !this.capas.has('VIEWPORTS')) this.capa('VIEWPORTS', { color: 8, noImprime: true });
      // tipos de línea usados por capas o entidades que no existen → error temprano
      const tiposOK = new Set(['BYBLOCK', 'BYLAYER', 'CONTINUOUS', ...[...this.tipos.keys()].map((k) => k.toUpperCase())]);
      for (const [n, c] of this.capas) if (!tiposOK.has(c.tipo.toUpperCase())) throw new Error(`La capa ${n} usa el tipo ${c.tipo}, que no está definido`);

      // ---------------- HEADER
      g(0, 'SECTION'); g(2, 'HEADER');
      const v = (name, pairs) => { g(9, name); all(pairs); };
      const ext = this.limitesModelo || [0, 0, PW, PH];
      v('$ACADVER', [[1, 'AC1024']]); v('$ACADMAINTVER', [[70, 6]]); v('$DWGCODEPAGE', [[3, 'ANSI_1252']]);
      v('$INSBASE', [[10, '0.0'], [20, '0.0'], [30, '0.0']]);
      v('$EXTMIN', [[10, fmt(ext[0])], [20, fmt(ext[1])], [30, '0.0']]); v('$EXTMAX', [[10, fmt(ext[2])], [20, fmt(ext[3])], [30, '0.0']]);
      v('$LIMMIN', [[10, '0.0'], [20, '0.0']]); v('$LIMMAX', [[10, fmt(PW)], [20, fmt(PH)]]);
      v('$LTSCALE', [[40, '1.0']]); v('$ATTMODE', [[70, 1]]); v('$TEXTSIZE', [[40, '2.5']]); v('$TEXTSTYLE', [[7, 'Standard']]);
      v('$CLAYER', [[8, '0']]); v('$CELTYPE', [[6, 'ByLayer']]); v('$CECOLOR', [[62, 256]]); v('$CELTSCALE', [[40, '1.0']]);
      v('$DIMSTYLE', [[2, 'Standard']]); v('$LUNITS', [[70, 2]]); v('$LUPREC', [[70, 4]]); v('$AUNITS', [[70, 0]]); v('$AUPREC', [[70, 2]]);
      v('$MIRRTEXT', [[70, 0]]); v('$TILEMODE', [[70, 0]]); v('$PSLTSCALE', [[70, 1]]); v('$MEASUREMENT', [[70, 1]]);
      v('$CELWEIGHT', [[370, -1]]); v('$LWDISPLAY', [[290, 1]]); v('$INSUNITS', [[70, this.unidades]]); v('$PSTYLEMODE', [[290, 1]]);
      const seedPos = L.length; v('$HANDSEED', [[5, 'FFFF']]);
      g(0, 'ENDSEC');
      // ---------------- CLASSES
      g(0, 'SECTION'); g(2, 'CLASSES');
      for (const [a, b] of [['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault'], ['ACDBPLACEHOLDER', 'AcDbPlaceHolder'], ['LAYOUT', 'AcDbLayout']])
        all([[0, 'CLASS'], [1, a], [2, b], [3, 'ObjectDBX Classes'], [90, 0], [91, 0], [280, 0], [281, 0]]);
      g(0, 'ENDSEC');
      // ---------------- TABLES
      g(0, 'SECTION'); g(2, 'TABLES');
      const tabla = (name, recs, extra = []) => { all([[0, 'TABLE'], [2, name], [5, T[name]], [330, 0], [100, 'AcDbSymbolTable'], [70, recs.length], ...extra]); recs.forEach((r) => all(r)); g(0, 'ENDTAB'); };
      const sym = (type, sub, name, rest, flags = 0) => [[0, type], [5, H()], [330, T[type]], [100, 'AcDbSymbolTableRecord'], [100, sub], [2, name], [70, flags], ...rest];
      tabla('VPORT', [sym('VPORT', 'AcDbViewportTableRecord', '*Active', [[10, '0.0'], [20, '0.0'], [11, '1.0'], [21, '1.0'],
        [12, fmt((ext[0] + ext[2]) / 2)], [22, fmt((ext[1] + ext[3]) / 2)], [13, '0.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'], [15, '10.0'], [25, '10.0'],
        [16, '0.0'], [26, '0.0'], [36, '1.0'], [17, '0.0'], [27, '0.0'], [37, '0.0'], [40, fmt(Math.max(ext[3] - ext[1], 1) * 1.1)], [41, '1.5'], [42, '50.0'],
        [43, '0.0'], [44, '0.0'], [50, '0.0'], [51, '0.0'], [71, 0], [72, 1000], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0], [281, 0], [65, 1], [146, '0.0']])]);
      const lt = (name, desc, pat) => {
        const tot = pat.reduce((a, b) => a + Math.abs(b), 0);
        return sym('LTYPE', 'AcDbLinetypeTableRecord', name, [[3, desc], [72, 65], [73, pat.length], [40, fmt(tot)], ...pat.flatMap((x) => [[49, fmt(x)], [74, 0]])]);
      };
      tabla('LTYPE', [lt('ByBlock', '', []), lt('ByLayer', '', []), lt('Continuous', 'Solid line', []), ...[...this.tipos].map(([n, t]) => lt(n, t.desc, t.patron))]);
      tabla('LAYER', [...this.capas].map(([n, c]) => sym('LAYER', 'AcDbLayerTableRecord', n, [[62, c.color], [6, c.tipo], ...(c.noImprime ? [[290, 0]] : []), [370, c.grosor], [390, normal]])));
      tabla('STYLE', [...this.estilos].map(([n, f]) => sym('STYLE', 'AcDbTextStyleTableRecord', n, [[40, '0.0'], [41, '1.0'], [50, '0.0'], [71, 0], [42, '2.5'], [3, f], [4, ''],
        [1001, 'ACAD'], [1000, 'Liberation Sans'], [1071, 0]])));
      tabla('VIEW', []); tabla('UCS', []);
      tabla('APPID', [sym('APPID', 'AcDbRegAppTableRecord', 'ACAD', [])]);
      const stH = null;
      tabla('DIMSTYLE', [[[0, 'DIMSTYLE'], [105, H()], [330, T.DIMSTYLE], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbDimStyleTableRecord'], [2, 'Standard'], [70, 0],
        [41, '2.5'], [42, '0.625'], [43, '3.75'], [44, '1.25'], [140, '2.5'], [141, '2.5'], [147, '0.625'], [77, 1], [78, 8], [271, 2], [272, 2], [278, 44]]], [[100, 'AcDbDimStyleTable']]);
      void stH;
      const br = (h, name, layout) => [[0, 'BLOCK_RECORD'], [5, h], [330, T.BLOCK_RECORD], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbBlockTableRecord'], [2, name], [340, layout], [70, 0], [280, 1], [281, 0]];
      tabla('BLOCK_RECORD', [br(brM, '*Model_Space', loM), br(brP, '*Paper_Space', loP), ...bloques.map((x) => br(x.br, x.b.nombre, 0))]);
      g(0, 'ENDSEC');

      // ---------------- entidades
      const vpSeq = { n: 1 };
      const escribir = (e, owner, paper) => {
        const h = H();
        all([[0, e.type], [5, h], [330, owner], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), ...e.head]);
        if (e.type === 'VIEWPORT') {
          const { centro, ancho, alto, cm, alturaVista } = e.vp; const id = ++vpSeq.n;
          all([[100, 'AcDbViewport'], [10, fmt(centro[0])], [20, fmt(centro[1])], [30, '0.0'], [40, fmt(ancho)], [41, fmt(alto)], [68, id], [69, id],
            [12, fmt(cm[0])], [22, fmt(cm[1])], [13, '0.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'], [15, '10.0'], [25, '10.0'],
            [16, '0.0'], [26, '0.0'], [36, '1.0'], [17, '0.0'], [27, '0.0'], [37, '0.0'], [42, '50.0'], [43, '0.0'], [44, '0.0'], [45, fmt(alturaVista)],
            [50, '0.0'], [51, '0.0'], [72, 1000], [90, 819232], [1, ''], [281, 0], [71, 1], [74, 0], [110, '0.0'], [120, '0.0'], [130, '0.0'],
            [111, '1.0'], [121, '0.0'], [131, '0.0'], [112, '0.0'], [122, '1.0'], [132, '0.0'], [79, 0], [146, '0.0'], [170, 0], [61, 5]]);
          return;
        }
        g(100, e.sub);
        if (e.type === 'TEXT' || e.type === 'ATTDEF') {
          const va = e.pares._va; all(e.pares);
          if (e.type === 'TEXT') { g(100, 'AcDbText'); if (va) g(73, va); }
          if (e.post) all(e.post);
          return;
        }
        if (e.type === 'INSERT') {
          const ins = e.insert; const bl = this.bloques.get(ins.nombre);
          const defs = bl ? bl.ents.filter((x) => x.type === 'ATTDEF') : [];
          if (defs.length) g(66, 1);
          all(e.pares);
          if (!defs.length) return;
          const c = Math.cos(ins.rot * Math.PI / 180), s = Math.sin(ins.rot * Math.PI / 180);
          const tr = (x, y) => { const X = (x - bl.base[0]) * ins.sx, Y = (y - bl.base[1]) * ins.sy; return [ins.p[0] + X * c - Y * s, ins.p[1] + X * s + Y * c]; };
          for (const d of defs) {
            const get = (k) => { const q = d.pares.find(([cc]) => cc === k); return q ? q[1] : undefined; };
            const tag = d.post.find(([cc]) => cc === 2)[1];
            const val = ins.atributos && ins.atributos[tag] != null ? String(ins.atributos[tag]) : get(1);
            const p0 = tr(+get(10), +get(20)); const p1 = get(11) !== undefined ? tr(+get(11), +get(21)) : null;
            const ha = get(72), va = (d.post.find(([cc]) => cc === 74) || [])[1];
            all([[0, 'ATTRIB'], [5, H()], [330, h], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), ...d.head, [100, 'AcDbText'],
              [10, fmt(p0[0])], [20, fmt(p0[1])], [30, '0.0'], [40, fmt(+get(40) * Math.abs(ins.sy))], [1, val],
              ...((+get(50) || 0) + ins.rot ? [[50, fmt((+get(50) || 0) + ins.rot)]] : []), [7, get(7) || 'Standard'],
              ...(ha ? [[72, ha]] : []), ...(p1 ? [[11, fmt(p1[0])], [21, fmt(p1[1])], [31, '0.0']] : []),
              [100, 'AcDbAttribute'], [280, 0], [2, tag], [70, (d.post.find(([cc]) => cc === 70) || [0, 0])[1]], ...(va ? [[74, va]] : [])]);
          }
          all([[0, 'SEQEND'], [5, H()], [330, h], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, e.head[0][1]]]);
          return;
        }
        all(e.pares);
      };

      // ---------------- BLOCKS
      g(0, 'SECTION'); g(2, 'BLOCKS');
      const blk = (beg, end, owner, name, paper, base, flags, desc, ents) => {
        all([[0, 'BLOCK'], [5, beg], [330, owner], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, '0'], [100, 'AcDbBlockBegin'], [2, name], [70, flags],
          [10, fmt(base[0])], [20, fmt(base[1])], [30, '0.0'], [3, name], [1, ''], ...(desc ? [[4, desc]] : [])]);
        for (const e of ents || []) escribir(e, owner, false);
        all([[0, 'ENDBLK'], [5, end], [330, owner], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, '0'], [100, 'AcDbBlockEnd']]);
      };
      blk(H(), H(), brM, '*Model_Space', false, [0, 0], 0);
      blk(H(), H(), brP, '*Paper_Space', true, [0, 0], 0);
      for (const x of bloques) blk(x.beg, x.end, x.br, x.b.nombre, false, x.b.base, x.b.ents.some((e) => e.type === 'ATTDEF') ? 2 : 0, x.b.desc, x.b.ents);
      g(0, 'ENDSEC');
      // ---------------- ENTITIES (modelo y plancha)
      g(0, 'SECTION'); g(2, 'ENTITIES');
      for (const e of this.modelo.ents) escribir(e, brM, false);
      // ventana general de la plancha (ID 1), como la crea cualquier CAD
      const hv = H();
      all([[0, 'VIEWPORT'], [5, hv], [330, brP], [100, 'AcDbEntity'], [67, 1], [8, '0'], [100, 'AcDbViewport'], [10, fmt(PW / 2)], [20, fmt(PH / 2)], [30, '0.0'],
        [40, fmt(PW * 1.05)], [41, fmt(PH * 1.05)], [68, 1], [69, 1], [12, fmt(PW / 2)], [22, fmt(PH / 2)], [13, '0.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'],
        [15, '10.0'], [25, '10.0'], [16, '0.0'], [26, '0.0'], [36, '1.0'], [17, '0.0'], [27, '0.0'], [37, '0.0'], [42, '50.0'], [43, '0.0'], [44, '0.0'],
        [45, fmt(PH * 1.05)], [50, '0.0'], [51, '0.0'], [72, 1000], [90, 557056], [1, ''], [281, 0], [71, 1], [74, 0], [110, '0.0'], [120, '0.0'], [130, '0.0'],
        [111, '1.0'], [121, '0.0'], [131, '0.0'], [112, '0.0'], [122, '1.0'], [132, '0.0'], [79, 0], [146, '0.0'], [170, 0], [61, 5]]);
      for (const e of this.plancha.ents) escribir(e, brP, true);
      g(0, 'ENDSEC');
      // ---------------- OBJECTS
      g(0, 'SECTION'); g(2, 'OBJECTS');
      const dict = (h, owner, items) => all([[0, 'DICTIONARY'], [5, h], [330, owner], [100, 'AcDbDictionary'], [281, 1], ...items.flatMap(([n, x]) => [[3, n], [350, x]])]);
      dict(root, 0, [['ACAD_GROUP', grp], ['ACAD_LAYOUT', lay], ['ACAD_MLINESTYLE', mls], ['ACAD_PLOTSETTINGS', pset], ['ACAD_PLOTSTYLENAME', psn]]);
      dict(grp, root, []);
      dict(lay, root, [['Model', loM], [this.nombrePlancha, loP]]);
      dict(mls, root, [['Standard', mlsStd]]);
      dict(pset, root, []);
      all([[0, 'ACDBDICTIONARYWDFLT'], [5, psn], [330, root], [100, 'AcDbDictionary'], [281, 1], [3, 'Normal'], [350, normal], [100, 'AcDbDictionaryWithDefault'], [340, normal]]);
      all([[0, 'ACDBPLACEHOLDER'], [5, normal], [330, psn]]);
      const layout = (h, name, flags, tab, owner, plotFlags, w, hh) => all([[0, 'LAYOUT'], [5, h], [330, lay], [100, 'AcDbPlotSettings'], [1, ''], [2, 'none_device'], [4, this.nombrePapel], [6, ''],
        [40, '0.0'], [41, '0.0'], [42, '0.0'], [43, '0.0'], [44, fmt(w)], [45, fmt(hh)], [46, '0.0'], [47, '0.0'], [48, '0.0'], [49, '0.0'], [140, '0.0'], [141, '0.0'],
        [142, '1.0'], [143, '1.0'], [70, plotFlags], [72, 1], [73, 0], [74, 5], [7, 'monochrome.ctb'], [75, 16], [76, 0], [77, 2], [78, 300], [147, '1.0'], [148, '0.0'], [149, '0.0'],
        [100, 'AcDbLayout'], [1, name], [70, flags], [71, tab], [10, '0.0'], [20, '0.0'], [11, fmt(w)], [21, fmt(hh)], [12, '0.0'], [22, '0.0'], [32, '0.0'],
        [14, '0.0'], [24, '0.0'], [34, '0.0'], [15, fmt(w)], [25, fmt(hh)], [35, '0.0'], [146, '0.0'], [13, '0.0'], [23, '0.0'], [33, '0.0'],
        [16, '1.0'], [26, '0.0'], [36, '0.0'], [17, '0.0'], [27, '1.0'], [37, '0.0'], [76, 1], [330, owner]]);
      layout(loM, 'Model', 1, 0, brM, 1024, PW, PH);
      layout(loP, this.nombrePlancha, 1, 1, brP, 688, PW, PH);
      all([[0, 'MLINESTYLE'], [5, mlsStd], [330, mls], [100, 'AcDbMlineStyle'], [2, 'Standard'], [70, 0], [3, ''], [62, 256], [51, '90.0'], [52, '90.0'], [71, 2],
        [49, '0.5'], [62, 256], [6, 'BYLAYER'], [49, '-0.5'], [62, 256], [6, 'BYLAYER']]);
      g(0, 'ENDSEC');
      g(0, 'EOF');
      L[seedPos + 3] = H(); // $HANDSEED = siguiente handle libre
      return L.join('\n') + '\n';
    }
  }

  return { Dibujo, Lienzo, fmt };
})();
if (typeof module !== 'undefined') module.exports = DXFGen; else self.DXFGen = DXFGen;
