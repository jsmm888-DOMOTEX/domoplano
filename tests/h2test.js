// Pruebas del hito H2 «Salidas EPM»: EXPORTARPDF (una plancha o todas en un PDF), grosores de línea por capa y por
// objeto en PDF y DWF, capas «no trazar»/Defpoints fuera de la salida, tabla GROSORES, LWDISPLAY en pantalla e IMAGEN
// (IMAGE + IMAGEDEF con ruta relativa, girada y escalada) en DXF, PDF y DWF.
// Uso: node tests/h2test.js      Solo usa copias de tests/datos y escribe en tests/salida/h2. Valida con ezdxf y PyMuPDF.
const fs = require('fs'), path = require('path'), cp = require('child_process'), zlib = require('zlib');
const { exportarPDF } = require('../cli/dxf_a_pdf.js');       // arma el entorno de node (medidas de letra, fetch…)
const { exportarDXF } = require('../cli/dxf_a_dwf.js');
const W = path.join(__dirname, '..', 'web') + '/';
const W2D = require(W + 'w2d.js');
global.Path2D = class { moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} addPath() {} };
const Doc = require(W + 'documento.js'); global.Documento = Doc;
const TABLA = require(W + 'grosores_capas.js');
const DATOS = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida', 'h2');
fs.mkdirSync(path.join(SAL, 'imagenes'), { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : info); } };
const sinSemilla = (t) => t.replace(/(\$HANDSEED\r?\n\s*5\r?\n)[0-9A-Fa-f]+/, '$1*'); // la semilla de handles nunca retrocede
const decode = (u8) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); } };
const py = (code, ...args) => {
  const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
  if (r.status !== 0) return { fallo: r.stderr.slice(-800) };
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const EZ = `import ezdxf, json, sys, math\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nout = {'errores': [str(e.message) for e in a.errors]}\n`;
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
const w2dDe = (file) => W2D.parseSync(new Uint8Array(leerZip(fs.readFileSync(file)).find((z) => z.name.endsWith('.w2d')).data));

(async () => {
  const firma = fs.readFileSync(path.join(DATOS, 'firma_marcos_bn.png'));
  fs.writeFileSync(path.join(SAL, 'firma.png'), firma);
  fs.writeFileSync(path.join(SAL, 'imagenes', 'firma.png'), firma);
  const tam = Doc.tamanoImagen(new Uint8Array(firma));
  check('tamaño del PNG', tam && tam.tipo === 'png' && tam.w === 2301 && tam.h === 497, JSON.stringify(tam));

  // ------------------------------------------------------------ 1) plano nuevo: capas con grosor, objeto con grosor, no trazar, imágenes
  const doc = await DXF.open(new TextEncoder().encode(Doc.nuevo()));
  const S = new Edit.Session(doc);
  const pl = doc.pages.find((p) => p.title === 'Plancha 1');
  check('capa con grosor 0,70', S.crearCapa('RED MT', { color: 1, lw: 70 }).ok);
  S.crearCapa('NO TRAZAR', { plot: false });
  S.add(pl, 'LINE', 'AcDbLine', [[10, 20], [20, 280], [30, 0], [11, 400], [21, 280], [31, 0]], 'RED MT');              // 0,70 por capa
  const l2 = S.add(pl, 'LINE', 'AcDbLine', [[10, 20], [20, 260], [30, 0], [11, 400], [21, 260], [31, 0]], '0');
  S.cambiarProps([l2], { lw: 35 });                                                                                   // 0,35 por objeto
  S.add(pl, 'LINE', 'AcDbLine', [[10, 20], [20, 240], [30, 0], [11, 400], [21, 240], [31, 0]], 'Defpoints');          // no sale
  S.add(pl, 'LINE', 'AcDbLine', [[10, 20], [20, 220], [30, 0], [11, 400], [21, 220], [31, 0]], 'NO TRAZAR');          // no sale
  const antesImg = S.serialize();
  const r1 = S.insertarImagen(pl, { archivo: 'firma.png', wpx: tam.w, hpx: tam.h, at: [20, 20], ancho: 80, rot: 0, capa: '0' });
  const r2 = S.insertarImagen(pl, { archivo: 'imagenes/firma.png', wpx: tam.w, hpx: tam.h, at: [250, 60], ancho: 80, rot: 30, capa: '0' });
  const r3 = S.insertarImagen(pl, { archivo: 'firma.png', wpx: tam.w, hpx: tam.h, at: [150, 150], ancho: 40, rot: 90, capa: '0' });
  check('IMAGEN insertada (3)', r1.ok && r2.ok && r3.ok, JSON.stringify([r1.error, r2.error, r3.error]));
  check('IMAGEN reutiliza la definición del mismo archivo', r3.reutilizada && !r2.reutilizada && r3.defH === r1.defH);
  // girar y escalar una imagen ya puesta (GIRA / ESCALA): la primera, 15° y ×1,25 alrededor de su esquina
  S.rotate([r1.rec], [20, 20], 15); S.scale([r1.rec], [20, 20], 1.25);
  const dxfTxt = S.serialize();
  const f1 = path.join(SAL, 'H2 salidas.dxf');
  fs.writeFileSync(f1, dxfTxt);
  const ez = py(EZ + `imgs = [e for e in d.paperspace() if e.dxftype()=='IMAGE']
out['imagenes'] = [{'archivo': e.image_def.dxf.filename, 'ancho': round(math.hypot(e.dxf.u_pixel.x, e.dxf.u_pixel.y)*e.dxf.image_size[0], 4), 'giro': round(math.degrees(math.atan2(e.dxf.u_pixel.y, e.dxf.u_pixel.x)), 3), 'x': round(e.dxf.insert[0], 3)} for e in imgs]
out['defs'] = len(d.objects.query('IMAGEDEF'))
out['capas'] = {L.dxf.name: L.dxf.lineweight for L in d.layers}
out['lw_obj'] = [e.dxf.lineweight for e in d.paperspace() if e.dxftype()=='LINE']
out['dict'] = 'ACAD_IMAGE_DICT' in d.rootdict
print(json.dumps(out))`, f1);
  check('ezdxf: H2 salidas.dxf sin errores', ez.errores && ez.errores.length === 0, JSON.stringify(ez).slice(0, 600));
  if (ez.imagenes) {
    check('ezdxf: 3 imágenes con ruta relativa', ez.imagenes.length === 3 && ez.imagenes.every((i) => !i.archivo.startsWith('/')) && ez.imagenes.some((i) => i.archivo === 'imagenes/firma.png'), JSON.stringify(ez.imagenes));
    check('ezdxf: imagen girada 15° y escalada (ancho 100)', ez.imagenes.some((i) => Math.abs(i.giro - 15) < 1e-3 && Math.abs(i.ancho - 100) < 1e-3), JSON.stringify(ez.imagenes));
    check('ezdxf: imagen girada 30° ancho 80', ez.imagenes.some((i) => Math.abs(i.giro - 30) < 1e-3 && Math.abs(i.ancho - 80) < 1e-3));
    check('ezdxf: 2 IMAGEDEF (una por archivo) y ACAD_IMAGE_DICT', ez.defs === 2 && ez.dict, JSON.stringify([ez.defs, ez.dict]));
    check('ezdxf: grosor por capa y por objeto', ez.capas['RED MT'] === 70 && ez.lw_obj.includes(35), JSON.stringify([ez.capas, ez.lw_obj]));
  }
  // deshacer las imágenes deja el DXF como antes
  const S2 = new Edit.Session(await DXF.open(new TextEncoder().encode(dxfTxt)));
  check('reabrir y guardar sin cambios = idéntico', S2.serialize() === dxfTxt);
  for (let k = 0; k < 5; k++) S.undo();
  check('deshacer las imágenes = como antes (salvo $HANDSEED)', sinSemilla(S.serialize()) === sinSemilla(antesImg));

  // reabrir: la plancha trae las 3 imágenes con su archivo
  const d2 = await DXF.open(new TextEncoder().encode(dxfTxt), { resolveURL: (f) => path.join(SAL, f) });
  const root2 = await d2.pages.find((p) => p.title === 'Plancha 1').build();
  const imgs = []; (function f(n) { if (n.k === 'i') imgs.push(n); (n.ch || []).forEach(f); })(root2);
  check('reabrir: 3 imágenes en la plancha', imgs.length === 3 && imgs.every((n) => n.src && fs.existsSync(n.src)), imgs.map((n) => n.src).join(','));

  // ------------------------------------------------------------ 2) PDF: grosores, no trazar, imágenes giradas
  const pdf1 = path.join(SAL, 'H2 salidas.pdf');
  const rp = await exportarPDF(f1, pdf1, { color: 'mono' });
  const fz = py(`import fitz, json, sys
d = fitz.open(sys.argv[1]); p = d[0]
dr = p.get_drawings()
out = {'paginas': len(d), 'trazos': len(dr), 'anchos': sorted(set(round(x['width'] or 0, 3) for x in dr)), 'imagenes': len(p.get_images(full=True)),
 'cajas': [ [round(v,1) for v in p.get_image_rects(x[0])[0]] for x in p.get_images(full=True)]}
print(json.dumps(out))`, pdf1);
  check('PDF: abre con 1 página', fz.paginas === 1, JSON.stringify(fz).slice(0, 400));
  check('PDF: solo 2 trazos (Defpoints y «no trazar» no salen)', fz.trazos === 2, JSON.stringify(fz.trazos));
  check('PDF: grosor 0,70 mm por capa y 0,35 mm por objeto', fz.anchos && fz.anchos.some((w) => Math.abs(w - 0.70 * 72 / 25.4) < 0.01) && fz.anchos.some((w) => Math.abs(w - 0.35 * 72 / 25.4) < 0.01), JSON.stringify(fz.anchos));
  check('PDF: 3 imágenes (la firma va una sola vez por archivo)', rp.stats.images === 3 && fz.imagenes >= 1, JSON.stringify([rp.stats.images, fz.imagenes]));
  check('PDF: sin avisos', !rp.stats.warnings.length, rp.stats.warnings.join(' | '));
  check('PDF: «no trazar» contado', rp.stats.noPlot === 2, rp.stats.noPlot);

  // ------------------------------------------------------------ 3) DWF: grosores e imagen girada (re-muestreada, no derecha)
  const dwf1 = path.join(SAL, 'H2 salidas.dwf');
  const rd = await exportarDXF(f1, dwf1, {});
  const w = w2dDe(dwf1);
  const lws = [...new Set(w.items.filter((i) => i.t === 'line').map((i) => i.lw))].sort((a, b) => a - b);
  const U = 1200 / 25.4;
  check('DWF: W2D completo', w.complete && !w.warnings.length, JSON.stringify(w.warnings));
  check('DWF: 2 líneas (no trazar fuera)', w.items.filter((i) => i.t === 'line').length === 2, w.items.filter((i) => i.t === 'line').length);
  check('DWF: grosor 0,70 y 0,35 mm', lws.includes(Math.round(0.70 * U)) && lws.includes(Math.round(0.35 * U)), JSON.stringify(lws));
  const wi = w.items.filter((i) => i.t === 'image');
  check('DWF: 3 imágenes', wi.length === 3 && rd.stats.images === 3, wi.length);
  check('DWF: sin aviso de «imagen girada»', !rd.stats.warnings.some((x) => /girada/i.test(x)), rd.stats.warnings.join(' | '));
  // la de 90° (ancho 40) queda vertical: más alta que ancha
  const dims = wi.map((i) => [Math.abs(i.x1 - i.x0) / U, Math.abs(i.y1 - i.y0) / U]);
  check('DWF: la imagen a 90° queda vertical (≈ 8,6 × 40 mm)', dims.some(([a, b]) => Math.abs(a - 40 * tam.h / tam.w) < 1 && Math.abs(b - 40) < 1), JSON.stringify(dims));
  check('DWF: tamaño < 0,6 MB', fs.statSync(dwf1).size < 0.6 * 1024 * 1024, fs.statSync(dwf1).size);

  // ------------------------------------------------------------ 4) GROSORES (tabla propuesta) sobre una copia de DR6
  const dr6 = fs.readFileSync(path.join(DATOS, 'DR6.dxf'));
  const dr6txt = decode(dr6);
  const D6 = await DXF.open(dr6); const S6 = new Edit.Session(D6);
  const rg = S6.aplicarGrosores(TABLA);
  check('GROSORES aplicó a las capas de la tabla', rg.ok && rg.n >= 30, JSON.stringify(rg).slice(0, 200));
  check('GROSORES: MT_EPM 0,50 · RUTA 0,70 · EJES 0,09', ['MT_EPM:50', 'RUTA:70', 'EJES:9'].every((x) => { const [c, v] = x.split(':'); return S6.findRec('LAYER', c).int(370) === +v; }));
  const r6 = S6.insertarImagen(D6.pages.find((p) => p.title === 'PLANCHA 1'), { archivo: 'firma_marcos_bn.png', wpx: tam.w, hpx: tam.h, at: [600, 47.5], ancho: 72, rot: 0, capa: '0' });
  check('IMAGEN en DR6 reutiliza su IMAGEDEF', r6.ok && r6.reutilizada, JSON.stringify(r6.error));
  const f6 = path.join(SAL, 'DR6 con grosores.dxf');
  fs.writeFileSync(f6, S6.serialize());
  fs.copyFileSync(path.join(DATOS, 'firma_marcos_bn.png'), path.join(SAL, 'firma_marcos_bn.png'));
  const ez6 = py(EZ + `out['lw'] = {L.dxf.name: L.dxf.lineweight for L in d.layers}\nout['defs'] = len(d.objects.query('IMAGEDEF'))\nprint(json.dumps(out))`, f6);
  check('ezdxf: DR6 con grosores sin errores', ez6.errores && ez6.errores.length === 0, JSON.stringify(ez6).slice(0, 400));
  check('ezdxf: DR6 sigue con 1 IMAGEDEF', ez6.defs === 1, ez6.defs);
  const p6 = path.join(SAL, 'DR6 con grosores - PLANCHA 1.pdf');
  await exportarPDF(f6, p6, { plancha: 'PLANCHA 1', color: 'mono' });
  const fz6 = py(`import fitz, json, sys\np = fitz.open(sys.argv[1])[0]\nprint(json.dumps({'anchos': sorted(set(round(x['width'] or 0, 2) for x in p.get_drawings()))}))`, p6);
  check('PDF DR6 mono: ≥ 5 grosores distintos (jerarquía)', fz6.anchos && fz6.anchos.length >= 5, JSON.stringify(fz6.anchos));
  while (S6.undo()) { /* deshacer todo */ }
  check('DR6: deshacer GROSORES e IMAGEN = idéntico al original (salvo $HANDSEED)', sinSemilla(S6.serialize()) === sinSemilla(dr6txt));

  // ------------------------------------------------------------ 5) todas las planchas en un solo PDF
  const pAll = path.join(SAL, 'DR6 - todas.pdf');
  const ra = await exportarPDF(path.join(DATOS, 'DR6.dxf'), pAll, { planchas: ['PLANCHA 1', 'PLANCHA 2', 'PLANCHA 3'], color: 'mono' });
  const fza = py(`import fitz, json, sys\nd = fitz.open(sys.argv[1])\nprint(json.dumps({'n': len(d), 'hojas': [[round(p.rect.width*25.4/72), round(p.rect.height*25.4/72)] for p in d], 'txt': [len(p.get_text()) for p in d], 'capas': len(d.get_ocgs())}))`, pAll);
  check('PDF de todas: 3 páginas A1', fza.n === 3 && fza.hojas.every(([a, b]) => a === 841 && b === 594), JSON.stringify(fza));
  check('PDF de todas: texto en cada página', fza.txt && fza.txt.every((n) => n > 1000), JSON.stringify(fza.txt));
  check('PDF de todas: capas compartidas', fza.capas > 0 && fza.capas <= 45, fza.capas);
  check('PDF de todas: < 1 MB', ra.bytes < 1024 * 1024, ra.bytes);

  // ------------------------------------------------------------ 6) LWDISPLAY en pantalla (motor de dibujo)
  const anchos = [];
  const ctx = { save() {}, restore() {}, transform() {}, clip() {}, fill() {}, setLineDash() {}, stroke() { anchos.push(this.lineWidth); }, set lineWidth(v) { this._lw = v; }, get lineWidth() { return this._lw; } };
  const nodo = { k: 'g', m: null, local: true, mm: 1, ch: [{ k: 'p', p: {}, stroke: '#000', lwmm: 0.5, bb: [0, 0, 10, 10] }], bb: [0, 0, 10, 10] };
  const modelo = { k: 'g', local: true, ch: [{ k: 'p', p: {}, stroke: '#000', lwmm: 0.5, bb: [0, 0, 10, 10] }], bb: [0, 0, 10, 10] };
  for (const v of [false, true]) { Scene.opts.lwDisplay = v; Scene.render(ctx, nodo, [0, 0, 10, 10], 10); Scene.render(ctx, modelo, [0, 0, 10, 10], 10); }
  Scene.opts.lwDisplay = undefined;
  check('LWDISPLAY: apagado = línea fina; encendido = 0,5 mm en plancha y ≈ 1,9 px en el modelo', anchos[0] < 0.1 && anchos[1] < 0.1 && Math.abs(anchos[2] - 0.5) < 1e-9 && Math.abs(anchos[3] * 10 - 0.5 * 96 / 25.4) < 1e-6, JSON.stringify(anchos));

  // ------------------------------------------------------------ 7) comandos nuevos registrados en la línea de comandos
  const cad = fs.readFileSync(W + 'cad.js', 'utf8');
  for (const a of ['EXPORTARPDF', 'PDF', 'TRAZAR', 'PLOT', 'IMAGEN', 'IMAGEATTACH', 'LWDISPLAY', 'GL', 'GROSORES', 'EXPORTARDWF', 'DWF'])
    check('alias ' + a, new RegExp(`\\b${a}: '`).test(cad));
  const html = fs.readFileSync(W + 'index.html', 'utf8');
  check('index.html carga pdf_writer.js y grosores_capas.js', html.includes('src="pdf_writer.js"') && html.includes('src="grosores_capas.js"'));

  console.log(`H2: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
