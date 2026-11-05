#!/usr/bin/env node
// Domoplano F4 — servidor MCP «domoplano» (stdio, JSON-RPC 2.0 escrito a mano: sin dependencias).
// Claude trabaja en Domoplano POR DENTRO, sin tocar el teclado ni el ratón de Sebastián:
//   • destino «archivo»: sobre un DXF sin abrir la app (el mismo motor JS de la app corriendo en Node, mcp/motor.js);
//   • destino «app»: sobre el plano abierto en Domoplano.app, por un socket Unix local del usuario (mcp/canal_app.js).
// Registro en Claude Code (lo hace Sebastián; este programa NO toca configuraciones):
//   claude mcp add domoplano --scope user -- node "/Users/sebastianmunoz/Documents/Programas/Domoplano/mcp/servidor.js"
// Prueba sin Claude:  node mcp/cliente.mjs llamadas.json      (llamadas.json = [["tool", {args}], …])
'use strict';
// stdout es SOLO para el protocolo: cualquier console.log del motor va a stderr
console.log = (...a) => console.error(...a);
console.info = console.log; console.warn = (...a) => console.error(...a);

const fs = require('fs');
const path = require('path');
const os = require('os');
const motor = require('./motor.js');
const canal = require('./canal_app.js');
const Permisos = require('./permisos.js'); // R2-fix: carpetas permitidas, overwrite explícito, sin Escritorio/Descargas

const VERSION = '1.0.0';
const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// ---------------------------------------------------------------- estado
const plano = new motor.PlanoSinApp();   // el plano «archivo» (sin app); uno a la vez
let abiertoSinApp = false;
let destino = null;                      // 'archivo' | 'app' : dónde trabaja Claude ahora
const respaldados = new Set();

const ok = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const fallo = (m) => ({ content: [{ type: 'text', text: typeof m === 'string' ? m : JSON.stringify(m) }], isError: true });
const imagen = (png, nota) => ({ content: [{ type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }, ...(nota ? [{ type: 'text', text: nota }] : [])] });
const exp = (p) => path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()));

async function elegir(a) {
  const t = a && a.destino;
  if (t === 'archivo' || t === 'app') return t;
  if (destino) return destino;
  if (abiertoSinApp) return 'archivo';
  if (await canal.disponible()) return 'app';
  return null;
}
/** Ejecuta una operación del puente en el destino. */
async function puente(fn, a) {
  const d = await elegir(a);
  if (!d) return { error: 'No hay plano abierto. Use open_drawing o new_drawing (con en_app: true para trabajar en la ventana de Domoplano).' };
  if (d === 'archivo') {
    if (!abiertoSinApp) return { error: 'No hay un plano abierto sin app. Use open_drawing o new_drawing.' };
    return DomoMCP.exec(plano.contexto(), fn, a);
  }
  const r = await canal.js(fn, a, a && a.ventana != null ? { ventana: a.ventana } : {});
  if (r && r.sin_app) return { error: r.error + ' Ábralo con open_drawing/new_drawing y en_app: true, o trabaje sin app (destino: "archivo").' };
  return r;
}
const res = (r) => (r && r.error ? fallo(r.error) : ok(r));

/** Carpetas del plano abierto (sin app y, si responde, las de las ventanas de la app que tienen archivo). */
async function carpetasAbiertas() {
  const out = [];
  if (abiertoSinApp && plano.archivo) out.push(path.dirname(plano.archivo));
  try { if (await canal.disponible()) { const v = await canal.pedir({ op: 'ventanas' }); for (const w of (v && v.ventanas) || []) if (w.archivo) out.push(path.dirname(w.archivo)); } } catch (e) { /* sin app */ }
  return out;
}
/** Revisa una escritura del MCP: {ok, ruta} o {error}. extra = carpetas de archivos de entrada (ruta del guion, anterior…). */
async function permiso(ruta, a, extra = []) {
  return Permisos.revisar(ruta, { abiertas: [...(await carpetasAbiertas()), ...extra], overwrite: a.overwrite === true || a.sobrescribir === true, escritorio: a.permitir_escritorio_descargas === true });
}
const ESCRITURA = {
  overwrite: { type: 'boolean', description: 'true = reemplazar un archivo que ya existe (sin esto nunca se reemplaza). Alias: sobrescribir.' },
  sobrescribir: { type: 'boolean', description: 'Alias de overwrite.' },
  permitir_escritorio_descargas: { type: 'boolean', description: 'true SOLO si Sebastián pidió guardar en el Escritorio o en Descargas.' },
};

/** Texto DXF actual + carpeta (para buscar la firma u otras imágenes) + nombre, en cualquiera de los dos destinos. */
async function textoActual(a) {
  const d = await elegir(a);
  if (d === 'archivo') {
    if (!abiertoSinApp) return { error: 'No hay un plano abierto.' };
    const r = await DomoMCP.exec(plano.contexto(), 'serializar', {}); if (r.error) return r;
    return { ...r, carpeta: plano.carpeta, nombre: plano.nombre, destino: d };
  }
  if (d === 'app') {
    const v = await canal.pedir({ op: 'ventanas' }); if (v.error) return v;
    const w = v.ventanas.find((x) => x.de_claude) || v.ventanas[0];
    const r = await canal.js('serializar', {}, a && a.ventana != null ? { ventana: a.ventana } : {}); if (r.error) return r;
    return { ...r, carpeta: w && w.archivo ? path.dirname(w.archivo) : os.homedir(), nombre: w && w.archivo ? path.basename(w.archivo) : 'Plano nuevo.dxf', archivo: w && w.archivo, destino: d };
  }
  return { error: 'No hay plano abierto.' };
}

// ---------------------------------------------------------------- herramientas
const PUNTO = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[x, y] en unidades del dibujo' };
const PUNTOS = { type: 'array', items: PUNTO };
const COMUNES = {
  destino: { type: 'string', enum: ['archivo', 'app'], description: 'Dónde trabajar: «archivo» (sin app) o «app» (ventana de Domoplano). Por omisión, donde se abrió/creó el último plano.' },
  hoja: { type: 'string', description: 'Hoja donde dibujar: «Modelo» o el nombre de la plancha. Por omisión la hoja actual.' },
  capa: { type: 'string', description: 'Capa (se crea si no existe). Por omisión la capa actual; no cambia la capa actual.' },
  color: { type: 'integer', description: 'Color ACI 1-255 (256 = PorCapa)' },
  tipolin: { type: 'string', description: 'Tipo de línea (TRAZOS, CENTRO, … se carga si falta; ByLayer por omisión)' },
  grosor: { type: 'integer', description: 'Grosor en centésimas de mm (p. ej. 35 = 0,35 mm; -1 = PorCapa)' },
};
const conComunes = (props, req = [], sin = []) => ({ type: 'object', properties: { ...props, ...Object.fromEntries(Object.entries(COMUNES).filter(([k]) => !sin.includes(k))) }, required: req });
const SOLO_DESTINO = { type: 'object', properties: { destino: COMUNES.destino } };

