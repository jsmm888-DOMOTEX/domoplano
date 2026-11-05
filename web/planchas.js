// Domoplano — hito H4 «Planchas, ventanas y escalas».
// PRESENTACION (crear, renombrar, copiar, borrar, ordenar), CONFIGPAG (tamaño de hoja y orientación), ventanas de plancha
// (MVIEW): crear, escala estándar o personalizada, bloquear escala, capas inutilizadas por ventana (VPLAYER), giro de la
// vista, encuadre y zoom dentro de la ventana; escala de anotación básica (texto y cotas a la escala de la ventana) y
// rótulo con atributos (llenar todos los campos de una vez).
// Código propio escrito a partir de la referencia pública del formato DXF y de la ayuda pública de AutoCAD (cómo se
// comportan los comandos). Sin código ni archivos de Autodesk.
const Planchas = (() => {
  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
  const F = (v) => Edit.fmt(v);
  const hnd = (r) => String(r.get(5, '') || '').trim().toUpperCase();

  // Hojas: la de EPM (plantilla 1000 × 707), ISO A0–A4, carta y oficio (Colombia: 216 × 330 mm). Medidas horizontales.
  const HOJAS = {
    '1000X707': [1000, 707, 'EPM 1000 x 707 mm'], EPM: [1000, 707, 'EPM 1000 x 707 mm'],
    A0: [1189, 841, 'ISO A0 (1189 x 841 mm)'], A1: [841, 594, 'ISO A1 (841 x 594 mm)'], A2: [594, 420, 'ISO A2 (594 x 420 mm)'],
    A3: [420, 297, 'ISO A3 (420 x 297 mm)'], A4: [297, 210, 'ISO A4 (297 x 210 mm)'],
    CARTA: [279.4, 215.9, 'Carta (279,4 x 215,9 mm)'], LETTER: [279.4, 215.9, 'Carta (279,4 x 215,9 mm)'],
    OFICIO: [330, 216, 'Oficio (330 x 216 mm)'], LEGAL: [330, 216, 'Oficio (330 x 216 mm)'],
  };
  const NOMBRES_HOJA = ['1000x707', 'A0', 'A1', 'A2', 'A3', 'A4', 'Carta', 'Oficio'];
  /** Escalas estándar de ventana (1:N), como la lista de escalas de AutoCAD en planos de redes. */
  const ESCALAS = [20, 25, 50, 75, 100, 200, 250, 500, 1000, 2000, 5000];
  const MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 14: 100 };

  /** Hoja escrita por el usuario: «A1», «1000x707», «carta», «420x297», «594 x 841»… → {w, h, nombre} (horizontal) o null. */
  function parseHoja(t) {
    const s = up(t).replace(/\s+/g, '').replace('×', 'X');
    if (HOJAS[s]) { const [w, h, n] = HOJAS[s]; return { w, h, nombre: n }; }
    const m = /^(\d+(?:[.,]\d+)?)X(\d+(?:[.,]\d+)?)$/.exec(s);
    if (m) { const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.')); if (a > 0 && b > 0) return { w: Math.max(a, b), h: Math.min(a, b), nombre: `${F(Math.max(a, b))} x ${F(Math.min(a, b))} mm` }; }
    return null;
  }
  /** «1:500», «500», «1/500», «2:1» → denominador N (1:N) o null. */
  function parseEscala(t) {
    const s = String(t).trim().replace(',', '.');
    let m = /^1\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(s); if (m) return +m[1] > 0 ? +m[1] : null;
    m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(s); if (m) return +m[1] > 0 && +m[2] > 0 ? +m[2] / +m[1] : null;
    m = /^(\d+(?:\.\d+)?)$/.exec(s); if (m) return +m[1] > 0 ? +m[1] : null;
    return null;
  }
  const textoEscala = (N) => {
    if (!(N > 0)) return '—';
    if (N >= 1) return `1:${Math.abs(N - Math.round(N)) < 1e-6 ? Math.round(N) : +N.toFixed(3)}`;
    const r = 1 / N; return `${Math.abs(r - Math.round(r)) < 1e-6 ? Math.round(r) : +r.toFixed(3)}:1`;
  };

  // ---------------------------------------------------------------- utilidades de pares
  /** Copia de los pares con cambios dentro de una subclase (100 …): {código: valor | null}. */
  function enSub(pairs, sub, cambios) {
    const p = pairs.map((q) => q.slice());
    for (const [k, v] of Object.entries(cambios)) {
      const code = +k;
      const a = p.findIndex((q) => q[0] === 100 && String(q[1]).trim() === sub); if (a < 0) continue;
      let b = a + 1; while (b < p.length && p[b][0] !== 100) b++;
      const i = p.findIndex((q, j) => j > a && j < b && q[0] === code);
      if (v === null) { if (i >= 0) p.splice(i, 1); continue; }
      if (i >= 0) p[i][1] = typeof v === 'number' ? Edit.val(code, v) : String(v);
      else p.splice(b, 0, [code, typeof v === 'number' ? Edit.val(code, v) : String(v)]);
    }
    return p;
  }
  const entrada = (dict, name) => {
    for (let i = 0; i < dict.p.length - 1; i++) if (dict.p[i][0] === 3 && up(dict.p[i][1]) === up(name) && (dict.p[i + 1][0] === 350 || dict.p[i + 1][0] === 360)) return String(dict.p[i + 1][1]).trim();
    return null;
  };
  /** Pares de un diccionario sin la entrada `name`, o con la entrada renombrada a `nuevo`. */
  function dictSin(dict, name, nuevo) {
    const out = [];
    for (let i = 0; i < dict.p.length; i++) {
      const q = dict.p[i];
      if (q[0] === 3 && up(q[1]) === up(name) && dict.p[i + 1] && (dict.p[i + 1][0] === 350 || dict.p[i + 1][0] === 360)) {
        if (nuevo != null) out.push([3, nuevo], dict.p[i + 1].slice());
        i++; continue;
      }
      out.push(q.slice());
    }
    return out;
  }
  /** Pone 67=1 (espacio papel) después de «100 AcDbEntity» si falta. */
  function conPapel(p) {
    if (p.some((q) => q[0] === 67)) return p;
    const k = p.findIndex((q) => q[0] === 100 && String(q[1]).trim() === 'AcDbEntity');
    const out = p.slice(); out.splice(k >= 0 ? k + 1 : 0, 0, [67, '1']); return out;
  }

  // ---------------------------------------------------------------- pares de un LAYOUT y de una VIEWPORT nuevos
  function layoutPares(h, dictH, name, tab, W, H, media, brH) {
    return [[5, h], [102, '{ACAD_REACTORS'], [330, dictH], [102, '}'], [330, dictH], [100, 'AcDbPlotSettings'], [1, ''], [2, 'none_device'], [4, media], [6, ''],
      [40, '0.0'], [41, '0.0'], [42, '0.0'], [43, '0.0'], [44, F(W)], [45, F(H)], [46, '0.0'], [47, '0.0'], [48, '0.0'], [49, '0.0'], [140, '0.0'], [141, '0.0'],
      [142, '1.0'], [143, '1.0'], [70, '688'], [72, '1'], [73, '0'], [74, '5'], [7, 'monochrome.ctb'], [75, '16'], [76, '0'], [77, '2'], [78, '300'], [147, '1.0'], [148, '0.0'], [149, '0.0'],
      [100, 'AcDbLayout'], [1, name], [70, '1'], [71, String(tab)], [10, '0.0'], [20, '0.0'], [11, F(W)], [21, F(H)], [12, '0.0'], [22, '0.0'], [32, '0.0'],
      [14, '0.0'], [24, '0.0'], [34, '0.0'], [15, F(W)], [25, F(H)], [35, '0.0'], [146, '0.0'], [13, '0.0'], [23, '0.0'], [33, '0.0'],
      [16, '1.0'], [26, '0.0'], [36, '0.0'], [17, '0.0'], [27, '1.0'], [37, '0.0'], [76, '1'], [330, brH]];
  }
  /** Pares de una VIEWPORT desde «100 AcDbViewport». c = centro en el papel, vc = centro de la vista (DCS), vh = alto de la vista. */
  function vpPares(c, w, h, id, vc, vh, flags, frozen = []) {
    return [[100, 'AcDbViewport'], [10, F(c[0])], [20, F(c[1])], [30, '0.0'], [40, F(w)], [41, F(h)], [68, String(id)], [69, String(id)],
      [12, F(vc[0])], [22, F(vc[1])], [13, '0.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'], [15, '10.0'], [25, '10.0'],
      [16, '0.0'], [26, '0.0'], [36, '1.0'], [17, '0.0'], [27, '0.0'], [37, '0.0'], [42, '50.0'], [43, '0.0'], [44, '0.0'], [45, F(vh)],
      [50, '0.0'], [51, '0.0'], [72, '1000'], ...frozen.map((x) => [331, x]), [90, String(flags)], [1, ''], [281, '0'], [71, '1'], [74, '0'],
      [110, '0.0'], [120, '0.0'], [130, '0.0'], [111, '1.0'], [121, '0.0'], [131, '0.0'], [112, '0.0'], [122, '1.0'], [132, '0.0'], [79, '0'], [146, '0.0'], [170, '0'], [61, '5']];
  }

  const S = Edit.Session.prototype;

  // ================================================================ PLANCHAS (PRESENTACION / LAYOUT)
  S._objs = function () {
    const D = this.D;
    if (!D.sections.OBJECTS || !D.objects || D.objects.endLine == null) return null;
    return D.objects;
  };
  S._dictLayouts = function () {
    const objs = this._objs(); if (!objs) return null;
    const root = objs.find((r) => r.type === 'DICTIONARY' && !r.deleted);
    if (!root) return null;
    const h = entrada(root, 'ACAD_LAYOUT'); if (!h) return null;
    return objs.find((r) => !r.deleted && hnd(r) === up(h)) || null;
  };
  /** Planchas en orden de pestaña: [{name, tab, rec, brec, activa, w, h, media}]. */
  S.planchas = function () {
    return this.D.layouts.filter((l) => l.name && up(l.name) !== 'MODEL').sort((a, b) => a.tab - b.tab).map((l) => {
      const br = this.D.blockRecords.get(l.brec);
      const lim = l.lim || (l.paperW > 0 ? ((l.rot % 2) ? [0, 0, l.paperH, l.paperW] : [0, 0, l.paperW, l.paperH]) : null);
      return { name: l.name, tab: l.tab, rec: l.rec, brec: l.brec, activa: !!(br && up(br.name) === '*PAPER_SPACE'), w: lim ? lim[2] - lim[0] : 0, h: lim ? lim[3] - lim[1] : 0, media: l.media || '' };
    });
  };
  S.plancha = function (name) { return this.planchas().find((p) => up(p.name) === up(name)) || null; };
  S._nombrePlancha = function (name, actual) {
    name = String(name || '').trim();
    const err = this.validName(name); if (err) return err;
    if (['MODEL', 'MODELO'].includes(up(name))) return 'Ese nombre está reservado para el Modelo.';
    if (name.length > 255) return 'Nombre demasiado largo.';
    const otra = this.plancha(name); if (otra && (!actual || otra.rec !== actual.rec)) return `Ya existe la plancha «${otra.name}».`;
    return null;
  };
  const need = (s) => (s.r12() ? { error: 'Las planchas necesitan DXF 2000 o posterior (este es R12).' } : !s._dictLayouts() ? { error: 'Este DXF no tiene el diccionario de presentaciones (ACAD_LAYOUT).' } : null);

  /** Nombre libre «*Paper_SpaceN» para el bloque de una plancha nueva. */
  S._bloquePapelLibre = function () {
    const usados = new Set([...this.D.blocks.keys()]); this.tblRecs('BLOCK_RECORD').forEach((r) => usados.add(up(r.get(2, ''))));
    let k = 0; while (usados.has('*PAPER_SPACE' + k)) k++;
    return '*Paper_Space' + k;
  };

  /**
   * Arma (sin confirmar) una plancha nueva: registro de bloque, bloque *Paper_SpaceN con la ventana general (ID 1),
   * LAYOUT y su entrada en ACAD_LAYOUT. Devuelve {adds, mods, newBlocks, b, brH} o {error}.
   */
  S._armarPlancha = function (name, hoja, tab) {
    const e = need(this); if (e) return e;
    const err = this._nombrePlancha(name); if (err) return { error: err };
    const objs = this._objs(); const dict = this._dictLayouts();
    const { b, br } = this._bloqueNuevo(this._bloquePapelLibre(), [0, 0], 0);
    const brH = b.owner, layH = this.newHandle(), dictH = hnd(dict);
    br.p = br.p.map(([c, v]) => [c, c === 340 ? layH : v]);
    const lay = new DXF.Rec('LAYOUT', layoutPares(layH, dictH, String(name).trim(), tab, hoja.w, hoja.h, hoja.nombre || `${F(hoja.w)} x ${F(hoja.h)} mm`, brH));
    lay.isNew = true; lay.home = objs; lay.insertLine = objs.endLine;
    // ventana general de la plancha (ID 1), como la crea cualquier CAD al activar una presentación
    const vp = new DXF.Rec('VIEWPORT', [[5, this.newHandle()], [330, brH], [100, 'AcDbEntity'], [67, '1'], [8, '0'],
      ...vpPares([hoja.w / 2, hoja.h / 2], hoja.w * 1.05, hoja.h * 1.05, 1, [hoja.w / 2, hoja.h / 2], hoja.h * 1.05, 557056)]);
    vp.isNew = true; vp.home = b.ents; b.ents.push(vp);
    return { adds: [br, lay], mods: [{ rec: dict, pairs: [...dict.p.map((q) => q.slice()), [3, String(name).trim()], [350, layH]] }], newBlocks: [b], b, brH, lay };
  };
  /** PRESENTACION Nueva: plancha vacía con la hoja dada ({w, h, nombre}; por omisión la de la plancha actual o A3). */
  S.crearPlancha = function (name, hoja) {
    const ult = this.planchas().reduce((m, p) => Math.max(m, p.tab), 0);
    hoja = hoja || { w: 420, h: 297, nombre: HOJAS.A3[2] };
    const r = this._armarPlancha(name, hoja, ult + 1); if (r.error) return r;
    this.commit(`Crear plancha ${String(name).trim()}`, { adds: r.adds, mods: r.mods, newBlocks: r.newBlocks, tables: true, layouts: true });
    return { ok: true, name: String(name).trim() };
  };
  /** Entidades (vivas) de una plancha. */
  S._entsPlancha = function (pl) {
    const br = this.D.blockRecords.get(pl.brec);
    const blk = br ? this.D.blocks.get(up(br.name)) : null;
    if (pl.activa) return [...(blk ? blk.ents : []), ...this.D.entities.filter((e) => e.int(67, 0) === 1)].filter((e) => !e.deleted);
    return (blk ? blk.ents : []).filter((e) => !e.deleted);
  };
  /** PRESENTACION Copiar: plancha nueva con la misma hoja y copia de todo lo dibujado (ventanas incluidas). */
  S.copiarPlancha = function (src, name) {
    const pl = this.plancha(src); if (!pl) return { error: `No existe la plancha «${src}».` };
    if (!name) { let k = 2; name = `${pl.name} (${k})`; while (this.plancha(name)) name = `${pl.name} (${++k})`; }
    const ult = this.planchas().reduce((m, p) => Math.max(m, p.tab), 0);
    const r = this._armarPlancha(name, { w: pl.w || 420, h: pl.h || 297, nombre: pl.media || undefined }, ult + 1); if (r.error) return r;
    // copia de las entidades (menos la ventana general, que ya tiene la nueva): handles nuevos, dueño = la plancha nueva
    const ents = this._entsPlancha(pl);
    const map = new Map(); let parent = null;
    for (const e of ents) {
      if (e.type === 'VIEWPORT' && e.int(69, 2) === 1) continue;
      const child = ['ATTRIB', 'VERTEX', 'SEQEND'].includes(e.type);
      const owner = child && parent ? parent : r.brH;
      let p = conPapel(this._retarget(e.p, owner, true));
      // H6-A: cada cota copiada lleva su propio bloque anónimo *D… (no comparte el de la plancha original)
      const b0 = e.type === 'DIMENSION' && this._bloqueNuevo ? this.D.blocks.get(up(e.get(2, ''))) : null;
      if (b0) {
        let nom = this._nombreLibre(null, true); while (r.newBlocks.some((x) => up(x.name) === up(nom)) || this.D.blocks.has(up(nom))) nom = '*D' + (parseInt(nom.slice(2), 10) + 1);
        const { b, br } = this._bloqueNuevo(nom, [0, 0], 1);
        for (const x of b0.ents) if (!x.deleted) b.ents.push(new DXF.Rec(x.type, this._retarget(x.p, b.owner, false)));
        r.newBlocks.push(b); r.adds.push(br);
        p = p.map(([c, v]) => (c === 2 ? [2, b.name] : [c, v]));
      }
      const n = new DXF.Rec(e.type, p); n.isNew = true; n.home = r.b.ents; r.b.ents.push(n);
      if (!child) parent = n.get(5);
      map.set(hnd(e), n.get(5));
    }
    this.commit(`Copiar plancha ${pl.name}`, { adds: r.adds, mods: r.mods, newBlocks: r.newBlocks, tables: true, layouts: true, full: true });
    this.numerarPlanchas({ fusionar: true }); // R2-fix M-13: «plancha X de Y» al día en todas (mismo paso de deshacer)
    return { ok: true, name: String(name).trim(), n: map.size };
  };
  /** PRESENTACION Renombrar. */
  S.renombrarPlancha = function (old, name) {
    const e = need(this); if (e) return e;
    const pl = this.plancha(old); if (!pl) return { error: `No existe la plancha «${old}».` };
    name = String(name || '').trim();
    const err = this._nombrePlancha(name, pl); if (err) return { error: err };
    const dict = this._dictLayouts();
    this.commit(`Renombrar plancha ${pl.name}`, { mods: [{ rec: pl.rec, pairs: enSub(pl.rec.p, 'AcDbLayout', { 1: name }) }, { rec: dict, pairs: dictSin(dict, pl.name, name) }], layouts: true, keepModel: true });
    return { ok: true, name };
  };
  /** PRESENTACION Ordenar: mueve la plancha a la posición `pos` (1 = primera) o `delta` lugares. */
  S.moverPlancha = function (name, { pos, delta } = {}) {
    const L = this.planchas(); const i = L.findIndex((p) => up(p.name) === up(name));
    if (i < 0) return { error: `No existe la plancha «${name}».` };
    let j = pos != null ? Math.round(pos) - 1 : i + Math.round(delta || 0);
    j = Math.max(0, Math.min(L.length - 1, j));
    if (j === i) return { ok: true, sinCambio: true, pos: j + 1 };
    const [x] = L.splice(i, 1); L.splice(j, 0, x);
    const mods = [];
    L.forEach((p, k) => { if (p.tab !== k + 1) mods.push({ rec: p.rec, pairs: enSub(p.rec.p, 'AcDbLayout', { 71: k + 1 }) }); });
    this.commit(`Ordenar plancha ${x.name}`, { mods, layouts: true, keepModel: true });
    this.numerarPlanchas({ fusionar: true });
    return { ok: true, pos: j + 1 };
  };
  /** CONFIGPAG: tamaño de hoja y orientación de una plancha. hoja = {w, h, nombre}; orient = 'H' | 'V'. Lo dibujado no se mueve. */
  S.configPag = function (name, hoja, orient = 'H') {
    const pl = this.plancha(name); if (!pl) return { error: `No existe la plancha «${name}».` };
    let W = Math.max(hoja.w, hoja.h), H = Math.min(hoja.w, hoja.h);
    if (up(orient).startsWith('V')) [W, H] = [H, W];
    let p = enSub(pl.rec.p, 'AcDbPlotSettings', { 4: hoja.nombre || `${F(W)} x ${F(H)} mm`, 44: F(W), 45: F(H), 73: 0 });
    p = enSub(p, 'AcDbLayout', { 10: '0.0', 20: '0.0', 11: F(W), 21: F(H) });
    this.commit(`Hoja ${pl.name}: ${F(W)} x ${F(H)}`, { mods: [{ rec: pl.rec, pairs: p }], layouts: true, keepModel: true });
    return { ok: true, w: W, h: H };
  };
  /**
   * PRESENTACION Borrar (como AutoCAD: no se puede borrar la última). Si es la plancha activa (*Paper_Space), otra
   * plancha pasa a ser la activa: sus objetos se pasan a ENTITIES con los mismos handles.
   */
  S.borrarPlancha = function (name) {
    const e = need(this); if (e) return e;
    const L = this.planchas(); const pl = L.find((p) => up(p.name) === up(name));
    if (!pl) return { error: `No existe la plancha «${name}».` };
    if (L.length < 2) return { error: 'No se puede borrar la única plancha del dibujo.' };
    const dict = this._dictLayouts();
    const mods = [{ rec: dict, pairs: dictSin(dict, pl.name) }], dels = [pl.rec], blocks = [], adds = [];
    const brRec = (h) => this.tblRecs('BLOCK_RECORD').find((r) => hnd(r) === up(h));
    const blkDe = (h) => { const br = this.D.blockRecords.get(h); return br ? this.D.blocks.get(up(br.name)) : null; };
    if (!pl.activa) {
      const b = blkDe(pl.brec); if (b) blocks.push(b);
      const br = brRec(pl.brec); if (br) dels.push(br);
    } else {
      // la siguiente plancha (o la anterior) pasa a ser la activa
      const k = L.indexOf(pl); const otra = L[k + 1] || L[k - 1];
      const b2 = blkDe(otra.brec), br2 = brRec(otra.brec), brP = brRec(pl.brec);
      if (!brP || !br2) return { error: 'No encontré los registros de bloque de las planchas.' };
      dels.push(...this.D.entities.filter((x) => !x.deleted && x.int(67, 0) === 1)); // lo dibujado en la plancha borrada
      const bP = blkDe(pl.brec); if (bP) dels.push(...bP.ents.filter((x) => !x.deleted));
      const hP = hnd(brP), h2 = hnd(br2);
      for (const x of (b2 ? b2.ents : [])) {
        if (x.deleted) continue;
        const p = conPapel(x.p.map(([c, v]) => [c, c === 330 && up(v) === h2 ? hP : v]));
        const n = new DXF.Rec(x.type, p); n.isNew = true; n.home = this.D.entities; n.insertLine = this.D.entitiesEndLine; adds.push(n);
      }
      if (b2) blocks.push(b2);
      dels.push(br2);
      mods.push({ rec: brP, pairs: brP.p.map(([c, v]) => [c, c === 340 ? hnd(otra.rec) : v]) });
      mods.push({ rec: otra.rec, pairs: enSub(otra.rec.p, 'AcDbLayout', { 330: hP }) });
    }
    this.commit(`Borrar plancha ${pl.name}`, { mods, dels, adds, blocks, tables: true, layouts: true, full: true });
    this.numerarPlanchas({ fusionar: true });
    return { ok: true };
  };
  /** Junta los dos últimos pasos de deshacer en uno (el primero da el nombre). */
  S._fusionarUltimos = function () {
    const b = this.undoStack.pop(), a = this.undoStack.pop(); if (!a || !b) { if (a) this.undoStack.push(a); if (b) this.undoStack.push(b); return; }
    this.undoStack.push({ label: a.label, full: a.full || b.full, layouts: a.layouts || b.layouts, keepModel: a.keepModel && b.keepModel,
      apply: () => { a.apply(); b.apply(); }, revert: () => { b.revert(); a.revert(); } });
  };
  /**
   * R2-fix M-13: numera solas las planchas con rótulo: PLANCHA = su número entre las que tienen rótulo y TOTAL = cuántas
   * son. Solo toca los campos vacíos o con un número (no pisa un «E-1» o un texto escrito a mano). fusionar = mismo paso
   * de deshacer que la operación anterior (copiar, borrar u ordenar planchas). Devuelve {ok, n (campos cambiados)}.
   */
  S.numerarPlanchas = function ({ fusionar = false } = {}) {
    const conRot = this.planchas().map((pl) => ({ pl, rots: this.rotulosDe(pl) })).filter((x) => x.rots.length);
    if (!conRot.length) return { ok: true, n: 0 };
    const dos = (n) => String(n).padStart(2, '0'); const total = conRot.length; const mods = [];
    conRot.forEach(({ rots }, k) => {
      for (const r of rots) for (const a of r.attrs) {
        const tag = tagAttrib(a); if (tag !== 'PLANCHA' && tag !== 'TOTAL') continue;
        const cur = valorAttrib(a).trim(); if (cur && !/^\d+$/.test(cur)) continue;
        const v = tag === 'PLANCHA' ? dos(k + 1) : dos(total); if (v === cur) continue;
        let hecho = false;
        mods.push({ rec: a, pairs: a.p.map(([c, x]) => { if (c === 1 && !hecho) { hecho = true; return [1, v]; } return [c, x]; }) });
      }
    });
    if (!mods.length) return { ok: true, n: 0 };
    this.commit('Numerar planchas', { mods });
    if (fusionar) this._fusionarUltimos();
    return { ok: true, n: mods.length };
  };

  // ================================================================ VENTANAS (MVIEW / VPORTS)
  S.unidadModeloMM = function () { const u = parseInt(this.hdrGet('$INSUNITS', 70, '4'), 10); return MM[u] || 1; };
  /** mm de papel por unidad del modelo para la escala 1:N (k = alto en papel / alto de la vista). */
  S._kDe = function (page, N) { return this.unidadModeloMM() / N / (page.unitMM || 1); };
  /** Escala 1:N de una ventana (N puede no ser entero: escala personalizada). */
  S.escalaVentana = function (page, vp) {
    const h = vp.num(41), vh = vp.num(45); if (!(h > 0 && vh > 0)) return null;
    return this.unidadModeloMM() / ((h / vh) * (page.unitMM || 1));
  };
  /** Datos de una ventana para mostrar: {id, escala, bloqueada, giro, capas inutilizadas, centro, tamaño}. */
  S.datosVentana = function (page, vp) {
    const lay = new Map(); for (const l of this.D.layers.values()) if (l.rec) lay.set(hnd(l.rec), l.name);
    return { id: vp.int(69, 0), escala: this.escalaVentana(page, vp), bloqueada: (vp.int(90, 0) & 16384) !== 0, giro: vp.num(51, 0),
      capas: vp.all(331).map((h) => lay.get(up(h))).filter(Boolean), centro: [vp.num(10), vp.num(20)], w: vp.num(40), h: vp.num(41) };
  };
  /** Ventanas (no la general) de la plancha. */
  S.ventanas = function (page) {
    const ents = page.ents ? page.ents() : [];
    return ents.filter((e) => e.type === 'VIEWPORT' && !e.deleted && e.int(69, 2) !== 1);
  };
  /** Extensión del modelo (WCS) o null. */
  S._extModelo = function () {
    const mo = this.doc.modelo ? this.doc.modelo() : null;
    if (!mo || !mo.node || !isFinite(mo.node.bb[0])) return null;
    return mo.node.bb;
  };
  /**
   * MVIEW: ventana rectangular entre dos esquinas del papel. o = {escala: N (1:N) | null = ajustar a lo dibujado,
   * centro: [x, y] del modelo (WCS), capa}. Un paso de deshacer.
   */
  S.crearVentana = function (page, a, b, o = {}) {
    if (this.r12()) return { error: 'Las ventanas necesitan DXF 2000 o posterior.' };
    if (!page || !page.edit || page.edit.space !== 'paper') return { error: 'Las ventanas se crean en una plancha (no en el Modelo).' };
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const w = x1 - x0, h = y1 - y0;
    if (!(w > 1e-6 && h > 1e-6)) return { error: 'La ventana debe tener ancho y alto.' };
    const ext = this._extModelo();
    let centro = o.centro || (ext ? [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2] : [0, 0]);
    let vh;
    if (o.escala > 0) vh = h / this._kDe(page, o.escala);
    else if (ext) { const ew = Math.max(ext[2] - ext[0], 1e-9), eh = Math.max(ext[3] - ext[1], 1e-9); const k = Math.min(w / ew, h / eh) / 1.05; vh = h / k; }
    else vh = h;
    const ids = this.ventanas(page).map((v) => v.int(69, 0));
    const id = Math.max(1, ...ids) + 1;
    const rec = this.make(page, 'VIEWPORT', null, vpPares([(x0 + x1) / 2, (y0 + y1) / 2], w, h, id, centro, vh, 32768), o.capa || this.capaActual());
    rec.p = conPapel(rec.p);
    this.commit('Crear ventana', { adds: [rec], keepModel: true });
    return { ok: true, rec, escala: this.escalaVentana(page, rec) };
  };
  /** Cambia códigos de una ventana (sin rearmar el modelo). */
  S._vpSet = function (vp, cambios, label, frozen) {
    let p = enSub(vp.p, 'AcDbViewport', cambios);
    if (frozen) { // capas inutilizadas (331) van después del 72 (porcentaje de zoom de círculo) y antes del 90
      p = p.filter((q) => q[0] !== 331);
      let k = p.findIndex((q) => q[0] === 90); if (k < 0) k = p.length;
      p.splice(k, 0, ...frozen.map((h) => [331, h]));
    }
    this.commit(label, { mods: [{ rec: vp, pairs: p }], keepModel: true });
    return { ok: true };
  };
  const bloqueada = (vp) => (vp.int(90, 0) & 16384) !== 0;
  /** Escala estándar o personalizada (1:N) manteniendo el centro de la vista. */
  S.ponerEscalaVentana = function (page, vp, N) {
    if (!(N > 0)) return { error: 'Escriba la escala como 1:500, 500 o 2:1.' };
    if (bloqueada(vp)) return { error: 'La escala de esta ventana está bloqueada. Desbloquéela primero (VBLOQUEAR N).' };
    const vh = vp.num(41) / this._kDe(page, N);
    return this._vpSet(vp, { 45: F(vh) }, `Escala de ventana ${textoEscala(N)}`);
  };
  /** Bloquear o desbloquear la escala (visualización) de la ventana. */
  S.bloquearVentana = function (vp, on) {
    const f = vp.int(90, 0); const nf = on ? f | 16384 : f & ~16384;
    if (nf === f) return { ok: true, sinCambio: true };
    return this._vpSet(vp, { 90: String(nf) }, on ? 'Bloquear ventana' : 'Desbloquear ventana');
  };
  /** VPLAYER: inutiliza (congela) o reutiliza capas SOLO en esa ventana. nombres = lista de capas (o '*' = todas). */
  S.capasVentana = function (vp, nombres, congelar) {
    const actuales = new Set(vp.all(331).map((h) => up(h)));
    const capas = [...this.D.layers.values()].filter((l) => l.rec);
    const elegir = (n) => { if (n === '*') return capas; const re = new RegExp('^' + String(n).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); return capas.filter((l) => re.test(l.name)); };
    const sel = new Set(); const faltan = [];
    for (const n of nombres) { const m = elegir(n); if (!m.length) faltan.push(n); m.forEach((l) => sel.add(l)); }
    if (!sel.size) return { error: `No existe la capa «${faltan.join(', ')}».` };
    for (const l of sel) { const h = hnd(l.rec); if (congelar) actuales.add(h); else actuales.delete(h); }
    // se guardan con el handle tal como está escrito en la tabla
    const orden = capas.filter((l) => actuales.has(hnd(l.rec))).map((l) => String(l.rec.get(5)).trim());
    const r = this._vpSet(vp, {}, `${congelar ? 'Inutilizar' : 'Reutilizar'} capas en la ventana`, orden);
    return { ...r, n: sel.size, faltan };
  };
  /** Giro de la vista de la ventana (grados, como la vista girada de AutoCAD); el centro de la vista se conserva. */
  S.girarVentana = function (vp, deg) {
    if (!Number.isFinite(deg)) return { error: 'Escriba el ángulo en grados.' };
    if (bloqueada(vp)) return { error: 'La ventana está bloqueada. Desbloquéela primero (VBLOQUEAR N).' };
    // R2-fix: el centro (12, 22) va en DCS (girado): se recalcula para que el mismo punto del modelo siga en el centro
    const C = this.centroVistaVentana(vp), t = objetivo(vp), d = dcs([C[0] - t[0], C[1] - t[1]], Edit.norm360(deg));
    return this._vpSet(vp, { 51: F(Edit.norm360(deg)), 12: F(d[0]), 22: F(d[1]) }, `Girar vista de ventana ${F(deg)}°`);
  };
  /** Centro de la vista en WCS (con el punto objetivo, vista en planta). */
  const objetivo = (vp) => (Math.abs(vp.num(16, 0)) < 1e-9 && Math.abs(vp.num(26, 0)) < 1e-9 ? [vp.num(17, 0), vp.num(27, 0)] : [0, 0]);
  /** WCS (relativo al objetivo) → DCS con el giro de la vista, y al revés (DXF: el centro 12/22 está en DCS). */
  const dcs = (p, deg) => { const a = (deg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c * p[0] - s * p[1], s * p[0] + c * p[1]]; };
  const wcs = (p, deg) => dcs(p, -(deg || 0));
  S.centroVistaVentana = function (vp) { const t = objetivo(vp), w = wcs([vp.num(12), vp.num(22)], vp.num(51, 0)); return [w[0] + t[0], w[1] + t[1]]; };
  /** Encuadre o zoom dentro de la ventana: nuevo centro (WCS) y alto de vista (unidades del modelo; null = el mismo). */
  S.vistaVentana = function (vp, centro, alto, label = 'Encuadre en ventana') {
    if (bloqueada(vp)) return { error: 'La ventana está bloqueada: no se puede encuadrar ni hacer zoom dentro de ella (VBLOQUEAR N para desbloquearla).' };
    const t = objetivo(vp); const d = dcs([centro[0] - t[0], centro[1] - t[1]], vp.num(51, 0));
    const ch = { 12: F(d[0]), 22: F(d[1]) };
    if (alto > 0) ch[45] = F(alto);
    return this._vpSet(vp, ch, label);
  };
  /** ZOOM Extensión dentro de la ventana: muestra todo lo dibujado en el modelo. */
  S.zoomExtVentana = function (vp) {
    const ext = this._extModelo(); if (!ext) return { error: 'El modelo está vacío.' };
    return this.zoomVentanaA(vp, ext, 'Zoom extensión en ventana');
  };
  /** Zoom dentro de la ventana a un rectángulo del modelo (WCS). */
  S.zoomVentanaA = function (vp, bb, label = 'Zoom ventana en ventana') {
    const w = vp.num(40), h = vp.num(41);
    const tw = Math.abs(vp.num(51, 0) * Math.PI / 180);
    const bw = Math.max(bb[2] - bb[0], 1e-9), bh = Math.max(bb[3] - bb[1], 1e-9);
    // con giro, el rectángulo girado debe caber: se usa su caja girada
    const c = Math.abs(Math.cos(tw)), s = Math.abs(Math.sin(tw));
    const rw = bw * c + bh * s, rh = bw * s + bh * c;
    const k = Math.min(w / rw, h / rh) / 1.03;
    return this.vistaVentana(vp, [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], h / k, label);
  };

  // ================================================================ ESCALA DE ANOTACIÓN (básica)
  /** Escala de anotación del modelo ($CANNOSCALE «1:N») → N, o null si no está puesta. */
  S.escalaAnot = function () {
    const v = this.hdrGet('$CANNOSCALE', 1, null); if (!v) return null;
    const N = parseEscala(v); return N > 0 && N !== 1 ? N : null;
  };
  S.ponerEscalaAnot = function (N) {
    if (N === null) { this.commit('Escala de anotación: ninguna', { hdr: [{ name: '$CANNOSCALE', code: 1, value: '1:1' }], keepModel: true }); return { ok: true }; }
    if (!(N > 0)) return { error: 'Escriba la escala como 1:500 o 500.' };
    this.commit(`Escala de anotación ${textoEscala(N)}`, { hdr: [{ name: '$CANNOSCALE', code: 1, value: textoEscala(N) }], keepModel: true });
    return { ok: true };
  };
  /** Factor papel → modelo para anotar a escala 1:N: una letra de h mm en el papel mide h·factor en el modelo. */
  S.factorAnot = function (N) { return N / this.unidadModeloMM(); };
  /** Estilo de cota «ANOT 1-N»: copia del estilo actual con DIMSCALE = factor de la escala (crea el estilo si falta). */
  S.estiloAnot = function (N) {
    const name = `ANOT 1-${String(+N.toFixed(3)).replace('.', ',')}`;
    const base0 = this.estiloCota();
    if (this.findRec('DIMSTYLE', name)) {
      // un «ANOT 1-N» guardado con la falla F-5 (mide en mm en un plano en metros) se corrige al usarlo
      const ya = this.estiloCota(name);
      if (Math.abs(ya.lfac - base0.lfac) > 1e-9 && base0.name !== name) { const r = this.crearEstiloCota(name, { lfac: base0.lfac, post: base0.post, actual: false }); if (r.error) return r; return { ok: true, name, corregido: true }; }
      return { ok: true, name };
    }
    // R2-fix F-5: el estilo de anotación mide igual que el estilo base (mismo DIMLFAC y sufijo), así respeta las unidades
    // del dibujo: en un plano en metros 40 m dice «40,00» (antes se forzaba 'mm' y salía «40000,00»). Solo cambia DIMSCALE.
    const base = this.estiloCota();
    const r = this.crearEstiloCota(name, { escala: this.factorAnot(N), lfac: base.lfac, post: base.post, txt: base.txt, asz: base.asz, dec: base.dec, actual: false });
    return r.error ? r : { ok: true, name, nuevo: true };
  };

  // ================================================================ RÓTULO con atributos
  /** Campos del rótulo EPM de Domoplano (etiqueta → nombre para mostrar), en el orden en que se piden. */
  const CAMPOS = [
    ['PROYECTO', 'Proyecto'], ['DIRECCION', 'Dirección - municipio'], ['PROPIETARIO', 'Propietario o usuario'], ['PROPIETARIO_CONTACTO', 'Contacto del propietario'],
    ['CONTRATO', 'Contrato'], ['FIRMA', 'Firma que diseña y presenta'], ['FIRMA_CONTACTO', 'Contacto de la firma'], ['DISENO', 'Diseñó'], ['MATRICULA', 'Matrícula profesional'],
    ['DIBUJO', 'Dibujó'], ['ESCALA', 'Escala'], ['FECHA', 'Fecha'], ['CONSECUTIVO', 'Consecutivo de identificación'], ['CONTIENE', 'Contiene'],
    ['PLANCHA', 'Plancha (número)'], ['TOTAL', 'De (total de planchas)'], ['SN', 'SN (campo de EPM)'],
  ];
  const ETIQ = new Set(CAMPOS.map((c) => c[0]));
  const valorAttrib = (a) => String(a.get(1, '') || '');
  const tagAttrib = (a) => {
    let sub = ''; for (const [c, v] of a.p) { if (c === 100) sub = String(v).trim(); else if (c === 2 && sub === 'AcDbAttribute') return up(v); }
    return up(a.get(2, ''));
  };
  /** Rótulos de una plancha: inserciones con atributos cuyas etiquetas incluyen PROYECTO (o ESCALA y FECHA). */
  S.rotulosDe = function (pl) {
    const ents = this._entsPlancha(pl); const out = [];
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]; if (e.type !== 'INSERT' || e.int(66, 0) !== 1) continue;
      const attrs = []; for (const q of this.withSeq(e)) if (q.type === 'ATTRIB' && !q.deleted) attrs.push(q);
      const tags = new Set(attrs.map(tagAttrib));
      if (tags.has('PROYECTO') || (tags.has('ESCALA') && tags.has('FECHA'))) out.push({ ins: e, attrs, plancha: pl.name });
    }
    return out;
  };
  /** Valores actuales del rótulo (de la primera plancha que tenga uno, o de la dada): {TAG: valor}. */
  S.valoresRotulo = function (name) {
    const L = this.planchas().filter((p) => !name || up(p.name) === up(name));
    for (const pl of L) { const r = this.rotulosDe(pl)[0]; if (r) { const o = {}; r.attrs.forEach((a) => { o[tagAttrib(a)] = valorAttrib(a); }); return { plancha: pl.name, valores: o, etiquetas: r.attrs.map(tagAttrib) }; } }
    return null;
  };
  /** Escala para el rótulo: la de la ventana (si todas las ventanas de la plancha tienen la misma) o «INDICADA». */
  S._escalaRotulo = function (pl, page) {
    const vps = this._entsPlancha(pl).filter((e) => e.type === 'VIEWPORT' && e.int(69, 2) !== 1);
    const pg = page || { unitMM: 1 };
    const Ns = [...new Set(vps.map((v) => this.escalaVentana(pg, v)).filter((n) => n > 0).map((n) => textoEscala(n)))];
    return Ns.length === 1 ? Ns[0] : Ns.length ? 'INDICADA' : 'SIN ESCALA';
  };
  /**
   * Llena el rótulo de una vez. valores = {TAG: texto}; «=» en PLANCHA, TOTAL o ESCALA = automático (número de la
   * plancha entre las que tienen rótulo, total de planchas y escala de la ventana). donde = 'todas' | nombre de plancha.
   * Un solo paso de deshacer. Devuelve {ok, planchas, campos}.
   */
  S.llenarRotulo = function (valores, { donde = 'todas', pages = [] } = {}) {
    const todas = this.planchas();
    const conRot = todas.map((pl) => ({ pl, rots: this.rotulosDe(pl) })).filter((x) => x.rots.length);
    if (!conRot.length) return { error: 'No encontré un rótulo con atributos (PROYECTO, ESCALA, FECHA…) en las planchas. Use PLANTILLAEPM o un bloque de rótulo con atributos.' };
    const elegidas = donde === 'todas' ? conRot : conRot.filter((x) => up(x.pl.name) === up(donde));
    if (!elegidas.length) return { error: `La plancha «${donde}» no tiene rótulo con atributos.` };
    const total = conRot.length; const mods = []; const campos = new Set();
    const dos = (n) => String(n).padStart(2, '0');
    for (const { pl, rots } of elegidas) {
      const num = conRot.findIndex((x) => x.pl === pl) + 1;
      const page = pages.find((p) => p.layout && p.layout.rec === pl.rec);
      for (const r of rots) for (const a of r.attrs) {
        const tag = tagAttrib(a); if (!(tag in valores)) continue;
        let v = String(valores[tag] ?? '');
        if (v.trim() === '=') v = tag === 'PLANCHA' ? dos(num) : tag === 'TOTAL' ? dos(total) : tag === 'ESCALA' ? this._escalaRotulo(pl, page) : v;
        if (v === valorAttrib(a)) continue;
        let hecho = false;
        mods.push({ rec: a, pairs: a.p.map(([c, x]) => { if (c === 1 && !hecho) { hecho = true; return [1, v]; } return [c, x]; }) });
        campos.add(tag);
      }
    }
    if (!mods.length) return { ok: true, planchas: elegidas.length, campos: [], sinCambio: true };
    this.commit(`Llenar rótulo (${campos.size} campo(s))`, { mods });
    return { ok: true, planchas: elegidas.length, campos: [...campos] };
  };

  return { HOJAS, NOMBRES_HOJA, ESCALAS, CAMPOS, ETIQ, parseHoja, parseEscala, textoEscala, enSub, vpPares, layoutPares };
})();
if (typeof module !== 'undefined') module.exports = Planchas; else self.Planchas = Planchas;
