// Domoplano — H6-D: abrir DWG de terceros sin AutoCAD (parte web).
// La conversión DWG → DXF la hace la app nativa (mac/dwg.swift) con LibreDWG (dwg2dxf, GPLv3) como programa aparte.
// Aquí: el comando ABRIRDWG (y alias), la franja de aviso con lo que NO se pudo convertir y el mensaje al soltar un .dwg
// sobre la ventana. No toca cad.js: el comando se atrapa en la línea de comandos antes que el editor.
const DWGPuente = (() => {
  const ALIAS = new Set(['ABRIRDWG', 'IMPORTARDWG', 'DWGIN', 'OPENDWG', 'ADWG', 'ABRIR-DWG']);
  const nativo = () => (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native) || null;

  /** Texto del aviso (también lo usa tests/dwgtest.js). info = lo que manda mac/dwg.swift. */
  function texto(i) {
    const p = [];
    const n = (x) => Number(x || 0).toLocaleString('es-CO');
    p.push(`«${i.dwg}» — ${i.version} — importado a DXF con LibreDWG en ${String((+i.segundos || 0).toFixed(1)).replace('.', ',')} s · ${n(i.entidades)} objetos.`);
    const no = [];
    if (i.proxy) no.push(`${i.proxy} objeto(s) PROXY de otros programas (no se dibujan)`);
    if (i.ole) no.push(`${i.ole} objeto(s) OLE (tablas de Excel/Word pegadas: no se muestran)`);
    if (i.dinamicos) no.push('bloques dinámicos: se ven en su estado actual, sin sus parámetros');
    if (i.xref && i.xref.length) no.push(`${i.xref.length} referencia(s) externa(s) no cargadas (${i.xref.slice(0, 3).join(', ')}${i.xref.length > 3 ? '…' : ''})`);
    if (i.shx && i.shx.length) no.push(`fuentes SHX (${i.shx.slice(0, 3).join(', ')}${i.shx.length > 3 ? '…' : ''}) con Liberation Sans`);
    if (i.errores) no.push(`${i.errores} error(es) menores de lectura (colores o referencias internas)`);
    p.push(no.length ? 'Lo que no llegó igual: ' + no.join('; ') + '.' : 'Sin pérdidas detectadas.');
    p.push('El .dwg no se modifica: ⌘S guarda un .dxf (pregunta dónde, junto al original).');
    return p.join(' ');
  }

  // ---------------------------------------------------------------- franja de aviso
  function franja(msg, tipo) {
    if (typeof document === 'undefined') return;
    let d = document.getElementById('dwgAviso');
    if (!d) {
      d = document.createElement('div'); d.id = 'dwgAviso';
      d.style.cssText = 'position:fixed;left:50%;top:50px;transform:translateX(-50%);max-width:min(860px,calc(100% - 32px));z-index:20;' +
        'padding:10px 40px 10px 14px;border-radius:6px;font:13px/1.45 -apple-system,system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)';
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Cerrar aviso';
      x.style.cssText = 'position:absolute;right:8px;top:8px;background:none;border:0;color:inherit;font-size:14px;cursor:pointer';
      x.onclick = () => { d.style.display = 'none'; };
      const t = document.createElement('div'); t.className = 'txt';
      d.append(t, x); document.body.appendChild(d);
    }
    const col = { ok: ['#1d3a2a', '#cfeedd', '#2f6b4a'], aviso: ['#3a321b', '#f3e6bf', '#7a6324'], error: ['#4a1f1f', '#ffd4cc', '#8a3a33'], espera: ['#22303f', '#dce8f5', '#3d5875'] }[tipo] || ['#22303f', '#dce8f5', '#3d5875'];
    d.style.background = col[0]; d.style.color = col[1]; d.style.border = `1px solid ${col[2]}`; d.style.display = '';
    d.querySelector('.txt').textContent = msg;
  }

  /** Cuando el editor ya está listo, deja el resumen también en la línea de comandos. */
  function decirCuandoListo(msg, intentos = 60) {
    if (typeof CAD !== 'undefined' && CAD.enabled && CAD.enabled()) { CAD.say(msg); return; }
    if (intentos > 0) setTimeout(() => decirCuandoListo(msg, intentos - 1), 250);
  }

  function abrir() {
    const n = nativo();
    if (n) { n.postMessage({ cmd: 'opendwg' }); return true; }
    franja('ABRIRDWG solo funciona dentro de la app Domoplano (la conversión usa LibreDWG). Sin la app: node cli/dwg_a_dxf.js plano.dwg', 'aviso');
    return false;
  }

  if (typeof window !== 'undefined') {
    window.domoAbrirDWG = abrir;
    window.domoDWGConvirtiendo = (nombre) => franja(`Convirtiendo «${nombre}» a DXF con LibreDWG…`, 'espera');
    window.domoDWGImportado = (info) => {
      const t = texto(info);
      const hay = info.proxy || info.ole || info.dinamicos || (info.xref && info.xref.length) || info.errores;
      franja(t, hay ? 'aviso' : 'ok');
      decirCuandoListo(`DWG importado: ${info.dwg} — ${info.version} — ${info.entidades} objetos.${hay ? ' Revise el aviso de arriba.' : ''}`);
    };
    window.domoDWGError = (nombre, msg) => franja(`No se pudo abrir «${nombre}»: ${msg}`, 'error');

    // comando ABRIRDWG escrito en la línea de comandos (se atrapa antes que el editor, que no lo conoce)
    window.addEventListener('keydown', (e) => {
      const inp = document.getElementById('cInput');
      if (!inp || e.target !== inp || e.key !== 'Enter') return;
      const pr = (document.getElementById('cPrompt') || {}).textContent || '';
      if (!/^\s*Comando:?\s*$/i.test(pr)) return; // solo si no hay otro comando pidiendo datos
      if (!ALIAS.has(inp.value.trim().toUpperCase())) return;
      e.preventDefault(); e.stopImmediatePropagation();
      inp.value = '';
      if (typeof CAD !== 'undefined' && CAD.say) CAD.say('ABRIRDWG');
      abrir();
    }, true);

    // un .dwg soltado sobre la ventana: la página no recibe la ruta del archivo, así que se explica cómo abrirlo
    window.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !/\.dwg$/i.test(f.name)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const d = document.getElementById('drop'); if (d) d.classList.remove('show');
      franja(`«${f.name}» es un DWG: ábralo con Archivo → «Abrir DWG…» (o el comando ABRIRDWG), o suéltelo sobre el ícono de Domoplano en el Dock.`, 'aviso');
    }, true);
  }

  return { texto, abrir, ALIAS };
})();
if (typeof module !== 'undefined') module.exports = DWGPuente;