const H = []; // [{name, description, inputSchema, run}]
const tool = (name, description, inputSchema, run) => H.push({ name, description, inputSchema, run });
const dib = (tipo) => async (a) => res(await puente('dibujar', { ...a, tipo }));

tool('status', 'Estado: plano abierto sin app (archivo), si Domoplano.app está abierta y sus ventanas, y dónde trabaja Claude. Úsela primero.', { type: 'object', properties: {} }, async () => {
  const app = await canal.disponible();
  const info = abiertoSinApp ? await DomoMCP.exec(plano.contexto(), 'info', {}) : null;
  return ok({ destino_actual: destino || (abiertoSinApp ? 'archivo' : app ? 'app' : null), archivo: abiertoSinApp ? { ruta: plano.archivo, nombre: plano.nombre, hoja: info.hoja_actual, sin_guardar: info.sin_guardar } : null,
    app: app ? { abierta: true, ventanas: app.ventanas } : { abierta: false }, version: VERSION,
    escritura: { carpetas_permitidas: [...new Set([...(await carpetasAbiertas()), ...Permisos.listaConfigurada()])], configuracion: Permisos.CONFIG, nota: 'Solo se escribe ahí; nunca se reemplaza sin overwrite: true; nunca Escritorio/Descargas sin permitir_escritorio_descargas.' } });
});

tool('open_drawing', 'Abre un DXF. Sin app (por omisión): lo carga en el motor de Domoplano sin ventana. Con en_app: true, lo abre en Domoplano.app (en segundo plano, sin quitarle el foco a Sebastián) y Claude trabaja en esa ventana.',
  { type: 'object', properties: { ruta: { type: 'string', description: 'Ruta del .dxf' }, en_app: { type: 'boolean' } }, required: ['ruta'] }, async (a) => {
    const ruta = exp(a.ruta);
    if (!fs.existsSync(ruta)) return fallo(`No existe: ${ruta}`);
    if (!/\.dxf$/i.test(ruta)) return fallo('Domoplano edita DXF (.dxf). Los DWG de terceros se convierten primero (F1).');
    if (a.en_app) {
      if (!(await canal.lanzar())) return fallo('No pude abrir Domoplano.app (¿está instalada en /Applications?).');
      const r = await canal.pedir({ op: 'abrir', ruta }); if (r.error) return fallo(r.error);
      const i = await canal.esperarPlano({ nombre: path.basename(ruta) }); if (i.error) return fallo(i.error);
      destino = 'app'; return ok({ ok: true, destino, ...i });
    }
    await plano.abrir({ ruta }); abiertoSinApp = true; destino = 'archivo';
    return ok({ ok: true, destino, ...(await DomoMCP.exec(plano.contexto(), 'info', {})) });
  });

tool('new_drawing', 'Plano nuevo. plantilla «epm» = plantilla EPM propia de Domoplano (NC-RA8-001: marco, rótulo con 17 campos, sello, convenciones, ventanas 1:500 y 1:1000; el modelo va en METROS); «blanco» = plano en mm con una plancha. Sin app queda en memoria hasta save_drawing (ruta opcional para recordarla).',
  { type: 'object', properties: { plantilla: { type: 'string', enum: ['epm', 'blanco'] }, template: { type: 'string', description: 'Alternativa: epm_1000x707, epm_A0, epm_A1, epm_A2 o blank' }, papel: { type: 'string', description: '1000x707 (EPM), A0, A1 o A2 (solo plantilla epm)' }, ruta: { type: 'string', description: 'Dónde se guardará (opcional)' }, en_app: { type: 'boolean' } } }, async (a) => {
    if (a.template) { const m = /^epm_?(.*)$/i.exec(a.template); a.plantilla = m ? 'epm' : 'blanco'; if (m && m[1]) a.papel = m[1]; }
    const epm = (a.plantilla || 'epm') === 'epm'; const hoja = a.papel || '1000x707';
    if (a.en_app) {
      if (!(await canal.lanzar())) return fallo('No pude abrir Domoplano.app.');
      const r = await canal.pedir({ op: 'nuevo', plantilla: epm ? 'epm' : 'blanco', hoja }); if (r.error) return fallo(r.error);
      const i = await canal.esperarPlano({}); if (i.error) return fallo(i.error);
      destino = 'app'; return ok({ ok: true, destino, ...i });
    }
    const texto = epm ? PlantillaEPM.generar({ hoja }) : Documento.nuevo();
    const ruta = a.ruta ? exp(a.ruta) : null;
    await plano.abrir({ texto, nombre: ruta ? path.basename(ruta) : (epm ? `Plano EPM ${hoja}.dxf` : 'Plano nuevo.dxf'), carpeta: ruta ? path.dirname(ruta) : null });
    plano.rutaPendiente = ruta; abiertoSinApp = true; destino = 'archivo';
    return ok({ ok: true, destino, ...(await DomoMCP.exec(plano.contexto(), 'info', {})) });
  });

tool('get_drawing_info', 'Datos del plano: archivo, versión, unidades, hojas (Modelo y planchas con su papel), capa y estilos actuales, cuántos objetos hay por tipo, si hay cambios sin guardar y qué se puede deshacer.', SOLO_DESTINO, async (a) => res(await puente('info', a)));

