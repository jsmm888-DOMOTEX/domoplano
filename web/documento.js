// Domoplano — documento propio (hito H1): plano NUEVO, capas, tipos de línea, estilos de texto, propiedades de objetos,
// editar texto, REVISION (auditoría) y LIMPIA.
// Código propio escrito a partir de la referencia pública del formato DXF. Sin código ni archivos de Autodesk:
// los tipos de línea y la plantilla son nuestros; la letra es Liberation Sans (libre, licencia OFL).
const Documento = (() => {
  const FUENTE = 'LiberationSans-Regular.ttf';
  const PROHIBIDOS = /[<>\/\\":;?*|=`]/;

  // ---------------------------------------------------------------- colores y grosores
  const COLORES = { ROJO: 1, AMARILLO: 2, VERDE: 3, CIAN: 4, AZUL: 5, MAGENTA: 6, BLANCO: 7, NEGRO: 7, GRIS: 8, 'GRIS CLARO': 9,
    RED: 1, YELLOW: 2, GREEN: 3, CYAN: 4, BLUE: 5, WHITE: 7, PORCAPA: 256, BYLAYER: 256, PORBLOQUE: 0, BYBLOCK: 0 };
  const NOMBRE_COLOR = { 0: 'PorBloque', 1: 'Rojo', 2: 'Amarillo', 3: 'Verde', 4: 'Cian', 5: 'Azul', 6: 'Magenta', 7: 'Blanco/negro', 8: 'Gris', 9: 'Gris claro', 256: 'PorCapa' };
  /** Color escrito por el usuario → número ACI (0–256) o null. */
  function parseColor(t) {
    const s = String(t).trim().toUpperCase().replace(/\s+/g, ' ');
    if (s in COLORES) return COLORES[s];
    const n = parseInt(s, 10);
    return /^\d+$/.test(s) && n >= 0 && n <= 256 ? n : null;
  }
  const nombreColor = (c) => NOMBRE_COLOR[c] || `Color ${c}`;
  const GROSORES = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
  /** Grosor escrito en mm (0,25) o palabra → valor DXF (centésimas de mm; -1 PorCapa, -2 PorBloque, -3 Predeterminado) o null. */
  function parseGrosor(t) {
    const s = String(t).trim().toUpperCase();
    if (['PORCAPA', 'BYLAYER'].includes(s)) return -1;
    if (['PORBLOQUE', 'BYBLOCK'].includes(s)) return -2;
    if (['PREDETERMINADO', 'DEFAULT', 'DEF'].includes(s)) return -3;
    const mm = parseFloat(s.replace(',', '.'));
    if (!Number.isFinite(mm) || mm < 0) return null;
    const v = Math.round(mm * 100);
    return GROSORES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 0);
  }
  const nombreGrosor = (v) => (v === -1 ? 'PorCapa' : v === -2 ? 'PorBloque' : v === -3 ? 'Predeterminado' : (v / 100).toFixed(2) + ' mm');

  // Tipos de línea propios de Domoplano (medidas en unidades del dibujo; se ajustan con ESCALATL). No son los de AutoCAD.
  const TIPOS = {
    TRAZOS: { desc: 'Trazos __ __ __', pat: [6, -3] },
    CENTRO: { desc: 'Centro ____ _ ____ _', pat: [12, -3, 3, -3] },
    OCULTA: { desc: 'Oculta - - - -', pat: [3, -1.5] },
    PUNTOS: { desc: 'Puntos . . . .', pat: [0, -2] },
    TRAZOPUNTO: { desc: 'Trazo y punto __ . __ .', pat: [8, -2, 0, -2] },
    LINDERO: { desc: 'Lindero ____ __ ____', pat: [15, -2, 5, -2] },
  };

  const ALIAS_TIPO = [['TRAZOS', 'EPM_TRAZOS', 'DASHED', 'DISCONTINUA'], ['OCULTA', 'HIDDEN'], ['CENTRO', 'CENTER', 'EJE'], ['PUNTOS', 'DOT'], ['TRAZOPUNTO', 'DASHDOT']];
  const tipoPropio = (n) => (TIPOS[n] ? n : ((ALIAS_TIPO.find((x) => x.includes(n)) || []).find((k) => TIPOS[k]) || null));

  // ---------------------------------------------------------------- utilidades de pares
  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
  const fmt = (v) => Edit.fmt(v);
  // Orden de los códigos comunes de entidad (sub-clase AcDbEntity) y de registro de capa, para insertar donde va
  const ORDEN_ENT = [67, 410, 8, 6, 347, 62, 420, 430, 440, 390, 370, 48, 60];
  const ORDEN_CAPA = [2, 70, 62, 420, 6, 290, 370, 390, 347];
  const ORDEN_ESTILO = [2, 70, 40, 41, 50, 71, 42, 3, 4];

  /** Zona de los códigos comunes: dentro de «100 AcDbEntity» hasta el siguiente 100 (o, en DXF R12, desde el inicio). */
  function zonaEntidad(p) {
    const a = p.findIndex((q) => q[0] === 100 && String(q[1]).trim() === 'AcDbEntity');
    if (a >= 0) { let b = a + 1; while (b < p.length && p[b][0] !== 100 && p[b][0] < 1000) b++; return [a + 1, b]; }
    let b = 0; const ok = new Set(ORDEN_ENT.concat([5, 102, 330, 360]));
    while (b < p.length && ok.has(p[b][0])) b++;
    return [0, b];
  }
  /** Zona de un registro de tabla: después del último marcador 100 hasta el XDATA. */
  function zonaTabla(p) {
    let a = 0; p.forEach((q, i) => { if (q[0] === 100) a = i + 1; });
    let b = p.findIndex((q, i) => i >= a && q[0] >= 1000); if (b < 0) b = p.length;
    return [a, b];
  }
  /** Copia de los pares con cambios {código: valor|null}; null quita el código. Lo nuevo se inserta en su orden. */
  function setCodes(pairs, cambios, orden, zona) {
    const p = pairs.map((q) => q.slice());
    for (const [k, v] of Object.entries(cambios)) {
      const code = +k;
      const [a, b] = zona(p);
      const i = p.findIndex((q, j) => j >= a && j < b && q[0] === code);
      if (v === null || v === undefined) { if (i >= 0) p.splice(i, 1); continue; }
      const sv = typeof v === 'number' ? Edit.val(code, v) : String(v);
      if (i >= 0) { p[i][1] = sv; continue; }
      const r = orden.indexOf(code);
      let at = b;
      for (let j = a; j < b; j++) { const rj = orden.indexOf(p[j][0]); if (rj > r) { at = j; break; } }
      p.splice(at, 0, [code, sv]);
    }
    return p;
  }

  // ---------------------------------------------------------------- PLANTILLA: plano nuevo (DXF R2010, mm, una plancha)
  /** Texto DXF de un plano en blanco: unidades mm, capas 0 y Defpoints, estilo Standard con Liberation Sans y la plancha «Plancha 1» (A3). */
  function nuevo({ plancha = 'Plancha 1', papel = [420, 297] } = {}) {
    const L = [];
    const g = (c, v) => { L.push(String(c).padStart(3, ' '), String(v)); };
    const all = (arr) => arr.forEach(([c, v]) => g(c, v));
    const [PW, PH] = papel;
    // handles fijos de la plantilla
    const H = { LAYER: '1', LTYPE: '2', APPID: '3', DIMSTYLE: '4', STYLE: '5', UCS: '6', VIEW: '7', VPORT: '8', BLOCK_RECORD: '9',
      root: 'A', grp: 'B', lay: 'C', mls: 'D', pset: 'E', psn: 'F', normal: '10', brM: '11', brP: '12', bM: '13', eM: '14', bP: '15', eP: '16',
      loM: '17', loP: '18', vp: '19', ltBB: '1A', ltBL: '1B', ltC: '1C', l0: '1D', lDef: '1E', st: '1F', app: '20', ds: '21', mlsStd: '22' };
    const SEED = '23';
    // HEADER
    g(0, 'SECTION'); g(2, 'HEADER');
    const v = (name, pairs) => { g(9, name); all(pairs); };
    v('$ACADVER', [[1, 'AC1024']]); v('$ACADMAINTVER', [[70, 6]]); v('$DWGCODEPAGE', [[3, 'ANSI_1252']]);
    v('$INSBASE', [[10, '0.0'], [20, '0.0'], [30, '0.0']]);
    v('$EXTMIN', [[10, '1e+20'], [20, '1e+20'], [30, '1e+20']]); v('$EXTMAX', [[10, '-1e+20'], [20, '-1e+20'], [30, '-1e+20']]);
    v('$LIMMIN', [[10, '0.0'], [20, '0.0']]); v('$LIMMAX', [[10, fmt(PW)], [20, fmt(PH)]]);
    v('$ORTHOMODE', [[70, 0]]); v('$LTSCALE', [[40, '1.0']]); v('$ATTMODE', [[70, 1]]); v('$TEXTSIZE', [[40, '2.5']]);
    v('$TEXTSTYLE', [[7, 'Standard']]); v('$CLAYER', [[8, '0']]); v('$CELTYPE', [[6, 'ByLayer']]); v('$CECOLOR', [[62, 256]]);
    v('$CELTSCALE', [[40, '1.0']]); v('$DIMSCALE', [[40, '1.0']]); v('$DIMSTYLE', [[2, 'Standard']]); v('$LUNITS', [[70, 2]]); v('$LUPREC', [[70, 4]]);
    v('$AUNITS', [[70, 0]]); v('$AUPREC', [[70, 2]]); v('$MIRRTEXT', [[70, 0]]); v('$PDMODE', [[70, 0]]); v('$PDSIZE', [[40, '0.0']]);
    v('$TILEMODE', [[70, 1]]); v('$HANDSEED', [[5, SEED]]); v('$PSLTSCALE', [[70, 1]]); v('$MEASUREMENT', [[70, 1]]);
    v('$CELWEIGHT', [[370, -1]]); v('$LWDISPLAY', [[290, 0]]); v('$INSUNITS', [[70, 4]]); v('$PSTYLEMODE', [[290, 1]]);
    g(0, 'ENDSEC');
    // CLASSES
    g(0, 'SECTION'); g(2, 'CLASSES');
    for (const [a, b] of [['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault'], ['ACDBPLACEHOLDER', 'AcDbPlaceHolder'], ['LAYOUT', 'AcDbLayout']])
      all([[0, 'CLASS'], [1, a], [2, b], [3, 'ObjectDBX Classes'], [90, 0], [91, 0], [280, 0], [281, 0]]);
    g(0, 'ENDSEC');
    // TABLES
    g(0, 'SECTION'); g(2, 'TABLES');
    const tabla = (name, n, recs, extra = []) => {
      all([[0, 'TABLE'], [2, name], [5, H[name]], [330, 0], [100, 'AcDbSymbolTable'], [70, n], ...extra]);
      recs.forEach((r) => all(r));
      g(0, 'ENDTAB');
    };
    const sym = (type, h, sub, name, rest) => [[0, type], [5, h], [330, H[type]], [100, 'AcDbSymbolTableRecord'], [100, sub], [2, name], [70, 0], ...rest];
    tabla('VPORT', 1, [sym('VPORT', H.vp, 'AcDbViewportTableRecord', '*Active', [[10, '0.0'], [20, '0.0'], [11, '1.0'], [21, '1.0'],
      [12, fmt(PW / 2)], [22, fmt(PH / 2)], [13, '0.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'], [15, '10.0'], [25, '10.0'], [16, '0.0'], [26, '0.0'], [36, '1.0'],
      [17, '0.0'], [27, '0.0'], [37, '0.0'], [40, fmt(PH)], [41, fmt(PW / PH)], [42, '50.0'], [43, '0.0'], [44, '0.0'], [50, '0.0'], [51, '0.0'],
      [71, 0], [72, 1000], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0], [281, 0], [65, 1], [146, '0.0']])]);
    const lt = (h, name) => sym('LTYPE', h, 'AcDbLinetypeTableRecord', name, [[3, name === 'Continuous' ? 'Solid line' : ''], [72, 65], [73, 0], [40, '0.0']]);
    tabla('LTYPE', 3, [lt(H.ltBB, 'ByBlock'), lt(H.ltBL, 'ByLayer'), lt(H.ltC, 'Continuous')]);
    const capa = (h, name, extra = []) => sym('LAYER', h, 'AcDbLayerTableRecord', name, [[62, 7], [6, 'Continuous'], ...extra, [370, -3], [390, H.normal]]);
    tabla('LAYER', 2, [capa(H.l0, '0'), capa(H.lDef, 'Defpoints', [[290, 0]])]);
    tabla('STYLE', 1, [sym('STYLE', H.st, 'AcDbTextStyleTableRecord', 'Standard', [[40, '0.0'], [41, '1.0'], [50, '0.0'], [71, 0], [42, '2.5'], [3, FUENTE], [4, ''],
      [1001, 'ACAD'], [1000, 'Liberation Sans'], [1071, 0]])]);
    tabla('VIEW', 0, []); tabla('UCS', 0, []);
    tabla('APPID', 1, [sym('APPID', H.app, 'AcDbRegAppTableRecord', 'ACAD', [])]);
    tabla('DIMSTYLE', 1, [[[0, 'DIMSTYLE'], [105, H.ds], [330, H.DIMSTYLE], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbDimStyleTableRecord'], [2, 'Standard'], [70, 0],
      [41, '2.5'], [42, '0.625'], [43, '3.75'], [44, '1.25'], [140, '2.5'], [141, '2.5'], [147, '0.625'], [77, 1], [78, 8], [271, 2], [272, 2], [278, 44], [340, H.st]]],
    [[100, 'AcDbDimStyleTable']]);
    const br = (h, name, layout) => sym('BLOCK_RECORD', h, 'AcDbBlockTableRecord', name, [[340, layout], [280, 1], [281, 0]]);
    tabla('BLOCK_RECORD', 2, [br(H.brM, '*Model_Space', H.loM), br(H.brP, '*Paper_Space', H.loP)]);
    g(0, 'ENDSEC');
    // BLOCKS
    g(0, 'SECTION'); g(2, 'BLOCKS');
    const blk = (b, e, owner, name, paper) => {
      all([[0, 'BLOCK'], [5, b], [330, owner], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, '0'], [100, 'AcDbBlockBegin'], [2, name], [70, 0],
        [10, '0.0'], [20, '0.0'], [30, '0.0'], [3, name], [1, '']]);
      all([[0, 'ENDBLK'], [5, e], [330, owner], [100, 'AcDbEntity'], ...(paper ? [[67, 1]] : []), [8, '0'], [100, 'AcDbBlockEnd']]);
    };
    blk(H.bM, H.eM, H.brM, '*Model_Space', false); blk(H.bP, H.eP, H.brP, '*Paper_Space', true);
    g(0, 'ENDSEC');
    // ENTITIES (vacío)
    g(0, 'SECTION'); g(2, 'ENTITIES'); g(0, 'ENDSEC');
    // OBJECTS
    g(0, 'SECTION'); g(2, 'OBJECTS');
    const dict = (h, owner, items, cls = 'AcDbDictionary') => all([[0, cls === 'AcDbDictionary' ? 'DICTIONARY' : cls], [5, h], [330, owner], [100, 'AcDbDictionary'], [281, 1], ...items.flatMap(([n, x]) => [[3, n], [350, x]])]);
    dict(H.root, 0, [['ACAD_GROUP', H.grp], ['ACAD_LAYOUT', H.lay], ['ACAD_MLINESTYLE', H.mls], ['ACAD_PLOTSETTINGS', H.pset], ['ACAD_PLOTSTYLENAME', H.psn]]);
    dict(H.grp, H.root, []);
    dict(H.lay, H.root, [['Model', H.loM], [plancha, H.loP]]);
    dict(H.mls, H.root, [['Standard', H.mlsStd]]);
    dict(H.pset, H.root, []);
    all([[0, 'ACDBDICTIONARYWDFLT'], [5, H.psn], [330, H.root], [100, 'AcDbDictionary'], [281, 1], [3, 'Normal'], [350, H.normal], [100, 'AcDbDictionaryWithDefault'], [340, H.normal]]);
    all([[0, 'ACDBPLACEHOLDER'], [5, H.normal], [330, H.psn]]);
    const layout = (h, name, flags, tab, owner, plotFlags) => all([[0, 'LAYOUT'], [5, h], [330, H.lay], [100, 'AcDbPlotSettings'], [1, ''], [2, 'none_device'], [4, `A3 ${PW}x${PH} mm`], [6, ''],
      [40, '0.0'], [41, '0.0'], [42, '0.0'], [43, '0.0'], [44, fmt(PW)], [45, fmt(PH)], [46, '0.0'], [47, '0.0'], [48, '0.0'], [49, '0.0'], [140, '0.0'], [141, '0.0'],
      [142, '1.0'], [143, '1.0'], [70, plotFlags], [72, 1], [73, 0], [74, 5], [7, ''], [75, 16], [76, 0], [77, 2], [78, 300], [147, '1.0'], [148, '0.0'], [149, '0.0'],
      [100, 'AcDbLayout'], [1, name], [70, flags], [71, tab], [10, '0.0'], [20, '0.0'], [11, fmt(PW)], [21, fmt(PH)], [12, '0.0'], [22, '0.0'], [32, '0.0'],
      [14, '1e+20'], [24, '1e+20'], [34, '1e+20'], [15, '-1e+20'], [25, '-1e+20'], [35, '-1e+20'], [146, '0.0'], [13, '0.0'], [23, '0.0'], [33, '0.0'],
      [16, '1.0'], [26, '0.0'], [36, '0.0'], [17, '0.0'], [27, '1.0'], [37, '0.0'], [76, 1], [330, owner]]);
    layout(H.loM, 'Model', 1, 0, H.brM, 1024);
    layout(H.loP, plancha, 1, 1, H.brP, 0);
    all([[0, 'MLINESTYLE'], [5, H.mlsStd], [330, H.mls], [100, 'AcDbMlineStyle'], [2, 'Standard'], [70, 0], [3, ''], [62, 256], [51, '90.0'], [52, '90.0'], [71, 2],
      [49, '0.5'], [62, 256], [6, 'BYLAYER'], [49, '-0.5'], [62, 256], [6, 'BYLAYER']]);
    g(0, 'ENDSEC');
    g(0, 'EOF');
    return L.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- TEXTO justificado
  // Opciones de justificación (como la ayuda de AutoCAD en español): código 72 (horizontal) y 73 (vertical)
  const JUST = { I: [0, 0], C: [1, 0], D: [2, 0], M: [4, 0], SI: [0, 3], SC: [1, 3], SD: [2, 3], MI: [0, 2], MC: [1, 2], MD: [2, 2],
    II: [0, 1], IC: [1, 1], ID: [2, 1], A: [3, 0], AJ: [5, 0] };
  const NOMBRE_JUST = { I: 'Izquierda', C: 'Centro', D: 'Derecha', M: 'Medio', SI: 'Superior izquierda', SC: 'Superior centro', SD: 'Superior derecha',
    MI: 'Medio izquierda', MC: 'Medio centro', MD: 'Medio derecha', II: 'Inferior izquierda', IC: 'Inferior centro', ID: 'Inferior derecha', A: 'Alinear', AJ: 'Ajustar' };
  /** Pares de un TEXT nuevo (desde el código 10) para Session.add. p = punto; p2 = segundo punto (Alinear/Ajustar). */
  function textoPares(p, h, rot, str, { just = 'I', style = null, p2 = null } = {}) {
    const [ha, va] = JUST[just] || JUST.I;
    let a = p, b = p;
    if ((just === 'A' || just === 'AJ') && p2) { a = p; b = p2; rot = Math.atan2(p2[1] - p[1], p2[0] - p[0]) * 180 / Math.PI; }
    const body = [[10, a[0]], [20, a[1]], [30, 0], [40, h], [1, str]];
    if (rot) body.push([50, rot]);
    if (style) body.push([7, style]);
    if (ha) body.push([72, ha]);
    if (ha || va) body.push([11, b[0]], [21, b[1]], [31, 0]);
    if (va) body.push([73, va]);
    return body;
  }

  // ---------------------------------------------------------------- operaciones sobre la sesión de edición
  const S = Edit.Session.prototype;
  S.tbl = function (name) { return this.D.tables[name] || null; };
  S.tblRecs = function (name) { const t = this.tbl(name); return t ? t.recs.filter((r) => !r.deleted) : []; };
  S.findRec = function (table, name) {
    const n = up(name); const recs = this.tblRecs(table);
    const r = recs.find((q) => up(q.get(2, '')) === n);
    if (r || table !== 'LTYPE') return r || null;
    // H6-A M-6: nombres equivalentes de tipo de línea (TRAZOS de un plano nuevo = EPM_TRAZOS de la plantilla = DASHED…)
    const g = ALIAS_TIPO.find((x) => x.includes(n)); if (!g) return null;
    return recs.find((q) => g.includes(up(q.get(2, '')))) || null;
  };
  S.r12 = function () { return !this.useHandles; };
  /** Cabecera común de un registro de tabla nuevo. */
  S.symHead = function (table, sub) {
    if (this.r12()) return [];
    const t = this.tbl(table);
    return [[5, this.newHandle()], [330, (t.head.get(5, '0') || '0').trim()], [100, 'AcDbSymbolTableRecord'], [100, sub]];
  };
  /** Todas las entidades vivas (modelo, planchas y bloques). */
  S.allEnts = function () {
    const out = this.D.entities.filter((r) => !r.deleted);
    for (const b of this.D.blocks.values()) if (!b.deleted) for (const r of b.ents) if (!r.deleted) out.push(r);
    return out;
  };

  // ---- CAPAS
  S.capaActual = function () { return this.hdrGet('$CLAYER', 8, '0'); };
  S.capas = function () {
    const cur = up(this.capaActual());
    return [...this.D.layers.values()].map((l) => ({ name: l.name, color: l.color, off: l.off, frozen: l.frozen, locked: !!l.locked, ltype: l.ltype, lw: l.lw, plot: l.plot !== false, current: up(l.name) === cur }))
      .sort((a, b) => (a.name === '0' ? -1 : b.name === '0' ? 1 : a.name.localeCompare(b.name, 'es', { numeric: true })));
  };
  S.validName = function (name) {
    const n = String(name || '').trim();
    if (!n) return 'Escriba un nombre.';
    if (n.length > 255 || PROHIBIDOS.test(n)) return 'El nombre no puede llevar < > / \\ " : ; ? * | = `';
    return null;
  };
  /** Crea una capa. o = {color, ltype, lw, plot}. */
  S.crearCapa = function (name, o = {}) {
    name = String(name).trim();
    const err = this.validName(name); if (err) return { error: err };
    if (this.findRec('LAYER', name)) return { error: `Ya existe la capa «${name}».` };
    if (!this.tbl('LAYER')) return { error: 'Este DXF no tiene tabla de capas.' };
    const lt = o.ltype ? this.findRec('LTYPE', o.ltype) : null;
    if (o.ltype && !lt) return { error: `El tipo de línea «${o.ltype}» no está cargado (use TIPOLIN).` };
    const base0 = this.findRec('LAYER', '0');
    const p = [...this.symHead('LAYER', 'AcDbLayerTableRecord'), [2, name], [70, '0'], [62, String(o.color ?? 7)], [6, lt ? lt.get(2).trim() : 'Continuous']];
    if (o.plot === false) p.push([290, '0']);
    if (!this.r12()) {
      p.push([370, String(o.lw ?? -3)]);
      const ps = base0 && base0.get(390); if (ps) p.push([390, ps]);
    }
    const rec = this.tableRec('LAYER', 'LAYER', p);
    this.commit(`Crear capa ${name}`, { adds: [rec], tables: true });
    return { ok: true, rec };
  };
  /** Cambia propiedades de una capa: {color, ltype, lw, off, frozen, locked, plot}. */
  S.cambiarCapa = function (name, o) {
    const rec = this.findRec('LAYER', name); if (!rec) return { error: `No existe la capa «${name}».` };
    const isCur = up(name) === up(this.capaActual());
    if (o.frozen && isCur) return { error: 'No se puede inutilizar la capa actual.' };
    let color = rec.int(62, 7); const flags0 = rec.int(70, 0); let flags = flags0;
    const ch = {};
    if (o.color != null) { if (!(o.color >= 1 && o.color <= 255)) return { error: 'El color de una capa va de 1 a 255.' }; color = (color < 0 ? -1 : 1) * o.color; ch[420] = null; }
    if (o.off != null) color = (o.off ? -1 : 1) * Math.abs(color || 7);
    ch[62] = String(color);
    if (o.frozen != null) flags = o.frozen ? flags | 1 : flags & ~1;
    if (o.locked != null) flags = o.locked ? flags | 4 : flags & ~4;
    if (flags !== flags0) ch[70] = String(flags);
    if (o.ltype != null) { const lt = this.findRec('LTYPE', o.ltype); if (!lt) return { error: `El tipo de línea «${o.ltype}» no está cargado (use TIPOLIN).` }; ch[6] = lt.get(2).trim(); }
    if (o.lw != null && !this.r12()) ch[370] = String(o.lw);
    if (o.plot != null) ch[290] = o.plot ? null : '0';
    this.commit(`Capa ${name}`, { mods: [{ rec, pairs: setCodes(rec.p, ch, ORDEN_CAPA, zonaTabla) }], tables: true });
    return { ok: true };
  };
  S.capaActualA = function (name) {
    const rec = this.findRec('LAYER', name); if (!rec) return { error: `No existe la capa «${name}».` };
    const nm = rec.get(2).trim();
    if (rec.int(70) & 1) return { error: `La capa «${nm}» está inutilizada; reutilícela primero.` };
    this.commit(`Capa actual ${nm}`, { hdr: [{ name: '$CLAYER', code: 8, value: nm }] });
    return { ok: true, name: nm };
  };
  /** Renombra una capa y todo lo que la usa (entidades de modelo, planchas y bloques). */
  S.renombrarCapa = function (oldName, newName) {
    newName = String(newName).trim();
    const rec = this.findRec('LAYER', oldName); if (!rec) return { error: `No existe la capa «${oldName}».` };
    const old = rec.get(2).trim();
    if (old === '0' || up(old) === 'DEFPOINTS') return { error: `La capa «${old}» no se puede renombrar.` };
    const err = this.validName(newName); if (err) return { error: err };
    const other = this.findRec('LAYER', newName); if (other && other !== rec) return { error: `Ya existe la capa «${newName}».` };
    const mods = [{ rec, pairs: rec.p.map(([c, v]) => [c, c === 2 ? newName : v]) }];
    let n = 0;
    for (const e of this.allEnts()) if (e.p.some((q) => q[0] === 8 && up(q[1]) === up(old))) { mods.push({ rec: e, pairs: e.p.map(([c, v]) => [c, c === 8 && up(v) === up(old) ? newName : v]) }); n++; }
    const hdr = up(this.capaActual()) === up(old) ? [{ name: '$CLAYER', code: 8, value: newName }] : [];
    this.commit(`Renombrar capa ${old}`, { mods, hdr, tables: true });
    return { ok: true, n };
  };

  // ---- TIPOS DE LÍNEA
  S.tiposCargados = function () { return this.tblRecs('LTYPE').map((r) => r.get(2, '').trim()).filter((n) => !['BYBLOCK', 'BYLAYER'].includes(up(n))); };
  S.cargarTipo = function (name) {
    if (this.findRec('LTYPE', name)) return { ok: true, ya: true, name: this.findRec('LTYPE', name).get(2, '').trim() };
    const n = tipoPropio(up(name)), def = n && TIPOS[n];
    if (!def) return { error: `No conozco el tipo «${name}». Disponibles: ${Object.keys(TIPOS).join(', ')}.` };
    const p = [...this.symHead('LTYPE', 'AcDbLinetypeTableRecord'), [2, n], [70, '0'], [3, def.desc], [72, '65'], [73, String(def.pat.length)],
      [40, fmt(def.pat.reduce((a, b) => a + Math.abs(b), 0))]];
    for (const d of def.pat) { p.push([49, fmt(d)]); if (!this.r12()) p.push([74, '0']); }
    const rec = this.tableRec('LTYPE', 'LTYPE', p);
    if (!rec) return { error: 'Este DXF no tiene tabla de tipos de línea.' };
    this.commit(`Cargar tipo de línea ${n}`, { adds: [rec], tables: true });
    return { ok: true, name: n };
  };
  S.escalaTL = function (v) {
    if (!(v > 0)) return { error: 'La escala debe ser mayor que 0.' };
    this.commit(`ESCALATL ${v}`, { hdr: [{ name: '$LTSCALE', code: 40, value: fmt(v) }], tables: true });
    return { ok: true };
  };

  // ---- ESTILOS DE TEXTO
  S.estiloActual = function () { return this.hdrGet('$TEXTSTYLE', 7, 'Standard'); };
  S.estilos = function () { return this.tblRecs('STYLE').filter((r) => !(r.int(70) & 1) && r.get(2, '').trim()).map((r) => ({ name: r.get(2).trim(), font: (r.get(3, '') || '').trim(), height: r.num(40, 0), width: r.num(41, 1) })); };
  /** Crea o cambia un estilo: {font, height, width}. Por omisión Liberation Sans (libre). */
  S.estilo = function (name, o = {}) {
    name = String(name).trim();
    const err = this.validName(name); if (err) return { error: err };
    const rec = this.findRec('STYLE', name);
    const font = o.font || FUENTE;
    if (rec) {
      const ch = {}; if (o.font) ch[3] = o.font; if (o.height != null) ch[40] = fmt(o.height); if (o.width != null) ch[41] = fmt(o.width);
      this.commit(`Estilo ${name}`, { mods: [{ rec, pairs: setCodes(rec.p, ch, ORDEN_ESTILO, zonaTabla) }], tables: true });
      return { ok: true, nuevo: false };
    }
    const p = [...this.symHead('STYLE', 'AcDbTextStyleTableRecord'), [2, name], [70, '0'], [40, fmt(o.height || 0)], [41, fmt(o.width || 1)], [50, '0.0'], [71, '0'], [42, '2.5'], [3, font], [4, '']];
    const n = this.tableRec('STYLE', 'STYLE', p);
    if (!n) return { error: 'Este DXF no tiene tabla de estilos.' };
    this.commit(`Crear estilo ${name}`, { adds: [n], tables: true });
    return { ok: true, nuevo: true };
  };
  S.estiloActualA = function (name) {
    const rec = this.findRec('STYLE', name); if (!rec) return { error: `No existe el estilo «${name}».` };
    this.commit(`Estilo actual ${rec.get(2).trim()}`, { hdr: [{ name: '$TEXTSTYLE', code: 7, value: rec.get(2).trim() }] });
    return { ok: true };
  };

  // ---- PROPIEDADES de objetos
  /** Propiedades de una entidad: {layer, color, ltype, lw, ltscale}. */
  function propsDe(r) {
    return { layer: (r.get(8, '0') || '0').trim(), color: r.get(420) !== undefined ? 'RGB' : r.int(62, 256), ltype: (r.get(6, 'ByLayer') || 'ByLayer').trim(), lw: r.int(370, -1), ltscale: r.num(48, 1) };
  }
  /** Cambia propiedades de los objetos: o = {layer, color, ltype, lw, ltscale}. */
  S.cambiarProps = function (recs, o) {
    const ch = {};
    if (o.layer != null) { const L = this.findRec('LAYER', o.layer); if (!L) return { error: `No existe la capa «${o.layer}».` }; ch[8] = L.get(2).trim(); }
    if (o.color != null) { ch[62] = o.color === 256 ? null : String(o.color); ch[420] = null; ch[430] = null; }
    if (o.ltype != null) {
      const t = up(o.ltype);
      if (t === 'BYLAYER' || t === 'PORCAPA') ch[6] = null; else if (t === 'BYBLOCK' || t === 'PORBLOQUE') ch[6] = 'ByBlock';
      else { const lt = this.findRec('LTYPE', o.ltype); if (!lt) return { error: `El tipo de línea «${o.ltype}» no está cargado (use TIPOLIN).` }; ch[6] = lt.get(2).trim(); }
    }
    if (o.lw != null && !this.r12()) ch[370] = o.lw === -1 ? null : String(o.lw);
    if (o.ltscale != null) { if (!(o.ltscale > 0)) return { error: 'La escala de tipo de línea debe ser mayor que 0.' }; ch[48] = Math.abs(o.ltscale - 1) < 1e-12 ? null : fmt(o.ltscale); }
    const mods = [];
    for (const r of recs) {
      const group = r.type === 'POLYLINE' ? this.withSeq(r) : [r]; // los vértices van con su polilínea
      for (const q of group) { const np = setCodes(q.p, ch, ORDEN_ENT, zonaEntidad); if (JSON.stringify(np) !== JSON.stringify(q.p)) mods.push({ rec: q, pairs: np }); }
    }
    if (!mods.length) return { ok: true, n: 0 };
    this.commit(`Propiedades ${recs.length}`, { mods, tables: true });
    return { ok: true, n: recs.length };
  };
  /** IGUALARPROP: copia capa, color, tipo, grosor y escala de tipo de línea del objeto origen a los destinos. */
  S.igualarProps = function (src, recs) {
    const p = propsDe(src);
    return this.cambiarProps(recs.filter((r) => r !== src), { layer: p.layer, color: p.color === 'RGB' ? 256 : p.color, ltype: p.ltype, lw: p.lw, ltscale: p.ltscale });
  };

  // ---- EDITAR TEXTO
  const TEXTOS = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);
  const deU = (s) => String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  /** Texto (contenido) de un TEXT/MTEXT/ATTRIB/ATTDEF tal como se escribe en el DXF. */
  function textoDe(r) {
    if (r.type === 'MTEXT') { let s = ''; for (const [c, v] of r.p) { if (c === 101) break; if (c === 3) s += v; } return deU(s + (r.get(1, '') || '')); }
    return deU(r.get(1, '') || '');
  }
  /** Objetos de texto editables de un registro: el mismo (TEXT/MTEXT) o los atributos de un bloque. */
  S.textosDe = function (r) {
    if (TEXTOS.has(r.type)) return [r];
    if (r.type === 'INSERT' && r.int(66, 0) === 1) return this.withSeq(r).filter((q) => q.type === 'ATTRIB' && !q.deleted);
    return [];
  };
  S.textoDe = textoDe;
  /** Cambia el contenido de un texto. Para MTEXT se parte en trozos de 250 caracteres (códigos 3 … 1), como pide el formato. */
  S.editarTexto = function (r, nuevoTexto) {
    if (!TEXTOS.has(r.type)) return { error: 'Ese objeto no es un texto.' };
    const s = String(nuevoTexto);
    let p;
    if (r.type === 'MTEXT') {
      const cut = r.p.findIndex((q) => q[0] === 101);
      const head = cut >= 0 ? r.p.slice(0, cut) : r.p, tail = cut >= 0 ? r.p.slice(cut) : [];
      const at = head.findIndex((q) => q[0] === 3 || q[0] === 1);
      const rest = head.filter((q) => q[0] !== 3 && q[0] !== 1);
      const chunks = []; for (let i = 0; i < s.length; i += 250) chunks.push(s.slice(i, i + 250));
      if (!chunks.length) chunks.push('');
      const textPairs = chunks.map((c, i) => [i === chunks.length - 1 ? 1 : 3, c]);
      const k = at < 0 ? rest.length : head.slice(0, at).filter((q) => q[0] !== 3 && q[0] !== 1).length;
      p = [...rest.slice(0, k), ...textPairs, ...rest.slice(k), ...tail];
    } else {
      p = r.p.map((q) => q.slice()); const i = p.findIndex((q) => q[0] === 1);
      if (i >= 0) p[i][1] = s; else return { error: 'El texto no tiene contenido para editar.' };
    }
    this.commit('Editar texto', { mods: [{ rec: r, pairs: p }] });
    return { ok: true };
  };

  // ---- REVISION (auditoría propia)
  /** Revisa el dibujo. corregir = true arregla lo que se puede (como AUDIT con «Sí»). Devuelve {problemas:[texto], corregidos}. */
  S.revisar = function (corregir) {
    const out = []; let corregidos = 0;
    const capas = new Set(this.tblRecs('LAYER').map((r) => up(r.get(2))));
    const tipos = new Set(this.tblRecs('LTYPE').map((r) => up(r.get(2))));
    const estilos = new Set(this.tblRecs('STYLE').map((r) => up(r.get(2))));
    const bloques = new Set([...this.D.blocks.values()].filter((b) => !b.deleted).map((b) => up(b.name)));
    // 1) handles repetidos
    if (this.useHandles) {
      const seen = new Map(); let dup = 0;
      const all = [...this.allEnts(), ...Object.values(this.D.tables).flatMap((t) => t.recs.filter((r) => !r.deleted)),
        ...this.D.blockList.filter((b) => !b.deleted).flatMap((b) => [b.head, b.end].filter(Boolean))];
      for (const r of all) { const h = up(r.get(5, r.get(105, ''))); if (!h) continue; if (seen.has(h)) dup++; else seen.set(h, r); }
      if (dup) out.push(`${dup} identificador(es) (handle) repetido(s).`);
    }
    // 2) referencias a capas, tipos, estilos y bloques que no existen
    const faltaCapa = new Map(), mods = [];
    for (const e of this.allEnts()) {
      const ch = {};
      const l = (e.get(8) || '').trim(); if (l && !capas.has(up(l))) faltaCapa.set(up(l), l);
      const t = (e.get(6) || '').trim(); if (t && !tipos.has(up(t)) && !['BYLAYER', 'BYBLOCK'].includes(up(t))) { out.push(`${e.type} usa el tipo de línea «${t}», que no existe.`); ch[6] = null; }
      if (['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(e.type)) { const s = (e.get(7) || '').trim(); if (s && !estilos.has(up(s))) { out.push(`${e.type} usa el estilo «${s}», que no existe.`); ch[7] = estilos.has('STANDARD') ? 'Standard' : null; } }
      if (e.type === 'INSERT') { const b = (e.get(2) || '').trim(); if (!bloques.has(up(b))) out.push(`Bloque «${b}» insertado pero no definido (no se corrige solo).`); }
      if (Object.keys(ch).length) {
        let p = e.p.map((q) => q.slice());
        if (6 in ch) p = setCodes(p, { 6: null }, ORDEN_ENT, zonaEntidad);
        if (7 in ch) { const i = p.findIndex((q) => q[0] === 7); if (i >= 0) { if (ch[7]) p[i][1] = ch[7]; else p.splice(i, 1); } }
        mods.push({ rec: e, pairs: p });
      }
    }
    for (const r of this.tblRecs('LAYER')) { const t = (r.get(6) || '').trim(); if (t && !tipos.has(up(t))) { out.push(`La capa «${r.get(2).trim()}» usa el tipo «${t}», que no existe.`); mods.push({ rec: r, pairs: setCodes(r.p, { 6: 'Continuous' }, ORDEN_CAPA, zonaTabla) }); } }
    for (const l of faltaCapa.values()) out.push(`Hay objetos en la capa «${l}», que no existe en la tabla de capas.`);
    if (corregir && (mods.length || faltaCapa.size)) {
      const adds = [];
      for (const l of faltaCapa.values()) {
        const base0 = this.findRec('LAYER', '0');
        const p = [...this.symHead('LAYER', 'AcDbLayerTableRecord'), [2, l], [70, '0'], [62, '7'], [6, 'Continuous']];
        if (!this.r12()) { p.push([370, '-3']); const ps = base0 && base0.get(390); if (ps) p.push([390, ps]); }
        adds.push(this.tableRec('LAYER', 'LAYER', p));
      }
      this.commit('REVISION', { mods, adds: adds.filter(Boolean), tables: true });
      corregidos = mods.length + adds.length;
    }
    return { problemas: out, corregidos };
  };

  // ---- LIMPIA (quita capas, tipos de línea, estilos y bloques que nadie usa)
  /** Handles que se mencionan en otros registros u objetos (no se borra nada que otro objeto apunte). */
  S._referencias = function () {
    const refs = new Map(); // handle → Set de registros/zonas que lo nombran
    const isRef = (c) => (c >= 320 && c <= 369) || (c >= 390 && c <= 399) || c === 480 || c === 481 || c === 1005;
    const add = (h, who) => { const k = up(h); if (!k || k === '0') return; let s = refs.get(k); if (!s) refs.set(k, (s = new Set())); s.add(who); };
    const recs = [...this.allEnts(), ...Object.values(this.D.tables).flatMap((t) => t.recs.filter((r) => !r.deleted)),
      ...this.D.blockList.filter((b) => !b.deleted).flatMap((b) => [b.head, b.end].filter(Boolean))];
    for (const r of recs) for (const [c, v] of r.p) if (isRef(c)) add(v, r);
    // OBJECTS (diccionarios, presentaciones, estilos…): se leen tal cual del archivo
    const tk = this.D.tk, sec = this.D.sections.OBJECTS, nombres = new Set();
    if (sec) for (let i = sec[0]; i < sec[1]; i++) { const c = tk.codes[i]; if (isRef(c)) add(tk.vals[i], 'OBJECTS'); else if (c === 6 || c === 8) nombres.add(up(tk.vals[i])); }
    return { refs, nombres };
  };
  /** Qué se puede limpiar (sin cambiar nada). */
  S.limpiable = function () {
    const { refs, nombres } = this._referencias();
    const referida = (rec, propios) => { const h = up(rec.get(5, rec.get(105, ''))); const s = refs.get(h); if (!s) return false; for (const w of s) if (!propios || !propios.has(w)) return true; return false; };
    // bloques: se repite porque quitar uno puede dejar libre a otro anidado
    const quitar = new Set();
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      const usados = new Set();
      for (const e of this.D.entities) if (!e.deleted && (e.type === 'INSERT' || e.type === 'DIMENSION')) usados.add(up(e.get(2)));
      for (const b of this.D.blocks.values()) if (!b.deleted && !quitar.has(b)) for (const e of b.ents) if (!e.deleted && (e.type === 'INSERT' || e.type === 'DIMENSION')) usados.add(up(e.get(2)));
      let nuevo = false;
      for (const b of this.D.blocks.values()) {
        if (b.deleted || quitar.has(b) || !b.head || !b.end || b.name.startsWith('*') || (b.flags & (1 | 4 | 16 | 32)) || usados.has(up(b.name))) continue;
        const br = this.findRec('BLOCK_RECORD', b.name);
        const propios = new Set([b.head, b.end, ...b.ents, br]);
        if (referida(b.head, propios) || (br && referida(br, propios)) || (br && br.p.some((q) => q[0] === 102 || q[0] === 360))) continue;
        quitar.add(b); nuevo = true;
      }
      if (!nuevo) break;
    }
    const vivas = this.D.entities.filter((e) => !e.deleted);
    for (const b of this.D.blocks.values()) if (!b.deleted && !quitar.has(b)) for (const e of b.ents) if (!e.deleted) vivas.push(e);
    const usa = (code) => new Set(vivas.map((e) => up(e.get(code, ''))).filter(Boolean));
    const capasUsadas = usa(8), tiposUsados = usa(6), estilosUsados = new Set(vivas.filter((e) => TEXTOS.has(e.type)).map((e) => up(e.get(7, 'STANDARD'))));
    for (const b of this.D.blocks.values()) if (!b.deleted && !quitar.has(b) && b.head) capasUsadas.add(up(b.head.get(8, '0')));
    for (const r of this.tblRecs('LAYER')) tiposUsados.add(up(r.get(6, '')));
    const capas = this.tblRecs('LAYER').filter((r) => { const n = up(r.get(2)); return !['0', 'DEFPOINTS', up(this.capaActual())].includes(n) && !capasUsadas.has(n) && !nombres.has(n) && !referida(r) && !r.p.some((q) => q[0] === 102 || q[0] === 360); });
    const tipos = this.tblRecs('LTYPE').filter((r) => { const n = up(r.get(2)); return !['BYBLOCK', 'BYLAYER', 'CONTINUOUS', up(this.hdrGet('$CELTYPE', 6, ''))].includes(n) && !tiposUsados.has(n) && !nombres.has(n) && !referida(r); });
    const estilos = this.tblRecs('STYLE').filter((r) => { const n = up(r.get(2)); return n && n !== 'STANDARD' && n !== up(this.estiloActual()) && !(r.int(70) & 1) && !estilosUsados.has(n) && !referida(r) && !r.p.some((q) => q[0] === 102 || q[0] === 360); });
    return { capas, tipos, estilos, bloques: [...quitar] };
  };
  /** LIMPIA: quita todo lo no usado en una sola operación (se puede deshacer). */
  S.limpiar = function () {
    const L = this.limpiable();
    const brs = L.bloques.map((b) => this.findRec('BLOCK_RECORD', b.name)).filter(Boolean);
    const dels = [...L.capas, ...L.tipos, ...L.estilos, ...brs];
    const n = { capas: L.capas.length, tipos: L.tipos.length, estilos: L.estilos.length, bloques: L.bloques.length };
    if (!dels.length && !L.bloques.length) return { ok: true, n, nombres: [] };
    this.commit('LIMPIA', { dels, blocks: L.bloques, tables: true });
    return { ok: true, n, nombres: [...L.capas, ...L.tipos, ...L.estilos].map((r) => r.get(2).trim()).concat(L.bloques.map((b) => b.name)) };
  };

  // ---------------------------------------------------------------- GROSORES: tabla de grosores por capa (web/grosores_capas.js)
  /** Grosor (mm) que la tabla propone para una capa, o null. tabla = {capas: {NOMBRE: mm}, reglas: [[RegExp, mm]]}. */
  function grosorDeTabla(nombre, tabla) {
    if (!tabla) return null;
    const n = up(nombre);
    for (const [k, v] of Object.entries(tabla.capas || {})) if (up(k) === n) return v;
    for (const [re, v] of (tabla.reglas || [])) if (re.test(nombre)) return v;
    return null;
  }
  /** Pone a cada capa del plano el grosor de la tabla. soloSinGrosor: no toca las capas que ya tienen grosor propio. */
  S.aplicarGrosores = function (tabla, { soloSinGrosor = false } = {}) {
    if (this.r12()) return { error: 'Los grosores de línea necesitan DXF 2000 o posterior.' };
    const mods = [], hechos = [];
    for (const rec of this.tblRecs('LAYER')) {
      const nm = rec.get(2, '').trim();
      if (up(nm) === 'DEFPOINTS') continue;
      const mm = grosorDeTabla(nm, tabla); if (mm == null) continue;
      const v = parseGrosor(String(mm)); const cur = rec.int(370, -3);
      if ((soloSinGrosor && cur >= 0) || cur === v) continue;
      mods.push({ rec, pairs: setCodes(rec.p, { 370: String(v) }, ORDEN_CAPA, zonaTabla) }); hechos.push({ capa: nm, antes: cur, ahora: v });
    }
    if (mods.length) this.commit(`GROSORES ${mods.length} capa(s)`, { mods, tables: true });
    return { ok: true, n: mods.length, hechos };
  };

  // ---------------------------------------------------------------- IMAGEN (IMAGE + IMAGEDEF con ruta relativa)
  /** Tamaño en píxeles de un PNG o JPEG: {w, h, tipo} o null. */
  function tamanoImagen(d) {
    if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47)
      return { tipo: 'png', w: ((d[16] << 24) | (d[17] << 16) | (d[18] << 8) | d[19]) >>> 0, h: ((d[20] << 24) | (d[21] << 16) | (d[22] << 8) | d[23]) >>> 0 };
    if (d.length > 4 && d[0] === 0xff && d[1] === 0xd8) {
      for (let p = 2; p + 9 < d.length;) {
        if (d[p] !== 0xff) { p++; continue; }
        const mk = d[p + 1], len = (d[p + 2] << 8) | d[p + 3];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { tipo: 'jpg', h: (d[p + 5] << 8) | d[p + 6], w: (d[p + 7] << 8) | d[p + 8] };
        p += 2 + len;
      }
    }
    return null;
  }
  /** Registros de una sección (OBJECTS o CLASSES) leídos una vez, para poder agregar y cambiar objetos al guardar. */
  function seccion(D, name, key) {
    if (D[key]) return D[key];
    const sec = D.sections && D.sections[name]; const tk = D.tk; const list = [];
    if (sec) {
      let cur = null;
      for (let i = sec[0]; i < sec[1]; i++) {
        const c = tk.codes[i], v = tk.vals[i];
        if (c === 0) { if (cur) cur.L1 = tk.li[i]; cur = new DXF.Rec(String(v).trim(), []); cur.L0 = tk.li[i]; list.push(cur); }
        else if (cur) cur.p.push([c, v]);
      }
      if (cur) cur.L1 = tk.li[sec[1]];
      list.endLine = tk.li[sec[1]];
    }
    D[key] = list;
    return list;
  }
  const entrada = (dict, name) => {
    for (let i = 0; i < dict.p.length - 1; i++) if (dict.p[i][0] === 3 && up(dict.p[i][1]) === up(name) && (dict.p[i + 1][0] === 350 || dict.p[i + 1][0] === 360)) return String(dict.p[i + 1][1]).trim();
    return null;
  };
  const hnd = (r) => String(r.get(5, '') || '').trim().toUpperCase();
  /** Pares con un handle agregado al grupo {ACAD_REACTORS (o el grupo creado si no existe). */
  function conReactor(p, h, owner) {
    const out = p.map((q) => q.slice());
    const a = out.findIndex((q) => q[0] === 102 && String(q[1]).trim().toUpperCase() === '{ACAD_REACTORS');
    if (a >= 0) { let b = a + 1; while (b < out.length && !(out[b][0] === 102 && String(out[b][1]).trim() === '}')) b++; out.splice(b, 0, [330, h]); return out; }
    const k = out.findIndex((q) => q[0] === 5); out.splice(k + 1, 0, [102, '{ACAD_REACTORS'], [330, owner], [330, h], [102, '}']);
    return out;
  }
  /**
   * Inserta una imagen raster en la hoja actual. o = {archivo (ruta como se guarda: relativa al DXF), wpx, hpx (píxeles),
   * at [x, y] (esquina inferior izquierda), ancho (unidades del dibujo), rot (grados), capa}. Crea o reutiliza el IMAGEDEF
   * del mismo archivo, el diccionario ACAD_IMAGE_DICT y las clases que hacen falta. Un solo paso de deshacer.
   */
  S.insertarImagen = function (page, o) {
    if (this.r12()) return { error: 'Las imágenes necesitan DXF 2000 o posterior (este es R12).' };
    const D = this.D;
    if (!D.sections.OBJECTS) return { error: 'Este DXF no tiene sección OBJECTS: no se puede insertar la imagen.' };
    const archivo = String(o.archivo || '').trim(); if (!archivo) return { error: 'Falta el archivo de la imagen.' };
    if (!(o.wpx > 0 && o.hpx > 0)) return { error: 'No se pudo leer el tamaño de la imagen.' };
    if (!(o.ancho > 0)) return { error: 'El ancho debe ser mayor que 0.' };
    const objs = seccion(D, 'OBJECTS', 'objects');
    const clases = seccion(D, 'CLASSES', 'classes');
    const vivos = () => objs.filter((r) => !r.deleted);
    const porH = (h) => vivos().find((r) => hnd(r) === up(h));
    const adds = [], mods = [];
    const obj = (type, pairs) => { const r = new DXF.Rec(type, pairs); r.isNew = true; r.home = objs; r.insertLine = objs.endLine; adds.push(r); return r; };
    // clases (DXF 2000+): sin ellas AutoCAD no reconoce los objetos de imagen
    if (D.sections.CLASSES) {
      const v2004 = String(D.acadver || '') >= 'AC1018';
      const tiene = new Set(clases.filter((r) => !r.deleted).map((r) => up(r.get(1, ''))));
      for (const [n, cpp, flags, ent] of [['RASTERVARIABLES', 'AcDbRasterVariables', 0, 0], ['IMAGE', 'AcDbRasterImage', 2175, 1], ['IMAGEDEF', 'AcDbRasterImageDef', 0, 0], ['IMAGEDEF_REACTOR', 'AcDbRasterImageDefReactor', 1, 0]]) {
        if (tiene.has(n)) continue;
        const r = new DXF.Rec('CLASS', [[1, n], [2, cpp], [3, 'ISM'], [90, String(flags)], ...(v2004 ? [[91, '0']] : []), [280, '0'], [281, String(ent)]]);
        r.isNew = true; r.home = clases; r.insertLine = clases.endLine; adds.push(r);
      }
    }
    // diccionario raíz → ACAD_IMAGE_DICT y ACAD_IMAGE_VARS
    const root = vivos().find((r) => r.type === 'DICTIONARY');
    if (!root) return { error: 'No encontré el diccionario principal del DXF.' };
    const rootH = hnd(root);
    let rootP = root.p;
    let dictH = entrada(root, 'ACAD_IMAGE_DICT'); let dict = dictH ? porH(dictH) : null;
    if (!dict) {
      dictH = this.newHandle();
      dict = obj('DICTIONARY', [[5, dictH], [102, '{ACAD_REACTORS'], [330, rootH], [102, '}'], [330, rootH], [100, 'AcDbDictionary'], [281, '1']]);
      rootP = [...rootP, [3, 'ACAD_IMAGE_DICT'], [350, dictH]];
    }
    if (!entrada(root, 'ACAD_IMAGE_VARS')) {
      const h = this.newHandle();
      obj('RASTERVARIABLES', [[5, h], [102, '{ACAD_REACTORS'], [330, rootH], [102, '}'], [330, rootH], [100, 'AcDbRasterVariables'], [90, '0'], [70, '0'], [71, '1'], [72, '1']]);
      rootP = [...rootP, [3, 'ACAD_IMAGE_VARS'], [350, h]];
    }
    if (rootP !== root.p) mods.push({ rec: root, pairs: rootP });
    // IMAGEDEF del mismo archivo (se reutiliza) o uno nuevo
    const reactorH = this.newHandle();
    let def = null, dictP = dict.p;
    for (let i = 0; i < dict.p.length - 1; i++) if (dict.p[i][0] === 3) { const d = porH(String(dict.p[i + 1][1]).trim()); if (d && d.type === 'IMAGEDEF' && up(d.get(1, '')) === up(archivo)) { def = d; break; } }
    let defH;
    if (def) { defH = hnd(def); mods.push({ rec: def, pairs: conReactor(def.p, reactorH, dictH) }); }
    else {
      defH = this.newHandle();
      let nombre = archivo.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'IMAGEN';
      const usados = new Set(); for (let i = 0; i < dict.p.length; i++) if (dict.p[i][0] === 3) usados.add(up(dict.p[i][1]));
      for (let k = 2; usados.has(up(nombre)); k++) nombre = nombre.replace(/ \(\d+\)$/, '') + ` (${k})`;
      obj('IMAGEDEF', [[5, defH], [102, '{ACAD_REACTORS'], [330, dictH], [330, reactorH], [102, '}'], [330, dictH], [100, 'AcDbRasterImageDef'], [90, '0'],
        [1, archivo], [10, fmt(o.wpx)], [20, fmt(o.hpx)], [11, '1.0'], [21, '1.0'], [280, '1'], [281, '0']]);
      dictP = [...dictP, [3, nombre], [350, defH]];
      if (dict.isNew) dict.p = dictP; else mods.push({ rec: dict, pairs: dictP });
    }
    // IMAGE: U = un píxel a lo ancho, V = un píxel hacia arriba (píxeles cuadrados), girados
    const k = o.ancho / o.wpx, a = (o.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const [x, y] = o.at;
    const body = [[90, 0], [10, x], [20, y], [30, 0], [11, k * c], [21, k * s], [31, 0], [12, -k * s], [22, k * c], [32, 0], [13, o.wpx], [23, o.hpx],
      [340, defH], [70, 3], [280, 0], [281, 50], [282, 50], [283, 0], [360, reactorH], [71, 1], [91, 2], [14, -0.5], [24, -0.5], [14, o.wpx - 0.5], [24, o.hpx - 0.5]];
    const img = this.make(page, 'IMAGE', 'AcDbRasterImage', body, o.capa || this.capaActual());
    const imgH = img.get(5);
    obj('IMAGEDEF_REACTOR', [[5, reactorH], [330, imgH], [100, 'AcDbRasterImageDefReactor'], [90, '2'], [330, imgH]]);
    adds.push(img);
    D.imagedefs.set(up(defH), { file: archivo, w: o.wpx, h: o.hpx });
    if (!D.imagedefs.has(defH)) D.imagedefs.set(defH, { file: archivo, w: o.wpx, h: o.hpx });
    this.commit(`Insertar imagen ${archivo.split(/[\\/]/).pop()}`, { mods, adds });
    return { ok: true, rec: img, defH, reutilizada: !!def };
  };

  return { nuevo, textoPares, grosorDeTabla, tamanoImagen, JUST, NOMBRE_JUST, parseColor, nombreColor, parseGrosor, nombreGrosor, GROSORES, TIPOS, FUENTE, propsDe, textoDe, setCodes, ORDEN_ENT, zonaEntidad, seccion };
})();
if (typeof module !== 'undefined') module.exports = Documento; else self.Documento = Documento;
