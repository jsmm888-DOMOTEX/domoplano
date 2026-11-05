// Pruebas del hito H1 (documento propio): NUEVO, ida y vuelta sin pérdidas, CAPA, TIPOLIN, ESTILO, PROPIEDADES,
// IGUALARPROP, EDITATEXTO, REVISION, LIMPIA y deshacer. Uso: node tests/h1test.js   (con --acad también abre en AcCoreConsole)
// Solo trabaja con copias en tests/datos y escribe en tests/salida. Valida con ezdxf (audit) si está instalado.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const W = path.join(__dirname, '..', 'web') + '/';
global.self = global; global.Path2D = class { moveTo(){} lineTo(){} arc(){} ellipse(){} rect(){} closePath(){} bezierCurveTo(){} quadraticCurveTo(){} addPath(){} };
require(W + 'aci.js'); global.Scene = require(W + 'scene.js'); global.DXF = require(W + 'dxf.js'); global.Edit = require(W + 'edit.js');
const Doc = require(W + 'documento.js');
const DATOS = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : info); } };
const decode = (u8) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); } };
async function abrir(text) { const doc = await DXF.open(new TextEncoder().encode(text)); return { doc, S: new Edit.Session(doc) }; }
const model = (doc) => doc.pages[0];

// ezdxf: auditoría y lectura de lo guardado (si no está instalado, se avisa y se sigue)
const EZ = cp.spawnSync('python3', ['-c', 'import ezdxf'], { encoding: 'utf8' }).status === 0;
function ezdxf(file, code) {
  const py = `import ezdxf, json, sys\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nout = {'errores': [str(e.message) for e in a.errors], 'arreglos': len(a.fixes)}\n${code || ''}\nprint(json.dumps(out))`;
  const r = cp.spawnSync('python3', ['-c', py, file], { encoding: 'utf8' });
  if (r.status !== 0) return { fallo: r.stderr.slice(-800) };
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

(async () => {
  // ------------------------------------------------------------ 1) ida y vuelta sin cambios = idéntico byte a byte
  for (const f of ['DR6.dxf', 'F125.dxf', 'TDC_v2.dxf', 'JuanXXIII.dxf']) {
    const u8 = fs.readFileSync(path.join(DATOS, f));
    const text = decode(u8);
    const doc = await DXF.open(u8); const S = new Edit.Session(doc);
    check(`${f}: guardar sin cambios = idéntico`, S.serialize() === text);
    // y deshacer después de editar capas/propiedades/textos también vuelve al original
    S.crearCapa('H1 PRUEBA', { color: 3 }); S.cargarTipo('TRAZOS'); S.estilo('H1 ESTILO');
    const txt = S.allEnts().find((e) => e.type === 'TEXT');
    if (txt) S.editarTexto(txt, 'cambiado');
    const lin = S.allEnts().find((e) => e.type === 'LINE');
    if (lin) S.cambiarProps([lin], { color: 1, ltype: 'TRAZOS', lw: 50 });
    while (S.undo()) { /* deshacer todo */ }
    // (solo cambia la semilla de handles $HANDSEED, que nunca retrocede: así no se reutilizan identificadores)
    const sinSemilla = (t) => t.replace(/(\$HANDSEED\r?\n\s*5\r?\n)[0-9A-Fa-f]+/, '$1*');
    check(`${f}: deshacer todo = idéntico (salvo $HANDSEED)`, sinSemilla(S.serialize()) === sinSemilla(text));
  }

  // ------------------------------------------------------------ 2) NUEVO: plano en blanco mm + una plancha
  const blank = Doc.nuevo();
  let { doc, S } = await abrir(blank);
  check('nuevo: unidades mm', doc.dxf.insunits === 4 && model(doc).units === 'mm');
  check('nuevo: una plancha', doc.pages.length === 2 && doc.pages[1].title === 'Plancha 1', doc.pages.map((p) => p.title));
  check('nuevo: capa 0 y estilo Liberation Sans', S.capas()[0].name === '0' && S.estilos()[0].font === Doc.FUENTE);
  check('nuevo: guardar sin cambios = idéntico', S.serialize() === blank);
  fs.writeFileSync(path.join(SAL, 'H1 nuevo en blanco.dxf'), blank);

  // ------------------------------------------------------------ 3) prueba de aceptación H1: plano de cero con 5 capas
  for (const t of ['TRAZOS', 'CENTRO', 'OCULTA']) check('TIPOLIN ' + t, S.cargarTipo(t).ok);
  check('TIPOLIN desconocido avisa', !!S.cargarTipo('ACAD_ISO02W100').error);
  const CAPAS = [['RED MT', 1, 'Continuous', 50], ['RED BT', 5, 'TRAZOS', 35], ['POSTES', 3, 'Continuous', 25], ['TEXTOS', 7, 'Continuous', 18], ['EJES', 8, 'CENTRO', 13]];
  for (const [n, c, lt, lw] of CAPAS) check('CAPA crear ' + n, S.crearCapa(n, { color: c, ltype: lt, lw }).ok);
  check('CAPA no repite nombre', !!S.crearCapa('red mt').error);
  check('CAPA nombre inválido', !!S.crearCapa('A/B').error);
  check('CAPA crear SOBRA (para LIMPIA)', S.crearCapa('SOBRA', { color: 2 }).ok);
  check('ESTILO Domoplano (Liberation)', S.estilo('Domoplano', { height: 0 }).ok && S.estiloActualA('Domoplano').ok);
  check('ESTILO SIN USO (para LIMPIA)', S.estilo('SIN USO', { font: 'LiberationSerif-Regular.ttf' }).ok);
  check('CAPA actual', S.capaActualA('RED MT').ok && S.capaActual() === 'RED MT');
  const pg = model(doc);
  S.add(pg, 'LINE', 'AcDbLine', [[10, 0], [20, 0], [30, 0], [11, 100], [21, 0], [31, 0]], 'RED MT');
  const l2 = S.add(pg, 'LINE', 'AcDbLine', [[10, 0], [20, 10], [30, 0], [11, 100], [21, 10], [31, 0]], 'RED MT');
  S.add(pg, 'CIRCLE', 'AcDbCircle', [[10, 50], [20, 30], [30, 0], [40, 2]], 'POSTES');
  S.add(pg, 'LINE', 'AcDbLine', [[10, 50], [20, -10], [30, 0], [11, 50], [21, 60], [31, 0]], 'EJES');
  const J = ['I', 'C', 'D', 'M', 'SI', 'MC', 'ID'];
  const textos = J.map((j, k) => S.add(pg, 'TEXT', 'AcDbText', Doc.textoPares([10, 40 + k * 6], 2.5, 0, `Texto ${Doc.NOMBRE_JUST[j]} ñ á`, { just: j, style: 'Domoplano' }), 'TEXTOS'));
  S.add(pg, 'TEXT', 'AcDbText', Doc.textoPares([10, 90], 3, 0, 'AJUSTADO', { just: 'AJ', p2: [60, 90], style: 'Domoplano' }), 'TEXTOS');
  check('TEXTO: 73 después del segundo AcDbText', (() => { const p = textos[4].p; const i2 = p.map((q) => q[1]).lastIndexOf('AcDbText'); return p.findIndex((q) => q[0] === 73) > i2; })());
  // propiedades
  check('PROPIEDADES cambiar capa/color/tipo/grosor', S.cambiarProps([l2], { layer: 'RED BT', color: 6, ltype: 'OCULTA', lw: 70, ltscale: 2 }).ok);
  check('PROPIEDADES quedan', (() => { const p = Doc.propsDe(l2); return p.layer === 'RED BT' && p.color === 6 && p.ltype === 'OCULTA' && p.lw === 70 && p.ltscale === 2; })(), Doc.propsDe(l2));
  check('PROPIEDADES volver a PorCapa', S.cambiarProps([l2], { color: 256, ltype: 'BYLAYER', lw: -1, ltscale: 1 }).ok && !l2.p.some((q) => [62, 6, 370, 48].includes(q[0])), l2.p);
  check('IGUALARPROP', S.igualarProps(textos[0], [l2]).ok && Doc.propsDe(l2).layer === 'TEXTOS');
  S.cambiarProps([l2], { layer: 'RED BT' });
  // capas: renombrar, apagar, inutilizar, color, tipo, grosor
  check('CAPA renombrar', S.renombrarCapa('RED BT', 'RED BT 208V').ok && Doc.propsDe(l2).layer === 'RED BT 208V');
  check('CAPA no renombra la 0', !!S.renombrarCapa('0', 'X').error);
  check('CAPA apagar', S.cambiarCapa('EJES', { off: true }).ok && doc.dxf.layers.get('EJES').off);
  check('CAPA inutilizar', S.cambiarCapa('POSTES', { frozen: true }).ok && doc.dxf.layers.get('POSTES').frozen);
  check('CAPA no inutiliza la actual', !!S.cambiarCapa('RED MT', { frozen: true }).error);
  check('CAPA color', S.cambiarCapa('TEXTOS', { color: 4 }).ok && doc.dxf.layers.get('TEXTOS').color === 4);
  check('CAPA apagada conserva color', S.cambiarCapa('EJES', { color: 9 }).ok && doc.dxf.layers.get('EJES').color === 9 && doc.dxf.layers.get('EJES').off);
  check('CAPA tipo de línea', S.cambiarCapa('POSTES', { ltype: 'TRAZOS' }).ok && doc.dxf.layers.get('POSTES').ltype === 'TRAZOS');
  check('CAPA grosor', S.cambiarCapa('POSTES', { lw: 30 }).ok && doc.dxf.layers.get('POSTES').lw === 30);
  check('CAPA no trazar', S.cambiarCapa('EJES', { plot: false }).ok && doc.dxf.layers.get('EJES').plot === false);
  // editar texto
  check('EDITATEXTO', S.editarTexto(textos[1], 'Centro editado Ñ').ok && S.textoDe(textos[1]) === 'Centro editado Ñ');
  // REVISION y LIMPIA
  let rv = S.revisar(false);
  check('REVISION sin problemas', rv.problemas.length === 0, rv.problemas);
  const lp = S.limpiable();
  check('LIMPIA encuentra SOBRA, SIN USO y OCULTA', lp.capas.map((r) => r.get(2)).join() === 'SOBRA' && lp.estilos.map((r) => r.get(2)).join() === 'SIN USO' && lp.tipos.map((r) => r.get(2)).join() === 'OCULTA',
    [lp.capas, lp.tipos, lp.estilos].map((a) => a.map((r) => r.get(2))));
  const lr = S.limpiar();
  check('LIMPIA quita 3', lr.n.capas === 1 && lr.n.estilos === 1 && lr.n.tipos === 1, lr);
  check('LIMPIA no deja nada más', (() => { const x = S.limpiable(); return !x.capas.length && !x.tipos.length && !x.estilos.length; })());
  // guardar → reabrir → guardar = idéntico; y comprobar con ezdxf
  const out1 = S.serialize();
  const f1 = path.join(SAL, 'H1 prueba de aceptacion.dxf'); fs.writeFileSync(f1, out1);
  ({ doc, S } = await abrir(out1));
  check('reabrir: 5 capas + 0 + Defpoints', S.capas().length === 7, S.capas().map((c) => c.name));
  const ej = S.capas().find((c) => c.name === 'EJES');
  check('reabrir: EJES apagada, color 9, CENTRO, 0,13 mm, no trazar', ej && ej.off && ej.color === 9 && ej.ltype === 'CENTRO' && ej.lw === 13 && !ej.plot, ej);
  check('reabrir: capa actual RED MT', S.capaActual() === 'RED MT');
  check('reabrir: guardar sin cambios = idéntico', S.serialize() === out1);
  rv = S.revisar(false); check('reabrir: REVISION sin problemas', rv.problemas.length === 0, rv.problemas);
  if (EZ) {
    const r = ezdxf(f1, `out['capas'] = {l.dxf.name: [l.dxf.color, l.dxf.linetype, l.dxf.lineweight, l.is_on(), l.is_frozen()] for l in d.layers}
out['estilos'] = {s.dxf.name: s.dxf.font for s in d.styles}
out['textos'] = [[t.dxf.text, t.dxf.halign, t.dxf.valign, t.dxf.style] for t in d.modelspace().query('TEXT')]
out['unidades'] = d.units
out['planchas'] = d.layout_names()`);
    check('ezdxf: 0 errores en el plano de aceptación', r.errores && r.errores.length === 0, r);
    check('ezdxf: capas con color/tipo/grosor', r.capas && JSON.stringify(r.capas['RED MT']) === JSON.stringify([1, 'Continuous', 50, true, false]) && r.capas['POSTES'][4] === true && r.capas['EJES'][3] === false && r.capas['RED BT 208V'][1] === 'TRAZOS', r.capas);
    check('ezdxf: estilo Domoplano con Liberation Sans', r.estilos && r.estilos.Domoplano === Doc.FUENTE && !('SIN USO' in r.estilos));
    check('ezdxf: textos justificados', r.textos && r.textos.some((t) => t[1] === 1 && t[2] === 2) && r.textos.some((t) => t[0] === 'Centro editado Ñ' && t[1] === 1) && r.textos.some((t) => t[1] === 5), r.textos);
    check('ezdxf: mm y Plancha 1', r.unidades === 4 && r.planchas && r.planchas.includes('Plancha 1'));
    const rb = ezdxf(path.join(SAL, 'H1 nuevo en blanco.dxf'));
    check('ezdxf: plano en blanco 0 errores', rb.errores && rb.errores.length === 0, rb);
  } else console.log('AVISO: ezdxf no está instalado; se omite la auditoría externa.');

  // ------------------------------------------------------------ 4) en un plano real (copia del DR6): capas, propiedades, texto, limpiar
  const dr6 = decode(fs.readFileSync(path.join(DATOS, 'DR6.dxf')));
  ({ doc, S } = await abrir(dr6));
  const capas0 = S.capas().length;
  const usada = (() => { const cnt = {}; for (const e of S.allEnts()) { const l = (e.get(8) || '').trim(); cnt[l] = (cnt[l] || 0) + 1; } return Object.entries(cnt).filter(([n]) => n !== '0').sort((a, b) => b[1] - a[1])[0]; })();
  check('DR6: renombrar capa usada', S.renombrarCapa(usada[0], usada[0] + ' (H1)').ok && S.allEnts().filter((e) => (e.get(8) || '').trim() === usada[0] + ' (H1)').length === usada[1], usada);
  check('DR6: crear capa', S.crearCapa('H1 NUEVA', { color: 30, lw: 40 }).ok && S.capas().length === capas0 + 1);
  const algunas = S.allEnts().filter((e) => e.type === 'LINE' && doc.dxf.entities.includes(e)).slice(0, 5);
  check('DR6: propiedades a 5 líneas', S.cambiarProps(algunas, { layer: 'H1 NUEVA', color: 2 }).ok);
  const t6 = S.allEnts().find((e) => e.type === 'TEXT' && doc.dxf.entities.includes(e));
  check('DR6: editar texto', t6 && S.editarTexto(t6, 'Texto editado en Domoplano').ok);
  const mt = S.allEnts().find((e) => e.type === 'MTEXT');
  if (mt) check('DR6: editar MTEXT largo (trozos de 250)', S.editarTexto(mt, 'x'.repeat(600)).ok && S.textoDe(mt).length === 600 && mt.p.filter((q) => q[0] === 3).length === 2);
  const rv6 = S.revisar(false);
  const lp6 = S.limpiar();
  const out6 = S.serialize();
  const f6 = path.join(SAL, 'H1 DR6 editado.dxf'); fs.writeFileSync(f6, out6);
  ({ doc, S } = await abrir(out6));
  check('DR6: reabrir guardar = idéntico', S.serialize() === out6);
  check('DR6: la capa renombrada existe al reabrir', !!S.findRec('LAYER', usada[0] + ' (H1)'));
  console.log(`DR6: REVISION ${rv6.problemas.length} aviso(s) [${rv6.problemas.slice(0, 3).join(' | ')}] · LIMPIA quitó capas ${lp6.n.capas}, tipos ${lp6.n.tipos}, estilos ${lp6.n.estilos}, bloques ${lp6.n.bloques}`);
  if (EZ) { const r = ezdxf(f6); check('ezdxf: DR6 editado 0 errores', r.errores && r.errores.length === 0, r); }

  // ------------------------------------------------------------ 5) AcCoreConsole (opcional): AutoCAD abre lo que escribimos, sin guardar nada
  if (process.argv.includes('--acad')) {
    const r = cp.spawnSync('python3', [path.join(__dirname, 'acad_abrir.py'), f1, f6, path.join(SAL, 'H1 nuevo en blanco.dxf')], { encoding: 'utf8', timeout: 600000 });
    console.log(r.stdout.trim());
    check('AcCoreConsole abre los 3 DXF', /TODOS-ABREN/.test(r.stdout), r.stderr.slice(-400));
  }
  console.log(`H1: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