tool('query_entities', 'Lista objetos con su handle (para modificarlos después), tipo, capa y geometría (puntos, centro y radio, texto, bloque y atributos, medida de cotas, escala de ventanas). Filtros combinables.',
  { type: 'object', properties: { hoja: { type: 'string', description: '«Modelo», nombre de plancha o «todas». Por omisión la hoja actual.' }, tipo: { description: 'LINE, LWPOLYLINE, CIRCLE, ARC, TEXT, MTEXT, INSERT, HATCH, DIMENSION, LEADER, VIEWPORT, IMAGE… (uno o lista)', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, capa: { type: 'string' }, texto: { type: 'string', description: 'Expresión regular sobre el texto, los atributos o el nombre del bloque' }, handles: { type: 'array', items: { type: 'string' } }, dentro: { type: 'array', items: { type: 'number' }, description: '[x0, y0, x1, y1] (coordenadas de la hoja)' }, limite: { type: 'integer' }, destino: COMUNES.destino } },
  async (a) => res(await puente('consultar', a)));

tool('run_command', 'Línea de comandos de Domoplano (los mismos comandos y alias que escribe Sebastián: L, PL, C, A, REC, T, SB, COTALIN, EPM, REDEPM, TABLA, MV, VESCALA, ROTULO, CA, TL…). Cada elemento de «lineas» es lo que se escribe antes de Enter («» = Enter solo). Puntos como «x,y», «@dx,dy» o «@d<ángulo». Lo que pida clics (designar objetos) hágalo con las otras herramientas. Todo el guion = un paso de deshacer.',
  { type: 'object', properties: { lineas: { type: 'array', items: { type: 'string' } }, hoja: COMUNES.hoja, terminar: { type: 'boolean', description: 'Al final pulsar Enter/cancelar si el comando sigue esperando (por omisión sí)' }, destino: COMUNES.destino }, required: ['lineas'] },
  async (a) => res(await puente('comando', a)));

tool('draw_line', 'Líneas: puntos [[x,y], …] (cada tramo es una LÍNEA).', conComunes({ puntos: PUNTOS }, ['puntos']), dib('linea'));
tool('draw_polyline', 'Polilínea: puntos [[x,y], …], cerrada, ancho global; bulges = comba de cada tramo que sale del vértice (tan(ángulo/4); 1 = media circunferencia antihoraria, 0 = recto).', conComunes({ puntos: PUNTOS, cerrada: { type: 'boolean' }, ancho: { type: 'number' }, bulges: { type: 'array', items: { type: 'number' } } }, ['puntos']), dib('polilinea'));
tool('draw_rectangle', 'Rectángulo (polilínea cerrada) entre las esquinas a y b.', conComunes({ a: PUNTO, b: PUNTO }, ['a', 'b']), dib('rectangulo'));
tool('draw_circle', 'Círculo: centro y radio.', conComunes({ centro: PUNTO, radio: { type: 'number' } }, ['centro', 'radio']), dib('circulo'));
tool('draw_arc', 'Arco: centro, radio, ang_ini y ang_fin (grados, antihorario) o tres puntos [inicio, medio, fin].', conComunes({ centro: PUNTO, radio: { type: 'number' }, ang_ini: { type: 'number' }, ang_fin: { type: 'number' }, puntos: PUNTOS }), dib('arco'));
tool('draw_text', 'Texto de una línea. altura en unidades del dibujo (en planchas = mm de papel; en el Modelo EPM en metros: 2,5 mm a 1:500 = 1,25). justificacion: I, C, D, M, SI, SC, SD, MI, MC, MD, II, IC, ID.',
  conComunes({ punto: PUNTO, texto: { type: 'string' }, altura: { type: 'number' }, giro: { type: 'number' }, justificacion: { type: 'string' }, estilo: { type: 'string' } }, ['punto', 'texto']), dib('texto'));
tool('draw_mtext', 'Texto de párrafo (MTEXT): punto = esquina superior izquierda, ancho del cuadro (0 = sin límite); saltos de línea con \\n.',
  conComunes({ punto: PUNTO, texto: { type: 'string' }, altura: { type: 'number' }, ancho: { type: 'number' }, giro: { type: 'number' }, estilo: { type: 'string' } }, ['punto', 'texto']), dib('mtext'));
tool('draw_hatch', 'Sombreado: un punto interior (busca el contorno cerrado que lo rodea, con islas) o los handles de polilíneas cerradas/círculos. patrones propios: ver list_symbols (SOLIDO, DIAGONAL, …; también entiende ANSI31, AR-CONC, EARTH…).',
  conComunes({ punto: PUNTO, handles: { type: 'array', items: { type: 'string' } }, patron: { type: 'string' }, escala: { type: 'number' }, angulo: { type: 'number' } }), dib('sombreado'));
tool('draw_dimension', 'Cota. tipo_cota lineal (horizontal/vertical según la ubicación, o angulo 0/90), alineada {p1, p2, ubicacion}; angular {vertice, p1, p2, ubicacion}; radio/diametro {centro, radio, punto}. texto opcional («<>» = la medida).',
  conComunes({ tipo_cota: { type: 'string', enum: ['lineal', 'alineada', 'angular', 'radio', 'diametro'] }, p1: PUNTO, p2: PUNTO, ubicacion: PUNTO, vertice: PUNTO, centro: PUNTO, radio: { type: 'number' }, punto: PUNTO, angulo: { type: 'number' }, texto: { type: 'string' }, estilo: { type: 'string' } }, ['tipo_cota']), dib('cota'));
tool('insert_symbol', 'Inserta un símbolo EPM (NC-RA8-001 Anexo A) dibujado por Domoplano: nombre exacto (EPM_POSTE_CONCRETO_PR, EPM_TRAFO_3F_PR…) o parte única del nombre. escala por omisión automática (0,5 en el Modelo en metros = 1:500; 1 en planchas). valores = atributos en orden.',
  conComunes({ nombre: { type: 'string' }, punto: PUNTO, escala: { type: 'number' }, giro: { type: 'number' }, valores: { type: 'array', items: { type: 'string' } } }, ['nombre', 'punto']), dib('simbolo'));
tool('insert_block', 'Inserta un bloque que ya existe en el plano.', conComunes({ nombre: { type: 'string' }, punto: PUNTO, escala: { type: 'number' }, giro: { type: 'number' }, valores: { type: 'array', items: { type: 'string' } } }, ['nombre', 'punto']), dib('bloque'));
tool('draw_network', 'Red EPM con su convención (REDEPM) a lo largo de los puntos: tipo_red MT_DESNUDA, MT_CUBIERTO, MT_AISLADO, BT_TRENZADA, BT_ABIERTA, TRANSMISION, MT_SUBTERRANEO, BT_SUBTERRANEO; estado existente/proyectada.',
  conComunes({ puntos: PUNTOS, tipo_red: { type: 'string' }, estado: { type: 'string', enum: ['existente', 'proyectada'] }, escala: { type: 'number' } }, ['puntos', 'tipo_red']), dib('red'));
tool('draw_table', 'Tabla (líneas + textos) con la esquina superior izquierda en punto: filas = [[celda, …], …], titulo, anchos (número o lista por columna), alto_fila, altura del texto. El texto largo se parte en renglones.',
  conComunes({ punto: PUNTO, filas: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, titulo: { type: 'string' }, anchos: { anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] }, alto_fila: { type: 'number' }, altura: { type: 'number' } }, ['punto', 'filas']), dib('tabla'));
tool('draw_leader', 'Directriz con flecha: puntos (el primero es la punta) y texto.', conComunes({ puntos: PUNTOS, texto: { type: 'string' }, altura: { type: 'number' } }, ['puntos']), dib('directriz'));
tool('insert_image', 'Imagen PNG/JPG (p. ej. la firma) con la esquina inferior izquierda en punto y su ancho. El plano debe estar guardado: la ruta queda RELATIVA al DXF.',
  conComunes({ archivo: { type: 'string', description: 'Ruta de la imagen' }, punto: PUNTO, ancho: { type: 'number' }, giro: { type: 'number' } }, ['archivo', 'punto', 'ancho']), async (a) => {
    const f = exp(a.archivo); if (!fs.existsSync(f)) return fallo(`No existe la imagen: ${f}`);
    const t = Documento.tamanoImagen(new Uint8Array(fs.readFileSync(f))); if (!t) return fallo('La imagen debe ser PNG o JPG.');
    const x = await textoActual(a); if (x.error) return fallo(x.error);
    const dirDXF = x.destino === 'archivo' ? (plano.archivo ? path.dirname(plano.archivo) : null) : (x.archivo ? path.dirname(x.archivo) : null);
    if (!dirDXF) return fallo('Guarde primero el plano (save_drawing con ruta) para que la imagen quede con ruta relativa al DXF.');
    const rel = path.relative(dirDXF, f).split(path.sep).join('/');
    return res(await puente('dibujar', { ...a, tipo: 'imagen', archivo: rel, wpx: t.w, hpx: t.h }));
  });

