// Domoplano — H6-E en la app: paneles y resaltado de COMPARAR (versiones de un plano) y CHECKEPM (lista NC-RA8-001).
// El motor está en web/comparador.js y web/checklist_epm.js; aquí solo la interfaz (lista navegable, colores sobre el
// plano, exportar PDF/MD). cad.js llama a H6E.iniciar(nombre, ctx), H6E.overlay(...) y H6E.limpiar(). Código propio.
const H6E = (() => {
  let X = null;            // contexto que da cad.js: say, irA, serializar, page, paperPage, goPage, doc, redraw, copiar
  let cmp = null;          // resultado de COMPARAR en pantalla
  let chk = null;          // resultado de CHECKEPM en pantalla
  let sel = -1;            // renglón elegido en el panel
  const ver = { agregado: true, borrado: true, cambiado: true, marca: true };
  const COL = { agregado: '#2ea043', borrado: '#ff3b30', cambiado: '#ff9f0a', marca: '#bf5af2' };
  const NOM = { agregado: 'NUEVO', borrado: 'BORRADO', cambiado: 'CAMBIADO', marca: 'MARCA EPM' };
  const IC = { ok: '✅', falla: '❌', aviso: '⚠️' };
  const native = () => (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native) || null;
  const esc = (s) => String(s == null ? '' : s);

  // ---------------------------------------------------------------- panel a la derecha
  function panel(titulo, botones) {
    let el = document.getElementById('h6epanel');
    if (!el) {
      el = document.createElement('div'); el.id = 'h6epanel';
      el.style.cssText = 'position:fixed;top:50px;right:10px;width:430px;max-height:calc(100% - 190px);display:flex;flex-direction:column;background:var(--bar);border:1px solid var(--line);border-radius:8px;z-index:7;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:12px';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const hd = document.createElement('div'); hd.style.cssText = 'display:flex;gap:5px;align-items:center;padding:8px 8px 6px 10px;font-weight:600;flex-wrap:wrap';
    const t = document.createElement('div'); t.textContent = titulo; t.style.flex = '1 1 100%'; hd.appendChild(t);
    for (const b of botones) { const x = document.createElement('button'); x.textContent = b.txt; x.title = b.tip || ''; x.style.cssText = 'height:24px;font-size:12px;padding:0 8px'; x.onclick = b.fn; hd.appendChild(x); }
    const cerrar = document.createElement('button'); cerrar.textContent = '✕'; cerrar.title = 'Cerrar y quitar los colores'; cerrar.style.cssText = 'height:24px;padding:0 8px;margin-left:auto'; cerrar.onclick = () => limpiar(); hd.appendChild(cerrar);
    const body = document.createElement('div'); body.style.cssText = 'overflow:auto;padding:4px 8px 8px;border-top:1px solid var(--line)';
    el.appendChild(hd); el.appendChild(body); el.style.display = 'flex';
    for (const id of ['verif', 'marks', 'layers', 'lman', 'props', 'blocks', 'simbs']) { const o = document.getElementById(id); if (o) o.classList.remove('show'); }
    const p2 = document.getElementById('p2panel'); if (p2) p2.style.display = 'none';
    return body;
  }
  function renglon(body, color, negrita, resto, onclick, i) {
    const d = document.createElement('div');
    d.style.cssText = `padding:4px 6px;border-radius:5px;cursor:pointer;border-left:3px solid ${color};margin-bottom:3px;user-select:text;-webkit-user-select:text`;
    const b = document.createElement('b'); b.textContent = negrita; const s = document.createElement('span'); s.textContent = ' ' + resto; s.style.whiteSpace = 'pre-wrap';
    d.appendChild(b); d.appendChild(s);
    d.onmouseenter = () => { if (sel !== i) d.style.background = 'rgba(127,127,127,.15)'; }; d.onmouseleave = () => { if (sel !== i) d.style.background = ''; };
    d.onclick = () => { sel = i; for (const q of body.children) q.style.background = ''; d.style.background = 'rgba(30,136,255,.22)'; onclick(); };
    body.appendChild(d); return d;
  }
  async function ir(espacio, x, y) {
    const pg = X.page();
    const actual = pg && pg.ms ? 'Modelo' : pg && pg.title;
    if (espacio && actual && espacio.toUpperCase() !== String(actual).toUpperCase() && X.goPage) { try { await X.goPage(espacio); } catch (e) { /* sigue */ } }
    if (x != null) X.irA(x, y);
    X.redraw();
  }
  function descargar(datos, nombre, mime, tipoNativo) {
    const n = native();
    if (n) {
      if (tipoNativo === 'exportpdf') { let bin = ''; for (let i = 0; i < datos.length; i += 0x8000) bin += String.fromCharCode.apply(null, datos.subarray(i, i + 0x8000)); n.postMessage({ cmd: 'exportpdf', name: nombre, data: btoa(bin) }); }
      else n.postMessage({ cmd: 'exportmd', name: nombre, text: datos });
      return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([datos], { type: mime })); a.download = nombre; a.click();
    X.say(`Descargado: ${nombre}`);
  }
  const base = () => { const d = X.doc(); return String((d && (d.nombre || d.name || d.fileName)) || 'plano').replace(/\.(dxf|dwg)$/i, ''); };

  // ---------------------------------------------------------------- COMPARAR
  function pedirArchivo() {
    X.say('COMPARAR  Elija la versión ANTERIOR del plano (DXF, o el DWF radicado/devuelto por EPM). El plano abierto es la versión nueva.');
    const n = native();
    if (n) { n.postMessage({ cmd: 'pickcompare' }); return; }
    const f = document.createElement('input'); f.type = 'file'; f.accept = '.dxf,.dwf,.dwfx';
    f.onchange = () => { const x = f.files && f.files[0]; if (!x) return; x.arrayBuffer().then((b) => elegido({ name: x.name, bytes: new Uint8Array(b) })); };
    f.click();
  }
  async function elegido(info) {
    if (!X) return;
    if (!info || info.error) { X.say(info && info.error ? info.error : 'COMPARAR  No se eligió archivo.'); return; }
    let bytes = info.bytes;
    try { if (!bytes) { const r = await fetch(info.url); bytes = new Uint8Array(await r.arrayBuffer()); } } catch (e) { X.say('COMPARAR  No pude leer el archivo: ' + (e.message || e)); return; }
    X.say(`COMPARAR  Comparando «${info.name}» (anterior) con el plano abierto (nuevo)…`);
    try {
      const esDWF = /\.dwfx?$/i.test(info.name) || /^\(DWF V|^PK/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 6)));
      const actual = X.serializar();
      let r;
      if (!esDWF) r = Comparador.compararDXF(bytes, actual, { nombreA: info.name, nombreB: base() + ' (abierto)' });
      else {
        // el plano abierto se pasa a DWF en memoria (mismo escritor que ⌘E) y se compara DWF con DWF; las marcas de EPM se ponen encima
        const pg = X.paperPage(); const plancha = pg && pg.title !== 'Modelo' ? pg.title : undefined;
        const w = await DWFWriter.fromDXF(new TextEncoder().encode(actual), { plancha, resolveURL: X.doc().resolveURL, title: base(), sourceName: base() + '.dxf' });
        r = await Comparador.compararDWF(bytes, w.bytes, { nombreA: info.name, nombreB: base() + ' (abierto, pasado a DWF)' });
        // DWF: mm de papel con y hacia abajo → coordenadas de la plancha (y hacia arriba), y las marcas van a la plancha abierta
        const dest = plancha || (X.doc().pages.find((p) => p.title !== 'Modelo') || {}).title || 'Modelo';
        for (const it of r.items) {
          const e = r.espacios.find((s) => s.nombre === it.espacio) || r.espacios[0]; const H = (e && e.alto) || 0;
          const b = it.bb; it.bb = [b[0], H - b[3], b[2], H - b[1]]; it.centro = it.centro ? [it.centro[0], H - it.centro[1]] : null;
          it.geo = [[[it.bb[0], it.bb[1]], [it.bb[2], it.bb[1]], [it.bb[2], it.bb[3]], [it.bb[0], it.bb[3]], [it.bb[0], it.bb[1]]]]; it.espacio = dest;
        }
        const s = r.resumen; const ruido = s.iguales < 0.5 * (s.iguales + s.agregados + s.borrados);
        if (ruido && s.marcas) { ver.agregado = false; ver.borrado = false; ver.cambiado = false; r.aviso = 'Casi todo el dibujo sale distinto (el DWF no lo hizo Domoplano o es otra versión): se muestran solo las MARCAS de EPM. Active «nuevo/borrado/cambiado» para ver todo.'; }
      }
      cmp = r; chk = null; sel = -1; mostrarCmp();
      const s = r.resumen;
      X.say(`COMPARAR  ${s.iguales} sin cambios · ${s.agregados} nuevos (verde) · ${s.borrados} borrados (rojo) · ${s.cambiados} cambiados (naranja)${s.marcas ? ` · ${s.marcas} marcas de EPM (morado)` : ''}${r.sinCambios ? ' — las dos versiones son iguales.' : '.'}`);
    } catch (e) { X.say('COMPARAR  No se pudo comparar: ' + (e.message || e)); }
  }
  function mostrarCmp() {
    const r = cmp; if (!r) return;
    const body = panel(`Comparar: ${r.anterior} → ${r.nueva}`, [
      { txt: 'Copiar', tip: 'Copiar el informe (texto)', fn: () => { X.copiar(r.informe); X.say('Informe de COMPARAR copiado.'); } },
      { txt: 'Guardar .md', tip: 'Guardar el informe en Markdown', fn: () => descargar(Comparador.informeMD(r), `Comparación - ${base()}.md`, 'text/markdown', 'exportmd') },
    ]);
    const s = r.resumen;
    const head = document.createElement('div'); head.style.cssText = 'color:var(--dim);margin:4px 0 6px';
    head.textContent = `${s.iguales} sin cambios (gris) · ${s.agregados} nuevos · ${s.borrados} borrados · ${s.cambiados} cambiados${s.marcas != null ? ' · ' + s.marcas + ' marcas' : ''}` + (r.aviso ? '\n' + r.aviso : '');
    head.style.whiteSpace = 'pre-wrap'; body.appendChild(head);
    const filtros = document.createElement('div'); filtros.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px';
    for (const k of ['agregado', 'borrado', 'cambiado', 'marca']) {
      if (k === 'marca' && !s.marcas) continue;
      const l = document.createElement('label'); l.style.cssText = `color:${COL[k]};cursor:pointer;display:inline-flex;align-items:center;gap:3px;white-space:nowrap`; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = ver[k];
      c.onchange = () => { ver[k] = c.checked; mostrarCmp(); X.redraw(); }; l.appendChild(c); l.appendChild(document.createTextNode(' ' + NOM[k].toLowerCase())); filtros.appendChild(l);
    }
    body.appendChild(filtros);
    const extra = [];
    if (r.capas.agregadas.length || r.capas.borradas.length || r.capas.cambiadas.length) extra.push(`Capas nuevas: ${r.capas.agregadas.join(', ') || '—'} · quitadas: ${r.capas.borradas.join(', ') || '—'}` + r.capas.cambiadas.map((c) => `\n  ${c.capa}: ${c.cambios.join(', ')}`).join(''));
    if (r.bloques.agregados.length || r.bloques.borrados.length || r.bloques.cambiados.length) extra.push(`Bloques nuevos: ${r.bloques.agregados.join(', ') || '—'} · quitados: ${r.bloques.borrados.join(', ') || '—'} · con otro dibujo: ${r.bloques.cambiados.join(', ') || '—'}`);
    if (r.planchas.agregadas.length || r.planchas.borradas.length) extra.push(`Planchas nuevas: ${r.planchas.agregadas.join(', ') || '—'} · quitadas: ${r.planchas.borradas.join(', ') || '—'}`);
    if (r.textos.nuevos.length || r.textos.quitados.length) extra.push(`Textos: ${r.textos.editados.length} editados · ${r.textos.nuevos.length} nuevos · ${r.textos.quitados.length} quitados`);
    for (const t of extra) { const d = document.createElement('div'); d.style.cssText = 'white-space:pre-wrap;margin-bottom:6px;color:var(--dim)'; d.textContent = t; body.appendChild(d); }
    const lista = r.items.filter((it) => ver[it.tipo]);
    if (!lista.length) { const d = document.createElement('div'); d.textContent = r.sinCambios ? 'Las dos versiones son iguales.' : 'Nada con los filtros elegidos.'; body.appendChild(d); }
    lista.slice(0, 1500).forEach((it) => {
      renglon(body, COL[it.tipo], `${it.n}. ${NOM[it.tipo]}`, `${it.ent}${it.capa ? ' [' + it.capa + ']' : ''} · ${it.espacio} · ${it.detalle}${it.tipo !== 'cambiado' && it.tipo !== 'marca' && it.texto ? ' «' + it.texto.slice(0, 70) + '»' : ''}`,
        () => { sel = it.n; if (it.centro) ir(it.espacio, it.centro[0], it.centro[1]); else X.redraw(); }, it.n);
    });
    if (lista.length > 1500) { const d = document.createElement('div'); d.textContent = `… y ${lista.length - 1500} más (ver «Guardar .md»).`; body.appendChild(d); }
  }

  // ---------------------------------------------------------------- CHECKEPM
  async function checklist() {
    const pg = X.paperPage(); const plancha = pg && pg.title !== 'Modelo' ? pg.title : undefined;
    X.say(`CHECKEPM  Revisando la plancha «${plancha || 'Modelo'}» contra la NC-RA8-001…`);
    try {
      const texto = X.serializar(); const u8 = new TextEncoder().encode(texto);
      const r = await ChecklistEPM.revisar(texto, { presentacion: plancha, nombre: base(),
        medirDWF: async (pl) => (await DWFWriter.fromDXF(u8, { plancha: pl, resolveURL: X.doc().resolveURL, title: base(), sourceName: base() + '.dxf' })).bytes.length });
      chk = r; cmp = null; sel = -1; mostrarChk();
      X.say(`CHECKEPM  «${r.plancha}»: ${r.resumen.ok} ✅ · ${r.resumen.falla} ❌ · ${r.resumen.aviso} ⚠️ → ${r.cumple ? 'cumple lo que se puede revisar en el plano.' : 'NO cumple la NC-RA8-001 (vea la lista y haga clic para ir a cada punto).'}`);
    } catch (e) { X.say('CHECKEPM  No se pudo revisar: ' + (e.message || e)); }
  }
  function mostrarChk() {
    const r = chk; if (!r) return;
    const body = panel(`Lista de chequeo NC-RA8-001 · ${r.plancha}`, [
      { txt: 'Exportar PDF', tip: 'Informe en PDF (para el expediente)', fn: () => exportarPDF(r) },
      { txt: 'Exportar MD', tip: 'Informe en Markdown (para Obsidian)', fn: () => descargar(ChecklistEPM.md(r), `Checklist RA8-001 - ${base()}.md`, 'text/markdown', 'exportmd') },
      { txt: 'Copiar', fn: () => { X.copiar(r.informe); X.say('Informe de CHECKEPM copiado.'); } },
      { txt: 'Repetir', tip: 'Volver a revisar (después de corregir)', fn: () => checklist() },
    ]);
    const head = document.createElement('div'); head.style.cssText = 'margin:4px 0 6px;font-weight:600;color:' + (r.cumple ? '#2ea043' : '#ff3b30');
    head.textContent = `${r.resumen.ok} ✅ · ${r.resumen.falla} ❌ · ${r.resumen.aviso} ⚠️ → ${r.cumple ? 'cumple lo que se puede revisar en el plano' : 'NO cumple'}`; body.appendChild(head);
    let k = 0;
    r.items.forEach((it, i) => {
      const color = it.estado === 'ok' ? '#2ea043' : it.estado === 'falla' ? '#ff3b30' : '#ff9f0a';
      renglon(body, color, `${i + 1}. ${IC[it.estado]} ${it.titulo}`, `(${it.norma})\n${it.detalle}`, () => { const d = it.donde[0]; if (d && it.estado !== 'ok') ir(r.plancha, d.x, d.y); else X.redraw(); }, 'i' + i);
      if (it.estado !== 'ok') for (const d of it.donde.slice(0, 25)) {
        const id = 'd' + (k++); d.id = id;
        const x = renglon(body, color, '   dónde', `(${d.x}, ${d.y}) ${d.que}`, () => ir(r.plancha, d.x, d.y), id); x.style.marginLeft = '14px'; x.style.opacity = '.9';
      }
    });
    const pie = document.createElement('div'); pie.style.cssText = 'color:var(--dim);margin-top:6px'; pie.textContent = 'No revisa: datos contra la licencia, punto A y carta del PDC, unifilar (6.2.3.4), vistas (6.2.3.5) ni memorias.'; body.appendChild(pie);
  }
  async function exportarPDF(r) {
    try {
      const dxf = ChecklistEPM.dxfInforme(r);
      const p = await PDFWriter.fromDXF(new TextEncoder().encode(dxf), { plancha: 'INFORME CHECKEPM', color: 'color', title: `Checklist RA8-001 - ${base()}`, author: 'DOMOTEX' });
      descargar(p.bytes, `Checklist RA8-001 - ${base()}.pdf`, 'application/pdf', 'exportpdf');
    } catch (e) { X.say('CHECKEPM  No se pudo hacer el PDF: ' + (e.message || e)); }
  }

  // ---------------------------------------------------------------- dibujo encima del plano
  function overlay(ctx, toScreen, pg) {
    if (!X || (!cmp && !chk)) return;
    const el = document.getElementById('h6epanel'); if (!el || el.style.display === 'none') return;
    const actual = pg && pg.ms ? 'Modelo' : pg && pg.title; const mismo = (e) => !e || !actual || String(e).toUpperCase() === String(actual).toUpperCase();
    ctx.save();
    if (cmp) {
      // lo que no cambió queda en gris: un velo encima del plano y, encima, las diferencias en color
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(128,128,128,0.55)'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
      const traza = (geo, color, w, dash) => {
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash || []);
        for (const pl of geo) { ctx.beginPath(); pl.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); }
      };
      for (const it of cmp.items) {
        if (!ver[it.tipo] || !mismo(it.espacio)) continue;
        const w = it.n === sel ? 3.5 : 1.8;
        if (it.tipo === 'cambiado' && it.geoA) traza(it.geoA, COL.borrado, 1, [4, 3]);
        if (it.geo) traza(it.geo, COL[it.tipo], w);
        else if (it.geoA) traza(it.geoA, COL[it.tipo], w);
        if (it.n === sel && it.centro) { const [x, y] = toScreen(it.centro[0], it.centro[1]); ctx.setLineDash([]); ctx.strokeStyle = COL[it.tipo]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.setLineDash([]);
    }
    if (chk && mismo(chk.plancha)) {
      chk.items.forEach((it) => {
        if (it.estado === 'ok') return;
        for (const d of it.donde) {
          const [x, y] = toScreen(d.x, d.y); const on = d.id === sel;
          ctx.strokeStyle = it.estado === 'falla' ? '#ff3b30' : '#ff9f0a'; ctx.lineWidth = on ? 3 : 1.5;
          ctx.beginPath(); ctx.arc(x, y, on ? 15 : 9, 0, Math.PI * 2); ctx.stroke();
          if (on) { ctx.font = 'bold 12px -apple-system, sans-serif'; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(d.que.slice(0, 60), x + 18, y - 10); }
        }
      });
    }
    ctx.restore();
  }

  function limpiar() { cmp = null; chk = null; sel = -1; const el = document.getElementById('h6epanel'); if (el) el.style.display = 'none'; if (X) X.redraw(); }
  function iniciar(nombre, ctx) {
    X = ctx;
    if (typeof Comparador === 'undefined' || typeof ChecklistEPM === 'undefined') { X.say('No están cargados web/comparador.js y web/checklist_epm.js.'); return; }
    if (nombre === 'COMPARAR') pedirArchivo(); else checklist();
  }
  /** Contexto armado desde CAD (para cuando el MCP pide mostrar un resultado sin pasar por la línea de comandos). */
  function ctxDesdeCAD() {
    const H = CAD.host;
    return {
      say: (t) => CAD.say(t),
      irA: (x, y) => { const m = H.page().rootM; const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5]; const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; if (H.centerOn) H.centerOn(px, py, 120 * k); },
      serializar: () => CAD.session.serialize(), page: () => H.page(), paperPage: () => (H.paperPage ? H.paperPage() : H.page()), goPage: (n) => H.goPage && H.goPage(n),
      doc: () => H.doc(), redraw: () => H.redraw(true),
      copiar: (t) => { const n = native(); if (n) n.postMessage({ cmd: 'copytext', text: t }); else if (navigator.clipboard) navigator.clipboard.writeText(t); },
    };
  }
  /** Muestra en la ventana un resultado ya calculado (MCP compare / checklist_epm con resaltar: true). */
  function mostrar(tipo, r) {
    if (!X) X = ctxDesdeCAD();
    sel = -1;
    if (tipo === 'comparar') { cmp = r; chk = null; for (const k of Object.keys(ver)) ver[k] = true; mostrarCmp(); } else { chk = r; cmp = null; mostrarChk(); }
    X.redraw(); return true;
  }
  if (typeof window !== 'undefined') window.domoCompararElegido = (info) => elegido(info);
  return { iniciar, overlay, limpiar, mostrar, get comparacion() { return cmp; }, get chequeo() { return chk; } };
})();
if (typeof module !== 'undefined') module.exports = H6E; else self.H6E = H6E;
