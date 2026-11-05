// Domoplano — herramientas de edición con línea de comandos (alias como AutoCAD en español/inglés).
// Se conecta al visor con CAD.attach(host). Trabaja en coordenadas LOCALES de la hoja (modelo o papel).
const CAD = (() => {
  let H = null;              // host (visor)
  let S = null;              // Edit.Session del documento
  let sel = new Set();       // registros seleccionados
  let cmd = null;            // comando en curso
  let lastCmd = null;
  let cursor = null;         // punto local bajo el mouse (ya con enganche)
  let snap = null;           // {x,y,kind} punto de enganche activo
  let snapOn = true, orthoOn = false;
  // R2-fix M-15: modos de Refent que se pueden escoger (como OSMODE): comando REFENT (RF) o el panel «▾» junto al botón Refent
  const MODOS_REF = [['end', 'FIN', 'Punto final'], ['mid', 'MED', 'Punto medio'], ['cen', 'CEN', 'Centro'], ['quad', 'CUA', 'Cuadrante'], ['ins', 'INS', 'Inserción'],
    ['int', 'INT', 'Intersección'], ['per', 'PER', 'Perpendicular'], ['tan', 'TAN', 'Tangente']];
  let snapModos = new Set(MODOS_REF.map((m) => m[0]));
  try { const g = typeof localStorage !== 'undefined' && localStorage.getItem('domoplano.refent'); if (g) { const a = JSON.parse(g); if (Array.isArray(a)) snapModos = new Set(a.filter((k) => MODOS_REF.some((m) => m[0] === k))); } } catch (e) { /* sin almacenamiento */ }
  function guardarModos() { try { if (typeof localStorage !== 'undefined') localStorage.setItem('domoplano.refent', JSON.stringify([...snapModos])); } catch (e) { /* sin almacenamiento */ } pintarPanelRef(); }
  const textoModos = () => (snapModos.size ? MODOS_REF.filter((m) => snapModos.has(m[0])).map((m) => m[1]).join(', ') : 'ninguno');
  /** Cambia los modos con un texto: «FIN,MED,INT» (solo esos) · «+PER» / «-TAN» · TODOS · NINGUNO. Devuelve el mensaje o un error. */
  function ponerModos(t) {
    const T = String(t || '').toUpperCase().trim(); if (!T) return null;
    if (/^(TODOS|TODO|T)$/.test(T)) { snapModos = new Set(MODOS_REF.map((m) => m[0])); guardarModos(); return `Refent: ${textoModos()}.`; }
    if (/^(NINGUNO|NADA|N)$/.test(T)) { snapModos = new Set(); guardarModos(); return 'Refent: ningún modo (no engancha).'; }
    const partes = T.split(/[\s,;]+/).filter(Boolean); const nuevos = new Set(snapModos); let reemplazo = null;
    for (const q of partes) {
      const sg = q[0] === '+' ? 1 : q[0] === '-' ? -1 : 0; const nom = sg ? q.slice(1) : q;
      const NOMBRES = { FINAL: 'end', END: 'end', ENDPOINT: 'end', MEDIO: 'mid', MID: 'mid', MIDPOINT: 'mid', CENTRO: 'cen', CENTER: 'cen', CUADRANTE: 'quad', QUA: 'quad', QUAD: 'quad', QUADRANT: 'quad',
        INSERCION: 'ins', INSERCIÓN: 'ins', INSERT: 'ins', INTERSECCION: 'int', INTERSECCIÓN: 'int', INTERSECTION: 'int', PERPENDICULAR: 'per', TANGENTE: 'tan', TANGENT: 'tan' };
      const k = MODOS_REF.find((x) => x[1] === nom) ? MODOS_REF.find((x) => x[1] === nom)[0] : NOMBRES[nom] || (MODOS_REF.find((x) => x[0].toUpperCase() === nom) || [])[0];
      const m = k && MODOS_REF.find((x) => x[0] === k); if (!m) return { error: `Modo no válido: «${q}». Use ${MODOS_REF.map((x) => x[1]).join(', ')}, TODOS o NINGUNO.` };
      if (sg > 0) nuevos.add(m[0]); else if (sg < 0) nuevos.delete(m[0]); else (reemplazo = reemplazo || new Set()).add(m[0]);
    }
    snapModos = reemplazo || nuevos; if (snapModos.size && !snapOn) snapOn = true; guardarModos(); updateToggles();
    return `Refent: ${textoModos()}.`;
  }
  function pintarPanelRef() {
    if (typeof document === 'undefined') return; const pan = document.getElementById('cSnapPanel'); if (!pan) return;
    pan.querySelectorAll('input[data-m]').forEach((i) => { i.checked = snapModos.has(i.dataset.m); });
  }
  function armarPanelRef() {
    if (typeof document === 'undefined') return; const b = document.getElementById('cSnapM'), pan = document.getElementById('cSnapPanel'); if (!b || !pan || pan.dataset.ok) return;
    pan.dataset.ok = '1';
    pan.innerHTML = '<b>Refent: modos</b>' + MODOS_REF.map(([k, c, n]) => `<label><input type="checkbox" data-m="${k}"> ${n} (${c})</label>`).join('') +
      '<div><button data-t="TODOS">Todos</button> <button data-t="NINGUNO">Ninguno</button></div>';
    pan.addEventListener('change', (e) => { const i = e.target; if (!i.dataset || !i.dataset.m) return; if (i.checked) snapModos.add(i.dataset.m); else snapModos.delete(i.dataset.m); if (snapModos.size) snapOn = true; guardarModos(); updateToggles(); });
    pan.addEventListener('click', (e) => { const t = e.target.dataset && e.target.dataset.t; if (t) { say(ponerModos(t)); } });
    b.onclick = () => { const r = b.getBoundingClientRect(); pan.style.left = Math.max(8, r.left - 120) + 'px'; pan.style.display = pan.style.display === 'block' ? 'none' : 'block'; pintarPanelRef(); };
    pintarPanelRef();
  }
  let box = null;            // selección por ventana {sx,sy,ex,ey}
  let textH = 2.5;
  let textJust = 'I';        // justificación del próximo TEXTO (I, C, D, M, SI … AJ)
  const hist = [];

  const $ = (id) => document.getElementById(id);
  const enabled = () => !!(H && H.doc() && H.doc().dxf && H.page() && H.page().edit);

  // ---------------------------------------------------------------- coordenadas
  const mulPt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function localToScreen(x, y) { const [px, py] = mulPt(H.page().rootM, x, y); return H.toScreen(px, py); }
  function screenToLocal(sx, sy) { const [px, py] = H.toPage(sx, sy); return mulPt(Scene.inv(H.page().rootM), px, py); }
  const unitsPerPx = () => { const m = H.page().rootM; return 1 / (H.zoom() * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))); };

  // ---------------------------------------------------------------- mensajes
  let oyente = null;          // F4: el MCP «domoplano» recoge los mensajes de la línea de comandos
  function say(t) { hist.push(t); while (hist.length > 3) hist.shift(); $('cHist').textContent = hist.join('\n'); if (oyente) oyente(t); }
  function prompt(t) { $('cPrompt').textContent = t; }
  function idlePrompt() { prompt(enabled() ? 'Comando:' : ''); }

  // ---------------------------------------------------------------- entidades visibles de la hoja
  function topNodes() { const n = H.page().editNode; return n && n.ch ? n.ch.filter((c) => c.rec && !c.rec.deleted) : []; }

  // Los trazos de la hoja pueden ir restando un origen local (planos georreferenciados): coordenadas de nodo = WCS − origen
  const org = () => (H.page() && H.page().editOrigin) || [0, 0];

  let hitCtx = null;
  function hit(lx, ly) {
    const tol = 5 * unitsPerPx();
    const [o0, o1] = org(); lx -= o0; ly -= o1;
    if (!hitCtx) hitCtx = document.createElement('canvas').getContext('2d');
    let best = null, bestA = Infinity, bestStroke = false;
    for (const n of topNodes()) {
      const b = n.bb;
      if (lx < b[0] - tol || lx > b[2] + tol || ly < b[1] - tol || ly > b[3] + tol) continue;
      let ok = false, stroke = false;
      if (n.k === 'p') {
        hitCtx.lineWidth = tol * 2;
        if (n.stroke && hitCtx.isPointInStroke(n.p, lx, ly)) { ok = true; stroke = true; }
        else if (n.fill && hitCtx.isPointInPath(n.p, lx, ly, n.rule || 'nonzero')) ok = true;
      } else if (n.k === 'h') ok = hitCtx.isPointInPath(n.p, lx, ly, 'evenodd');
      else ok = true; // textos, bloques, imágenes: por su caja
      if (!ok) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]) + (stroke ? 0 : 1e-9);
      if ((stroke && !bestStroke) || (stroke === bestStroke && a < bestA)) { best = n; bestA = a; bestStroke = stroke; }
    }
    if (!best && typeof Geom !== 'undefined') { // respaldo geométrico (sin lienzo: MCP sin app) — distancia a los bordes
      let bd = tol;
      for (const n of topNodes()) {
        const b = n.bb; if (lx < b[0] - tol || lx > b[2] + tol || ly < b[1] - tol || ly > b[3] + tol) continue;
        let E = []; try { E = Geom.edges(n.rec); } catch (e) { E = []; }
        for (const ed of E) {
          let d;
          if (ed.k === 'seg') { const dx = ed.b[0] - ed.a[0], dy = ed.b[1] - ed.a[1], L2 = dx * dx + dy * dy || 1e-30; const t = Math.max(0, Math.min(1, ((lx + o0 - ed.a[0]) * dx + (ly + o1 - ed.a[1]) * dy) / L2)); d = Math.hypot(ed.a[0] + dx * t - lx - o0, ed.a[1] + dy * t - ly - o1); }
          else { const a = Math.atan2(ly + o1 - ed.c[1], lx + o0 - ed.c[0]); if (!onArcE(ed, a)) continue; d = Math.abs(Math.hypot(lx + o0 - ed.c[0], ly + o1 - ed.c[1]) - ed.r); }
          if (d <= bd) { bd = d; best = n; }
        }
      }
    }
    return best && !locked(best.rec) ? best.rec : null;
  }

  /** Referencia a objetos (Refent, F3): punto final, medio, centro, cuadrante, inserción, INTERSECCIÓN, PERPENDICULAR y
   *  TANGENTE (las dos últimas desde el punto anterior del comando), con prioridad intersección › final › medio › centro. */
  function findSnap(lx, ly) {
    if (!snapOn || !snapModos.size) return null;
    const tol = 10 * unitsPerPx();
    let best = null, bd = tol;
    const [o0, o1] = org(); const nx = lx - o0, ny = ly - o1;
    const cerca = [];
    for (const n of topNodes()) {
      const b = n.bb;
      if (nx < b[0] - tol || nx > b[2] + tol || ny < b[1] - tol || ny > b[3] + tol) continue;
      cerca.push(n.rec);
      for (const p of Edit.snapPoints(n.rec)) {
        if (!snapModos.has(p.kind)) continue;
        const d = Math.hypot(p.x - lx, p.y - ly);
        if (d < bd) { bd = d; best = p; }
      }
    }
    if (typeof Geom === 'undefined' || cerca.length > 400) return best;
    const E = []; for (const r of cerca) { try { for (const e of Geom.edges(r)) E.push(e); } catch (e) { /* tipo sin bordes */ } }
    // intersección (gana a los demás si está a la misma distancia o un poco más lejos)
    if (snapModos.has('int')) for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) for (const q of cruces(E[i], E[j])) {
      const d = Math.hypot(q[0] - lx, q[1] - ly);
      if (d < tol && (!best || d * 0.7 < bd)) { bd = d * 0.7; best = { x: q[0], y: q[1], kind: 'int' }; }
    }
    // perpendicular y tangente desde el punto anterior: compiten por cercanía con los demás (antes solo salían si no había
    // otro punto cerca, M-15); la intersección conserva su ventaja.
    const base = cmd && (cmd.base || (cmd.pts && cmd.pts[cmd.pts.length - 1]));
    if (!base || (!snapModos.has('per') && !snapModos.has('tan')) || (best && best.kind === 'int')) return best;
    const conPer = snapModos.has('per'), conTan = snapModos.has('tan');
    for (const e of E) {
      if (e.k === 'seg') {
        const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L2 = dx * dx + dy * dy; if (L2 < 1e-20) continue;
        const t = ((base[0] - e.a[0]) * dx + (base[1] - e.a[1]) * dy) / L2; if (t < -1e-9 || t > 1 + 1e-9) continue;
        const q = [e.a[0] + t * dx, e.a[1] + t * dy]; const d = Math.hypot(q[0] - lx, q[1] - ly);
        if (conPer && d < bd) { bd = d; best = { x: q[0], y: q[1], kind: 'per' }; }
      } else {
        const vx = base[0] - e.c[0], vy = base[1] - e.c[1], D = Math.hypot(vx, vy);
        if (conPer && D > 1e-12) for (const sg of [1, -1]) { // perpendicular: sobre la recta base–centro
          const a = Math.atan2(sg * vy, sg * vx); const q = [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)];
          if (!onArcE(e, a)) continue; const d = Math.hypot(q[0] - lx, q[1] - ly); if (d < bd) { bd = d; best = { x: q[0], y: q[1], kind: 'per' }; }
        }
        if (conTan && D > e.r + 1e-12) { // tangente desde el punto base
          const g = Math.atan2(vy, vx), h = Math.acos(e.r / D);
          for (const a of [g + h, g - h]) { if (!onArcE(e, a)) continue; const q = [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]; const d = Math.hypot(q[0] - lx, q[1] - ly); if (d < bd) { bd = d; best = { x: q[0], y: q[1], kind: 'tan' }; } }
        }
      }
    }
    return best;
  }
  const onArcE = (e, a) => e.full || Geom.n2(a - e.a0) <= Geom.n2(e.a1 - e.a0) + 1e-9;
  /** Puntos donde se cruzan dos bordes (segmentos y arcos, dentro de sus límites). */
  function cruces(e1, e2) {
    if (e1.k !== 'seg' && e2.k === 'seg') [e1, e2] = [e2, e1];
    if (e1.k === 'seg') return Geom.lineHits(e1.a, e1.b, e2).filter((h) => h.t >= -1e-9 && h.t <= 1 + 1e-9).map((h) => [h.x, h.y]);
    return Geom.circleHits(e1.c, e1.r, e2).filter((a) => onArcE(e1, a)).map((a) => [e1.c[0] + e1.r * Math.cos(a), e1.c[1] + e1.r * Math.sin(a)]);
  }

  function applyOrtho(x, y) {
    const base = cmd && cmd.base;
    if (!orthoOn || !base) return [x, y];
    return Math.abs(x - base[0]) > Math.abs(y - base[1]) ? [x, base[1]] : [base[0], y];
  }

  // ---------------------------------------------------------------- selección
  // R2-fix M-10: como AutoCAD, al terminar MOVER/COPIA/GIRA/ESCALA se suelta la designación (para que un «E» seguido no
  // borre lo recién movido). Queda guardada como «Previo»: en cualquier «Designe objetos» se retoma escribiendo P.
  let prevSel = [];
  function soltarSel() { const v = [...sel].filter((r) => !r.deleted); if (v.length) prevSel = v; setSel([]); }
  function setSel(recs, add) {
    if (!add) { for (const r of sel) if (r.node) r.node.sel = false; sel.clear(); }
    for (const r of recs) { sel.add(r); if (r.node) r.node.sel = true; }
    H.redraw(true);
    if (H.selectionChanged) H.selectionChanged(sel.size);
    renderProps();
  }
  function refreshSelFlags() { for (const r of [...sel]) { if (r.deleted) sel.delete(r); else if (r.node) r.node.sel = true; } }

  // ---------------------------------------------------------------- crear entidades
  const L = () => { const n = S ? S.capaActual() : '0'; return S && S.findRec('LAYER', n) ? n : '0'; };
  function addLine(a, b) { return S.add(H.page(), 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], L()); }
  function addPoly(pts, closed) {
    const body = [[90, pts.length], [70, closed ? 1 : 0], [43, 0]];
    for (const p of pts) body.push([10, p[0]], [20, p[1]]);
    return S.add(H.page(), 'LWPOLYLINE', 'AcDbPolyline', body, L());
  }
  function addCircle(c, r) { return S.add(H.page(), 'CIRCLE', 'AcDbCircle', [[10, c[0]], [20, c[1]], [30, 0], [40, r]], L()); }
  function addText(p, h, rot, str, p2) {
    const st = S.estiloActual();
    const body = Documento.textoPares(p, h, rot, str, { just: textJust, style: S.findRec('STYLE', st) ? st : null, p2 });
    return S.add(H.page(), 'TEXT', 'AcDbText', body, L());
  }

  // ---------------------------------------------------------------- comandos
  const ALIAS = {
    L: 'LINEA', LINEA: 'LINEA', LINE: 'LINEA',
    PL: 'POLILINEA', POL: 'POLILINEA', POLILINEA: 'POLILINEA', PLINE: 'POLILINEA',
    C: 'CIRCULO', CI: 'CIRCULO', CIRCULO: 'CIRCULO', CIRCLE: 'CIRCULO',
    A: 'ARCO', ARCO: 'ARCO', ARC: 'ARCO',
    REC: 'RECTANG', RECTANG: 'RECTANG', RECTANGULO: 'RECTANG', RECTÁNGULO: 'RECTANG', RECTANGLE: 'RECTANG',
    T: 'TEXTO', DT: 'TEXTO', TEXTO: 'TEXTO', TEXT: 'TEXTO',
    M: 'DESPLAZA', D: 'DESPLAZA', DESPLAZA: 'DESPLAZA', MOVER: 'DESPLAZA', MOVE: 'DESPLAZA',
    CO: 'COPIA', CP: 'COPIA', COPIA: 'COPIA', COPY: 'COPIA',
    E: 'BORRA', B: 'BORRA', BORRA: 'BORRA', BORRAR: 'BORRA', ERASE: 'BORRA', SUPR: 'BORRA',
    H: 'DESHACER', U: 'DESHACER', DESHACER: 'DESHACER', UNDO: 'DESHACER',
    REHACER: 'REHACER', REDO: 'REHACER', RH: 'REHACER',
    DI: 'DIST', DIST: 'DIST',
    ZE: 'ZOOMEX', ZOOMEX: 'ZOOMEX', AJ: 'ZOOMEX', Z: 'ZOOM', ZOOM: 'ZOOM', ZV: 'ZOOMV', ZW: 'ZOOMV', ZP: 'ZOOMP',
    CA: 'CAPA', CAPA: 'CAPA', LA: 'CAPA', LAYER: 'CAPA',
    GUARDAR: 'GUARDAR', SAVE: 'GUARDAR', QSAVE: 'GUARDAR', GU: 'GUARDAR',
    RO: 'GIRA', GI: 'GIRA', GIRA: 'GIRA', ROTATE: 'GIRA', ROTAR: 'GIRA',
    ES: 'ESCALA', SC: 'ESCALA', ESCALA: 'ESCALA', SCALE: 'ESCALA',
    S: 'ESTIRA', EI: 'ESTIRA', ESTIRA: 'ESTIRA', STRETCH: 'ESTIRA',
    TR: 'RECORTA', RECORTA: 'RECORTA', RECORTAR: 'RECORTA', TRIM: 'RECORTA',
    EX: 'ALARGA', AL: 'ALARGA', ALARGA: 'ALARGA', ALARGAR: 'ALARGA', EXTEND: 'ALARGA',
    O: 'DESFASE', EQ: 'DESFASE', DF: 'DESFASE', DESFASE: 'DESFASE', EQUIDIST: 'DESFASE', OFFSET: 'DESFASE',
    I: 'INSERTAR', INS: 'INSERTAR', INSERTAR: 'INSERTAR', INSERT: 'INSERTAR', INSERTARBLOQUE: 'INSERTAR',
    NUEVO: 'NUEVO', NEW: 'NUEVO', NU: 'NUEVO', QNEW: 'NUEVO',
    PR: 'PROPIEDADES', PROPIEDADES: 'PROPIEDADES', PROPERTIES: 'PROPIEDADES', PROPS: 'PROPIEDADES',
    CAMBIAPROP: 'CAMBIAPROP', CHPROP: 'CAMBIAPROP', CPR: 'CAMBIAPROP', CAMBIAR: 'CAMBIAPROP', CH: 'CAMBIAPROP',
    MA: 'IGUALARPROP', IP: 'IGUALARPROP', IGUALARPROP: 'IGUALARPROP', MATCHPROP: 'IGUALARPROP',
    TL: 'TIPOLIN', LT: 'TIPOLIN', TIPOLIN: 'TIPOLIN', LINETYPE: 'TIPOLIN',
    ESCALATL: 'ESCALATL', LTS: 'ESCALATL', LTSCALE: 'ESCALATL', ETL: 'ESCALATL',
    ED: 'EDITATEXTO', ET: 'EDITATEXTO', EDITATEXTO: 'EDITATEXTO', DDEDIT: 'EDITATEXTO', TEXTEDIT: 'EDITATEXTO', EDITTEXT: 'EDITATEXTO',
    ST: 'ESTILO', EST: 'ESTILO', ESTILO: 'ESTILO', STYLE: 'ESTILO',
    REVISION: 'REVISION', AUDIT: 'REVISION', AUDITAR: 'REVISION',
    PU: 'LIMPIA', LIMPIA: 'LIMPIA', PURGE: 'LIMPIA', LIMPIAR: 'LIMPIA',
    EXPORTARDWF: 'EXPORTARDWF', EXPDWF: 'EXPORTARDWF', DWF: 'EXPORTARDWF', DWFOUT: 'EXPORTARDWF', EXPORTDWF: 'EXPORTARDWF', EXPORTAR: 'EXPORTARDWF',
    // H2: salidas EPM
    EXPORTARPDF: 'EXPORTARPDF', PDF: 'EXPORTARPDF', TRAZAR: 'EXPORTARPDF', PLOT: 'EXPORTARPDF', EXPORTPDF: 'EXPORTARPDF', EXPPDF: 'EXPORTARPDF', IMPRIMIR: 'EXPORTARPDF',
    IMAGEN: 'IMAGEN', IMAGE: 'IMAGEN', IMAGEATTACH: 'IMAGEN', IM: 'IMAGEN', IMG: 'IMAGEN', ADJUNTARIMAGEN: 'IMAGEN', FIRMA: 'IMAGEN',
    LWDISPLAY: 'LWDISPLAY', GL: 'LWDISPLAY', VERGROSOR: 'LWDISPLAY', GROSORLIN: 'LWDISPLAY', MOSTRARGROSOR: 'LWDISPLAY', LWD: 'LWDISPLAY',
    GROSORES: 'GROSORES', GROSORESCAPA: 'GROSORES', TABLAGROSORES: 'GROSORES',
    // H3: dibujo EPM
    SOMBREA: 'SOMBREA', SOMBREAR: 'SOMBREA', HATCH: 'SOMBREA', SB: 'SOMBREA', BH: 'SOMBREA', SH: 'SOMBREA', RELLENO: 'SOMBREA',
    COTALIN: 'COTALIN', DIMLINEAR: 'COTALIN', DLI: 'COTALIN', CL: 'COTALIN', COTA: 'COTALIN', DIM: 'COTALIN',
    COTAALINEADA: 'COTAALINEADA', DIMALIGNED: 'COTAALINEADA', DAL: 'COTAALINEADA', COTAALI: 'COTAALINEADA',
    COTAANG: 'COTAANG', COTAANGULAR: 'COTAANG', DIMANGULAR: 'COTAANG', DAN: 'COTAANG',
    COTARADIO: 'COTARADIO', DIMRADIUS: 'COTARADIO', DRA: 'COTARADIO', CR: 'COTARADIO',
    COTADIAM: 'COTADIAM', COTADIAMETRO: 'COTADIAM', DIMDIAMETER: 'COTADIAM', DDI: 'COTADIAM', CD: 'COTADIAM',
    DIRECTRIZ: 'DIRECTRIZ', LEADER: 'DIRECTRIZ', LE: 'DIRECTRIZ', QLEADER: 'DIRECTRIZ', MLEADER: 'DIRECTRIZ', MLD: 'DIRECTRIZ', DIRECTRIZM: 'DIRECTRIZ', LLAMADA: 'DIRECTRIZ',
    ESTILOCOTA: 'ESTILOCOTA', DIMSTYLE: 'ESTILOCOTA', DST: 'ESTILOCOTA', ESTCOTA: 'ESTILOCOTA', DDIM: 'ESTILOCOTA',
    BLOQUE: 'BLOQUE', BLOCK: 'BLOQUE', BL: 'BLOQUE', CREARBLOQUE: 'BLOQUE', BMAKE: 'BLOQUE',
    ATRDEF: 'ATRDEF', ATTDEF: 'ATRDEF', ATT: 'ATRDEF', DEFATR: 'ATRDEF', ATRIBUTO: 'ATRDEF',
    DESCOMPONER: 'DESCOMPONER', EXPLODE: 'DESCOMPONER', X: 'DESCOMPONER', DESCOMP: 'DESCOMPONER', DS: 'DESCOMPONER',
    SIMETRIA: 'SIMETRIA', SIMETRÍA: 'SIMETRIA', MIRROR: 'SIMETRIA', MI: 'SIMETRIA', SI: 'SIMETRIA', ESPEJO: 'SIMETRIA',
    EMPALME: 'EMPALME', FILLET: 'EMPALME', F: 'EMPALME', EM: 'EMPALME',
    CHAFLAN: 'CHAFLAN', CHAFLÁN: 'CHAFLAN', CHAMFER: 'CHAFLAN', CHA: 'CHAFLAN',
    MATRIZ: 'MATRIZ', ARRAY: 'MATRIZ', AR: 'MATRIZ', ARRAYCLASSIC: 'MATRIZ', MATRIZRECT: 'MATRIZ', ARRAYRECT: 'MATRIZ', MATRIZPOLAR: 'MATRIZ', ARRAYPOLAR: 'MATRIZ',
    TABLA: 'TABLA', TABLE: 'TABLA', TB: 'TABLA', CUADRO: 'TABLA',
    // símbolos, redes, plantilla y verificador EPM
    INSERTARSIMBOLO: 'INSERTARSIMBOLO', SIMBOLO: 'INSERTARSIMBOLO', SIMB: 'INSERTARSIMBOLO', EPM: 'INSERTARSIMBOLO', SIMBOLOS: 'INSERTARSIMBOLO', SIMBOLOSEPM: 'INSERTARSIMBOLO',
    REDEPM: 'REDEPM', RED: 'REDEPM', REDES: 'REDEPM',
    PLANTILLAEPM: 'PLANTILLAEPM', NUEVOEPM: 'PLANTILLAEPM', PLANTILLA: 'PLANTILLAEPM',
    VERIFICAR: 'VERIFICAR', VERIF: 'VERIFICAR', REVISARTEXTOS: 'VERIFICAR', TEXTOSMONTADOS: 'VERIFICAR',
    // H6-E: comparar versiones (web/comparador.js) y lista de chequeo NC-RA8-001 (web/checklist_epm.js); interfaz en web/h6e_ui.js
    COMPARAR: 'COMPARAR', DWGCOMPARE: 'COMPARAR', COMPARE: 'COMPARAR', CMP: 'COMPARAR', VERSIONES: 'COMPARAR',
    CHECKEPM: 'CHECKEPM', CHECKLIST: 'CHECKEPM', LISTACHEQUEO: 'CHECKEPM', CHEQUEOEPM: 'CHECKEPM', RA8001: 'CHECKEPM', CHEQUEO: 'CHECKEPM',
    // H4: planchas, ventanas, escalas y rótulo
    PRESENTACION: 'PRESENTACION', PRESENTACIÓN: 'PRESENTACION', LAYOUT: 'PRESENTACION', LO: 'PRESENTACION', PLANCHA: 'PRESENTACION', PLANCHAS: 'PRESENTACION',
    CONFIGPAG: 'CONFIGPAG', PAGESETUP: 'CONFIGPAG', HOJA: 'CONFIGPAG', TAMANOHOJA: 'CONFIGPAG',
    VENTANAS: 'VENTANAS', VENTANA: 'VENTANAS', MVIEW: 'VENTANAS', MV: 'VENTANAS', VPORTS: 'VENTANAS', CREARVENTANA: 'VENTANAS',
    ESCALAVENTANA: 'ESCALAVENTANA', VESCALA: 'ESCALAVENTANA', VPSCALE: 'ESCALAVENTANA', ESCALAV: 'ESCALAVENTANA', VS: 'ESCALAVENTANA',
    VBLOQUEAR: 'VBLOQUEAR', BLOQUEARVENTANA: 'VBLOQUEAR', VPLOCK: 'VBLOQUEAR', VB: 'VBLOQUEAR',
    VPLAYER: 'VPLAYER', VCAPA: 'VPLAYER', CAPAVENTANA: 'VPLAYER', CONGELARVENTANA: 'VPLAYER', VPCAPA: 'VPLAYER',
    VGIRO: 'VGIRO', GIRARVISTA: 'VGIRO', VPROTATE: 'VGIRO', GIRARVENTANA: 'VGIRO', DVIEW: 'VGIRO',
    ESPACIOM: 'ESPACIOM', MS: 'ESPACIOM', MSPACE: 'ESPACIOM', MSPACIO: 'ESPACIOM', ESPACIOP: 'ESPACIOP', PS: 'ESPACIOP', PSPACE: 'ESPACIOP', PSPACIO: 'ESPACIOP',
    ENCUADRE: 'ENCUADRE', PAN: 'ENCUADRE', ENC: 'ENCUADRE', '-PAN': 'ENCUADRE',
    ESCALAANOT: 'ESCALAANOT', CANNOSCALE: 'ESCALAANOT', ANOESCALA: 'ESCALAANOT', ESCALAANOTACION: 'ESCALAANOT',
    // H6-B: edición e inspección P2
    ID: 'ID', COORD: 'ID', PUNTO: 'ID', IDPUNTO: 'ID',
    AREA: 'AREA', ÁREA: 'AREA', AA: 'AREA', MEDIRAREA: 'AREA',
    LIST: 'LISTA', LI: 'LISTA', LS: 'LISTA', LISTA: 'LISTA', INFO: 'LISTA', LISTAR: 'LISTA',
    SELECSIMILAR: 'SELECSIMILAR', SELECTSIMILAR: 'SELECSIMILAR', SS: 'SELECSIMILAR', SIMILAR: 'SELECSIMILAR',
    SELECRAPIDA: 'SELECRAPIDA', SELECRÁPIDA: 'SELECRAPIDA', QSELECT: 'SELECRAPIDA', SR: 'SELECRAPIDA', FILTRO: 'SELECRAPIDA',
    UNIR: 'UNIR', JOIN: 'UNIR', J: 'UNIR', UN: 'UNIR',
    PARTIR: 'PARTIR', BREAK: 'PARTIR', BR: 'PARTIR', PARTIRENPUNTO: 'PARTIRENPUNTO', BREAKATPOINT: 'PARTIRENPUNTO',
    EDITPOL: 'EDITPOL', PEDIT: 'EDITPOL', PE: 'EDITPOL',
    SUPRIMEDUPL: 'SUPRIMEDUPL', OVERKILL: 'SUPRIMEDUPL', OV: 'SUPRIMEDUPL', DUPLICADOS: 'SUPRIMEDUPL',
    COBERTURA: 'COBERTURA', WIPEOUT: 'COBERTURA', WO: 'COBERTURA', TAPAR: 'COBERTURA', MASCARATEXTO: 'COBERTURA', TEXTMASK: 'COBERTURA',
    TEXTOM: 'TEXTOM', MTEXT: 'TEXTOM', MT: 'TEXTOM', TM: 'TEXTOM', TEXTOPARRAFO: 'TEXTOM',
    COPIAPORTA: 'COPIAPORTA', COPYCLIP: 'COPIAPORTA', PEGAPORTA: 'PEGAPORTA', PASTECLIP: 'PEGAPORTA', PEGAORIG: 'PEGAORIG', PASTEORIG: 'PEGAORIG',
    CANTIDADES: 'CANTIDADES', EXTRACCIONDATOS: 'CANTIDADES', DATAEXTRACTION: 'CANTIDADES', CONTAR: 'CANTIDADES', COUNT: 'CANTIDADES', BOM: 'CANTIDADES', EXTRAERDATOS: 'CANTIDADES',
    MAPAOSM: 'MAPAOSM', OSM: 'MAPAOSM', MAPA: 'MAPAOSM',
    REFENT: 'REFENT', RF: 'REFENT', OSNAP: 'REFENT', OS: 'REFENT', DDOSNAP: 'REFENT', OSMODE: 'REFENT', MODOSREF: 'REFENT',
    ROTULO: 'ROTULO', RÓTULO: 'ROTULO', CAJETIN: 'ROTULO', CAJETÍN: 'ROTULO', LLENARROTULO: 'ROTULO', DATOSROTULO: 'ROTULO', ROT: 'ROTULO',
  };
  /** R2-fix M-14: la lista de «Comando desconocido» se arma sola desde ALIAS (no se queda vieja) y sugiere parecidos. */
  const ATAJOS = { LINEA: 'L', POLILINEA: 'PL', CIRCULO: 'C', ARCO: 'A', RECTANG: 'REC', TEXTO: 'T', DESPLAZA: 'M', COPIA: 'CO', GIRA: 'RO', ESCALA: 'ES', ESTIRA: 'S',
    RECORTA: 'TR', ALARGA: 'EX', DESFASE: 'O', INSERTAR: 'I', BORRA: 'E', DESHACER: 'H', CAPA: 'CA', SOMBREA: 'SB', BLOQUE: 'BL', DESCOMPONER: 'X', SIMETRIA: 'MI',
    EMPALME: 'F', CHAFLAN: 'CHA', MATRIZ: 'AR', VENTANAS: 'MV', PRESENTACION: 'LO', ESPACIOM: 'MS', ESPACIOP: 'PS', UNIR: 'J', PARTIR: 'BR', EDITPOL: 'PE',
    SELECSIMILAR: 'SS', LISTA: 'LI', INSERTARSIMBOLO: 'EPM', LWDISPLAY: 'GL', EXPORTARPDF: 'PDF', REFENT: 'RF' };
  function mensajeDesconocido(t) {
    const T = String(t).toUpperCase();
    const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let pr = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, pr + (a[i - 1] === b[j - 1] ? 0 : 1)); pr = tmp; } } return d[b.length]; };
    const sug = [...new Set(Object.keys(ALIAS).filter((k) => k.length > 1 && (k.startsWith(T) || (T.length > 2 && lev(T, k) <= (T.length > 5 ? 2 : 1)))).map((k) => ALIAS[k]))].slice(0, 5);
    const todos = [...new Set(Object.values(ALIAS))].sort().map((n) => (ATAJOS[n] ? `${n} (${ATAJOS[n]})` : n));
    return `Comando desconocido: «${t}».` + (sug.length ? ` ¿Quiso decir ${sug.join(', ')}?` : '') + ` Comandos: ${todos.join(', ')}.`;
  }
  // comandos que primero piden designar objetos
  const SELECTS = new Set(['DESPLAZA', 'COPIA', 'BORRA', 'GIRA', 'ESCALA', 'ESTIRA', 'CAMBIAPROP', 'SIMETRIA', 'MATRIZ', 'DESCOMPONER', 'BLOQUE']);
  // comandos que piden un objeto con un clic (sin enganche)
  const PICKS = new Set(['RECORTA', 'ALARGA', 'EDITATEXTO', 'IGUALARPROP']);
  // comandos que solo se escriben (los clics no hacen nada)
  const TYPED = new Set(['REFENT', 'CAPA', 'TIPOLIN', 'ESCALATL', 'ESTILO', 'REVISION', 'LIMPIA', 'EXPORTARPDF', 'GROSORES']);
  let offsetDist = 1, lastBlock = null, insScale = 1, insRot = 0;

  function start(name) {
    if (!enabled()) { say('Abra un DXF para editar.'); return; }
    cancel(true);
    lastCmd = name;
    switch (name) {
      case 'LINEA': cmd = { name, pts: [], label: 'LINEA' }; prompt('LINEA  Precise primer punto:'); break;
      case 'POLILINEA': cmd = { name, pts: [], label: 'POLILINEA' }; prompt('POLILINEA  Precise punto inicial:'); break;
      case 'CIRCULO': cmd = { name, step: 0, label: 'CIRCULO' }; prompt('CIRCULO  Precise centro:'); break;
      case 'ARCO': cmd = { name, step: 0, pts: [], label: 'ARCO' }; prompt('ARCO  Precise el punto inicial o [Centro (C)]:'); break;
      case 'RECTANG': cmd = { name, step: 0, pts: [], label: 'RECTANG' }; prompt('RECTANG  Precise la primera esquina:'); break;
      case 'TEXTO': cmd = { name, step: 0, label: 'TEXTO' }; prompt(`TEXTO  Estilo «${S.estiloActual()}» · justificación ${Documento.NOMBRE_JUST[textJust]}. Precise punto de inserción o [Justificar (J)/Estilo (E)]:`); break;
      case 'DESPLAZA': case 'COPIA': case 'GIRA': case 'ESCALA':
        cmd = { name, step: sel.size ? 1 : 0, label: name };
        prompt(sel.size ? `${cmd.label}  ${sel.size} objeto(s). Precise punto base:` : `${cmd.label}  Designe objetos y pulse Enter:`); break;
      case 'ESTIRA':
        setSel([]);
        cmd = { name, step: 0, label: name };
        prompt('ESTIRA  Arrastre una ventana de derecha a izquierda sobre los puntos a estirar y pulse Enter:'); break;
      case 'RECORTA': cmd = { name, label: name }; prompt('RECORTA  Clic sobre la parte que sobra (cortan todos los objetos) [Enter para terminar]:'); break;
      case 'ALARGA': cmd = { name, label: name }; prompt('ALARGA  Clic cerca del extremo a alargar [Enter para terminar]:'); break;
      case 'DESFASE': cmd = { name, step: 0, label: name }; prompt(`DESFASE  Distancia de desfase <${offsetDist}>:`); break;
      case 'INSERTAR': {
        const names = H.doc().blockNames();
        if (!names.length) { say('Este dibujo no tiene bloques para insertar.'); idlePrompt(); break; }
        cmd = { name, step: 0, label: name };
        prompt(`INSERTAR  Nombre del bloque${lastBlock ? ` <${lastBlock}>` : ''} (? = lista, o elija en la paleta Bloques):`);
        break;
      }
      case 'BORRA':
        if (sel.size) { doErase(); cmd = null; idlePrompt(); }
        else { cmd = { name, step: 0, label: 'BORRA' }; prompt('BORRA  Designe objetos y pulse Enter:'); }
        break;
      case 'DESHACER': { const l = S.undo(); say(l ? `Deshecho: ${l}` : 'Nada que deshacer.'); afterEdit(); cmd = null; idlePrompt(); break; }
      case 'REHACER': { const l = S.redo(); say(l ? `Rehecho: ${l}` : 'Nada que rehacer.'); afterEdit(); cmd = null; idlePrompt(); break; }
      case 'DIST': cmd = { name, pts: [], label: 'DIST' }; prompt('DIST  Precise primer punto:'); break;
      case 'CAPA': startCapa(); break;
      case 'NUEVO': nuevo(); break;
      case 'PROPIEDADES': toggleProps(true); idlePrompt(); break;
      case 'CAMBIAPROP':
        cmd = { name, step: sel.size ? 1 : 0, label: name };
        if (sel.size) promptCambia(); else prompt('CAMBIAPROP  Designe objetos y pulse Enter:'); break;
      case 'IGUALARPROP':
        if (sel.size === 1) { cmd = { name, step: 1, label: name, src: [...sel][0] }; setSel([]); prompt('IGUALARPROP  Designe objetos de destino (clic) [Enter para terminar]:'); }
        else { cmd = { name, step: 0, label: name }; setSel([]); prompt('IGUALARPROP  Designe el objeto de origen:'); }
        break;
      case 'TIPOLIN': cmd = { name, label: name, text: true }; prompt(`TIPOLIN  Cargados: ${S.tiposCargados().join(', ')}. Tipo a cargar [${Object.keys(Documento.TIPOS).join('/')}] o ? = lista:`); break;
      case 'ESCALATL': cmd = { name, label: name }; prompt(`ESCALATL  Factor de escala global de tipos de línea <${S.hdrGet('$LTSCALE', 40, '1')}>:`); break;
      case 'EDITATEXTO':
        if (sel.size === 1 && S.textosDe([...sel][0]).length) { cmd = { name, label: name }; editarTextos([...sel][0]); }
        else { cmd = { name, step: 0, label: name }; prompt('EDITATEXTO  Designe un texto, texto de párrafo o bloque con atributos:'); }
        break;
      case 'ESTILO': cmd = { name, step: 0, label: name, text: true }; prompt(`ESTILO  Estilos: ${S.estilos().map((x) => x.name).join(', ')}. Nombre del estilo <${S.estiloActual()}>:`); break;
      case 'REVISION': cmd = { name, label: name }; prompt('REVISION  ¿Corregir los errores que se encuentren? [Sí/No] <N>:'); break;
      case 'LIMPIA': {
        const x = S.limpiable(); const n = x.capas.length + x.tipos.length + x.estilos.length + x.bloques.length;
        if (!n) { say('LIMPIA  No hay nada sin usar.'); idlePrompt(); break; }
        say(`Sin usar: ${x.capas.length} capa(s), ${x.tipos.length} tipo(s) de línea, ${x.estilos.length} estilo(s), ${x.bloques.length} bloque(s): ` +
          [...x.capas, ...x.tipos, ...x.estilos].map((r) => r.get(2).trim()).concat(x.bloques.map((b) => b.name)).slice(0, 30).join(', ') + (n > 30 ? '…' : ''));
        cmd = { name, label: name }; prompt(`LIMPIA  ¿Quitar los ${n} elementos sin usar? [Sí/No] <S>:`); break;
      }
      case 'GUARDAR': save(); break;
      case 'EXPORTARDWF': exportDwf(); break;
      case 'EXPORTARPDF': cmd = { name, step: 0, label: name }; prompt(`EXPORTARPDF  Colores [Mono(M)/Grises(G)/Color(C)] <${pdfColor[0].toUpperCase()}> (mono = todo negro, para EPM):`); break;
      case 'LWDISPLAY': { const on = window.domoLwDisplay ? window.domoLwDisplay() : (Scene.opts.lwDisplay = !Scene.opts.lwDisplay); if (!window.domoLwDisplay) say(`Grosores en pantalla ${on ? 'activados' : 'desactivados'}.`); idlePrompt(); break; }
      case 'GROSORES': cmd = { name, label: name }; prompt('GROSORES  Tabla de grosores por capa (PROPUESTA, la decide Sebastián). [Ver(V)/Aplicar a todas(A)/Solo capas Sin grosor(S)] <V>:'); break;
      case 'IMAGEN': startImagen(); break;
      case 'REFENT': cmd = { name, label: name, text: true }; prompt(`REFENT  Activos: ${textoModos()} (Refent ${snapOn ? 'prendido' : 'apagado'}, F3). Modos ${MODOS_REF.map((m) => m[1]).join(',')}: escriba los que quiere (ej. FIN,MED,INT), +PER / -TAN, TODOS o NINGUNO <Enter = sin cambios>:`); break;
      default: if (!h3Start(name) && !epmStart(name) && !h4Start(name) && !h6Start(name)) { say(mensajeDesconocido(name)); idlePrompt(); }
    }
    H.redraw(true);
  }

  function cancel(silent) {
    if (cmd && !silent) say(`${cmd.label} *Cancelado*`);
    if (cmd && cmd.hecho) soltarSel(); // COPIA terminada con Esc tras copiar: se suelta la designación (M-10)
    cmd = null; box = null; idlePrompt(); H.redraw(true);
  }

  function afterEdit() { markDirty(); return Promise.resolve(H.rebuild()).then(() => { refreshSelFlags(); H.redraw(true); }); }
  // hay cambios si la última operación no es la que estaba al guardar (deshacer hasta ahí = sin cambios)
  let savedTop = null;
  const topOp = () => (S && S.undoStack.length ? S.undoStack[S.undoStack.length - 1] : null);
  function markDirty() { if (S) S.changed = topOp() !== savedTop; if (H.setDirty) H.setDirty(!!(S && S.changed)); }

  function doErase() {
    const recs = [...sel];
    const n = S.erase(recs); setSel([]); afterEdit(); say(`${n} objeto(s) borrado(s).`);
  }

  /** Punto recibido (clic o escrito). */
  function point(p) {
    if (!cmd) return;
    const c = cmd;
    switch (c.name) {
      case 'LINEA': {
        if (c.pts.length) { addLine(c.pts[c.pts.length - 1], p); afterEdit(); }
        c.pts.push(p); c.base = p;
        prompt(c.pts.length >= 3 ? 'LINEA  Precise siguiente punto [Cerrar (C) / Enter para terminar]:' : 'LINEA  Precise siguiente punto [Enter para terminar]:');
        break;
      }
      case 'POLILINEA': c.pts.push(p); c.base = p; prompt('POLILINEA  Precise siguiente punto [Cerrar (C) / Enter para terminar]:'); break;
      case 'ARCO': arcoPunto(c, p); break;
      case 'RECTANG':
        if (c.step === 0) { c.a = p; c.base = p; c.step = 1; prompt('RECTANG  Precise la otra esquina (o @ancho,alto):'); }
        else { const a = c.a; if (Math.abs(p[0] - a[0]) < 1e-12 || Math.abs(p[1] - a[1]) < 1e-12) { say('El rectángulo necesita ancho y alto.'); break; } addPoly([a, [p[0], a[1]], p, [a[0], p[1]]], true); afterEdit(); cmd = null; idlePrompt(); }
        break;
      case 'CIRCULO':
        if (c.step === 0) { c.center = p; c.base = p; c.step = 1; prompt('CIRCULO  Precise radio (punto o número):'); }
        else { addCircle(c.center, Math.hypot(p[0] - c.center[0], p[1] - c.center[1])); afterEdit(); cmd = null; idlePrompt(); }
        break;
      case 'TEXTO':
        if (c.step === 0) {
          c.at = p;
          if (textJust === 'A' || textJust === 'AJ') { c.step = 'p2'; c.base = p; prompt('TEXTO  Precise el segundo punto de la línea base:'); break; }
          textoAltura(c);
        } else if (c.step === 'p2') {
          c.p2 = p;
          if (textJust === 'AJ') textoAltura(c); else { c.h = textH; c.rot = 0; c.step = 3; c.text = true; prompt('TEXTO  Escriba el texto:'); }
        }
        break;
      case 'EDITATEXTO': {
        const r = hit(p[0], p[1]);
        if (!r || !S.textosDe(r).length) { say('Ahí no hay un texto ni un bloque con atributos.'); break; }
        editarTextos(r); break;
      }
      case 'IGUALARPROP': {
        const r = hit(p[0], p[1]);
        if (!r) { say('No hay un objeto ahí.'); break; }
        if (c.step === 0) { c.src = r; c.step = 1; setSel([r]); const pp = Documento.propsDe(r); say(`Origen: ${r.type} · capa ${pp.layer} · ${Documento.nombreColor(pp.color)} · ${pp.ltype} · ${Documento.nombreGrosor(pp.lw)}`); prompt('IGUALARPROP  Designe objetos de destino (clic) [Enter para terminar]:'); }
        else { const res = S.igualarProps(c.src, [r]); if (res.error) say(res.error); else { afterEdit(); say('Propiedades igualadas.'); } }
        break;
      }
      case 'GIRA': case 'ESCALA':
        if (c.step === 1) { c.base = p; c.step = 2; prompt(c.name === 'GIRA' ? 'GIRA  Ángulo de rotación (grados o un punto):' : 'ESCALA  Factor de escala (número o un punto = distancia):'); }
        else if (c.step === 2) {
          const v = c.name === 'GIRA' ? Math.atan2(p[1] - c.base[1], p[0] - c.base[0]) * 180 / Math.PI : Math.hypot(p[0] - c.base[0], p[1] - c.base[1]);
          applyRotScale(v);
        }
        break;
      case 'ESTIRA':
        if (c.step === 1) { c.base = p; c.step = 2; prompt('ESTIRA  Precise segundo punto:'); }
        else if (c.step === 2) { doStretch(p[0] - c.base[0], p[1] - c.base[1]); }
        break;
      case 'RECORTA': case 'ALARGA': doTrimExtend(p); break;
      case 'DESFASE':
        if (c.step === 1) {
          const r = hit(p[0], p[1]);
          if (!r) { say('No hay un objeto ahí.'); break; }
          setSel([r]); c.obj = r; c.step = 2; prompt('DESFASE  Clic del lado hacia donde va la copia:');
        } else if (c.step === 2) {
          const res = Geom.offset(c.obj, offsetDist, p[0], p[1]);
          if (res.error) say(res.error);
          else { S.commit('Desfase', { adds: [S.clone(c.obj, res.type, res.pairs, H.page())] }); afterEdit(); }
          setSel([]); c.step = 1; prompt('DESFASE  Designe objeto [Enter para terminar]:');
        }
        break;
      case 'INSERTAR':
        if (c.step === 1) { c.at = p; c.step = 2; prompt(`INSERTAR  Escala <${insScale}>:`); }
        break;
      case 'DESPLAZA': case 'COPIA':
        if (c.step === 1) { c.base = p; c.step = 2; prompt(`${c.label}  Precise segundo punto:`); }
        else if (c.step === 2) {
          const dx = p[0] - c.base[0], dy = p[1] - c.base[1];
          const recs = [...sel];
          if (c.name === 'DESPLAZA') {
            const r = S.move(recs, dx, dy); soltarSel(); afterEdit();
            say(`${r.moved} objeto(s) desplazado(s).` + (r.refused.length ? ` No se pueden mover todavía: ${r.refused.join(', ')}.` : '') + ' (P en «Designe objetos» los vuelve a tomar)');
            cmd = null; idlePrompt();
          } else {
            const r = S.copy(recs, dx, dy, H.page()); c.hecho = true; afterEdit();
            say(`${r.copied} objeto(s) copiado(s).` + (r.refused.length ? ` No se pueden copiar todavía: ${r.refused.join(', ')}.` : ''));
            prompt('COPIA  Precise segundo punto [Enter para terminar]:'); // varias copias, como AutoCAD
          }
        }
        break;
      case 'IMAGEN': imagenPunto(c, p); break;
      case 'DIST':
        c.pts.push(p); c.base = c.pts[0];
        if (c.pts.length === 2) {
          const [a, b] = c.pts; const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
          say(`Distancia = ${d.toFixed(4)} ${H.page().units || ''}  ·  ΔX = ${(b[0] - a[0]).toFixed(4)}  ΔY = ${(b[1] - a[1]).toFixed(4)}  ·  ángulo ${ang.toFixed(2)}°`);
          cmd = null; idlePrompt();
        } else prompt('DIST  Precise segundo punto:');
        break;
      default: if (!h6Point(c, p) && !epmPoint(c, p) && !h4Point(c, p)) h3Point(c, p);
    }
    H.redraw(true);
  }

  /** Enter / espacio. */
  function enter() {
    if (!cmd) { if (lastCmd) start(lastCmd); return; }
    const c = cmd;
    if (h6Enter(c)) { H.redraw(true); return; }
    if (h4Enter(c)) { H.redraw(true); return; }
    if (h3Enter(c)) { H.redraw(true); return; }
    if (c.name === 'POLILINEA') { if (c.pts.length >= 2) { addPoly(c.pts, false); afterEdit(); } cmd = null; idlePrompt(); }
    else if (['DESPLAZA', 'COPIA', 'GIRA', 'ESCALA'].includes(c.name) && c.step === 0) {
      if (!sel.size) { say('No hay objetos designados.'); cancel(true); return; }
      c.step = 1; prompt(`${c.label}  ${sel.size} objeto(s). Precise punto base:`);
    } else if (c.name === 'ESTIRA' && c.step === 0) {
      if (!c.win) { say('Primero arrastre la ventana de derecha a izquierda.'); return; }
      c.step = 1; prompt(`ESTIRA  ${sel.size} objeto(s). Precise punto base:`);
    } else if (c.name === 'DESFASE' && c.step === 0) { c.step = 1; prompt(`DESFASE  Distancia ${offsetDist}. Designe objeto [Enter para terminar]:`); }
    else if (c.name === 'INSERTAR' && c.step === 0) { if (lastBlock) chooseBlock(lastBlock); else return; }
    else if (c.name === 'INSERTAR' && c.step === 2) { c.step = 3; prompt(`INSERTAR  Rotación <${insRot}>:`); }
    else if (c.name === 'INSERTAR' && c.step === 3) { doInsert(); } else if (c.name === 'BORRA') { if (sel.size) doErase(); cmd = null; idlePrompt(); }
    else if (c.name === 'TEXTO' && c.step === 1) { c.h = textH * (c.fAnot || 1); textoRot(c); }
    else if (c.name === 'TEXTO' && c.step === 2) { c.rot = 0; c.step = 3; c.text = true; prompt('TEXTO  Escriba el texto:'); }
    else if (c.name === 'CAMBIAPROP' && c.step === 0) { if (!sel.size) { say('No hay objetos designados.'); cancel(true); return; } c.step = 1; promptCambia(); }
    else { if (c.hecho) soltarSel(); cmd = null; idlePrompt(); }
    H.redraw(true);
  }

  /** Texto escrito en la línea de comandos. */
  function input(raw) {
    const t = raw.trim();
    if (!cmd) {
      if (!t) { enter(); return; }
      const name = ALIAS[t.toUpperCase()];
      if (name) start(name); else say(mensajeDesconocido(t));
      return;
    }
    const c = cmd;
    // R2-fix M-10: «P» (Previo) en «Designe objetos» retoma lo último movido/copiado/girado/escalado
    if (((SELECTS.has(c.name) && c.step === 0) || c.selecting) && /^(P|PREVIO|PREVIOUS)$/i.test(t)) {
      const v = prevSel.filter((r) => !r.deleted);
      if (!v.length) say('No hay designación previa.'); else { setSel(v, true); say(`Previo: ${v.length} objeto(s) designado(s). ${sel.size} en total; pulse Enter.`); }
      return;
    }
    // H6-A M-5: en «Designe objetos» un punto escrito (x,y) elige el objeto que hay ahí (o lo quita si ya estaba)
    if (((SELECTS.has(c.name) && c.step === 0) || c.selecting) && /^-?[\d.]+\s*,\s*-?[\d.]+$/.test(t)) {
      const q = parsePoint(t); const r = q && hit(q[0], q[1]);
      if (!r) say(`No hay ningún objeto en ${t}. Haga clic sobre el objeto o escriba un punto que lo toque.`);
      else if (sel.has(r)) { sel.delete(r); if (r.node) r.node.sel = false; H.redraw(true); say(`Quitado: ${r.type}. ${sel.size} objeto(s) designado(s).`); }
      else { setSel([r], true); say(`Designado: ${r.type} de la capa «${(r.get(8, '0') || '').trim()}». ${sel.size} objeto(s).`); }
      return;
    }
    if (c.name === 'REFENT') { const r = ponerModos(t); if (r && r.error) { say(r.error); return; } say(r || `Refent sin cambios: ${textoModos()}.`); cmd = null; idlePrompt(); return; }
    // comandos del hito H1 (capas, propiedades, estilos, texto, revisión, limpieza)
    if (h1Input(c, t, raw)) return;
    if (h2Input(c, t, raw)) return;
    if (h3Input(c, t, raw)) return;
    if (epmInput(c, t, raw)) return;
    if (h4Input(c, t, raw)) return;
    if (h6Input(c, t, raw)) return;
    if (c.name === 'ARCO' && c.step === 0 && /^c$/i.test(t)) { c.centro = true; prompt('ARCO  Precise el centro:'); return; }
    if (c.name === 'INSERTAR' && c.step === 0 && t) {
      if (t === '?') { say('Bloques: ' + H.doc().blockNames().join(', ')); return; }
      const found = H.doc().blockNames().find((n) => n.toUpperCase() === t.toUpperCase());
      if (found) chooseBlock(found); else say(`No existe el bloque «${t}». Escriba ? para ver la lista.`);
      return;
    }
    const numIn = t ? parseFloat(t.replace(',', '.')) : NaN;
    if (c.name === 'INSERTAR' && c.step === 2 && t) { if (numIn > 0) { insScale = numIn; if (c.block && !esSimboloEPM(c.block.name)) escalaPropia.set(c.block.name.toUpperCase(), numIn); c.step = 3; prompt(`INSERTAR  Rotación <${insRot}>:`); } else say('Escriba un factor mayor que 0.'); H.redraw(); return; }
    if (c.name === 'INSERTAR' && c.step === 3 && t) { if (Number.isFinite(numIn)) { insRot = numIn; doInsert(); } else say('Escriba el ángulo en grados.'); return; }
    if (c.name === 'INSERTAR' && c.step >= 4) { attrValue(raw); return; }
    if (c.name === 'DESFASE' && c.step === 0 && t) { if (numIn > 0) { offsetDist = numIn; c.step = 1; prompt(`DESFASE  Distancia ${offsetDist}. Designe objeto [Enter para terminar]:`); } else say('Escriba una distancia mayor que 0.'); return; }
    if ((c.name === 'GIRA' || c.name === 'ESCALA') && c.step === 2 && /^-?[\d.,]+$/.test(t)) { applyRotScale(numIn); return; }
    if (c.name === 'TEXTO') {
      if (c.step === 0 && /^j$/i.test(t)) { c.step = 'J'; prompt('TEXTO  Justificación [Izquierda(I)/Centro(C)/Derecha(D)/Medio(M)/Alinear(A)/aJustar(AJ)/SI/SC/SD/MI/MC/MD/II/IC/ID] <' + textJust + '>:'); return; }
      if (c.step === 'J') { const k = t.toUpperCase(); if (!t) { start('TEXTO'); return; } if (Documento.JUST[k]) { textJust = k; start('TEXTO'); } else say(`Opción no válida: «${t}».`); return; }
      if (c.step === 0 && /^e$/i.test(t)) { c.step = 'E'; c.text = true; prompt(`TEXTO  Estilo [${S.estilos().map((x) => x.name).join('/')}] <${S.estiloActual()}>:`); return; }
      if (c.step === 'E') { if (t) { const r = S.estiloActualA(t); if (r.error) { say(r.error); return; } } start('TEXTO'); return; }
      if (c.step === 1) { if (t) { const v = parseFloat(t.replace(',', '.')); if (v > 0) textH = v; } c.h = textH * (c.fAnot || 1); textoRot(c); return; }
      if (c.step === 2) { c.rot = t ? parseFloat(t.replace(',', '.')) || 0 : 0; c.step = 3; c.text = true; prompt('TEXTO  Escriba el texto:'); return; }
      if (c.step === 3) { if (raw.length) { addText(c.at, c.h, c.rot, raw, c.p2); afterEdit(); } cmd = null; idlePrompt(); H.redraw(true); return; }
    }
    if (!t) { enter(); return; }
    if ((c.name === 'LINEA' || c.name === 'POLILINEA') && /^c$/i.test(t)) {
      if (c.name === 'LINEA' && c.pts.length >= 3) { addLine(c.pts[c.pts.length - 1], c.pts[0]); afterEdit(); }
      if (c.name === 'POLILINEA' && c.pts.length >= 3) { addPoly(c.pts, true); afterEdit(); }
      cmd = null; idlePrompt(); H.redraw(true); return;
    }
    if (c.name === 'CIRCULO' && c.step === 1 && /^[\d.,]+$/.test(t)) { addCircle(c.center, parseFloat(t.replace(',', '.'))); afterEdit(); cmd = null; idlePrompt(); H.redraw(true); return; }
    const p = parsePoint(t);
    if (p) point(p); else say(`Entrada no válida: «${t}». Use x,y · @dx,dy · @distancia<ángulo · o una distancia.`);
  }

  // x,y   @dx,dy   @d<a   d (distancia en la dirección del cursor)
  function parsePoint(t) {
    const base = cmd && (cmd.base || (cmd.pts && cmd.pts[cmd.pts.length - 1]));
    let m;
    if ((m = /^@\s*(-?[\d.]+)\s*<\s*(-?[\d.]+)$/.exec(t)) && base) { const d = +m[1], a = +m[2] * Math.PI / 180; return [base[0] + d * Math.cos(a), base[1] + d * Math.sin(a)]; }
    if ((m = /^@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(t)) && base) return [base[0] + +m[1], base[1] + +m[2]];
    if ((m = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(t))) return [+m[1], +m[2]];
    if ((m = /^(-?[\d.]+)$/.exec(t)) && base && cursor) { // distancia directa hacia el cursor
      const d = +m[1]; const dx = cursor[0] - base[0], dy = cursor[1] - base[1], L0 = Math.hypot(dx, dy) || 1;
      return [base[0] + d * dx / L0, base[1] + d * dy / L0];
    }
    return null;
  }

  // ---------------------------------------------------------------- operaciones nuevas (F3)
  function applyRotScale(v) {
    const c = cmd; const recs = [...sel];
    if (c.name === 'GIRA') { const r = S.rotate(recs, c.base, v); say(`${r.done} objeto(s) girado(s) ${+v.toFixed(4)}°.` + (r.refused.length ? ` No se pueden girar todavía: ${r.refused.join(', ')}.` : '')); }
    else {
      if (!(v > 0)) { say('El factor debe ser mayor que 0.'); return; }
      const r = S.scale(recs, c.base, v); say(`${r.done} objeto(s) escalado(s) ×${+v.toFixed(6)}.` + (r.refused.length ? ` No se pueden escalar todavía: ${r.refused.join(', ')}.` : ''));
    }
    soltarSel(); afterEdit(); cmd = null; idlePrompt();
  }

  function doStretch(dx, dy) {
    const w = cmd.win;
    const inside = (x, y) => x >= w[0] && x <= w[2] && y >= w[1] && y <= w[3];
    const mods = []; const refused = new Set(); let n = 0;
    for (const r of sel) {
      const res = Geom.stretchPairs(r, inside, dx, dy);
      if (!res) continue;
      if (res === 'all') {
        const group = S.withSeq(r); const mir = Edit.mirrored(group[0]);
        const T = Edit.similarity({ dx, dy });
        const afters = group.map((q) => Edit.transformPairs(q.type, q.p, T, mir));
        if (afters.some((a) => !a)) { refused.add(r.type); continue; }
        group.forEach((q, k) => mods.push({ rec: q, pairs: afters[k] }));
      } else mods.push({ rec: r, pairs: res });
      n++;
    }
    if (mods.length) { S.commit(`Estirar ${n}`, { mods }); afterEdit(); }
    say(`${n} objeto(s) estirado(s).` + (refused.size ? ` No se pueden mover todavía: ${[...refused].join(', ')}.` : ''));
    setSel([]); cmd = null; idlePrompt();
  }

  function doTrimExtend(p) {
    const r = hit(p[0], p[1]);
    if (!r) { say('No hay un objeto ahí.'); return; }
    const b = r.node.bb;
    const others = topNodes().filter((n) => n.rec !== r && (cmd.name === 'ALARGA' || !(n.bb[2] < b[0] || n.bb[0] > b[2] || n.bb[3] < b[1] || n.bb[1] > b[3]))).map((n) => n.rec);
    const res = cmd.name === 'RECORTA' ? Geom.trim(r, p[0], p[1], others) : Geom.extend(r, p[0], p[1], others);
    if (res.error) { say(res.error); return; }
    const adds = (res.adds || []).map((a) => S.clone(a.like, a.type, a.pairs, H.page()));
    S.commit(cmd.name === 'RECORTA' ? 'Recortar' : 'Alargar', { mods: res.mods || [], adds, dels: res.dels || [] });
    afterEdit();
  }

  const escalaPropia = new Map();
  const esSimboloEPM = (n) => typeof SimbolosEPM !== 'undefined' && /^EPM_/i.test(n) && SimbolosEPM.lista().some((x) => x.bloque.toUpperCase() === String(n).toUpperCase());
  function chooseBlock(name) {
    const bn = H.doc().blockNode(name);
    if (!bn) { say(`No se pudo leer el bloque «${name}».`); return; }
    if (!cmd || cmd.name !== 'INSERTAR') { cancel(true); cmd = { name: 'INSERTAR', label: 'INSERTAR' }; lastCmd = 'INSERTAR'; }
    lastBlock = bn.name; cmd.block = bn; cmd.step = 1;
    // R2-fix M-16: escala propuesta = 1 para bloques propios (o la última que se escribió para ese bloque); 0,5 solo para
    // los símbolos EPM en el modelo en metros (escalaSimbolo).
    insScale = esSimboloEPM(bn.name) ? escalaSimbolo() : (escalaPropia.get(bn.name.toUpperCase()) || 1);
    prompt(`INSERTAR  ${bn.name}: precise punto de inserción:`);
    H.redraw(true);
  }

  function insertMatrix(at, s, rotDeg, base) {
    const r = rotDeg * Math.PI / 180, c = Math.cos(r) * s, n = Math.sin(r) * s;
    return [c, n, -n, c, at[0] - (c * base[0] - n * base[1]), at[1] - (n * base[0] + c * base[1])];
  }

  function doInsert() {
    const c = cmd; const bn = c.block;
    c.attrs = bn.attdefs.filter((a) => !(a.int(70) & 2)); // las constantes no se piden
    c.values = [];
    if (c.attrs.length) { c.step = 4; askAttr(); return; }
    finishInsert();
  }
  function askAttr() {
    const a = cmd.attrs[cmd.values.length];
    prompt(`INSERTAR  ${(a.get(3, '') || a.get(2, '')).trim()} <${(a.get(1, '') || '').trim()}>:`);
  }
  function attrValue(raw) {
    const a = cmd.attrs[cmd.values.length];
    cmd.values.push(raw.length ? raw : (a.get(1, '') || '').trim());
    if (cmd.values.length < cmd.attrs.length) askAttr(); else finishInsert();
  }
  function finishInsert() {
    const c = cmd; const bn = c.block; const page = H.page();
    const has = c.attrs && c.attrs.length;
    const body = [];
    if (has) body.push([66, 1]);
    body.push([2, bn.name], [10, c.at[0]], [20, c.at[1]], [30, 0]);
    if (insScale !== 1) body.push([41, insScale], [42, insScale], [43, insScale]);
    if (insRot) body.push([50, insRot]);
    const ins = S.make(page, 'INSERT', 'AcDbBlockReference', body, L());
    const adds = [ins];
    if (has) {
      const T = Edit.similarity({ base: bn.base, deg: insRot, s: insScale, dx: c.at[0] - bn.base[0], dy: c.at[1] - bn.base[1] });
      const h = ins.get(5);
      c.attrs.forEach((a, k) => {
        const tp = attdefToAttrib(a, c.values[k]);
        const moved = Edit.transformPairs('ATTRIB', tp, T, false) || tp;
        const lay = (a.get(8, '0') || '0').trim();
        adds.push(S.make(page, 'ATTRIB', null, moved, lay === '0' ? L() : lay, h));
      });
      adds.push(S.make(page, 'SEQEND', null, [], L(), h));
    }
    S.commit(`Insertar ${bn.name}`, { adds });
    afterEdit(); say(`Bloque ${bn.name} insertado.`);
    cmd = null; idlePrompt(); // como AutoCAD: termina; Enter repite INSERTAR con el mismo bloque
  }
  /** Pares de un ATTRIB a partir de su ATTDEF (desde el primer «100 AcDbText»). */
  function attdefToAttrib(a, value) {
    const out = []; let sub = 0, tag = '', flags = 0, valign = null;
    for (const [code, v] of a.p) {
      if (code === 100) { const t = String(v).trim(); if (t === 'AcDbText') sub++; else if (t === 'AcDbAttributeDefinition') sub = 9; continue; }
      if (sub === 1) { if (code === 1) out.push([1, value]); else out.push([code, v]); }
      else if (sub === 2) { if (code === 73) valign = v; }
      else if (sub === 9) { if (code === 2) tag = v; else if (code === 70) flags = v; }
    }
    out.unshift([100, 'AcDbText']);
    out.push([100, 'AcDbAttribute'], [2, tag], [70, flags]);
    if (valign != null) out.push([74, valign]);
    return out;
  }

  // ---------------------------------------------------------------- H1: capas, propiedades, estilos, texto, revisión, limpieza
  const OPC_CAPA = { N: 'N', NUEVA: 'N', A: 'A', ACTUAL: 'A', R: 'R', RENOMBRAR: 'R', D: 'D', DESACTIVAR: 'D', AC: 'AC', ACTIVAR: 'AC',
    I: 'I', INUTILIZAR: 'I', RE: 'RE', REUTILIZAR: 'RE', C: 'C', COLOR: 'C', T: 'T', TIPO: 'T', G: 'G', GROSOR: 'G',
    B: 'B', BLOQUEAR: 'B', DB: 'DB', DESBLOQUEAR: 'DB', NT: 'NT', NOTRAZAR: 'NT', TR: 'TR', TRAZAR: 'TR', P: 'P', PANEL: 'P' };
  function startCapa() {
    cmd = { name: 'CAPA', label: 'CAPA', text: true };
    prompt(`CAPA  Actual <${L()}>. [Nueva(N)/Actual(A)/Renombrar(R)/Desactivar(D)/Activar(AC)/Inutilizar(I)/Reutilizar(RE)/Color(C)/Tipo(T)/Grosor(G)/Bloquear(B)/Desbloquear(DB)/NoTrazar(NT)/Trazar(TR)/Panel(P)] o nombre de capa:`);
  }
  const capasDe = (t) => (t.trim() === '*' ? S.capas().map((c) => c.name) : t.split(',').map((x) => x.trim()).filter(Boolean));
  function capaLote(names, o, verbo) {
    let n = 0;
    for (const nm of names) { const r = S.cambiarCapa(nm, o); if (r.error) say(r.error); else n++; }
    if (n) { afterEdit(); refreshLayerUI(); say(`${n} capa(s) ${verbo}.`); }
  }
  function promptCambia() { prompt(`CAMBIAPROP  ${sel.size} objeto(s). Propiedad a cambiar [Capa(CA)/Color(C)/Tipo(T)/Grosor(G)/Escala(E)] <Enter = terminar>:`); }
  function textoAltura(c) {
    const st = S.findRec('STYLE', S.estiloActual());
    const fija = st ? st.num(40, 0) : 0;
    if (fija > 0) { c.h = fija; c.step = 2; textoRot(c); return; } // estilo con altura fija: no se pregunta
    const N = typeof Planchas !== 'undefined' ? anotN() : null; // anotación a escala: la altura se da en mm de papel
    c.fAnot = N ? S.factorAnot(N) : 1;
    c.step = 1; prompt(N ? `TEXTO  Altura en el papel (mm) <${textH}> — anotación ${Planchas.textoEscala(N)}: ${String(+(textH * c.fAnot).toPrecision(4)).replace('.', ',')} en el modelo:` : `TEXTO  Altura <${textH}>:`);
  }
  function textoRot(c) {
    if (textJust === 'AJ') { c.rot = 0; c.step = 3; c.text = true; prompt('TEXTO  Escriba el texto:'); return; }
    c.step = 2; prompt('TEXTO  Ángulo de rotación <0>:');
  }
  function editarTextos(r) {
    cmd.edit = S.textosDe(r); cmd.k = 0; cmd.text = true; setSel([r]); askEdit();
  }
  function askEdit() {
    const q = cmd.edit[cmd.k];
    const que = q.type === 'ATTRIB' ? `atributo ${(q.get(2, '') || '').trim()}` : q.type === 'MTEXT' ? 'texto de párrafo (\\P = salto de línea)' : 'texto';
    prompt(`EDITATEXTO  ${que}${cmd.edit.length > 1 ? ` (${cmd.k + 1} de ${cmd.edit.length})` : ''}: corrija y pulse Enter (Esc = cancelar):`);
    const inp = $('cInput'); inp.value = S.textoDe(q); inp.focus(); inp.select();
  }

  /** Respuestas escritas a los comandos H1. true = atendida. */
  function h1Input(c, t, raw) {
    const T = t.toUpperCase();
    const yes = (def) => (!t ? def : /^(S|SI|SÍ|Y|YES)$/i.test(t));
    switch (c.name) {
      case 'CAPA': {
        if (!c.opt) {
          if (!t) { cmd = null; idlePrompt(); return true; }
          const o = OPC_CAPA[T];
          if (!o) {
            const r = S.findRec('LAYER', t);
            if (r) { const x = S.capaActualA(t); if (x.error) say(x.error); else { afterEdit(); refreshLayerUI(); say(`Capa actual: ${x.name}`); } startCapa(); }
            else say(`No existe la capa «${t}». Use N para crearla.`);
            return true;
          }
          if (o === 'P') { toggleLayers(true); startCapa(); return true; }
          c.opt = o; c.vals = [];
          const pide = { N: 'Nombre de la capa nueva:', A: 'Capa que será la actual:', R: 'Capa a renombrar:', C: 'Color [1-255 o Rojo/Amarillo/Verde/Cian/Azul/Magenta/Blanco/Gris]:',
            T: `Tipo de línea [${S.tiposCargados().join('/')}]:`, G: 'Grosor en mm (p. ej. 0,25) o Predeterminado:' }[o] || 'Capa(s) (separe con comas; * = todas):';
          prompt(`CAPA  ${pide}`); return true;
        }
        if (!t) { startCapa(); return true; }
        const o = c.opt;
        if (o === 'N') { for (const nm of t.split(',').map((x) => x.trim()).filter(Boolean)) { const r = S.crearCapa(nm); say(r.error || `Capa «${nm}» creada.`); } afterEdit(); refreshLayerUI(); startCapa(); return true; }
        if (o === 'A') { const x = S.capaActualA(t); say(x.error || `Capa actual: ${x.name}`); afterEdit(); refreshLayerUI(); startCapa(); return true; }
        if (o === 'R') {
          if (!c.vals.length) { if (!S.findRec('LAYER', t)) { say(`No existe la capa «${t}».`); return true; } c.vals.push(t); prompt(`CAPA  Nombre nuevo para «${t}»:`); return true; }
          const x = S.renombrarCapa(c.vals[0], t); say(x.error || `Capa renombrada a «${t}» (${x.n} objeto(s)).`); afterEdit(); refreshLayerUI(); startCapa(); return true;
        }
        if ((o === 'C' || o === 'T' || o === 'G') && !c.vals.length) {
          let v = null;
          if (o === 'C') { v = Documento.parseColor(t); if (!(v >= 1 && v <= 255)) { say('Color no válido (1 a 255 o un nombre).'); return true; } }
          if (o === 'T') {
            let lt = S.findRec('LTYPE', t);
            if (!lt) { const r = S.cargarTipo(t); if (r.error) { say(`El tipo «${t}» no está cargado y no lo conozco. Use TIPOLIN.`); return true; } say(`Tipo «${r.name}» cargado.`); lt = S.findRec('LTYPE', t); }
            v = lt.get(2).trim();
          }
          if (o === 'G') { v = Documento.parseGrosor(t); if (v === null || v < -3 || v === -1 || v === -2) { say('Grosor no válido.'); return true; } }
          c.vals.push(v); prompt('CAPA  Capa(s) (separe con comas; * = todas):'); return true;
        }
        const nms = capasDe(t);
        const map = { D: [{ off: true }, 'desactivada(s)'], AC: [{ off: false }, 'activada(s)'], I: [{ frozen: true }, 'inutilizada(s)'], RE: [{ frozen: false }, 'reutilizada(s)'],
          B: [{ locked: true }, 'bloqueada(s)'], DB: [{ locked: false }, 'desbloqueada(s)'], NT: [{ plot: false }, 'sin trazar'], TR: [{ plot: true }, 'para trazar'],
          C: [{ color: c.vals[0] }, 'con color nuevo'], T: [{ ltype: c.vals[0] }, 'con tipo de línea nuevo'], G: [{ lw: c.vals[0] }, 'con grosor nuevo'] }[o];
        if (o === 'I' && t.trim() === '*') nms.splice(0, nms.length, ...nms.filter((n) => n.toUpperCase() !== L().toUpperCase()));
        capaLote(nms, map[0], map[1]); startCapa(); return true;
      }
      case 'CAMBIAPROP': {
        if (c.step !== 1 && c.step !== 2) return false;
        if (c.step === 1) {
          if (!t) { cmd = null; idlePrompt(); return true; }
          const o = { CA: 'CA', CAPA: 'CA', C: 'C', COLOR: 'C', T: 'T', TIPO: 'T', G: 'G', GROSOR: 'G', E: 'E', ESCALA: 'E' }[T];
          if (!o) { say(`Opción no válida: «${t}».`); return true; }
          c.opt = o; c.step = 2; c.text = o === 'CA';
          prompt('CAMBIAPROP  ' + { CA: `Capa nueva <${L()}>:`, C: 'Color nuevo [PorCapa/PorBloque/1-255/Rojo…]:', T: `Tipo de línea [PorCapa/PorBloque/${S.tiposCargados().join('/')}]:`, G: 'Grosor [PorCapa/PorBloque/Predeterminado/mm]:', E: 'Escala de tipo de línea <1>:' }[o]);
          return true;
        }
        const o = {};
        if (c.opt === 'CA') o.layer = t || L();
        if (c.opt === 'C') { o.color = Documento.parseColor(t); if (o.color === null) { say('Color no válido.'); return true; } }
        if (c.opt === 'T') o.ltype = t || 'BYLAYER';
        if (c.opt === 'G') { o.lw = Documento.parseGrosor(t || 'PorCapa'); if (o.lw === null) { say('Grosor no válido.'); return true; } }
        if (c.opt === 'E') { o.ltscale = t ? parseFloat(t.replace(',', '.')) : 1; }
        const r = S.cambiarProps([...sel], o); if (r.error) say(r.error); else { afterEdit(); say(`${r.n} objeto(s) cambiado(s).`); }
        c.step = 1; c.text = false; promptCambia(); return true;
      }
      case 'TIPOLIN': {
        if (!t) { cmd = null; idlePrompt(); return true; }
        if (t === '?') { say(Object.entries(Documento.TIPOS).map(([k, v]) => `${k}: ${v.desc}`).join(' · ')); return true; }
        const r = S.cargarTipo(t); say(r.error || (r.ya ? `«${r.name || T}» ya estaba cargado.` : `Tipo «${r.name || T}» cargado.`)); if (r.ok && !r.ya) { afterEdit(); refreshLayerUI(); }
        return true;
      }
      case 'ESCALATL': {
        if (t) { const r = S.escalaTL(parseFloat(t.replace(',', '.'))); say(r.error || `ESCALATL = ${t}`); if (r.ok) afterEdit(); }
        cmd = null; idlePrompt(); return true;
      }
      case 'ESTILO': {
        if (c.step === 0 && t === '?') { say('Estilos del dibujo: ' + S.estilos().map((x) => `${x.name} (${x.font}${x.height ? `, alto ${x.height}` : ''})`).join(' · ')); prompt(`ESTILO  Nombre del estilo <${S.estiloActual()}>:`); return true; }
        if (c.step === 0 && t && !S.estilos().some((x) => x.name.toUpperCase() === t.toUpperCase())) { const er = S.validName(t); if (er) { say(er); return true; } } // H6-A M-7: el nombre se revisa en el primer paso
        if (c.step === 0) { c.st = t || S.estiloActual(); const ex = S.estilos().find((x) => x.name.toUpperCase() === c.st.toUpperCase()); c.ex = ex; c.step = 1;
          prompt(`ESTILO  «${c.st}»${ex ? '' : ' (nuevo)'}. Archivo de fuente TTF <${ex ? ex.font : Documento.FUENTE}>:`); return true; }
        if (c.step === 1) { c.font = t || (c.ex ? c.ex.font : Documento.FUENTE); c.step = 2; prompt(`ESTILO  Altura (0 = se pregunta en TEXTO) <${c.ex ? c.ex.height : 0}>:`); return true; }
        const h = t ? parseFloat(t.replace(',', '.')) : (c.ex ? c.ex.height : 0);
        if (!(h >= 0)) { say('Altura no válida.'); return true; }
        if (/\.shx$/i.test(c.font)) say('Aviso: las fuentes SHX son de Autodesk; Domoplano usa fuentes TTF libres (Liberation Sans).');
        const r = S.estilo(c.st, { font: c.font, height: h });
        if (r.error) say(r.error); else { S.estiloActualA(c.st); afterEdit(); say(`Estilo «${c.st}» ${r.nuevo ? 'creado' : 'cambiado'} (${c.font}) y puesto como actual.`); }
        cmd = null; idlePrompt(); return true;
      }
      case 'REVISION': {
        const r = S.revisar(yes(false));
        if (!r.problemas.length) say('REVISION  0 errores encontrados. El dibujo está bien.');
        else { say(`REVISION  ${r.problemas.length} problema(s): ${r.problemas.slice(0, 6).join(' · ')}${r.problemas.length > 6 ? '…' : ''}`); if (r.corregidos) { afterEdit(); refreshLayerUI(); say(`${r.corregidos} corregido(s).`); } }
        cmd = null; idlePrompt(); return true;
      }
      case 'LIMPIA': {
        if (yes(true)) { const r = S.limpiar(); afterEdit(); refreshLayerUI(); say(`LIMPIA  Quitado: ${r.n.capas} capa(s), ${r.n.tipos} tipo(s), ${r.n.estilos} estilo(s), ${r.n.bloques} bloque(s). (⌘Z deshace)`); }
        cmd = null; idlePrompt(); return true;
      }
      case 'EDITATEXTO': {
        if (!c.edit) { if (!t) { cmd = null; idlePrompt(); return true; } return false; }
        const q = c.edit[c.k];
        if (raw.length && raw !== S.textoDe(q)) { const r = S.editarTexto(q, raw); if (r.error) say(r.error); else afterEdit(); }
        c.k++;
        if (c.k < c.edit.length) { askEdit(); return true; }
        $('cInput').value = ''; setSel([]);
        if (c.once) { cmd = null; idlePrompt(); return true; }
        c.edit = null; c.text = false; prompt('EDITATEXTO  Designe otro texto [Enter para terminar]:'); return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- NUEVO
  function nuevo() {
    cmd = null; idlePrompt();
    if (window.domoNuevo) window.domoNuevo(); else say('NUEVO no está disponible aquí.');
  }

  // ---------------------------------------------------------------- paleta Propiedades
  const opt = (sel, v, txt, on) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; if (on) o.selected = true; sel.appendChild(o); };
  function comun(vals) { return vals.every((v) => v === vals[0]) ? vals[0] : undefined; }
  function toggleProps(force) {
    const el = $('props'); if (!el) return;
    const show = force === undefined ? !el.classList.contains('show') : force;
    if (show) { ['layers', 'marks', 'blocks', 'lman'].forEach((id) => $(id) && $(id).classList.remove('show')); }
    el.classList.toggle('show', show); if (show) renderProps();
  }
  function renderProps() {
    const el = $('props'); if (!el || !el.classList.contains('show')) return;
    const body = $('pBody'); body.innerHTML = '';
    if (!S) return;
    const recs = [...sel].filter((r) => !r.deleted);
    if (!recs.length) { body.innerHTML = '<div class="pnone">Nada seleccionado. Haga clic en un objeto o arrastre una ventana.</div>'; return; }
    const tipos = {}; recs.forEach((r) => { tipos[r.type] = (tipos[r.type] || 0) + 1; });
    const hd = document.createElement('div'); hd.className = 'pnone'; hd.textContent = `${recs.length} objeto(s): ` + Object.entries(tipos).map(([k, v]) => `${v} ${k}`).join(', '); body.appendChild(hd);
    const P = recs.map(Documento.propsDe);
    const row = (label, ctl) => { const d = document.createElement('label'); d.className = 'prow'; const s = document.createElement('span'); s.textContent = label; d.appendChild(s); d.appendChild(ctl); body.appendChild(d); return ctl; };
    const apply = (o) => { const r = S.cambiarProps(recs, o); if (r.error) say(r.error); else { say(`Propiedades: ${r.n} objeto(s) cambiado(s).`); afterEdit().then(renderProps); } };
    // capa
    const cl = comun(P.map((p) => p.layer));
    const sL = document.createElement('select'); if (cl === undefined) opt(sL, '', '*varias*', true);
    S.capas().forEach((c) => opt(sL, c.name, c.name, cl !== undefined && c.name.toUpperCase() === cl.toUpperCase()));
    row('Capa', sL).onchange = () => sL.value && apply({ layer: sL.value });
    // color
    const cc = comun(P.map((p) => p.color));
    const sC = document.createElement('select'); if (cc === undefined) opt(sC, '', '*varios*', true);
    [256, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, ...(typeof cc === 'number' && cc > 9 && cc < 256 ? [cc] : [])].forEach((c) => opt(sC, c, Documento.nombreColor(c), cc === c));
    if (cc === 'RGB') opt(sC, 'RGB', 'Color verdadero (RGB)', true);
    row('Color', sC).onchange = () => sC.value !== '' && sC.value !== 'RGB' && apply({ color: +sC.value });
    // tipo de línea
    const ct = comun(P.map((p) => p.ltype.toUpperCase()));
    const sT = document.createElement('select'); if (ct === undefined) opt(sT, '', '*varios*', true);
    opt(sT, 'BYLAYER', 'PorCapa', ct === 'BYLAYER'); opt(sT, 'BYBLOCK', 'PorBloque', ct === 'BYBLOCK');
    S.tiposCargados().forEach((n) => opt(sT, n, n, ct === n.toUpperCase()));
    row('Tipo de línea', sT).onchange = () => sT.value && apply({ ltype: sT.value });
    // grosor
    const cw = comun(P.map((p) => p.lw));
    const sW = document.createElement('select'); if (cw === undefined) opt(sW, '', '*varios*', true);
    [-1, -2, -3, ...Documento.GROSORES].forEach((v) => opt(sW, v, Documento.nombreGrosor(v), cw === v));
    row('Grosor', sW).onchange = () => sW.value !== '' && apply({ lw: +sW.value });
    // escala de tipo de línea
    const cs = comun(P.map((p) => p.ltscale));
    const iS = document.createElement('input'); iS.type = 'number'; iS.step = 'any'; iS.min = '0'; iS.value = cs === undefined ? '' : cs; iS.placeholder = '*varias*';
    row('Escala tipo línea', iS).onchange = () => { const v = parseFloat(iS.value); if (v > 0) apply({ ltscale: v }); };
    // contenido de un texto
    if (recs.length === 1 && S.textosDe(recs[0]).length === 1) {
      const q = S.textosDe(recs[0])[0];
      const ta = document.createElement('textarea'); ta.value = S.textoDe(q); ta.rows = 2;
      row('Contenido', ta);
      const b = document.createElement('button'); b.textContent = 'Aplicar texto'; b.onclick = () => { if (ta.value !== S.textoDe(q)) { const r = S.editarTexto(q, ta.value); if (r.error) say(r.error); else { say('Texto cambiado.'); afterEdit().then(renderProps); } } };
      body.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- administrador de capas
  let lmSel = null;
  function toggleLayers(force) {
    const el = $('lman'); if (!el) return;
    const show = force === undefined ? !el.classList.contains('show') : force;
    if (show) { ['layers', 'marks', 'blocks', 'props'].forEach((id) => $(id) && $(id).classList.remove('show')); }
    el.classList.toggle('show', show); if (show) renderLayers();
  }
  function renderLayers() {
    const el = $('lman'); if (!el || !el.classList.contains('show') || !S) return;
    const tb = $('lmRows'); tb.innerHTML = '';
    const tipos = S.tiposCargados();
    const change = (name, o, verbo) => { const r = S.cambiarCapa(name, o); if (r.error) say(r.error); else { say(`Capa «${name}» ${verbo}.`); afterEdit(); refreshLayerUI(); } };
    for (const c of S.capas()) {
      const tr = document.createElement('tr'); if (lmSel && lmSel.toUpperCase() === c.name.toUpperCase()) tr.className = 'sel';
      const td = (child, title) => { const d = document.createElement('td'); if (title) d.title = title; if (typeof child === 'string') d.textContent = child; else d.appendChild(child); tr.appendChild(d); return d; };
      const cb = (val, title, fn) => { const i = document.createElement('input'); i.type = 'checkbox'; i.checked = val; i.title = title; i.onchange = () => fn(i.checked); return i; };
      const rd = document.createElement('input'); rd.type = 'radio'; rd.name = 'lmcur'; rd.checked = c.current; rd.title = 'Capa actual';
      rd.onchange = () => { const x = S.capaActualA(c.name); if (x.error) { say(x.error); renderLayers(); } else { afterEdit(); refreshLayerUI(); } };
      td(rd);
      td(c.name).className = 'nm';
      td(cb(!c.off, 'Activada', (v) => change(c.name, { off: !v }, v ? 'activada' : 'desactivada')));
      td(cb(c.frozen, 'Inutilizada', (v) => change(c.name, { frozen: v }, v ? 'inutilizada' : 'reutilizada')));
      td(cb(c.locked, 'Bloqueada', (v) => change(c.name, { locked: v }, v ? 'bloqueada' : 'desbloqueada')));
      const sc = document.createElement('select'); [1, 2, 3, 4, 5, 6, 7, 8, 9, ...(c.color > 9 ? [c.color] : [])].forEach((k) => opt(sc, k, Documento.nombreColor(k), k === c.color));
      sc.onchange = () => change(c.name, { color: +sc.value }, 'con color nuevo');
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = '#' + ((ACI[c.color] ?? 0) & 0xffffff).toString(16).padStart(6, '0');
      const tdc = td(sw); tdc.appendChild(sc);
      const st = document.createElement('select'); tipos.forEach((n) => opt(st, n, n, n.toUpperCase() === (c.ltype || '').toUpperCase()));
      if (!tipos.some((n) => n.toUpperCase() === (c.ltype || '').toUpperCase())) opt(st, c.ltype, c.ltype, true);
      st.onchange = () => change(c.name, { ltype: st.value }, 'con tipo nuevo'); td(st);
      const sg = document.createElement('select'); [-3, ...Documento.GROSORES].forEach((v) => opt(sg, v, v === -3 ? 'Predet.' : (v / 100).toFixed(2), v === c.lw));
      sg.onchange = () => change(c.name, { lw: +sg.value }, 'con grosor nuevo'); td(sg);
      td(cb(c.plot, 'Se traza (sale en PDF/DWF)', (v) => change(c.name, { plot: v }, v ? 'para trazar' : 'sin trazar')));
      tr.onclick = (e) => { if (e.target.tagName === 'TD') { lmSel = c.name; $('lmName').value = c.name; renderLayers(); } };
      tb.appendChild(tr);
    }
    const lt = $('lmLt'); lt.innerHTML = ''; opt(lt, '', 'Cargar tipo de línea…', true);
    Object.entries(Documento.TIPOS).filter(([k]) => !tipos.some((n) => n.toUpperCase() === k)).forEach(([k, v]) => opt(lt, k, `${k} — ${v.desc}`));
  }
  function refreshLayerUI() {
    const s = $('cLayer');
    if (s && S) { s.innerHTML = ''; for (const c of S.capas()) opt(s, c.name, c.name, c.current); s.value = L(); }
    renderLayers(); renderProps();
  }
  if (typeof document !== 'undefined' && document.getElementById('lman')) {
    $('lmClose').onclick = () => toggleLayers(false);
    $('pClose').onclick = () => toggleProps(false);
    $('cLman').onclick = () => toggleLayers();
    $('cProps').onclick = () => toggleProps();
    $('lmNew').onclick = () => { const n = $('lmName').value.trim(); const r = S.crearCapa(n); if (r.error) say(r.error); else { lmSel = n; say(`Capa «${n}» creada.`); afterEdit(); refreshLayerUI(); } };
    $('lmRen').onclick = () => { const n = $('lmName').value.trim(); if (!lmSel) { say('Elija primero la capa (clic en su fila).'); return; } const r = S.renombrarCapa(lmSel, n); if (r.error) say(r.error); else { say(`Capa «${lmSel}» renombrada a «${n}» (${r.n} objeto(s)).`); lmSel = n; afterEdit(); refreshLayerUI(); } };
    $('lmLt').onchange = (e) => { const v = e.target.value; if (!v) return; const r = S.cargarTipo(v); say(r.error || `Tipo «${v}» cargado.`); afterEdit(); refreshLayerUI(); };
    $('lmName').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('lmNew').click(); };
  }
  /** Las capas bloqueadas no se pueden designar (como en AutoCAD). */
  function locked(r) { const D = H.doc().dxf; const l = D.layers.get((r.get(8, '0') || '0').trim()); return !!(l && l.locked); }

  // ---------------------------------------------------------------- paleta de bloques
  let paletteDoc = null;
  function buildPalette() {
    const doc = H.doc(); if (!doc || !doc.dxf || paletteDoc === doc) return;
    paletteDoc = doc;
    const grid = $('bgrid'); grid.innerHTML = '';
    const dpr = window.devicePixelRatio || 1;
    for (const name of doc.blockNames()) {
      const bn = doc.blockNode(name); if (!bn) continue;
      const d = document.createElement('div'); d.className = 'bk'; d.title = name; d.dataset.name = name.toUpperCase();
      const cv = document.createElement('canvas'); cv.width = 88 * dpr; cv.height = 64 * dpr;
      const g = cv.getContext('2d'); const b = bn.node.bb;
      const w = Math.max(b[2] - b[0], 1e-9), h = Math.max(b[3] - b[1], 1e-9);
      const k = Math.min((88 - 10) / w, (64 - 10) / h) * dpr;
      g.setTransform(k, 0, 0, -k, (88 * dpr - w * k) / 2 - b[0] * k, (64 * dpr + h * k) / 2 + b[1] * k);
      try { Scene.render(g, bn.node, b, k); } catch (e) { /* miniatura opcional */ }
      const t = document.createElement('div'); t.textContent = name;
      d.appendChild(cv); d.appendChild(t);
      d.onclick = () => { $('blocks').classList.remove('show'); chooseBlock(name); };
      grid.appendChild(d);
    }
    if (!grid.children.length) grid.innerHTML = '<div style="color:var(--dim);grid-column:1/-1">Este dibujo no tiene bloques.</div>';
  }
  function toggleBlocks() {
    const el = $('blocks');
    if (!el.classList.contains('show')) { buildPalette(); ['layers', 'marks', 'lman', 'props'].forEach((id) => $(id) && $(id).classList.remove('show')); }
    el.classList.toggle('show');
  }
  if (typeof document !== 'undefined' && document.getElementById('bkFind')) {
    $('bkFind').oninput = (e) => { const q = e.target.value.trim().toUpperCase(); for (const d of $('bgrid').children) d.style.display = !q || (d.dataset.name || '').includes(q) ? '' : 'none'; };
    $('bkClose').onclick = () => $('blocks').classList.remove('show');
    $('cBlocks').onclick = toggleBlocks;
  }

  /** Capa actual desde el selector de la barra: queda guardada en el dibujo ($CLAYER), como en AutoCAD. */
  function setLayer(name) {
    if (!S || name.toUpperCase() === L().toUpperCase()) { const s = $('cLayer'); if (s) s.value = L(); return; }
    const r = S.capaActualA(name); if (r.error) say(r.error); else { afterEdit(); say(`Capa actual: ${r.name}`); }
    refreshLayerUI();
  }
  /** Doble clic: editar el texto (o los atributos del bloque) que está debajo, como DDEDIT. */
  function onDblClick(sx, sy) {
    if (!enabled() || cmd) return false;
    const [lx, ly] = screenToLocal(sx, sy);
    const r = hit(lx, ly);
    if (!r || !S.textosDe(r).length) {
      // como AutoCAD: doble clic dentro de una ventana = trabajar en el modelo; doble clic fuera = volver al papel
      if (typeof Planchas === 'undefined') return false;
      if (H.page().ms) { const [px, py] = H.toPage(sx, sy); const m = Scene.inv(PL().rootM); const q = mulPt(m, px, py); if (ventanaEn(q) === H.page().ms.rec) return false; H.salirVentana(); say('Espacio papel.'); return true; }
      if (enPlancha() && (!r || r.type === 'VIEWPORT')) { const vp = ventanaEn([lx, ly]); if (vp) { entrar(vp); return true; } }
      return false;
    }
    cmd = { name: 'EDITATEXTO', label: 'EDITATEXTO', once: true }; lastCmd = 'EDITATEXTO';
    editarTextos(r); H.redraw(true); return true;
  }

  // ---------------------------------------------------------------- guardar
  function save(asNew) {
    if (!S) return;
    const text = S.serialize();
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
    CAD.lastSaved = text;
    if (native) { native.postMessage({ cmd: 'save', text, encoding: H.doc().encoding || 'utf-8', as: !!asNew }); say('Guardando…'); }
    else { say(`Guardado (prueba en navegador): ${text.length} caracteres.`); savedTop = topOp(); markDirty(); }
    idlePrompt();
  }
  // ---------------------------------------------------------------- exportar DWF (V06.00, una plancha por archivo, para EPM)
  async function exportDwf() {
    if (!S || typeof DWFWriter === 'undefined') { say('El escritor DWF no está cargado.'); return; }
    const doc = H.doc(), page = H.page();
    const papers = doc.pages.filter((p) => p.title !== 'Modelo' && (p === page || !p.vacia || !p.vacia()));
    if (!papers.length) { say('Este dibujo no tiene planchas: el DWF para EPM se hace desde una plancha.'); return; }
    const pl = page && page.title !== 'Modelo' ? page.title : papers[0].title;
    const base = (($('fname') && $('fname').dataset.name) || 'Plano').replace(/^● /, '').replace(/\.(dxf|dwf|dwfx)$/i, '');
    say(`Exportando DWF de «${pl}»…`); prompt('');
    try {
      const u8 = new TextEncoder().encode(S.serialize()); // incluye lo que aún no se ha guardado
      const r = await DWFWriter.fromDXF(u8, { plancha: pl, resolveURL: doc.resolveURL, title: papers.length > 1 ? `${base} - ${pl}` : base, sourceName: base + '.dxf' });
      const kb = (r.bytes.length / 1024).toFixed(0);
      const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
      const name = (papers.length > 1 ? `${base} - ${pl}` : base).replace(/[\\/:*?"<>|]/g, '_') + '.dwf';
      if (native) {
        let bin = ''; for (let i = 0; i < r.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, r.bytes.subarray(i, i + 0x8000));
        native.postMessage({ cmd: 'exportdwf', name, data: btoa(bin) });
        say(`DWF listo (${kb} KB). Elija dónde guardarlo…`);
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.bytes], { type: 'model/vnd.dwf' })); a.download = name; a.click();
        say(`DWF exportado: ${name} (${kb} KB).`);
      }
      if (r.stats.warnings.length) say('Avisos DWF: ' + r.stats.warnings.join(' · '));
      try {
        if (typeof ChecklistEPM !== 'undefined') {
          const k = await ChecklistEPM.revisar(u8, { presentacion: pl, nombre: base, pesoDWF: r.bytes.length });
          if (!k.cumple) say(`⚠️ CHECKEPM (${pl}): ${k.resumen.falla} punto(s) con falla y ${k.resumen.aviso} aviso(s). Ejecute CHECKEPM para ver y corregir antes de radicar.`);
        } else if (typeof Verificador !== 'undefined') {
          const v = await Verificador.verificar(u8, { presentacion: pl, nombre: base });
          if (v.colisiones.length) say(`⚠️ VERIFICAR (${pl}): ${v.colisiones.length} texto(s) montado(s). Ejecute VERIFICAR antes de radicar.`);
        }
      } catch (_) { /* sin bloqueo */ }
    } catch (e) { say('No se pudo exportar el DWF: ' + (e && e.message || e)); }
    idlePrompt();
  }
  if (typeof window !== 'undefined') window.domoExported = (ok, msg) => say(msg || (ok ? 'Archivo guardado.' : 'No se guardó el archivo.'));

  // ---------------------------------------------------------------- H2: EXPORTARPDF (TRAZAR), GROSORES, IMAGEN
  let pdfColor = 'mono', pdfTodas = false;
  const nombreBase = () => (($('fname') && $('fname').dataset.name) || 'Plano').replace(/^● /, '').replace(/\.(dxf|dwf|dwfx)$/i, '');
  const limpio = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
  function enviarBytes(cmdNative, name, bytes, mime) {
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
    if (native) {
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      native.postMessage({ cmd: cmdNative, name, data: btoa(bin) });
      return true;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = name; a.click();
    return false;
  }
  /** PDF vectorial de la plancha en pantalla (o de todas, en un solo PDF de varias páginas). color: mono | grises | color. */
  async function exportPdf(color, todas) {
    if (!S || typeof PDFWriter === 'undefined') { say('El escritor PDF no está cargado.'); return null; }
    const doc = H.doc(), page = H.page();
    const papers = doc.pages.filter((p) => p.title !== 'Modelo' && (p === page || !p.vacia || !p.vacia()));
    if (!papers.length) { say('Este dibujo no tiene planchas: el PDF se hace desde una plancha (como TRAZAR en una presentación).'); idlePrompt(); return null; }
    const base = nombreBase();
    const actual = page && page.title !== 'Modelo' ? page.title : papers[0].title;
    if (!todas && page && page.title === 'Modelo') say(`En el Modelo no hay hoja: se exporta la plancha «${actual}».`);
    const lista = todas ? papers.map((p) => p.title) : [actual];
    const name = limpio(todas || papers.length === 1 ? base : `${base} - ${actual}`) + '.pdf';
    say(`Exportando PDF (${color}${todas ? `, ${lista.length} planchas` : `, «${actual}»`})…`); prompt('');
    try {
      const u8 = new TextEncoder().encode(S.serialize()); // incluye lo que aún no se ha guardado
      const r = await PDFWriter.fromDXF(u8, { planchas: lista, resolveURL: doc.resolveURL, color, title: todas || papers.length === 1 ? base : `${base} - ${actual}`, author: 'DOMOTEX' });
      const kb = (r.bytes.length / 1024).toFixed(0);
      CAD.lastPDF = r;
      if (enviarBytes('exportpdf', name, r.bytes, 'application/pdf')) say(`PDF listo (${kb} KB, ${r.paginas || 1} página(s), ${r.hoja}). Elija dónde guardarlo…`);
      else say(`PDF exportado: ${name} (${kb} KB, ${r.paginas || 1} página(s), ${r.hoja}).`);
      if (r.stats.warnings.length) say('Avisos PDF: ' + r.stats.warnings.join(' · '));
      try {
        if (!todas && typeof ChecklistEPM !== 'undefined') {
          const k = await ChecklistEPM.revisar(u8, { presentacion: actual, nombre: base });
          if (!k.cumple) say(`⚠️ CHECKEPM (${actual}): ${k.resumen.falla} punto(s) con falla y ${k.resumen.aviso} aviso(s). Ejecute CHECKEPM para revisar.`);
        }
      } catch (_) { /* sin bloqueo */ }
      idlePrompt();
      return r;
    } catch (e) { say('No se pudo exportar el PDF: ' + (e && e.message || e)); idlePrompt(); return null; }
  }

  // ---- IMAGEN: elegir archivo → punto → ancho → giro
  let imgAncho = null, imgRot = 0;
  function startImagen() {
    cmd = { name: 'IMAGEN', label: 'IMAGEN', step: 0 };
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
    prompt('IMAGEN  Elija la imagen PNG o JPG (firma, logo)…');
    if (native) native.postMessage({ cmd: 'pickimage' });
    else { const f = $('fileImg'); if (f) { f.value = ''; f.click(); } }
  }
  /** La app (o el selector del navegador) entrega la imagen elegida: {url, rel, name} o {error}. */
  async function imagenElegida(info) {
    if (!cmd || cmd.name !== 'IMAGEN') return;
    if (!info || info.error) { say(info && info.error ? info.error : 'IMAGEN cancelada.'); cancel(true); return; }
    try {
      const bytes = new Uint8Array(await (await fetch(info.url)).arrayBuffer());
      const t = Documento.tamanoImagen(bytes);
      if (!t) { say('La imagen debe ser PNG o JPG.'); cancel(true); return; }
      let bmp = null; try { bmp = await createImageBitmap(new Blob([bytes])); } catch (e) { /* sin vista previa */ }
      const doc = H.doc(); if (doc.urlOverrides) doc.urlOverrides.set(info.rel, info.url);
      cmd.img = { url: info.url, rel: info.rel, wpx: t.w, hpx: t.h, bmp };
      cmd.step = 1;
      if (!imgAncho) { const r = $('stage').getBoundingClientRect(); imgAncho = +(r.width * unitsPerPx() / 5).toPrecision(3); }
      say(`Imagen «${info.rel}»: ${t.w} × ${t.h} px. Se guarda con ruta ${/^([a-zA-Z]:|\/)/.test(info.rel) ? 'ABSOLUTA' : 'relativa al DXF'}.`);
      prompt('IMAGEN  Precise punto de inserción (esquina inferior izquierda):');
      H.redraw(true);
    } catch (e) { say('No se pudo leer la imagen: ' + (e && e.message || e)); cancel(true); }
  }
  if (typeof window !== 'undefined') {
    window.domoImagenElegida = imagenElegida;
    const f = typeof document !== 'undefined' && document.getElementById('fileImg');
    if (f) f.onchange = (e) => { const x = e.target.files[0]; if (x) imagenElegida({ url: URL.createObjectURL(x), rel: x.name, name: x.name }); else imagenElegida(null); };
  }
  function imagenPunto(c, p) {
    if (c.step === 1) { c.at = p; c.base = p; c.step = 2; prompt(`IMAGEN  Ancho de la imagen en unidades del dibujo (o clic) <${imgAncho}>:`); }
    else if (c.step === 2) { const d = Math.hypot(p[0] - c.at[0], p[1] - c.at[1]); if (d > 0) { imgAncho = +d.toPrecision(6); c.step = 3; prompt(`IMAGEN  Ángulo de rotación (o clic) <${imgRot}>:`); } }
    else if (c.step === 3) { imgRot = +(Math.atan2(p[1] - c.at[1], p[0] - c.at[0]) * 180 / Math.PI).toFixed(4); finishImagen(); }
  }
  function finishImagen() {
    const c = cmd;
    const r = S.insertarImagen(H.page(), { archivo: c.img.rel, wpx: c.img.wpx, hpx: c.img.hpx, at: c.at, ancho: imgAncho, rot: imgRot, capa: L() });
    if (r.error) { say(r.error); cancel(true); return; }
    afterEdit(); say(`Imagen insertada: ancho ${imgAncho}, giro ${imgRot}°${r.reutilizada ? ' (reutiliza la definición de imagen existente)' : ''}. Se mueve, gira y escala como cualquier objeto.`);
    cmd = null; idlePrompt();
  }
  function imagenPreview(ctx, dpr) {
    const c = cmd, im = c.img;
    const at = c.step === 1 ? cursor : c.at;
    const w = c.step === 2 && cursor ? Math.max(1e-9, Math.hypot(cursor[0] - at[0], cursor[1] - at[1])) : imgAncho;
    const rot = c.step === 3 && cursor ? Math.atan2(cursor[1] - at[1], cursor[0] - at[0]) : imgRot * Math.PI / 180;
    if (!at) return;
    const k = w / im.wpx, co = Math.cos(rot), si = Math.sin(rot), h = k * im.hpx;
    const P = (u, v) => localToScreen(at[0] + u * co - v * si, at[1] + u * si + v * co); // u a lo ancho, v hacia arriba
    const q = [P(0, 0), P(w, 0), P(w, h), P(0, h)];
    if (im.bmp) {
      const o = P(0, h), ex = P(k, h), ey = P(0, h - k);
      ctx.save(); ctx.globalAlpha = 0.55;
      ctx.setTransform(dpr * (ex[0] - o[0]), dpr * (ex[1] - o[1]), dpr * (ey[0] - o[0]), dpr * (ey[1] - o[1]), dpr * o[0], dpr * o[1]);
      ctx.drawImage(im.bmp, 0, 0); ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (const z of q.slice(1)) ctx.lineTo(z[0], z[1]); ctx.closePath();
    ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.stroke();
  }

  /** Respuestas escritas a los comandos H2. true = atendida. */
  function h2Input(c, t, raw) {
    const T = t.toUpperCase();
    switch (c.name) {
      case 'EXPORTARPDF': {
        if (c.step === 0) {
          const m = !t ? pdfColor : /^M/.test(T) ? 'mono' : /^G/.test(T) ? 'grises' : /^C/.test(T) ? 'color' : null;
          if (!m) { say(`Opción no válida: «${t}». Escriba M, G o C.`); return true; }
          pdfColor = m; c.step = 1;
          const n = H.doc().pages.filter((p) => p.title !== 'Modelo' && !(p.vacia && p.vacia())).length;
          prompt(`EXPORTARPDF  ${m}. Planchas [Actual(A)/Todas(T) = ${n} en un solo PDF] <${pdfTodas ? 'T' : 'A'}>:`);
          return true;
        }
        const todas = !t ? pdfTodas : /^T/.test(T) ? true : /^A/.test(T) ? false : null;
        if (todas === null) { say(`Opción no válida: «${t}». Escriba A o T.`); return true; }
        pdfTodas = todas; cmd = null; exportPdf(pdfColor, todas);
        return true;
      }
      case 'GROSORES': {
        const tabla = typeof GROSORES_CAPAS !== 'undefined' ? GROSORES_CAPAS : null;
        if (!tabla) { say('No está cargada la tabla de grosores (web/grosores_capas.js).'); cancel(true); return true; }
        if (!t || /^V/.test(T)) {
          const filas = S.capas().filter((x) => x.name.toUpperCase() !== 'DEFPOINTS').map((x) => {
            const mm = Documento.grosorDeTabla(x.name, tabla);
            return `${x.name}: ${Documento.nombreGrosor(x.lw)}${mm != null ? ` → ${mm.toFixed(2)} mm` : ' (no está en la tabla)'}`;
          });
          say(`Tabla «${tabla.estado}». Capa: grosor actual → propuesto · ` + filas.join(' · '));
          console.log('GROSORES\n' + filas.join('\n'));
          cmd = null; idlePrompt(); return true;
        }
        if (/^[AS]/.test(T)) {
          const r = S.aplicarGrosores(tabla, { soloSinGrosor: /^S/.test(T) });
          if (r.error) say(r.error);
          else { if (r.n) { afterEdit(); refreshLayerUI(); } say(r.n ? `Grosores aplicados a ${r.n} capa(s) (⌘Z deshace): ` + r.hechos.map((h) => `${h.capa} ${Documento.nombreGrosor(h.ahora)}`).join(', ') : 'No hubo capas que cambiar.'); }
          cmd = null; idlePrompt(); return true;
        }
        say(`Opción no válida: «${t}». Escriba V, A o S.`); return true;
      }
      case 'IMAGEN': {
        if (!(c.step >= 1)) { if (!t) return true; say('Primero elija la imagen en la ventana que se abrió (Esc cancela).'); return true; }
        const v = t ? parseFloat(t.replace(',', '.')) : NaN;
        if (c.step === 1) { if (!t) return true; const p = parsePoint(t); if (p) imagenPunto(c, p); else say('Escriba x,y o haga clic.'); return true; }
        if (c.step === 2) { if (t) { if (!(v > 0)) { say('Escriba un ancho mayor que 0.'); return true; } imgAncho = v; } c.step = 3; prompt(`IMAGEN  Ángulo de rotación (o clic) <${imgRot}>:`); H.redraw(true); return true; }
        if (c.step === 3) { if (t) { if (!Number.isFinite(v)) { say('Escriba el ángulo en grados.'); return true; } imgRot = v; } finishImagen(); return true; }
        return true;
      }
    }
    return false;
  }

  function saved(ok, msg) { if (ok) { savedTop = topOp(); markDirty(); } say(msg || (ok ? 'Guardado.' : 'No se pudo guardar.')); }

  // ---------------------------------------------------------------- H3: dibujo EPM (sombreados, cotas, bloques, simetría, empalme, matriz, tabla)
  let hPat = 'DIAGONAL', hEsc = 1, hAng = 0, filRad = 0, chaD1 = 1, chaD2 = 1;
  let arrFil = 3, arrCol = 4, arrDF = 10, arrDC = 10, arrN = 6, arrAng = 360, arrRot = true;
  let tabCols = 3, tabFilas = 3, tabAnchos = '30', tabAlto = 6;
  let atrH = 2.5;
  const COTAS = { COTALIN: 'lineal', COTAALINEADA: 'alineada', COTAANG: 'angular', COTARADIO: 'radio', COTADIAM: 'diametro' };
  const visibles = () => topNodes().map((n) => n.rec);
  const num = (t) => parseFloat(String(t).replace(',', '.'));
  const yes = (t, def) => (!t ? def : /^(S|SI|SÍ|Y|YES)$/i.test(t));
  function fin(msg) { if (msg) say(msg); cmd = null; idlePrompt(); H.redraw(true); }
  function resultado(r, ok) { if (r.error) { say(r.error); return false; } afterEdit(); if (ok) say(typeof ok === 'function' ? ok(r) : ok); return true; }
  const avisoRechazo = (r) => (r.refused && r.refused.length ? ` No se pudieron: ${r.refused.join(', ')}.` : '');
  /** Datos de una línea o círculo/arco designado con un clic. */
  function circuloDe(r) {
    if (!r || (r.type !== 'CIRCLE' && r.type !== 'ARC')) return null;
    const m = Edit.mirrored(r); return { c: [m ? -r.num(10) : r.num(10), r.num(20)], r: r.num(40) };
  }

  function h3Start(name) {
    const pide = (c, msg) => { cmd = c; prompt(msg); };
    switch (name) {
      case 'SOMBREA':
        pide({ name, label: name, step: 'pat', text: true }, `SOMBREA  Patrón [${Object.keys(Dibujo.PATRONES).join('/')}] <${hPat}> (? = lista):`); return true;
      case 'COTALIN': case 'COTAALINEADA':
        pide({ name, label: name, step: 1, pts: [] }, `${name}  Precise origen de la primera línea de referencia o <Enter = designar una línea>:`); return true;
      case 'COTAANG':
        pide({ name, label: name, step: 1, pick: true }, 'COTAANG  Designe una línea o un arco o <Enter = vértice y dos puntos>:'); return true;
      case 'COTARADIO': case 'COTADIAM':
        pide({ name, label: name, step: 1, pick: true }, `${name}  Designe un arco o un círculo:`); return true;
      case 'DIRECTRIZ':
        pide({ name, label: name, step: 1, pts: [] }, 'DIRECTRIZ  Precise el punto de la flecha:'); return true;
      case 'ESTILOCOTA': {
        const st = S.estiloCota();
        pide({ name, label: name, step: 'nom', text: true, o: {} }, `ESTILOCOTA  Estilos: ${S.tblRecs('DIMSTYLE').map((r) => r.get(2).trim()).join(', ') || '(ninguno)'}. Nombre del estilo <${st.name}>:`); return true;
      }
      case 'BLOQUE':
        pide({ name, label: name, step: 'nom', text: true }, 'BLOQUE  Nombre del bloque nuevo:'); return true;
      case 'ATRDEF':
        pide({ name, label: name, step: 'tag', text: true, o: {} }, 'ATRDEF  Etiqueta del atributo (ej. KVA, ALTURA):'); return true;
      case 'DESCOMPONER': case 'SIMETRIA': case 'MATRIZ':
        if (sel.size) { cmd = { name, label: name, step: 0 }; h3Enter(cmd); }
        else pide({ name, label: name, step: 0 }, `${name}  Designe objetos y pulse Enter:`);
        return true;
      case 'EMPALME':
        pide({ name, label: name, step: 1, pick: true }, `EMPALME  Radio = ${filRad}. Designe la primera línea o [Radio(R)/Polilínea(P)]:`); return true;
      case 'CHAFLAN':
        pide({ name, label: name, step: 1, pick: true }, `CHAFLAN  Distancias = ${chaD1} y ${chaD2}. Designe la primera línea o [Distancias(D)/Polilínea(P)]:`); return true;
      case 'TABLA':
        pide({ name, label: name, step: 1 }, 'TABLA  Precise la esquina superior izquierda:'); return true;
    }
    return false;
  }

  function cotaUbicada(c, p) {
    const tipo = COTAS[c.name];
    let r;
    const estilo = typeof Planchas !== 'undefined' ? estiloCotaAnot() : undefined; // H4: a la escala de la ventana o de anotación
    if (tipo === 'lineal' || tipo === 'alineada') r = S.crearCota(H.page(), tipo, { p1: c.pts[0], p2: c.pts[1], ubic: p, ang: c.ang }, { texto: c.texto, estilo });
    else if (tipo === 'angular') r = S.crearCota(H.page(), 'angular', { ...c.ang3, ubic: p }, { texto: c.texto, estilo });
    else r = S.crearCota(H.page(), tipo, { c: c.circ.c, r: c.circ.r, punto: p, ubic: p }, { texto: c.texto, estilo });
    if (resultado(r, (x) => `Cota: ${String(x.texto).replace(/%%c/gi, 'Ø').replace(/%%d/gi, '°')}`)) fin(); else fin();
  }
  /** Rayos de una cota angular entre dos líneas según dónde se ubique el arco (el cuadrante que contiene el punto). */
  function angularDeLineas(r1, r2, A) {
    const a1 = [r1.num(10), r1.num(20)], b1 = [r1.num(11), r1.num(21)], a2 = [r2.num(10), r2.num(20)], b2 = [r2.num(11), r2.num(21)];
    const d1 = [b1[0] - a1[0], b1[1] - a1[1]], d2 = [b2[0] - a2[0], b2[1] - a2[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 1e-12) return null;
    const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
    const V = [a1[0] + d1[0] * t, a1[1] + d1[1] * t];
    const n2 = (x) => { x %= 2 * Math.PI; return x < 0 ? x + 2 * Math.PI : x; };
    const L1 = Math.hypot(...d1), L2 = Math.hypot(...d2), gA = Math.atan2(A[1] - V[1], A[0] - V[0]);
    for (const s1 of [1, -1]) for (const s2 of [1, -1]) for (const swap of [false, true]) {
      let u = [d1[0] * s1 / L1, d1[1] * s1 / L1], w = [d2[0] * s2 / L2, d2[1] * s2 / L2];
      if (swap) [u, w] = [w, u];
      const g1 = Math.atan2(u[1], u[0]), g2 = Math.atan2(w[1], w[0]), span = n2(g2 - g1);
      if (span < Math.PI && n2(gA - g1) <= span) {
        const far = (a, b, uu) => Math.max(1e-6, Math.abs((a[0] - V[0]) * uu[0] + (a[1] - V[1]) * uu[1]), Math.abs((b[0] - V[0]) * uu[0] + (b[1] - V[1]) * uu[1]));
        const l1 = swap ? far(a2, b2, u) : far(a1, b1, u), l2 = swap ? far(a1, b1, w) : far(a2, b2, w);
        return { v: V, p1: [V[0] + u[0] * l1, V[1] + u[1] * l1], p2: [V[0] + w[0] * l2, V[1] + w[1] * l2] };
      }
    }
    return null;
  }

  /** Clic o punto escrito para los comandos H3. */
  function h3Point(c, p) {
    switch (c.name) {
      case 'SOMBREA':
        if (c.step === 'pick') {
          const r = S.sombrearPunto(H.page(), visibles(), p, { patron: hPat, escala: hEsc, angulo: hAng });
          if (resultado(r, (x) => `Sombreado ${x.patron}${x.islas ? ` con ${x.islas} isla(s)` : ''}.`)) prompt('SOMBREA  Otro punto interior o [Seleccionar objetos (S)] <Enter = terminar>:');
        } else if (c.step === 'sel') { const r = hit(p[0], p[1]); if (r) setSel([r], true); }
        return;
      case 'COTALIN': case 'COTAALINEADA':
        if (c.step === 'obj') { const r = hit(p[0], p[1]); if (!r || r.type !== 'LINE') { say('Designe una línea.'); return; } c.pts = [[r.num(10), r.num(20)], [r.num(11), r.num(21)]]; c.pick = false; c.step = 3; c.base = c.pts[0]; prompt(`${c.name}  Ubicación de la línea de cota o [Horizontal(H)/Vertical(V)/Texto(T)]:`); return; }
        if (c.step === 1) { c.pts = [p]; c.base = p; c.step = 2; prompt(`${c.name}  Precise origen de la segunda línea de referencia:`); return; }
        if (c.step === 2) { c.pts.push(p); c.step = 3; prompt(`${c.name}  Ubicación de la línea de cota o [${c.name === 'COTALIN' ? 'Horizontal(H)/Vertical(V)/' : ''}Texto(T)]:`); return; }
        if (c.step === 3) cotaUbicada(c, p);
        return;
      case 'COTAANG':
        if (c.step === 1) {
          const r = hit(p[0], p[1]);
          if (r && r.type === 'ARC') { const q = circuloDe(r); const a0 = r.num(50) * Math.PI / 180, a1 = r.num(51) * Math.PI / 180; c.ang3 = { v: q.c, p1: [q.c[0] + q.r * Math.cos(a0), q.c[1] + q.r * Math.sin(a0)], p2: [q.c[0] + q.r * Math.cos(a1), q.c[1] + q.r * Math.sin(a1)] }; c.pick = false; c.step = 9; prompt('COTAANG  Ubicación del arco de cota [Texto(T)]:'); return; }
          if (!r || r.type !== 'LINE') { say('Designe una línea o un arco.'); return; }
          c.l1 = r; setSel([r]); c.step = 2; prompt('COTAANG  Designe la segunda línea:'); return;
        }
        if (c.step === 2) { const r = hit(p[0], p[1]); if (!r || r.type !== 'LINE' || r === c.l1) { say('Designe otra línea.'); return; } c.l2 = r; setSel([c.l1, r]); c.pick = false; c.step = 3; prompt('COTAANG  Ubicación del arco de cota (el cuadrante donde haga clic) [Texto(T)]:'); return; }
        if (c.step === 3) { const a = angularDeLineas(c.l1, c.l2, p); if (!a) { say('Las líneas son paralelas.'); return fin(); } c.ang3 = a; setSel([]); cotaUbicada(c, p); return; }
        if (c.step === 'v') { c.ang3 = { v: p }; c.base = p; c.step = 'p1'; prompt('COTAANG  Precise el punto final del primer ángulo:'); return; }
        if (c.step === 'p1') { c.ang3.p1 = p; c.step = 'p2'; prompt('COTAANG  Precise el punto final del segundo ángulo:'); return; }
        if (c.step === 'p2') { c.ang3.p2 = p; c.step = 9; prompt('COTAANG  Ubicación del arco de cota [Texto(T)]:'); return; }
        if (c.step === 9) cotaUbicada(c, p);
        return;
      case 'COTARADIO': case 'COTADIAM':
        if (c.step === 1) { const q = circuloDe(hit(p[0], p[1])); if (!q) { say('Designe un arco o un círculo.'); return; } c.circ = q; c.base = q.c; c.pick = false; c.step = 2; prompt(`${c.name}  Ubicación del texto [Texto(T)]:`); return; }
        cotaUbicada(c, p); return;
      case 'DIRECTRIZ':
        if (c.step === 1) { c.pts.push(p); c.base = p; prompt(`DIRECTRIZ  Siguiente punto${c.pts.length >= 2 ? ' <Enter = escribir el texto>' : ''}:`); }
        return;
      case 'BLOQUE':
        if (c.step === 'base') { c.basePt = p; c.step = 0; if (sel.size) { prompt(`BLOQUE  ${sel.size} objeto(s). Designe más o pulse Enter:`); } else prompt('BLOQUE  Designe objetos y pulse Enter:'); }
        return;
      case 'ATRDEF':
        if (c.step === 'pt') { const r = S.crearAtrdef(H.page(), { ...c.o, at: p, h: atrH }); resultado(r, `Atributo ${c.o.tag} definido. Inclúyalo al crear el BLOQUE.`); fin(); }
        return;
      case 'SIMETRIA':
        if (c.step === 1) { c.p1 = p; c.base = p; c.step = 2; prompt('SIMETRIA  Precise el segundo punto de la línea de simetría:'); }
        else if (c.step === 2) { c.p2 = p; c.step = 3; prompt('SIMETRIA  ¿Borrar los objetos de origen? [Sí/No] <N>:'); }
        return;
      case 'MATRIZ':
        if (c.step === 'centro') { c.centro = p; c.base = p; c.step = 'n'; prompt(`MATRIZ  Número de elementos <${arrN}>:`); }
        return;
      case 'EMPALME': case 'CHAFLAN': {
        const r = hit(p[0], p[1]);
        if (c.step === 'pol') {
          if (!r || r.type !== 'LWPOLYLINE') { say('Designe una polilínea.'); return; }
          const x = S.esquinaPol(r, c.name === 'EMPALME' ? { radio: filRad } : { d1: chaD1, d2: chaD2 });
          resultado(x, (y) => `${y.n} esquina(s)${y.cortos ? `; ${y.cortos} tramo(s) muy cortos` : ''}.`); return fin();
        }
        if (!r) { say('No hay un objeto ahí.'); return; }
        if (c.step === 1) { c.r1 = r; c.k1 = p; setSel([r]); c.step = 2; prompt(`${c.name}  Designe la segunda línea:`); return; }
        if (c.step === 2) {
          const x = S.esquina(c.r1, c.k1, r, p, c.name === 'EMPALME' ? { radio: filRad } : { d1: chaD1, d2: chaD2 }, H.page());
          setSel([]); resultado(x, c.name === 'EMPALME' ? `Empalme radio ${filRad}.` : `Chaflán ${chaD1} × ${chaD2}.`); fin();
        }
        return;
      }
      case 'TABLA':
        if (c.step === 1) { c.at = p; c.step = 'cols'; prompt(`TABLA  Número de columnas <${tabCols}>:`); }
        return;
    }
  }

  /** Enter para los comandos H3. true = atendido. */
  function h3Enter(c) {
    switch (c.name) {
      case 'SOMBREA':
        if (c.step === 'sel') {
          const r = S.sombrearObjetos(H.page(), [...sel], { patron: hPat, escala: hEsc, angulo: hAng }); setSel([]);
          resultado(r, (x) => `Sombreado ${x.patron} con ${x.contornos} contorno(s).`);
          c.step = 'pick'; c.selecting = false; c.pick = true; prompt('SOMBREA  Punto interior o [Seleccionar objetos (S)] <Enter = terminar>:'); return true;
        }
        if (c.step === 'pick') { fin(); return true; }
        return false;
      case 'COTALIN': case 'COTAALINEADA':
        if (c.step === 1) { c.step = 'obj'; c.pick = true; prompt(`${c.name}  Designe la línea a acotar:`); return true; }
        return c.step === 3 || c.step === 'obj' ? (fin(), true) : false;
      case 'COTAANG':
        if (c.step === 1) { c.step = 'v'; c.pick = false; prompt('COTAANG  Precise el vértice del ángulo:'); return true; }
        fin(); return true;
      case 'DIRECTRIZ':
        if (c.step === 1 && c.pts.length >= 2) { c.step = 'txt'; c.text = true; prompt('DIRECTRIZ  Texto de la nota (Enter = sin texto):'); return true; }
        if (c.step === 'txt') { const r = S.crearDirectriz(H.page(), c.pts, ''); resultado(r, 'Directriz creada.'); fin(); return true; }
        fin(); return true;
      case 'BLOQUE':
        if (c.step === 0) {
          if (!sel.size) { say('No hay objetos designados.'); return true; }
          c.step = 'modo'; c.text = false; prompt(`BLOQUE  ${sel.size} objeto(s). Los objetos [Convertir en bloque(C)/Retener(R)/Borrar(B)] <C>:`); return true;
        }
        if (c.step === 'modo') return h3Input(c, '', ''), true;
        return false;
      case 'DESCOMPONER': case 'SIMETRIA': case 'MATRIZ':
        if (c.step === 0) {
          if (!sel.size) { say('No hay objetos designados.'); fin(); return true; }
          if (c.name === 'DESCOMPONER') { const r = S.descomponer([...sel], H.page()); setSel([]); resultado(r, (x) => `${x.n} objeto(s) descompuesto(s) en ${x.recs.length}.${avisoRechazo(x)}`); fin(); return true; }
          if (c.name === 'SIMETRIA') { c.step = 1; prompt(`SIMETRIA  ${sel.size} objeto(s). Precise el primer punto de la línea de simetría:`); return true; }
          c.step = 'tipo'; prompt(`MATRIZ  ${sel.size} objeto(s). Tipo [Rectangular(R)/Polar(P)] <R>:`); return true;
        }
        return h3Input(c, '', ''), true;
      case 'EMPALME': case 'CHAFLAN': fin(); return true;
      case 'ESTILOCOTA': case 'ATRDEF': case 'TABLA': return h3Input(c, '', ''), true;
    }
    return false;
  }

  /** Texto escrito para los comandos H3. true = atendido. */
  function h3Input(c, t, raw) {
    const T = t.toUpperCase();
    const n = num(t);
    switch (c.name) {
      case 'SOMBREA':
        if (c.step === 'pat') {
          if (t === '?') { say('Patrones propios de Domoplano: ' + Object.entries(Dibujo.PATRONES).map(([k, v]) => `${k} (${v.desc})`).join(' · ') + '. También entiende ANSI31, ANSI37, EARTH, AR-CONC, AR-SAND, GRAVEL, SOLID.'); return true; }
          if (t) { const P = Dibujo.patron(t); if (!P) { say(`No conozco el patrón «${t}». Escriba ? para ver la lista.`); return true; } hPat = P.nombre; }
          c.text = false;
          if (Dibujo.patron(hPat).solido) { c.step = 'pick'; c.pick = true; prompt('SOMBREA  SOLIDO. Designe punto interior o [Seleccionar objetos (S)]:'); }
          else { c.step = 'esc'; prompt(`SOMBREA  ${hPat}. Escala <${hEsc}>:`); }
          return true;
        }
        if (c.step === 'esc') { if (t) { if (!(n > 0)) { say('Escriba una escala mayor que 0.'); return true; } hEsc = n; } c.step = 'ang'; prompt(`SOMBREA  Ángulo <${hAng}>:`); return true; }
        if (c.step === 'ang') { if (t) { if (!Number.isFinite(n)) { say('Escriba el ángulo en grados.'); return true; } hAng = n; } c.step = 'pick'; c.pick = true; prompt('SOMBREA  Designe punto interior o [Seleccionar objetos (S)]:'); return true; }
        if (c.step === 'pick' && /^S$/i.test(t)) { c.step = 'sel'; c.selecting = true; c.pick = true; setSel([]); prompt('SOMBREA  Designe polilíneas cerradas o círculos (los de adentro son islas) y pulse Enter:'); return true; }
        if (!t) return h3Enter(c);
        return false;
      case 'COTALIN': case 'COTAALINEADA': case 'COTAANG': case 'COTARADIO': case 'COTADIAM': {
        if (c.step === 'txt') { c.texto = raw; c.text = false; c.step = c.prevStep; prompt(`${c.name}  Texto «${raw || '<>'}». Ubicación:`); return true; }
        const ubic = (c.name === 'COTALIN' || c.name === 'COTAALINEADA') ? c.step === 3 : c.name === 'COTAANG' ? (c.step === 3 || c.step === 9) : c.step === 2;
        if (ubic && /^T$/i.test(t)) { c.prevStep = c.step; c.step = 'txt'; c.text = true; prompt(`${c.name}  Texto de la cota («<>» = la medida; Enter = la medida):`); return true; }
        if (c.name === 'COTALIN' && c.step === 3 && /^[HV]$/i.test(t)) { c.ang = /^H/i.test(t) ? 0 : 90; say(`Cota ${c.ang ? 'vertical' : 'horizontal'}.`); return true; }
        if (!t) return h3Enter(c);
        return false;
      }
      case 'DIRECTRIZ':
        if (c.step === 'txt') { const r = S.crearDirectriz(H.page(), c.pts, raw, { estilo: typeof Planchas !== 'undefined' ? estiloCotaAnot() : undefined }); resultado(r, 'Directriz creada.'); fin(); return true; }
        if (!t) return h3Enter(c);
        return false;
      case 'ESTILOCOTA': {
        const st = S.estiloCota(c.o.nombre);
        const sig = (step, msg) => { c.step = step; prompt(`ESTILOCOTA  ${msg}`); return true; };
        if (c.step === 'nom') { c.o.nombre = t || st.name; c.text = false; const s2 = S.estiloCota(c.o.nombre); return sig('txt', `«${c.o.nombre}». Altura de texto <${s2.txt}>:`); }
        if (c.step === 'txt') { if (t) { if (!(n > 0)) { say('Escriba una altura mayor que 0.'); return true; } c.o.txt = n; } return sig('fl', `Terminación [Flecha rellena(F)/Marca oblicua(M)] <${st.tsz > 0 ? 'M' : 'F'}>:`); }
        if (c.step === 'fl') { if (t) c.o.flecha = /^M/i.test(t) ? 'marca' : 'flecha'; return sig('asz', `Tamaño de flecha o marca <${st.asz}>:`); }
        if (c.step === 'asz') { if (t) { if (!(n > 0)) { say('Escriba un tamaño mayor que 0.'); return true; } c.o.asz = n; } return sig('uni', `La medida se muestra en [mm/cm/m] (el dibujo está en ${{ 4: 'mm', 5: 'cm', 6: 'm' }[S.unidadDibujo()] || 'mm'}) <${st.post.trim() || 'mm'}>:`); }
        if (c.step === 'uni') { if (t) { if (!/^(mm|cm|m)$/i.test(t)) { say('Escriba mm, cm o m.'); return true; } c.o.unidades = t.toLowerCase(); } return sig('dec', `Decimales <${st.dec}>:`); }
        if (c.step === 'dec') { if (t) { if (!(n >= 0 && n <= 8)) { say('Escriba de 0 a 8 decimales.'); return true; } c.o.dec = Math.round(n); } return sig('esc', `Escala general (DIMSCALE; 1 en planchas, p. ej. 500 en el modelo 1:500 en mm) <${st.scale}>:`); }
        if (c.step === 'esc') {
          if (t) { if (!(n > 0)) { say('Escriba una escala mayor que 0.'); return true; } c.o.escala = n; }
          const r = S.crearEstiloCota(c.o.nombre, { ...c.o, actual: true });
          resultado(r, `Estilo de cota «${c.o.nombre}» ${r.nuevo ? 'creado' : 'cambiado'} y actual.`); fin(); return true;
        }
        return false;
      }
      case 'BLOQUE':
        if (c.step === 'nom') {
          if (!t) { say('Escriba un nombre.'); return true; }
          const err = S.validName(t); if (err) { say(err); return true; }
          if (H.doc().dxf.blocks.has(t.toUpperCase())) { say(`Ya existe el bloque «${t}». Escriba otro nombre.`); return true; }
          c.nombre = t; c.text = false; c.step = 'base'; prompt('BLOQUE  Precise el punto base:'); return true;
        }
        if (c.step === 'modo') {
          const modo = !t || /^C/i.test(t) ? 'convertir' : /^R/i.test(t) ? 'retener' : /^B/i.test(t) ? 'borrar' : null;
          if (!modo) { say('Escriba C, R o B.'); return true; }
          const r = S.crearBloque(c.nombre, c.basePt, [...sel], H.page(), modo); setSel([]);
          if (resultado(r, (x) => `Bloque «${c.nombre}» creado con ${x.n} objeto(s). Insértelo con I.`)) { paletteDoc = null; lastBlock = c.nombre; }
          fin(); return true;
        }
        if (c.step === 0 && !t) return h3Enter(c);
        return false;
      case 'ATRDEF':
        if (c.step === 'tag') { if (!t) { say('Escriba la etiqueta.'); return true; } c.o.tag = t; c.step = 'prompt'; prompt(`ATRDEF  Mensaje (lo que se pregunta al insertar) <${t}>:`); return true; }
        if (c.step === 'prompt') { c.o.prompt = raw || c.o.tag; c.step = 'def'; prompt('ATRDEF  Valor por omisión <vacío>:'); return true; }
        if (c.step === 'def') { c.o.def = raw; c.text = false; c.step = 'h'; prompt(`ATRDEF  Altura del texto <${atrH}>:`); return true; }
        if (c.step === 'h') { if (t) { if (!(n > 0)) { say('Escriba una altura mayor que 0.'); return true; } atrH = n; } c.step = 'pt'; prompt('ATRDEF  Precise el punto de inserción:'); return true; }
        return false;
      case 'DESCOMPONER': return c.step === 0 && !t ? h3Enter(c) : false;
      case 'SIMETRIA':
        if (c.step === 0 && !t) return h3Enter(c);
        if (c.step === 3) { const r = S.simetria([...sel], c.p1, c.p2, yes(t, false), H.page()); setSel([]); resultado(r, (x) => `${x.n} objeto(s) reflejado(s).${avisoRechazo(x)}`); fin(); return true; }
        return false;
      case 'MATRIZ': {
        const sig = (step, msg) => { c.step = step; prompt(`MATRIZ  ${msg}`); return true; };
        if (c.step === 0 && !t) return h3Enter(c);
        if (c.step === 'tipo') { if (t && /^P/i.test(t)) return sig('centro', 'Precise el centro de la matriz polar:'); return sig('fil', `Número de filas <${arrFil}>:`); }
        if (c.step === 'fil') { if (t) { if (!(n >= 1)) { say('Escriba un número entero ≥ 1.'); return true; } arrFil = Math.round(n); } return sig('col', `Número de columnas <${arrCol}>:`); }
        if (c.step === 'col') { if (t) { if (!(n >= 1)) { say('Escriba un número entero ≥ 1.'); return true; } arrCol = Math.round(n); } return arrFil > 1 ? sig('df', `Distancia entre filas (negativa = hacia abajo) <${arrDF}>:`) : sig('dc', `Distancia entre columnas (negativa = a la izquierda) <${arrDC}>:`); }
        if (c.step === 'df') { if (t) { if (!Number.isFinite(n) || !n) { say('Escriba una distancia distinta de 0.'); return true; } arrDF = n; } return arrCol > 1 ? sig('dc', `Distancia entre columnas (negativa = a la izquierda) <${arrDC}>:`) : h3Input({ ...c, step: 'dc' }, '', ''); }
        if (c.step === 'dc') {
          if (t) { if (!Number.isFinite(n) || !n) { say('Escriba una distancia distinta de 0.'); return true; } arrDC = n; }
          const r = S.matrizRect([...sel], arrFil, arrCol, arrDF, arrDC, H.page()); setSel([]);
          resultado(r, (x) => `Matriz ${arrFil} × ${arrCol}: ${x.n} copia(s).${avisoRechazo(x)}`); fin(); return true;
        }
        if (c.step === 'n') { if (t) { if (!(n >= 2)) { say('Escriba un número entero ≥ 2.'); return true; } arrN = Math.round(n); } return sig('ang', `Ángulo a llenar (+ = antihorario) <${arrAng}>:`); }
        if (c.step === 'ang') { if (t) { if (!Number.isFinite(n) || !n) { say('Escriba un ángulo distinto de 0.'); return true; } arrAng = n; } return sig('rot', `¿Girar los objetos al copiarlos? [Sí/No] <${arrRot ? 'S' : 'N'}>:`); }
        if (c.step === 'rot') {
          arrRot = yes(t, arrRot);
          let base = null; const ns = [...sel].map((r) => r.node).filter(Boolean);
          if (ns.length) { const [o0, o1] = org(); const b = ns.reduce((a, q) => [Math.min(a[0], q.bb[0]), Math.min(a[1], q.bb[1]), Math.max(a[2], q.bb[2]), Math.max(a[3], q.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]); base = [(b[0] + b[2]) / 2 + o0, (b[1] + b[3]) / 2 + o1]; }
          const r = S.matrizPolar([...sel], c.centro, arrN, arrAng, arrRot, H.page(), base); setSel([]);
          resultado(r, (x) => `Matriz polar: ${x.n} copia(s).${avisoRechazo(x)}`); fin(); return true;
        }
        return false;
      }
      case 'EMPALME':
        if (c.step === 1 && /^R$/i.test(t)) { c.step = 'rad'; c.pick = false; prompt(`EMPALME  Radio de empalme <${filRad}>:`); return true; }
        if (c.step === 'rad') { if (t) { if (!(n >= 0)) { say('Escriba un radio ≥ 0.'); return true; } filRad = n; } c.step = 1; c.pick = true; prompt(`EMPALME  Radio = ${filRad}. Designe la primera línea o [Radio(R)/Polilínea(P)]:`); return true; }
        if (c.step === 1 && /^P$/i.test(t)) { c.step = 'pol'; c.pick = true; prompt('EMPALME  Designe la polilínea:'); return true; }
        if (!t) return h3Enter(c);
        return false;
      case 'CHAFLAN':
        if (c.step === 1 && /^D$/i.test(t)) { c.step = 'd1'; c.pick = false; prompt(`CHAFLAN  Primera distancia <${chaD1}>:`); return true; }
        if (c.step === 'd1') { if (t) { if (!(n >= 0)) { say('Escriba una distancia ≥ 0.'); return true; } chaD1 = n; chaD2 = n; } c.step = 'd2'; prompt(`CHAFLAN  Segunda distancia <${chaD2}>:`); return true; }
        if (c.step === 'd2') { if (t) { if (!(n >= 0)) { say('Escriba una distancia ≥ 0.'); return true; } chaD2 = n; } c.step = 1; c.pick = true; prompt(`CHAFLAN  Distancias = ${chaD1} y ${chaD2}. Designe la primera línea o [Distancias(D)/Polilínea(P)]:`); return true; }
        if (c.step === 1 && /^P$/i.test(t)) { c.step = 'pol'; c.pick = true; prompt('CHAFLAN  Designe la polilínea:'); return true; }
        if (!t) return h3Enter(c);
        return false;
      case 'TABLA': {
        const sig = (step, msg, text) => { c.step = step; c.text = !!text; prompt(`TABLA  ${msg}`); return true; };
        if (c.step === 'cols') {
          if (t && t.includes(';')) { // R2-fix M-12: «30;15;15» en columnas = anchos de columna (3 columnas)
            const a = t.split(';').map((x) => x.trim()).filter((x) => x !== '').map(num);
            if (a.length < 1 || a.length > 50 || a.some((x) => !(x > 0))) { say('Escriba el número de columnas (1 a 50) o los anchos separados por ; (como 30;15;15).'); return true; }
            tabCols = a.length; tabAnchos = a.join(';'); c.anchosDados = true;
            say(`Tomé «${t}» como anchos de columna: ${a.length} columna(s) de ${a.map((x) => String(x).replace('.', ',')).join(', ')}.`);
          } else if (t) { if (!/^\d+$/.test(t) || !(n >= 1 && n <= 50)) { say('Escriba un número entero de 1 a 50 columnas (o los anchos separados por ; como 30;15;15).'); return true; } tabCols = Math.round(n); }
          return sig('filas', `Número de filas de datos (sin contar el título) <${tabFilas}>:`);
        }
        if (c.step === 'filas') { if (t) { if (!/^\d+$/.test(t) || !(n >= 1 && n <= 200)) { say('Escriba un número entero de 1 a 200 filas.'); return true; } tabFilas = Math.round(n); } if (c.anchosDados) return sig('alto', `Alto de fila <${tabAlto}>:`); return sig('anchos', `Ancho de las columnas (uno para todas, o separados por ; como 40;25;25) <${tabAnchos}>:`); }
        if (c.step === 'anchos') { if (t) { const a = t.split(';').map(num); if (a.some((x) => !(x > 0))) { say('Escriba anchos mayores que 0.'); return true; } tabAnchos = t; } return sig('alto', `Alto de fila <${tabAlto}>:`); }
        if (c.step === 'alto') { if (t) { if (!(n > 0)) { say('Escriba un alto mayor que 0.'); return true; } tabAlto = n; } return sig('titulo', 'Título de la tabla (Enter = sin título):', true); }
        if (c.step === 'titulo') { c.titulo = raw.trim(); c.filas = []; return sig('fila', `Fila 1 de ${tabFilas}: celdas separadas por ; (Enter = vacía):`, true); }
        if (c.step === 'fila') {
          c.filas.push(raw.split(';'));
          if (c.filas.length < tabFilas) { prompt(`TABLA  Fila ${c.filas.length + 1} de ${tabFilas}: celdas separadas por ; (Enter = vacía):`); return true; }
          const a = String(tabAnchos).split(';').map(num);
          const r = S.crearTabla(H.page(), { at: c.at, titulo: c.titulo, datos: c.filas, columnas: tabCols, filas: tabFilas, anchos: a.length > 1 ? a : a[0], alto: tabAlto, h: Math.min(textH, tabAlto * 0.5) });
          resultado(r, (x) => `Tabla de ${x.filas} × ${x.columnas} (${x.ancho.toFixed(1)} × ${x.alto.toFixed(1)}). Los textos se corrigen con ED o doble clic.`); fin(); return true;
        }
        return false;
      }
    }
    return false;
  }

  /** Vista previa de los comandos H3. */
  h3Overlay.covers = (n) => ['COTALIN', 'COTAALINEADA', 'DIRECTRIZ', 'COTARADIO', 'COTADIAM', 'SIMETRIA', 'MATRIZ', 'TABLA'].includes(n);
  function h3Overlay(ctx, dpr, S2, cur, line) {
    const c = cmd;
    if ((c.name === 'COTALIN' || c.name === 'COTAALINEADA') && c.pts && c.pts.length) {
      ctx.setLineDash([5, 4]); for (const p of c.pts) line(S2(p), cur); ctx.setLineDash([]);
    } else if (c.name === 'DIRECTRIZ' && c.pts.length && c.step === 1) {
      let prev = null; for (const p of c.pts) { const s = S2(p); if (prev) line(prev, s); prev = s; } line(prev, cur);
    } else if ((c.name === 'COTARADIO' || c.name === 'COTADIAM') && c.circ) {
      line(S2(c.circ.c), cur);
    } else if (c.name === 'SIMETRIA' && c.step === 2) {
      ctx.setLineDash([6, 4]); line(S2(c.p1), cur); ctx.setLineDash([]);
      if (Math.hypot(cursor[0] - c.p1[0], cursor[1] - c.p1[1]) > 1e-9) {
        const C = Dibujo.mirrorC(c.p1, cursor), r = C.deg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
        ghost(ctx, dpr, [...sel].map((q) => q.node).filter(Boolean), Scene.mul([co, si, si, -co, C.dx, C.dy], [1, 0, 0, 1, ...org()]));
      }
    } else if (c.name === 'MATRIZ' && c.centro) {
      const q = S2(c.centro); ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.stroke();
    } else if (c.name === 'TABLA' && c.at) {
      const q = S2(c.at); ctx.strokeRect(q[0], q[1], 40, 20);
    }
  }

  // ---------------------------------------------------------------- Símbolos EPM, redes, plantilla EPM y verificador de textos
  let bibDoc = null, simbFiltro = 'todos', redTipo = 'MT_DESNUDA', redEst = 'PR', verif = null, verifSel = -1;
  const hayEPM = () => typeof SimbolosEPM !== 'undefined';
  /** Escala por omisión de los símbolos: 1 en planchas (mm de papel); en el modelo en metros, 0,5 (= 1:500). */
  function escalaSimbolo() {
    const pg = H.page(); if (pg && pg.ms) return 1 / (pg.ms.k * ((H.paperPage ? H.paperPage().unitMM : 1) || 1)); // dentro de una ventana: tamaño de papel a su escala
    if (!pg || pg.edit.space !== 'model') return 1;
    return S.unidadDibujo() === 6 ? 0.5 : 1;
  }
  async function bibliotecaDoc() {
    if (bibDoc) return bibDoc;
    bibDoc = await DXF.open(new TextEncoder().encode(SimbolosEPM.biblioteca()));
    return bibDoc;
  }
  async function elegirSimbolo(nombre) {
    $('simbs').classList.remove('show');
    const r = S.definirSimbolo(nombre);
    if (r.error) { say(r.error); return; }
    if (!r.ya) { paletteDoc = null; await afterEdit(); }
    insScale = escalaSimbolo(); insRot = 0;
    chooseBlock(nombre);
    const info = SimbolosEPM.lista().find((x) => x.bloque === nombre);
    if (info) say(`${info.nombre} (${info.estado}) — ${info.cita}. Escala ${insScale}.`);
  }
  async function paletaSimbolos() {
    if (!hayEPM()) { say('No está cargada la biblioteca de símbolos EPM (web/simbolos_epm.js).'); return; }
    const el = $('simbs'); if (!el) return;
    ['layers', 'marks', 'lman', 'props', 'blocks', 'verif'].forEach((id) => $(id) && $(id).classList.remove('show'));
    el.classList.add('show');
    const grid = $('sgrid');
    if (!grid.dataset.ok) {
      grid.innerHTML = '<div style="color:var(--dim);grid-column:1/-1">Dibujando símbolos…</div>';
      const bd = await bibliotecaDoc(); grid.innerHTML = '';
      const dpr = window.devicePixelRatio || 1;
      for (const s of SimbolosEPM.lista()) {
        const d = document.createElement('div'); d.className = 'bk'; d.title = `${s.nombre} — ${s.estado}\n${s.cita}\n${s.bloque}`;
        d.dataset.name = (s.bloque + ' ' + s.nombre + ' ' + s.grupo).toUpperCase(); d.dataset.estado = s.estado;
        const cv = document.createElement('canvas'); cv.width = 88 * dpr; cv.height = 64 * dpr;
        const bn = bd.blockNode(s.bloque);
        if (bn) { const g = cv.getContext('2d'); const b = bn.node.bb; const w = Math.max(b[2] - b[0], 1e-9), h = Math.max(b[3] - b[1], 1e-9); const k = Math.min((88 - 10) / w, (64 - 10) / h) * dpr;
          g.setTransform(k, 0, 0, -k, (88 * dpr - w * k) / 2 - b[0] * k, (64 * dpr + h * k) / 2 + b[1] * k); try { Scene.render(g, bn.node, b, k); } catch (e) { /* miniatura opcional */ } }
        const t = document.createElement('div'); t.textContent = `${s.nombre}${s.estado === 'existente' ? ' (E)' : s.estado === 'proyectado' ? ' (P)' : ''}`;
        d.appendChild(cv); d.appendChild(t);
        d.onclick = () => { if (!enabled()) return; cancel(true); elegirSimbolo(s.bloque); };
        grid.appendChild(d);
      }
      grid.dataset.ok = '1';
    }
    filtrarSimbolos();
    $('sFind').focus();
  }
  function filtrarSimbolos() {
    const q = ($('sFind').value || '').trim().toUpperCase();
    for (const d of $('sgrid').children) {
      const est = d.dataset.estado || '';
      const okE = simbFiltro === 'todos' || est === simbFiltro || est === 'existente o proyectado';
      d.style.display = (!q || (d.dataset.name || '').includes(q)) && okE ? '' : 'none';
    }
    for (const b of document.querySelectorAll('#simbs .sf')) b.classList.toggle('on', b.dataset.f === simbFiltro);
  }
  if (typeof document !== 'undefined' && document.getElementById('simbs')) {
    $('sFind').oninput = filtrarSimbolos;
    $('sClose').onclick = () => $('simbs').classList.remove('show');
    for (const b of document.querySelectorAll('#simbs .sf')) b.onclick = () => { simbFiltro = b.dataset.f; filtrarSimbolos(); };
    if ($('cSimb')) $('cSimb').onclick = () => { if ($('simbs').classList.contains('show')) $('simbs').classList.remove('show'); else paletaSimbolos(); };
    $('vClose').onclick = () => { $('verif').classList.remove('show'); verif = null; H.redraw(true); };
    if ($('cVerif')) $('cVerif').onclick = () => start('VERIFICAR');
    if ($('cCheck')) $('cCheck').onclick = () => start('CHECKEPM');   // H6-E
    if ($('cComp')) $('cComp').onclick = () => start('COMPARAR');     // H6-E
  }

  async function verificar() {
    if (typeof Verificador === 'undefined') { say('No está cargado el verificador (web/verificador.js).'); return; }
    const pg = H.paperPage ? H.paperPage() : H.page(); // dentro de una ventana se revisa la plancha
    say(`VERIFICAR  Revisando «${pg.title}» (textos montados y alturas)…`);
    try {
      const r = await Verificador.verificar(new TextEncoder().encode(S.serialize()), { presentacion: pg.edit.space === 'model' ? 'Model' : pg.title, nombre: 'plano', sinBordeEnModelo: true });
      verif = r; verifSel = -1;
      const n = r.colisiones.length;
      say(`VERIFICAR  ${r.presentacion}: ${r.textos} textos, altura mínima ${r.alturaMinima ?? '—'} mm, ${r.menores25} < 2,5 mm · ${n ? n + ' choque(s)' : 'sin choques'}.`);
      const box = $('vlist'); box.innerHTML = '';
      const head = document.createElement('div'); head.className = 'vh';
      head.textContent = `${r.presentacion} · ${r.textos} textos · mín. ${r.alturaMinima ?? '—'} mm · ${r.menores2} < 2,0 · ${r.menores25} < 2,5 · ${n} choque(s) · letra ${r.metrica}`;
      box.appendChild(head);
      const items = [...r.colisiones.map((c) => ({ t: c[0], a: c[1], b: c[2], x: c[3], y: c[4], k: 'c' })), ...r.textosBajos.map((x) => ({ t: `ALTURA ${x.h} mm`, a: x.texto, b: x.h < 2 ? '< 2,0 mm' : '< 2,5 mm (6.3.1 c)', x: x.x, y: x.y, k: 'h' }))];
      verif.items = items;
      if (!items.length) { const d = document.createElement('div'); d.className = 'vi'; d.textContent = 'Todo limpio: ningún texto montado ni bajo de altura.'; box.appendChild(d); }
      items.forEach((it, i) => {
        const d = document.createElement('div'); d.className = 'vi' + (it.k === 'h' ? ' vh2' : '');
        d.innerHTML = `<b></b><span></span>`; d.firstChild.textContent = `${i + 1}. ${it.t}`; d.lastChild.textContent = ` ${it.a}${it.b ? ' ↔ ' + it.b : ''} (${it.x}, ${it.y})`;
        d.onclick = () => { verifSel = i; for (const q of box.querySelectorAll('.vi')) q.classList.remove('on'); d.classList.add('on'); irA(it.x, it.y); };
        box.appendChild(d);
      });
      ['layers', 'marks', 'lman', 'props', 'blocks', 'simbs'].forEach((id) => $(id) && $(id).classList.remove('show'));
      $('verif').classList.add('show');
      H.redraw(true);
    } catch (e) { say('VERIFICAR  No se pudo revisar: ' + (e && e.message || e)); }
  }
  /** Centra la vista en un punto de la hoja (coordenadas locales) con unos 120 mm a la vista. */
  function irA(x, y) {
    if (!H.centerOn) return;
    const m = H.page().rootM; const [px, py] = mulPt(m, x, y);
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    H.centerOn(px, py, 120 * k);
  }
  function verifOverlay(ctx) {
    if (!verif || !verif.items || !$('verif').classList.contains('show')) return;
    verif.items.forEach((it, i) => {
      const [x, y] = localToScreen(it.x, it.y);
      ctx.strokeStyle = it.k === 'h' ? '#ff9f0a' : '#ff3b30'; ctx.lineWidth = i === verifSel ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, i === verifSel ? 14 : 9, 0, Math.PI * 2); ctx.stroke();
      if (i === verifSel) { ctx.font = 'bold 12px -apple-system, sans-serif'; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(String(i + 1), x + 16, y - 10); }
    });
  }

  function epmStart(name) {
    switch (name) {
      case 'INSERTARSIMBOLO':
        if (!hayEPM()) { say('No está cargada la biblioteca de símbolos EPM.'); return true; }
        cmd = { name, label: name, step: 0, text: true };
        prompt('INSERTARSIMBOLO  Nombre o parte del nombre del símbolo (poste, trafo, caja, DPS…; ? = lista) o elija en la paleta «Símbolos EPM»:');
        paletaSimbolos(); return true;
      case 'REDEPM': {
        if (!hayEPM()) { say('No está cargada la biblioteca de símbolos EPM.'); return true; }
        const tipos = Object.keys(SimbolosEPM.REDES);
        cmd = { name, label: name, step: 'tipo', text: false, pts: [] };
        prompt(`REDEPM  Tipo de red [${tipos.map((t, i) => `${i + 1}=${t}`).join(' ')}] <${redTipo}>:`); return true;
      }
      case 'PLANTILLAEPM':
        cmd = { name, label: name };
        prompt('PLANTILLAEPM  Hoja [1000x707 (EPM)/A0/A1/A2] <1000x707>:'); return true;
      case 'VERIFICAR': cmd = null; idlePrompt(); verificar(); return true;
      case 'COMPARAR': case 'CHECKEPM':
        cmd = null; idlePrompt();
        if (typeof H6E === 'undefined') { say('No está cargada la interfaz de COMPARAR/CHECKEPM (web/h6e_ui.js).'); return true; }
        H6E.iniciar(name, { say, irA, serializar: () => S.serialize(), page: () => H.page(), paperPage: () => (H.paperPage ? H.paperPage() : H.page()), goPage: (n) => H.goPage && H.goPage(n), doc: () => H.doc(), redraw: () => H.redraw(true), copiar: (t) => copiarTexto(t) });
        return true;
    }
    return false;
  }
  function epmPoint(c, p) {
    if (c.name === 'REDEPM' && c.step === 'pts') { c.pts.push(p); c.base = p; prompt(`REDEPM  Siguiente punto${c.pts.length >= 2 ? ' <Enter = terminar>' : ''}:`); return true; }
    return c.name === 'INSERTARSIMBOLO' || c.name === 'REDEPM' || c.name === 'PLANTILLAEPM';
  }
  function epmInput(c, t, raw) {
    switch (c.name) {
      case 'INSERTARSIMBOLO': {
        const L = SimbolosEPM.lista();
        if (t === '?') { say('Símbolos: ' + L.map((s) => s.bloque).join(', ')); return true; }
        if (!t) { cancel(true); return true; }
        const q = t.toUpperCase();
        const exacto = L.find((s) => s.bloque === q || s.bloque === 'EPM_' + q);
        const m = exacto ? [exacto] : L.filter((s) => (s.bloque + ' ' + s.nombre).toUpperCase().includes(q));
        if (m.length === 1) { cmd = null; elegirSimbolo(m[0].bloque); return true; }
        if (!m.length) { say(`Ningún símbolo con «${t}». Escriba ? para la lista.`); return true; }
        $('sFind').value = t; paletaSimbolos();
        say(`${m.length} símbolos con «${t}»: ` + m.slice(0, 12).map((s) => s.bloque).join(', ') + (m.length > 12 ? '…' : '') + '. Escriba el nombre completo o elija en la paleta.');
        return true;
      }
      case 'REDEPM':
        if (c.step === 'tipo') {
          const tipos = Object.keys(SimbolosEPM.REDES);
          if (t) { const k = parseInt(t, 10); const tt = k >= 1 && k <= tipos.length ? tipos[k - 1] : tipos.find((x) => x === t.toUpperCase()); if (!tt) { say(`Tipo no válido: «${t}».`); return true; } redTipo = tt; }
          c.step = 'est'; prompt(`REDEPM  ${SimbolosEPM.REDES[redTipo].nombre}. [Existente(E)/Proyectada(P)] <${redEst === 'EX' ? 'E' : 'P'}>:`); return true;
        }
        if (c.step === 'est') { if (t) redEst = /^E/i.test(t) ? 'EX' : 'PR'; c.step = 'pts'; prompt('REDEPM  Precise el primer punto:'); return true; }
        if (c.step === 'pts' && !t) {
          if (c.pts.length >= 2) { const r = S.trazarRedEPM(H.page(), redTipo, redEst, c.pts, { escala: escalaSimbolo() }); resultado(r, (x) => `Red ${SimbolosEPM.REDES[redTipo].nombre} (${redEst === 'EX' ? 'existente' : 'proyectada'}): ${x.n} trazo(s). Cita: NC-RA8-001 Anexo A, pág. 51.`); }
          fin(); return true;
        }
        return false;
      case 'PLANTILLAEPM': {
        const h = !t ? '1000x707' : /^(1000|EPM)/i.test(t) ? '1000x707' : /^A[012]$/i.test(t) ? t.toUpperCase() : null;
        if (!h) { say('Escriba 1000x707, A0, A1 o A2.'); return true; }
        cmd = null; idlePrompt();
        if (typeof PlantillaEPM === 'undefined') { say('No está cargada la plantilla EPM (web/plantilla_epm.js).'); return true; }
        if (window.domoNuevoEPM) window.domoNuevoEPM(h); else say('PLANTILLAEPM no está disponible aquí.');
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- ARCO (3 puntos, o centro-inicio-fin en sentido antihorario, como AutoCAD)
  function addArc(cen, r, a0, a1) { return S.add(H.page(), 'ARC', 'AcDbCircle', [[10, cen[0]], [20, cen[1]], [30, 0], [40, r], [100, 'AcDbArc'], [50, Edit.norm360(a0)], [51, Edit.norm360(a1)]], L()); }
  const arco3 = (a, b, c) => Geom.arco3(a, b, c);
  function arcoPunto(c, p) {
    c.pts.push(p); c.base = p;
    if (c.centro) {
      if (c.pts.length === 1) { prompt('ARCO  Precise el punto inicial:'); return; }
      if (c.pts.length === 2) { prompt('ARCO  Precise el punto final (sentido antihorario):'); return; }
      const [cen, a, b] = c.pts; const r = Math.hypot(a[0] - cen[0], a[1] - cen[1]); if (r < 1e-12) { say('El radio es cero.'); cmd = null; idlePrompt(); return; }
      addArc(cen, r, Math.atan2(a[1] - cen[1], a[0] - cen[0]) * 180 / Math.PI, Math.atan2(b[1] - cen[1], b[0] - cen[0]) * 180 / Math.PI); afterEdit(); cmd = null; idlePrompt(); return;
    }
    if (c.pts.length === 1) { prompt('ARCO  Precise el segundo punto del arco:'); return; }
    if (c.pts.length === 2) { prompt('ARCO  Precise el punto final:'); return; }
    const A = arco3(...c.pts); if (!A) { say('Los tres puntos están alineados: no hay arco.'); c.pts.pop(); return; }
    addArc(A.c, A.r, A.a0, A.a1); afterEdit(); cmd = null; idlePrompt();
  }

  // ---------------------------------------------------------------- H4: planchas, ventanas, escalas, zoom y rótulo
  let vpEscala = 500, hojaNueva = null, anotAviso = false;
  const hay4 = () => typeof Planchas !== 'undefined';
  const PL = () => H.paperPage ? H.paperPage() : H.page(); // la plancha en pantalla (aunque se trabaje dentro de una ventana)
  const enPlancha = () => { const p = PL(); return p && p.edit && p.edit.space === 'paper'; };
  const listaEscalas = () => Planchas.ESCALAS.map((n) => `1:${n}`).join('/');
  const plActual = () => (enPlancha() ? S.planchas().find((x) => PL().layout && x.rec === PL().layout.rec) : null);
  /** Escala 1:N para anotar (texto y cotas) donde se dibuja ahora: la de la ventana activa o la del modelo (ESCALAANOT). */
  function anotN() {
    const pg = H.page(); if (!pg || !S) return null;
    if (pg.ms) { const N = S.escalaVentana(PL(), pg.ms.rec); return N > 0 ? N : null; }
    if (pg.edit && pg.edit.space === 'model') return S.escalaAnot();
    return null;
  }
  function estiloCotaAnot() {
    const N = anotN(); if (!N) return undefined;
    const r = S.estiloAnot(N); if (r.error) { say(r.error); return undefined; }
    if (r.nuevo) say(`Estilo de cota «${r.name}» creado para anotar a ${Planchas.textoEscala(N)} (texto y flechas a su tamaño en el papel).`);
    return r.name;
  }
  /** La ventana sobre la que actúa un comando: la activa (ESPACIOM), la designada o la única de la plancha. */
  function ventanaObjetivo() {
    const pg = H.page();
    if (pg && pg.ms) return pg.ms.rec;
    const vs = [...sel].filter((r) => r.type === 'VIEWPORT');
    if (vs.length === 1) return vs[0];
    if (!enPlancha()) return null;
    const todas = S.ventanas(PL());
    return todas.length === 1 ? todas[0] : null;
  }
  /** Ventana bajo un punto del papel (la más pequeña que lo contiene). */
  function ventanaEn(p) {
    const info = (PL().vpInfo || []).filter((v) => p[0] >= v.rect[0] && p[0] <= v.rect[2] && p[1] >= v.rect[1] && p[1] <= v.rect[3]);
    info.sort((a, b) => (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]) - (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]));
    return info.length ? info[0].rec : null;
  }
  const descVentana = (vp) => { const d = S.datosVentana(PL(), vp); return `ventana ${d.id} · ${Planchas.textoEscala(d.escala)}${d.bloqueada ? ' · bloqueada' : ''}${d.giro ? ` · giro ${d.giro}°` : ''}${d.capas.length ? ` · ${d.capas.length} capa(s) inutilizada(s)` : ''}`; };
  /** Pide una ventana si hace falta y sigue con fn(vp). */
  function conVentana(c, msg, fn) {
    const vp = ventanaObjetivo();
    if (vp) { fn(vp); return; }
    if (!enPlancha()) { say('Este comando trabaja con ventanas de una plancha: vaya a una plancha (pestañas de abajo).'); fin(); return; }
    if (!S.ventanas(PL()).length) { say('Esta plancha no tiene ventanas. Cree una con VENTANAS (MV).'); fin(); return; }
    c.step = 'vp'; c.fnVp = fn; c.typed = false; prompt(`${c.label}  ${msg || 'Haga clic dentro de la ventana (o en su borde)'}:`);
  }
  function irPlancha(name) { if (H.goPage) H.goPage(name); }
  function pedirHoja(c, sig) {
    const pl = plActual();
    const actual = pl ? (pl.media || `${pl.w} x ${pl.h} mm`) : 'A3';
    c.step = 'hoja'; c.sig = sig; c.typed = true; c.text = true;
    prompt(`${c.label}  Hoja [${Planchas.NOMBRES_HOJA.join('/')} o ancho x alto en mm] <${c.hojaDef || actual}>:`);
  }

  function h4Start(name) {
    if (!hay4()) return false;
    const pide = (c, msg) => { cmd = { label: name, name, ...c }; prompt(`${name}  ${msg}`); };
    switch (name) {
      case 'PRESENTACION':
        pide({ step: 'op', typed: true }, `Planchas: ${S.planchas().map((p) => p.name).join(', ')}. [Nueva(N)/Copiar(C)/Renombrar(R)/Borrar(B)/Ordenar(O)/Hoja(H)/Ir a(I)/?] <Nueva>:`); return true;
      case 'CONFIGPAG': {
        if (!enPlancha()) { say('CONFIGPAG trabaja sobre una plancha: elija una pestaña de plancha abajo.'); idlePrompt(); return true; }
        cmd = { name, label: name, plancha: PL().title }; pedirHoja(cmd, 'orient'); return true;
      }
      case 'VENTANAS':
        if (!enPlancha()) { say('Las ventanas se crean en una plancha (como MVIEW en una presentación). Elija una pestaña de plancha.'); idlePrompt(); return true; }
        if (H.page().ms) H.salirVentana();
        pide({ step: 1, pts: [] }, 'Precise la primera esquina o [Ajustar a la hoja (A)/Bloquear (B)/Desbloquear (D)]:'); return true;
      case 'ESCALAVENTANA': {
        const c = { name, label: name, step: 0 }; cmd = c;
        conVentana(c, null, (vp) => { c.vp = vp; c.step = 'esc'; c.typed = true; prompt(`${name}  ${descVentana(vp)}. Escala [${listaEscalas()} o 1:N personalizada] <${Planchas.textoEscala(S.escalaVentana(PL(), vp))}>:`); });
        return true;
      }
      case 'VBLOQUEAR': {
        const c = { name, label: name, step: 'si', typed: true }; cmd = c;
        prompt('VBLOQUEAR  ¿Bloquear la escala de la ventana? [Sí(S)/No(N)] <S>:'); return true;
      }
      case 'VPLAYER': {
        const c = { name, label: name, step: 'op', typed: true, text: true }; cmd = c;
        prompt('VPLAYER  Capas por ventana [Inutilizar(I)/Reutilizar(R)/Reutilizar todas(T)/Lista(?)] <I>:'); return true;
      }
      case 'VGIRO': {
        const c = { name, label: name, step: 0 }; cmd = c;
        conVentana(c, null, (vp) => { c.vp = vp; c.step = 'ang'; c.typed = true; prompt(`VGIRO  ${descVentana(vp)}. Ángulo de giro de la vista en grados <${vp.num(51, 0)}>:`); });
        return true;
      }
      case 'ESPACIOM': {
        if (H.page().ms) { say('Ya está dentro de una ventana. ESPACIOP (PS) vuelve al papel.'); idlePrompt(); return true; }
        if (!enPlancha()) { say('En el Modelo ya se dibuja en el modelo. ESPACIOM sirve en una plancha con ventanas.'); idlePrompt(); return true; }
        const vs = S.ventanas(PL()).filter((v) => (PL().vpInfo || []).some((i) => i.rec === v));
        if (!vs.length) { say('Esta plancha no tiene ventanas (VENTANAS crea una).'); idlePrompt(); return true; }
        if (vs.length === 1) { entrar(vs[0]); return true; }
        cmd = { name, label: name, step: 'vp' }; prompt('ESPACIOM  Haga clic dentro de la ventana donde quiere trabajar:'); return true;
      }
      case 'ESPACIOP':
        if (H.page().ms) { H.salirVentana(); say('Espacio papel: se dibuja sobre la plancha.'); } else say('Ya está en el espacio papel (o en el Modelo).');
        idlePrompt(); return true;
      case 'ZOOM':
        pide({ step: 1, pts: [], pick: true }, `[Extensión(E)/Ventana(V)/Previo(P)/Todo(T)${H.page().ms ? '/nXP = escala' : ''}] o precise una esquina de la ventana:`); return true;
      case 'ZOOMEX': zoomOpcion('E'); idlePrompt(); return true;
      case 'ZOOMV': pide({ name: 'ZOOM', label: 'ZOOM', step: 2, pts: [], pick: true }, 'Precise la primera esquina:'); return true;
      case 'ZOOMP': zoomOpcion('P'); idlePrompt(); return true;
      case 'ENCUADRE':
        pide({ step: 1, pts: [] }, `${H.page().ms ? 'Dentro de la ventana: ' : ''}precise el punto base:`); return true;
      case 'ESCALAANOT': {
        if (H.page().ms) { const N = anotN(); say(`Dentro de la ventana se anota a su escala: ${Planchas.textoEscala(N)} (texto en mm de papel; cotas con el estilo «ANOT»).`); idlePrompt(); return true; }
        const N = S.escalaAnot();
        pide({ step: 'n', typed: true }, `Escala de anotación del modelo [1:N/Ninguna(N)] <${N ? Planchas.textoEscala(N) : 'ninguna'}>:`); return true;
      }
      case 'ROTULO': abrirRotulo(); return true;
    }
    return false;
  }
  function entrar(vp) {
    H.entrarVentana(vp);
    const d = S.datosVentana(PL(), vp);
    say(`Espacio modelo dentro de la ventana ${d.id} (${Planchas.textoEscala(d.escala)}${d.bloqueada ? ', escala bloqueada' : ''}): lo que dibuje va al modelo. Texto y cotas salen a la escala de la ventana. PS o doble clic fuera = volver al papel.`);
    cmd = null; idlePrompt();
  }
  function zoomOpcion(o, extra) {
    const pg = H.page();
    if (pg.ms && !(pg.ms.rec.int(90, 0) & 16384)) { // dentro de una ventana desbloqueada: cambia lo que muestra la ventana
      const vp = pg.ms.rec;
      if (o === 'E') return resultado(S.zoomExtVentana(vp), 'Zoom extensión dentro de la ventana.');
      if (o === 'V') return resultado(S.zoomVentanaA(vp, extra), 'Zoom ventana dentro de la ventana.');
      if (o === 'P') { const u = S.undoStack[S.undoStack.length - 1]; if (u && /ventana/i.test(u.label) && /Zoom|Encuadre/.test(u.label)) { S.undo(); afterEdit(); say('Vista anterior de la ventana.'); } else say('No hay una vista anterior de la ventana.'); return true; }
      if (o === 'XP') return resultado(S.ponerEscalaVentana(PL(), vp, extra), `Escala de la ventana ${Planchas.textoEscala(extra)}.`);
    }
    if (pg.ms && o === 'XP') { say('La ventana está bloqueada.'); return true; }
    if (o === 'E') { H.zoomExt(); return true; }
    if (o === 'T') { H.zoomAll ? H.zoomAll() : H.fit(); return true; }
    if (o === 'P') { if (!H.zoomPrev()) say('No hay una vista anterior.'); return true; }
    if (o === 'V') { const m = H.page().rootM; const a = mulPt(m, extra[0], extra[1]), b = mulPt(m, extra[2], extra[3]); H.zoomWin([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]); return true; }
    return false;
  }

  function h4Point(c, p) {
    switch (c.name) {
      case 'VENTANAS':
        if (c.step === 1) { c.pts = [p]; c.base = p; c.step = 2; prompt('VENTANAS  Precise la esquina opuesta:'); return true; }
        if (c.step === 2) { c.pts.push(p); c.step = 'esc'; c.typed = true; c.text = true; prompt(`VENTANAS  Escala [${listaEscalas()}, 1:N personalizada o Ajustar(A) a lo dibujado] <1:${vpEscala}>:`); return true; }
        if (c.step === 'vp') { const vp = ventanaEn(p); if (!vp) { say('Ahí no hay una ventana.'); return true; } const r = S.bloquearVentana(vp, c.lock); if (resultado(r, `Ventana ${c.lock ? 'bloqueada' : 'desbloqueada'}.`)) prompt(`VENTANAS  Otra ventana a ${c.lock ? 'bloquear' : 'desbloquear'} <Enter = terminar>:`); return true; }
        return true;
      case 'ESPACIOM': { const vp = ventanaEn(p); if (!vp) { say('Ahí no hay una ventana.'); return true; } entrar(vp); return true; }
      case 'ZOOM':
        if (c.step === 1 || c.step === 2) { c.pts = [p]; c.base = p; c.step = 3; prompt('ZOOM  Precise la esquina opuesta:'); return true; }
        if (c.step === 3) { const a = c.pts[0]; zoomOpcion('V', [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[0], p[0]), Math.max(a[1], p[1])]); fin(); return true; }
        return true;
      case 'ENCUADRE':
        if (c.step === 1) { c.pts = [p]; c.base = p; c.step = 2; prompt('ENCUADRE  Precise el punto de destino:'); return true; }
        if (c.step === 2) {
          const a = c.pts[0]; const pg = H.page();
          if (pg.ms) { const cv = S.centroVistaVentana(pg.ms.rec); resultado(S.vistaVentana(pg.ms.rec, [cv[0] - (p[0] - a[0]), cv[1] - (p[1] - a[1])], null), 'Encuadre dentro de la ventana.'); }
          else { const m = pg.rootM; const A = mulPt(m, a[0], a[1]), B = mulPt(m, p[0], p[1]); H.panPage(B[0] - A[0], B[1] - A[1]); }
          fin(); return true;
        }
        return true;
    }
    if (c.step === 'vp' && c.fnVp) {
      const vp = ventanaEn(p); if (!vp) { say('Ahí no hay una ventana. Haga clic dentro de una ventana de la plancha.'); return true; }
      const fn = c.fnVp; c.fnVp = null; setSel([vp]); fn(vp); return true;
    }
    return false;
  }

  function h4Enter(c) {
    if (c.name === 'VENTANAS' && c.step === 'vp') { fin(); return true; }
    if (c.name === 'VENTANAS' && c.step === 1) { fin(); return true; }
    return false;
  }

  function h4Input(c, t, raw) {
    if (!hay4()) return false;
    const T = t.toUpperCase();
    const yesNo = (def) => (!t ? def : /^(S|SI|SÍ|Y|YES)$/i.test(t) ? true : /^(N|NO)$/i.test(t) ? false : null);
    switch (c.name) {
      case 'PRESENTACION': {
        const L = S.planchas(); const act = plActual();
        const buscar = (n) => L.find((p) => p.name.toUpperCase() === n.toUpperCase()) || (/^\d+$/.test(n) ? L[+n - 1] : null);
        if (c.step === 'op') {
          const o = !t ? 'N' : T === '?' ? '?' : T[0];
          if (o === '?') { say('Planchas: ' + L.map((p, i) => `${i + 1}. ${p.name} (${p.media || `${p.w}x${p.h}`})${p.activa ? ' *' : ''}`).join(' · ')); return true; }
          c.op = { N: 'nueva', C: 'copiar', R: 'renombrar', B: 'borrar', E: 'borrar', O: 'ordenar', H: 'hoja', I: 'ir', D: 'ir' }[o];
          if (!c.op) { say(`Opción no válida: «${t}».`); return true; }
          c.text = true;
          if (c.op === 'nueva') { let k = L.length + 1; let n = `Plancha ${k}`; while (buscar(n)) n = `Plancha ${++k}`; c.def = n; c.step = 'nombre'; prompt(`PRESENTACION  Nombre de la plancha nueva <${n}>:`); return true; }
          c.step = 'cual'; prompt(`PRESENTACION  Plancha a ${({ copiar: 'copiar', renombrar: 'renombrar', borrar: 'borrar', ordenar: 'mover', hoja: 'cambiar de hoja', ir: 'abrir' })[c.op]} [${L.map((p) => p.name).join('/')}] <${act ? act.name : L[0] ? L[0].name : ''}>:`);
          return true;
        }
        if (c.step === 'cual') {
          const pl = t ? buscar(t) : (act || L[0]); if (!pl) { say(`No existe la plancha «${t}».`); return true; }
          c.pl = pl;
          if (c.op === 'ir') { fin(); irPlancha(pl.name); return true; }
          if (c.op === 'copiar') { let k = 2; let n = `${pl.name} (${k})`; while (buscar(n)) n = `${pl.name} (${++k})`; c.def = n; c.step = 'nombre'; prompt(`PRESENTACION  Nombre de la copia <${n}>:`); return true; }
          if (c.op === 'renombrar') { c.step = 'nombre'; c.def = pl.name; prompt(`PRESENTACION  Nuevo nombre para «${pl.name}» <${pl.name}>:`); const inp = $('cInput'); setTimeout(() => { inp.value = pl.name; inp.select(); }, 0); return true; }
          if (c.op === 'borrar') { c.step = 'conf'; c.typed = true; prompt(`PRESENTACION  ¿Borrar la plancha «${pl.name}» y todo lo dibujado en ella? [Sí(S)/No(N)] <N>:`); return true; }
          if (c.op === 'ordenar') { const i = L.indexOf(pl) + 1; c.step = 'pos'; prompt(`PRESENTACION  «${pl.name}» está en la posición ${i} de ${L.length}. Nueva posición [1–${L.length}/Izquierda(I)/Derecha(D)] <${i}>:`); return true; }
          if (c.op === 'hoja') { c.plancha = pl.name; c.hojaDef = pl.media || `${pl.w} x ${pl.h}`; pedirHoja(c, 'orient'); return true; }
        }
        if (c.step === 'nombre') {
          const n = t || c.def;
          if (c.op === 'nueva') { c.nombre = n; c.hojaDef = act ? (act.media || `${act.w} x ${act.h}`) : 'A3'; c.hojaBase = act ? { w: act.w, h: act.h, nombre: act.media } : null; pedirHoja(c, 'crear'); return true; }
          if (c.op === 'copiar') { const r = S.copiarPlancha(c.pl.name, n); if (resultado(r, (x) => `Plancha «${x.name}» copiada de «${c.pl.name}» (${x.n} objeto(s)).`)) { fin(); irPlancha(r.name); } return true; }
          if (c.op === 'renombrar') { const r = S.renombrarPlancha(c.pl.name, n); if (resultado(r, (x) => `Plancha renombrada: «${c.pl.name}» → «${x.name}».`)) fin(); return true; }
        }
        if (c.step === 'conf') { const y = yesNo(false); if (y === null) { say('Escriba S o N.'); return true; } if (!y) { fin('No se borró nada.'); return true; } const r = S.borrarPlancha(c.pl.name); if (resultado(r, `Plancha «${c.pl.name}» borrada (⌘Z la recupera).`)) fin(); return true; }
        if (c.step === 'pos') {
          const o = !t ? null : /^I/i.test(t) ? { delta: -1 } : /^D/i.test(t) ? { delta: 1 } : /^\d+$/.test(t) ? { pos: +t } : 'x';
          if (o === 'x') { say('Escriba un número, I o D.'); return true; }
          if (!o) { fin(); return true; }
          const r = S.moverPlancha(c.pl.name, o); if (resultado(r, (x) => `«${c.pl.name}» quedó en la posición ${x.pos}.`)) fin(); return true;
        }
        return hojaInput(c, t);
      }
      case 'CONFIGPAG': return hojaInput(c, t);
      case 'VENTANAS': {
        if (c.step === 1 && /^A$/i.test(t)) { const pg = PL(); const m = 10; c.pts = [[pg.frame[0] + m, pg.frame[1] + m], [pg.frame[2] - m, pg.frame[3] - m]]; c.step = 'esc'; c.typed = true; prompt(`VENTANAS  Escala [${listaEscalas()}, 1:N o Ajustar(A)] <1:${vpEscala}>:`); return true; }
        if (c.step === 1 && /^[BD]$/i.test(t)) { c.lock = /^B$/i.test(t); c.step = 'vp'; prompt(`VENTANAS  Haga clic dentro de la ventana a ${c.lock ? 'bloquear' : 'desbloquear'}:`); return true; }
        if (c.step === 'esc') {
          let N = vpEscala;
          if (/^A/i.test(t)) N = null; else if (t) { N = Planchas.parseEscala(t); if (!N) { say('Escriba la escala como 1:500, 500 o 2:1, o A para ajustar.'); return true; } }
          if (N) vpEscala = N;
          const r = S.crearVentana(PL(), c.pts[0], c.pts[1], { escala: N });
          if (resultado(r, (x) => `Ventana creada a ${Planchas.textoEscala(x.escala)}. ESPACIOM (MS) o doble clic adentro = trabajar en el modelo; VESCALA, VBLOQUEAR, VPLAYER, VGIRO la ajustan.`)) fin();
          return true;
        }
        return false;
      }
      case 'ESCALAVENTANA': {
        if (c.step !== 'esc') return false;
        if (!t) { fin(); return true; }
        const N = Planchas.parseEscala(t); if (!N) { say('Escriba la escala como 1:500, 500 o 2:1.'); return true; }
        const r = S.ponerEscalaVentana(PL(), c.vp, N); if (resultado(r, `Escala de la ventana: ${Planchas.textoEscala(N)}.`)) { vpEscala = N; fin(); }
        return true;
      }
      case 'VBLOQUEAR': {
        if (c.step !== 'si') return false;
        const y = yesNo(true); if (y === null) { say('Escriba S o N.'); return true; }
        c.lock = y; c.step = 0; c.typed = false;
        conVentana(c, `Haga clic dentro de la ventana a ${y ? 'bloquear' : 'desbloquear'}`, (vp) => { const r = S.bloquearVentana(vp, y); if (resultado(r, `Ventana ${y ? 'bloqueada: su escala ya no cambia con zoom ni encuadre' : 'desbloqueada'}.`)) fin(); else fin(); });
        return true;
      }
      case 'VPLAYER': {
        if (c.step === 'op') {
          const o = !t ? 'I' : T[0];
          if (o === '?') { c.step = 0; c.typed = false; conVentana(c, null, (vp) => { const d = S.datosVentana(PL(), vp); fin(`Capas inutilizadas en la ventana ${d.id}: ${d.capas.length ? d.capas.join(', ') : '(ninguna)'}.`); }); return true; }
          if (o === 'T') { c.congelar = false; c.capas = ['*']; c.step = 'donde'; prompt('VPLAYER  Ventanas [Actual(A)/Todas(T)] <A>:'); return true; }
          if (o !== 'I' && o !== 'R') { say(`Opción no válida: «${t}».`); return true; }
          c.congelar = o === 'I'; c.step = 'capas';
          prompt(`VPLAYER  Capa(s) a ${c.congelar ? 'inutilizar' : 'reutilizar'} en la ventana (separe con coma; * y ? sirven de comodín) <${S.capaActual()}>:`); return true;
        }
        if (c.step === 'capas') { c.capas = (raw.trim() || S.capaActual()).split(',').map((x) => x.trim()).filter(Boolean); c.step = 'donde'; prompt('VPLAYER  Ventanas [Actual(A)/Todas(T)] <A>:'); return true; }
        if (c.step === 'donde') {
          const aplicar = (vps) => { let n = 0; let err = null; for (const vp of vps) { const r = S.capasVentana(vp, c.capas, c.congelar); if (r.error) err = r.error; else n++; } if (err && !n) say(err); else { afterEdit(); say(`${c.congelar ? 'Inutilizada(s)' : 'Reutilizada(s)'} ${c.capas.join(', ')} en ${n} ventana(s). El resto de las ventanas y el Modelo no cambian.`); } fin(); };
          if (/^T/i.test(t)) { if (!enPlancha()) { say('Vaya a una plancha.'); fin(); return true; } aplicar(S.ventanas(PL())); return true; }
          c.step = 0; c.typed = false; c.text = false; conVentana(c, null, (vp) => aplicar([vp])); return true;
        }
        return false;
      }
      case 'VGIRO': {
        if (c.step !== 'ang') return false;
        if (!t) { fin(); return true; }
        const a = parseFloat(t.replace(',', '.')); if (!Number.isFinite(a)) { say('Escriba el ángulo en grados.'); return true; }
        const r = S.girarVentana(c.vp, a); if (resultado(r, `Vista de la ventana girada a ${a}°.`)) fin();
        return true;
      }
      case 'ZOOM': {
        if (!t) { if (c.step === 1) { zoomOpcion('E'); fin(); return true; } return false; }
        if (/^@?-?[\d.]+\s*,\s*-?[\d.]+$/.test(t)) { const q = parsePoint(t); if (q) { point(q); return true; } } // esquinas escritas (x,y)
        const m = /^([\d.,/]+)\s*XP$/i.exec(t);
        if (m) { const v = m[1].includes('/') ? m[1].split('/').reduce((a, b) => parseFloat(a) / parseFloat(b)) : parseFloat(m[1].replace(',', '.')); // nXP: n mm de papel por unidad
          if (!H.page().ms) { say('nXP sirve dentro de una ventana (ESPACIOM).'); return true; }
          zoomOpcion('XP', S.unidadModeloMM() / (v * (PL().unitMM || 1))); fin(); return true; }
        const o = T[0];
        if (o === 'V') { c.step = 2; prompt('ZOOM  Precise la primera esquina:'); return true; }
        if (['E', 'P', 'T'].includes(o)) { zoomOpcion(o); fin(); return true; }
        if (o === 'A') { zoomOpcion('E'); fin(); return true; }
        say(`Opción no válida: «${t}».`); return true;
      }
      case 'ESCALAANOT': {
        if (c.step !== 'n') return false;
        if (!t) { fin(); return true; }
        if (/^(N|NINGUNA|NO)$/i.test(t)) { S.ponerEscalaAnot(null); afterEdit(); fin('Sin escala de anotación: texto y cotas en el modelo van en unidades del dibujo.'); return true; }
        const N = Planchas.parseEscala(t); if (!N) { say('Escriba la escala como 1:500 o 500.'); return true; }
        const r = S.ponerEscalaAnot(N); if (resultado(r, `Escala de anotación ${Planchas.textoEscala(N)}: en el Modelo, TEXTO pide la altura en mm de papel y las cotas usan el estilo «ANOT 1-${N}».`)) fin();
        return true;
      }
      case 'ROTULO': {
        if (c.step !== 'campo') return false;
        const [tag] = Planchas.CAMPOS[c.k];
        if (raw.trim()) c.vals[tag] = raw.trim();
        c.k++;
        while (c.k < Planchas.CAMPOS.length && !c.tags.has(Planchas.CAMPOS[c.k][0])) c.k++;
        if (c.k < Planchas.CAMPOS.length) { pedirCampo(c); return true; }
        const r = S.llenarRotulo(c.vals, { donde: 'todas', pages: H.doc().pages });
        if (resultado(r, (x) => (x.sinCambio ? 'El rótulo ya tenía esos valores.' : `Rótulo lleno en ${x.planchas} plancha(s): ${x.campos.length} campo(s).`))) fin();
        return true;
      }
    }
    return false;
  }
  function hojaInput(c, t) {
    if (c.step === 'hoja') {
      let h = null;
      if (!t) { const pl = c.plancha ? S.plancha(c.plancha) : null; h = c.hojaBase || (pl ? { w: pl.w, h: pl.h, nombre: pl.media } : Planchas.parseHoja(c.hojaDef || 'A3')); }
      else h = Planchas.parseHoja(t);
      if (!h || !(h.w > 0)) { say(`Hoja no válida: «${t}». Use ${Planchas.NOMBRES_HOJA.join(', ')} o «ancho x alto».`); return true; }
      c.hoja = h; c.step = 'orient'; c.typed = true;
      const vert = c.hojaBase && c.hojaBase.h > c.hojaBase.w;
      prompt(`${c.label}  Orientación [Horizontal(H)/Vertical(V)] <${vert ? 'V' : 'H'}>:`); return true;
    }
    if (c.step === 'orient') {
      const o = !t ? (c.hojaBase && c.hojaBase.h > c.hojaBase.w ? 'V' : 'H') : /^V/i.test(t) ? 'V' : /^H/i.test(t) ? 'H' : null;
      if (!o) { say('Escriba H o V.'); return true; }
      const W = Math.max(c.hoja.w, c.hoja.h), Hh = Math.min(c.hoja.w, c.hoja.h);
      const hoja = { ...c.hoja, w: o === 'V' ? Hh : W, h: o === 'V' ? W : Hh };
      if (c.sig === 'crear') { const r = S.crearPlancha(c.nombre, hoja); if (resultado(r, (x) => `Plancha «${x.name}» creada (${hoja.nombre || ''} ${o === 'V' ? 'vertical' : 'horizontal'}). VENTANAS (MV) agrega ventanas al modelo.`)) { fin(); irPlancha(r.name); } return true; }
      const r = S.configPag(c.plancha, hoja, o);
      if (resultado(r, (x) => `Hoja de «${c.plancha}»: ${x.w} x ${x.h} mm (${o === 'V' ? 'vertical' : 'horizontal'}). Lo dibujado no se movió.`)) fin();
      return true;
    }
    return false;
  }

  // ---- RÓTULO: paleta con todos los campos (o campo por campo en la línea de comandos)
  function abrirRotulo() {
    const v = S.valoresRotulo(enPlancha() ? PL().title : null) || S.valoresRotulo(null);
    if (!v) { say('No encontré un rótulo con atributos en las planchas. El plano nuevo EPM (PLANTILLAEPM) lo trae; en otros planos, cree el bloque del rótulo con ATRDEF (PROYECTO, ESCALA, FECHA…).'); idlePrompt(); return; }
    const box = $('rotulo');
    if (!box) { const c = { name: 'ROTULO', label: 'ROTULO', step: 'campo', k: 0, vals: {}, tags: new Set(v.etiquetas), cur: v.valores, text: true }; while (c.k < Planchas.CAMPOS.length && !c.tags.has(Planchas.CAMPOS[c.k][0])) c.k++; cmd = c; pedirCampo(c); return; }
    const tags = new Set(v.etiquetas);
    const body = $('rBody'); body.innerHTML = '';
    for (const [tag, nom] of Planchas.CAMPOS) {
      if (!tags.has(tag)) continue;
      const row = document.createElement('div'); row.className = 'prow';
      const auto = ['PLANCHA', 'TOTAL', 'ESCALA'].includes(tag);
      row.innerHTML = `<span>${nom}</span>`;
      const inp = document.createElement('input'); inp.dataset.tag = tag; inp.value = v.valores[tag] || ''; inp.spellcheck = false; inp.autocomplete = 'off';
      inp.style.userSelect = 'text'; row.appendChild(inp);
      if (auto) { const b = document.createElement('button'); b.textContent = 'Auto'; b.title = tag === 'ESCALA' ? 'La escala de la ventana de cada plancha («INDICADA» si hay varias)' : 'Se numera solo: plancha X de Y'; b.onclick = () => { inp.value = '='; }; row.appendChild(b); }
      body.appendChild(row);
    }
    $('rInfo').textContent = `Valores de la plancha «${v.plancha}». «=» = automático (plancha X de Y y escala de la ventana).`;
    box.classList.add('show');
    say('ROTULO: llene los campos y pulse «Aplicar». Los campos iguales en todas las planchas se llenan de una vez (⌘Z deshace).');
    idlePrompt();
  }
  function pedirCampo(c) {
    const [tag, nom] = Planchas.CAMPOS[c.k];
    prompt(`ROTULO  ${nom} <${(c.cur[tag] || '').slice(0, 60)}> (Enter = igual; = automático):`);
  }
  function aplicarRotulo() {
    const vals = {}; for (const inp of $('rBody').querySelectorAll('input')) vals[inp.dataset.tag] = inp.value;
    const donde = $('rDonde').value === 'todas' ? 'todas' : PL().title;
    const r = S.llenarRotulo(vals, { donde, pages: H.doc().pages });
    if (r.error) { say(r.error); return; }
    afterEdit();
    say(r.sinCambio ? 'El rótulo ya tenía esos valores.' : `Rótulo lleno en ${r.planchas} plancha(s): ${r.campos.length} campo(s) cambiados.`);
    $('rotulo').classList.remove('show');
  }
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    if ($('rAplicar')) $('rAplicar').onclick = aplicarRotulo;
    if ($('rClose')) $('rClose').onclick = () => $('rotulo').classList.remove('show');
  });

  /** Dibujo en pantalla del H4: esquina de la ventana nueva, ventana de zoom y la ventana activa (ESPACIOM). */
  function h4Overlay(ctx, S2, cur) {
    if (cmd && cursor && ((cmd.name === 'VENTANAS' && cmd.step === 2) || (cmd.name === 'ZOOM' && cmd.step === 3))) {
      const a = S2(cmd.pts[0]);
      ctx.strokeStyle = cmd.name === 'ZOOM' ? '#1e88ff' : '#ff9f0a'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3;
      ctx.strokeRect(Math.min(a[0], cur[0]), Math.min(a[1], cur[1]), Math.abs(cur[0] - a[0]), Math.abs(cur[1] - a[1])); ctx.setLineDash([]);
    }
    if (cmd && cursor && cmd.name === 'ENCUADRE' && cmd.step === 2) { const a = S2(cmd.pts[0]); ctx.strokeStyle = '#ff9f0a'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(cur[0], cur[1]); ctx.stroke(); ctx.setLineDash([]); }
  }

  // ================================================================ H6-B: edición e inspección P2 (web/edicion_p2.js)
  const H6 = () => typeof P2 !== 'undefined';
  const recsHoja = () => topNodes().map((n) => n.rec).filter((r) => !locked(r));
  const uni = () => (H.page() && H.page().units) || '';
  const bbRec = (r) => { if (!r.node) return null; const [o0, o1] = org(); const b = r.node.bb; return [b[0] + o0, b[1] + o1, b[2] + o0, b[3] + o1]; };
  /** Panel de texto a la derecha (LISTA, CANTIDADES): título, renglones y botones [{txt, fn}]. */
  function panelP2(titulo, lineas, botones = []) {
    let el = document.getElementById('p2panel');
    if (!el || !el.dataset || !el.dataset.armado) {
      el = document.createElement('div'); el.id = 'p2panel';
      el.style.cssText = 'position:fixed;top:50px;right:10px;width:460px;max-height:calc(100% - 190px);display:flex;flex-direction:column;background:var(--bar);border:1px solid var(--line);border-radius:8px;z-index:7;box-shadow:0 8px 30px rgba(0,0,0,.45)';
      el.dataset.armado = '1'; document.body.appendChild(el);
    }
    el.innerHTML = '';
    const hd = document.createElement('div'); hd.style.cssText = 'display:flex;gap:6px;align-items:center;padding:8px 8px 6px 10px;font-weight:600';
    const t = document.createElement('div'); t.textContent = titulo; t.style.flex = '1'; hd.appendChild(t);
    for (const b of botones) { const x = document.createElement('button'); x.textContent = b.txt; x.style.cssText = 'height:24px;font-size:12px;padding:0 8px'; x.onclick = b.fn; hd.appendChild(x); }
    const cerrar = document.createElement('button'); cerrar.textContent = '✕'; cerrar.style.cssText = 'height:24px;padding:0 8px'; cerrar.onclick = () => { el.style.display = 'none'; }; hd.appendChild(cerrar);
    const body = document.createElement('pre'); body.style.cssText = 'margin:0;padding:8px 10px;overflow:auto;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;user-select:text;-webkit-user-select:text;border-top:1px solid var(--line)';
    body.textContent = lineas.join('\n');
    el.appendChild(hd); el.appendChild(body); el.style.display = 'flex';
  }
  /** Copia texto al portapapeles del Mac (en la app) o del navegador. */
  function copiarTexto(s) {
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
    if (native) { native.postMessage({ cmd: 'copytext', text: s }); return true; }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s); return true; } } catch (e) { /* sigue */ }
    try { const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
  }
  /** Comandos que piden designar objetos: con objetos ya designados actúan de una vez. */
  function pideSel(name, label, accion, extra = '') {
    if (sel.size) { accion([...sel]); return; }
    cmd = { name, label, selecting: true, accion }; prompt(`${label}  Designe objetos y pulse Enter${extra}:`);
  }
  function pidePick(c, msg) { c.pick = true; c.typed = false; prompt(msg); }
  const fP = (v) => P2.f4(v);

  function h6Start(name) {
    if (!H6()) return false;
    switch (name) {
      case 'ID': cmd = { name, label: 'ID' }; prompt('ID  Precise un punto:'); return true;
      case 'AREA': cmd = { name, label: 'AREA', pts: [], modo: null, total: 0 }; prompt('AREA  Precise el primer punto de esquina o [Objeto(O)/Sumar(S)/Restar(R)] <Objeto>:'); return true;
      case 'LISTA': pideSel(name, 'LISTA', (recs) => { doLista(recs); fin(); }); return true;
      case 'SELECSIMILAR':
        if (sel.size) { const r = P2.similares([...sel], recsHoja()); setSel(r); say(`SELECSIMILAR  ${r.length} objeto(s) designado(s) (mismo tipo y capa${[...sel].some((x) => x.type === 'INSERT') ? ' y bloque' : ''}).`); idlePrompt(); return true; }
        cmd = { name, label: name, pick: true }; prompt('SELECSIMILAR  Designe el objeto modelo:'); return true;
      case 'SELECRAPIDA':
        cmd = { name, label: name, step: 'prop', typed: true, dentro: sel.size ? [...sel] : null };
        prompt(`SELECRAPIDA  Buscar en ${sel.size ? `los ${sel.size} designados` : 'toda la hoja'}. Propiedad [Tipo(T)/Capa(C)/Color(CO)/Bloque(B)/TipoLin(TL)/Estilo(E)/Texto(TX)] <Tipo>:`); return true;
      case 'UNIR': pideSel(name, 'UNIR', (recs) => { const r = S.unir(recs, H.page()); if (resultado(r, (x) => (x.resultado === 'línea' ? `${x.unidos} líneas unidas en una línea.` : `${x.unidos} objetos unidos en ${x.polilineas} polilínea(s).`))) setSel(r.recs); fin(); }); return true;
      case 'PARTIR': case 'PARTIRENPUNTO': cmd = { name, label: name, step: 1, pick: true, enPunto: name === 'PARTIRENPUNTO' }; prompt(`${name}  Designe el objeto${name === 'PARTIR' ? ' (el clic es el primer punto de ruptura)' : ''}:`); return true;
      case 'EDITPOL': {
        const r0 = sel.size === 1 ? [...sel][0] : null;
        cmd = { name, label: name, step: 1, pick: true };
        if (r0) { cmd.pick = false; editpolObjeto(cmd, r0); } else prompt('EDITPOL  Designe la polilínea (o una línea o arco):');
        return true;
      }
      case 'SUPRIMEDUPL': pideSel(name, 'SUPRIMEDUPL', (recs) => { const r = S.suprimirDuplicados(recs); if (resultado(r, (x) => (x.total ? `SUPRIMEDUPL  ${x.borrados} duplicado(s) borrado(s) y ${x.unidas} línea(s) colineal(es) unida(s).` : 'SUPRIMEDUPL  No hay duplicados.'))) setSel([]); fin(); }, ' [Todo(T)]'); return true;
      case 'COBERTURA': cmd = { name, label: name, pts: [], step: 0 }; prompt('COBERTURA  Precise el primer punto o [Polilínea(P)/Texto(T)] <Polilínea>:'); return true;
      case 'TEXTOM': textomPrompt(cmd = { name, label: name, step: 0, typed: false }); return true;
      case 'COPIAPORTA': pideSel(name, 'COPIAPORTA', (recs) => { doCopiar(recs); fin(); }); return true;
      case 'PEGAPORTA': case 'PEGAORIG': {
        const clip = P2.portapapeles.leer(); if (!clip) { say('El portapapeles de Domoplano está vacío: designe objetos y use COPIAPORTA (⌘C) en este u otro plano.'); idlePrompt(); return true; }
        if (name === 'PEGAORIG') { doPegar(clip, null); idlePrompt(); return true; }
        cmd = { name, label: name, clip, base: null }; prompt(`PEGAPORTA  ${clip.n} objeto(s). Precise el punto de inserción:`); return true;
      }
      case 'CANTIDADES': doCantidades(sel.size ? [...sel] : null); return true;
      case 'MAPAOSM':
        if (H.page().edit && H.page().edit.paper && !H.page().ms) { say('MAPAOSM dibuja en el Modelo: cambie a la pestaña «Modelo» (o entre a una ventana con MS).'); idlePrompt(); return true; }
        cmd = { name, label: name, step: 'org', typed: true, text: true }; prompt('MAPAOSM  Latitud,longitud del centro (p. ej. 6.1734,-75.3390) o [Archivo(A)] (.osm o .json de Overpass):'); return true;
      default: return false;
    }
  }

  function doLista(recs) {
    const lineas = []; for (const r of recs.slice(0, 200)) lineas.push(...P2.info(r, { unidades: uni(), S }), '');
    if (recs.length > 200) lineas.push(`… y ${recs.length - 200} objetos más (se listan los primeros 200).`);
    panelP2(`LISTA — ${recs.length} objeto(s)`, lineas, [{ txt: 'Copiar', fn: () => { copiarTexto(lineas.join('\n')); say('Lista copiada.'); } }]);
    for (const l of lineas.slice(0, 40)) if (l) say(l);
  }
  function areaDe(c, a, p) {
    const u = uni();
    if (c.modo) { c.total += c.modo === 'S' ? a : -a; say(`Área = ${P2.txtArea(a, u)}, Perímetro = ${fP(p)}  ·  Área total = ${P2.txtArea(c.total, u)}`); }
    else say(`Área = ${P2.txtArea(a, u)}, Perímetro = ${fP(p)}`);
  }
  function areaPrompt(c) {
    if (c.modo) prompt(`AREA (${c.modo === 'S' ? 'Sumar' : 'Restar'})  Total ${P2.txtArea(c.total, uni())}. Precise el primer punto o [Objeto(O)/Sumar(S)/Restar(R)] <Enter = terminar>:`);
    else prompt('AREA  Precise el primer punto de esquina o [Objeto(O)/Sumar(S)/Restar(R)] <Objeto>:');
  }
  function editpolObjeto(c, r) {
    if (r.type === 'LINE' || r.type === 'ARC') { c.obj = r; c.step = 'conv'; c.typed = true; prompt('EDITPOL  El objeto no es una polilínea. ¿Convertirlo en polilínea? [Sí/No] <Sí>:'); return; }
    if (r.type !== 'LWPOLYLINE') { say('EDITPOL trabaja con polilíneas (LWPOLYLINE), líneas y arcos.'); return; }
    c.obj = r; setSel([r]); editpolOpciones(c);
  }
  function editpolOpciones(c) { c.step = 'op'; c.typed = true; c.pick = false; prompt(`EDITPOL  ${(c.obj.int(70) & 1) ? 'Cerrada' : 'Abierta'}. Opción [${(c.obj.int(70) & 1) ? 'Abrir(A)' : 'Cerrar(C)'}/Unir(U)/Grosor(G)/Invertir(I)/Decurvar(D)] <Enter = terminar>:`); }
  function textomPrompt(c) {
    const N = typeof Planchas !== 'undefined' ? anotN() : null; c.fAnot = N ? S.factorAnot(N) : 1;
    const hh = +(textH * c.fAnot).toPrecision(4);
    prompt(`TEXTOM  Estilo «${S.estiloActual()}» · altura ${hh}${N ? ` (${textH} mm de papel)` : ''} · enganche ${c.att || 'SI'}. Precise la primera esquina o [Altura(A)/Justificar(J)]:`);
  }
  function doCopiar(recs) {
    let bb = null; for (const r of recs) { const b = bbRec(r); if (!b) continue; bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : b.slice(); }
    const r = S.copiarPortapapeles(recs, bb ? [bb[0], bb[1]] : [0, 0], uni());
    if (r.error) { say(r.error); return; }
    say(`COPIAPORTA  ${r.n} objeto(s) copiado(s)${r.bloques ? ` con ${r.bloques} bloque(s)` : ''}${r.rechazados.length ? ` (no se copian todavía: ${r.rechazados.join(', ')})` : ''}. Péguelos con ⌘V (PEGAPORTA) o PEGAORIG en este u otro plano.`);
  }
  function doPegar(clip, at) {
    const r = S.pegarPortapapeles(H.page(), clip, at);
    if (r.error) { say(r.error); return; }
    afterEdit().then(() => setSel(r.recs.filter((x) => !x.deleted)));
    say(`${at ? 'PEGAPORTA' : 'PEGAORIG'}  ${r.n} objeto(s) pegado(s)${r.capas ? `, ${r.capas} capa(s)` : ''}${r.bloques ? `, ${r.bloques} bloque(s)` : ''}${r.tipos ? `, ${r.tipos} tipo(s) de línea` : ''}${r.estilos ? `, ${r.estilos} estilo(s)` : ''} nuevos.`);
    if (clip.unidades && uni() && clip.unidades !== uni()) say(`Aviso: lo copiado venía en ${clip.unidades} y este plano está en ${uni()}. Si hace falta, escálelo con ES.`);
  }
  let ultCant = null;
  /**
   * R2-fix M-11: sin designar, CANTIDADES cuenta solo el MODELO (la obra) y deja por fuera convenciones, marco, rótulo y
   * capas que no se imprimen. o = {capas: 'RED*,POSTES', zona: [x0,y0,x1,y1], todo: true (Modelo + planchas, sin filtro)}.
   */
  function doCantidades(recs, o = {}) {
    const desig = !!recs; const D = H.doc().dxf;
    if (!desig) {
      recs = D.entities.filter((e) => !e.deleted && e.int(67, 0) !== 1);
      if (o.todo) { for (const pg of H.doc().pages.slice(1)) if (pg.ents) recs.push(...pg.ents().filter((e) => !e.deleted)); recs = [...new Set(recs)]; }
    }
    const fl = P2.filtroCantidades(recs, S, o); recs = fl.recs;
    const q = P2.cantidades(recs, S); const u = H.doc().pages[0].units || '';
    const t = P2.cantidadesTabla(q, u); ultCant = t;
    const origen = desig ? `${recs.length} objeto(s) designado(s)` : o.todo ? 'todo el dibujo (Modelo y planchas, sin filtro)' : 'el Modelo (la obra)';
    const filtro = [o.capas ? `capas ${o.capas}` : '', o.zona ? `zona ${P2.f4(o.zona[0])},${P2.f4(o.zona[1])} a ${P2.f4(o.zona[2])},${P2.f4(o.zona[3])}` : ''].filter(Boolean).join(' · ');
    const lineas = [`Origen: ${origen}${filtro ? ' · ' + filtro : ''}`];
    if (fl.fuera.length) lineas.push(`Por fuera (no es obra): ${fl.fuera.map((x) => `${x.capa} (${x.n}, ${x.razon})`).join(', ')}`);
    lineas.push('', 'BLOQUES (cantidad · nombre · capa · atributos)');
    for (const b of q.bloques) lineas.push(`${String(b.n).padStart(5)} · ${b.nombre} · ${b.capa}${b.atributos ? ' · ' + b.atributos : ''}`);
    if (!q.bloques.length) lineas.push('   (ninguno)');
    lineas.push('', `LONGITUDES POR CAPA (${u || 'unidades del dibujo'})`);
    for (const l of q.longitudes) lineas.push(`${P2.f4(l.L).padStart(14)} · ${l.capa} (${l.n} tramo${l.n === 1 ? '' : 's'})`);
    if (!q.longitudes.length) lineas.push('   (ninguna)');
    panelP2('CANTIDADES', lineas, [{ txt: 'Insertar como TABLA en el plano', fn: () => { start('CANTIDADES'); input('T'); } }, { txt: 'Copiar para Excel (TSV)', fn: () => { say(copiarTexto(t.tsv) ? 'Cantidades copiadas: péguelas en Excel.' : 'No se pudo copiar.'); } }]);
    say(`CANTIDADES  ${q.bloques.reduce((s, b) => s + b.n, 0)} bloque(s) en ${q.bloques.length} grupo(s) · longitudes en ${q.longitudes.length} capa(s). ${lineas[0]}.`);
    for (const l of lineas.slice(1)) if (l) say(l);
    cmd = { name: 'CANTIDADES', label: 'CANTIDADES', step: 'op', typed: true, t, o, desig: desig ? recs : null };
    prompt('CANTIDADES  [Tabla(T)/Copiar para Excel(C)/Capas(CA)/Zona(Z)/Todo(TO)/Automático(A)] <Enter = terminar>:');
  }
  async function osmTraer(c) {
    say(`MAPAOSM  Consultando OpenStreetMap (Overpass) en un radio de ${c.radio} m…`);
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; const to = ctl ? setTimeout(() => ctl.abort(), 40000) : 0;
      const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(P2.consultaOverpass(c.lat, c.lon, c.radio)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl ? ctl.signal : undefined });
      clearTimeout(to);
      if (!resp.ok) throw new Error('respuesta ' + resp.status);
      osmDatos(c, await resp.text());
    } catch (e) { say(`MAPAOSM  No se pudo descargar el mapa (${e.message || e}). Sin internet, use la opción Archivo con un .osm o .json guardado.`); cancel(true); }
  }
  function osmDatos(c, texto) {
    let ways; try { ways = P2.leerOSM(texto); } catch (e) { say('MAPAOSM  El archivo no es OSM (XML) ni JSON de Overpass.'); cancel(true); return; }
    const u = S.unidadDibujo(); const f = { 4: 0.001, 5: 0.01, 6: 1 }[u] || 1;
    c.proy = P2.proyectarOSM(ways, c.lat, c.lon, f);
    if (!c.proy.items.length) { say('MAPAOSM  Los datos no traen vías ni construcciones.'); cancel(true); return; }
    if (cmd !== c) cmd = c;
    c.step = 'pt'; c.typed = false; c.text = false;
    prompt(`MAPAOSM  ${c.proy.items.length} elementos (origen ${c.proy.lat0.toFixed(6)}, ${c.proy.lon0.toFixed(6)}). Precise dónde va ese punto en el plano <0,0>:`);
    H.redraw(true);
  }
  function osmCalcar(c, at) {
    const N = typeof Planchas !== 'undefined' ? (anotN() || 500) : 500;
    const r = S.calcarOSM(H.page(), c.proy, at, { alturaTexto: 2.5 * (S.factorAnot ? S.factorAnot(N) : 1) });
    if (resultado(r, (x) => `MAPAOSM  Calco listo: ${x.URB_VIAS} vía(s) en URB_VIAS, ${x.URB_ANDENES} en URB_ANDENES, ${x.URB_PREDIOS} predio(s)/construcción(es) en URB_PREDIOS${x.textos ? `, ${x.textos} nombre(s) de vía` : ''}. Datos © colaboradores de OpenStreetMap (ODbL).`)) fin(); else fin();
  }
  window.domoOSMElegido = (info) => { const c = cmd; if (!c || c.name !== 'MAPAOSM') return; if (!info || info.error) { say(info && info.error ? info.error : 'MAPAOSM  No se eligió archivo.'); cancel(true); return; } c.archivo = info.name; osmDatos(c, info.text); };

  function h6Point(c, p) {
    if (!H6()) return false;
    switch (c.name) {
      case 'ID': say(`X = ${fP(p[0])}   Y = ${fP(p[1])}   Z = ${fP(0)}${uni() ? '   (' + uni() + (H.page().ms ? ', modelo' : '') + ')' : ''}`); fin(); return true;
      case 'AREA':
        if (c.pick) { const r = hit(p[0], p[1]); if (!r) { say('No hay un objeto ahí.'); return true; } const m = P2.medir(r); if (m.error) { say(m.error); return true; } setSel([r]); areaDe(c, m.area, m.perim); if (!c.modo) { fin(); return true; } c.pick = false; areaPrompt(c); return true; }
        c.pts.push(p); c.base = p; prompt(`AREA  Precise el siguiente punto${c.pts.length >= 3 ? ' [Enter = calcular]' : ''}:`); return true;
      case 'SELECSIMILAR': { const r = hit(p[0], p[1]); if (!r) { say('No hay un objeto ahí.'); return true; } const L = P2.similares([r], recsHoja()); setSel(L); say(`SELECSIMILAR  ${L.length} objeto(s) designado(s) como «${r.type}» de la capa «${(r.get(8, '0') || '').trim()}».`); fin(); return true; }
      case 'PARTIR': case 'PARTIRENPUNTO': {
        if (c.step === 1) {
          const r = hit(p[0], p[1]); if (!r) { say('No hay un objeto ahí.'); return true; }
          c.obj = r; setSel([r]); c.pick = false;
          if (c.enPunto) { c.step = 'p'; prompt('PARTIRENPUNTO  Precise el punto de ruptura:'); return true; }
          c.p1 = p; c.base = p; c.step = 2; prompt('PARTIR  Precise el segundo punto de ruptura o [Primer punto (P)] (@ = el mismo punto):'); return true;
        }
        if (c.step === 'p1') { c.p1 = p; c.base = p; c.step = 2; prompt('PARTIR  Precise el segundo punto de ruptura (@ = el mismo punto):'); return true; }
        const r = S.partir(c.obj, c.step === 'p' ? p : c.p1, c.step === 'p' ? null : p, H.page());
        if (resultado(r, (x) => `${c.name}  Objeto partido en ${x.piezas} parte(s).`)) setSel([]); fin(); return true;
      }
      case 'EDITPOL':
        if (c.step === 1) { const r = hit(p[0], p[1]); if (!r) { say('No hay un objeto ahí.'); return true; } c.pick = false; editpolObjeto(c, r); return true; }
        return false;
      case 'COBERTURA':
        if (c.step === 'P') { const r = hit(p[0], p[1]); if (!r || r.type !== 'LWPOLYLINE' || !(r.int(70) & 1)) { say('Designe una polilínea CERRADA.'); return true; } if (Geom.lwVerts(r).some((v) => Math.abs(v[2]) > 1e-12)) { say('La polilínea tiene arcos: la cobertura solo admite tramos rectos (use EDITPOL › Decurvar).'); return true; } c.obj = r; setSel([r]); c.pick = false; c.step = 'borrar'; c.typed = true; prompt('COBERTURA  ¿Borrar la polilínea? [Sí/No] <No>:'); return true; }
        if (c.step === 0) { c.pts.push(p); c.base = p; prompt(`COBERTURA  Precise el siguiente punto${c.pts.length >= 3 ? ' [Enter = crear]' : ''}:`); return true; }
        return false;
      case 'TEXTOM':
        if (c.step === 0) { c.a = p; c.base = p; c.step = 1; prompt('TEXTOM  Precise la esquina opuesta (el ancho de la caja es el de los renglones) o [Altura(A)/Justificar(J)]:'); return true; }
        if (c.step === 1) { c.b = p; c.step = 'txt'; c.typed = true; c.text = true; c.lineas = []; prompt('TEXTOM  Renglón 1 (Enter en un renglón vacío = terminar):'); return true; }
        return false;
      case 'PEGAPORTA': doPegar(c.clip, p); fin(); return true;
      case 'CANTIDADES':
        if (c.step === 'z1') { c.zp = p; c.base = p; c.step = 'z2'; prompt('CANTIDADES  Zona: precise la esquina opuesta:'); return true; }
        if (c.step === 'z2') { doCantidades(c.desig, { ...c.o, todo: false, zona: [c.zp[0], c.zp[1], p[0], p[1]] }); return true; }
        if (c.step === 'pt') {
          const N = typeof Planchas !== 'undefined' ? anotN() : null; const k = N ? S.factorAnot(N) : 1;
          const r = S.crearTabla(H.page(), { at: p, titulo: 'CUADRO DE CANTIDADES', datos: c.t.filas, anchos: [50 * k, 30 * k, 70 * k, 22 * k], alto: 7 * k, h: 2.5 * k, capa: S.capaActual() });
          resultado(r, 'CANTIDADES  Tabla insertada.'); fin(); return true;
        }
        return false;
      case 'MAPAOSM': if (c.step === 'pt') { osmCalcar(c, p); return true; } return false;
      case 'PINZAMIENTO': {
        const r = S.moverPinzamiento(c.rec, c.g, p);
        if (r.error) say(r.error); else if (!r.sinCambio) afterEdit();
        cmd = null; grip = null; idlePrompt(); return true;
      }
      default: return false;
    }
  }

  function h6Enter(c) {
    if (!H6()) return false;
    if (c.selecting && c.accion) {
      if (!sel.size) { say('No hay objetos designados.'); cancel(true); return true; }
      const recs = [...sel]; cmd = null; c.accion(recs); return true;
    }
    switch (c.name) {
      case 'AREA':
        if (c.pts.length >= 3) { const m = P2.areaPuntos(c.pts); areaDe(c, m.area, m.perim); c.pts = []; c.base = null; if (!c.modo) { fin(); return true; } areaPrompt(c); return true; }
        if (c.pts.length) { say('Faltan puntos: el área necesita al menos tres.'); return true; }
        if (c.modo) { say(`Área total = ${P2.txtArea(c.total, uni())}`); fin(); return true; }
        pidePick(c, 'AREA  Designe el objeto (círculo, polilínea, sombreado…):'); return true;
      case 'COBERTURA':
        if (c.step === 0 && c.pts.length >= 3) { const r = S.crearCobertura(H.page(), c.pts); resultado(r, 'COBERTURA  Creada: tapa lo que está dibujado antes que ella.'); fin(); return true; }
        if (c.step === 0 && !c.pts.length) { c.step = 'P'; pidePick(c, 'COBERTURA  Designe una polilínea cerrada:'); return true; }
        if (c.step === 0) { say('La cobertura necesita al menos tres puntos.'); return true; }
        if (c.step === 'borrar') return h6Input(c, 'N', 'N');
        return false;
      case 'TEXTOM': if (c.step === 'txt') return h6Input(c, '', ''); return false;
      case 'MAPAOSM':
        if (c.step === 'pt') { osmCalcar(c, [0, 0]); return true; }
        if (c.step === 'radio') return h6Input(c, '', '');
        if (c.step === 'origen') return h6Input(c, '', '');
        return false;
      case 'EDITPOL': if (c.step === 'conv') return h6Input(c, 'S', 'S'); if (c.step === 'unir') { const r = S.unir([c.obj, ...[...sel].filter((x) => x !== c.obj)], H.page()); if (resultado(r, (x) => `${x.unidos} objetos unidos.`)) { c.obj = r.recs[0]; setSel([c.obj]); } editpolOpciones(c); return true; } return false;
      default: return false;
    }
  }

  function h6Input(c, t, raw) {
    if (!H6()) return false;
    const T = t.toUpperCase();
    if (c.selecting && c.name === 'SUPRIMEDUPL' && /^(T|TODO)$/i.test(t)) { setSel(recsHoja()); return h6Enter(c); }
    switch (c.name) {
      case 'AREA':
        if (!c.pts.length && !c.pick && (T === 'O' || T === 'OBJETO')) { pidePick(c, 'AREA  Designe el objeto (círculo, polilínea, sombreado…):'); return true; }
        if (!c.pts.length && !c.pick && (T === 'S' || T === 'SUMAR' || T === 'R' || T === 'RESTAR')) { c.modo = T[0]; areaPrompt(c); return true; }
        return false;
      case 'SELECRAPIDA':
        if (c.step === 'prop') { c.prop = t || 'T'; c.step = 'val'; c.text = true; prompt(`SELECRAPIDA  Valor de «${c.prop}» (* y ? sirven de comodín; <>valor = distinto; ? = lo que hay):`); return true; }
        if (c.step === 'val') {
          const cands = c.dentro || recsHoja();
          if (t === '?') { say('Hay: ' + P2.valores(cands, c.prop).slice(0, 40).join(' · ')); return true; }
          if (!t) { cancel(true); return true; }
          const r = P2.filtrar(cands, c.prop, raw.trim()); if (r.error) { say(r.error); return true; }
          setSel(r.recs); say(`SELECRAPIDA  ${r.recs.length} objeto(s) designado(s) (${r.prop} ${r.neg ? '≠' : '='} ${r.valor}).`); fin(); return true;
        }
        return false;
      case 'PARTIR':
        if (c.step === 2 && t === '@') { const r = S.partir(c.obj, c.p1, null, H.page()); if (resultado(r, (x) => `PARTIR  Objeto partido en ${x.piezas} parte(s).`)) setSel([]); fin(); return true; }
        if (c.step === 2 && (T === 'P' || T === 'PRIMER')) { c.step = 'p1'; prompt('PARTIR  Precise el primer punto de ruptura:'); return true; }
        return false;
      case 'EDITPOL':
        if (c.step === 'conv') { if (/^n/i.test(t)) { fin(); return true; } const r = S.polConvertir(c.obj, H.page()); if (!resultado(r, 'Convertido en polilínea.')) { fin(); return true; } c.obj = r.rec; editpolOpciones(c); return true; }
        if (c.step === 'g') { const w = parseFloat(t.replace(',', '.')); if (!(w >= 0)) { say('Escriba un grosor (0 o más).'); return true; } resultado(S.polGrosor(c.obj, w), `Grosor ${w}.`); editpolOpciones(c); return true; }
        if (c.step === 'op') {
          if (!t) { fin(); return true; }
          if (T === 'C' || T === 'CERRAR') resultado(S.polCerrar(c.obj, true), 'Polilínea cerrada.');
          else if (T === 'A' || T === 'ABRIR') resultado(S.polCerrar(c.obj, false), 'Polilínea abierta.');
          else if (T === 'I' || T === 'INVERTIR') resultado(S.polInvertir(c.obj), 'Polilínea invertida.');
          else if (T === 'D' || T === 'DECURVAR') resultado(S.polDecurvar(c.obj), 'Arcos convertidos en rectas.');
          else if (T === 'G' || T === 'GROSOR') { c.step = 'g'; prompt(`EDITPOL  Grosor constante <${c.obj.num(43, 0)}>:`); return true; }
          else if (T === 'U' || T === 'UNIR') { c.step = 'unir'; c.typed = false; c.selecting = true; setSel([]); prompt('EDITPOL Unir  Designe las líneas, arcos o polilíneas que tocan los extremos y pulse Enter:'); return true; }
          else { say(`Opción no válida: «${t}».`); return true; }
          editpolOpciones(c); return true;
        }
        return false;
      case 'COBERTURA':
        if (c.step === 0 && !c.pts.length && (T === 'P' || T === 'POLILINEA' || T === 'POLILÍNEA')) { c.step = 'P'; pidePick(c, 'COBERTURA  Designe una polilínea cerrada:'); return true; }
        if (c.step === 0 && !c.pts.length && (T === 'T' || T === 'TEXTO')) {
          cmd = { name: 'COBERTURA', label: 'COBERTURA', selecting: true, accion: (recs) => {
            const tx = recs.filter((r) => ['TEXT', 'MTEXT', 'INSERT'].includes(r.type) && bbRec(r));
            if (!tx.length) { say('No designó textos.'); fin(); return; }
            const res = S.agrupar(`Cobertura de ${tx.length} texto(s)`, () => { for (const r of tx) { const h = r.num(40, 2.5) * (r.type === 'INSERT' ? 0 : 1) || (bbRec(r)[3] - bbRec(r)[1]) * 0.3; const rot = r.type === 'MTEXT' ? (r.get(11) !== undefined ? Math.atan2(r.num(21), r.num(11)) * 180 / Math.PI : r.num(50, 0)) : r.num(50, 0); const x = S.crearCobertura(H.page(), P2.rectTexto(bbRec(r), rot, 0.35 * h), { antesDe: r }); if (x.error) return x; } return { ok: true }; });
            resultado(res, `COBERTURA  ${tx.length} texto(s) con fondo tapado (la cobertura queda debajo de cada texto).`); setSel([]); fin();
          } };
          prompt('COBERTURA  Designe los textos a destacar y pulse Enter:'); return true;
        }
        if (c.step === 'borrar') { const r = S.crearCobertura(H.page(), Geom.lwVerts(c.obj).map((v) => [v[0], v[1]]), { borrar: /^s/i.test(t) ? c.obj : null }); resultado(r, 'COBERTURA  Creada.'); setSel([]); fin(); return true; }
        return false;
      case 'TEXTOM':
        if (c.step === 0 || c.step === 1) {
          if (T === 'A' || T === 'ALTURA') { c.ret = c.step; c.step = 'h'; prompt(`TEXTOM  Altura${c.fAnot !== 1 ? ' en el papel (mm)' : ''} <${textH}>:`); return true; }
          if (T === 'J' || T === 'JUSTIFICAR') { c.ret = c.step; c.step = 'j'; prompt('TEXTOM  Punto de enganche [SI/SC/SD/MI/MC/MD/II/IC/ID] <SI>:'); return true; }
          return false;
        }
        if (c.step === 'h') { const v = parseFloat(t.replace(',', '.')); if (t && !(v > 0)) { say('Escriba una altura mayor que 0.'); return true; } if (v > 0) textH = v; c.step = c.ret; if (c.step === 0) textomPrompt(c); else prompt('TEXTOM  Precise la esquina opuesta:'); return true; }
        if (c.step === 'j') { if (t && !P2.ATT[T]) { say(`Opción no válida: «${t}».`); return true; } c.att = t ? T : 'SI'; c.step = c.ret; if (c.step === 0) textomPrompt(c); else prompt('TEXTOM  Precise la esquina opuesta:'); return true; }
        if (c.step === 'txt') {
          if (raw.length) { c.lineas.push(raw); prompt(`TEXTOM  Renglón ${c.lineas.length + 1} (Enter en un renglón vacío = terminar):`); return true; }
          if (!c.lineas.length) { fin(); return true; }
          const att = P2.ATT[c.att || 'SI'];
          const r = S.crearTextoM(H.page(), { at: P2.puntoCaja(c.a, c.b, att), ancho: Math.abs(c.b[0] - c.a[0]), h: textH * (c.fAnot || 1), att, texto: c.lineas.join('\n') });
          resultado(r, `TEXTOM  Texto de párrafo de ${c.lineas.length} renglón(es) creado.`); fin(); return true;
        }
        return false;
      case 'CANTIDADES':
        if (c.step === 'op') {
          if (!t) { fin(); return true; }
          if (T === 'T' || T === 'TABLA') { c.step = 'pt'; c.typed = false; prompt('CANTIDADES  Precise la esquina superior izquierda de la tabla:'); return true; }
          if (T === 'C' || T === 'COPIAR') { say(copiarTexto(c.t.tsv) ? 'Cantidades copiadas (TSV): péguelas en Excel.' : 'No se pudo copiar.'); return true; }
          if (T === 'CA' || T === 'CAPAS') { c.step = 'capas'; c.text = true; prompt(`CANTIDADES  Capas a contar, separadas por coma (comodín *, ej. RED*,POSTES) <${c.o.capas || 'automático'}>:`); return true; }
          if (T === 'Z' || T === 'ZONA') { c.step = 'z1'; c.typed = false; c.zp = null; prompt('CANTIDADES  Zona: precise la primera esquina:'); return true; }
          if (T === 'TO' || T === 'TODO') { doCantidades(c.desig, { todo: true }); return true; }
          if (T === 'A' || T === 'AUTOMATICO' || T === 'AUTOMÁTICO') { doCantidades(c.desig, {}); return true; }
          say(`Opción no válida: «${t}».`); return true;
        }
        if (c.step === 'capas') { doCantidades(c.desig, { ...c.o, todo: false, capas: raw.trim() || c.o.capas }); return true; }
        return false;
      case 'MAPAOSM': {
        if (c.step === 'org') {
          if (T === 'A' || T === 'ARCHIVO') {
            const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
            if (native) { native.postMessage({ cmd: 'pickosm' }); prompt('MAPAOSM  Elija el archivo .osm o .json…'); c.step = 'espera'; return true; }
            const f = document.createElement('input'); f.type = 'file'; f.accept = '.osm,.json,.xml';
            f.onchange = () => { const x = f.files && f.files[0]; if (!x) return; x.text().then((s) => window.domoOSMElegido({ name: x.name, text: s })); };
            if (f.click) f.click(); c.step = 'espera'; prompt('MAPAOSM  Elija el archivo .osm o .json…'); return true;
          }
          if (/\.(osm|json|xml)$/i.test(raw.trim()) && typeof require === 'function') { // sin app (MCP): ruta del archivo
            try { c.archivo = raw.trim(); osmDatos(c, require('fs').readFileSync(raw.trim(), 'utf8')); } catch (e) { say(`MAPAOSM  No pude leer «${raw.trim()}».`); } return true;
          }
          const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
          if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) { say('Escriba latitud,longitud en grados decimales (p. ej. 6.1734,-75.3390) o A para un archivo.'); return true; }
          c.lat = +m[1]; c.lon = +m[2]; c.step = 'radio'; c.text = false; prompt('MAPAOSM  Radio en metros <250>:'); return true;
        }
        if (c.step === 'radio') { const v = t ? parseFloat(t.replace(',', '.')) : 250; if (!(v > 0 && v <= 3000)) { say('Radio entre 1 y 3000 m.'); return true; } c.radio = v; c.step = 'espera'; osmTraer(c); return true; }
        return false;
      }
      case 'PINZAMIENTO': return false;
      default: return false;
    }
  }

  // ---- pinzamientos (cuadritos azules) con la selección y sin comando activo
  let grip = null;
  const MAXGRIPS = 150;
  function gripsSel() {
    if (!H6() || cmd || !sel.size || sel.size > MAXGRIPS) return [];
    const out = []; for (const r of sel) { if (r.deleted || locked(r)) continue; for (const g of P2.grips(r, S, bbRec(r))) out.push({ rec: r, g }); }
    return out;
  }
  function gripEn(sx, sy) {
    let best = null, bd = 7;
    for (const x of gripsSel()) { const [gx, gy] = localToScreen(x.g.x, x.g.y); const d = Math.max(Math.abs(gx - sx), Math.abs(gy - sy)); if (d <= bd) { bd = d; best = x; } }
    return best;
  }
  function gripOverlay(ctx) {
    if (cmd && cmd.name === 'PINZAMIENTO') {
      const [x, y] = localToScreen(cmd.g.x, cmd.g.y); ctx.fillStyle = '#ff3b30'; ctx.fillRect(x - 4, y - 4, 8, 8);
      if (cursor) { const c2 = localToScreen(cursor[0], cursor[1]); ctx.strokeStyle = '#ff9f0a'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(c2[0], c2[1]); ctx.stroke(); ctx.setLineDash([]); }
      return;
    }
    const G = gripsSel(); if (!G.length) return;
    ctx.lineWidth = 1;
    for (const { g } of G) { const [x, y] = localToScreen(g.x, g.y); ctx.fillStyle = '#1e88ff'; ctx.strokeStyle = '#0b3d7a'; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); }
  }
  function startGrip(x, sx, sy) {
    cmd = { name: 'PINZAMIENTO', label: '** ESTIRAR **', rec: x.rec, g: x.g, base: [x.g.x, x.g.y], downAt: [sx, sy] };
    grip = x;
    const que = { v: 'el vértice', m: 'el tramo', c: 'el centro', q: 'el radio', mv: 'el objeto', a0: 'el extremo', a1: 'el extremo', am: 'el arco', d: 'el punto de la cota', lv: 'el vértice' }[x.g.k] || 'el punto';
    prompt(`** ESTIRAR **  Arrastre o haga clic en el punto nuevo para ${que} (o escriba x,y · @dx,dy) [Esc = cancelar]:`);
  }

  // ---------------------------------------------------------------- eventos (los llama el visor)
  function onDown(sx, sy, e) {
    if (!enabled() || e.button !== 0) return false;
    onMove(sx, sy); // el punto es donde se hizo clic (con enganche/orto si aplica)
    const [lx, ly] = cursor;
    const selecting = cmd && ((SELECTS.has(cmd.name) && cmd.step === 0) || cmd.selecting);
    const typingOnly = cmd && ((cmd.name === 'TEXTO' && cmd.step > 0) || TYPED.has(cmd.name) || cmd.typed || (cmd.name === 'CAMBIAPROP' && cmd.step > 0) || (cmd.name === 'EDITATEXTO' && cmd.edit) || (cmd.name === 'DESFASE' && cmd.step === 0) ||
      (cmd.name === 'INSERTAR' && cmd.step !== 1) || (cmd.name === 'IMAGEN' && !(cmd.step >= 1)));
    if (cmd && !selecting && !typingOnly) { point([lx, ly]); return true; }
    if (cmd && typingOnly) return true;
    if (cmd && cmd.name === 'ESTIRA') { box = { sx, sy, ex: sx, ey: sy, add: false }; return true; }
    if (!cmd && !e.shiftKey) { const gx = gripEn(sx, sy); if (gx) { startGrip(gx, sx, sy); onMove(sx, sy); H.redraw(true); return true; } } // pinzamiento
    // selección: clic sobre objeto o inicio de ventana
    const r = hit(lx, ly);
    if (r) { if (e.shiftKey && sel.has(r)) { sel.delete(r); r.node.sel = false; H.redraw(true); } else setSel([r], e.shiftKey || !!cmd); return true; }
    box = { sx, sy, ex: sx, ey: sy, add: e.shiftKey || !!cmd };
    return true;
  }
  function onMove(sx, sy) {
    if (!enabled()) return;
    let [lx, ly] = screenToLocal(sx, sy);
    const hadSnap = !!snap;
    const noSnap = !cmd || PICKS.has(cmd.name) || cmd.pick || cmd.selecting || (cmd.name === 'DESFASE' && cmd.step === 1) || (SELECTS.has(cmd.name) && cmd.step === 0);
    snap = noSnap ? null : findSnap(lx, ly);
    if (snap) { lx = snap.x; ly = snap.y; } else if (cmd) [lx, ly] = applyOrtho(lx, ly);
    cursor = [lx, ly];
    if (box) { box.ex = sx; box.ey = sy; }
    if (cmd || box || snap || hadSnap) H.redraw(false);
  }
  function onUp(sx, sy) {
    if (cmd && cmd.name === 'PINZAMIENTO' && cmd.downAt) { // arrastre del pinzamiento: se suelta en el punto nuevo
      const moved = Math.hypot(sx - cmd.downAt[0], sy - cmd.downAt[1]) > 4; cmd.downAt = null;
      if (moved && cursor) point(cursor.slice());
      return true;
    }
    if (!box) return false;
    const b = box; box = null;
    if (Math.hypot(b.ex - b.sx, b.ey - b.sy) < 4) { if (!b.add) setSel([]); return true; }
    const [ax, ay] = screenToLocal(Math.min(b.sx, b.ex), Math.max(b.sy, b.ey));
    const [bx, by] = screenToLocal(Math.max(b.sx, b.ex), Math.min(b.sy, b.ey));
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const crossing = b.ex < b.sx || (cmd && cmd.name === 'ESTIRA'); // derecha→izquierda = captura (toca); izquierda→derecha = ventana (dentro)
    if (cmd && cmd.name === 'ESTIRA') cmd.win = [x0, y0, x1, y1];
    const [o0, o1] = org();
    const picked = topNodes().filter((n) => {
      const q = [n.bb[0] + o0, n.bb[1] + o1, n.bb[2] + o0, n.bb[3] + o1];
      return crossing ? !(q[2] < x0 || q[0] > x1 || q[3] < y0 || q[1] > y1) : (q[0] >= x0 && q[2] <= x1 && q[1] >= y0 && q[3] <= y1);
    }).map((n) => n.rec).filter((r) => !locked(r));
    setSel(picked, b.add);
    if (cmd) prompt(`${cmd.label}  ${sel.size} objeto(s). Siga designando o pulse Enter:`);
    return true;
  }

  function onKey(e) {
    if (!enabled()) return false;
    const inp = $('cInput');
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); start('DESHACER'); return true; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); start('REHACER'); return true; }
      if (k === 's') { e.preventDefault(); save(); return true; }
      if (k === '1') { e.preventDefault(); toggleProps(); return true; } // como Ctrl+1 de AutoCAD
      if (k === 'c' && !e.shiftKey && !cmd && sel.size && !inp.value && H6()) { e.preventDefault(); start('COPIAPORTA'); return true; } // H6-B ⌘C
      if (k === 'v' && !cmd && !inp.value && H6() && P2.portapapeles.leer()) { e.preventDefault(); start(e.shiftKey ? 'PEGAORIG' : 'PEGAPORTA'); return true; } // ⌘V (⇧⌘V = mismas coordenadas)
      return false;
    }
    if (e.key === 'F3') { e.preventDefault(); snapOn = !snapOn; say(`Referencia a objetos ${snapOn ? 'activada' : 'desactivada'}.`); return true; }
    if (e.key === 'F8') { e.preventDefault(); orthoOn = !orthoOn; say(`Orto ${orthoOn ? 'activado' : 'desactivado'}.`); updateToggles(); return true; }
    if (e.key === 'Escape') { if (inp.value) inp.value = ''; else if (cmd) cancel(); else setSel([]); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inp.value && sel.size && !cmd) { e.preventDefault(); doErase(); return true; }
    if (e.key === 'Enter' || (e.key === ' ' && !(cmd && cmd.text))) { // en nombres y textos, el espacio es espacio
      e.preventDefault(); const v = inp.value; inp.value = ''; input(v); return true;
    }
    // cualquier tecla imprimible va a la línea de comandos (como en AutoCAD)
    if (e.key.length === 1 && document.activeElement !== inp) { inp.focus(); return false; }
    return false;
  }
  function updateToggles() { const o = $('cOrtho'); if (o) o.classList.toggle('on', orthoOn); const s = $('cSnap'); if (s) s.classList.toggle('on', snapOn); }

  // ---------------------------------------------------------------- dibujo de ayudas (pantalla)
  /** Dibuja nodos (coordenadas locales) transformados por la matriz m, como vista previa semitransparente. */
  function ghost(ctx, dpr, nodes, m) {
    if (!nodes.length) return;
    const o = localToScreen(0, 0), ex = localToScreen(1, 0), ey = localToScreen(0, 1);
    const V = [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]]; // local → pantalla (px CSS)
    ctx.save();
    ctx.setTransform(dpr * V[0], dpr * V[1], dpr * V[2], dpr * V[3], dpr * V[4], dpr * V[5]);
    ctx.globalAlpha = 0.75;
    const g = { k: 'g', m, local: true, sel: true, ch: nodes, bb: [-1e15, -1e15, 1e15, 1e15] };
    Scene.render(ctx, g, [-1e15, -1e15, 1e15, 1e15], dpr * Math.hypot(V[0], V[1]));
    ctx.restore();
  }

  function drawOverlay(ctx, dpr) {
    if (!enabled()) return;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // ventana de selección
    if (box) {
      const crossing = box.ex < box.sx;
      ctx.fillStyle = crossing ? 'rgba(46,160,67,0.12)' : 'rgba(30,136,255,0.12)';
      ctx.strokeStyle = crossing ? '#2ea043' : '#1e88ff'; ctx.lineWidth = 1; ctx.setLineDash(crossing ? [5, 4] : []);
      const x = Math.min(box.sx, box.ex), y = Math.min(box.sy, box.ey), w = Math.abs(box.ex - box.sx), h = Math.abs(box.ey - box.sy);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    }
    // vista previa del comando
    if (cmd && cursor) {
      ctx.strokeStyle = '#ff9f0a'; ctx.lineWidth = 1.3; ctx.setLineDash([]);
      const S2 = (p) => localToScreen(p[0], p[1]);
      const cur = S2(cursor);
      const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
      if ((cmd.name === 'LINEA' || cmd.name === 'POLILINEA' || cmd.name === 'DIST') && cmd.pts.length) {
        const pts = cmd.name === 'LINEA' ? [cmd.pts[cmd.pts.length - 1]] : cmd.pts;
        let prev = null; for (const p of pts) { const s = S2(p); if (prev) line(prev, s); prev = s; }
        line(prev, cur);
      } else if (cmd.name === 'RECTANG' && cmd.step === 1) {
        const a = S2(cmd.a); ctx.strokeRect(Math.min(a[0], cur[0]), Math.min(a[1], cur[1]), Math.abs(cur[0] - a[0]), Math.abs(cur[1] - a[1]));
      } else if (cmd.name === 'ARCO' && cmd.pts.length) {
        let prev = null; for (const p of cmd.pts) { const s2 = S2(p); if (prev) line(prev, s2); prev = s2; } line(prev, cur);
      } else if (cmd.name === 'CIRCULO' && cmd.step === 1) {
        const c = S2(cmd.center); const r = Math.hypot(cur[0] - c[0], cur[1] - c[1]);
        ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke(); line(c, cur);
      } else if (['DESPLAZA', 'COPIA', 'GIRA', 'ESCALA', 'ESTIRA'].includes(cmd.name) && cmd.step === 2) {
        const b = S2(cmd.base); ctx.setLineDash([6, 4]); line(b, cur); ctx.setLineDash([]);
        const dx = cursor[0] - cmd.base[0], dy = cursor[1] - cmd.base[1];
        let T;
        if (cmd.name === 'GIRA') T = Edit.similarity({ base: cmd.base, deg: Math.atan2(dy, dx) * 180 / Math.PI });
        else if (cmd.name === 'ESCALA') T = Edit.similarity({ base: cmd.base, s: Math.max(1e-9, Math.hypot(dx, dy)) });
        else T = Edit.similarity({ dx, dy });
        if (cmd.name === 'GIRA') { ctx.font = '11px -apple-system, sans-serif'; ctx.fillStyle = '#ff9f0a'; ctx.fillText(`${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}°`, cur[0] + 12, cur[1] + 16); }
        if (cmd.name === 'ESCALA') { ctx.font = '11px -apple-system, sans-serif'; ctx.fillStyle = '#ff9f0a'; ctx.fillText(`×${Math.hypot(dx, dy).toPrecision(4)}`, cur[0] + 12, cur[1] + 16); }
        if (cmd.name !== 'ESTIRA') ghost(ctx, dpr, [...sel].map((r) => r.node).filter(Boolean), Scene.mul(T.m, [1, 0, 0, 1, ...org()]));
      } else if (cmd.name === 'IMAGEN' && cmd.img && cmd.step >= 1) {
        imagenPreview(ctx, dpr);
      } else if (cmd.name === 'REDEPM' && cmd.pts.length) {
        let prev = null; for (const p of cmd.pts) { const s = S2(p); if (prev) line(prev, s); prev = s; } line(prev, cur);
      } else if (h3Overlay.covers(cmd.name)) {
        h3Overlay(ctx, dpr, S2, cur, line);
      } else if (cmd.name === 'INSERTAR' && cmd.block && cmd.step >= 1) {
        const at = cmd.step === 1 ? cursor : cmd.at;
        ghost(ctx, dpr, [cmd.block.node], insertMatrix(at, insScale, insRot, cmd.block.base));
      }
    }
    h4Overlay(ctx, (p) => localToScreen(p[0], p[1]), cursor ? localToScreen(cursor[0], cursor[1]) : null);
    if (H6()) gripOverlay(ctx);
    verifOverlay(ctx);
    if (typeof H6E !== 'undefined') H6E.overlay(ctx, localToScreen, H.page()); // H6-E: COMPARAR (colores) y CHECKEPM (dónde)
    // marcador de enganche
    if (snap && cmd) {
      const [x, y] = localToScreen(snap.x, snap.y);
      ctx.strokeStyle = '#2ea043'; ctx.lineWidth = 2; ctx.beginPath();
      if (snap.kind === 'end') ctx.rect(x - 6, y - 6, 12, 12);
      else if (snap.kind === 'mid') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6); ctx.closePath(); }
      else if (snap.kind === 'cen') ctx.arc(x, y, 7, 0, Math.PI * 2);
      else if (snap.kind === 'quad') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); }
      else if (snap.kind === 'int') { ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.rect(x - 7, y - 7, 14, 14); }
      else if (snap.kind === 'per') { ctx.moveTo(x - 7, y + 6); ctx.lineTo(x + 7, y + 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y - 7); ctx.moveTo(x - 7, y + 6); ctx.lineTo(x - 7, y - 1); ctx.lineTo(x, y - 1); }
      else if (snap.kind === 'tan') { ctx.arc(x, y + 2, 5, 0, Math.PI * 2); ctx.moveTo(x - 7, y - 4); ctx.lineTo(x + 7, y - 4); }
      else { ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); }
      ctx.stroke();
      const names = { end: 'Punto final', mid: 'Punto medio', cen: 'Centro', quad: 'Cuadrante', ins: 'Inserción', int: 'Intersección', per: 'Perpendicular', tan: 'Tangente' };
      ctx.font = '11px -apple-system, sans-serif'; ctx.fillStyle = '#2ea043'; ctx.fillText(names[snap.kind] || '', x + 10, y - 10);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- conexión con el visor
  function attach(host) { H = host; armarPanelRef(); }
  function docOpened() {
    S = null; sel.clear(); cmd = null; box = null; savedTop = null; paletteDoc = null; lmSel = null; verif = null; ['blocks', 'lman', 'props', 'verif', 'simbs', 'rotulo'].forEach((id) => $(id) && $(id).classList.remove('show'));
    if (typeof H6E !== 'undefined' && typeof document !== 'undefined' && document.getElementById('h6epanel')) H6E.limpiar();
    const doc = H.doc();
    if (doc && doc.dxf) {
      S = new Edit.Session(doc);
      refreshLayerUI();
      $('cmdbar').style.display = '';
      hist.length = 0;
      if (doc.esEPM) say('Plano nuevo desde la plantilla EPM propia (rótulo, sello, convenciones, ventanas 1:500 y 1:1000; el modelo va en metros). Los campos del rótulo se llenan todos de una vez con ROTULO (o uno a uno con ED). Ventanas: MV · escala: VESCALA · trabajar dentro: MS / doble clic. Símbolos: EPM · redes: REDEPM · revisar textos: VERIFICAR.');
      else if (doc.esNuevo) say('Plano nuevo en milímetros con la «Plancha 1». Capas: CA · tipos de línea: TL · estilo de texto: ST · propiedades: PR (⌘1) · ⌘S guarda (pide nombre).');
      say(`DXF listo para editar. Dibujar: L línea · PL polilínea · C círculo · T texto · I insertar bloque · EPM símbolos EPM · REDEPM · SB sombrear · COTALIN/COTARADIO cotas · TABLA. Modificar: M mover · CO copiar · RO girar · ES escala · S estirar · TR recortar · EX alargar · O desfase · E borrar · H deshacer · ⌘S guardar. Documento: NUEVO · CA capas · PR propiedades · MA igualar · ED editar texto (o doble clic) · ST estilo · TL tipo de línea · REVISION · LIMPIA.`);
    } else $('cmdbar').style.display = 'none';
    idlePrompt(); updateToggles(); markDirty();
  }
  function pageChanged() { sel.clear(); cmd = null; box = null; idlePrompt(); renderProps(); if ($('rotulo')) $('rotulo').classList.remove('show'); }

  return { attach, docOpened, save, pageChanged, onDown, onMove, onUp, onKey, onDblClick, drawOverlay, input, start, saved, setLayer, toggleLayers, toggleProps, say, exportPdf, imagenElegida,
    comandos: () => [...new Set(Object.values(ALIAS))].sort(), alias: (a) => ALIAS[String(a).toUpperCase()] || null,
    get session() { return S; }, get selection() { return sel; },
    // F4 (MCP «domoplano»): la hoja activa, el mensaje que espera la línea de comandos y refrescar tras editar por código
    get host() { return H; }, get comando() { return cmd ? cmd.name : null; }, get indicacion() { return ($('cPrompt') && $('cPrompt').textContent) || ''; },
    set oyente(f) { oyente = f; }, refrescar: () => afterEdit(), cancelar: () => { cancel(true); idlePrompt(); }, seleccionar: (recs) => setSel(recs), marcarGuardado: () => { savedTop = topOp(); markDirty(); }, toggleOrtho() { orthoOn = !orthoOn; updateToggles(); }, toggleSnap() { snapOn = !snapOn; updateToggles(); }, refent: (t) => ponerModos(t), get modosRef() { return [...snapModos]; }, _findSnap: (x, y) => findSnap(x, y),
    enabled };
})();
if (typeof module !== 'undefined') module.exports = CAD; else self.CAD = CAD;