tool('layers', 'Capas. accion: listar | crear | crear_o_cambiar | actual | cambiar | renombrar. Propiedades: color (1-255), tipolin, grosor (centésimas de mm), apagada, inutilizada, bloqueada, imprime; actual: true la deja como capa actual.',
  { type: 'object', properties: { accion: { type: 'string', enum: ['listar', 'crear', 'crear_o_cambiar', 'actual', 'cambiar', 'renombrar'] }, nombre: { type: 'string' }, nuevo_nombre: { type: 'string' }, color: { type: 'integer' }, tipolin: { type: 'string' }, grosor: { type: 'integer' }, apagada: { type: 'boolean' }, inutilizada: { type: 'boolean' }, bloqueada: { type: 'boolean' }, imprime: { type: 'boolean' }, actual: { type: 'boolean' }, destino: COMUNES.destino } },
  async (a) => res(await puente('capas', a)));

tool('set_properties', 'Cambia propiedades de objetos (por handle): capa, color, tipolin, grosor; texto (TEXT/MTEXT) y atributos {ETIQUETA: valor} de bloques.',
  { type: 'object', properties: { handles: { type: 'array', items: { type: 'string' } }, capa: { type: 'string' }, color: { type: 'integer' }, tipolin: { type: 'string' }, grosor: { type: 'integer' }, texto: { type: 'string' }, atributos: { type: 'object', additionalProperties: { type: 'string' } }, destino: COMUNES.destino }, required: ['handles'] },
  async (a) => res(await puente('propiedades', a)));

tool('modify_entities', 'Modifica objetos por handle. accion: mover {dx, dy} | copiar {dx, dy} | girar {base, angulo} | escalar {base, factor} | borrar | simetria {p1, p2, borrar_origen} | descomponer | propiedades {capa, color, tipolin, grosor}.',
  { type: 'object', properties: { accion: { type: 'string', enum: ['mover', 'copiar', 'girar', 'escalar', 'borrar', 'simetria', 'descomponer', 'propiedades'] }, capa: { type: 'string' }, color: { type: 'integer' }, tipolin: { type: 'string' }, grosor: { type: 'integer' }, handles: { type: 'array', items: { type: 'string' } }, dx: { type: 'number' }, dy: { type: 'number' }, base: PUNTO, angulo: { type: 'number' }, factor: { type: 'number' }, p1: PUNTO, p2: PUNTO, borrar_origen: { type: 'boolean' }, hoja: COMUNES.hoja, destino: COMUNES.destino }, required: ['accion', 'handles'] },
  async (a) => res(await puente('modificar', a)));

tool('layouts', 'Planchas (presentaciones). accion: listar | ir (cambia la hoja actual) | crear {nombre, papel} | copiar {origen, nombre} | renombrar {nombre, nuevo_nombre} | borrar {nombre} | hoja {nombre, papel, orientacion H/V}. papel: 1000x707, A0…A4, Carta, Oficio o «ancho x alto».',
  { type: 'object', properties: { accion: { type: 'string', enum: ['listar', 'ir', 'crear', 'copiar', 'renombrar', 'borrar', 'hoja'] }, nombre: { type: 'string' }, origen: { type: 'string' }, nuevo_nombre: { type: 'string' }, papel: { type: 'string' }, orientacion: { type: 'string', enum: ['H', 'V'] }, destino: COMUNES.destino } },
  async (a) => res(await puente('planchas', a)));

tool('add_viewport', 'Ventana en una plancha entre las esquinas a y b (mm de papel) que muestra el Modelo a escala 1:N (escala = N) centrada en «centro» (coordenadas del modelo). Sin escala: ajusta a lo dibujado.',
  { type: 'object', properties: { hoja: COMUNES.hoja, a: PUNTO, b: PUNTO, escala: { type: 'number' }, centro: PUNTO, destino: COMUNES.destino }, required: ['a', 'b'] },
  async (a) => res(await puente('ventana', a)));

tool('fill_title_block', 'Rótulo EPM: sin valores devuelve los campos; con valores {ETIQUETA: texto} los llena en todas las planchas (o en «donde»). «=» en PLANCHA, TOTAL o ESCALA = automático.',
  { type: 'object', properties: { valores: { type: 'object', additionalProperties: { type: 'string' } }, donde: { type: 'string' }, destino: COMUNES.destino } },
  async (a) => res(await puente('rotulo', a)));

tool('list_symbols', 'Símbolos EPM disponibles (nombre, descripción, existente/proyectado), tipos de red EPM y patrones de sombreado. buscar = filtra (poste, trafo, medidor…).',
  { type: 'object', properties: { buscar: { type: 'string' } } }, async (a) => ok(await DomoMCP.exec({ doc: () => null }, 'simbolos', a)));

tool('undo', 'Deshace (o rehace con rehacer: true) los últimos pasos. Cada herramienta de dibujo/modificación es UN paso.',
  { type: 'object', properties: { pasos: { type: 'integer' }, rehacer: { type: 'boolean' }, destino: COMUNES.destino } }, async (a) => res(await puente('deshacer', a)));

tool('save_drawing', 'Guarda el plano en DXF (misma versión y codificación del original; al sobrescribir deja «.bak» la primera vez). Sin app: ruta obligatoria salvo sobrescribir: true para el mismo archivo abierto. En la app: sin ruta guarda en su archivo. Guardar SOLO si Sebastián lo pidió o es un archivo de prueba de Claude.',
  { type: 'object', properties: { ruta: { type: 'string' }, ...ESCRITURA, destino: COMUNES.destino } }, async (a) => {
    const d = await elegir(a);
    const x = await textoActual(a); if (x.error) return fallo(x.error);
    const sobre = a.overwrite === true || a.sobrescribir === true;
    if (d === 'app') {
      const destinoApp = a.ruta ? exp(a.ruta) : x.archivo;
      if (destinoApp) { if (!/\.dxf$/i.test(destinoApp)) return fallo('Solo se guarda en DXF (.dxf).'); const pm = await permiso(destinoApp, a); if (pm.error) return fallo(pm.error); }
      const r = await canal.pedir({ op: 'guardar', texto: x.texto, codificacion: x.codificacion, ruta: a.ruta ? exp(a.ruta) : undefined }); return res(r);
    }
    let ruta = a.ruta ? exp(a.ruta) : null;
    if (!ruta && plano.archivo && sobre) ruta = plano.archivo;
    if (!ruta && plano.rutaPendiente) ruta = plano.rutaPendiente;
    if (!ruta) return fallo(plano.archivo ? 'Dé una ruta, o overwrite: true para guardar sobre el mismo archivo.' : 'Dé la ruta del .dxf.');
    if (!/\.dxf$/i.test(ruta)) return fallo('Solo se guarda en DXF (.dxf).');
    const pm = await permiso(ruta, a); if (pm.error) return fallo(pm.error);
    const w = motor.escribirDXF(ruta, x.texto, x.codificacion, respaldados);
    plano.archivo = ruta; plano.nombre = path.basename(ruta); plano.carpeta = path.dirname(ruta); plano.rutaPendiente = null; plano.marcarGuardado();
    return ok({ ok: true, ruta: w.ruta, kb: +(w.bytes / 1024).toFixed(1), nota: w.nota || undefined });
  });

