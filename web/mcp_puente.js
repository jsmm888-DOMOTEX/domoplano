// Domoplano F4 — puente del MCP «domoplano»: las operaciones que Claude pide sobre el dibujo.
// El MISMO archivo corre en la app (WKWebView, sobre el plano que Sebastián tiene abierto) y en Node (mcp/motor.js, sobre un
// archivo sin abrir la app). Usa la misma sesión de edición (Edit.Session) y la misma línea de comandos (cad.js).
// Cada llamada que cambia el dibujo queda como UN solo paso de deshacer (⌘Z / H la quita entera). Código propio.
const DomoMCP = (() => {
  const up = (s) => String(s == null ? '' : s).trim().toUpperCase();
  const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
  const P = (p) => (Array.isArray(p) && p.length >= 2 ? [+p[0], +p[1]] : null);
  const err = (m) => { const e = new Error(m); e.domo = true; throw e; };
  const NO_LISTAR = new Set(['VERTEX', 'SEQEND', 'ATTRIB']);
  /** Búsqueda de símbolos: todas las palabras deben aparecer (sin tildes), en el nombre del bloque, la descripción o el grupo. */
  const sinTilde = (t) => up(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/_/g, ' ');
  const coincide = (x, q) => { const h = sinTilde(x.bloque + ' ' + x.nombre + ' ' + x.grupo + ' ' + x.estado + (x.estado === 'proyectado' ? ' PR' : ' EX')); return sinTilde(q).split(/\s+/).filter(Boolean).every((w) => h.includes(w)); };
  const UNIDADES = { 0: 'sin unidades', 1: 'pulgadas', 2: 'pies', 4: 'mm', 5: 'cm', 6: 'm' };

  // ---------------------------------------------------------------- hojas
  function hojaDe(ctx, nombre) {
    const doc = ctx.doc();
    if (nombre == null || nombre === '') return ctx.page();
    if (/^(model|modelo)$/i.test(String(nombre).trim())) return doc.pages[0];
    const p = doc.pages.find((q) => up(q.title) === up(nombre));
    if (!p) err(`No existe la plancha «${nombre}». Planchas: ${doc.pages.map((q) => q.title).join(', ')}.`);
    if (ctx.page() && (ctx.page() === p || Object.getPrototypeOf(ctx.page()) === p)) return ctx.page();
    return p;
  }
  async function lista(ctx, page) { if (!page.rootM) await page.build(); return page; }
  const nombreHoja = (ctx, page) => { const b = Object.getPrototypeOf(page); const t = page.title || (b && b.title); return page.ms ? `${t} (dentro de la ventana: Modelo)` : t; };

  /** Entidades de una hoja (sin vértices ni atributos sueltos). */
  function entsDe(ctx, page) {
    const D = ctx.doc().dxf;
    if (page.edit && page.edit.space === 'model') return D.entities.filter((e) => !e.deleted && e.int(67, 0) !== 1 && !NO_LISTAR.has(e.type));
    return (page.ents ? page.ents() : []).filter((e) => !NO_LISTAR.has(e.type));
  }
  /** Todas las hojas con sus entidades: [{hoja, ents}]. */
  function porHoja(ctx) { return ctx.doc().pages.map((p) => ({ hoja: p.title, ents: entsDe(ctx, p) })); }

  const handle = (r) => up(r.get(5, ''));
  function porHandles(ctx, hs) {
    const S = ctx.S(); const want = new Set((Array.isArray(hs) ? hs : [hs]).map(up));
    const out = S.allEnts().filter((r) => want.has(handle(r)) && !NO_LISTAR.has(r.type));
    const faltan = [...want].filter((h) => !out.some((r) => handle(r) === h));
    if (faltan.length) err(`No encontré estos objetos (handle): ${faltan.join(', ')}. Use query_entities para ver los handles.`);
    return out;
  }

  // ---------------------------------------------------------------- descripción de un objeto
  function puntos(r) { const out = []; let x = null; for (const [c, v] of r.p) { if (c === 10) x = +v; else if (c === 20 && x !== null) { out.push([r6(x), r6(+v)]); x = null; } } return out; }
  function resumen(ctx, r, hoja) {
    const S = ctx.S();
    const o = { handle: handle(r), tipo: r.type, capa: (r.get(8, '0') || '0').trim() };
    if (hoja) o.hoja = hoja;
    const c = r.get(62); if (c !== undefined) o.color = +c;
    const lt = r.get(6); if (lt) o.tipolin = lt.trim();
    const lw = r.get(370); if (lw !== undefined) o.grosor = +lw;
    const pt = (a, b) => [r6(r.num(a)), r6(r.num(b))];
    switch (r.type) {
      case 'LINE': o.a = pt(10, 20); o.b = pt(11, 21); o.largo = r6(Math.hypot(r.num(11) - r.num(10), r.num(21) - r.num(20))); break;
      case 'CIRCLE': o.centro = pt(10, 20); o.radio = r6(r.num(40)); break;
      case 'ARC': o.centro = pt(10, 20); o.radio = r6(r.num(40)); o.ang_ini = r6(r.num(50)); o.ang_fin = r6(r.num(51)); break;
      case 'LWPOLYLINE': o.puntos = puntos(r); o.cerrada = (r.int(70, 0) & 1) === 1; break;
      case 'TEXT': case 'MTEXT': case 'ATTDEF':
        o.punto = pt(10, 20); o.altura = r6(r.num(40)); o.texto = Documento.textoDe(r); if (r.num(50, 0)) o.giro = r6(r.num(50));
        if (r.type === 'ATTDEF') o.etiqueta = (r.get(2, '') || '').trim(); break;
      case 'INSERT': {
        o.bloque = (r.get(2, '') || '').trim(); o.punto = pt(10, 20); o.escala = r6(r.num(41, 1)); if (r.num(50, 0)) o.giro = r6(r.num(50));
        const at = S.withSeq(r).filter((q) => q.type === 'ATTRIB' && !q.deleted);
        if (at.length) { o.atributos = {}; for (const a of at) o.atributos[(a.get(2, '') || '').trim()] = Documento.textoDe(a); }
        break;
      }
      case 'HATCH': o.patron = (r.get(2, '') || '').trim(); o.solido = r.int(70, 0) === 1; break;
      case 'DIMENSION': o.medida = r6(r.num(42, NaN)); { const t = r.get(1); if (t) o.texto = t; } o.bloque = (r.get(2, '') || '').trim(); break;
      case 'LEADER': o.puntos = puntos(r); break;
      case 'VIEWPORT': {
        o.centro = pt(10, 20); o.ancho = r6(r.num(40)); o.alto = r6(r.num(41)); o.id = r.int(69, 0);
        const vh = r.num(45); if (vh > 0 && S.escalaVentana) { try { const e = S.escalaVentana(ctx.doc().pages.find((p) => p.title === hoja) || ctx.page(), r); if (e) o.escala = typeof e === 'number' ? `1:${r6(e)}` : e; } catch (x) { /* sin escala */ } }
        break;
      }
      case 'IMAGE': o.punto = pt(10, 20); break;
      default: break;
    }
    if (r.node && r.node.bb && isFinite(r.node.bb[0])) o.caja = r.node.bb.map(r6);
    return o;
  }

  // ---------------------------------------------------------------- deshacer: una llamada = un paso
  async function agrupar(ctx, label, fn) {
    const S = ctx.S(); if (!S) err('No hay un plano DXF abierto para editar.');
    const n0 = S.undoStack.length;
    let res;
    try { res = await fn(S); }
    catch (e) { // si algo falló a medias, se deshace lo que alcanzó a hacer
      while (S.undoStack.length > n0) S.undo();
      S.redoStack.length = 0; throw e;
    }
    if (res && res.error) { while (S.undoStack.length > n0) S.undo(); S.redoStack.length = 0; err(res.error); }
    const ops = S.undoStack.splice(n0);
    if (ops.length > 1) {
      S.undoStack.push({ label, full: ops.some((o) => o.full), keepModel: ops.every((o) => o.keepModel), layouts: ops.some((o) => o.layouts),
        apply: () => ops.forEach((o) => o.apply()), revert: () => ops.slice().reverse().forEach((o) => o.revert()) });
    } else if (ops.length === 1) S.undoStack.push(ops[0]);
    S.redoStack.length = 0;
    if (ops.length) await ctx.refrescar();
    return res;
  }

  /** Capa de trabajo: la pedida (se crea si no existe) o la actual. Se usa sin cambiar la capa actual del usuario. */
  function conCapa(S, capa, fn) {
    if (!capa) return fn(S.capaActual());
    let L = S.findRec('LAYER', capa);
    if (!L) { const r = S.crearCapa(capa, {}); if (r.error) err(r.error); L = S.findRec('LAYER', capa); }
    const nombre = L.get(2).trim();
    const prev = Object.prototype.hasOwnProperty.call(S, 'capaActual') ? S.capaActual : undefined;
    S.capaActual = () => nombre;
    try { return fn(nombre); } finally { if (prev === undefined) delete S.capaActual; else S.capaActual = prev; }
  }
  /** Propiedades opcionales después de crear: color (1-255, 256 = PorCapa), tipolin, grosor (centésimas de mm). */
  function props(S, recs, a) {
    const o = {};
    if (a.color != null) o.color = +a.color;
    if (a.tipolin) { if (!/^(bylayer|porcapa|byblock|porbloque|continuous)$/i.test(a.tipolin) && !S.findRec('LTYPE', a.tipolin)) { const r = S.cargarTipo(a.tipolin); if (r.error) err(r.error); } o.ltype = a.tipolin; }
    if (a.grosor != null) o.lw = +a.grosor;
    if (!Object.keys(o).length || !recs.length) return;
    const r = S.cambiarProps(recs, o); if (r && r.error) err(r.error);
  }
  function escalaAuto(S, page) {
    if (page && page.ms) return 1 / (page.ms.k * ((Object.getPrototypeOf(page).unitMM) || 1));
    if (!page || page.edit.space !== 'model') return 1;
    return S.unidadDibujo() === 6 ? 0.5 : 1;
  }
  function mtextPares(p, h, ancho, texto, o = {}) {
    const s = String(texto).replace(/\r?\n/g, '\\P');
    const body = [[10, p[0]], [20, p[1]], [30, 0], [40, h], [41, ancho || 0], [71, o.adjunto || 1], [72, 1]];
    let i = 0; for (; i + 250 < s.length; i += 250) body.push([3, s.slice(i, i + 250)]);
    body.push([1, s.slice(i)]);
    if (o.estilo) body.push([7, o.estilo]);
    if (o.giro) body.push([50, o.giro]);
    return body;
  }

  // ---------------------------------------------------------------- dibujar
  const DIBUJOS = {
    linea(S, page, a) { const p = (a.puntos || [a.a, a.b]).map(P); if (p.length < 2 || p.some((q) => !q)) err('linea: dé al menos dos puntos [x, y].'); const out = []; for (let i = 1; i < p.length; i++) out.push(S.add(page, 'LINE', 'AcDbLine', [[10, p[i - 1][0]], [20, p[i - 1][1]], [30, 0], [11, p[i][0]], [21, p[i][1]], [31, 0]], S.capaActual())); return out; },
    polilinea(S, page, a) {
      const p = (a.puntos || []).map(P); if (p.length < 2 || p.some((q) => !q)) err('polilinea: dé al menos dos puntos [x, y].');
      const bu = Array.isArray(a.bulges) ? a.bulges : [];
      const body = [[90, p.length], [70, a.cerrada ? 1 : 0], [43, a.ancho || 0]]; p.forEach((q, i) => { body.push([10, q[0]], [20, q[1]]); if (+bu[i]) body.push([42, +bu[i]]); }); // bulge = tan(ángulo/4) del tramo que sale del vértice
      return [S.add(page, 'LWPOLYLINE', 'AcDbPolyline', body, S.capaActual())];
    },
    rectangulo(S, page, a) { const p1 = P(a.a), p2 = P(a.b); if (!p1 || !p2) err('rectangulo: dé las esquinas a y b.'); return DIBUJOS.polilinea(S, page, { puntos: [p1, [p2[0], p1[1]], p2, [p1[0], p2[1]]], cerrada: true }); },
    circulo(S, page, a) { const c = P(a.centro); if (!c || !(a.radio > 0)) err('circulo: dé centro [x, y] y radio > 0.'); return [S.add(page, 'CIRCLE', 'AcDbCircle', [[10, c[0]], [20, c[1]], [30, 0], [40, +a.radio]], S.capaActual())]; },
    arco(S, page, a) {
      let c = P(a.centro), r = +a.radio, a0 = +a.ang_ini, a1 = +a.ang_fin;
      if (a.puntos && a.puntos.length === 3) { const g = Geom.arco3(...a.puntos.map(P)); if (!g) err('arco: los tres puntos están alineados.'); c = g.c; r = g.r; a0 = g.a0; a1 = g.a1; } // Geom.arco3 ya da grados en sentido antihorario
      if (!c || !(r > 0) || !Number.isFinite(a0) || !Number.isFinite(a1)) err('arco: dé centro, radio, ang_ini y ang_fin (grados, antihorario) o tres puntos.');
      return [S.add(page, 'ARC', 'AcDbCircle', [[10, c[0]], [20, c[1]], [30, 0], [40, r], [100, 'AcDbArc'], [50, Edit.norm360(a0)], [51, Edit.norm360(a1)]], S.capaActual())];
    },
    texto(S, page, a) {
      const p = P(a.punto); if (!p || a.texto == null) err('texto: dé punto [x, y] y texto.');
      const st = a.estilo || S.estiloActual(); const just = up(a.justificacion || 'I');
      if (!Documento.JUST[just]) err(`texto: justificación no válida «${a.justificacion}». Use ${Object.keys(Documento.JUST).join(', ')}.`);
      return [S.add(page, 'TEXT', 'AcDbText', Documento.textoPares(p, +a.altura || 2.5, +a.giro || 0, String(a.texto), { just, style: S.findRec('STYLE', st) ? st : null, p2: P(a.punto2) }), S.capaActual())];
    },
    mtext(S, page, a) {
      const p = P(a.punto); if (!p || a.texto == null) err('mtext: dé punto [x, y] (esquina superior izquierda) y texto.');
      const st = a.estilo || S.estiloActual();
      return [S.add(page, 'MTEXT', 'AcDbMText', mtextPares(p, +a.altura || 2.5, +a.ancho || 0, a.texto, { estilo: S.findRec('STYLE', st) ? st : null, giro: +a.giro || 0, adjunto: a.adjunto }), S.capaActual())];
    },
    sombreado(S, page, a, ctx) {
      const o = { patron: a.patron || 'SOLIDO', escala: +a.escala || 1, angulo: +a.angulo || 0 };
      let r;
      if (a.handles && a.handles.length) r = S.sombrearObjetos(page, porHandles(ctx, a.handles), o);
      else { const p = P(a.punto); if (!p) err('sombreado: dé un punto interior [x, y] o los handles de los contornos.'); r = S.sombrearPunto(page, entsDe(ctx, page), p, o); }
      if (r.error) err(r.error);
      return r.recs || (r.rec ? [r.rec] : []);
    },
    cota(S, page, a) {
      const tipo = { lineal: 'lineal', alineada: 'alineada', angular: 'angular', radio: 'radio', diametro: 'diametro', 'diámetro': 'diametro' }[String(a.tipo_cota || 'lineal').toLowerCase()];
      if (!tipo) err('cota: tipo_cota lineal, alineada, angular, radio o diametro.');
      const dt = { p1: P(a.p1), p2: P(a.p2), ubic: P(a.ubicacion), v: P(a.vertice), c: P(a.centro), r: +a.radio, punto: P(a.punto) || P(a.ubicacion) };
      if (a.angulo != null) dt.ang = +a.angulo;
      const r = S.crearCota(page, tipo, dt, { texto: a.texto, estilo: a.estilo });
      if (r.error) err(r.error);
      return r.recs || (r.rec ? [r.rec] : []);
    },
    simbolo(S, page, a) {
      const L = SimbolosEPM.lista(); const q = up(a.nombre);
      const s = L.find((x) => x.bloque === q || x.bloque === 'EPM_' + q) || (() => { const m = L.filter((x) => coincide(x, q)); return m.length === 1 ? m[0] : null; })();
      if (!s) err(`simbolo: no encontré «${a.nombre}» (o hay varios). Use list_symbols.`);
      const at = P(a.punto); if (!at) err('simbolo: dé el punto de inserción [x, y].');
      const r = S.insertarSimbolo(page, s.bloque, at, a.escala > 0 ? +a.escala : escalaAuto(S, page), +a.giro || 0, a.valores || []);
      if (r.error) err(r.error);
      return r.recs || [r.rec];
    },
    bloque(S, page, a) {
      const at = P(a.punto); if (!at || !a.nombre) err('bloque: dé nombre y punto.');
      const r = S.insertarBloque(page, a.nombre, at, a.escala > 0 ? +a.escala : 1, +a.giro || 0, a.valores || []);
      if (r.error) err(r.error);
      return r.recs || [r.rec];
    },
    red(S, page, a) {
      const p = (a.puntos || []).map(P); const tipo = up(a.tipo_red || a.red || 'MT_DESNUDA'); const est = /^E/i.test(a.estado || 'P') ? 'EX' : 'PR';
      const r = S.trazarRedEPM(page, tipo, est, p, { escala: a.escala > 0 ? +a.escala : escalaAuto(S, page) });
      if (r.error) err(r.error);
      return r.recs;
    },
    tabla(S, page, a) {
      const at = P(a.punto); if (!at) err('tabla: dé la esquina superior izquierda [x, y].');
      const r = S.crearTabla(page, { at, titulo: a.titulo || '', datos: a.filas || a.datos || [], anchos: a.anchos || 30, alto: +a.alto_fila || undefined, h: +a.altura || undefined, columnas: a.columnas, capa: S.capaActual() });
      if (r.error) err(r.error);
      return r.recs || [];
    },
    directriz(S, page, a) {
      const p = (a.puntos || []).map(P); if (p.length < 2) err('directriz: dé al menos dos puntos (el primero es la flecha).');
      const r = S.crearDirectriz(page, p, a.texto || '', { h: a.altura });
      if (r.error) err(r.error);
      return r.recs || (r.rec ? [r.rec] : []);
    },
    imagen(S, page, a) {
      const at = P(a.punto); if (!at || !a.archivo) err('imagen: dé archivo y punto.');
      const r = S.insertarImagen(page, { archivo: a.archivo, wpx: a.wpx, hpx: a.hpx, at, ancho: +a.ancho, rot: +a.giro || 0, capa: S.capaActual() });
      if (r.error) err(r.error);
      return r.recs || (r.rec ? [r.rec] : []);
    },
  };

  // nombres cortos para el lote (como las herramientas del MCP)
  const DRAW_ALIAS = { draw_line: 'linea', draw_polyline: 'polilinea', draw_rectangle: 'rectangulo', draw_circle: 'circulo', draw_arc: 'arco', draw_text: 'texto', add_text: 'texto', draw_mtext: 'mtext', draw_hatch: 'sombreado', draw_dimension: 'cota', add_dimension: 'cota', insert_symbol: 'simbolo', insert_epm_symbol: 'simbolo', insert_block: 'bloque', draw_network: 'red', draw_epm_network: 'red', draw_table: 'tabla', add_table: 'tabla', draw_leader: 'directriz', add_leader: 'directriz' };

  // ---------------------------------------------------------------- operaciones
  const OPS = {
    async info(ctx) {
      const doc = ctx.doc(); if (!doc || !doc.dxf) return { abierto: false };
      const S = ctx.S(); const D = doc.dxf; const page = ctx.page();
      const cuenta = {}; for (const r of S.allEnts()) if (!NO_LISTAR.has(r.type)) cuenta[r.type] = (cuenta[r.type] || 0) + 1;
      const pl = S.planchas ? S.planchas() : [];
      return {
        abierto: true, archivo: ctx.archivo ? ctx.archivo() : null, nombre: ctx.nombre ? ctx.nombre() : null, version: D.acadver, codificacion: doc.encoding || 'utf-8',
        unidades: UNIDADES[S.unidadDibujo ? S.unidadDibujo() : 4] || String(S.unidadDibujo()),
        hoja_actual: nombreHoja(ctx, page), hojas: doc.pages.map((p) => { const x = pl.find((q) => q.name === p.title); return { nombre: p.title, ...(x ? { papel_mm: [x.w, x.h] } : {}), objetos: entsDe(ctx, p).length }; }),
        capa_actual: S.capaActual(), capas: D.layers.size, estilo_texto: S.estiloActual(), estilo_cota: S.hdrGet('$DIMSTYLE', 2, 'Standard'),
        objetos_por_tipo: cuenta, bloques: doc.blockNames().length, sin_guardar: ctx.sinGuardar ? ctx.sinGuardar() : !!S.changed,
        deshacer: S.undoStack.length ? S.undoStack.length + ` (último: ${S.undoStack[S.undoStack.length - 1].label})` : 0,
        comando_en_curso: ctx.cad && ctx.cad.comando ? ctx.cad.comando : null,
      };
    },
    async consultar(ctx, a) {
      const lim = Math.min(+a.limite || 200, 2000);
      let grupos;
      if (a.handles && a.handles.length) { const recs = porHandles(ctx, a.handles); grupos = [{ hoja: null, ents: recs }]; }
      else if (a.hoja && /^todas$/i.test(a.hoja)) grupos = porHoja(ctx);
      else { const pg = await lista(ctx, hojaDe(ctx, a.hoja)); grupos = [{ hoja: pg.title || Object.getPrototypeOf(pg).title, ents: entsDe(ctx, pg) }]; }
      const tipos = a.tipo ? new Set((Array.isArray(a.tipo) ? a.tipo : [a.tipo]).map(up)) : null;
      const capa = a.capa ? up(a.capa) : null; const re = a.texto ? new RegExp(a.texto, 'i') : null; const caja = a.dentro;
      const out = []; let total = 0;
      for (const g of grupos) for (const r of g.ents) {
        if (tipos && !tipos.has(r.type)) continue;
        if (capa && up(r.get(8, '0')) !== capa) continue;
        const o = resumen(ctx, r, g.hoja);
        if (re && !re.test(JSON.stringify([o.texto, o.atributos, o.bloque]))) continue;
        if (caja && o.caja && (o.caja[2] < caja[0] || o.caja[0] > caja[2] || o.caja[3] < caja[1] || o.caja[1] > caja[3])) continue;
        total++; if (out.length < lim) out.push(o);
      }
      return { total, mostrados: out.length, objetos: out };
    },
    async capas(ctx, a) {
      const S = ctx.S(); const acc = String(a.accion || 'listar').toLowerCase();
      if (acc === 'listar') return { actual: S.capaActual(), capas: S.capas().map((l) => ({ nombre: l.name, color: Math.abs(l.color), apagada: !!l.off, inutilizada: !!l.frozen, bloqueada: l.locked, tipolin: l.ltype, grosor: l.lw, imprime: l.plot, actual: l.current })) };
      if (!a.nombre) err('capas: falta el nombre.');
      return agrupar(ctx, `Capa ${a.nombre}`, (S2) => {
        if (acc === 'crear' || acc === 'crear_o_cambiar') {
          if (a.tipolin && !S2.findRec('LTYPE', a.tipolin)) { const r = S2.cargarTipo(a.tipolin); if (r.error) return r; }
          if (!S2.findRec('LAYER', a.nombre)) { const r = S2.crearCapa(a.nombre, { color: a.color, ltype: a.tipolin, lw: a.grosor, plot: a.imprime }); if (r.error) return r; }
          else if (acc === 'crear') return { error: `Ya existe la capa «${a.nombre}».` };
          else { const r = S2.cambiarCapa(a.nombre, { color: a.color, ltype: a.tipolin, lw: a.grosor, plot: a.imprime }); if (r.error) return r; }
          if (a.actual) { const r = S2.capaActualA(a.nombre); if (r.error) return r; }
          return { ok: true, capa: a.nombre };
        }
        if (acc === 'actual') return S2.capaActualA(a.nombre);
        if (acc === 'cambiar') { if (a.tipolin && !S2.findRec('LTYPE', a.tipolin)) { const r = S2.cargarTipo(a.tipolin); if (r.error) return r; } return S2.cambiarCapa(a.nombre, { color: a.color, ltype: a.tipolin, lw: a.grosor, off: a.apagada, frozen: a.inutilizada, locked: a.bloqueada, plot: a.imprime }); }
        if (acc === 'renombrar') return S2.renombrarCapa(a.nombre, a.nuevo_nombre);
        return { error: `capas: acción «${a.accion}» no válida (listar, crear, crear_o_cambiar, actual, cambiar, renombrar).` };
      }).then((r) => ({ ok: true, ...(r && r.n != null ? { renombrados: r.n } : {}) }));
    },
    async dibujar(ctx, a) {
      const f = DIBUJOS[String(a.tipo || '').toLowerCase()]; if (!f) err(`dibujar: tipo «${a.tipo}» no válido (${Object.keys(DIBUJOS).join(', ')}).`);
      const page = await lista(ctx, hojaDe(ctx, a.hoja));
      let recs = [];
      await agrupar(ctx, `MCP ${a.tipo}`, (S) => conCapa(S, a.capa, () => { recs = f(S, page, a, ctx) || []; props(S, recs, a); }));
      const vivos = recs.filter((r) => r && !NO_LISTAR.has(r.type));
      return { ok: true, hoja: nombreHoja(ctx, page), creados: vivos.length, objetos: vivos.slice(0, 20).map((r) => resumen(ctx, r)) };
    },
    async propiedades(ctx, a) {
      const recs = porHandles(ctx, a.handles || []);
      await agrupar(ctx, 'MCP propiedades', (S) => {
        if (a.capa && !S.findRec('LAYER', a.capa)) { const r = S.crearCapa(a.capa, {}); if (r.error) return r; }
        if (a.capa) { const r = S.cambiarProps(recs, { layer: a.capa }); if (r && r.error) return r; }
        props(S, recs, a);
        if (a.texto != null) { const t = recs.filter((r) => ['TEXT', 'MTEXT'].includes(r.type)); if (!t.length) return { error: 'texto: ninguno de los objetos es un texto.' }; for (const r of t) { const x = S.editarTexto(r, String(a.texto)); if (x && x.error) return x; } }
        if (a.atributos) { for (const r of recs.filter((q) => q.type === 'INSERT')) for (const q of S.withSeq(r).filter((z) => z.type === 'ATTRIB' && !z.deleted)) { const tag = (q.get(2, '') || '').trim(); if (a.atributos[tag] != null) { const x = S.editarTexto(q, String(a.atributos[tag])); if (x && x.error) return x; } } }
        return { ok: true };
      });
      return { ok: true, cambiados: recs.length, objetos: porHandles(ctx, a.handles).map((r) => resumen(ctx, r)) };
    },
    async modificar(ctx, a) {
      const recs = porHandles(ctx, a.handles || []); const acc = String(a.accion || '').toLowerCase();
      const page = await lista(ctx, hojaDe(ctx, a.hoja));
      let r = null;
      await agrupar(ctx, `MCP ${acc}`, (S) => {
        const base = P(a.base) || [0, 0];
        if (acc === 'mover') r = S.move(recs, +a.dx || 0, +a.dy || 0);
        else if (acc === 'copiar') r = S.copy(recs, +a.dx || 0, +a.dy || 0, page);
        else if (acc === 'girar') r = S.rotate(recs, base, +a.angulo || 0);
        else if (acc === 'escalar') { if (!(a.factor > 0)) return { error: 'escalar: factor > 0.' }; r = S.scale(recs, base, +a.factor); }
        else if (acc === 'borrar') { S.erase(recs); r = { borrados: recs.length }; }
        else if (acc === 'simetria') { r = S.simetria(recs, P(a.p1), P(a.p2), !!a.borrar_origen, page); }
        else if (acc === 'descomponer') { r = S.descomponer(recs, page); }
        else if (acc === 'propiedades') { if (a.capa && !S.findRec('LAYER', a.capa)) { const x = S.crearCapa(a.capa, {}); if (x.error) return x; } if (a.capa) { const x = S.cambiarProps(recs, { layer: a.capa }); if (x && x.error) return x; } props(S, recs, a); r = { ok: true }; }
        else return { error: `modificar: acción «${a.accion}» no válida (mover, copiar, girar, escalar, borrar, simetria, descomponer, propiedades).` };
        return r && r.error ? r : { ok: true };
      });
      const rech = r && (r.refused || r.rechazados); return { ok: true, accion: acc, objetos: recs.length, ...(rech && rech.length ? { no_se_pudo: rech } : {}) };
    },
    async deshacer(ctx, a) {
      const S = ctx.S(); const n = Math.max(1, +a.pasos || 1); const out = [];
      for (let i = 0; i < n; i++) { const l = a.rehacer ? S.redo() : S.undo(); if (!l) break; out.push(l); }
      if (out.length) await ctx.refrescar();
      return { ok: true, [a.rehacer ? 'rehecho' : 'deshecho']: out, quedan: S.undoStack.length };
    },
    /** Línea de comandos de Domoplano: cada elemento es lo que se escribiría y Enter («» = Enter solo). */
    async comando(ctx, a) {
      const cad = ctx.cad; if (!cad) err('La línea de comandos no está disponible.');
      const lineas = Array.isArray(a.lineas) ? a.lineas : String(a.lineas || a.comando || '').split('\n');
      // R2-fix: por la línea de comandos el MCP no guarda ni exporta archivos (eso va por save_drawing / export_*, que revisan
      // carpetas permitidas y overwrite). En la app, GUARDAR reemplazaría el archivo abierto sin preguntar.
      const ESCRIBE = /^(GUARDAR|SAVE|QSAVE|GU|GUARDARCOMO|SAVEAS|EXPORTARDWF|EXPDWF|DWF|DWFOUT|EXPORTDWF|EXPORTAR|EXPORTARPDF|PDF|TRAZAR|PLOT|EXPORTPDF|EXPPDF|IMPRIMIR)$/i;
      const malo = lineas.find((l) => ESCRIBE.test(String(l).trim()) && (!cad.alias || cad.alias(String(l).trim())));
      if (malo) err(`«${String(malo).trim()}» guarda o exporta archivos: use save_drawing, export_pdf o export_dwf (revisan las carpetas permitidas y piden overwrite: true para reemplazar).`);
      const msgs = []; cad.oyente = (t) => msgs.push(t);
      const S = ctx.S(); const n0 = S ? S.undoStack.length : 0;
      if (a.hoja) { const pg = hojaDe(ctx, a.hoja); if (pg !== ctx.page() && ctx.irA) await ctx.irA(pg.title); }
      try {
        for (const l of lineas) { cad.input(String(l)); await ctx.refrescar(); }
        if (a.terminar !== false && cad.comando) { cad.input(''); await ctx.refrescar(); }
        if (a.terminar !== false && cad.comando) { cad.cancelar(); msgs.push('(comando cancelado: esperaba más datos)'); }
      } finally { cad.oyente = null; }
      // los cambios del guion quedan como un solo paso de deshacer
      const S2 = ctx.S();
      if (S2 && S2 === S && S2.undoStack.length - n0 > 1) { const ops = S2.undoStack.splice(n0); S2.undoStack.push({ label: 'MCP comando', full: ops.some((o) => o.full), keepModel: ops.every((o) => o.keepModel), layouts: ops.some((o) => o.layouts), apply: () => ops.forEach((o) => o.apply()), revert: () => ops.slice().reverse().forEach((o) => o.revert()) }); }
      return { mensajes: msgs, espera: cad.comando ? cad.indicacion : null, cambios: S2 === S && S2 ? S2.undoStack.length - n0 : null };
    },
    async planchas(ctx, a) {
      const S = ctx.S(); const acc = String(a.accion || 'listar').toLowerCase();
      if (acc === 'listar') return { actual: nombreHoja(ctx, ctx.page()), planchas: S.planchas().map((p) => ({ nombre: p.name, papel_mm: [p.w, p.h], hoja: p.media })) };
      if (acc === 'ir') { if (!ctx.irA || !(await ctx.irA(a.nombre))) err(`No existe la hoja «${a.nombre}».`); return { ok: true, actual: ctx.page().title }; }
      await agrupar(ctx, `MCP plancha ${acc}`, (S2) => {
        const hoja = a.papel ? Planchas.parseHoja(a.papel) : undefined;
        if (a.papel && !hoja) return { error: `Hoja «${a.papel}» no reconocida (1000x707, A0…A4, Carta, Oficio o «ancho x alto»).` };
        if (acc === 'crear') return S2.crearPlancha(a.nombre, hoja ? { ...hoja } : undefined);
        if (acc === 'copiar') return S2.copiarPlancha(a.origen, a.nombre);
        if (acc === 'renombrar') return S2.renombrarPlancha(a.nombre, a.nuevo_nombre);
        if (acc === 'borrar') return S2.borrarPlancha(a.nombre);
        if (acc === 'hoja') return S2.configPag(a.nombre, hoja, a.orientacion || 'H');
        return { error: `planchas: acción «${a.accion}» no válida (listar, ir, crear, copiar, renombrar, borrar, hoja).` };
      });
      return { ok: true, planchas: S.planchas().map((p) => p.name) };
    },
    async ventana(ctx, a) {
      const page = await lista(ctx, hojaDe(ctx, a.hoja));
      let r;
      await agrupar(ctx, 'MCP ventana', (S) => { r = S.crearVentana(page, P(a.a), P(a.b), { escala: a.escala > 0 ? +a.escala : null, centro: P(a.centro) || undefined }); return r; });
      return { ok: true, hoja: page.title, escala: r && r.escala ? `1:${r6(r.escala)}` : null, handle: r && r.rec ? handle(r.rec) : null };
    },
    async rotulo(ctx, a) {
      const S = ctx.S();
      if (!a.valores) { const pl = S.planchas().find((p) => S.rotulosDe(p).length); return { campos: pl ? S.valoresRotulo(pl.name) : null }; }
      let r; await agrupar(ctx, 'MCP rótulo', (S2) => { r = S2.llenarRotulo(a.valores, { donde: a.donde || 'todas' }); return r; });
      return { ok: true, planchas: r.planchas, campos: r.campos ? [...r.campos] : undefined };
    },
    async simbolos(ctx, a) {
      const q = a.buscar ? up(a.buscar) : null;
      return { simbolos: SimbolosEPM.lista().filter((s) => !q || coincide(s, q)).map((s) => ({ nombre: s.bloque, descripcion: s.nombre, grupo: s.grupo, estado: s.estado })),
        redes: Object.entries(SimbolosEPM.REDES).map(([k, v]) => ({ tipo: k, descripcion: v.nombre })), patrones: Object.entries(Dibujo.PATRONES).map(([k, v]) => ({ patron: k, descripcion: v.desc })) };
    },
    /** H6-B: edición e inspección P2 por handle (lo mismo que LISTA, AREA, UNIR, PARTIR, EDITPOL, SUPRIMEDUPL, COBERTURA,
     *  SELECSIMILAR, SELECRAPIDA, pinzamientos, COPIAPORTA/PEGAPORTA y MAPAOSM de la línea de comandos). */
    async p2(ctx, a) {
      if (typeof P2 === 'undefined') err('Falta web/edicion_p2.js.');
      const acc = String(a.accion || '').toLowerCase(); const page = hojaDe(ctx, a.hoja); await lista(ctx, page);
      const u = (page.units || ctx.doc().pages[0].units || '');
      const recs = () => porHandles(ctx, a.handles || (a.handle ? [a.handle] : []));
      const hs = (L) => (L || []).filter((r) => r && !r.deleted && !['ATTRIB', 'VERTEX', 'SEQEND'].includes(r.type)).map(handle);
      const edita = async (label, fn) => { let r; await agrupar(ctx, label, (S) => { r = fn(S); return r; }); return r; };
      switch (acc) {
        case 'lista': return { objetos: recs().map((r) => P2.info(r, { unidades: u, S: ctx.S() })) };
        case 'area': {
          if (a.puntos && a.puntos.length >= 3) { const m = P2.areaPuntos(a.puntos); return { area: r6(m.area), perimetro: r6(m.perim), unidades: u }; }
          const out = recs().map((r) => { const m = P2.medir(r); return m.error ? { handle: handle(r), error: m.error } : { handle: handle(r), area: r6(m.area), perimetro: r6(m.perim) }; });
          return { objetos: out, total: r6(out.reduce((s, x) => s + (x.area || 0), 0)), unidades: u };
        }
        case 'seleccion_similar': { const base = recs(); return { handles: hs(P2.similares(base, entsDe(ctx, page))) }; }
        case 'seleccion_rapida': { const r = P2.filtrar(a.handles ? recs() : entsDe(ctx, page), a.propiedad || 'tipo', a.valor || ''); if (r.error) err(r.error); return { handles: hs(r.recs), n: r.recs.length }; }
        case 'unir': { const r = await edita('MCP unir', (S) => S.unir(recs(), page)); return { ok: true, unidos: r.unidos, resultado: r.resultado, handles: hs(r.recs) }; }
        case 'partir': { const [r0] = recs(); const r = await edita('MCP partir', (S) => S.partir(r0, a.p1, a.p2 || null, page)); return { ok: true, piezas: r.piezas, handles: hs(r.recs) }; }
        case 'editpol': {
          let [r0] = recs(); const op = String(a.opcion || '').toLowerCase();
          const r = await edita(`MCP editpol ${op}`, (S) => {
            if (op === 'convertir') { const x = S.polConvertir(r0, page); if (x.rec) r0 = x.rec; return x; }
            if (op === 'cerrar' || op === 'abrir') return S.polCerrar(r0, op === 'cerrar');
            if (op === 'grosor') return S.polGrosor(r0, +a.grosor);
            if (op === 'invertir') return S.polInvertir(r0);
            if (op === 'decurvar') return S.polDecurvar(r0);
            return { error: 'opcion: convertir, cerrar, abrir, grosor, invertir o decurvar.' };
          });
          return { ok: true, handle: handle(r0), sinCambio: !!r.sinCambio };
        }
        case 'suprimir_duplicados': { const r = await edita('MCP suprimir duplicados', (S) => S.suprimirDuplicados(a.handles ? recs() : entsDe(ctx, page), a.tolerancia || 1e-4)); return { ok: true, borrados: r.borrados || 0, unidas: r.unidas || 0 }; }
        case 'cobertura': {
          if (a.puntos) { const r = await edita('MCP cobertura', (S) => S.crearCobertura(page, a.puntos, { capa: a.capa })); return { ok: true, handle: handle(r.rec) }; }
          const tx = recs(); const made = [];
          await edita('MCP cobertura de textos', (S) => { for (const t of tx) { const n = (page.editNode && page.editNode.ch || []).find((x) => x.rec === t); const o = page.editOrigin || [0, 0]; if (!n) return { error: `No veo el texto ${handle(t)} en esta hoja.` }; const bb = [n.bb[0] + o[0], n.bb[1] + o[1], n.bb[2] + o[0], n.bb[3] + o[1]]; const h = t.num(40, 2.5) || (bb[3] - bb[1]) * 0.3; const x = S.crearCobertura(page, P2.rectTexto(bb, t.num(50, 0), (a.margen != null ? a.margen : 0.35) * h), { antesDe: t }); if (x.error) return x; made.push(x.rec); } return { ok: true }; });
          return { ok: true, handles: hs(made) };
        }
        case 'pinzamiento': {
          const [r0] = recs(); const G = P2.grips(r0, ctx.S()); const g = G[a.indice | 0]; if (!g) err(`El objeto tiene ${G.length} pinzamientos (indice 0–${G.length - 1}): ${JSON.stringify(G.map((x, i) => ({ i, tipo: x.k, punto: [r6(x.x), r6(x.y)] })))}`);
          if (!a.punto) return { pinzamientos: G.map((x, i) => ({ indice: i, tipo: x.k, punto: [r6(x.x), r6(x.y)] })) };
          await edita('MCP pinzamiento', (S) => S.moverPinzamiento(r0, g, a.punto)); return { ok: true };
        }
        case 'copiar': { const r = ctx.S().copiarPortapapeles(recs(), a.base || [0, 0], u); if (r.error) err(r.error); return { ok: true, n: r.n, bloques: r.bloques, rechazados: r.rechazados }; }
        case 'pegar': { const clip = P2.portapapeles.leer(); const r = await edita('MCP pegar', (S) => S.pegarPortapapeles(page, clip, a.punto || null)); return { ok: true, n: r.n, handles: hs(r.recs) }; }
        case 'mapa_osm': {
          let texto = a.texto;
          if (!texto && a.archivo && typeof require === 'function') texto = require('fs').readFileSync(a.archivo, 'utf8');
          if (!texto && a.lat != null) { const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(P2.consultaOverpass(a.lat, a.lon, a.radio || 250)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (!resp.ok) err('Overpass respondió ' + resp.status); texto = await resp.text(); }
          if (!texto) err('mapa_osm: dé archivo (.osm/.json), texto, o lat y lon.');
          const f = { 4: 0.001, 5: 0.01, 6: 1 }[ctx.S().unidadDibujo()] || 1;
          const proy = P2.proyectarOSM(P2.leerOSM(texto), a.lat ?? null, a.lon ?? null, f);
          const r = await edita('MCP mapa OSM', (S) => S.calcarOSM(page, proy, a.punto || [0, 0], { alturaTexto: a.altura_texto || 0 }));
          return { ok: true, vias: r.URB_VIAS, andenes: r.URB_ANDENES, predios: r.URB_PREDIOS, origen_latlon: r.origen, nota: 'Datos © colaboradores de OpenStreetMap (ODbL).' };
        }
        default: err('accion: lista, area, seleccion_similar, seleccion_rapida, unir, partir, editpol, suprimir_duplicados, cobertura, pinzamiento, copiar, pegar o mapa_osm.');
      }
      return null;
    },
    /** Cantidades: bloques por nombre (postes, luminarias…) y longitudes por capa (líneas, polilíneas, arcos), por hoja. */
    async cantidades(ctx, a) {
      // R2-fix M-11: por omisión solo el Modelo y sin lo que no es obra (convenciones, marco, rótulo, capas que no se imprimen)
      const hoja = a.hoja || (a.todo ? 'todas' : 'Modelo');
      let grupos = !/^todas$/i.test(hoja) ? [{ hoja: hojaDe(ctx, hoja).title || 'Modelo', ents: entsDe(ctx, hojaDe(ctx, hoja)) }] : porHoja(ctx);
      const fuera = [];
      if (typeof P2 !== 'undefined' && P2.filtroCantidades) grupos = grupos.map((g) => { const f = P2.filtroCantidades(g.ents, ctx.S(), { todo: !!a.todo, capas: a.capas, zona: a.zona }); fuera.push(...f.fuera.map((x) => ({ hoja: g.hoja, ...x }))); return { hoja: g.hoja, ents: f.recs }; });
      const out = { bloques: {}, longitud_por_capa: {}, objetos_por_capa: {}, por_hoja: {}, fuera };
      const lon = (r) => { let L = 0; try { for (const e of Geom.edges(r)) L += e.k === 'seg' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : e.r * (e.full ? 2 * Math.PI : ((e.a1 - e.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)); } catch (x) { /* sin bordes */ } return L; };
      for (const g of grupos) {
        const h = out.por_hoja[g.hoja] = { bloques: {}, longitud_por_capa: {} };
        for (const r of g.ents) {
          const capa = (r.get(8, '0') || '0').trim();
          out.objetos_por_capa[capa] = (out.objetos_por_capa[capa] || 0) + 1;
          if (r.type === 'INSERT') { const b = (r.get(2, '') || '').trim(); if (b.startsWith('*')) continue; out.bloques[b] = (out.bloques[b] || 0) + 1; h.bloques[b] = (h.bloques[b] || 0) + 1; }
          else if (['LINE', 'LWPOLYLINE', 'ARC'].includes(r.type)) { const L = lon(r); out.longitud_por_capa[capa] = r6((out.longitud_por_capa[capa] || 0) + L); h.longitud_por_capa[capa] = r6((h.longitud_por_capa[capa] || 0) + L); }
        }
        if (!Object.keys(h.bloques).length && !Object.keys(h.longitud_por_capa).length) delete out.por_hoja[g.hoja];
      }
      out.unidades = UNIDADES[ctx.S().unidadDibujo()] || '';
      out.nota = 'Las longitudes son en unidades del dibujo; en el Modelo de la plantilla EPM, metros. Una red EPM (REDEPM) suma también sus marcas.';
      return out;
    },
    /** Lote: muchas órdenes (dibujar, propiedades, modificar, capas, ventana, rotulo, planchas) en UN solo paso de deshacer.
     *  ordenes = [{op, args}] o [[op, args]]. Si una falla, se deshace todo el lote. */
    async lote(ctx, a) {
      const ordenes = (a.ordenes || []).map((o) => (Array.isArray(o) ? { op: o[0], args: o[1] || {} } : o));
      if (!ordenes.length) err('lote: sin órdenes.');
      if (ordenes.length > 2000) err('lote: máximo 2000 órdenes por llamada.');
      const PERMITIDAS = new Set(['dibujar', 'propiedades', 'modificar', 'capas', 'ventana', 'gestionar_ventana', 'rotulo', 'planchas']);
      const resultados = [];
      const viejo = ctx.refrescar; let pendiente = false;
      const sub = { ...ctx, refrescar: async () => { pendiente = true; } }; // se rearma la hoja una sola vez al final
      try {
        await agrupar(ctx, `MCP lote (${ordenes.length})`, async () => {
          for (const [i, o] of ordenes.entries()) {
            const op = DRAW_ALIAS[o.op] ? 'dibujar' : o.op;
            if (!PERMITIDAS.has(op)) err(`lote: orden ${i + 1}: «${o.op}» no se permite en lote.`);
            const args = DRAW_ALIAS[o.op] ? { ...o.args, tipo: DRAW_ALIAS[o.op] } : o.args;
            if (op === 'propiedades' || op === 'modificar') await sub.refrescar();
            try { const r = await OPS[op](sub, args || {}); resultados.push({ n: i + 1, op: o.op, ...(r && r.creados != null ? { creados: r.creados, handles: (r.objetos || []).map((x) => x.handle) } : {}) }); }
            catch (e) { err(`lote: falló la orden ${i + 1} (${o.op}): ${e.message}. No se hizo nada del lote.`); }
          }
          return { ok: true };
        });
      } finally { if (pendiente) await viejo(); }
      return { ok: true, ordenes: ordenes.length, resultados: resultados.length > 100 ? resultados.slice(0, 100) : resultados, nota: 'Todo el lote es un solo paso de deshacer.' };
    },
    /** Ventanas (MV) ya creadas: escala, bloqueo, capas inutilizadas solo en esa ventana (VPLAYER), giro de la vista. */
    async gestionar_ventana(ctx, a) {
      const [vp] = porHandles(ctx, [a.handle]); if (vp.type !== 'VIEWPORT') err('gestionar_ventana: el handle no es una ventana (VIEWPORT).');
      const doc = ctx.doc(); const page = doc.pages.find((p) => p.ents && p.ents().includes(vp)); if (!page) err('No encontré la plancha de esa ventana.');
      await lista(ctx, page);
      const acc = String(a.accion || '').toLowerCase();
      await agrupar(ctx, `MCP ventana ${acc}`, (S) => {
        if (acc === 'escala') return S.ponerEscalaVentana(page, vp, +a.escala);
        if (acc === 'bloquear') return S.bloquearVentana(vp, a.valor !== false);
        if (acc === 'desbloquear') return S.bloquearVentana(vp, false);
        if (acc === 'inutilizar_capas' || acc === 'reutilizar_capas') return S.capasVentana(vp, a.capas || [], acc === 'inutilizar_capas');
        if (acc === 'girar') return S.girarVentana(vp, +a.angulo);
        if (acc === 'centrar') { if (!P(a.centro)) return { error: 'centrar: dé el centro [x, y] del modelo.' }; return S.vistaVentana(vp, P(a.centro), a.alto > 0 ? +a.alto : vp.num(45)); }
        return { error: `gestionar_ventana: acción «${a.accion}» no válida (escala, bloquear, desbloquear, inutilizar_capas, reutilizar_capas, girar, centrar).` };
      });
      return { ok: true, ventana: resumen(ctx, vp, page.title) };
    },
    async serializar(ctx) { const S = ctx.S(); if (!S) err('No hay un plano DXF abierto.'); return { texto: S.serialize(), codificacion: ctx.doc().encoding || 'utf-8' }; },
    async guardado(ctx) { if (ctx.cad && ctx.cad.marcarGuardado) ctx.cad.marcarGuardado(); return { ok: true }; },
    async verificar(ctx, a) {
      const S = ctx.S(); const r = await Verificador.verificar(new TextEncoder().encode(S.serialize()), { presentacion: a.plancha, anchoExtra: a.ancho_extra, nombre: ctx.nombre ? ctx.nombre() : 'plano' });
      return { choques: r.colisiones.length, informe: r.informe };
    },
    // H6-E: mostrar en la ventana un resultado de COMPARAR o CHECKEPM ya calculado por el servidor (colores y lista)
    async h6e_mostrar(ctx, a) {
      if (ctx.modo !== 'app' || typeof H6E === 'undefined') return { ok: false, nota: 'Solo se puede resaltar en la ventana de la app.' };
      H6E.mostrar(a.tipo === 'checklist' ? 'checklist' : 'comparar', a.resultado); return { ok: true };
    },
  };

  /** Ejecuta una operación sobre el contexto dado. Devuelve {ok:true, ...} o {error}. */
  async function exec(ctx, op, args) {
    const f = OPS[op]; if (!f) return { error: `Operación desconocida: ${op}` };
    if (op !== 'info' && op !== 'simbolos' && !(ctx.doc() && ctx.doc().dxf)) return { error: 'No hay un plano DXF abierto (abra uno o cree uno nuevo).' };
    try { return await f(ctx, args || {}); } catch (e) { return { error: e && e.domo ? e.message : 'Error interno: ' + (e && e.stack || e) }; }
  }

  // ---------------------------------------------------------------- en la app: el plano de la ventana
  function ctxApp() {
    const H = CAD.host;
    return {
      modo: 'app', cad: CAD,
      doc: () => (H ? H.doc() : null), S: () => CAD.session, page: () => H.page(),
      irA: async (n) => { const i = H.doc().pages.findIndex((p, k) => up(p.title) === up(n) || (/^model/i.test(n) && k === 0)); if (i < 0) return false; await H.goPage(H.doc().pages[i].title); return true; },
      refrescar: () => CAD.refrescar(), sinGuardar: () => !!(window.domoIsDirty && window.domoIsDirty()),
      nombre: () => { const el = document.getElementById('fname'); return el ? (el.dataset.name || el.textContent).replace(/^● /, '') : null; },
    };
  }
  /** Llamada desde la app nativa (main.swift): devuelve JSON (texto) para que viaje igual por el canal. */
  async function app(op, args) {
    if (typeof CAD === 'undefined' || !CAD.host) return JSON.stringify({ error: 'Domoplano todavía está cargando.' });
    return JSON.stringify(await exec(ctxApp(), op, args));
  }

  return { exec, app, OPS, DIBUJOS, resumen };
})();
if (typeof module !== 'undefined') module.exports = DomoMCP; else self.DomoMCP = DomoMCP;
