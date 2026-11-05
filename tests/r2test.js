// Pruebas de los arreglos de la REVISIÓN 2 (29-10-2026):
//  F-5  cota dentro de una ventana (m y mm, varias escalas) mide en las unidades del dibujo (antes «40000,00»).
//  M-10 lo movido/copiado/girado/escalado se suelta (E ya no lo borra sin preguntar); P (Previo) lo retoma.
//  M-11 CANTIDADES sin convenciones, marco, rótulo ni capas que no se imprimen; opciones Capas, Zona y Todo; MCP igual.
//  MCP  escrituras solo en carpetas permitidas, nunca reemplazar sin overwrite, nunca Escritorio/Descargas.
//  M-12 TABLA «30;15;15» = anchos · M-13 plancha copiada = «X de Y» al día y CHECKEPM lo revisa · M-14 lista de comandos
//  M-15 Refent con modos (REFENT) · M-16 INSERTAR escala 1 para bloques propios, 0,5 solo símbolos EPM en metros.
// Uso: node tests/r2test.js     Solo escribe en tests/salida/r2.
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const motor = require('../mcp/motor.js');
const { PlanoSinApp } = motor;
const { exportarPDF } = require('../cli/dxf_a_pdf.js');
const ChecklistEPM = require('../web/checklist_epm.js');
const DXF = global.DXF;
const SAL = path.join(__dirname, 'salida', 'r2');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 600)); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const py = (code, ...args) => { const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' }); if (r.status !== 0) return { fallo: r.stderr.slice(-1500) }; return JSON.parse(r.stdout.trim().split('\n').pop()); };
const EZ = `import ezdxf, json, sys\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nout = {'errores': [str(e.message) for e in a.errors]}\n`;
const tick = () => new Promise((r) => setImmediate(r));

const plano = new PlanoSinApp();
const msgs = [];
let S, pg;
async function abrir(texto) { await plano.abrir({ texto }); CAD.oyente = (t) => msgs.push(t); S = CAD.session; pg = () => CAD.host.page(); return S; }
async function cmd(...lineas) { msgs.length = 0; for (const l of lineas) { CAD.input(l); await tick(); await plano.rearmar(); await tick(); } return msgs.join('\n'); }
const ln = (a, b, capa = '0') => S.add(pg(), 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], capa);
const vivos = () => { const p = plano.pagina(); return (p.ents ? p.ents() : S.D.entities.filter((e) => e.int(67, 0) !== 1)).filter((e) => !e.deleted); };
const guardar = (n) => { const f = path.join(SAL, n); fs.writeFileSync(f, S.serialize()); return f; };
/** Texto de la cota (lo que se ve) desde su bloque *D. */
const textoCota = (d) => { const b = S.D.blocks.get(d.get(2).trim().toUpperCase()); const t = b && b.ents.find((e) => e.type === 'TEXT' || e.type === 'MTEXT'); return t ? { s: t.get(1), h: t.num(40) } : null; };
const ultimaCota = () => S.D.entities.filter((e) => e.type === 'DIMENSION' && !e.deleted).pop();
/** Entra a la ventana con esa escala (clic en su centro), acota 0,0 → L,0 y vuelve al papel. */
async function acotarEnVentana(pl, N, L) {
  const v = S.ventanas(plano.pagina()).find((x) => near(S.escalaVentana(plano.pagina(), x), N, 1e-6));
  let m = await cmd('MS', `${v.num(10)},${v.num(20)}`);
  const dentro = /Espacio modelo dentro de la ventana/.test(m);
  const c = S.vistaVentana ? null : null; void c;
  // el modelo visible en la ventana: se acota alrededor de su centro (código 12/22 = centro de la vista)
  const cx = v.num(12), cy = v.num(22);
  m = await cmd('COTALIN', `${cx},${cy}`, `${cx + L},${cy}`, `${cx + L / 2},${cy + L / 4}`);
  const d = ultimaCota(); await cmd('PS');
  return { dentro, m, d, t: d && textoCota(d), estilo: d && d.get(3).trim() };
}