tool('export_pdf', 'PDF vectorial con grosores por capa (mismo escritor de la app). Por omisión la plancha actual en mono (negro, para EPM); todas: true = todas las planchas en un PDF. Incluye lo no guardado.',
  { type: 'object', properties: { ruta: { type: 'string' }, plancha: { type: 'string' }, todas: { type: 'boolean' }, color: { type: 'string', enum: ['mono', 'grises', 'color'] }, ...ESCRITURA, destino: COMUNES.destino }, required: ['ruta'] }, async (a) => {
    const x = await textoActual(a); if (x.error) return fallo(x.error);
    const pm = await permiso(a.ruta, a); if (pm.error) return fallo(pm.error);
    const pl = a.plancha || (a.todas ? undefined : await planchaActual(a));
    try { return ok({ ok: true, ...(await motor.pdfDeTexto(x.texto, exp(a.ruta), { carpeta: x.carpeta, plancha: pl, todas: a.todas, color: a.color || 'mono' })) }); } catch (e) { return fallo('No se pudo exportar el PDF: ' + (e.message || e)); }
  });

tool('export_dwf', 'DWF clásico V06.00 para EPM (una plancha por archivo, mismo escritor de la app). Por omisión la plancha actual.',
  { type: 'object', properties: { ruta: { type: 'string' }, plancha: { type: 'string' }, ...ESCRITURA, destino: COMUNES.destino }, required: ['ruta'] }, async (a) => {
    const x = await textoActual(a); if (x.error) return fallo(x.error);
    const pm = await permiso(a.ruta, a); if (pm.error) return fallo(pm.error);
    const pl = a.plancha || await planchaActual(a);
    try { return ok({ ok: true, ...(await motor.dwfDeTexto(x.texto, exp(a.ruta), { carpeta: x.carpeta, plancha: pl })) }); } catch (e) { return fallo('No se pudo exportar el DWF: ' + (e.message || e)); }
  });

tool('verify', 'VERIFICAR: textos montados (texto-texto, texto-trazo, texto-relleno, borde), llamadas que cruzan y alturas < 2,0/2,5 mm, en la plancha indicada o la de más objetos.',
  { type: 'object', properties: { plancha: { type: 'string' }, ancho_extra: { type: 'number', description: '1.25 = cajas 25 % más anchas (más exigente)' }, destino: COMUNES.destino } }, async (a) => res(await puente('verificar', a)));

tool('screenshot', 'Imagen del plano. En la app: captura SOLO la ventana de Domoplano (no la pantalla). Sin app: la plancha (o «hoja») dibujada por el escritor PDF y pasada a PNG.',
  { type: 'object', properties: { hoja: { type: 'string', description: 'Solo sin app: plancha a mostrar (por omisión la actual)' }, ancho: { type: 'integer', description: 'Solo sin app: ancho en píxeles (1600)' }, destino: COMUNES.destino, ventana: { type: 'integer' } } }, async (a) => {
    const d = await elegir(a);
    if (d === 'app') { const r = await canal.pedir({ op: 'captura', ...(a.ventana != null ? { ventana: a.ventana } : {}) }); if (r.error) return fallo(r.error); return imagen(Buffer.from(r.png, 'base64'), `Ventana: ${r.titulo}`); }
    const x = await textoActual(a); if (x.error) return fallo(x.error);
    const pl = a.hoja || await planchaActual(a);
    try { return imagen(await motor.vistaPNG(x.texto, { carpeta: x.carpeta, plancha: pl, ancho: a.ancho || 1600 }), `Hoja: ${pl || '(primera plancha)'}`); } catch (e) { return fallo(e.message || String(e)); }
  });

tool('close_drawing', 'Cierra el plano sin app (con cambios sin guardar pide descartar: true). No cierra ventanas de la app.',
  { type: 'object', properties: { descartar: { type: 'boolean' } } }, async (a) => {
    if (!abiertoSinApp) return ok('No hay plano abierto sin app.');
    const i = await DomoMCP.exec(plano.contexto(), 'info', {});
    if (i.sin_guardar && !a.descartar) return fallo('Hay cambios sin guardar: save_drawing o close_drawing con descartar: true.');
    abiertoSinApp = false; if (destino === 'archivo') destino = null; plano.doc = null;
    return ok({ ok: true, cerrado: i.nombre });
  });


// ---------------------------------------------------------------- catálogo de la ESPECIFICACIÓN H6-C (Antigravity, 29-10-2026)
// Nombres que pide la especificación: unos son alias de las herramientas de arriba y otros son herramientas nuevas.
const alias = (nuevo, de, nota) => { const t = H.find((x) => x.name === de); tool(nuevo, `${nota ? nota + ' ' : ''}(Igual que ${de}.) ${t.description}`, t.inputSchema, t.run); };
alias('domoplano_status', 'status');
alias('list_entities', 'query_entities');
alias('add_text', 'draw_text');
alias('add_dimension', 'draw_dimension');
alias('insert_epm_symbol', 'insert_symbol');
alias('draw_epm_network', 'draw_network');
alias('add_leader', 'draw_leader');
alias('add_table', 'draw_table');
alias('manage_layout', 'layouts');
alias('update_epm_titleblock', 'fill_title_block');
alias('verify_epm_plan', 'verify');
alias('run_script', 'run_command');
tool('list_layers', 'Lista las capas con color, tipo de línea, grosor, estado y cuál es la actual.', SOLO_DESTINO, async (a) => res(await puente('capas', { ...a, accion: 'listar' })));
tool('create_layer', 'Crea una capa (o la cambia si ya existe): color 1-255, tipolin, grosor (centésimas de mm), imprime; actual: true la deja como actual.',
  { type: 'object', properties: { nombre: { type: 'string' }, color: { type: 'integer' }, tipolin: { type: 'string' }, grosor: { type: 'integer' }, imprime: { type: 'boolean' }, actual: { type: 'boolean' }, destino: COMUNES.destino }, required: ['nombre'] },
  async (a) => res(await puente('capas', { ...a, accion: 'crear_o_cambiar' })));
