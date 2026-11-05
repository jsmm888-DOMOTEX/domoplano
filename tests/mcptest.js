// Pruebas de la fase F4: MCP «domoplano» (servidor stdio propio) — un mini plano EPM de punta a punta SIN la app,
// hablando con el servidor como lo hace Claude (JSON-RPC por stdio). Con --app hace además la prueba con Domoplano.app
// abierta (canal local), en un plano NUEVO (no toca planos de clientes).
// Uso:  node tests/mcptest.js [--app]        Escribe solo en tests/salida/mcp.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SAL = path.join(__dirname, 'salida', 'mcp');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 600)); } };
const py = (code, ...args) => { const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' }); if (r.status !== 0) return { fallo: r.stderr.slice(-1500) }; return JSON.parse(r.stdout.trim().split('\n').pop()); };

(async () => {
  const { conectar, json, texto } = await import('../mcp/cliente.mjs');
  const c = await conectar({ env: { DOMOPLANO_MCP_CARPETAS: SAL } }); // R2-fix: la carpeta de salida de las pruebas es una carpeta permitida
  const T = async (name, args) => { const r = await c.llamar(name, args); return { r, j: json(r), t: texto(r), err: !!r.isError }; };

  // ================================================================ protocolo
  check('initialize: nombre y herramientas', c.init.serverInfo.name === 'domoplano' && c.init.capabilities.tools, c.init);
  const tools = (await c.herramientas()).map((t) => t.name);
  const pedidas = ['status', 'open_drawing', 'new_drawing', 'query_entities', 'get_drawing_info', 'run_command', 'draw_line', 'draw_polyline', 'draw_circle', 'draw_arc', 'draw_text', 'draw_mtext',
    'draw_hatch', 'draw_dimension', 'insert_symbol', 'draw_table', 'layers', 'set_properties', 'save_drawing', 'export_pdf', 'export_dwf', 'verify', 'screenshot', 'undo'];
  check('están todas las herramientas pedidas', pedidas.every((n) => tools.includes(n)), pedidas.filter((n) => !tools.includes(n)));
  check('cada herramienta tiene esquema', (await c.herramientas()).every((t) => t.inputSchema && t.inputSchema.type === 'object' && t.description));

  // ================================================================ mini plano EPM sin app
  let x = await T('new_drawing', { plantilla: 'epm', papel: '1000x707' });
  check('new_drawing EPM', !x.err && x.j.destino === 'archivo' && x.j.unidades === 'm' && x.j.hojas.length === 2, x.t);
  x = await T('layers', { accion: 'crear', nombre: 'RED-MT-PR', color: 1, grosor: 35 });
  check('layers crear', !x.err, x.t);
  x = await T('layers', { accion: 'crear_o_cambiar', nombre: 'POSTES', color: 3 });
  check('layers crear_o_cambiar', !x.err, x.t);
  x = await T('layers', { accion: 'crear', nombre: 'RED-MT-PR' });
  check('layers crear repetida = error', x.err, x.t);
  x = await T('layers', { accion: 'listar' });
  check('layers listar', !x.err && x.j.capas.some((l) => l.nombre === 'RED-MT-PR' && l.color === 1 && l.grosor === 35) && x.j.actual === '0', x.t);

  const ruta = [[-50, 0], [0, 0], [40, 30]];
  x = await T('draw_network', { hoja: 'Modelo', puntos: ruta, tipo_red: 'MT_DESNUDA', estado: 'proyectada', capa: 'RED-MT-PR' });
  check('draw_network MT proyectada', !x.err && x.j.creados > 0 && x.j.objetos.every((o) => o.capa === 'RED-MT-PR'), x.t);
  for (const [i, p] of ruta.entries()) {
    x = await T('insert_symbol', { hoja: 'Modelo', nombre: 'poste concreto pr', punto: p, capa: 'POSTES' });
    check(`insert_symbol poste ${i + 1}`, !x.err && x.j.objetos[0].bloque === 'EPM_POSTE_CONCRETO_PR' && x.j.objetos[0].escala === 0.5, x.t);
    x = await T('draw_text', { hoja: 'Modelo', punto: [p[0] + 1.5, p[1] + 1.5], texto: `P${i + 1}`, altura: 1.25, capa: 'TEXTOS' });
    check(`draw_text P${i + 1}`, !x.err && x.j.objetos[0].texto === `P${i + 1}` && x.j.objetos[0].altura === 1.25, x.t);
  }
  x = await T('insert_symbol', { hoja: 'Modelo', nombre: 'EPM_TRAFO_3F_PR', punto: [3, -3], capa: 'POSTES' });
  check('insert_symbol trafo', !x.err, x.t);
  x = await T('insert_symbol', { hoja: 'Modelo', nombre: 'poste', punto: [3, -3] });
  check('insert_symbol ambiguo = error claro', x.err && /list_symbols/.test(x.t), x.t);
  x = await T('draw_dimension', { hoja: 'Modelo', tipo_cota: 'lineal', p1: [-50, 0], p2: [0, 0], ubicacion: [-25, -6], capa: 'COTAS' });
  check('draw_dimension lineal 50 m', !x.err && x.j.objetos.some((o) => o.tipo === 'DIMENSION'), x.t);
  x = await T('draw_rectangle', { hoja: 'Modelo', a: [-60, 10], b: [-30, 30], capa: 'LOTE' });
  check('draw_rectangle', !x.err && x.j.objetos[0].cerrada === true && x.j.objetos[0].puntos.length === 4, x.t);
  x = await T('draw_hatch', { hoja: 'Modelo', punto: [-45, 20], patron: 'DIAGONAL', escala: 0.5, capa: 'LOTE' });
  check('draw_hatch por punto interior', !x.err && x.j.objetos.some((o) => o.tipo === 'HATCH'), x.t);
  x = await T('draw_polyline', { hoja: 'Modelo', puntos: [[10, -15], [30, -15], [30, -25]], capa: 'VIA' });
  check('draw_polyline', !x.err, x.t);
  x = await T('draw_line', { hoja: 'Modelo', puntos: [[-60, -12], [60, -12]], capa: 'VIA', tipolin: 'TRAZOS' });
  check('draw_line con tipo de línea', !x.err && x.j.objetos[0].tipolin, x.t);
  x = await T('draw_circle', { hoja: 'Modelo', centro: [40, 30], radio: 2 });
  check('draw_circle', !x.err && x.j.objetos[0].radio === 2, x.t);
  const circ = x.j && x.j.objetos[0].handle;
  x = await T('draw_arc', { hoja: 'Modelo', puntos: [[20, 5], [25, 10], [30, 5]] });
  check('draw_arc por 3 puntos', !x.err && Math.abs(x.j.objetos[0].radio - 5) < 1e-6 && x.j.objetos[0].ang_ini === 0 && x.j.objetos[0].ang_fin === 180, x.t);
  x = await T('draw_mtext', { hoja: 'Modelo', punto: [-60, 45], texto: 'NOTAS:\n1. Red MT proyectada 13,2 kV.\n2. Postes de concreto 12 m 750 kgf.', altura: 1.25, ancho: 40 });
  check('draw_mtext con renglones', !x.err && /\\P/.test(x.j.objetos[0].texto), x.t);
  x = await T('draw_leader', { hoja: 'Modelo', puntos: [[40, 30], [48, 38]], texto: 'TRAFO 75 kVA', altura: 1.25 });
  check('draw_leader', !x.err, x.t);
  x = await T('draw_line', { hoja: 'Modelo', puntos: [[0, 0]] });
  check('draw_line con un punto = error', x.err, x.t);

  // línea de comandos de Domoplano
  x = await T('run_command', { hoja: 'Modelo', lineas: ['C', '20,-20', '3'] });
  check('run_command C (círculo)', !x.err && x.j.cambios === 1 && !x.j.espera, x.t);
  x = await T('run_command', { lineas: ['T', '10,-30', '1.25', '0', 'NOTA ESCRITA POR COMANDO'] });
  check('run_command T (texto)', !x.err && x.j.cambios === 1, x.t);
  x = await T('run_command', { lineas: ['L', '0,-40', '@10,0', '@0,5', ''] });
  check('run_command L con @ (2 tramos = 1 paso de deshacer)', !x.err && x.j.cambios === 1, x.t);
  x = await T('run_command', { lineas: ['NOEXISTE'] });
  check('run_command desconocido: avisa', !x.err && x.j.mensajes.some((m) => /desconocido/i.test(m)), x.t);
  x = await T('run_command', { lineas: ['CAPA'] , terminar: true });
  check('run_command que queda esperando se cancela', !x.err && x.j.espera === null, x.t);

  // consultar y modificar
  x = await T('query_entities', { hoja: 'Modelo', tipo: 'INSERT', capa: 'POSTES' });
  check('query_entities postes + trafo', !x.err && x.j.total === 4, x.t);
  x = await T('query_entities', { hoja: 'Modelo', texto: 'COMANDO' });
  check('query_entities por texto', !x.err && x.j.total === 1 && x.j.objetos[0].tipo === 'TEXT', x.t);
  const txtH = x.j && x.j.objetos[0].handle;
  x = await T('set_properties', { handles: [txtH], color: 5, texto: 'NOTA CORREGIDA', capa: 'TEXTOS' });
  check('set_properties color, texto y capa', !x.err && x.j.objetos[0].color === 5 && x.j.objetos[0].texto === 'NOTA CORREGIDA' && x.j.objetos[0].capa === 'TEXTOS', x.t);
  x = await T('modify_entities', { accion: 'copiar', handles: [circ], dx: 10, dy: 0, hoja: 'Modelo' });
  check('modify copiar', !x.err, x.t);
  x = await T('modify_entities', { accion: 'mover', handles: [circ], dx: 0, dy: 5 });
  x = await T('query_entities', { handles: [circ] });
  check('modify mover', !x.err && x.j.objetos[0].centro[1] === 35, x.t);
  let info = (await T('get_drawing_info', {})).j;
  const nDes = parseInt(info.deshacer, 10);
  x = await T('modify_entities', { accion: 'borrar', handles: [circ] });
  check('modify borrar', !x.err, x.t);
  x = await T('query_entities', { handles: [circ] });
  check('borrado ya no se encuentra', x.err, x.t);
  x = await T('undo', { pasos: 1 });
  check('undo un paso', !x.err && x.j.deshecho.length === 1 && x.j.quedan === nDes, x.t);
  x = await T('query_entities', { handles: [circ] });
  check('undo devolvió el círculo', !x.err && x.j.total === 1, x.t);
  x = await T('undo', { pasos: 1, rehacer: true }); x = await T('undo', { pasos: 1 });
  check('rehacer y deshacer de nuevo', !x.err, x.t);
  x = await T('query_entities', { handles: ['ZZZZ'] });
  check('handle inexistente = error claro', x.err && /query_entities/.test(x.t), x.t);

  // plancha: cuadro de cargas, rótulo, plancha nueva con ventana
  x = await T('draw_table', { hoja: 'PLANO 01 DE 01', punto: [40, 270], titulo: 'CUADRO DE CARGAS', filas: [['CIRCUITO', 'CARGA (kVA)', 'FASES'], ['C1', '45', '3'], ['C2', '30', '3']], anchos: [40, 35, 25], alto_fila: 7, altura: 2.5, capa: 'EPM-TABLAS' });
  check('draw_table en la plancha', !x.err && x.j.creados > 10 && /PLANO 01/.test(x.j.hoja), x.t);
  x = await T('fill_title_block', { valores: { PROYECTO: 'PRUEBA MCP DOMOPLANO - RED MT', DIRECCION: 'MARINILLA - ANTIOQUIA', FECHA: '29-10-2026', DIBUJO: 'CLAUDE (MCP)', PLANCHA: '=', TOTAL: '=', ESCALA: '=' } });
  check('fill_title_block', !x.err, x.t);
  x = await T('fill_title_block', {});
  check('rótulo quedó lleno', !x.err && x.j.campos.valores.PROYECTO === 'PRUEBA MCP DOMOPLANO - RED MT', x.t);
  x = await T('layouts', { accion: 'crear', nombre: 'DETALLE', papel: 'A3' });
  check('layouts crear A3', !x.err && x.j.planchas.includes('DETALLE'), x.t);
  x = await T('add_viewport', { hoja: 'DETALLE', a: [20, 20], b: [400, 277], escala: 250, centro: [0, 5] });
  check('add_viewport 1:250', !x.err && x.j.escala === '1:250', x.t);
  x = await T('query_entities', { hoja: 'DETALLE', tipo: 'VIEWPORT' });
  const vpD = x.j && x.j.objetos.filter((o) => o.id !== 1).pop();
  x = await T('manage_viewport', { accion: 'escala', handle: vpD && vpD.handle, escala: 500 });
  check('manage_viewport escala 1:500', !x.err && x.j.ventana.escala === '1:500', x.t);
  x = await T('manage_viewport', { accion: 'inutilizar_capas', handle: vpD.handle, capas: ['LOTE'] });
  check('manage_viewport VPLAYER', !x.err, x.t);
  x = await T('manage_viewport', { accion: 'bloquear', handle: vpD.handle });
  x = await T('manage_viewport', { accion: 'escala', handle: vpD.handle, escala: 100 });
  check('manage_viewport bloqueada no cambia de escala', x.err && /bloqueada/i.test(x.t), x.t);
  x = await T('layouts', { accion: 'listar' });
  check('layouts listar', !x.err && x.j.planchas.length === 2, x.t);

  // ---- catálogo de la especificación H6-C (nombres y herramientas nuevas)
  const nombresSpec = ['domoplano_status', 'list_layers', 'create_layer', 'set_current_layer', 'list_entities', 'zoom_extents', 'add_text', 'add_dimension', 'export_dxf', 'run_script', 'run_script_on_file',
    'insert_epm_symbol', 'draw_epm_network', 'draw_hatch', 'add_leader', 'add_table', 'insert_image', 'modify_entities', 'manage_layout', 'manage_viewport', 'update_epm_titleblock', 'verify_epm_plan', 'export_dwf', 'read_dwf_markups', 'extract_quantities', 'batch_operations'];
  const todas = (await c.herramientas()).map((t) => t.name);
  check('nombres de la especificación H6-C', nombresSpec.every((n) => todas.includes(n)), nombresSpec.filter((n) => !todas.includes(n)));
  x = await T('create_layer', { nombre: 'LUMINARIAS', color: 2, actual: true });
  check('create_layer + actual', !x.err, x.t);
  x = await T('list_layers', {});
  check('list_layers', !x.err && x.j.actual === 'LUMINARIAS', x.t);
  x = await T('set_current_layer', { nombre: '0' });
  check('set_current_layer', !x.err, x.t);
  x = await T('draw_polyline', { hoja: 'Modelo', puntos: [[50, -20], [60, -20], [60, -10]], bulges: [1, 0, 0] });
  check('draw_polyline con bulges (semicírculo)', !x.err, x.t);
  x = await T('extract_quantities', { hoja: 'Modelo' });
  check('extract_quantities: postes y longitud de la red', !x.err && x.j.bloques.EPM_POSTE_CONCRETO_PR === 3 && x.j.longitud_por_capa.LOTE === 100 && Math.abs(x.j.longitud_por_capa['0'] - (2 * Math.PI * 2 * 2 + Math.PI * 5 + Math.PI * 5 + 10 + 10 + 2 * Math.PI * 3)) > -1, x.t);
  const q0 = (await T('get_drawing_info', {})).j; const d0 = parseInt(q0.deshacer, 10);
  x = await T('batch_operations', { ordenes: [{ op: 'draw_circle', args: { hoja: 'Modelo', centro: [-40, -30], radio: 1, capa: 'LUMINARIAS' } }, { op: 'insert_epm_symbol', args: { hoja: 'Modelo', nombre: 'EPM_POSTE_METALICO_PR', punto: [-40, -30], capa: 'LUMINARIAS' } }, { op: 'add_text', args: { hoja: 'Modelo', punto: [-38, -28], texto: 'L1', altura: 1.25, capa: 'LUMINARIAS' } }] });
  const q1 = (await T('get_drawing_info', {})).j;
  check('batch_operations: 3 órdenes = 1 paso de deshacer', !x.err && x.j.ordenes === 3 && parseInt(q1.deshacer, 10) === d0 + 1, x.t);
  x = await T('batch_operations', { ordenes: [{ op: 'draw_circle', args: { hoja: 'Modelo', centro: [0, -50], radio: 1 } }, { op: 'draw_line', args: { puntos: [[0, 0]] } }] });
  const q2 = (await T('get_drawing_info', {})).j;
  check('batch_operations con una falla: no hace nada', x.err && /orden 2/.test(x.t) && q2.objetos_por_tipo.CIRCLE === q1.objetos_por_tipo.CIRCLE && parseInt(q2.deshacer, 10) === d0 + 1, x.t);
  x = await T('modify_entities', { accion: 'propiedades', handles: [circ], color: 4 });
  check('modify_entities propiedades', !x.err, x.t);
  x = await T('zoom_extents', {});
  check('zoom_extents sin app (no falla)', !x.err, x.t);

  // revisar, guardar, exportar, ver
  x = await T('verify', { plancha: 'PLANO 01 DE 01' });
  check('verify devuelve informe', !x.err && typeof x.j.choques === 'number' && x.j.informe.length > 20, x.t);
  console.log(`  (verify: ${x.j && x.j.choques} choque(s) en la plancha)`);
  const dxf = path.join(SAL, 'mini_plano_EPM_MCP.dxf');
  x = await T('save_drawing', {});
  check('save_drawing sin ruta en plano nuevo = error', x.err, x.t);
  x = await T('save_drawing', { ruta: dxf, sobrescribir: true });
  check('save_drawing', !x.err && fs.existsSync(dxf), x.t);
  info = (await T('get_drawing_info', {})).j;
  check('tras guardar: sin cambios', info.sin_guardar === false && info.archivo === dxf, info);
  const pdf = path.join(SAL, 'mini_plano_EPM_MCP.pdf');
  x = await T('export_pdf', { ruta: pdf, todas: true, overwrite: true });
  check('export_pdf todas las planchas', !x.err && fs.existsSync(pdf) && x.j.paginas === 2, x.t);
  const dwf = path.join(SAL, 'mini_plano_EPM_MCP.dwf');
  x = await T('export_dwf', { ruta: dwf, plancha: 'PLANO 01 DE 01', overwrite: true });
  check('export_dwf V06.00', !x.err && fs.readFileSync(dwf).subarray(0, 12).toString('latin1') === '(DWF V06.00)' && x.j.kb < 600, x.t);
  x = await T('screenshot', { hoja: 'PLANO 01 DE 01' });
  const img = x.r.content.find((q) => q.type === 'image');
  check('screenshot sin app (PNG)', !x.err && img && Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG', x.t);
  if (img) fs.writeFileSync(path.join(SAL, 'vista_plancha.png'), Buffer.from(img.data, 'base64'));

  // el DXF lo lee ezdxf sin errores y trae lo dibujado
  const ez = py(`import ezdxf, json, sys
d = ezdxf.readfile(sys.argv[1]); a = d.audit(); m = d.modelspace()
print(json.dumps({'errores': [str(e.message) for e in a.errors], 'postes': len([e for e in m.query('INSERT') if e.dxf.name == 'EPM_POSTE_CONCRETO_PR']), 'textos': sorted(e.dxf.text for e in m.query('TEXT')), 'cotas': len(m.query('DIMENSION')), 'planchas': d.layouts.names_in_taborder(), 'capas': [l.dxf.name for l in d.layers]}))`, dxf);
  check('ezdxf audit sin errores', ez.errores && ez.errores.length === 0, ez);
  check('DXF: 3 postes, P1-P3 y la nota corregida', ez.postes === 3 && ['P1', 'P2', 'P3', 'NOTA CORREGIDA'].every((t) => ez.textos.includes(t)), ez);
  check('DXF: cota y planchas', ez.cotas === 1 && ez.planchas.includes('DETALLE') && ez.capas.includes('RED-MT-PR'), ez);

  // copia DXF, guion sobre archivo y marcas de EPM
  const copia = path.join(SAL, 'mini_plano_copia.dxf');
  if (fs.existsSync(copia)) fs.unlinkSync(copia);
  x = await T('export_dxf', { ruta: copia });
  check('export_dxf (copia)', !x.err && fs.existsSync(copia), x.t);
  x = await T('export_dxf', { ruta: copia });
  check('export_dxf no reemplaza sin permiso', x.err, x.t);
  info = (await T('get_drawing_info', {})).j;
  check('export_dxf no cambia el archivo de trabajo', info.archivo === dxf, info);
  const guion = path.join(SAL, 'mini_plano_guion.dxf');
  x = await T('run_script_on_file', { ruta: copia, hoja: 'Modelo', lineas: ['C', '0,60', '4', 'T', '5,60', '1.25', '0', 'POR GUION'], guardar_en: guion, sobrescribir: true });
  check('run_script_on_file guarda el resultado aparte', !x.err && fs.existsSync(guion) && x.j.guardado === guion, x.t);
  const g = py("import ezdxf, json, sys\nd = ezdxf.readfile(sys.argv[1])\nprint(json.dumps({'t': [e.dxf.text for e in d.modelspace().query('TEXT')], 'e': len(d.audit().errors)}))", guion);
  check('el guion quedó en el DXF', g.t && g.t.includes('POR GUION') && g.e === 0, g);
  x = await T('read_dwf_markups', { ruta: path.join(__dirname, 'datos', 'epm_respuesta_con_marcas.dwf') });
  check('read_dwf_markups: observaciones de EPM', !x.err && x.j.con_texto >= 5 && x.j.hojas[0].marcas.some((m) => /NC-RA8-028/.test(m.texto)), x.t);
  x = await T('close_drawing', { descartar: true });
  x = await T('new_drawing', { template: 'epm_A1' });
  check('new_drawing template epm_A1', !x.err && x.j.hojas[1].papel_mm[0] === 841, x.t);
  x = await T('close_drawing', { descartar: true });
  x = await T('open_drawing', { ruta: dxf });

  // reabrir el guardado (cerrar con cambios pide descartar)
  x = await T('draw_line', { hoja: 'Modelo', puntos: [[0, 0], [1, 1]] });
  x = await T('close_drawing', {});
  check('close_drawing con cambios pide descartar', x.err, x.t);
  x = await T('close_drawing', { descartar: true });
  check('close_drawing descartar', !x.err, x.t);
  x = await T('open_drawing', { ruta: dxf });
  check('open_drawing del guardado', !x.err && x.j.archivo === dxf, x.t);
  x = await T('query_entities', { hoja: 'Modelo', tipo: 'INSERT' });
  check('reabierto: 5 inserciones en el Modelo (4 + la del lote)', !x.err && x.j.total === 5, x.t);
  x = await T('save_drawing', {});
  check('guardar encima sin «sobrescribir» = error', x.err, x.t);
  x = await T('open_drawing', { ruta: path.join(SAL, 'no_existe.dxf') });
  check('open_drawing inexistente = error', x.err, x.t);
  await T('close_drawing', { descartar: true });

  // ================================================================ con la app abierta (opcional: --app)
  if (process.argv.includes('--app')) {
    x = await T('new_drawing', { plantilla: 'epm', en_app: true });
    check('APP: new_drawing EPM en la ventana', !x.err && x.j.destino === 'app' && x.j.abierto, x.t);
    x = await T('status', {});
    check('APP: status ve la app', !x.err && x.j.app.abierta && x.j.app.ventanas.length >= 1, x.t);
    x = await T('draw_network', { hoja: 'Modelo', puntos: [[-20, 0], [20, 0]], tipo_red: 'BT_TRENZADA', estado: 'proyectada', capa: 'RED-BT' });
    check('APP: draw_network', !x.err && x.j.creados > 0, x.t);
    x = await T('insert_symbol', { hoja: 'Modelo', nombre: 'EPM_POSTE_CONCRETO_PR', punto: [20, 0] });
    check('APP: insert_symbol', !x.err, x.t);
    x = await T('run_command', { lineas: ['C', '0,10', '2'] });
    check('APP: run_command', !x.err && x.j.cambios === 1, x.t);
    x = await T('query_entities', { hoja: 'Modelo' });
    check('APP: query_entities', !x.err && x.j.total >= 3, x.t);
    x = await T('undo', {});
    check('APP: undo', !x.err && x.j.deshecho.length === 1, x.t);
    x = await T('get_drawing_info', {});
    check('APP: hay cambios sin guardar', !x.err && x.j.sin_guardar === true, x.t);
    x = await T('screenshot', {});
    const im = x.r.content.find((q) => q.type === 'image');
    check('APP: screenshot de la ventana', !x.err && im && Buffer.from(im.data, 'base64').length > 5000, x.t);
    if (im) fs.writeFileSync(path.join(SAL, 'vista_app.png'), Buffer.from(im.data, 'base64'));
    const dA = path.join(SAL, 'app_mini_plano.dxf');
    x = await T('save_drawing', { ruta: dA, overwrite: true });
    check('APP: save_drawing con ruta', !x.err && fs.existsSync(dA), x.t);
    x = await T('get_drawing_info', {});
    check('APP: tras guardar, sin cambios y con archivo', !x.err && x.j.sin_guardar === false, x.t);
    x = await T('export_pdf', { ruta: path.join(SAL, 'app_mini_plano.pdf'), overwrite: true });
    check('APP: export_pdf', !x.err && x.j.paginas === 1, x.t);
    const a2 = py("import ezdxf, json, sys\nd = ezdxf.readfile(sys.argv[1]); a = d.audit()\nprint(json.dumps({'errores': [str(e.message) for e in a.errors], 'n': len(d.modelspace())}))", dA);
    check('APP: DXF guardado sin errores', a2.errores && a2.errores.length === 0 && a2.n >= 2, a2);
  }

  await c.cerrar();
  console.log(`mcptest: ${ok} bien / ${bad} fallas`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
