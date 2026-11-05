// Pruebas de la biblioteca de símbolos EPM, la plantilla EPM propia y el verificador de textos montados.
// Uso: node tests/epmtest.js
// 1) Genera biblioteca y plantillas en tests/salida/epm/ y las abre con el lector de Domoplano (web/dxf.js).
// 2) ezdxf audit = 0 errores y 0 arreglos (si ezdxf está instalado).
// 3) El verificador no encuentra choques en nuestras propias plantillas.
// 4) El verificador JS da lo mismo que el script Python (tdc_verificar_plano.py) en: el plano TDC v3, el v3 con 3 textos
//    montados a propósito y 11 casos sintéticos (respuestas del Python guardadas en tests/datos/ref_python_*.txt el
//    29-10-2026; el Python ya no se puede correr sin AutoCAD porque medía con romans.shx).
// 5) Bloques sueltos para INSERTARSIMBOLO y trazado de redes.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
require('../cli/dxf_a_dwf.js'); // entorno de node para el lector de la app (medidas de letra, Scene, DXF…)
const W = path.join(__dirname, '..', 'web') + '/';
// Path2D de prueba (en la app lo da el navegador): cuenta los trazos para saber que algo se dibujó
let trazosDibujados = 0;
if (typeof Path2D === 'undefined') global.Path2D = class { moveTo() { trazosDibujados++; } lineTo() {} arc() {} ellipse() {} rect() { trazosDibujados++; } closePath() {} bezierCurveTo() {} quadraticCurveTo() {} addPath() {} };
global.DXFGen = require(W + 'dxf_generador.js');
global.SimbolosEPM = require(W + 'simbolos_epm.js');
const PlantillaEPM = require(W + 'plantilla_epm.js');
const Verificador = require(W + 'verificador.js');
const DAT = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida', 'epm');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (n, c, info) => { if (c) ok++; else { bad++; console.log('FALLA', n, info === undefined ? '' : info); } };
const EZ = cp.spawnSync('python3', ['-c', 'import ezdxf'], { encoding: 'utf8' }).status === 0;
function audit(file) {
  const py = 'import ezdxf, json, sys\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nprint(json.dumps({"e": [str(x.message) for x in a.errors], "f": [str(x.message) for x in a.fixes], "b": len(d.blocks)}))';
  const r = cp.spawnSync('python3', ['-c', py, file], { encoding: 'utf8' });
  return r.status === 0 ? JSON.parse(r.stdout.trim()) : { fallo: r.stderr.slice(-500) };
}
/** lee el informe del Python: textos, llamadas y la lista de colisiones */
function leerInforme(txt) {
  const m = /textos: (\d+) \| altura minima: ([\d.]+|None) mm \| < 2,0 mm: (\d+) \| < 2,5 mm: (\d+)/.exec(txt);
  const ll = /llamadas revisadas: (\d+)/.exec(txt);
  const i = txt.indexOf('COLISIONES:');
  const col = txt.slice(i).split('\n').slice(1).filter((l) => l.startsWith('  ')).map((l) => l.trim().split(' | '));
  return { textos: +m[1], hmin: m[2] === 'None' ? null : +m[2], m2: +m[3], m25: +m[4], llamadas: +ll[1], col };
}