tool('set_current_layer', 'Cambia la capa actual.', { type: 'object', properties: { nombre: { type: 'string' }, destino: COMUNES.destino }, required: ['nombre'] }, async (a) => res(await puente('capas', { ...a, accion: 'actual' })));
tool('zoom_extents', 'ZOOM Extensión en la ventana de Domoplano (ver todo lo dibujado). Sin app no hace falta (la vista se arma completa).', SOLO_DESTINO, async (a) => {
  if ((await elegir(a)) !== 'app') return ok({ ok: true, nota: 'Sin app no hay vista que mover: screenshot siempre muestra la hoja completa.' });
  return res(await puente('comando', { ...a, lineas: ['ZE'] }));
});
tool('manage_viewport', 'Ventanas de una plancha. accion crear {hoja, a, b, escala, centro} | escala {handle, escala N de 1:N} | bloquear / desbloquear {handle} | inutilizar_capas / reutilizar_capas {handle, capas: [nombres o comodines]} (VPLAYER) | girar {handle, angulo} | centrar {handle, centro, alto}. Los handles salen de query_entities tipo VIEWPORT.',
  { type: 'object', properties: { accion: { type: 'string', enum: ['crear', 'escala', 'bloquear', 'desbloquear', 'inutilizar_capas', 'reutilizar_capas', 'girar', 'centrar'] }, handle: { type: 'string' }, hoja: COMUNES.hoja, a: PUNTO, b: PUNTO, escala: { type: 'number' }, centro: PUNTO, alto: { type: 'number' }, capas: { type: 'array', items: { type: 'string' } }, angulo: { type: 'number' }, destino: COMUNES.destino }, required: ['accion'] },
  async (a) => res(await puente(a.accion === 'crear' ? 'ventana' : 'gestionar_ventana', a)));
tool('extract_quantities', 'Cantidades del plano: cuántos bloques hay de cada uno (postes, transformadores, luminarias…) y longitud dibujada por capa (líneas, polilíneas y arcos), total y por hoja.',
  { type: 'object', properties: { hoja: { type: 'string', description: '«Modelo», una plancha o «todas» (por omisión el Modelo)' }, capas: { type: 'string', description: 'Solo estas capas, separadas por coma, con comodín * (ej. «RED*,POSTES»)' }, zona: { type: 'array', items: { type: 'number' }, description: 'Solo lo que cae en [x0, y0, x1, y1]' }, todo: { type: 'boolean', description: 'true = sin filtro: Modelo y planchas, con convenciones, marco y rótulo' }, destino: COMUNES.destino } }, async (a) => res(await puente('cantidades', a)));
tool('edit_p2', 'Edición e inspección P2 (como LISTA, AREA, UNIR, PARTIR, EDITPOL, SUPRIMEDUPL, COBERTURA, SELECSIMILAR, SELECRAPIDA, pinzamientos, COPIAPORTA/PEGAPORTA y MAPAOSM). accion lista {handles} | area {handles o puntos} | seleccion_similar {handles} | seleccion_rapida {propiedad: tipo|capa|color|bloque|tipolin|estilo|texto, valor (* ? comodines, <>valor = distinto), handles?} | unir {handles} | partir {handle, p1, p2?} | editpol {handle, opcion: convertir|cerrar|abrir|grosor|invertir|decurvar, grosor} | suprimir_duplicados {handles? (si no, toda la hoja), tolerancia} | cobertura {puntos} o {handles de textos, margen} | pinzamiento {handle, indice, punto} (sin punto lista los pinzamientos) | copiar {handles, base} | pegar {punto? (sin punto = mismas coordenadas)} | mapa_osm {archivo .osm/.json o lat, lon, radio; punto = dónde cae el origen; altura_texto}. Cada edición = un paso de deshacer.',
  { type: 'object', properties: { accion: { type: 'string', enum: ['lista', 'area', 'seleccion_similar', 'seleccion_rapida', 'unir', 'partir', 'editpol', 'suprimir_duplicados', 'cobertura', 'pinzamiento', 'copiar', 'pegar', 'mapa_osm'] }, handles: { type: 'array', items: { type: 'string' } }, handle: { type: 'string' }, puntos: { type: 'array', items: PUNTO }, p1: PUNTO, p2: PUNTO, punto: PUNTO, base: PUNTO, opcion: { type: 'string' }, grosor: { type: 'number' }, propiedad: { type: 'string' }, valor: { type: 'string' }, indice: { type: 'integer' }, margen: { type: 'number' }, tolerancia: { type: 'number' }, capa: { type: 'string' }, archivo: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, radio: { type: 'number' }, altura_texto: { type: 'number' }, hoja: COMUNES.hoja, destino: COMUNES.destino }, required: ['accion'] },
  async (a) => res(await puente('p2', a.archivo ? { ...a, archivo: exp(a.archivo) } : a)));
