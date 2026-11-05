// Pruebas del Validador Integral NC-RA8-001 (cli/validar_epm.js, mejoras de web/verificador.js, web/checklist_epm.js y web/cad.js).
// Verifica:
//  1) HATCH con aristas SPLINE (código 72 = 4) en bloques de F123/F124/F125 ya no rompe Verificador.verificar.
//  2) Medición de colisiones en MTEXT (multilínea con \P, códigos \f/\H/\A y ancho de columna) sin falsos choques entre sus propios renglones.
//  3) Medición de colisiones en atributos ATTRIB y textos fijos del bloque EPM_ROTULO cuando un campo se desborda.
//  4) Autodetección de plancha en ChecklistEPM: cuando Presentación1 solo tiene 1 ventana y todo el plano está en el Modelo (F123/F124/F125), revisa el Modelo y detecta rótulo, norte, convenciones y cuadro.
//  5) Aviso automático pre-vuelo en EXPORTARDWF y EXPORTARPDF cuando el plano tiene fallas en CHECKEPM.
//  6) CLI unificado cli/validar_epm.js sobre .dxf y .dwg (con LibreDWG), --todas, --comparar (.dxf y .dwf con marcas de EPM), --md, --pdf y --json.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const motor = require('../mcp/motor.js');
const Verificador = require('../web/verificador.js');
const ChecklistEPM = require('../web/checklist_epm.js');
const PlantillaEPM = require('../web/plantilla_epm.js');
const { validarArchivo } = require('../cli/validar_epm.js');

const DAT = path.join(__dirname, 'datos');
const SAL = path.join(__dirname, 'salida', 'val');
fs.rmSync(SAL, { recursive: true, force: true });
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => {
  if (cond) ok++;
  else {
    bad++;
    console.log('FALLA', name, info === undefined ? '' : (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 600));
  }
};