(async () => {
  // ================================================================ F-5: cota dentro de ventanas (metros y mm, varias escalas)
  {
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' }));
    check('F-5: plantilla EPM en metros', S.unidadDibujo() === 6);
    await plano.irA('PLANO 01 DE 01');
    const pl = plano.pagina();
    // otras escalas: una ventana 1:200 más
    let r = S.crearVentana(pl, [600, 400], [760, 520], { escala: 200, centro: [0, 0] }); await plano.rearmar();
    check('F-5: ventana 1:200 creada', r.ok && near(r.escala, 200, 1e-6), r.error || r.escala);
    for (const N of [500, 1000, 200]) {
      const x = await acotarEnVentana(pl, N, 40);
      check(`F-5 (m, 1:${N}): se trabaja dentro de la ventana`, x.dentro, x.m);
      check(`F-5 (m, 1:${N}): la cota de 40 m dice «40,00» (antes «40000,00»)`, x.t && x.t.s === '40,00', x.t && x.t.s);
      check(`F-5 (m, 1:${N}): texto de 2,5 mm de papel = ${2.5 * N / 1000} m`, x.t && near(x.t.h, 2.5 * N / 1000, 1e-9), x.t && x.t.h);
      check(`F-5 (m, 1:${N}): usa el estilo «ANOT 1-${N}» con DIMLFAC 1`, x.estilo === `ANOT 1-${N}` && near(S.estiloCota(x.estilo).lfac, 1), [x.estilo, x.estilo && S.estiloCota(x.estilo).lfac]);
    }
    await plano.irA('Modelo');
    let m = await cmd('COTALIN', '0,-50', '40,-50', '20,-55');
    check('F-5: en el Modelo sigue «40,00»', /Cota: 40,00/.test(m), m);
    const f = guardar('F5 cotas en ventanas (m).dxf');
    const ez = py(EZ + `out['cotas'] = sorted([ (e.dxf.dimstyle, round(d.dimstyles.get(e.dxf.dimstyle).dxf.get('dimlfac', 1), 6), round(e.get_measurement(), 4)) for l in d.layouts for e in l.query('DIMENSION')])\nprint(json.dumps(out))`, f);
    check('F-5: ezdxf audit 0 errores', ez.errores && !ez.errores.length, JSON.stringify(ez));
    check('F-5: en el DXF ninguna cota con DIMLFAC 1000', ez.cotas && ez.cotas.length === 4 && ez.cotas.every((c) => c[1] === 1 && near(c[2], 40, 1e-6)), JSON.stringify(ez.cotas));
    const rp = await exportarPDF(f, path.join(SAL, 'F5 cotas en ventanas (m).pdf'), { planchas: ['PLANO 01 DE 01'], color: 'mono' });
    const tx = py(`import fitz, json, sys\nd = fitz.open(sys.argv[1])\nt = d[0].get_text()\nprint(json.dumps({'n40': t.count('40,00'), 'mal': t.count('40000')}))`, rp.salida);
    check('F-5: el PDF trae «40,00» y no «40000»', tx.n40 >= 3 && tx.mal === 0, JSON.stringify(tx));
    // un «ANOT 1-500» guardado con la falla se corrige solo al volver a usarlo
    r = S.crearEstiloCota('ANOT 1-750', { unidades: 'mm', escala: 0.75, actual: false });
    check('F-5: estilo viejo con la falla (DIMLFAC 1000) de prueba', r.ok && near(S.estiloCota('ANOT 1-750').lfac, 1000));
    const ea = S.estiloAnot(750);
    check('F-5: estiloAnot corrige un «ANOT 1-N» viejo a DIMLFAC 1', ea.ok && ea.corregido && near(S.estiloCota('ANOT 1-750').lfac, 1), JSON.stringify(ea));
    r = S.crearEstiloCota('NUEVO SIN UNIDADES', { actual: false });
    check('F-5: ESTILOCOTA nuevo sin unidades en metros mide en metros (DIMLFAC 1)', r.ok && near(S.estiloCota('NUEVO SIN UNIDADES').lfac, 1));
    r = S.crearEstiloCota('EN MM', { unidades: 'mm', actual: false });
    check('F-5: ESTILOCOTA con unidades mm explícitas sigue dando ×1000', r.ok && near(S.estiloCota('EN MM').lfac, 1000));
  }
  {
    await abrir(Documento.nuevo());
    check('F-5: plano en mm', S.unidadDibujo() === 4);
    await plano.irA('Plancha 1'); const pl = plano.pagina();
    S.crearVentana(pl, [10, 10], [190, 140], { escala: 50, centro: [0, 0] });
    S.crearVentana(pl, [200, 10], [400, 140], { escala: 20, centro: [0, 0] }); await plano.rearmar();
    for (const N of [50, 20]) {
      const x = await acotarEnVentana(pl, N, 4000);
      check(`F-5 (mm, 1:${N}): cota de 4000 mm dice «4000,00»`, x.dentro && x.t && x.t.s === '4000,00', x.t && x.t.s);
      check(`F-5 (mm, 1:${N}): texto 2,5 mm de papel = ${2.5 * N} mm`, x.t && near(x.t.h, 2.5 * N, 1e-9), x.t && x.t.h);
    }
    const f = guardar('F5 cotas en ventanas (mm).dxf');
    const ez = py(EZ + 'print(json.dumps(out))', f);
    check('F-5 (mm): ezdxf audit 0 errores', ez.errores && !ez.errores.length, JSON.stringify(ez));
  }

  // ================================================================ M-10: soltar la designación al terminar
  {
    await abrir(Documento.nuevo()); await plano.irA('Modelo');
    const L1 = ln([0, 0], [100, 0]); const L2 = ln([0, 50], [100, 50]); await plano.rearmar();
    let m = await cmd('M', '50,0', '', '0,0', '0,10');
    check('M-10: MOVER funciona', near(L1.num(20), 10), L1.num(20));
    check('M-10: tras MOVER no queda nada designado', CAD.selection.size === 0, CAD.selection.size);
    m = await cmd('E');
    check('M-10: E pide designar (no borra lo recién movido)', CAD.comando === 'BORRA' && !L1.deleted, m + ' | ' + CAD.comando);
    m = await cmd('P');
    check('M-10: P (Previo) retoma lo movido', CAD.selection.has(L1) && /Previo: 1 objeto/.test(m), m);
    await cmd('');
    check('M-10: Enter con el Previo borra solo eso', L1.deleted && !L2.deleted);
    S.undo(); await plano.rearmar();
    m = await cmd('CO', '50,50', '', '0,0', '0,20', '');
    check('M-10: COPIA terminada con Enter suelta la designación', CAD.selection.size === 0 && vivos().filter((e) => e.type === 'LINE').length === 3, [CAD.selection.size, vivos().length]);
    m = await cmd('RO', '50,50', '', '0,0', '90');
    check('M-10: GIRA suelta la designación', CAD.selection.size === 0, CAD.selection.size);
    m = await cmd('ES', '50,10', '', '0,0', '2');
    check('M-10: ESCALA suelta la designación', CAD.selection.size === 0, CAD.selection.size);
    CAD.seleccionar([L2]); m = await cmd('E');
    check('M-10: designar primero y luego E sigue borrando (como AutoCAD)', L2.deleted, m);
    S.undo();
  }

  // ================================================================ M-11: CANTIDADES sin lo que no es obra
  {
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' }));
    await plano.irA('Modelo');
    S.insertarSimbolo(pg(), 'EPM_POSTE_CONCRETO_PR', [0, 0], 0.5, 0, ['12', '510']);
    S.insertarSimbolo(pg(), 'EPM_POSTE_CONCRETO_PR', [30, 0], 0.5, 0, ['12', '510']);
    S.crearCapa('RED_MT'); S.crearCapa('RED_BT'); ln([0, 0], [30, 0], 'RED_MT'); ln([0, 5], [10, 5], 'RED_BT');
    S.crearCapa('CONVENCIONES'); ln([500, 500], [520, 500], 'CONVENCIONES');
    S.crearCapa('NOTAS NO IMPRIME'); S.cambiarCapa ? 0 : 0;
    const lyr = S.findRec('LAYER', 'NOTAS NO IMPRIME'); S.commit('no imprime', { mods: [{ rec: lyr, pairs: [...lyr.p.filter(([c]) => c !== 290), [290, '0']] }], tables: true });
    ln([0, 20], [100, 20], 'NOTAS NO IMPRIME');
    await plano.rearmar();
    let m = await cmd('CANTIDADES');
    check('M-11: por omisión cuenta solo el Modelo', /Origen: el Modelo \(la obra\)/.test(m), m.slice(0, 300));
    check('M-11: 2 postes (sin los 2 de cada uno del cuadro de convenciones)', /2 · EPM_POSTE_CONCRETO_PR/.test(m) && !/Altura/.test(m), m.slice(0, 600));
    check('M-11: sin EPM-ESPACIOS ni EPM-MARCO en las longitudes', !/EPM-ESPACIOS \(|EPM-MARCO \(/.test(m.split('LONGITUDES')[1] || ''), m);
    check('M-11: deja por fuera CONVENCIONES y la capa que no se imprime (y lo dice)', /Por fuera \(no es obra\): .*CONVENCIONES \(1, plantilla/.test(m) && /NOTAS NO IMPRIME \(1, no se imprime\)/.test(m) && !/· CONVENCIONES \(1 tramo/.test(m), m);
    check('M-11: RED_MT 30 m', /30\.0000 · RED_MT \(1 tramo\)/.test(m) || /30,0000 · RED_MT/.test(m) || /\b30(\.0+)? · RED_MT/.test(m), m);
    m = await cmd('CA', 'RED_M*');
    check('M-11: Capas «RED_M*» = solo RED_MT', /RED_MT \(1 tramo\)/.test(m) && !/RED_BT \(/.test(m) && /capas RED_M\*/.test(m), m);
    m = await cmd('A'); m = await cmd('Z', '-5,-5', '15,15');
    check('M-11: Zona: solo lo que cae adentro (1 poste)', /1 · EPM_POSTE_CONCRETO_PR/.test(m) && /zona/.test(m), m);
    m = await cmd('TO');
    check('M-11: Todo = como antes (Modelo + planchas, con marco)', /Modelo y planchas, sin filtro/.test(m) && /EPM-MARCO/.test(m), m.slice(0, 300));
    await cmd('');
    const q = await DomoMCP.exec(plano.contexto(), 'cantidades', {});
    check('M-11: MCP extract_quantities por omisión: Modelo sin marco ni convenciones', q.bloques.EPM_POSTE_CONCRETO_PR === 2 && !q.longitud_por_capa['EPM-MARCO'] && !q.longitud_por_capa.CONVENCIONES && q.fuera.length >= 2, JSON.stringify(q).slice(0, 400));
    const q2 = await DomoMCP.exec(plano.contexto(), 'cantidades', { todo: true });
    check('M-11: MCP todo: true = sin filtro', q2.longitud_por_capa['EPM-MARCO'] > 0, JSON.stringify(q2.longitud_por_capa));
  }

  // ================================================================ M-12 TABLA, M-13 planchas, M-14 comandos, M-15 Refent, M-16 INSERTAR
  {
    await abrir(Documento.nuevo()); await plano.irA('Plancha 1');
    let m = await cmd('TABLA', '20,280', '30;15;15', '1', '6', '', 'a;b;c');
    const tt = vivos().filter((e) => e.type === 'LINE' || e.type === 'LWPOLYLINE');
    const xs = [...new Set(vivos().filter((e) => e.type === 'LINE' && near(e.num(10), e.num(11))).map((e) => +e.num(10).toFixed(3)))].sort((a, b) => a - b);
    check('M-12: «30;15;15» en columnas = 3 columnas de 30, 15 y 15', /Tomé «30;15;15» como anchos/.test(m) && /Tabla de \d+ × 3/.test(m) && xs.join(',') === '20,50,65,80', m + ' | ' + xs.join(',') + ' | ' + tt.length);
    m = await cmd('TABLA', '20,200', '3x');
    check('M-12: «3x» se rechaza con aviso', /número entero de 1 a 50/.test(m) && CAD.comando === 'TABLA', m);
    CAD.cancelar();
    m = await cmd('XYZW');
    check('M-14: «Comando desconocido» lista los comandos nuevos', ['REDEPM', 'VENTANAS (MV)', 'PRESENTACION (LO)', 'ROTULO', 'CHECKEPM', 'COMPARAR', 'UNIR (J)', 'PARTIR (BR)', 'EDITPOL (PE)', 'SELECSIMILAR (SS)', 'LISTA (LI)', 'CANTIDADES', 'REFENT (RF)'].every((k) => m.includes(k)), m);
    m = await cmd('COTALI');
    check('M-14: sugiere el parecido (COTALI → COTALIN)', /¿Quiso decir .*COTALIN/.test(m), m.slice(0, 200));
    m = await cmd('REFENT', 'FIN,INT');
    check('M-15: REFENT FIN,INT deja solo esos modos', CAD.modosRef.sort().join(',') === 'end,int' && /Refent: Punto final|FIN, INT/.test(m), [CAD.modosRef, m]);
    m = await cmd('RF', '+PER');
    check('M-15: +PER agrega perpendicular', CAD.modosRef.includes('per') && CAD.modosRef.length === 3, CAD.modosRef);
    m = await cmd('RF', '-FIN');
    check('M-15: -FIN quita punto final', !CAD.modosRef.includes('end'), CAD.modosRef);
    m = await cmd('RF', 'CUALQUIERA');
    check('M-15: modo no válido = aviso', /Modo no válido/.test(m), m);
    CAD.cancelar();
    m = await cmd('RF', 'NINGUNO');
    check('M-15: NINGUNO apaga todos los modos', CAD.modosRef.length === 0, CAD.modosRef);
    await plano.irA('Modelo'); ln([0, 0], [100, 0]); await plano.rearmar();
    let sn = null; try { sn = CAD._findSnap(100, 0); } catch (e) { sn = { error: e.message }; }
    check('M-15: sin modos no engancha', sn === null, sn);
    CAD.refent('MED');
    try { sn = CAD._findSnap(99.9, 0); } catch (e) { sn = { error: e.message }; }
    check('M-15: solo MED: cerca del extremo no engancha el final', !sn || sn.kind !== 'end', sn);
    try { sn = CAD._findSnap(50.1, 0); } catch (e) { sn = { error: e.message }; }
    check('M-15: solo MED: engancha el punto medio', sn && sn.kind === 'mid' && near(sn.x, 50), sn);
    m = await cmd('RF', 'TODOS');
    check('M-15: TODOS vuelve a los 8 modos', CAD.modosRef.length === 8, CAD.modosRef);
    const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
    check('M-15: panel de modos junto al botón Refent', /id="cSnapM"/.test(html) && /id="cSnapPanel"/.test(html));
  }
  {
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' })); await plano.irA('Modelo');
    S.crearCapa('CAJAS'); const a = ln([0, 0], [2, 0], 'CAJAS'); const b = ln([2, 0], [2, 2], 'CAJAS'); await plano.rearmar();
    let r = S.crearBloque('CAJA_Ñ', [0, 0], [a, b], pg(), 'convertir'); await plano.rearmar();
    check('M-16: bloque propio creado', r && !r.error, JSON.stringify(r && r.error));
    let m = await cmd('I', 'CAJA_Ñ', '10,10');
    check('M-16: INSERTAR propone escala 1 para un bloque propio en metros', /Escala <1>/.test(CAD.indicacion), CAD.indicacion + ' | ' + m);
    m = await cmd('3', '0');
    m = await cmd('I', 'CAJA_Ñ', '20,10');
    check('M-16: recuerda la última escala escrita para ese bloque (3)', /Escala <3>/.test(CAD.indicacion), CAD.indicacion);
    CAD.cancelar();
    S.definirSimbolo('EPM_POSTE_CONCRETO_PR'); await plano.rearmar();
    m = await cmd('I', 'EPM_POSTE_CONCRETO_PR', '30,10');
    check('M-16: símbolo EPM en el Modelo en metros = 0,5', /Escala <0.5>/.test(CAD.indicacion), CAD.indicacion);
    CAD.cancelar();
    m = await cmd('I', 'CAJA_Ñ', '40,10');
    check('M-16: después del símbolo, el bloque propio vuelve a su escala (3), no 0,5', /Escala <3>/.test(CAD.indicacion), CAD.indicacion);
    CAD.cancelar();

    // M-13: copiar la plancha numera «X de Y» y un solo ⌘Z lo deshace todo
    const n0 = S.undoStack.length;
    r = S.copiarPlancha('PLANO 01 DE 01', 'PLANO 02'); plano.doc.refreshPages();
    let v1 = S.valoresRotulo('PLANO 01 DE 01').valores, v2 = S.valoresRotulo('PLANO 02').valores;
    check('M-13: copiar plancha = 01 de 02 y 02 de 02', v1.PLANCHA === '01' && v1.TOTAL === '02' && v2.PLANCHA === '02' && v2.TOTAL === '02', [v1.PLANCHA, v1.TOTAL, v2.PLANCHA, v2.TOTAL]);
    check('M-13: un solo paso de deshacer', S.undoStack.length === n0 + 1, S.undoStack.length - n0);
    r = S.copiarPlancha('PLANO 02', 'PLANO 03'); plano.doc.refreshPages();
    v1 = S.valoresRotulo('PLANO 01 DE 01').valores; const v3 = S.valoresRotulo('PLANO 03').valores;
    check('M-13: tercera plancha = 03 de 03 y la primera pasa a «de 03»', v3.PLANCHA === '03' && v3.TOTAL === '03' && v1.TOTAL === '03', [v1.TOTAL, v3.PLANCHA, v3.TOTAL]);
    S.undo(); plano.doc.refreshPages();
    v1 = S.valoresRotulo('PLANO 01 DE 01').valores;
    check('M-13: ⌘Z quita la plancha y vuelve a «de 02»', !S.plancha('PLANO 03') && v1.TOTAL === '02', [v1.TOTAL, !!S.plancha('PLANO 03')]);
    S.llenarRotulo({ PLANCHA: 'E-1' }, { donde: 'PLANO 02' });
    S.copiarPlancha('PLANO 02', 'PLANO 03'); plano.doc.refreshPages();
    check('M-13: no pisa un número escrito a mano («E-1»)', S.valoresRotulo('PLANO 02').valores.PLANCHA === 'E-1' && S.valoresRotulo('PLANO 03').valores.PLANCHA === 'E-1', [S.valoresRotulo('PLANO 02').valores.PLANCHA, S.valoresRotulo('PLANO 03').valores.PLANCHA]);
    S.undo(); S.llenarRotulo({ PLANCHA: '=' }, { donde: 'todas' }); plano.doc.refreshPages();
    S.borrarPlancha('PLANO 02'); plano.doc.refreshPages();
    v1 = S.valoresRotulo('PLANO 01 DE 01').valores;
    check('M-13: borrar plancha vuelve a «01 de 01»', v1.PLANCHA === '01' && v1.TOTAL === '01', [v1.PLANCHA, v1.TOTAL]);
    S.undo(); plano.doc.refreshPages();
    // CHECKEPM: un rótulo que dice «de 01» en un plano de 2 planchas = ❌
    S.llenarRotulo({ TOTAL: '1' }, { donde: 'PLANO 02' }); // a mano: un número que no coincide
    const u8 = new TextEncoder().encode(S.serialize());
    let k = await ChecklistEPM.revisar(u8, { presentacion: 'PLANO 02' });
    let it = k.items.find((x) => x.id === 'rotulo');
    check('M-13: CHECKEPM marca ❌ «de 1» con 2 planchas', it && /de 1» pero el plano tiene 2 plancha/.test(JSON.stringify(it)), it && it.detalle.slice(0, 600));
    S.llenarRotulo({ TOTAL: '=' }, { donde: 'todas' });
    k = await ChecklistEPM.revisar(new TextEncoder().encode(S.serialize()), { presentacion: 'PLANO 02' });
    it = k.items.find((x) => x.id === 'rotulo');
    check('M-13: con «02 de 02» CHECKEPM ya no reclama la numeración', it && !/pero el plano tiene/.test(JSON.stringify(it)) && /✅ k\)/.test(it.detalle), it && it.detalle.slice(0, 600));
    const f = guardar('M13 planchas numeradas.dxf');
    const ez = py(EZ + `out['n'] = {l.name: {a.dxf.tag: a.dxf.text for e in l.query('INSERT') if e.dxf.name == 'EPM_ROTULO' for a in e.attribs if a.dxf.tag in ('PLANCHA','TOTAL')} for l in d.layouts if l.name != 'Model'}\nprint(json.dumps(out))`, f);
    check('M-13: ezdxf 0 errores y numeración en el archivo', ez.errores && !ez.errores.length && ez.n['PLANO 02'] && ez.n['PLANO 02'].TOTAL === '02', JSON.stringify(ez));
  }

  // ================================================================ MCP: carpetas permitidas, overwrite, Escritorio/Descargas
  {
    const { conectar, json, texto } = await import('../mcp/cliente.mjs');
    const PERM = path.join(SAL, 'permitida'); fs.mkdirSync(PERM, { recursive: true });
    const OTRA = fs.mkdtempSync(path.join(os.tmpdir(), 'domoplano-r2-no-permitida-'));
    const escritorio = path.join(os.homedir(), 'Desktop', 'domoplano_r2_no_deberia_existir.dxf');
    const descargas = path.join(os.homedir(), 'Downloads', 'domoplano_r2_no_deberia_existir.pdf');
    const yaEsc = fs.existsSync(escritorio), yaDes = fs.existsSync(descargas);
    const c = await conectar({ env: { DOMOPLANO_MCP_CARPETAS: PERM, HOME: os.homedir() } });
    const T = async (name, args) => { const x = await c.llamar(name, args); return { j: json(x), t: texto(x), err: !!x.isError }; };
    let x = await T('new_drawing', { plantilla: 'blanco' });
    x = await T('draw_line', { hoja: 'Modelo', puntos: [[0, 0], [10, 0]] });
    x = await T('status', {});
    check('MCP: status lista las carpetas permitidas', !x.err && x.j.escritura && x.j.escritura.carpetas_permitidas.some((p) => p.endsWith(path.join('r2', 'permitida'))), x.t.slice(0, 500));
    x = await T('save_drawing', { ruta: escritorio });
    check('MCP: no guarda en el Escritorio', x.err && /Escritorio o Descargas/.test(x.t) && fs.existsSync(escritorio) === yaEsc, x.t);
    x = await T('export_pdf', { ruta: descargas });
    check('MCP: no exporta a Descargas', x.err && /Escritorio o Descargas/.test(x.t) && fs.existsSync(descargas) === yaDes, x.t);
    const fuera = path.join(OTRA, 'no.dxf');
    x = await T('save_drawing', { ruta: fuera });
    check('MCP: no guarda en una carpeta que no está permitida', x.err && /no está permitida/.test(x.t) && !fs.existsSync(fuera), x.t);
    const bien = path.join(PERM, 'r2_mcp.dxf'); if (fs.existsSync(bien)) fs.unlinkSync(bien); if (fs.existsSync(bien + '.bak')) fs.unlinkSync(bien + '.bak');
    x = await T('save_drawing', { ruta: bien });
    check('MCP: guarda en la carpeta permitida', !x.err && fs.existsSync(bien), x.t);
    x = await T('draw_line', { hoja: 'Modelo', puntos: [[0, 5], [10, 5]] });
    x = await T('save_drawing', { ruta: bien });
    check('MCP: no reemplaza el archivo existente sin overwrite (ni siquiera el abierto)', x.err && /overwrite: true/.test(x.t), x.t);
    x = await T('save_drawing', { overwrite: true });
    check('MCP: overwrite: true reemplaza (y deja .bak)', !x.err && fs.existsSync(bien + '.bak'), x.t);
    x = await T('export_dxf', { ruta: path.join(PERM, '..', 'permitida', '..', '..', 'r2_escape.dxf') });
    check('MCP: «..» no escapa de la carpeta permitida', x.err && /no está permitida/.test(x.t), x.t);
    // la carpeta del plano abierto queda permitida aunque no esté en la lista
    const abierto = path.join(OTRA, 'abierto.dxf'); fs.copyFileSync(bien, abierto);
    x = await T('close_drawing', { descartar: true });
    x = await T('open_drawing', { ruta: abierto });
    x = await T('export_pdf', { ruta: path.join(OTRA, 'abierto.pdf') });
    check('MCP: la carpeta del plano abierto está permitida', !x.err && fs.existsSync(path.join(OTRA, 'abierto.pdf')), x.t);
    x = await T('export_pdf', { ruta: path.join(OTRA, 'abierto.pdf') });
    check('MCP: export_pdf tampoco reemplaza sin overwrite', x.err && /overwrite/.test(x.t), x.t);
    x = await T('run_command', { lineas: ['GUARDAR'] });
    check('MCP: run_command GUARDAR se rechaza (usar save_drawing)', x.err && /save_drawing/.test(x.t), x.t);
    await T('close_drawing', { descartar: true });
    await c.cerrar();
    fs.rmSync(OTRA, { recursive: true, force: true });
    const skill = fs.readFileSync(path.join(os.homedir(), '.claude', 'skills', 'domoplano-mcp', 'SKILL.md'), 'utf8');
    check('MCP: la skill documenta carpetas permitidas y overwrite (≤ 1024 palabras)', /carpetas permitidas/i.test(skill) && /overwrite/.test(skill) && skill.split(/\s+/).filter(Boolean).length <= 1024, skill.split(/\s+/).length);
  }

  // ================================================================ Ventanas de terceros: giro (VIEWTWIST) y recorte de polígono (VPCLIP)
  {
    const f = path.join(SAL, 'ventana girada y recortada (ezdxf).dxf');
    const mk = py(`import ezdxf, json, sys, math
d = ezdxf.new('R2010'); m = d.modelspace(); d.header['$INSUNITS'] = 6
T = (1156591.77, 1280814.82)
def cuadro(x, y, l, color):
    h = m.add_hatch(color=color); h.paths.add_polyline_path([(x-l, y-l), (x+l, y-l), (x+l, y+l), (x-l, y+l)], is_closed=True); h.set_solid_fill(color=color)
# punto A: a 20 m del objetivo en la dirección 30° (en el papel debe quedar a la derecha del centro, horizontal)
a = math.radians(30); A = (T[0] + 20*math.cos(a), T[1] + 20*math.sin(a))
cuadro(A[0], A[1], 1.0, 1)
# punto B: a 20 m en la dirección 120° (queda arriba del centro, dentro del rectángulo pero FUERA del triángulo de recorte)
b = math.radians(120); B = (T[0] + 20*math.cos(b), T[1] + 20*math.sin(b))
cuadro(B[0], B[1], 1.0, 5)
ps = d.layouts.get('Layout1'); ps.page_setup(size=(420, 297), margins=(0, 0, 0, 0), units='mm')
vp = ps.add_viewport(center=(200, 150), size=(160, 120), view_center_point=(10, 0), view_height=60)
vp.dxf.view_target_point = (T[0], T[1], 0); vp.dxf.view_twist_angle = -30 + 360
# ventana 2: igual, recortada por un triángulo que deja por fuera la parte de arriba
vp2 = ps.add_viewport(center=(200, 150), size=(160, 120), view_center_point=(10, 0), view_height=60)
vp2.dxf.view_target_point = (T[0], T[1], 0); vp2.dxf.view_twist_angle = 330
tri = ps.add_lwpolyline([(120, 90), (280, 90), (280, 210)], close=True)
vp.dxf.status = 2; vp2.dxf.status = 3
vp2.dxf.clipping_boundary_handle = tri.dxf.handle; vp2.dxf.flags = vp2.dxf.flags | 65536
vp.dxf.flags = vp.dxf.flags | 131072  # la primera apagada: se prueba la recortada
d.saveas(sys.argv[1]); print(json.dumps({'ok': 1}))`, f);
    check('VPCLIP/giro: DXF de prueba con ezdxf', mk.ok === 1, JSON.stringify(mk));
    const doc = await DXF.open(new Uint8Array(fs.readFileSync(f)));
    const pl = doc.pages.find((p) => p.title === 'Layout1'); await pl.build();
    const vi = pl.vpInfo.find((v) => v.rec.int(90, 0) & 65536);
    // AutoCAD: papel = centro + k·(R(giro)·(P − objetivo) − centroDCS); k = 120/60 = 2; giro 330° = −30°
    const T = [1156591.77, 1280814.82], A = [T[0] + 20 * Math.cos(Math.PI / 6), T[1] + 20 * Math.sin(Math.PI / 6)];
    const ap = vi && [vi.m[0] * A[0] + vi.m[2] * A[1] + vi.m[4], vi.m[1] * A[0] + vi.m[3] * A[1] + vi.m[5]];
    check('Giro: el punto a 20 m en 30° cae a (200 + 2·(20 − 10), 150) = (220, 150)', ap && near(ap[0], 220, 1e-6) && near(ap[1], 150, 1e-6), ap);
    const S2 = new Edit.Session(doc); const vpRec = vi && vi.rec;
    const C = S2.centroVistaVentana(vpRec);
    check('Giro: centroVistaVentana = objetivo + centro desgirado', near(C[0], T[0] + 10 * Math.cos(Math.PI / 6), 1e-6) && near(C[1], T[1] + 10 * Math.sin(Math.PI / 6), 1e-6), C);
    S2.girarVentana(vpRec, 0); doc.invalidate(); await pl.build();
    const C2 = S2.centroVistaVentana(vpRec);
    check('VGIRO conserva el punto del modelo en el centro de la ventana', near(C2[0], C[0], 1e-6) && near(C2[1], C[1], 1e-6), [C, C2]);
    S2.undo(); doc.invalidate(); await pl.build();
    const out = path.join(SAL, 'ventana girada y recortada.pdf');
    const rp = await exportarPDF(f, out, { planchas: ['Layout1'], color: 'color' });
    const px = py(`import fitz, json, sys
d = fitz.open(sys.argv[1]); p = d[0]; z = 4; pix = p.get_pixmap(matrix=fitz.Matrix(z, z))
W, H = pix.width, pix.height; mm = 72/25.4*z
def tinta(x, y, r=1.0):
    n = 0
    for yy in range(int((297-y-r)*mm), int((297-y+r)*mm)):
        for xx in range(int((x-r)*mm), int((x+r)*mm)):
            c = pix.pixel(xx, yy)
            if c[0] < 200 or c[1] < 200 or c[2] < 200: n += 1
    return n
# A: (220, 150) dentro del triángulo · B: 20 m a 120° → R(-30°)·(cos120, sin120)·20 = (0, 20) → papel (200 + 2·(0 − 10), 150 + 40) = (180, 190): fuera del triángulo
print(json.dumps({'A': tinta(220, 150, 1.5), 'B': tinta(180, 190, 1.5)}))`, rp.salida);
    check('VPCLIP: en el PDF se ve lo que cae dentro del polígono', px.A > 20, JSON.stringify(px));
    check('VPCLIP: en el PDF NO se ve lo que cae fuera del polígono (aunque esté dentro del rectángulo)', px.B === 0, JSON.stringify(px));
    const { exportarDXF } = require('../cli/dxf_a_dwf.js');
    const rd = await exportarDXF(f, path.join(SAL, 'ventana girada y recortada.dwf'), { plancha: 'Layout1' });
    check('VPCLIP/giro: DWF sin avisos y con los rellenos de la ventana', rd.bytes > 0 && !rd.stats.warnings.length && rd.stats.fills >= 1, JSON.stringify(rd.stats));
  }

  console.log(`R2: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