tool('batch_operations', 'Lote: muchas órdenes de dibujo/edición en UNA llamada y UN solo paso de deshacer (si una falla no se hace nada). ordenes = [{op, args}] con op = draw_line, draw_polyline, draw_rectangle, draw_circle, draw_arc, draw_text, draw_mtext, draw_hatch, draw_dimension, insert_symbol, insert_block, draw_network, draw_table, draw_leader (o sus alias add_* / insert_epm_symbol / draw_epm_network), y también dibujar, propiedades, modificar, capas, ventana, gestionar_ventana, rotulo, planchas con los argumentos de esas herramientas.',
  { type: 'object', properties: { ordenes: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' }, args: { type: 'object' } }, required: ['op'] } }, destino: COMUNES.destino }, required: ['ordenes'] },
  async (a) => res(await puente('lote', a)));
tool('export_dxf', 'Guarda una COPIA del plano en otro DXF (no cambia el archivo con el que se trabaja ni marca como guardado). No reemplaza un archivo existente sin sobrescribir: true.',
  { type: 'object', properties: { ruta: { type: 'string' }, ...ESCRITURA, destino: COMUNES.destino }, required: ['ruta'] }, async (a) => {
    const ruta = exp(a.ruta); if (!/\.dxf$/i.test(ruta)) return fallo('La copia debe ser .dxf.');
    const pm = await permiso(ruta, a); if (pm.error) return fallo(pm.error);
    const x = await textoActual(a); if (x.error) return fallo(x.error);
    const w = motor.escribirDXF(ruta, x.texto, x.codificacion, respaldados);
    return ok({ ok: true, copia: w.ruta, kb: +(w.bytes / 1024).toFixed(1), nota: w.nota || undefined });
  });
tool('run_script_on_file', 'Guion de la línea de comandos sobre un DXF SIN abrir la app: abre el archivo en el motor, ejecuta las líneas y, si se da guardar_en, guarda el resultado ahí (el original no se toca salvo sobrescribir: true con guardar_en igual a la ruta). Queda como plano actual sin app.',
  { type: 'object', properties: { ruta: { type: 'string' }, lineas: { type: 'array', items: { type: 'string' } }, hoja: COMUNES.hoja, guardar_en: { type: 'string' }, ...ESCRITURA }, required: ['ruta', 'lineas'] }, async (a) => {
    const ruta = exp(a.ruta); if (!fs.existsSync(ruta)) return fallo(`No existe: ${ruta}`);
    if (abiertoSinApp) { const i = await DomoMCP.exec(plano.contexto(), 'info', {}); if (i.sin_guardar) return fallo(`El plano sin app «${i.nombre}» tiene cambios sin guardar: guárdelo o close_drawing con descartar: true.`); }
    await plano.abrir({ ruta }); abiertoSinApp = true; destino = 'archivo';
    const r = await DomoMCP.exec(plano.contexto(), 'comando', { lineas: a.lineas, hoja: a.hoja }); if (r.error) return fallo(r.error);
    let guardado = null;
    if (a.guardar_en) {
      const out = exp(a.guardar_en);
      const pm = await permiso(out, a, [path.dirname(ruta)]); if (pm.error) return fallo(`El guion corrió, pero no se guardó: ${pm.error} (el plano sigue abierto sin app).`);
      const x = await DomoMCP.exec(plano.contexto(), 'serializar', {});
      guardado = motor.escribirDXF(out, x.texto, x.codificacion, respaldados);
      plano.archivo = out; plano.nombre = path.basename(out); plano.carpeta = path.dirname(out); plano.marcarGuardado();
    }
    return ok({ ok: true, ...r, guardado: guardado ? guardado.ruta : null });
  });
tool('read_dwf_markups', 'Lee un DWF devuelto por EPM (V06.20 con marcas de Design Review) y devuelve sus observaciones: número, tipo (llamada, texto, nube, sello…), texto y ubicación en mm de papel. Solo lee el archivo.',
  { type: 'object', properties: { ruta: { type: 'string' } }, required: ['ruta'] }, async (a) => {
    const ruta = exp(a.ruta); if (!fs.existsSync(ruta)) return fallo(`No existe: ${ruta}`);
    try { return ok(await motor.marcasDWF(ruta)); } catch (e) { return fallo('No se pudo leer el DWF: ' + (e.message || e)); }
  });

// ---------------------------------------------------------------- H6-E: COMPARAR versiones y CHECKEPM (lista NC-RA8-001)
const Comparador = require('../web/comparador.js');
const ChecklistEPM = require('../web/checklist_epm.js');
/** Resultado sin la geometría (para devolverlo como texto) y con la lista recortada. */
const sinGeo = (r, max) => ({ ...r, items: r.items.slice(0, max).map(({ geo, geoA, ...x }) => x), items_total: r.items.length, informe: undefined });
async function mostrarEnApp(a, tipo, r) {
  if (!a.resaltar) return null;
  if ((await elegir(a)) !== 'app') return 'resaltar: solo en la app (abra el plano con en_app: true).';
  const x = await puente('h6e_mostrar', { tipo, resultado: r, destino: 'app', ventana: a.ventana }); return x && x.error ? x.error : 'resaltado en la ventana de Domoplano';
}
tool('compare', 'COMPARAR dos versiones de un plano (como DWGCOMPARE): lo NUEVO, lo BORRADO y lo CAMBIADO (capa/color, texto, atributos, movido), capas, bloques, planchas y textos editados, con «dónde» (x, y). DXF con DXF; DWF con DWF (hoja por hoja) + las MARCAS de revisión que trae el DWF nuevo (observaciones de EPM). anterior = ruta de la versión vieja (la radicada); nueva = ruta (por omisión el plano abierto). informe_md = guardar el informe en Markdown. resaltar: true = pinta los colores y la lista en la ventana de la app. Solo lee los planos.',
  { type: 'object', properties: { anterior: { type: 'string' }, nueva: { type: 'string', description: 'Ruta de la versión nueva. Por omisión, el plano abierto (sin app o en la app).' }, informe_md: { type: 'string' }, max_items: { type: 'integer', description: 'Cuántas diferencias devolver en la lista (200)' }, resaltar: { type: 'boolean' }, ...ESCRITURA, destino: COMUNES.destino, ventana: { type: 'integer' } }, required: ['anterior'] }, async (a) => {
    const ra = exp(a.anterior); if (!fs.existsSync(ra)) return fallo(`No existe: ${ra}`);
    const esDWF = (f) => /\.dwfx?$/i.test(f);
    try {
      let r;
      if (a.nueva) {
        const rb = exp(a.nueva); if (!fs.existsSync(rb)) return fallo(`No existe: ${rb}`);
        if (esDWF(ra) !== esDWF(rb)) return fallo('Compare DXF con DXF o DWF con DWF (para ver las marcas de un DWF sobre un DXF, abra el DXF en la app y use resaltar con el DWF como anterior).');
        r = esDWF(ra) ? await Comparador.compararDWF(new Uint8Array(fs.readFileSync(ra)), new Uint8Array(fs.readFileSync(rb)), { nombreA: path.basename(ra), nombreB: path.basename(rb) })
          : Comparador.compararDXF(new Uint8Array(fs.readFileSync(ra)), new Uint8Array(fs.readFileSync(rb)), { nombreA: path.basename(ra), nombreB: path.basename(rb) });
      } else {
        const x = await textoActual(a); if (x.error) return fallo(x.error);
        if (esDWF(ra)) {
          const pl = await planchaActual(a);
          const w = await DWFWriter.fromDXF(new TextEncoder().encode(x.texto), { plancha: pl, resolveURL: (f) => path.resolve(x.carpeta, String(f).replace(/\\/g, '/')), loadBytes: async (s) => new Uint8Array(fs.readFileSync(s)), title: x.nombre, sourceName: x.nombre });
          r = await Comparador.compararDWF(new Uint8Array(fs.readFileSync(ra)), w.bytes, { nombreA: path.basename(ra), nombreB: x.nombre + ' (abierto, pasado a DWF)' });
        } else r = Comparador.compararDXF(new Uint8Array(fs.readFileSync(ra)), x.texto, { nombreA: path.basename(ra), nombreB: x.nombre + ' (abierto)' });
      }
      let md = null; if (a.informe_md) { const pm = await permiso(a.informe_md, a, [path.dirname(ra), ...(a.nueva ? [path.dirname(exp(a.nueva))] : [])]); if (pm.error) return fallo(pm.error); md = pm.ruta; fs.mkdirSync(path.dirname(md), { recursive: true }); fs.writeFileSync(md, Comparador.informeMD(r)); }
      const vista = !a.nueva && r.tipo === 'DXF' ? await mostrarEnApp(a, 'comparar', r) : (a.resaltar ? 'resaltar: solo cuando la versión nueva es el DXF abierto.' : null);
      return ok({ ok: true, ...sinGeo(r, a.max_items || 200), informe_md: md, resaltado: vista });
    } catch (e) { return fallo('No se pudo comparar: ' + (e.message || e)); }
  });
tool('checklist_epm', 'CHECKEPM: lista de chequeo NC-RA8-001 automática sobre una plancha: rótulo completo (a–l, máx. 160 × 100, firma escaneada), sello 160 × 70 encima del rótulo, símbolo de proyección, escala en cada dibujo y ventanas normalizadas, norte, convenciones, notas, cuadro de cargas (6.2.3.7 + distancia, patrón Praga), textos ≥ 2,5 mm en notas y convenciones, 0 textos montados, capas, DWF < 1 MB y sin raster salvo la firma. Devuelve ✅/❌/⚠️ con «dónde». ruta = un DXF (por omisión el plano abierto). informe_md / informe_pdf = guardar el informe. resaltar: true = lista y marcas en la ventana de la app. Solo lee el plano.',
  { type: 'object', properties: { ruta: { type: 'string' }, plancha: { type: 'string' }, informe_md: { type: 'string' }, informe_pdf: { type: 'string' }, resaltar: { type: 'boolean' }, ...ESCRITURA, destino: COMUNES.destino, ventana: { type: 'integer' } } }, async (a) => {
    try {
      let texto, carpeta, nombre;
      if (a.ruta) { const r0 = exp(a.ruta); if (!fs.existsSync(r0)) return fallo(`No existe: ${r0}`); texto = fs.readFileSync(r0); carpeta = path.dirname(r0); nombre = path.basename(r0); }
      else { const x = await textoActual(a); if (x.error) return fallo(x.error); texto = x.texto; carpeta = x.carpeta; nombre = x.nombre; }
      const u8 = typeof texto === 'string' ? new TextEncoder().encode(texto) : new Uint8Array(texto);
      const plancha = a.plancha || (a.ruta ? undefined : await planchaActual(a));
      const r = await ChecklistEPM.revisar(u8, { presentacion: plancha, nombre,
        medirDWF: async (pl) => (await DWFWriter.fromDXF(u8, { plancha: pl, resolveURL: (f) => path.resolve(carpeta, String(f).replace(/\\/g, '/')), loadBytes: async (s) => new Uint8Array(fs.readFileSync(s)), title: nombre, sourceName: nombre })).bytes.length });
      let md = null, pdf = null;
      const extra = a.ruta ? [path.dirname(exp(a.ruta))] : [];
      for (const f of [a.informe_md, a.informe_pdf]) if (f) { const pm = await permiso(f, a, extra); if (pm.error) return fallo(pm.error); }
      if (a.informe_md) { md = exp(a.informe_md); fs.mkdirSync(path.dirname(md), { recursive: true }); fs.writeFileSync(md, ChecklistEPM.md(r)); }
      if (a.informe_pdf) { pdf = (await motor.pdfDeTexto(ChecklistEPM.dxfInforme(r), exp(a.informe_pdf), { carpeta, plancha: 'INFORME CHECKEPM', color: 'color', titulo: 'Checklist RA8-001 - ' + nombre })).salida; }
      const vista = a.ruta ? (a.resaltar ? 'resaltar: solo sobre el plano abierto (sin ruta).' : null) : await mostrarEnApp(a, 'checklist', r);
      return ok({ ok: true, cumple: r.cumple, plancha: r.plancha, resumen: r.resumen, items: r.items, informe: r.informe, informe_md: md, informe_pdf: pdf, resaltado: vista });
    } catch (e) { return fallo('No se pudo revisar: ' + (e.message || e)); }
  });
tool('checkepm', 'Alias de checklist_epm (CHECKEPM).', { type: 'object', properties: { ruta: { type: 'string' }, plancha: { type: 'string' }, informe_md: { type: 'string' }, informe_pdf: { type: 'string' }, resaltar: { type: 'boolean' }, ...ESCRITURA, destino: COMUNES.destino } }, async (a) => H.find((t) => t.name === 'checklist_epm').run(a));
tool('compare_drawings', 'Alias de compare (COMPARAR).', { type: 'object', properties: { anterior: { type: 'string' }, nueva: { type: 'string' }, informe_md: { type: 'string' }, max_items: { type: 'integer' }, resaltar: { type: 'boolean' }, ...ESCRITURA, destino: COMUNES.destino }, required: ['anterior'] }, async (a) => H.find((t) => t.name === 'compare').run(a));

/** Plancha actual (para exportar): la hoja actual si es una plancha; si es el Modelo, la primera plancha con dibujo. */
async function planchaActual(a) {
  const i = await puente('info', a); if (i.error) return undefined;
  const h = String(i.hoja_actual || '').replace(/ \(dentro de la ventana: Modelo\)$/, '');
  if (h && h !== 'Modelo') return h;
  const p = (i.hojas || []).find((x) => x.nombre !== 'Modelo' && x.objetos > 0); return p ? p.nombre : undefined;
}

// ---------------------------------------------------------------- protocolo MCP (stdio, una línea JSON por mensaje)
const INSTRUCCIONES = 'Domoplano es el CAD propio de DOMOTEX (reemplaza AutoCAD). Este servidor trabaja POR DENTRO: no usa teclado, ratón ni ventanas de Sebastián. ' +
  'Dos destinos: «archivo» (un DXF en el motor de Domoplano sin abrir la app) y «app» (la ventana de Domoplano que Claude abrió o la activa). Empiece con status. ' +
  'Nunca dibuje sobre un plano de un cliente sin que Sebastián lo pida: para pruebas use copias o new_drawing. Guarde solo si lo pidió (save_drawing deja .bak al sobrescribir). ' +
  'Escrituras: solo en la carpeta del plano abierto y en las carpetas permitidas (status las lista); nunca reemplaza un archivo sin overwrite: true; nunca Escritorio/Descargas sin permitir_escritorio_descargas (solo si Sebastián lo pidió). ' +
  'Cada herramienta que cambia el dibujo = un paso de deshacer (undo o ⌘Z). Los handles de query_entities sirven para set_properties y modify_entities. ' +
  'Plantilla EPM: el Modelo va en METROS (símbolos a 0,5 = 1:500) y las planchas en mm de papel. Revise con verify y screenshot antes de exportar.';

function enviar(m) { process.stdout.write(JSON.stringify(m) + '\n'); }
async function atender(m) {
  const { id, method, params } = m;
  const responde = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      const pv = params && PROTOCOLOS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLOS[0];
      return enviar({ jsonrpc: '2.0', id, result: { protocolVersion: pv, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'domoplano', title: 'Domoplano (CAD de DOMOTEX)', version: VERSION }, instructions: INSTRUCCIONES } });
    }
    if (method === 'ping') return responde && enviar({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return enviar({ jsonrpc: '2.0', id, result: { tools: H.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    if (method === 'tools/call') {
      const t = H.find((x) => x.name === (params && params.name));
      if (!t) return enviar({ jsonrpc: '2.0', id, error: { code: -32602, message: `Herramienta desconocida: ${params && params.name}` } });
      let r; try { r = await t.run((params && params.arguments) || {}); } catch (e) { r = fallo('Error: ' + (e && e.stack || e)); }
      return enviar({ jsonrpc: '2.0', id, result: r });
    }
    if (method && method.startsWith('notifications/')) return; // initialized, cancelled…
    if (responde) enviar({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  } catch (e) {
    if (responde) enviar({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e && e.message || e) } });
  }
}

// las llamadas se atienden en orden (el dibujo es uno solo)
let cola = Promise.resolve();
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const linea = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!linea) continue;
    let m; try { m = JSON.parse(linea); } catch (e) { enviar({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); continue; }
    const msgs = Array.isArray(m) ? m : [m];
    for (const x of msgs) cola = cola.then(() => atender(x));
  }
});
process.stdin.on('end', () => cola.then(() => process.exit(0)));
