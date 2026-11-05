// Pruebas del hito H3 «Dibujo EPM»: SOMBREA (patrones propios, por objetos y por punto con islas), cotas (lineal, alineada,
// angular, radio, diámetro) como DIMENSION con su bloque, ESTILOCOTA, DIRECTRIZ, BLOQUE, INSERTAR, ATRDEF, DESCOMPONER,
// SIMETRIA, EMPALME, CHAFLAN, MATRIZ, recortar/alargar/desfase de polilíneas con arcos y TABLA. Todo con deshacer, DXF
// sin pérdidas (ezdxf audit) y salida a PDF y DWF.
// Uso: node tests/h3test.js     Solo usa copias de tests/datos y escribe en tests/salida/h3.
const fs = require('fs'), path = require('path'), cp = require('child_process'), zlib = require('zlib');
const { exportarPDF } = require('../cli/dxf_a_pdf.js');
const { exportarDXF } = require('../cli/dxf_a_dwf.js');
const W = path.join(__dirname, '..', 'web') + '/';
const W2D = require(W + 'w2d.js');
global.Path2D = class { moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} addPath() {} };
global.Documento = require(W + 'documento.js');
global.Geom = require(W + 'geom.js');
const Dib = require(W + 'dibujo.js'); global.Dibujo = Dib;
const DATOS = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida', 'h3');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : info); } };
const sinSemilla = (t) => t.replace(/(\$HANDSEED\r?\n\s*5\r?\n)[0-9A-Fa-f]+/, '$1*');
const decode = (u8) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); } };
const py = (code, ...args) => {
  const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
  if (r.status !== 0) return { fallo: r.stderr.slice(-1500) };
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const EZ = `import ezdxf, json, sys, math\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nout = {'errores': [str(e.message) for e in a.errors], 'arreglos': len(a.fixes)}\n`;
function leerZip(d) {
  const e = d.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  const n = d.readUInt16LE(e + 10); let p = d.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < n; i++) {
    const m = d.readUInt16LE(p + 10), cs = d.readUInt32LE(p + 20), nl = d.readUInt16LE(p + 28), xl = d.readUInt16LE(p + 30), cl = d.readUInt16LE(p + 32), lho = d.readUInt32LE(p + 42);
    const name = d.toString('latin1', p + 46, p + 46 + nl);
    const ln = d.readUInt16LE(lho + 26), lx = d.readUInt16LE(lho + 28);
    const raw = d.subarray(lho + 30 + ln + lx, lho + 30 + ln + lx + cs);
    out.push({ name, data: m ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nl + xl + cl;
  }
  return out;
}
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const lw = (pl, S, pts, closed, bulges = []) => {
  const body = [[90, pts.length], [70, closed ? 1 : 0], [43, 0]];
  pts.forEach((p, i) => { body.push([10, p[0]], [20, p[1]]); if (bulges[i]) body.push([42, bulges[i]]); });
  return S.add(pl, 'LWPOLYLINE', 'AcDbPolyline', body, '0');
};
const ln = (pl, S, a, b) => S.add(pl, 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], '0');
const ci = (pl, S, c, r) => S.add(pl, 'CIRCLE', 'AcDbCircle', [[10, c[0]], [20, c[1]], [30, 0], [40, r]], '0');
const txt = (pl, S, p, s, just) => S.add(pl, 'TEXT', 'AcDbText', Documento.textoPares(p, 2.5, 0, s, { just: just || 'I' }), '0');

(async () => {
  const doc = await DXF.open(new TextEncoder().encode(Documento.nuevo()));
  const S = new Edit.Session(doc);
  const pl = doc.pages.find((p) => p.title === 'Plancha 1');
  const vacio = S.serialize();

  // ------------------------------------------------------------ 1) SOMBREA
  const rect = lw(pl, S, [[20, 20], [120, 20], [120, 80], [20, 80]], true);
  const isla = ci(pl, S, [50, 50], 10);
  let r = S.sombrearObjetos(pl, [rect, isla], { patron: 'ANSI31', escala: 1, angulo: 0 });
  check('SOMBREA por objetos (ANSI31 → DIAGONAL propio) con isla', r.ok && r.contornos === 2 && r.patron === 'DIAGONAL', JSON.stringify(r.error || r.patron));
  // cuadro de 4 líneas sueltas + círculo dentro: punto interior
  const L4 = [[150, 20], [230, 20], [230, 80], [150, 80]].map((p, i, a) => ln(pl, S, p, a[(i + 1) % 4]));
  ln(pl, S, [130, 50], [250, 50]); // una línea que cruza todo: parte el cuadro en dos
  ci(pl, S, [190, 35], 6);
  r = S.sombrearPunto(pl, S.allEnts(), [160, 30], { patron: 'TIERRA', escala: 0.5 });
  check('SOMBREA por punto interior: región de abajo con 1 isla', r.ok && r.contornos === 2 && r.islas === 1, JSON.stringify([r.error, r.contornos, r.islas]));
  const hPunto = r.rec;
  r = S.sombrearPunto(pl, S.allEnts(), [190, 35], { patron: 'SOLIDO' });
  check('SOMBREA sólido dentro del círculo', r.ok && r.contornos === 1 && r.rec.get(70).trim() === '1', JSON.stringify(r.error));
  r = S.sombrearPunto(pl, S.allEnts(), [300, 300], { patron: 'ARENA' });
  check("SOMBREA en zona abierta avisa", !!r.error, r.contornos);
  // contorno con arco: semicírculo hecho con línea + arco
  ln(pl, S, [250, 20], [290, 20]);
  S.add(pl, 'ARC', 'AcDbCircle', [[10, 270], [20, 20], [30, 0], [40, 20], [100, 'AcDbArc'], [50, 0], [51, 180]], '0');
  r = S.sombrearPunto(pl, S.allEnts(), [270, 30], { patron: 'CONCRETO', escala: 0.3, angulo: 15 });
  check('SOMBREA en región con arco (comba en el contorno)', r.ok && r.rec.p.some((q) => q[0] === 42 && Math.abs(parseFloat(q[1])) > 0.5), JSON.stringify(r.error));
  check('Patrones propios: 10 (sin copiar .pat)', Object.keys(Dib.PATRONES).length === 10 && !Object.keys(Dib.PATRONES).some((k) => /ANSI|AR-/.test(k)));

  // ------------------------------------------------------------ 2) COTAS y ESTILOCOTA
  r = S.crearCota(pl, 'lineal', { p1: [20, 80], p2: [120, 20], ubic: [70, 95] });
  check('COTALIN horizontal = 100', r.ok && near(r.meas, 100) && r.texto === '100,00', JSON.stringify(r.error || r.texto));
  const cotaH = r.rec;
  r = S.crearCota(pl, 'lineal', { p1: [120, 20], p2: [120, 80], ubic: [135, 50] });
  check('COTALIN vertical (automática) = 60', r.ok && near(r.meas, 60) && r.rec.num(50) === 90, JSON.stringify(r.error || r.meas));
  r = S.crearCota(pl, 'alineada', { p1: [20, 120], p2: [50, 160], ubic: [20, 170] });
  check('COTAALINEADA = 50', r.ok && near(r.meas, 50), JSON.stringify(r.error || r.meas));
  ln(pl, S, [300, 120], [350, 120]); ln(pl, S, [300, 120], [300, 170]);
  r = S.crearCota(pl, 'angular', { v: [300, 120], p1: [350, 120], p2: [300, 170], ubic: [320, 140] });
  check('COTAANG = 90°', r.ok && near(r.meas, Math.PI / 2) && r.texto === '90%%d', JSON.stringify(r.error || r.texto));
  r = S.crearCota(pl, 'radio', { c: [50, 50], r: 10, punto: [60, 60] });
  check('COTARADIO = R10,00', r.ok && r.texto === 'R10,00', JSON.stringify(r.error || r.texto));
  r = S.crearCota(pl, 'diametro', { c: [190, 35], r: 6, punto: [190, 41], ubic: [210, 60] });
  check('COTADIAM = %%c12,00', r.ok && r.texto === '%%c12,00', JSON.stringify(r.error || r.texto));
  r = S.crearEstiloCota('EPM-m', { txt: 2, asz: 2, flecha: 'marca', unidades: 'm', dec: 2 });
  check('ESTILOCOTA en metros (dibujo en mm) y actual', r.ok && S.hdrGet('$DIMSTYLE', 2) === 'EPM-m', JSON.stringify(r));
  r = S.crearCota(pl, 'lineal', { p1: [150, 20], p2: [230, 20], ubic: [190, 8] });
  check('Cota con estilo en m: 80 mm → «0,08 m»', r.ok && r.texto === '0,08 m', JSON.stringify(r.error || r.texto));
  check('Bloque de cota con marcas (sin flechas rellenas)', r.block.ents.filter((e) => e.type === 'SOLID').length === 0 && r.block.ents.filter((e) => e.type === 'LINE').length >= 5);
  S.crearEstiloCota('Standard', { actual: true });
  r = S.crearDirectriz(pl, [[60, 60], [80, 100], [95, 100]], 'CAJA RS3');
  check('DIRECTRIZ (LEADER + texto)', r.ok && r.recs.length === 2 && r.recs[0].type === 'LEADER', JSON.stringify(r.error));

  // ------------------------------------------------------------ 3) BLOQUE, ATRDEF, INSERTAR, DESCOMPONER
  const b1 = ln(pl, S, [20, 200], [40, 200]), b2 = ln(pl, S, [40, 200], [30, 215]), b3 = ln(pl, S, [30, 215], [20, 200]);
  r = S.crearAtrdef(pl, { at: [30, 195], h: 2, tag: 'kva', prompt: 'Potencia', def: '75', just: 'IC' });
  check('ATRDEF', r.ok && r.rec.type === 'ATTDEF' && r.rec.get(2) === 'KVA');
  r = S.crearBloque('TRAFO_H3', [30, 200], [b1, b2, b3, r.rec], pl, 'convertir');
  check('BLOQUE creado y convertido en inserción con atributo', r.ok && r.insert && r.block.ents.length === 4 && S.withSeq(r.insert).some((q) => q.type === 'ATTRIB' && q.get(1) === '75'), JSON.stringify(r.error));
  check('BLOQUE: nombre repetido avisa', !!S.crearBloque('TRAFO_H3', [0, 0], [L4[0]], pl).error);
  check('INSERTAR lo ve en la lista', doc.blockNames().includes('TRAFO_H3'));
  r = S.insertarBloque(pl, 'TRAFO_H3', [80, 200], 2, 30, ['112,5']);
  const ins2 = r.rec;
  check('INSERTAR escala 2 giro 30 con valor de atributo', r.ok && ins2.num(41) === 2 && ins2.num(50) === 30 && r.recs.some((q) => q.type === 'ATTRIB' && q.get(1) === '112,5'), JSON.stringify(r.error));
  const att = S.textosDe(ins2)[0];
  check('EDITATEXTO cambia el valor del atributo', S.editarTexto(att, '150').ok && att.get(1) === '150');
  const insC = S.insertarBloque(pl, 'TRAFO_H3', [120, 200], 1, 0).rec;
  r = S.descomponer([insC], pl);
  check('DESCOMPONER: 3 líneas + la definición de atributo', r.ok && r.recs.filter((q) => q.type === 'LINE').length === 3 && r.recs.some((q) => q.type === 'ATTDEF'), JSON.stringify(r.error));
  const exLine = r.recs.find((q) => q.type === 'LINE' && near(q.num(10), 110));
  check('DESCOMPONER deja las líneas en su lugar', !!exLine && near(exLine.num(20), 200), r.recs.map((q) => q.type + ' ' + q.num(10) + ',' + q.num(20)).join(' | '));

  // ------------------------------------------------------------ 4) SIMETRIA
  const tx = txt(pl, S, [200, 200], 'POSTE 12 m');
  const arco = S.add(pl, 'ARC', 'AcDbCircle', [[10, 230], [20, 200], [30, 0], [40, 5], [100, 'AcDbArc'], [50, 0], [51, 90]], '0');
  const plb = lw(pl, S, [[200, 230], [220, 230], [220, 250]], false, [0, 1]);
  r = S.simetria([tx, arco, plb, ins2, hPunto, cotaH], [250, 0], [250, 10], false, pl);
  check('SIMETRIA copia 6 objetos (texto, arco, polilínea con arco, bloque, sombreado, cota)', r.ok && r.n === 6 && !r.refused.length, JSON.stringify([r.n, r.refused, r.error]));
  const tm = r.recs.find((q) => q.type === 'TEXT');
  check('SIMETRIA: texto legible (giro 0, justificado a la derecha en 300)', tm && near(tm.num(50, 0), 0) && tm.int(72) === 2 && near(tm.num(11), 300), JSON.stringify(tm && tm.p));
  const am = r.recs.find((q) => q.type === 'ARC');
  check('SIMETRIA: arco 90°–180° centrado en 270', am && near(am.num(10), 270) && near(am.num(50), 90) && near(am.num(51), 180), JSON.stringify(am && am.p));
  const pm = r.recs.find((q) => q.type === 'LWPOLYLINE');
  check('SIMETRIA: comba invertida', pm && near(pm.num(42), -1), JSON.stringify(pm && pm.p));
  const im = r.recs.find((q) => q.type === 'INSERT');
  check('SIMETRIA: bloque con escala X negativa', im && near(im.num(41), -2) && near(im.num(42), 2), JSON.stringify(im && im.p.filter((q) => [10, 20, 41, 42, 50].includes(q[0]))));
  const dm = r.recs.find((q) => q.type === 'DIMENSION');
  check('SIMETRIA: la cota copiada tiene bloque nuevo y mide 100', dm && dm.get(2) !== cotaH.get(2) && near(dm.num(42), 100) && doc.dxf.blocks.has(dm.get(2).toUpperCase()));
  const txtM = (S.allEnts().filter((q) => q.type === 'TEXT' && q.home === doc.dxf.blocks.get(dm.get(2).toUpperCase()).ents)[0] || {}).p;
  check('SIMETRIA: texto de la cota reflejada se lee bien', txtM && txtM.some((q) => q[0] === 1 && q[1] === '100,00') && near(parseFloat(txtM.find((q) => q[0] === 50)[1]), 0), JSON.stringify(txtM));
  r = S.simetria([arco], [0, 300], [10, 300], true, pl);
  check('SIMETRIA borrando el original', r.ok && near(arco.num(20), 400) && near(arco.num(50), 270), JSON.stringify(arco.p));
  S.undo();

  // ------------------------------------------------------------ 5) EMPALME y CHAFLAN
  const e1 = ln(pl, S, [20, 260], [70, 260]), e2 = ln(pl, S, [60, 250], [60, 300]);
  r = S.esquina(e1, [30, 260], e2, [60, 290], { radio: 5 }, pl);
  check('EMPALME de dos líneas radio 5', r.ok && r.nuevo.type === 'ARC' && near(e1.num(11), 55) && near(e2.num(20), 265) && near(r.nuevo.num(40), 5), JSON.stringify([e1.p, e2.p]));
  const c1 = ln(pl, S, [100, 260], [150, 260]), c2 = ln(pl, S, [140, 250], [140, 300]);
  r = S.esquina(c1, [110, 260], c2, [140, 290], { d1: 4, d2: 6 }, pl);
  check('CHAFLAN 4 × 6', r.ok && r.nuevo.type === 'LINE' && near(c1.num(11), 136) && near(c2.num(20), 266), JSON.stringify([c1.p, c2.p]));
  r = S.esquina(ln(pl, S, [0, 0], [1, 0]), [0.5, 0], ln(pl, S, [0, 1], [1, 1]), [0.5, 1], { radio: 1 }, pl);
  check('EMPALME de paralelas avisa', !!r.error);
  const sq = lw(pl, S, [[180, 250], [230, 250], [230, 290], [180, 290]], true);
  r = S.esquinaPol(sq, { radio: 5 });
  check('EMPALME polilínea: 4 esquinas → 8 vértices con arcos', r.ok && r.n === 4 && sq.all(10).length === 8 && sq.all(42).length === 4, JSON.stringify([r.error, r.n]));

  // ------------------------------------------------------------ 6) MATRIZ
  const m0 = ci(pl, S, [300, 250], 2);
  const nAntes = S.allEnts().length;
  r = S.matrizRect([m0], 3, 4, 10, 8, pl);
  check('MATRIZ rectangular 3×4 = 11 copias', r.ok && S.allEnts().length - nAntes === 11, S.allEnts().length - nAntes);
  r = S.matrizPolar([txt(pl, S, [380, 250], 'P')], [360, 250], 6, 360, true, pl);
  check('MATRIZ polar 6 (girando)', r.ok && r.n === 5);
  const girados = S.allEnts().filter((q) => q.type === 'TEXT' && q.get(1) === 'P').map((q) => Math.round(q.num(50, 0))).sort((a, b) => a - b);
  check('MATRIZ polar: textos a 0, 60, …, 300°', JSON.stringify(girados) === JSON.stringify([0, 60, 120, 180, 240, 300]), JSON.stringify(girados));

  // ------------------------------------------------------------ 7) polilíneas con arcos: recortar, alargar, desfase
  const pa = lw(pl, S, [[20, 330], [60, 330], [80, 350]], false, [0, 0.4]);
  const corte = ln(pl, S, [40, 320], [40, 340]);
  r = Geom.trim(pa, 30, 330, [corte]);
  check('RECORTA polilínea (abierta)', r.mods && JSON.stringify(Geom.lwSegs(new DXF.Rec('LWPOLYLINE', r.mods[0].pairs)).segs[0].a) === '[40,330]', JSON.stringify(r.error || r.mods[0].pairs));
  const pc = lw(pl, S, [[100, 320], [140, 320], [140, 360], [100, 360]], true, [0, 0.5, 0, 0]);
  r = Geom.trim(pc, 100, 340, [ln(pl, S, [90, 330], [150, 330]), ln(pl, S, [90, 350], [150, 350])]);
  check('RECORTA polilínea cerrada → abierta', r.mods && !(parseInt(r.mods[0].pairs.find((q) => q[0] === 70)[1], 10) & 1), JSON.stringify(r.error));
  r = Geom.extend(pa, 79, 349, [ln(pl, S, [0, 365], [200, 365])]);
  check('ALARGA polilínea que termina en arco', r.mods && near(parseFloat(r.mods[0].pairs.filter((q) => q[0] === 20).pop()[1]), 365, 1e-6), JSON.stringify(r.error || r.mods[0].pairs.filter((q) => q[0] === 10 || q[0] === 20)));
  const po = lw(pl, S, [[200, 320], [240, 320], [240, 360]], false, [0, 0]);
  const pob = lw(pl, S, [[260, 320], [300, 320], [300, 360]], false, [0.41421356, 0]);
  r = Geom.offset(pob, 2, 280, 330);
  check('DESFASE polilínea con arcos', r.pairs && r.pairs.some((q) => q[0] === 42), JSON.stringify(r.error));
  if (r.pairs) S.commit('Desfase', { adds: [S.clone(pob, 'LWPOLYLINE', r.pairs, pl)] });
  r = Geom.offset(lw(pl, S, [[320, 320], [330, 320]], false, [1]), 20, 325, 321);
  check('DESFASE hacia dentro mayor que el radio avisa', !!r.error, JSON.stringify(r));

  // ------------------------------------------------------------ 8) TABLA
  r = S.crearTabla(pl, { at: [20, 290 - 0], titulo: 'CUADRO DE CARGAS', datos: [['Circuito', 'Carga (W)', 'Calibre'], ['C1 Iluminación', '1200', '12 AWG'], ['C2 Tomas generales de la cocina y patio', '1800', '12 AWG']], anchos: [40, 25, 25], alto: 6, h: 2.5 });
  check('TABLA: título + 3 filas × 3 columnas en líneas y textos', r.ok && r.filas === 4 && r.recs.filter((q) => q.type === 'TEXT').length === 11, JSON.stringify(r.error || r.filas)); // H4: el texto largo va en 2 renglones (no se sale)
  check('TABLA: el texto largo se angosta para caber', r.recs.some((q) => q.type === 'TEXT' && q.num(41, 1) < 1));

  // ------------------------------------------------------------ 9) GIRA / ESCALA / DESPLAZA de cotas y sombreados
  const hMov = S.allEnts().find((q) => q.type === 'HATCH');
  let t = S.rotate([hMov, cotaH], [0, 0], 10);
  check('GIRA sombreado y cota (se regenera)', t.done === 2 && !t.refused.length, JSON.stringify(t));
  t = S.scale([cotaH], [0, 0], 2);
  check('ESCALA cota: la medida pasa a 200', t.done === 1 && near(cotaH.num(42), 200));
  S.undo(); S.undo();
  t = S.move([cotaH], 5, 5);
  check('DESPLAZA cota (traslada su bloque)', t.moved === 1 && near(cotaH.num(13), 25));

  // ------------------------------------------------------------ 10) guardar, ezdxf, reabrir
  const dxfTxt = S.serialize();
  const f1 = path.join(SAL, 'H3 dibujo.dxf');
  fs.writeFileSync(f1, dxfTxt);
  const ez = py(EZ + `ps = d.paperspace()
out['tipos'] = {}
for e in ps: out['tipos'][e.dxftype()] = out['tipos'].get(e.dxftype(), 0) + 1
out['medidas'] = sorted(round(e.dxf.actual_measurement if e.dimtype not in (2,5) else math.degrees(e.dxf.actual_measurement), 4) for e in ps.query('DIMENSION'))
out['bloques_cota'] = all(e.dxf.geometry in d.blocks for e in ps.query('DIMENSION'))
out['patrones'] = sorted(set(e.dxf.pattern_name for e in ps.query('HATCH')))
out['islas'] = max(len(e.paths) for e in ps.query('HATCH'))
out['atributos'] = sorted(a.dxf.text for i in ps.query('INSERT') for a in i.attribs)
out['estilos'] = sorted(s.dxf.name for s in d.dimstyles)
out['trafo'] = 'TRAFO_H3' in d.blocks and len(d.blocks['TRAFO_H3'].query('ATTDEF')) == 1
print(json.dumps(out))`, f1);
  check('ezdxf: H3 sin errores', ez.errores && ez.errores.length === 0, JSON.stringify(ez).slice(0, 1500));
  if (ez.tipos) {
    check('ezdxf: tipos de objeto', ez.tipos.DIMENSION === 8 && ez.tipos.HATCH >= 5 && ez.tipos.LEADER === 1 && ez.tipos.INSERT >= 3, JSON.stringify(ez.tipos));
    check('ezdxf: medidas de las cotas', [12, 50, 60, 80, 90, 100].every((m) => ez.medidas.some((x) => near(x, m, 1e-3))), JSON.stringify(ez.medidas));
    check('ezdxf: cada cota tiene su bloque', ez.bloques_cota === true);
    check('ezdxf: patrones con nombre propio', JSON.stringify(ez.patrones) === JSON.stringify(['CONCRETO', 'DIAGONAL', 'SOLID', 'TIERRA']), JSON.stringify(ez.patrones));
    check('ezdxf: sombreado con isla (2 contornos)', ez.islas >= 2, ez.islas);
    check('ezdxf: atributos 75 y 150', ez.atributos.includes('75') && ez.atributos.includes('150'), JSON.stringify(ez.atributos));
    check('ezdxf: estilos de cota Standard y EPM-m', ez.estilos.includes('EPM-m') && ez.estilos.includes('Standard'), JSON.stringify(ez.estilos));
    check('ezdxf: bloque TRAFO_H3 con su ATTDEF', ez.trafo === true);
  }
  const d2 = await DXF.open(new TextEncoder().encode(dxfTxt));
  const S2 = new Edit.Session(d2);
  check('reabrir y guardar sin cambios = idéntico', S2.serialize() === dxfTxt);
  const pl2 = d2.pages.find((p) => p.title === 'Plancha 1');
  const root = await pl2.build();
  check('reabrir: se dibuja sin avisos de bloques', !root.stats.warnings.some((w) => /Bloque no encontrado|sin soporte/.test(w)), root.stats.warnings.join(' | '));
  // editar el archivo reabierto (bloques del archivo, no de la sesión)
  const cot2 = d2.dxf.entities.find((q) => q.type === 'DIMENSION');
  t = S2.rotate([cot2], [0, 0], 5);
  const f1b = path.join(SAL, 'H3 reabierto y editado.dxf'); fs.writeFileSync(f1b, S2.serialize());
  const ez2 = py(EZ + 'print(json.dumps(out))', f1b);
  check('reabrir → girar cota del archivo → ezdxf sin errores', t.done === 1 && ez2.errores && !ez2.errores.length, JSON.stringify(ez2).slice(0, 500));

  // ------------------------------------------------------------ 11) PDF y DWF
  const pdf1 = path.join(SAL, 'H3 dibujo.pdf');
  const rp = await exportarPDF(f1, pdf1, { plancha: 'Plancha 1', color: 'mono' });
  const fz = py(`import fitz, json, sys
p = fitz.open(sys.argv[1])[0]
dr = p.get_drawings()
print(json.dumps({'texto': p.get_text(), 'rellenos': sum(1 for x in dr if x.get('fill') is not None), 'trazos': len(dr)}))`, pdf1);
  check('PDF: textos de cotas, directriz y tabla', fz.texto && ['100,00', 'R10,00', 'Ø12,00', '90°', '0,08 m', 'CAJA RS3', 'CUADRO DE CARGAS', '1800'].every((s) => fz.texto.includes(s)), JSON.stringify(fz.texto && fz.texto.slice(0, 600)));
  check('PDF: sombreados y flechas como rellenos', fz.rellenos >= 8, JSON.stringify([fz.rellenos, fz.trazos]));
  check('PDF: sin avisos', !rp.stats.warnings.length, rp.stats.warnings.join(' | '));
  const dwf1 = path.join(SAL, 'H3 dibujo.dwf');
  const rd = await exportarDXF(f1, dwf1, { plancha: 'Plancha 1' });
  const w = W2D.parseSync(new Uint8Array(leerZip(fs.readFileSync(dwf1)).find((z) => z.name.endsWith('.w2d')).data));
  const wt = w.items.filter((i) => i.t === 'text').map((i) => i.str || i.text || '').join(' ');
  check('DWF: W2D completo y sin avisos', w.complete && !w.warnings.length && !rd.stats.warnings.length, JSON.stringify([w.warnings, rd.stats.warnings]));
  check('DWF: textos de cotas y tabla', ['100,00', 'CUADRO DE CARGAS'].every((s) => wt.includes(s)), wt.slice(0, 300));

  // ------------------------------------------------------------ 12) deshacer todo = plano vacío
  while (S.undo()) { /* todo */ }
  check('deshacer todo = plano en blanco (salvo $HANDSEED)', sinSemilla(S.serialize()) === sinSemilla(vacio));
  while (S.redo()) { /* todo */ }
  check('rehacer todo = mismo DXF', S.serialize() === dxfTxt);

  // ------------------------------------------------------------ 13) copia de DR6 (plano real): simetría, sombreado, cota, bloque
  const dr6 = fs.readFileSync(path.join(DATOS, 'DR6.dxf'));
  const D6 = await DXF.open(dr6); const S6 = new Edit.Session(D6);
  const p6 = D6.pages.find((p) => p.title === 'PLANCHA 1');
  const ents6 = p6.edit.container.filter((q) => !q.deleted && (p6.edit.container !== D6.dxf.entities || q.int(67, 0) === 1) && ['LINE', 'LWPOLYLINE', 'TEXT', 'INSERT', 'CIRCLE', 'ARC'].includes(q.type)).slice(0, 40);
  r = S6.simetria(ents6, [420, 0], [420, 10], false, p6);
  check('DR6: SIMETRIA de 40 objetos reales', r.ok && r.n >= 35, JSON.stringify([r.n, r.refused]));
  r = S6.crearCota(p6, 'lineal', { p1: [100, 100], p2: [200, 100], ubic: [150, 90] });
  check('DR6: cota en la plancha', r.ok, JSON.stringify(r.error));
  const cerr = p6.edit.container.find((q) => q.type === 'LWPOLYLINE' && (q.int(70) & 1));
  if (cerr) { r = S6.sombrearObjetos(p6, [cerr], { patron: 'CRUZADO', escala: 2 }); check('DR6: sombreado de una polilínea cerrada', r.ok, JSON.stringify(r.error)); }
  r = S6.crearBloque('H3_PRUEBA', [0, 0], ents6.slice(0, 5), p6, 'retener');
  check('DR6: BLOQUE nuevo en un plano real', r.ok, JSON.stringify(r.error));
  const f6 = path.join(SAL, 'DR6 con H3.dxf'); fs.writeFileSync(f6, S6.serialize());
  const ez6 = py(EZ + 'print(json.dumps(out))', f6);
  check('ezdxf: DR6 con H3 sin errores', ez6.errores && !ez6.errores.length, JSON.stringify(ez6).slice(0, 800));
  while (S6.undo()) { /* todo */ }
  check('DR6: deshacer todo = idéntico al original (salvo $HANDSEED)', sinSemilla(S6.serialize()) === sinSemilla(decode(dr6)));

  // ------------------------------------------------------------ 14) integración EPM: plantilla, símbolos, redes y verificador
  global.DXFGen = require(W + 'dxf_generador.js'); global.SimbolosEPM = require(W + 'simbolos_epm.js');
  global.PlantillaEPM = require(W + 'plantilla_epm.js'); const Verificador = require(W + 'verificador.js');
  const tpl = PlantillaEPM.generar({ hoja: 'A1' });
  const DE = await DXF.open(new TextEncoder().encode(tpl)); const SE = new Edit.Session(DE);
  const pe = DE.pages.find((p) => p.title !== 'Modelo');
  check('PLANTILLAEPM A1 abre en el editor (plancha 841 × 594)', pe && SE.serialize() === tpl, pe && pe.title);
  r = SE.insertarSimbolo(pe, 'EPM_TRAFO_3F_PR', [200, 300], 1, 0, ['T1 75 kVA']);
  check('INSERTARSIMBOLO: inserta con su atributo', r.ok && r.recs.some((q) => q.type === 'ATTRIB' && q.get(1) === 'T1 75 kVA'), JSON.stringify(r.error));
  r = SE.insertarSimbolo(pe, 'EPM_TRAFO_3F_PR', [260, 300]);
  check('INSERTARSIMBOLO: la segunda vez reutiliza el bloque', r.ok && !r.nuevo);
  check('INSERTARSIMBOLO: símbolo que no existe avisa', !!SE.insertarSimbolo(pe, 'EPM_NO_EXISTE', [0, 0]).error);
  { // en un plano en blanco el bloque no existe: se define al insertar
    const DB = await DXF.open(new TextEncoder().encode(Documento.nuevo())); const SB = new Edit.Session(DB); const pb = DB.pages.find((p) => p.title === 'Plancha 1');
    r = SB.insertarSimbolo(pb, 'EPM_POSTE_CONCRETO_PR', [50, 50], 1, 0, ['12 m', '750 kgf']);
    check('INSERTARSIMBOLO en plano en blanco: define el bloque (con atributos ALTURA y CARGA)', r.ok && r.nuevo && r.recs.filter((q) => q.type === 'ATTRIB').length === 2, JSON.stringify(r.error));
    r = SB.definirSimbolo('EPM_DPS_PR');
    check('Definir símbolo desde la paleta y verlo en INSERTAR', r.ok && DB.blockNames().includes('EPM_DPS_PR'), JSON.stringify(r.error));
    const fb = path.join(SAL, 'H3 simbolos en blanco.dxf'); fs.writeFileSync(fb, SB.serialize());
    const ezb = py(EZ + 'print(json.dumps(out))', fb);
    check('ezdxf: símbolos definidos en un plano en blanco sin errores', ezb.errores && !ezb.errores.length, JSON.stringify(ezb).slice(0, 500));
  }
  r = SE.trazarRedEPM(pe, 'BT_TRENZADA', 'PR', [[150, 200], [300, 200], [300, 260]], { escala: 1 });
  check('REDEPM: red BT trenzada proyectada', r.ok && r.n > 10, JSON.stringify(r.error || r.n));
  r = SE.trazarRedEPM(pe, 'MT_DESNUDA', 'EX', [[150, 180], [300, 180]]);
  check('REDEPM: red MT existente (trazo continuo)', r.ok && r.n === 1);
  SE.add(pe, 'TEXT', 'AcDbText', Documento.textoPares([201, 299], 2.5, 0, 'TEXTO MONTADO SOBRE EL TRAFO'), '0');
  const fe = path.join(SAL, 'H3 plantilla EPM con simbolos.dxf'); fs.writeFileSync(fe, SE.serialize());
  const eze = py(EZ + `out['ins'] = sorted(set(e.dxf.name for e in d.layouts.get(${JSON.stringify(pe.title)}).query('INSERT')))
print(json.dumps(out))`, fe);
  check('ezdxf: plantilla EPM + símbolos + redes sin errores', eze.errores && !eze.errores.length && eze.ins.includes('EPM_TRAFO_3F_PR'), JSON.stringify(eze).slice(0, 600));
  const ve = await Verificador.verificar(new TextEncoder().encode(SE.serialize()), { presentacion: pe.title });
  check('VERIFICAR sobre lo no guardado encuentra el texto montado', ve.colisiones.some((c) => /TEXTO MONTADO/.test(c[1] + c[2])), JSON.stringify(ve.colisiones.slice(0, 3)));
  check('VERIFICAR da coordenadas en la plancha para ir al choque', ve.colisiones.every((c) => Number.isFinite(c[3]) && Number.isFinite(c[4])));
  const pdfE = path.join(SAL, 'H3 plantilla EPM.pdf');
  const rpe = await exportarPDF(fe, pdfE, { plancha: pe.title, color: 'mono' });
  check('PDF de la plantilla EPM con símbolos', rpe.bytes > 1000 && !rpe.stats.warnings.length, rpe.stats.warnings.join(' | '));
  while (SE.undo()) { /* todo */ }
  check('plantilla EPM: deshacer todo = plantilla (salvo $HANDSEED)', sinSemilla(SE.serialize()) === sinSemilla(tpl));

  // ------------------------------------------------------------ 15) comandos registrados en la línea de comandos
  const cad = fs.readFileSync(W + 'cad.js', 'utf8');
  for (const a of ['SOMBREA', 'HATCH', 'SB', 'COTALIN', 'DIMLINEAR', 'COTAALINEADA', 'DIMALIGNED', 'COTAANG', 'DIMANGULAR', 'COTARADIO', 'DIMRADIUS', 'COTADIAM', 'DIMDIAMETER',
    'DIRECTRIZ', 'LEADER', 'MLEADER', 'ESTILOCOTA', 'DIMSTYLE', 'BLOQUE', 'BLOCK', 'ATRDEF', 'ATTDEF', 'DESCOMPONER', 'EXPLODE', 'SIMETRIA', 'MIRROR', 'EMPALME', 'FILLET',
    'CHAFLAN', 'CHAMFER', 'MATRIZ', 'ARRAY', 'TABLA', 'TABLE', 'INSERTARSIMBOLO', 'SIMBOLO', 'EPM', 'REDEPM', 'PLANTILLAEPM', 'NUEVOEPM', 'VERIFICAR', 'VERIF', 'REVISARTEXTOS'])
    check('alias ' + a, new RegExp(`\\b${a.replace('-', '\\-')}: '`).test(cad));
  const html = fs.readFileSync(W + 'index.html', 'utf8');
  check('index.html carga dibujo.js y los módulos EPM', ['dibujo.js', 'dxf_generador.js', 'simbolos_epm.js', 'plantilla_epm.js', 'verificador.js'].every((f) => html.includes(`src="${f}"`)) && html.includes('id="simbs"') && html.includes('id="verif"'));
  const sw = fs.readFileSync(path.join(__dirname, '..', 'mac', 'main.swift'), 'utf8');
  check('app: menú «Nuevo plano EPM…» y mensaje newepm', sw.includes('Nuevo plano EPM…') && sw.includes('"newepm"'));

  console.log(`H3: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
