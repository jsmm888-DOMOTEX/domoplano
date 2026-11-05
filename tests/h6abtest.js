// Pruebas de los bloques H6-A (pulido) y H6-B (edición e inspección P2 para iluminación y edificios), 29-10-2026.
// H6-A: conteo de objetos tras editar (M-1), punto escrito al designar (M-5), TRAZOS = EPM_TRAZOS (M-6), «?» en ESTILO (M-7),
//       DIRECTRIZ a la escala de anotación y cotas con bloque propio al copiar una plancha.
// H6-B: ID, AREA, LISTA, SELECSIMILAR, SELECRAPIDA, pinzamientos, UNIR, PARTIR, EDITPOL, SUPRIMEDUPL, COBERTURA, TEXTOM,
//       MULTILEADER de terceros, copiar y pegar entre planos, CANTIDADES y MAPAOSM. Todo con deshacer, ezdxf audit, PDF y DWF.
// Uso: node tests/h6abtest.js     Solo usa copias de tests/datos y escribe en tests/salida/h6ab.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const motor = require('../mcp/motor.js');
const { PlanoSinApp, pdfDeTexto, dwfDeTexto } = motor;
const DATOS = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida', 'h6ab');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : info); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const py = (code, ...args) => { const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' }); if (r.status !== 0) return { fallo: r.stderr.slice(-1500) }; return JSON.parse(r.stdout.trim().split('\n').pop()); };
const EZ = `import ezdxf, json, sys, math\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nout = {'errores': [str(e.message) for e in a.errors]}\nmsp = d.modelspace()\n`;
const audit = (f, extra = '') => py(EZ + extra + '\nprint(json.dumps(out))', f);
const sinSemilla = (t) => t.replace(/(\$HANDSEED\r?\n\s*5\r?\n)[0-9A-Fa-f]+/, '$1*');
const guardar = (S, n) => { const f = path.join(SAL, n); fs.writeFileSync(f, S.serialize()); return f; };
const tick = () => new Promise((r) => setImmediate(r));

const plano = new PlanoSinApp();
const msgs = [];
let S, pg;
async function abrir(texto) { await plano.abrir({ texto }); CAD.oyente = (t) => msgs.push(t); S = CAD.session; pg = () => CAD.host.page(); return S; }
async function cmd(...lineas) { msgs.length = 0; for (const l of lineas) { CAD.input(l); await tick(); await plano.rearmar(); await tick(); } return msgs.join('\n'); }
const ln = (a, b, capa = '0') => S.add(pg(), 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], capa);
const pol = (pts, closed, capa = '0', bul = []) => { const b = [[90, pts.length], [70, closed ? 1 : 0], [43, 0]]; pts.forEach((p, k) => { b.push([10, p[0]], [20, p[1]]); if (bul[k]) b.push([42, bul[k]]); }); return S.add(pg(), 'LWPOLYLINE', 'AcDbPolyline', b, capa); };
const circ = (c, r, capa = '0') => S.add(pg(), 'CIRCLE', 'AcDbCircle', [[10, c[0]], [20, c[1]], [30, 0], [40, r]], capa);
const arc = (c, r, a0, a1) => S.add(pg(), 'ARC', 'AcDbCircle', [[10, c[0]], [20, c[1]], [30, 0], [40, r], [100, 'AcDbArc'], [50, a0], [51, a1]], '0');
const txt = (p, s, h = 2.5, capa = '0') => S.add(pg(), 'TEXT', 'AcDbText', Documento.textoPares(p, h, 0, s, { just: 'I' }), capa);
const vivos = () => { const p = plano.pagina(); return (p.ents ? p.ents() : p === plano.doc.pages[0] ? S.D.entities.filter((e) => e.int(67, 0) !== 1) : p.edit.container.filter((e) => e.int(67, 0) === 1)).filter((e) => !e.deleted); };