(async () => {
  // ---------------------------------------------------------------- 1) HATCH con SPLINE en F125.dxf (antes lanzaba TypeError en caminosHatch)
  {
    const f125 = fs.readFileSync(path.join(DAT, 'F125.dxf'), 'utf8');
    const v = await Verificador.verificar(f125, { presentacion: 'Model', nombre: 'F125.dxf', sinBordeEnModelo: true });
    check('1.1 F125.dxf en Model corre sin excepción (HATCH con spline)', v && v.textos > 600 && v.avisos.filter((a) => /MTEXT no medido/.test(a)).length === 0, v && { textos: v.textos, avisos: v.avisos });
    const k = await ChecklistEPM.revisar(f125, { nombre: 'F125.dxf' });
    check('1.2 ChecklistEPM autodectecta Modelo en F125 (Presentación1 solo tiene 11 entidades)', k.plancha === 'Modelo', k.plancha);
    const mItem = k.items.find((i) => i.id === 'montajes');
    check('1.3 ChecklistEPM punto 10 (montajes) ya no sale en aviso por caída de HATCH', mItem && mItem.estado !== 'aviso' && !/Cannot read properties/.test(mItem.detalle), mItem);
    const nItem = k.items.find((i) => i.id === 'norte');
    const cItem = k.items.find((i) => i.id === 'convenciones');
    check('1.4 En F125 Modelo encuentra norte y convenciones', nItem && nItem.estado === 'ok' && cItem && cItem.estado === 'ok', [nItem, cItem]);
  }

  // ---------------------------------------------------------------- 2) MTEXT: mide colisiones reales sin chocar consigo mismo entre renglones
  {
    const p = new motor.PlanoSinApp();
    await p.abrir({ texto: global.Documento.nuevo() });
    await p.irA('Plancha 1');
    await global.DomoMCP.exec(p.contexto(), 'dibujar', { tipo: 'mtext', hoja: 'Plancha 1', punto: [50, 200], altura: 3.0, ancho: 60, texto: 'RENGLON UNO\nRENGLON DOS\nRENGLON TRES' });
    const limpioDXF = (await global.DomoMCP.exec(p.contexto(), 'serializar', {})).texto;
    const vLimpio = await Verificador.verificar(limpioDXF, { presentacion: 'Plancha 1' });
    check('2.1 MTEXT de 3 renglones se mide como 3 textos y 0 avisos de MTEXT no medido', vLimpio.textos === 3 && vLimpio.avisos.length === 0, vLimpio);
    check('2.2 Los renglones de un mismo MTEXT no se marcan como TEXTO-TEXTO entre sí', vLimpio.colisiones.length === 0, vLimpio.colisiones);

    // Ahora cruzamos una línea por encima del segundo renglón del MTEXT y ponemos otro TEXTO encima del primero
    await global.DomoMCP.exec(p.contexto(), 'dibujar', { tipo: 'linea', hoja: 'Plancha 1', puntos: [[45, 193], [95, 193]] });
    await global.DomoMCP.exec(p.contexto(), 'dibujar', { tipo: 'texto', hoja: 'Plancha 1', punto: [55, 197.5], altura: 3.0, texto: 'ENCIMA' });
    const chocadoDXF = (await global.DomoMCP.exec(p.contexto(), 'serializar', {})).texto;
    const vChocado = await Verificador.verificar(chocadoDXF, { presentacion: 'Plancha 1' });
    check('2.3 MTEXT detecta TEXTO-TEXTO contra otro texto superpuesto', vChocado.colisiones.some((c) => c[0] === 'TEXTO-TEXTO' && (c[1] === 'RENGLON UNO' || c[2] === 'RENGLON UNO')), vChocado.colisiones);
    check('2.4 MTEXT detecta TEXTO-TRAZO cuando una línea lo atraviesa', vChocado.colisiones.some((c) => c[0] === 'TEXTO-TRAZO' && /RENGLON/.test(c[1])), vChocado.colisiones);
  }

  // ---------------------------------------------------------------- 3) EPM_ROTULO: atributos (ATTRIB) y etiquetas fijas detectan desbordes
  {
    const sano = PlantillaEPM.generar({ hoja: '1000x707', datos: { proyecto: 'PROYECTO NORMAL', direccion: 'CL 28 # 34-151', municipio: 'MARINILLA', consecutivo: '0000002QYC', contrato: '12386594', fecha: '30/10/2026', matricula: 'AN205-12345' } });
    const vSano = await Verificador.verificar(sano, { nombre: 'sano.dxf' });
    check('3.1 Plantilla EPM con datos normales en EPM_ROTULO tiene 0 colisiones (incluyendo los 17 ATTRIBs y textos del rótulo)', vSano.colisiones.length === 0 && vSano.textos > 60, { textos: vSano.textos, col: vSano.colisiones });

    const desborde = PlantillaEPM.generar({ hoja: '1000x707', datos: { consecutivo: 'CONSECUTIVO EXTREMADAMENTE LARGO QUE INVADE LA CASILLA VECINA DE CONTRATO' } });
    const vDesborde = await Verificador.verificar(desborde, { nombre: 'desborde.dxf' });
    check('3.2 Atributo desbordado en EPM_ROTULO detecta TEXTO-TRAZO y TEXTO-TEXTO', vDesborde.colisiones.some((c) => c[0] === 'TEXTO-TRAZO' && /CONSECUTIVO EXTREMADAMENTE/.test(c[1])) && vDesborde.colisiones.some((c) => c[0] === 'TEXTO-TEXTO' && /CONSECUTIVO EXTREMADAMENTE/.test(c[1])), vDesborde.colisiones);
  }

  // ---------------------------------------------------------------- 4) Aviso pre-vuelo en EXPORTARDWF y EXPORTARPDF (web/cad.js)
  {
    global.ChecklistEPM = ChecklistEPM;
    const plano = new motor.PlanoSinApp();
    const msgs = [];
    await plano.abrir({ texto: PlantillaEPM.generar({ hoja: '1000x707' }) });
    global.CAD.oyente = (t) => msgs.push(t);
    await plano.irA('PLANO 01 DE 01');
    // Ejecutamos EXPORTARDWF en el motor y comprobamos que avisa de los puntos pendientes de CHECKEPM
    global.CAD.input('EXPORTARDWF');
    await new Promise((r) => setTimeout(r, 400));
    const logDwf = msgs.join('\n');
    check('4.1 EXPORTARDWF emite aviso pre-vuelo de CHECKEPM cuando el plano tiene campos sin llenar', /⚠️ CHECKEPM \(PLANO 01 DE 01\): \d+ punto\(s\) con falla/.test(logDwf), logDwf);
  }

  // ---------------------------------------------------------------- 5) CLI unificado cli/validar_epm.js (DXF, DWG, --todas, --comparar, --md, --pdf, --json)
  {
    const mdOut = path.join(SAL, 'informe_tdc.md');
    const pdfOut = path.join(SAL, 'informe_tdc.pdf');
    const r = await validarArchivo(path.join(DAT, 'TDC_v3.dxf'), {
      comparar: path.join(DAT, 'epm_respuesta_con_marcas.dwf'),
      md: mdOut,
      pdf: pdfOut,
    });
    check('5.1 validarArchivo TDC_v3.dxf + DWF EPM devuelve revision, planchas y comparacion con marcas', r && r.planchas.length === 1 && r.comparacion && r.comparacion.resumen.marcas >= 6, r && r.comparacion && r.comparacion.resumen);
    check('5.2 validarArchivo genera informe Markdown y PDF válidos', fs.existsSync(mdOut) && fs.existsSync(pdfOut) && fs.statSync(pdfOut).size > 5000, [fs.existsSync(mdOut), fs.existsSync(pdfOut)]);

    // Sobre un archivo .dwg directo (F123.dwg)
    const rDwg = await validarArchivo(path.join(DAT, 'dwg', 'F123.dwg'));
    check('5.3 validarArchivo abre directamente un .dwg con LibreDWG y lo valida sin tocar el original', rDwg && rDwg.dwg && rDwg.dwg.version.codigo === 'AC1032' && rDwg.planchas[0].plancha === 'Modelo', rDwg && rDwg.dwg);

    // Sobre DR6.dxf con --todas (revisa las 3 planchas)
    const rDr6 = await validarArchivo(path.join(DAT, 'DR6.dxf'), { todas: true });
    check('5.4 validarArchivo --todas en DR6.dxf revisa PLANCHA 1, PLANCHA 2 y PLANCHA 3', rDr6.planchas.map((p) => p.plancha).join(',') === 'PLANCHA 1,PLANCHA 2,PLANCHA 3', rDr6.planchas.map((p) => p.plancha));

    // Ejecución por CLI con --json y --estricto
    const cli = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'cli', 'validar_epm.js'), path.join(DAT, 'TDC_v3.dxf'), '--json', '--estricto'], { encoding: 'utf8' });
    const j = JSON.parse(cli.stdout);
    check('5.5 cli/validar_epm.js --json --estricto devuelve JSON válido y código de salida 1 cuando hay fallas', cli.status === 1 && j.archivo === 'TDC_v3.dxf' && j.cumple === false && j.planchas[0].items.length === 15, { status: cli.status, cumple: j.cumple });
  }

  console.log(`valtest: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
