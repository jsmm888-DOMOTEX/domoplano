// Interfaz del visor: carga, zoom/desplazamiento, hojas, capas, fondo y medición.
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const stage = $('stage');
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;

  let doc = null, pageIdx = 0, page = null, root = null;
  const cache = new Map();
  let zoom = 1, ox = 0, oy = 0;           // pantalla = página * zoom + (ox, oy)   [px CSS]
  let dpr = window.devicePixelRatio || 1;
  let bgMode = 'paper';                   // paper | white | black
  let measuring = false, mPts = [], mHover = null;
  let lastRenderMs = 0, snap = null, idleTimer = null, raf = 0;
  let loadSeq = 0;
  let currentURL = null; // para resolver archivos vecinos (imágenes de un DXF)
  let markups = [], selMark = null, hoverMark = null, marksAutoOpened = false; // marcas de revisión de EPM

  // ---------- Carga ----------
  function overlay(kind, big, small, withButton) {
    const o = $('overlay');
    o.className = kind === 'hide' ? 'hide' : kind === 'err' ? 'err' : '';
    o.innerHTML = '';
    if (kind === 'hide') return;
    if (kind === 'load') { const s = document.createElement('div'); s.className = 'spinner'; o.appendChild(s); }
    const b = document.createElement('div'); b.className = 'big'; b.textContent = big; o.appendChild(b);
    if (small) { const s = document.createElement('div'); s.className = 'small'; s.textContent = small; o.appendChild(s); }
    if (withButton) { const btn = document.createElement('button'); btn.textContent = 'Abrir archivo…'; btn.onclick = openDialog; o.appendChild(btn); }
  }

  async function loadBytes(u8, name) {
    const seq = ++loadSeq;
    $('fname').textContent = name || 'Domoplano'; $('fname').dataset.name = name || 'Domoplano';
    document.title = name || 'Domoplano';
    overlay('load', 'Abriendo ' + (name || 'archivo') + '…');
    doc = null; root = null; cache.clear(); Scene.hidden.clear(); mPts = [];
    CAD.docOpened(); setEditing(false); dirty = false;
    draw();
    try {
      const head = new TextDecoder('latin1').decode(u8.subarray(0, 12));
      const head200 = new TextDecoder('latin1').decode(u8.subarray(0, 400));
      let d;
      if (/\.dxf$/i.test(name || '') || /^\s*0\s*\r?\n\s*SECTION/.test(head200) || head200.startsWith('AutoCAD Binary DXF')) {
        const base = currentURL;
        const overrides = new Map(); // imágenes recién insertadas (IMAGEN): ruta del DXF → URL ya conocida
        const resolveURL = (f) => {
          if (overrides.has(String(f))) return overrides.get(String(f));
          const file = String(f).split(/[\\/]/).pop(); // rutas de otros computadores → mismo nombre junto al DXF
          // ruta relativa (imagenes/firma.png, ..\Firmas\firma.png): la app la busca desde la carpeta del DXF y, si no está, junto al DXF
          const rel = String(f).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
          const esRel = rel && !/^([a-zA-Z]:|\/)/.test(rel) && rel.includes('/');
          if (!base) return file;
          if (base.includes('/__file/')) return base.replace(/\/__file\/([^/?#]+).*$/, (_, t) => `/__near/${t}/${encodeURIComponent(esRel ? rel : file)}`);
          return new URL(encodeURIComponent(file), new URL(base, location.href)).href;
        };
        d = await DXF.open(u8, { resolveURL });
        d.resolveURL = resolveURL;
        d.urlOverrides = overrides;
        if (nuevoPendiente === 'epm') { d.esNuevo = true; d.esEPM = true; nuevoPendiente = false; } // plantilla EPM: se empieza en la plancha
        else if (nuevoPendiente) { d.esNuevo = true; d.startPage = 0; nuevoPendiente = false; } // plano nuevo: se empieza en el Modelo, como AutoCAD // el escritor DWF vuelve a buscar las imágenes (firma) junto al DXF
      } else if (/^\(DWF V/.test(head)) {
        d = await DWF.open(u8);
      } else {
        const zip = Zip.open(u8);
        if (zip.has('FixedDocumentSequence.fdseq') || zip.has('_rels/.rels')) d = await DWFX.open(zip);
        else if (zip.has('manifest.xml')) d = await DWF.open(u8);
        else throw new Error('El archivo no parece ser DWF ni DWFx.');
      }
      if (seq !== loadSeq) return;
      if (!d.pages.length) throw new Error('El archivo no tiene hojas 2D para mostrar.');
      doc = d;
      { const h = d.dxf && d.dxf.header && d.dxf.header.$LWDISPLAY; setLw(d.dxf ? !!(h && parseInt(h[290], 10)) : true, true); }
      fillSheets();
      await showPage(d.startPage || 0);
      CAD.docOpened(); setEditing(!!d.dxf);
    } catch (e) {
      if (seq !== loadSeq) return;
      console.error(e);
      overlay('err', 'No se pudo abrir el archivo', String(e && e.message || e), true);
    }
  }

  async function loadURL(url, name) {
    overlay('load', 'Abriendo ' + (name || '') + '…');
    try {
      currentURL = url;
      const r = await fetch(url);
      if (!r.ok) throw new Error('No se pudo leer el archivo (' + r.status + ').');
      await loadBytes(new Uint8Array(await r.arrayBuffer()), name);
    } catch (e) {
      overlay('err', 'No se pudo abrir el archivo', String(e && e.message || e), true);
    }
  }
  window.visorOpenURL = loadURL;
  window.visorOpenBytes = loadBytes;

  // ---------- NUEVO: plano en blanco (mm, una plancha). En la app, si esta ventana ya tiene un plano, se abre otra ventana.
  let nuevoPendiente = false;
  window.domoNuevoAqui = async () => {
    currentURL = null; nuevoPendiente = true;
    await loadBytes(new TextEncoder().encode(Documento.nuevo()), 'Plano nuevo.dxf');
  };
  // ---------- PLANTILLAEPM: plano nuevo desde la plantilla EPM propia (web/plantilla_epm.js)
  window.domoNuevoEPMAqui = async (hoja = '1000x707') => {
    if (typeof PlantillaEPM === 'undefined') return;
    currentURL = null; nuevoPendiente = 'epm';
    await loadBytes(new TextEncoder().encode(PlantillaEPM.generar({ hoja })), `Plano EPM ${hoja}.dxf`);
  };
  window.domoNuevoEPM = (hoja = '1000x707') => {
    if (native) { native.postMessage({ cmd: 'newepm', hoja }); return; }
    if (dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos y empezar un plano EPM nuevo?')) return;
    window.domoNuevoEPMAqui(hoja);
  };
  window.domoNuevo = () => {
    if (native) { native.postMessage({ cmd: 'new' }); return; }
    if (dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos y empezar un plano nuevo?')) return;
    window.domoNuevoAqui();
  };

  /** Lista de hojas (selector de arriba y pestañas de abajo, como las de AutoCAD). */
  function fillSheets() {
    const sel = $('sheet'); sel.innerHTML = '';
    doc.pages.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1}. ${p.title}`; sel.appendChild(o); });
    sel.style.display = doc.pages.length > 1 ? '' : 'none';
    renderTabs();
  }
  function renderTabs() {
    const bar = $('tabs'); if (!bar) return;
    bar.innerHTML = '';
    const conTabs = !!(doc && (doc.dxf || doc.pages.length > 1));
    document.body.classList.toggle('hastabs', conTabs); resize();
    if (!conTabs) return;
    doc.pages.forEach((p, i) => {
      const b = document.createElement('button'); b.className = 'tab' + (i === pageIdx ? ' on' : '') + (p.vacia && p.vacia() ? ' vacia' : '');
      b.textContent = p.title; b.title = i === 0 ? 'Espacio modelo' : `${p.title}${p.layout && p.layout.media ? ' · ' + p.layout.media : ''} — doble clic: renombrar · clic derecho: más opciones`;
      b.onclick = () => { if (i !== pageIdx) showPage(i); };
      if (i > 0 && doc.dxf) {
        b.ondblclick = () => tabAccion('R', p.title);
        b.oncontextmenu = (e) => { e.preventDefault(); tabMenu(e, p.title, i); };
      }
      bar.appendChild(b);
    });
    if (doc.dxf) { const n = document.createElement('button'); n.className = 'tab mas'; n.textContent = '+'; n.title = 'Plancha nueva (PRESENTACION Nueva)'; n.onclick = () => tabAccion('N'); bar.appendChild(n); }
  }
  /** Acción de una pestaña: arranca PRESENTACION con la opción ya elegida (como el menú de pestañas de AutoCAD). */
  function tabAccion(op, nombre) {
    if (!CAD.enabled()) return;
    tabMenuClose();
    CAD.start('PRESENTACION'); CAD.input(op);
    if (nombre && op !== 'N') CAD.input(nombre);
    $('cInput').focus();
  }
  function tabMenuClose() { const m = $('tabmenu'); if (m) m.classList.remove('show'); }
  function tabMenu(e, nombre, i) {
    const m = $('tabmenu'); if (!m) return;
    m.innerHTML = '';
    const it = (txt, fn) => { const b = document.createElement('div'); b.className = 'tmi'; b.textContent = txt; b.onclick = () => { tabMenuClose(); fn(); }; m.appendChild(b); };
    it('Plancha nueva…', () => tabAccion('N'));
    it('Copiar…', () => tabAccion('C', nombre));
    it('Renombrar…', () => tabAccion('R', nombre));
    it('Borrar…', () => tabAccion('B', nombre));
    it('Mover a la izquierda', () => { CAD.start('PRESENTACION'); CAD.input('O'); CAD.input(nombre); CAD.input('I'); });
    it('Mover a la derecha', () => { CAD.start('PRESENTACION'); CAD.input('O'); CAD.input(nombre); CAD.input('D'); });
    it('Tamaño de hoja…', () => { if (i !== pageIdx) showPage(i).then(() => CAD.start('CONFIGPAG')); else CAD.start('CONFIGPAG'); });
    it('Rótulo (llenar campos)…', () => CAD.start('ROTULO'));
    m.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'; m.style.top = Math.max(10, e.clientY - 8 - 8 * 26) + 'px';
    m.classList.add('show');
  }
  window.addEventListener('mousedown', (e) => { if (!e.target.closest || !e.target.closest('#tabmenu')) tabMenuClose(); });

  async function showPage(i) {
    if (!doc) return;
    pageIdx = i; $('sheet').value = String(i);
    page = doc.pages[i]; ms = null; views.length = 0;
    for (const [k, b] of [...($('tabs') ? $('tabs').children : [])].entries()) b.classList.toggle('on', k === i);
    root = null; mPts = []; Scene.hidden.clear(); markups = []; selMark = null; hoverMark = null; $('tip').style.display = 'none';
    CAD.pageChanged();
    if (page.unsupported) { overlay('err', page.title, page.unsupported); draw(); return; }
    overlay('load', 'Dibujando ' + page.title + '…');
    try {
      if (!cache.has(i)) cache.set(i, await page.build());
      root = cache.get(i);
      if (!page.width || !page.height) { page.width = root.bb[2]; page.height = root.bb[3]; }
      overlay('hide');
      buildLayers();
      setupMarks();
      fit();
      statusInfo();
      $('sPaper').textContent = paperLabel();
    } catch (e) {
      console.error(e);
      overlay('err', 'No se pudo dibujar la hoja', String(e && e.message || e));
    }
  }

  /** Barra de abajo: tipo de archivo, objetos de la hoja, observaciones y avisos (H6-A M-1: también tras cada edición). */
  function statusInfo() {
    if (!root || !doc) return;
    const st = root.stats || {};
    const nObs = markups.filter((m) => m.num).length;
    // objetos de la hoja: los que se ven y se pueden designar (el contador del lector suma todas las veces que se arma)
    const top = page && page.editNode && page.editNode.ch ? page.editNode.ch.filter((n) => n.rec && !n.rec.deleted).length : null;
    $('sInfo').textContent = `${doc.kind} · ${top ?? st.paths ?? st.items ?? 0} objetos` + (markups.length ? ` · ${nObs} observaciones de EPM` : '') + ((st.warnings || []).length ? ` · ${(st.warnings).length} avisos` : '');
    $('sInfo').title = (st.warnings || []).join('\n');
  }

  /** Después de una edición: rearma la hoja actual (y olvida las demás) sin mover la vista. */
  async function rebuild() {
    if (!doc || !page) return;
    cache.clear();
    if (doc.pagesDirty && doc.refreshPages) { // se crearon, borraron, renombraron u ordenaron planchas (o se deshizo)
      const L = page.layout && page.layout.rec, t = page.title;
      doc.refreshPages();
      let i = page === doc.pages[0] ? 0 : doc.pages.findIndex((p) => L && p.layout && p.layout.rec === L);
      if (i < 0) i = doc.pages.findIndex((p) => p.title === t);
      if (i < 0) i = Math.min(pageIdx, doc.pages.length - 1);
      const keep = doc.pages[i] === page ? null : { zoom, ox, oy, frame: page.frame && page.frame.join() };
      fillSheets();
      if (doc.pages[i] !== page) {
        await showPage(i);
        if (keep && page.frame && keep.frame === page.frame.join()) { zoom = keep.zoom; ox = keep.ox; oy = keep.oy; draw(true); } // misma hoja: no se mueve la vista
        return;
      }
    }
    const seq = loadSeq;
    const m0 = page.rootM ? page.rootM.slice() : null;
    const r = await page.build();
    if (seq !== loadSeq || page !== doc.pages[pageIdx]) return;
    // si el marco del Modelo creció (se dibujó fuera), se compensa para que la vista no se mueva
    if (m0 && page.rootM && (m0[4] !== page.rootM[4] || m0[5] !== page.rootM[5])) { ox -= (page.rootM[4] - m0[4]) * zoom; oy -= (page.rootM[5] - m0[5]) * zoom; }
    cache.set(pageIdx, r); root = r; snap = null;
    renderTabsState(); statusInfo();
    draw(true);
  }
  function renderTabsState() { const bar = $('tabs'); if (!bar || !doc) return; [...bar.children].forEach((b, k) => { const p = doc.pages[k]; if (p) b.classList.toggle('vacia', !!(p.vacia && p.vacia())); }); }

  // ---------- Vistas: ZOOM Extensión / Ventana / Previo y trabajo dentro de una ventana (ESPACIOM)
  const views = []; // vistas anteriores de la hoja (ZOOM Previo), como AutoCAD guarda hasta 10
  function pushView() { const v = views[views.length - 1]; if (v && v.zoom === zoom && v.ox === ox && v.oy === oy) return; views.push({ zoom, ox, oy }); if (views.length > 10) views.shift(); }
  let wheelTimer = 0;
  function zoomBB(bb, pad = 20) {
    const r = stage.getBoundingClientRect();
    const w = Math.max(bb[2] - bb[0], 1e-9), h = Math.max(bb[3] - bb[1], 1e-9);
    pushView();
    zoom = Math.min(Math.max(Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h), 1e-4), 1e6);
    ox = r.width / 2 - (bb[0] + bb[2]) / 2 * zoom; oy = r.height / 2 - (bb[1] + bb[3]) / 2 * zoom;
    draw(true);
  }
  /** ZOOM Extensión: todo lo dibujado (en el Modelo también lo que está fuera del marco; en una plancha, la hoja y lo que se sale). */
  function zoomExt() {
    if (!page || !root) return;
    let b = root.bb && isFinite(root.bb[0]) ? root.bb.slice() : [0, 0, page.width, page.height];
    if (page === doc.pages[0] && root.ch && root.ch[0] && root.ch[0].bb && isFinite(root.ch[0].bb[0])) b = Scene.bbXform(root.ch[0].bb, root.m); // Modelo: solo lo dibujado
    if (page !== doc.pages[0]) { b[0] = Math.min(b[0], 0); b[1] = Math.min(b[1], 0); b[2] = Math.max(b[2], page.width); b[3] = Math.max(b[3], page.height); }
    zoomBB(b);
  }
  let ms = null; // ventana activa (ESPACIOM): {rec, c}
  /** La hoja tal como la ve el editor: dentro de una ventana, el Modelo visto a través de ella. */
  function pageEff() {
    if (!ms || !page || !page.vpInfo || !doc) return page;
    const info = page.vpInfo.find((v) => v.rec === ms.rec);
    if (!info || ms.rec.deleted) { ms = null; return page; }
    const mo = doc.modelo ? doc.modelo() : null; const inner = mo ? mo.inner : null;
    if (ms.c && ms.c.info === info && ms.c.inner === inner && ms.c.rootM === page.rootM) return ms.c.p;
    const p = Object.create(page);
    Object.assign(p, { rootM: Scene.mul(page.rootM, info.m), editNode: inner, editOrigin: mo ? mo.origin : [0, 0], edit: doc.pages[0].edit, ms: info, units: doc.pages[0].units, unitMM: undefined });
    ms.c = { info, inner, rootM: page.rootM, p };
    return p;
  }

  // ---------- Edición (cad.js) ----------
  let dirty = false;
  function setEditing(on) {
    document.body.classList.toggle('editing', on);
    resize(); draw(true);
  }
  function setDirty(d) {
    dirty = !!d;
    const name = $('fname').dataset.name || $('fname').textContent;
    $('fname').dataset.name = name;
    $('fname').textContent = (dirty ? '● ' : '') + name;
    document.title = (dirty ? '● ' : '') + name;
    if (native) native.postMessage({ cmd: 'dirty', value: dirty });
  }
  CAD.attach({
    doc: () => doc, page: () => pageEff(), zoom: () => zoom, paperPage: () => page,
    entrarVentana: (rec) => { ms = { rec }; draw(true); }, salirVentana: () => { ms = null; draw(true); },
    zoomExt, zoomAll: () => { pushView(); fit(); }, zoomWin: (bb) => zoomBB(bb, 10), zoomPrev: () => { const v = views.pop(); if (!v) return false; zoom = v.zoom; ox = v.ox; oy = v.oy; draw(true); return true; },
    panPage: (dx, dy) => { pushView(); ox += dx * zoom; oy += dy * zoom; draw(true); },
    goPage: (name) => { const i = doc.pages.findIndex((p) => p.title.toUpperCase() === String(name).toUpperCase()); if (i >= 0 && i !== pageIdx) return showPage(i); },
    toScreen: (x, y) => toScreen(x, y), toPage: (x, y) => toPage(x, y),
    redraw: (full) => { if (full) draw(true); else if (snap && snap.z === zoom && snap.ox === ox && snap.oy === oy) renderSnap(); else draw(true); },
    rebuild, fit: () => fit(), setDirty,
    // centra la vista en un punto de la página (coordenadas de página) mostrando `span` unidades de página
    centerOn: (px, py, span) => {
      const r = stage.getBoundingClientRect();
      if (span > 0) zoom = Math.min(Math.max(Math.min(r.width, r.height) / span, 1e-4), 1e6);
      ox = r.width / 2 - px * zoom; oy = r.height / 2 - py * zoom; draw(true);
    },
  });
  // respuesta de la app nativa al guardar
  window.domoSaved = (ok, msg) => CAD.saved(ok, msg);
  window.domoIsDirty = () => dirty;
  window.domoSave = () => { if (CAD.enabled()) CAD.save(false); return CAD.lastSaved; };
  window.domoSaveAs = () => { if (CAD.enabled()) CAD.save(true); };

  function unitToMM() {
    if (!page) return 1;
    if (page.unitMM) return page.unitMM;
    if (page.units === 'px96') return 25.4 / 96;
    if (page.units === 'm') return 1000;
    if (page.units === 'cm') return 10;
    if (page.units === 'dm') return 100;
    if (page.units === 'ft') return 304.8;
    if (page.units === 'in' || page.units === 'inches') return 25.4;
    return 1;
  }
  function paperLabel() {
    if (page.title === 'Modelo' && /^DXF/.test(doc.kind)) return `Espacio modelo · unidades: ${page.units || 'sin definir'}`;
    const f = unitToMM();
    const w = page.width * f, h = page.height * f;
    const sizes = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };
    let name = '';
    for (const [k, [a, b]] of Object.entries(sizes)) {
      const W = Math.max(w, h), H = Math.min(w, h);
      if (Math.abs(W - a) < 6 && Math.abs(H - b) < 6) name = ' (' + k + ')';
    }
    return `Papel ${Math.round(w)} × ${Math.round(h)} mm${name}`;
  }

  // ---------- Capas ----------
  function buildLayers() {
    const list = $('llist'); list.innerHTML = '';
    const names = (root && root.layers) || {};
    const used = new Set();
    (function walk(n) { if (n.layer != null) used.add(n.layer); if (n.ch) n.ch.forEach(walk); })(root);
    const ids = [...used].sort((a, b) => String(names[a] || a).localeCompare(String(names[b] || b), 'es', { numeric: true }));
    $('bLayers').style.display = ids.length > 1 ? '' : 'none';
    if (ids.length <= 1) $('layers').classList.remove('show');
    for (const id of ids) {
      const l = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.onchange = () => { if (cb.checked) Scene.hidden.delete(id); else Scene.hidden.add(id); draw(); };
      l.appendChild(cb); l.appendChild(document.createTextNode(names[id] || ('Capa ' + id)));
      list.appendChild(l);
    }
  }
  $('lAll').onclick = () => { Scene.hidden.clear(); $('llist').querySelectorAll('input').forEach(c => c.checked = true); draw(); };
  $('lNone').onclick = () => {
    const names = []; (function walk(n) { if (n.layer != null) names.push(n.layer); if (n.ch) n.ch.forEach(walk); })(root);
    names.forEach(l => Scene.hidden.add(l)); $('llist').querySelectorAll('input').forEach(c => c.checked = false); draw();
  };


  // ---------- Marcas de revisión de EPM (Design Review) ----------
  function setupMarks() {
    markups = (root && root.markups) || [];
    const obs = markups.filter((m) => m.num);
    const has = markups.length > 0 || (root && root.ch && root.ch.some((c) => c.markup));
    $('bMarks').style.display = has ? '' : 'none';
    $('bMarks').textContent = obs.length ? `Marcas EPM (${obs.length})` : 'Marcas EPM';
    if (!has) { $('marks').classList.remove('show'); return; }
    Scene.opts.hideMarkups = false;
    $('mToggle').textContent = 'Ocultar marcas';
    $('mTitle').textContent = `Observaciones de EPM · ${page.title}`;
    const cnt = {}; for (const m of markups) cnt[m.tipo] = (cnt[m.tipo] || 0) + 1;
    $('mSub').textContent = `${obs.length} observaciones con texto · ` + Object.entries(cnt).map(([k, v]) => `${v} ${k}`).join(' · ') +
      '. Clic = ir a la marca · pase el mouse sobre el plano para leerla · K muestra/oculta.';
    const list = $('mlist'); list.innerHTML = '';
    for (const m of obs) {
      const d = document.createElement('div'); d.className = 'mi'; m.el = d;
      d.innerHTML = '<div class="n"></div><div><div class="ty"></div><div class="tx"></div></div>';
      d.querySelector('.n').textContent = m.num;
      d.querySelector('.ty').textContent = m.tipo === 'llamada' ? 'Llamada' : 'Nota';
      d.querySelector('.tx').textContent = m.texto;
      d.onclick = () => { selectMark(m); zoomTo(m.focus || m.bb); };
      list.appendChild(d);
    }
    if (!obs.length) list.innerHTML = '<div class="ty" style="padding:8px">Las marcas de esta hoja no tienen texto (solo resaltados o nubes).</div>';
    if (!marksAutoOpened) { $('marks').classList.add('show'); $('layers').classList.remove('show'); marksAutoOpened = true; }
  }

  function selectMark(m) {
    if (selMark && selMark.el) selMark.el.classList.remove('sel');
    selMark = m;
    if (m && m.el) { m.el.classList.add('sel'); m.el.scrollIntoView({ block: 'nearest' }); }
    draw(true);
  }

  function zoomTo(bb) {
    const r = stage.getBoundingClientRect();
    const panelW = $('marks').classList.contains('show') ? 400 : 0;
    let [x0, y0, x1, y1] = bb;
    const minSize = 40; // mm de papel: no acercar de más a marcas pequeñas
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const w = Math.max(x1 - x0, minSize), h = Math.max(y1 - y0, minSize * 0.6);
    const availW = Math.max(200, r.width - panelW - 80), availH = Math.max(200, r.height - 80);
    zoom = Math.min(availW / w, availH / h);
    ox = (r.width - panelW) / 2 - cx * zoom; oy = r.height / 2 - cy * zoom;
    draw(true);
  }

  function markAt(px, py) {
    if (Scene.opts.hideMarkups || !markups.length) return null;
    const tol = 6 / zoom; // ~6 px de tolerancia
    let best = null, bestA = Infinity;
    for (const m of markups) {
      if (!m.texto || m.tipo === 'sello') continue;
      const b = m.tipo === 'llamada' ? m.bb : m.bb;
      if (px < b[0] - tol || px > b[2] + tol || py < b[1] - tol || py > b[3] + tol) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < bestA) { bestA = a; best = m; }
    }
    return best;
  }

  function showTip(m, cx, cy) {
    const tip = $('tip');
    if (!m) { tip.style.display = 'none'; return; }
    tip.innerHTML = '';
    const b = document.createElement('b'); b.textContent = `${m.num}. ${m.tipo === 'llamada' ? 'Llamada' : 'Nota'} de EPM`;
    tip.appendChild(b); tip.appendChild(document.createTextNode('\n' + m.texto));
    tip.style.display = 'block';
    const W = window.innerWidth, H = window.innerHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(cx + 16, W - tw - 8) + 'px';
    tip.style.top = Math.min(cy + 16, H - th - 8) + 'px';
  }

  function drawMarkBadges() {
    if (Scene.opts.hideMarkups || !markups.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = stage.getBoundingClientRect();
    if (selMark) {
      const b = selMark.focus || selMark.bb; const [x0, y0] = toScreen(b[0], b[1]), [x1, y1] = toScreen(b[2], b[3]);
      ctx.strokeStyle = '#ff9f0a'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]);
      ctx.strokeRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12); ctx.setLineDash([]);
    }
    ctx.font = 'bold 11px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const m of markups) {
      if (!m.num) continue;
      const [x, y] = toScreen(m.bb[0], m.bb[1]);
      if (x < -20 || y < -20 || x > r.width + 20 || y > r.height + 20) continue;
      const on = m === selMark || m === hoverMark;
      ctx.fillStyle = on ? '#ff3b30' : '#ff9f0a'; ctx.strokeStyle = '#1f2328'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, on ? 11 : 9, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillText(String(m.num), x, y + 0.5);
    }
  }

  function toggleMarks(force) {
    Scene.opts.hideMarkups = force !== undefined ? !force : !Scene.opts.hideMarkups;
    $('mToggle').textContent = Scene.opts.hideMarkups ? 'Mostrar marcas' : 'Ocultar marcas';
    if (Scene.opts.hideMarkups) { hoverMark = null; $('tip').style.display = 'none'; }
    draw(true);
  }

  function copyMarks() {
    const obs = markups.filter((m) => m.num);
    const txt = `Observaciones de EPM — ${document.title} — ${page.title}\n\n` + obs.map((m) => `${m.num}. ${m.texto}`).join('\n\n') + '\n';
    const done = () => { $('mCopy').textContent = 'Copiado ✓'; setTimeout(() => { $('mCopy').textContent = 'Copiar todo'; }, 1500); };
    const fallback = () => { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
  }
  $('bMarks').onclick = () => { $('marks').classList.toggle('show'); $('layers').classList.remove('show'); };
  $('mClose').onclick = () => $('marks').classList.remove('show');
  $('mToggle').onclick = () => toggleMarks();
  $('mCopy').onclick = copyMarks;

  // ---------- Vista ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = stage.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    snap = null;
  }

  function fit() {
    if (!page) return;
    if (root) pushView();
    const r = stage.getBoundingClientRect();
    const pad = 20;
    const panelW = $('marks').classList.contains('show') && r.width > 900 ? 400 : 0; // no tapar el plano con la lista de marcas
    zoom = Math.min((r.width - panelW - 2 * pad) / page.width, (r.height - 2 * pad) / page.height);
    if (!isFinite(zoom) || zoom <= 0) zoom = 1;
    ox = (r.width - panelW - page.width * zoom) / 2;
    oy = (r.height - page.height * zoom) / 2;
    draw(true);
  }

  function zoomAt(f, sx, sy) {
    const nz = Math.min(Math.max(zoom * f, 1e-4), 1e6);
    f = nz / zoom;
    ox = sx - (sx - ox) * f; oy = sy - (sy - oy) * f; zoom = nz;
    draw();
  }

  function draw(full) {
    if (full) { cancelAnimationFrame(raf); raf = 0; renderFull(); return; }
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (lastRenderMs < 30 || !snap) renderFull();
      else { renderSnap(); clearTimeout(idleTimer); idleTimer = setTimeout(renderFull, 140); }
    });
  }

  function paperColor() {
    return bgMode === 'white' ? '#ffffff' : bgMode === 'black' ? '#ffffff' : (page && page.background) || '#ffffff';
  }

  function renderFull() {
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (page && root) {
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * ox, dpr * oy);
      ctx.fillStyle = paperColor();
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12 * dpr;
      ctx.fillRect(0, 0, page.width, page.height);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      const r = stage.getBoundingClientRect();
      const view = [-ox / zoom, -oy / zoom, (r.width - ox) / zoom, (r.height - oy) / zoom];
      Scene.render(ctx, root, view, zoom * dpr);
      lastRenderMs = performance.now() - t0;
      // guardar instantánea para interacción fluida
      if (!snap) snap = document.createElement('canvas');
      snap.width = cv.width; snap.height = cv.height;
      snap.getContext('2d').drawImage(cv, 0, 0);
      snap.z = zoom; snap.ox = ox; snap.oy = oy;
    }
    drawOverlay();
    $('sZoom').textContent = page ? `Zoom: ${Math.round(zoom / fitZoom() * 100)} %` : 'Zoom: —';
  }

  function renderSnap() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const k = zoom / snap.z;
    ctx.setTransform(k, 0, 0, k, dpr * (ox - snap.ox * k), dpr * (oy - snap.oy * k));
    ctx.drawImage(snap, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawOverlay();
  }

  function fitZoom() {
    const r = stage.getBoundingClientRect();
    return Math.min((r.width - 40) / page.width, (r.height - 40) / page.height) || 1;
  }

  // ---------- Medición ----------
  const toPage = (sx, sy) => [(sx - ox) / zoom, (sy - oy) / zoom];
  const toScreen = (px, py) => [px * zoom + ox, py * zoom + oy];

  function fmtDist(du) {
    const mm = du * unitToMM();
    const sc = parseFloat($('scale').value);
    if (sc > 0) {
      const m = mm * sc / 1000;
      return m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(1)} cm`;
    }
    return `${mm.toFixed(1)} mm (papel)`;
  }

  function drawOverlay() {
    drawMarkBadges();
    const pe = ms && pageEff();
    if (pe && pe.ms) { // ventana activa (ESPACIOM): borde grueso, como AutoCAD
      const [x0, y0, x1, y1] = pe.ms.rect, M = page.rootM;
      const P = (x, y) => toScreen(M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]);
      const a = P(x0, y1), b = P(x1, y0);
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.strokeStyle = '#1e88ff'; ctx.lineWidth = 3; ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
    }
    CAD.drawOverlay(ctx, dpr);
    const lab = $('mlabel');
    if (!measuring || !mPts.length) { lab.style.display = 'none'; return; }
    const a = mPts[0], b = mPts[1] || mHover;
    if (!b) { lab.style.display = 'none'; return; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [x1, y1] = toScreen(a[0], a[1]), [x2, y2] = toScreen(b[0], b[1]);
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ff3b30';
    for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill(); }
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    lab.textContent = fmtDist(d);
    lab.style.display = 'block';
    const sr = stage.getBoundingClientRect();
    lab.style.left = (sr.left + (x1 + x2) / 2 + 10) + 'px';
    lab.style.top = (sr.top + (y1 + y2) / 2 - 28) + 'px';
  }

  function setMeasure(on) {
    measuring = on; mPts = []; mHover = null;
    $('bMeasure').classList.toggle('on', on);
    stage.classList.toggle('measure', on);
    draw(true);
  }

  // ---------- Eventos ----------
  let drag = null;
  stage.addEventListener('mousedown', (e) => {
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    // editor: clic izquierdo = punto / selección; desplazar con botón central, Opción+arrastrar o trackpad
    if (!measuring && e.button === 0 && !e.altKey && CAD.enabled() && CAD.onDown(sx, sy, e)) { drag = { cad: true }; return; }
    if (measuring && e.button === 0) {
      const p = toPage(sx, sy);
      if (mPts.length >= 2) mPts = [];
      mPts.push(p); draw(true);
      drag = { sx: e.clientX, sy: e.clientY, ox, oy, measureClick: true, moved: false };
      return;
    }
    drag = { sx: e.clientX, sy: e.clientY, ox, oy };
    stage.classList.add('drag');
  });
  window.addEventListener('mousemove', (e) => {
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag && drag.cad) { CAD.onMove(sx, sy); return; }
    if (page) {
      const [px, py] = toPage(sx, sy); const f = unitToMM();
      if (CAD.enabled() && page.rootM) {
        const pe = pageEff();
        const m = Scene.inv(pe.rootM), lx = m[0] * px + m[2] * py + m[4], ly = m[1] * px + m[3] * py + m[5];
        $('sCoord').textContent = (pe.ms ? 'MODELO ' : '') + `X: ${lx.toFixed(3)}  Y: ${ly.toFixed(3)}` + (pe.units ? ` ${pe.units}` : '');
        if (!drag && e.target.closest && e.target.closest('#stage')) CAD.onMove(sx, sy);
      } else
      $('sCoord').textContent = `X: ${(px * f).toFixed(1)}  Y: ${((page.height - py) * f).toFixed(1)} mm`;
      if (measuring && mPts.length === 1) { mHover = [px, py]; if (!drag) draw(true); }
      if (!drag && !measuring && e.target.closest && e.target.closest('#stage')) {
        const hm = markAt(px, py);
        if (hm !== hoverMark) { hoverMark = hm; draw(true); }
        showTip(hm, e.clientX, e.clientY);
      } else if (drag) { $('tip').style.display = 'none'; }
    }
    if (!drag || drag.measureClick) return;
    ox = drag.ox + (e.clientX - drag.sx); oy = drag.oy + (e.clientY - drag.sy);
    draw();
  });
  window.addEventListener('mouseup', (e) => {
    if (drag && drag.cad) { const r = stage.getBoundingClientRect(); CAD.onUp(e.clientX - r.left, e.clientY - r.top); drag = null; return; }
    if (drag && !drag.measureClick && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4 && hoverMark) selectMark(hoverMark);
    drag = null; stage.classList.remove('drag'); if (lastRenderMs >= 30) { clearTimeout(idleTimer); idleTimer = setTimeout(renderFull, 60); } });
  stage.addEventListener('dblclick', (e) => {
    if (measuring) return;
    if (!CAD.enabled()) { fit(); return; }
    const r = stage.getBoundingClientRect(); CAD.onDblClick(e.clientX - r.left, e.clientY - r.top); // doble clic sobre un texto = editarlo
  });
  stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!wheelTimer) pushView(); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { wheelTimer = 0; }, 500);
    const r = stage.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    let dy = e.deltaY; if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    if (e.ctrlKey) { zoomAt(Math.exp(-dy * 0.01), sx, sy); return; }                // pellizco del trackpad
    if (e.shiftKey || Math.abs(e.deltaX) > 0.5) { ox -= e.deltaX; oy -= e.deltaY; draw(); return; } // desplazamiento
    zoomAt(Math.exp(-dy * 0.0025), sx, sy);                                           // rueda del mouse = zoom (como AutoCAD)
  }, { passive: false });

  // Gestos de Safari/WebKit (pellizco)
  let gz = 1;
  stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gz = 1; });
  stage.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(e.scale / gz, e.clientX - r.left, e.clientY - r.top); gz = e.scale;
  });

  window.addEventListener('keydown', (e) => {
    const inCmd = e.target.id === 'cInput';
    if (e.metaKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); return; }
    const inForm = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && !inCmd; // paletas Capas/Propiedades
    if (CAD.enabled() && !inForm && CAD.onKey(e)) return;
    if (inCmd) return;
    if (inForm) { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.target.blur(); return; }
    const r = stage.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    if (e.metaKey || e.ctrlKey) return;
    if (CAD.enabled() && e.key.length === 1) return; // con un DXF abierto, las letras son comandos
    switch (e.key) {
      case 'f': case 'F': case '0': fit(); break;
      case '+': case '=': zoomAt(1.25, cx, cy); break;
      case '-': case '_': zoomAt(0.8, cx, cy); break;
      case 'ArrowLeft': ox += 60; draw(); break;
      case 'ArrowRight': ox -= 60; draw(); break;
      case 'ArrowUp': oy += 60; draw(); break;
      case 'ArrowDown': oy -= 60; draw(); break;
      case 'PageDown': if (doc && pageIdx < doc.pages.length - 1) showPage(pageIdx + 1); break;
      case 'PageUp': if (doc && pageIdx > 0) showPage(pageIdx - 1); break;
      case 'm': case 'M': setMeasure(!measuring); break;
      case 'b': case 'B': cycleBg(); break;
      case 'l': case 'L': if ($('bLayers').style.display !== 'none') $('layers').classList.toggle('show'); break;
      case 'k': case 'K': if ($('bMarks').style.display !== 'none') toggleMarks(); break;
      case 'o': case 'O': if ($('bMarks').style.display !== 'none') { $('marks').classList.toggle('show'); $('layers').classList.remove('show'); } break;
      case 'Escape': if (measuring) setMeasure(false); $('layers').classList.remove('show'); $('marks').classList.remove('show'); break;
    }
  });

  // ---------- Grosores de línea en pantalla (como LWDISPLAY): solo la vista; el archivo, el PDF y el DWF no cambian
  function setLw(on, quiet) {
    Scene.opts.lwDisplay = !!on;
    $('bLw').classList.toggle('on', !!on);
    $('bLw').textContent = on ? 'Grosores: sí' : 'Grosores: no';
    if (!quiet) { draw(true); if (CAD.enabled()) CAD.say(`Grosores de línea en pantalla ${on ? 'activados' : 'desactivados'} (solo la vista).`); }
  }
  window.domoLwDisplay = (v) => { setLw(v === undefined ? !Scene.opts.lwDisplay : v); return Scene.opts.lwDisplay; };

  function cycleBg() {
    bgMode = bgMode === 'paper' ? 'black' : bgMode === 'black' ? 'white' : 'paper';
    $('bBg').textContent = 'Fondo: ' + ({ paper: 'papel', black: 'negro', white: 'blanco' })[bgMode];
    cv.style.filter = bgMode === 'black' ? 'invert(1) hue-rotate(180deg)' : '';
    draw(true);
  }

  $('cLayer').onchange = (e) => CAD.setLayer(e.target.value);
  $('cOrtho').onclick = () => CAD.toggleOrtho();
  $('cSnap').onclick = () => CAD.toggleSnap();
  $('cSave').onclick = () => CAD.start('GUARDAR');
  $('bNew').onclick = () => window.domoNuevo();
  $('cmdbar').addEventListener('mousedown', (e) => { if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') { e.preventDefault(); $('cInput').focus(); } });

  $('bFit').onclick = fit;
  $('bIn').onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); };
  $('bOut').onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); };
  $('bBg').onclick = cycleBg;
  $('bLw').onclick = () => window.domoLwDisplay();
  $('bLayers').onclick = () => { $('layers').classList.toggle('show'); $('marks').classList.remove('show'); };
  $('bMeasure').onclick = () => setMeasure(!measuring);
  $('scale').oninput = () => draw(true);
  $('sheet').onchange = (e) => showPage(+e.target.value);

  function openDialog() {
    if (native) native.postMessage({ cmd: 'open' });
    else $('file').click();
  }
  $('bOpen').onclick = openDialog;
  $('bOpen2').onclick = openDialog;
  $('bNew2').onclick = () => window.domoNuevo();
  $('file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    e.target.value = '';
  };

  // Arrastrar y soltar
  let dragCount = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragCount++; $('drop').classList.add('show'); });
  window.addEventListener('dragleave', () => { if (--dragCount <= 0) { dragCount = 0; $('drop').classList.remove('show'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); dragCount = 0; $('drop').classList.remove('show');
    const f = e.dataTransfer.files[0]; if (!f) return;
    await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  });

  window.addEventListener('resize', () => {
    const r0 = { w: cv.width / dpr, h: cv.height / dpr };
    resize();
    const r = stage.getBoundingClientRect();
    ox += (r.width - r0.w) / 2; oy += (r.height - r0.h) / 2;
    draw(true);
  });

  resize();
  // Archivo pasado por la app nativa: index.html?file=<url>&name=<nombre>
  const q = new URLSearchParams(location.search);
  if (q.get('file')) loadURL(q.get('file'), q.get('name') || '');
})();