(async () => {
  // ---------------------------------------------------------------- 1-3) generar, abrir, auditar, verificar
  const archivos = { 'simbolos_EPM_RA8-001.dxf': SimbolosEPM.biblioteca() };
  for (const h of ['1000x707', 'A0', 'A1', 'A2']) archivos[`plantilla_EPM_${h}.dxf`] = PlantillaEPM.generar({ hoja: h });
  archivos['plantilla_con_datos.dxf'] = PlantillaEPM.generar({ hoja: '1000x707', datos: { proyecto: 'PRUEBA DOMOPLANO', direccion: 'CL 28 # 34-151', municipio: 'MARINILLA', fecha: '29/10/2026', matricula: 'AN205-12345' } });
  const nSimb = SimbolosEPM.lista().length + Object.keys(SimbolosEPM.REDES).length * 2;
  for (const [n, txt] of Object.entries(archivos)) {
    const f = path.join(SAL, n); fs.writeFileSync(f, txt);
    let doc = null;
    try { doc = await DXF.open(new TextEncoder().encode(txt)); } catch (e) { check(`${n}: abre en Domoplano`, false, e.message); continue; }
    check(`${n}: abre en Domoplano`, !!doc && doc.pages.length === 2, doc && doc.pages.map((p) => p.title));
    const pl = doc.pages[1]; let root = null; const t0 = trazosDibujados;
    try { root = await pl.build(); } catch (e) { check(`${n}: dibuja la plancha`, false, e.stack); }
    check(`${n}: dibuja la plancha`, !!root && root.ch && root.ch.length > 0 && trazosDibujados - t0 > 100, trazosDibujados - t0);
    const bl = doc.blockNames();
    if (n.startsWith('simbolos')) {
      check(`${n}: ${nSimb} bloques insertables`, bl.filter((b) => b.startsWith('EPM_')).length === nSimb, bl.length);
      check(`${n}: cada bloque se dibuja`, bl.every((b) => doc.blockNode(b) && doc.blockNode(b).node));
      check(`${n}: poste con atributos ALTURA y CARGA`, (doc.blockNode('EPM_POSTE_CONCRETO_EX').attdefs || []).length === 2);
    } else {
      check(`${n}: trae ventanas 1:500 y 1:1000`, (txt.match(/\n  0\nVIEWPORT\n/g) || []).length === 3 && txt.includes('\n 45\n') );
      check(`${n}: modelo en metros ($INSUNITS 6, H4: las ventanas dan 1:500 y 1:1000 de verdad)`, doc.dxf.insunits === 6);
    }
    if (EZ) { const a = audit(f); check(`${n}: ezdxf audit sin errores ni arreglos`, a.e && !a.e.length && !a.f.length, a); }
    const r = await Verificador.verificar(txt, { nombre: n });
    check(`${n}: verificador 0 choques`, r.colisiones.length === 0, r.informe.split('\n').slice(-6).join('\n'));
    if (!n.startsWith('simbolos')) check(`${n}: textos de convenciones ≥ 2,5 mm`, r.textosBajos.every((t) => !/^(DEFINICIÓN|EXISTENTE|PROYECTADA|Poste|Transf|Línea|Cable|Secund|Bajante|Caja|Corta|DPS|Gabinete|Puesta|Punto|Retirar|Notas|1\.)/.test(t.texto)));
  }
  // rótulo: medidas de la norma (6.2.3.1 rótulo 160×100, 6.2.3.9 sello 160×70) en la hoja 1000×707
  {
    const t = archivos['plantilla_EPM_1000x707.dxf'];
    // H4: el rótulo es el bloque EPM_ROTULO (160×100 desde 0,0) con atributos, insertado en la esquina (830, 10)
    check('rótulo 160×100 en la esquina', /\n 10\n0\.0\n 20\n0\.0\n 10\n160\.0\n 20\n0\.0\n 10\n160\.0\n 20\n100\.0/.test(t) && /\n  2\nEPM_ROTULO\n 10\n830\.0\n 20\n10\.0\n/.test(t));
    check('sello 160×70 encima del rótulo', /\n 10\n830\.0\n 20\n110\.0\n 10\n990\.0\n 20\n110\.0\n 10\n990\.0\n 20\n180\.0/.test(t));
    check('datos del rótulo puestos', archivos['plantilla_con_datos.dxf'].includes('PRUEBA DOMOPLANO') && archivos['plantilla_con_datos.dxf'].includes('AN205-12345'));
  }

  // ---------------------------------------------------------------- 4) mismos resultados que el script Python
  for (const [dxf, ref] of [['TDC_v3.dxf', 'ref_python_TDC_v3.txt'], ['TDC_v3_montado.dxf', 'ref_python_TDC_v3_montado.txt'], ['verif_casos.dxf', 'ref_python_casos.txt']]) {
    const py = leerInforme(fs.readFileSync(path.join(DAT, ref), 'utf8'));
    const t0 = Date.now();
    const r = await Verificador.verificar(new Uint8Array(fs.readFileSync(path.join(DAT, dxf))), { nombre: dxf });
    const ms = Date.now() - t0;
    fs.writeFileSync(path.join(SAL, 'js_' + ref), r.informe + '\n');
    check(`${dxf}: mismos textos (${py.textos})`, r.textos === py.textos, r.textos);
    check(`${dxf}: misma altura mínima y conteos < 2,0 / < 2,5`, r.alturaMinima === py.hmin && r.menores2 === py.m2 && r.menores25 === py.m25, [r.alturaMinima, r.menores2, r.menores25]);
    check(`${dxf}: mismas llamadas revisadas (${py.llamadas})`, r.llamadas === py.llamadas, r.llamadas);
    const clave = (c) => `${c[0]} | ${c[1]} | ${String(c[2]).replace(/ g=.*/, '').slice(0, 60)}`;
    const a = py.col.map(clave).sort(), b = r.colisiones.map(clave).sort();
    check(`${dxf}: mismas colisiones (${a.length})`, JSON.stringify(a) === JSON.stringify(b), { python: a, js: b });
    // posición: igual a 0,1 mm, salvo textos centrados/derecha (el ancho depende de la letra)
    const lejos = py.col.filter((c, i) => { const d = r.colisiones.find((x) => clave(x) === clave(c)); return d && Math.hypot(+c[3] - d[3], +c[4] - d[4]) > 3; });
    check(`${dxf}: posiciones de las colisiones (≤ 3 mm)`, !lejos.length, lejos);
    console.log(`  ${dxf}: ${r.colisiones.length} colisiones, ${ms} ms`);
  }

  // ---------------------------------------------------------------- 5) bloques sueltos y redes
  const pb = SimbolosEPM.paresBloque('EPM_TRAFO_1F_EX');
  check('paresBloque: trafo 1F existente con círculo, onda y atributo', pb && pb.ents.some((e) => e[0][1] === 'CIRCLE') && pb.ents.filter((e) => e[0][1] === 'ARC').length === 4 && pb.ents.some((e) => e[0][1] === 'ATTDEF'));
  check('paresBloque: sin handles', pb.ents.every((e) => !e.some(([c]) => c === 5 || c === 330)));
  check('paresBloque: bloque que no existe → null', SimbolosEPM.paresBloque('NO_EXISTE') === null);
  {
    const D = new DXFGen.Dibujo({ papel: [420, 297], plancha: 'RED' });
    for (const tipo of Object.keys(SimbolosEPM.REDES)) for (const e of ['EX', 'PR']) SimbolosEPM.trazarRed(D.modelo, tipo, e, [[0, 0], [30, 0], [30, 20], [60, 25]], { escala: 0.5 });
    const t = D.toString(); const f = path.join(SAL, 'redes_prueba.dxf'); fs.writeFileSync(f, t);
    check('trazarRed: todas las redes dibujan', (t.match(/\n  0\nLINE\n/g) || []).length > 100);
    if (EZ) { const a = audit(f); check('trazarRed: ezdxf sin errores', a.e && !a.e.length && !a.f.length, a); }
  }
  // cada símbolo trae su cita
  check('cada símbolo trae cita (Anexo A o convención propia)', SimbolosEPM.lista().every((s) => /Anexo A, pág\. \d+|Convención propia/.test(s.cita)));

  console.log(`pruebas OK ${ok} fallas ${bad}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