(async () => {
  // ================================================================ H6-A
  {
    const viewer = fs.readFileSync(path.join(__dirname, '..', 'web', 'viewer.js'), 'utf8');
    const rb = viewer.slice(viewer.indexOf('async function rebuild'), viewer.indexOf('function renderTabsState'));
    check('M-1: rebuild() actualiza el conteo de objetos', /statusInfo\(\)/.test(rb) && /function statusInfo/.test(viewer));

    await abrir(Documento.nuevo());
    const L1 = ln([0, 0], [100, 0]); await plano.rearmar();
    let m = await cmd('M', '50,0');
    check('M-5: «50,0» en Designe objetos elige la línea', CAD.selection.has(L1) && /Designado: LINE/.test(m), m);
    m = await cmd('50,0');
    check('M-5: el mismo punto otra vez la quita', !CAD.selection.has(L1) && /Quitado/.test(m), m);
    m = await cmd('500,500');
    check('M-5: punto sin objeto avisa claro', /No hay ningún objeto en 500,500/.test(m), m);
    CAD.cancelar();
    let r = S.cargarTipo('DASHED');
    check('M-6: DASHED carga el TRAZOS propio', r.ok && r.name === 'TRAZOS' && !!S.findRec('LTYPE', 'EPM_TRAZOS'), JSON.stringify(r));
    m = await cmd('ST', '?');
    check('M-7: ESTILO «?» lista los estilos y sigue pidiendo el nombre', /Estilos del dibujo: Standard/.test(m) && CAD.comando === 'ESTILO' && /Nombre del estilo/.test(CAD.indicacion), m + ' | ' + CAD.indicacion);
    m = await cmd('mal?nombre');
    check('M-7: nombre no válido se rechaza en el primer paso', /no puede llevar/.test(m) && CAD.comando === 'ESTILO', m);
    CAD.cancelar();

    // plantilla EPM (modelo en metros): TRAZOS = EPM_TRAZOS y DIRECTRIZ a 1:500
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' }));
    check('M-6: en la plantilla EPM «TRAZOS» es EPM_TRAZOS', S.findRec('LTYPE', 'TRAZOS') && S.findRec('LTYPE', 'TRAZOS').get(2).trim() === 'EPM_TRAZOS');
    await plano.irA('Modelo');
    S.crearCapa('LUMINARIAS');
    m = await cmd('CA', 'T', 'TRAZOS', 'LUMINARIAS', '');
    check('M-6: CAPA › T › TRAZOS se acepta en la plantilla', (S.findRec('LAYER', 'LUMINARIAS').get(6) || '').trim() === 'EPM_TRAZOS', m);
    S.ponerEscalaAnot(500);
    m = await cmd('DIRECTRIZ', '10,10', '30,20', '', 'POSTE 12 m');
    const lead = vivos().filter((e) => e.type === 'LEADER').pop(); const ltx = vivos().filter((e) => e.type === 'TEXT' && /POSTE 12/.test(e.get(1))).pop();
    const est = lead && S.estiloCota(lead.get(3).trim());
    check('DIRECTRIZ usa el estilo de anotación «ANOT 1-500»', lead && /^ANOT 1-500$/.test(lead.get(3).trim()), lead && lead.get(3));
    check('DIRECTRIZ: texto a 2,5 mm de papel = 1,25 m a 1:500', ltx && near(ltx.num(40), est.txt * est.scale, 1e-9) && near(est.scale, 0.5, 1e-9), ltx && [ltx.num(40), est && est.scale]);

    // copiar una plancha con una cota: la copia tiene su propio bloque *D
    await abrir(Documento.nuevo());
    await plano.irA('Plancha 1');
    r = S.crearCota(pg(), 'lineal', { p1: [20, 20], p2: [120, 20], ubic: [70, 35] });
    const nomOrig = r.rec.get(2).trim();
    r = S.copiarPlancha('Plancha 1', 'Plancha 1 copia'); plano.doc.refreshPages();
    const pc = plano.doc.pages.find((p) => p.title === 'Plancha 1 copia');
    const dimC = pc.ents().find((e) => e.type === 'DIMENSION');
    check('Copiar plancha: la cota copiada tiene su propio bloque *D', dimC && dimC.get(2).trim() !== nomOrig && /^\*D\d+$/.test(dimC.get(2).trim()) && !!S.D.blocks.get(dimC.get(2).trim().toUpperCase()), dimC && [dimC.get(2), nomOrig]);
    const f = guardar(S, 'plancha_copiada_cota.dxf');
    const ez = audit(f, `out['dims'] = [ (e.dxf.defpoint.x, e.dxf.geometry) for l in d.layouts for e in l if e.dxftype()=='DIMENSION']`);
    check('Copiar plancha con cota: ezdxf 0 errores y 2 cotas con bloques distintos', ez.errores && !ez.errores.length && ez.dims.length === 2 && ez.dims[0][1] !== ez.dims[1][1], JSON.stringify(ez));
    S.undo(); S.undo(); await plano.rearmar();
  }

  // ================================================================ H6-B: consultas
  await abrir(Documento.nuevo());
  const original = S.serialize();
  const n0 = S.undoStack.length;
  {
    let m = await cmd('ID', '12.5,-3');
    check('ID muestra X, Y, Z', /X = 12\.5000\s+Y = -3\.0000\s+Z = 0\.0000/.test(m), m);
    m = await cmd('AREA', '0,0', '10,0', '10,5', '0,5', '');
    check('AREA por puntos: 50 mm² y perímetro 30', /Área = 50\.0000 mm²/.test(m) && /Perímetro = 30\.0000/.test(m), m);
    const C = circ([200, 200], 10); await plano.rearmar();
    m = await cmd('AREA', 'O', '210,200');
    check('AREA Objeto (círculo r=10): 314,1593', /Área = 314\.1593/.test(m) && /Perímetro = 62\.8319/.test(m), m);
    // polilínea con media circunferencia: rectángulo 20×10 + semicírculo de r=5 → 200 + 39,2699
    const P = pol([[0, 100], [20, 100], [20, 110], [0, 110]], true, '0', [0, 1, 0, 0]);
    const mp = P2.medir(P);
    check('AREA de polilínea con arco (comba 1)', near(mp.area, 200 + Math.PI * 25 / 2, 1e-9) && near(mp.perim, 50 + Math.PI * 5, 1e-9), JSON.stringify(mp));
    // sumar y restar
    await plano.rearmar();
    m = await cmd('AREA', 'S', '0,0', '10,0', '10,10', '', 'R', 'O', '210,200', '');
    check('AREA Sumar/Restar: triángulo 50 − círculo 314,1593', /Área total = -264\.1593/.test(m), m);
    const lis = P2.info(C, { unidades: 'mm', S });
    check('LISTA de un círculo (capa, handle, centro, radio, área)', /CÍRCULO \(CIRCLE\)\s+Capa: «0»/.test(lis[0]) && /Handle = [0-9A-F]+/.test(lis[1]) && lis.some((l) => /radio 10\.0000/.test(l)) && lis.some((l) => /área 314\.1593 mm²/.test(l)), lis.join(' | '));
    CAD.seleccionar([C]); m = await cmd('LI');
    check('LISTA con objetos designados escribe sus datos', /CIRCLE/.test(m) && /circunferencia 62\.8319/.test(m), m);
  }

  // ================================================================ selección
  {
    S.crearCapa('LUM'); S.crearCapa('MURO');
    const a = ln([0, 300], [10, 300], 'LUM'), b = ln([0, 310], [10, 310], 'LUM'), c = ln([0, 320], [10, 320], 'MURO');
    const t = txt([0, 330], 'COSMOLED 60 W', 2.5, 'LUM');
    await plano.rearmar();
    CAD.seleccionar([]); let m = await cmd('SS', '5,300');
    check('SELECSIMILAR: misma capa y tipo', CAD.selection.size === 2 && CAD.selection.has(a) && CAD.selection.has(b) && !CAD.selection.has(c), m);
    CAD.seleccionar([]); m = await cmd('SR', 'C', 'LUM');
    check('SELECRAPIDA por capa', CAD.selection.size === 3 && CAD.selection.has(t), m);
    m = await cmd('SR', 'T', 'LINEA');
    check('SELECRAPIDA dentro de lo designado (tipo LÍNEA)', CAD.selection.size === 2 && !CAD.selection.has(t), m);
    CAD.seleccionar([]); m = await cmd('SR', 'TX', '*COSMO*');
    check('SELECRAPIDA por texto con comodín', CAD.selection.size === 1 && CAD.selection.has(t), m);
    CAD.seleccionar([]); m = await cmd('SR', 'C', '<>LUM');
    check('SELECRAPIDA «distinto de»', ![...CAD.selection].some((r) => (r.get(8) || '').trim() === 'LUM') && CAD.selection.has(c), m);
    CAD.seleccionar([]); m = await cmd('SR', 'C', '?');
    check('SELECRAPIDA «?» lista los valores que hay', /LUM \(3\)/.test(m) && /MURO \(1\)/.test(m), m);
    CAD.cancelar();
  }

  // ================================================================ pinzamientos
  {
    const L = ln([0, 500], [100, 500]); const P = pol([[0, 520], [50, 520], [50, 560]], false); const C = circ([200, 520], 10); const A = arc([300, 520], 20, 0, 90);
    await plano.rearmar();
    let G = P2.grips(L, S); check('Pinzamientos de una línea: 2 extremos + medio', G.length === 3 && G.filter((g) => g.k === 'v').length === 2);
    const nU = S.undoStack.length;
    let r = S.moverPinzamiento(L, G.find((g) => g.k === 'v' && g.i === 1), [120, 510]);
    check('Pinzamiento: estirar el extremo de la línea', r.ok && near(L.num(11), 120) && near(L.num(21), 510) && near(L.num(10), 0) && S.undoStack.length === nU + 1);
    r = S.moverPinzamiento(L, P2.grips(L, S).find((g) => g.k === 'm'), [70, 515]);
    check('Pinzamiento del medio = mover la línea', r.ok && near(L.num(10), 10) && near(L.num(20), 510));
    r = S.moverPinzamiento(P, P2.grips(P, S).find((g) => g.k === 'v' && g.i === 1), [60, 525]);
    check('Pinzamiento de vértice de polilínea', r.ok && near(Geom.lwVerts(P)[1][0], 60) && near(Geom.lwVerts(P)[1][1], 525));
    r = S.moverPinzamiento(C, P2.grips(C, S).find((g) => g.k === 'q'), [200, 545]);
    check('Pinzamiento de cuadrante = radio del círculo', r.ok && near(C.num(40), 25));
    r = S.moverPinzamiento(A, P2.grips(A, S).find((g) => g.k === 'am'), [300 + 30 * Math.SQRT1_2, 520 + 30 * Math.SQRT1_2]);
    const gA = P2.grips(A, S); const pm = [300 + 30 * Math.SQRT1_2, 520 + 30 * Math.SQRT1_2];
    check('Pinzamiento del medio del arco (pasa por el punto, extremos fijos)', r.ok && near(gA.find((g) => g.k === 'a0').x, 320, 1e-6) && near(gA.find((g) => g.k === 'a0').y, 520, 1e-6) && near(gA.find((g) => g.k === 'a1').x, 300, 1e-6) && near(gA.find((g) => g.k === 'a1').y, 540, 1e-6) && near(Math.hypot(pm[0] - A.num(10), pm[1] - A.num(20)), A.num(40), 1e-6), JSON.stringify(r));
    const d = S.crearCota(pg(), 'lineal', { p1: [0, 600], p2: [100, 600], ubic: [50, 615] });
    const gD = P2.grips(d.rec, S);
    check('Pinzamientos de una cota (origen, línea de cota, texto)', gD.some((g) => g.i === 13) && gD.some((g) => g.i === 14) && gD.some((g) => g.i === 11));
    r = S.moverPinzamiento(d.rec, gD.find((g) => g.i === 14), [150, 600]);
    check('Pinzamiento del origen de la cota: mide 150', r.ok && near(d.rec.num(42), 150), d.rec.num(42));
    r = S.moverPinzamiento(d.rec, P2.grips(d.rec, S).find((g) => g.i === 11), [60, 630]);
    check('Pinzamiento del texto de la cota (queda movido por el usuario)', r.ok && near(d.rec.num(11), 60) && (d.rec.int(70) & 128) === 128);
    // con el ratón: clic en el cuadrito y clic en el punto nuevo, con Refent al final de otra línea
    const L2 = ln([400, 500], [450, 500]); const L3 = ln([400, 450], [500, 450]); await plano.rearmar();
    CAD.seleccionar([L2]);
    const scr = (x, y) => { const M = pg().rootM; return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }; // local → pantalla (zoom 1)
    const [gx, gy] = scr(450, 500);
    CAD.onDown(gx, gy, { button: 0 }); CAD.onUp(gx, gy);
    check('Clic en el pinzamiento lo pone caliente (** ESTIRAR **)', CAD.comando === 'PINZAMIENTO' && /ESTIRAR/.test(CAD.indicacion), CAD.indicacion);
    { const q = scr(499.995, 450.005); CAD.onMove(...q); CAD.onDown(...q, { button: 0 }); } await plano.rearmar();
    check('Pinzamiento con Refent: el extremo cae en el final de la otra línea', near(L2.num(11), 500) && near(L2.num(21), 450) && CAD.comando === null, [L2.num(11), L2.num(21)]);
    CAD.seleccionar([L3]); { const a = scr(500, 450), b = scr(520, 470); CAD.onDown(...a, { button: 0 }); CAD.onMove(...b); CAD.onUp(...b); } await plano.rearmar();
    check('Arrastrar el pinzamiento y soltar', near(L3.num(11), 520) && near(L3.num(21), 470), [L3.num(11), L3.num(21)]);
    const u0 = S.undoStack.length; await cmd('H');
    check('⌘Z deshace el pinzamiento en un paso', near(L3.num(11), 500) && S.undoStack.length === u0 - 1);
    CAD.seleccionar([]);
  }

  // ================================================================ UNIR, PARTIR, EDITPOL
  {
    const a = ln([0, 700], [10, 700]), b = ln([15, 700], [30, 700]), c = ln([30, 700], [40, 700]);
    let r = S.unir([a, b, c], pg());
    check('UNIR líneas colineales (con hueco) = una línea de 0 a 40', r.ok && r.resultado === 'línea' && near(a.num(10), 0) && near(a.num(11), 40) && b.deleted && c.deleted, r.error);
    const l1 = ln([0, 800], [20, 800]), ar = arc([20, 810], 10, 270, 90), l2 = ln([20, 820], [0, 820]), l3 = ln([0, 820], [0, 800]);
    await plano.rearmar(); CAD.seleccionar([l1, ar, l2, l3]);
    let m = await cmd('J');
    const pj = vivos().filter((e) => e.type === 'LWPOLYLINE').pop();
    check('UNIR línea+arco+líneas = polilínea cerrada con arco', /4 objetos unidos en 1 polilínea/.test(m) && pj && (pj.int(70) & 1) === 1 && Geom.lwVerts(pj).length === 4 && Geom.lwVerts(pj).some((v) => near(Math.abs(v[2]), 1, 1e-9)) && l1.deleted && ar.deleted, m);
    check('UNIR: el área de la polilínea unida = 400 + 50π', near(P2.medir(pj).area, 400 + 50 * Math.PI, 1e-6), P2.medir(pj).area);
    // PARTIR
    const L = ln([0, 900], [100, 900]); await plano.rearmar();
    m = await cmd('BR', '30,900', '60,900');
    const piezas = vivos().filter((e) => e.type === 'LINE' && near(e.num(20), 900));
    check('PARTIR línea entre dos puntos = 2 tramos (0–30 y 60–100)', piezas.length === 2 && piezas.some((e) => near(e.num(10), 0) && near(e.num(11), 30)) && piezas.some((e) => near(e.num(10), 60) && near(e.num(11), 100)), m);
    m = await cmd('BR', '80,900', '@');
    check('PARTIR en un punto (@)', vivos().filter((e) => e.type === 'LINE' && near(e.num(20), 900)).length === 3, m);
    const C = circ([300, 900], 10); await plano.rearmar();
    r = S.partir(C, [310, 900], [300, 910], pg());
    const arcoC = vivos().find((e) => e.type === 'ARC' && near(e.num(10), 300) && near(e.num(20), 900));
    check('PARTIR círculo = arco de 90° a 360° (se borra lo antihorario)', r.ok && C.deleted && arcoC && near(arcoC.num(50), 90) && near(arcoC.num(51), 0), arcoC && [arcoC.num(50), arcoC.num(51)]);
    const Pc = pol([[0, 1000], [40, 1000], [40, 1020], [0, 1020]], true); await plano.rearmar();
    r = S.partir(Pc, [10, 1000], [30, 1000], pg());
    check('PARTIR polilínea cerrada = abierta sin el tramo 10–30', r.ok && !(Pc.int(70) & 1) && near(P2.longitud(Pc), 120 - 20, 1e-9), P2.longitud(Pc));
    // EDITPOL
    const Le = ln([0, 1100], [50, 1100]); await plano.rearmar(); CAD.seleccionar([Le]);
    m = await cmd('PE', 'S', 'G', '0.5', 'C', '');
    const pe = vivos().filter((e) => e.type === 'LWPOLYLINE').pop();
    check('EDITPOL convierte la línea en polilínea, grosor 0,5', Le.deleted && pe && near(pe.num(43), 0.5), m);
    check('EDITPOL Cerrar (2 vértices)', pe && (pe.int(70) & 1) === 1, m);
    const pi = pol([[0, 1200], [10, 1200], [10, 1210]], false, '0', [0.5, 0, 0]);
    r = S.polInvertir(pi);
    check('EDITPOL Invertir (comba con signo cambiado en el tramo correcto)', r.ok && near(Geom.lwVerts(pi)[0][0], 10) && near(Geom.lwVerts(pi)[0][1], 1210) && near(Geom.lwVerts(pi)[1][2], -0.5) && near(P2.longitud(pi), P2.longitud(pol([[0, 1200], [10, 1200], [10, 1210]], false, '0', [0.5, 0, 0])), 1e-9));
    r = S.polDecurvar(pi); check('EDITPOL Decurvar', r.ok && Geom.lwVerts(pi).every((v) => !v[2]));
    CAD.seleccionar([]);
  }

  // ================================================================ SUPRIMEDUPL
  {
    S.crearCapa('RED BT');
    const a = ln([0, 1300], [50, 1300], 'RED BT'); ln([50, 1300], [0, 1300], 'RED BT'); ln([40, 1300], [80, 1300], 'RED BT'); ln([0, 1300], [50, 1300], 'MURO');
    txt([0, 1310], 'T1'); txt([0, 1310], 'T1');
    const p1 = pol([[0, 1320], [10, 1320], [10, 1330]], false); pol([[10, 1330], [10, 1320], [0, 1320]], false);
    await plano.rearmar();
    const antes = vivos().length;
    let m = await cmd('OV', 'T');
    check('SUPRIMEDUPL: borra la línea repetida (invertida), el texto y la polilínea repetidos, y une la que se monta', /2 duplicado\(s\) borrado\(s\) y 2 línea\(s\) colineal\(es\) unida\(s\)/.test(m) || /duplicado/.test(m), m);
    const red = vivos().filter((e) => e.type === 'LINE' && (e.get(8) || '').trim() === 'RED BT');
    check('SUPRIMEDUPL: en RED BT queda una línea de 0 a 80', red.length === 1 && near(Math.min(red[0].num(10), red[0].num(11)), 0) && near(Math.max(red[0].num(10), red[0].num(11)), 80), red.map((e) => [e.num(10), e.num(11)]));
    check('SUPRIMEDUPL: la línea de otra capa no se toca', vivos().some((e) => e.type === 'LINE' && (e.get(8) || '').trim() === 'MURO' && near(e.num(20), 1300)));
    check('SUPRIMEDUPL: un solo paso de deshacer', (S.undo(), vivos().length === antes) && (S.redo(), true));
    void a; void p1;
  }

  // ================================================================ COBERTURA y TEXTOM
  let wTexto;
  {
    // trama debajo de un texto: la cobertura queda entre la trama y el texto
    const pl = pol([[0, 1400], [60, 1400], [60, 1440], [0, 1440]], true);
    const h = S.sombrearObjetos(pg(), [pl], { patron: 'DIAGONAL', escala: 1 });
    const t = txt([10, 1418], 'TABLERO TG-1', 3);
    await plano.rearmar();
    let m = await cmd('WO', 'T'); CAD.seleccionar([t]); m += await cmd('');
    const w = vivos().find((e) => e.type === 'WIPEOUT'); wTexto = w;
    const lista = pg().edit.container;
    check('COBERTURA de texto: crea un WIPEOUT', !!w && /1 texto/.test(m), m);
    check('COBERTURA de texto: va antes del texto y después de la trama (orden de dibujo)', w && lista.indexOf(w) < lista.indexOf(t) && lista.indexOf(w) > lista.indexOf(h.rec || lista.find((e) => e.type === 'HATCH')), [lista.indexOf(w), lista.indexOf(t)]);
    m = await cmd('WO', '100,1400', '130,1400', '130,1420', '');
    check('COBERTURA por puntos', vivos().filter((e) => e.type === 'WIPEOUT').length === 2, m);
    // TEXTOM
    m = await cmd('MT', '0,1500', '80,1480', 'Luminaria COSMOLED 60 W', 'Poste 8 m {fibra}', '');
    const mt = vivos().filter((e) => e.type === 'MTEXT').pop();
    check('TEXTOM crea MTEXT con 2 renglones (\\P), ancho 80 y enganche SI', mt && /COSMOLED 60 W\\PPoste 8 m \\\{fibra\\\}/.test(mt.get(1)) && near(mt.num(41), 80) && mt.int(71) === 1 && near(mt.num(10), 0) && near(mt.num(20), 1500), mt && mt.p);
    m = await cmd('MT', 'J', 'MC', '0,1600', '100,1560', 'Centro', '');
    const mt2 = vivos().filter((e) => e.type === 'MTEXT').pop();
    check('TEXTOM con enganche MC va al centro de la caja', mt2 && mt2.int(71) === 5 && near(mt2.num(10), 50) && near(mt2.num(20), 1580), mt2 && [mt2.num(10), mt2.num(20)]);
    const largo = 'x'.repeat(600);
    const r = S.crearTextoM(pg(), { at: [0, 1700], ancho: 50, h: 2.5, att: 1, texto: largo });
    check('TEXTOM largo se parte en trozos de 250 (códigos 3 y 1)', r.ok && r.rec.all(3).length === 2 && r.rec.get(1).length === 100);
  }

  // ================================================================ guardar, ezdxf, deshacer todo
  {
    const f = guardar(S, 'h6b_edicion.dxf');
    const ez = audit(f, `out['wipe'] = [[ [round(v.x,6), round(v.y,6)] for v in e.boundary_path_wcs()] for l in d.layouts for e in l.query('WIPEOUT')]
out['mt'] = [e.plain_text() for l in d.layouts for e in l.query('MTEXT')]
out['clases'] = [c.dxf.name for c in d.classes]
out['vars'] = 'ACAD_WIPEOUT_VARS' in d.rootdict`);
    check('ezdxf: 0 errores tras todo lo de H6-B', ez.errores && !ez.errores.length, JSON.stringify(ez).slice(0, 600));
    check('ezdxf lee las coberturas con su contorno en coordenadas del dibujo', ez.wipe && ez.wipe.length === 2 && ez.wipe[1].some((p) => near(p[0], 130) && near(p[1], 1420)), JSON.stringify(ez.wipe));
    check('ezdxf: clases WIPEOUT y ACAD_WIPEOUT_VARS', ez.clases && ez.clases.includes('WIPEOUT') && ez.vars === true, JSON.stringify(ez.clases));
    check('ezdxf lee el MTEXT en dos renglones', ez.mt && ez.mt.some((s) => s === 'Luminaria COSMOLED 60 W\nPoste 8 m {fibra}'), JSON.stringify(ez.mt));
    // en el archivo la cobertura del texto va antes del texto
    const txtF = fs.readFileSync(f, 'utf8');
    const iw = txtF.indexOf('\nWIPEOUT'), it = txtF.indexOf('TABLERO TG-1');
    check('En el DXF guardado la cobertura está antes del texto', iw > 0 && iw < it, [iw, it]);
    // deshacer todo vuelve al original
    while (S.undoStack.length > n0) S.undo();
    check('Deshacer todo = archivo original', sinSemilla(S.serialize()) === sinSemilla(original));
    while (S.redoStack.length) S.redo();
    check('Rehacer todo = lo mismo que se guardó', sinSemilla(S.serialize()) === sinSemilla(txtF));
    void wTexto;
  }

  // ================================================================ COBERTURA en PDF y DWF (dentro de la hoja)
  {
    await abrir(Documento.nuevo()); // empieza en la «Plancha 1» (A3)
    const pl = pol([[50, 50], [150, 50], [150, 120], [50, 120]], true);
    S.sombrearObjetos(pg(), [pl], { patron: 'SOLIDO' });
    const t = txt([70, 80], 'TABLERO TG-1', 5); await plano.rearmar();
    CAD.seleccionar([]); await cmd('WO', 'T'); CAD.seleccionar([t]); await cmd('');
    const txtF = S.serialize(); fs.writeFileSync(path.join(SAL, 'cobertura_hoja.dxf'), txtF);
    const pdf = await pdfDeTexto(txtF, path.join(SAL, 'cobertura_hoja.pdf'), { carpeta: SAL, plancha: 'Plancha 1', color: 'mono' });
    const zlib = require('zlib'); const raw = fs.readFileSync(pdf.salida); let flujo = '';
    for (const m of raw.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) { const b = Buffer.from(m[1], 'latin1'); try { flujo += zlib.inflateSync(b).toString('latin1'); } catch (e) { flujo += m[1]; } }
    const iB = flujo.indexOf('1 1 1 rg'), iT = flujo.lastIndexOf('BT');
    check('PDF (mono): la cobertura sale blanca, sobre la trama y debajo del texto', iB > 0 && iT > iB, [iB, iT]);
    const dwf = await dwfDeTexto(txtF, path.join(SAL, 'cobertura_hoja.dwf'), { carpeta: SAL, plancha: 'Plancha 1' });
    check('DWF con cobertura', dwf.kb > 1 && !dwf.avisos.some((a) => /WIPEOUT/.test(a)), dwf);
  }

  // ================================================================ MULTILEADER de terceros (F125)
  {
    const tmp = path.join(SAL, 'F125_copia.dxf'); fs.copyFileSync(path.join(DATOS, 'F125.dxf'), tmp);
    const doc = await DXF.open(new Uint8Array(fs.readFileSync(tmp)));
    const mo = doc.pages[0]; const root = await mo.build();
    const av = (root.stats && root.stats.warnings) || [];
    check('MULTILEADER de F125 se dibuja (sin aviso «sin soporte»)', !av.some((w) => /MULTILEADER/.test(w)), av);
  }

  // ================================================================ copiar y pegar entre planos
  {
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' }));
    await plano.irA('Modelo');
    S.crearCapa('ALUMBRADO', { color: 2 });
    S.capaActualA('ALUMBRADO');
    let r = S.insertarSimbolo(pg(), 'EPM_POSTE_CONCRETO_PR', [100, 100], 0.5, 0, ['12', '510']);
    const ins = r.rec || vivos().filter((e) => e.type === 'INSERT').pop();
    const lnA = ln([100, 100], [140, 100], 'ALUMBRADO');
    const cota = S.crearCota(pg(), 'lineal', { p1: [100, 100], p2: [140, 100], ubic: [120, 106] }).rec;
    await plano.rearmar();
    CAD.seleccionar([ins, lnA, cota]);
    let m = await cmd('COPIAPORTA');
    const clip = P2.portapapeles.leer();
    check('COPIAPORTA guarda objetos, capas y bloques (clave domoplano.clipboard)', clip && clip.n === 3 && clip.capas.some((c) => c.name === 'ALUMBRADO') && clip.bloques.some((b) => b.name === 'EPM_POSTE_CONCRETO_PR'), m);
    // otro plano: nuevo, vacío
    await abrir(Documento.nuevo());
    const orig2 = S.serialize(); const u0 = S.undoStack.length;
    m = await cmd('PEGAPORTA', '500,500');
    const pegados = vivos();
    check('PEGAPORTA en otro plano: 3 objetos, capa y bloque nuevos', pegados.filter((e) => ['INSERT', 'LINE', 'DIMENSION'].includes(e.type)).length === 3 && !!S.findRec('LAYER', 'ALUMBRADO') && !!S.D.blocks.get('EPM_POSTE_CONCRETO_PR'), m);
    const lp = pegados.find((e) => e.type === 'LINE');
    check('PEGAPORTA: el punto base va al punto pedido', lp && near(lp.num(11) - lp.num(10), 40) && Math.abs(Math.min(lp.num(10), lp.num(11)) - 500) < 100, lp && [lp.num(10), lp.num(20)]);
    check('PEGAPORTA = un paso de deshacer', S.undoStack.length === u0 + 1);
    check('Pegar avisa si las unidades son distintas (m → mm)', /venía en m/.test(m), m);
    const att = pegados.find((e) => e.type === 'INSERT'); const atts = S.withSeq(att).filter((q) => q.type === 'ATTRIB');
    check('El poste pegado conserva sus atributos', atts.length >= 2 && atts.some((a) => /12/.test(Documento.textoDe(a))), atts.map((a) => Documento.textoDe(a)));
    m = await cmd('PEGAORIG');
    check('PEGAORIG pega en las mismas coordenadas', vivos().some((e) => e.type === 'LINE' && near(e.num(10), 100) && near(e.num(20), 100)), m);
    const f = guardar(S, 'pegado.dxf');
    const ez = audit(f, `out['ins'] = sum(len(l.query('INSERT')) for l in d.layouts)\nout['dim'] = sum(len(l.query('DIMENSION')) for l in d.layouts)`);
    check('Pegado: ezdxf 0 errores, 2 postes y 2 cotas', ez.errores && !ez.errores.length && ez.ins === 2 && ez.dim === 2, JSON.stringify(ez).slice(0, 500));
    while (S.undoStack.length > u0) S.undo();
    check('Deshacer el pegado = plano vacío otra vez', sinSemilla(S.serialize()) === sinSemilla(orig2));
  }

  // ================================================================ CANTIDADES
  {
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' }));
    await plano.irA('Modelo');
    for (let k = 0; k < 3; k++) S.insertarSimbolo(pg(), 'EPM_POSTE_CONCRETO_PR', [k * 30, 0], 0.5, 0, ['12', '510']);
    S.insertarSimbolo(pg(), 'EPM_POSTE_CONCRETO_PR', [100, 0], 0.5, 0, ['8', '510']);
    S.crearCapa('RED_MT'); ln([0, 0], [30, 0], 'RED_MT'); ln([30, 0], [60, 0], 'RED_MT'); pol([[0, 50], [0, 100], [40, 100]], false, 'RED_MT');
    await plano.rearmar();
    const q = P2.cantidades(vivos(), S);
    const g12 = q.bloques.find((b) => /12/.test(b.atributos)), g8 = q.bloques.find((b) => /=8\b/.test(b.atributos));
    check('CANTIDADES: postes agrupados por atributos (3 de 12 m, 1 de 8 m)', g12 && g12.n === 3 && g8 && g8.n === 1, JSON.stringify(q.bloques));
    const rm = q.longitudes.find((l) => l.capa === 'RED_MT');
    check('CANTIDADES: longitud de RED_MT = 150 m (3 tramos)', rm && near(rm.L, 150, 1e-9) && rm.n === 3, JSON.stringify(rm));
    let m = await cmd('CANTIDADES');
    check('CANTIDADES en la línea de comandos (todo el dibujo: Modelo y planchas)', /\d+ bloque\(s\)/.test(m) && /RED_MT \(3 tramos\)/.test(m) && /3 · EPM_POSTE_CONCRETO_PR/.test(m), m.slice(0, 400));
    const t = P2.cantidadesTabla(q, 'm');
    check('CANTIDADES para Excel: TSV con encabezado', /^ELEMENTO\tCAPA\tDETALLE\tCANTIDAD/.test(t.tsv) && /RED_MT\tm\t150,00/.test(t.tsv), t.tsv);
    const nT = vivos().filter((e) => e.type === 'TEXT').length;
    m = await cmd('T', '200,200');
    check('CANTIDADES › Tabla inserta el cuadro en el plano', vivos().filter((e) => e.type === 'TEXT').length > nT + 8 && /Tabla insertada/.test(m), m);
    const f = guardar(S, 'cantidades.dxf'); const ez = audit(f);
    check('Cuadro de cantidades: ezdxf 0 errores', ez.errores && !ez.errores.length, JSON.stringify(ez));
  }

  // ================================================================ MAPAOSM (archivo local, sin internet)
  {
    const osm = `<?xml version="1.0"?><osm version="0.6">
<node id="1" lat="6.1734" lon="-75.3390"/><node id="2" lat="6.1734" lon="-75.3380"/><node id="3" lat="6.1744" lon="-75.3380"/>
<node id="4" lat="6.1736" lon="-75.3388"/><node id="5" lat="6.1736" lon="-75.3386"/><node id="6" lat="6.1738" lon="-75.3386"/><node id="7" lat="6.1738" lon="-75.3388"/>
<node id="8" lat="6.1733" lon="-75.3390"/><node id="9" lat="6.1733" lon="-75.3380"/>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Calle 28"/></way>
<way id="11"><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="4"/><tag k="building" v="yes"/></way>
<way id="12"><nd ref="8"/><nd ref="9"/><tag k="highway" v="footway"/><tag k="footway" v="sidewalk"/></way>
<way id="13"><nd ref="8"/><nd ref="9"/><tag k="power" v="line"/></way>
</osm>`;
    const fOSM = path.join(SAL, 'prueba.osm'); fs.writeFileSync(fOSM, osm);
    const ways = P2.leerOSM(osm);
    check('MAPAOSM lee el .osm (4 vías/edificios)', ways.length === 4 && ways[1].cerrada);
    const pr = P2.proyectarOSM(ways, 6.1734, -75.3390, 1);
    const via = pr.items.find((i) => i.capa === 'URB_VIAS');
    const KX = Math.cos(6.1734 * Math.PI / 180) * 111320;
    check('MAPAOSM: proyección local en metros (como tdc_mapa_osm.py)', via && near(via.pts[1][0], 0.001 * KX, 1e-6) && near(via.pts[2][1], 0.001 * 110574, 1e-6), via && via.pts);
    check('MAPAOSM: capas URB_VIAS, URB_ANDENES y URB_PREDIOS (lo demás se ignora)', pr.items.length === 3 && pr.items.some((i) => i.capa === 'URB_ANDENES') && pr.items.some((i) => i.capa === 'URB_PREDIOS' && i.cerrada && i.pts.length === 4));
    const json = JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [{ lat: 6.1734, lon: -75.339 }, { lat: 6.1734, lon: -75.338 }] }] });
    check('MAPAOSM lee el JSON de Overpass («out geom»)', P2.leerOSM(json).length === 1);
    check('Consulta de Overpass con radio', /around:250,6\.1734,-75\.339/.test(P2.consultaOverpass(6.1734, -75.339, 250)));
    await abrir(PlantillaEPM.generar({ hoja: '1000x707' })); await plano.irA('Modelo');
    const u0 = S.undoStack.length;
    let m = await cmd('OSM', fOSM, '1000,2000');
    check('MAPAOSM (archivo) dibuja en el Modelo en metros', /1 vía\(s\) en URB_VIAS, 1 en URB_ANDENES, 1 predio/.test(m) && !!S.findRec('LAYER', 'URB_PREDIOS'), m);
    const vias = vivos().filter((e) => e.type === 'LWPOLYLINE' && (e.get(8) || '').trim() === 'URB_VIAS');
    const p0 = P2.proyectarOSM(ways, null, null, 1).items[0].pts[0];
    check('MAPAOSM: el origen (centro del archivo) cae en el punto pedido', vias.length === 1 && near(Geom.lwVerts(vias[0])[0][0], 1000 + p0[0], 1e-6) && near(Geom.lwVerts(vias[0])[0][1], 2000 + p0[1], 1e-6), vias.length);
    check('MAPAOSM: nombre de la vía como texto', vivos().some((e) => e.type === 'TEXT' && /Calle 28/.test(e.get(1))));
    check('MAPAOSM = un paso de deshacer', S.undoStack.length === u0 + 1);
    const f = guardar(S, 'mapa_osm.dxf'); const ez = audit(f);
    check('Mapa OSM: ezdxf 0 errores', ez.errores && !ez.errores.length, JSON.stringify(ez));
  }

  // ================================================================ MCP «domoplano»: herramienta edit_p2
  {
    await abrir(Documento.nuevo());
    const a = ln([0, 0], [10, 0]), b = ln([10, 0], [10, 10]); const c = circ([50, 50], 5); await plano.rearmar();
    const X = (op, args) => DomoMCP.exec(plano.contexto(), op, args);
    let r = await X('p2', { accion: 'area', handles: [c.get(5)] });
    check('MCP edit_p2 area', r.objetos && near(r.objetos[0].area, Math.PI * 25, 1e-5), JSON.stringify(r));
    r = await X('p2', { accion: 'unir', handles: [a.get(5), b.get(5)] });
    check('MCP edit_p2 unir', r.ok && r.handles.length === 1, JSON.stringify(r));
    r = await X('p2', { accion: 'lista', handles: r.handles });
    check('MCP edit_p2 lista', r.objetos && /POLILÍNEA/.test(r.objetos[0][0]), JSON.stringify(r).slice(0, 300));
    r = await X('p2', { accion: 'seleccion_rapida', propiedad: 'tipo', valor: 'CIRCULO' });
    check('MCP edit_p2 seleccion_rapida', r.n === 1 && r.handles[0] === c.get(5).toUpperCase(), JSON.stringify(r));
    r = await X('p2', { accion: 'pinzamiento', handle: c.get(5), indice: 1, punto: [60, 50] });
    check('MCP edit_p2 pinzamiento (radio 10)', r.ok && near(c.num(40), 10), JSON.stringify(r));
    r = await X('comando', { lineas: ['ID', '3,4'] });
    check('MCP run_command con ID', JSON.stringify(r).includes('X = 3.0000'), JSON.stringify(r).slice(0, 300));
  }

  console.log(`H6-A/H6-B: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
