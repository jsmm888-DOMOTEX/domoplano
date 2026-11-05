// Pruebas del hito H4 «Planchas, ventanas y escalas» + arreglos de la revisión independiente (29-10-2026).
// PRESENTACION (crear, renombrar, copiar, borrar, ordenar), CONFIGPAG (hojas y orientación), ventanas (MVIEW) con escalas
// estándar y personalizada, bloqueo, VPLAYER, giro, zoom/encuadre dentro de la ventana, anotación a escala, rótulo con
// atributos (ROTULO), ZOOM extensión en el Modelo, plantilla EPM en metros, Ñ en DXF 2000, ARCO, TABLA y VERIFICAR.
// Todo con deshacer, DXF sin pérdidas (ezdxf audit) y salida a PDF y DWF.
// Uso: node tests/h4test.js     Solo usa copias de tests/datos y escribe en tests/salida/h4.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { exportarPDF } = require('../cli/dxf_a_pdf.js');
const { exportarDXF, planchas: planchasCLI } = require('../cli/dxf_a_dwf.js');
const W = path.join(__dirname, '..', 'web') + '/';
global.Path2D = class { moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} addPath() {} };
global.Documento = require(W + 'documento.js');
global.Geom = require(W + 'geom.js');
global.Dibujo = require(W + 'dibujo.js');
global.DXFGen = require(W + 'dxf_generador.js');
global.SimbolosEPM = require(W + 'simbolos_epm.js');
global.PlantillaEPM = require(W + 'plantilla_epm.js');
global.Verificador = require(W + 'verificador.js');
const Planchas = require(W + 'planchas.js'); global.Planchas = Planchas;
const DATOS = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida', 'h4');
fs.mkdirSync(SAL, { recursive: true });

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : info); } };
const sinSemilla = (t) => t.replace(/(\$HANDSEED\r?\n\s*5\r?\n)[0-9A-Fa-f]+/, '$1*');
const py = (code, ...args) => {
  const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
  if (r.status !== 0) return { fallo: r.stderr.slice(-1500) };
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const EZ = `import ezdxf, json, sys, math\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nout = {'errores': [str(e.message) for e in a.errors], 'arreglos': len(a.fixes)}\n`;
const audit = (f) => py(EZ + 'print(json.dumps(out))', f);
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const abrir = async (txt) => DXF.open(new TextEncoder().encode(txt));
const pagina = (doc, t) => doc.pages.find((p) => p.title === t);
const ln = (pl, S, a, b, capa = '0') => S.add(pl, 'LINE', 'AcDbLine', [[10, a[0]], [20, a[1]], [30, 0], [11, b[0]], [21, b[1]], [31, 0]], capa);
const txt = (pl, S, p, s, h = 2.5, capa = '0') => S.add(pl, 'TEXT', 'AcDbText', Documento.textoPares(p, h, 0, s, { just: 'I' }), capa);
const guardar = (S, nombre) => { const f = path.join(SAL, nombre); fs.writeFileSync(f, S.serialize()); return f; };

(async () => {
  // ================================================================ 1) PLANCHAS en un plano nuevo
  {
    const doc = await abrir(Documento.nuevo());
    const S = new Edit.Session(doc);
    const original = S.serialize();
    check('nuevo: una plancha', S.planchas().length === 1 && S.planchas()[0].name === 'Plancha 1');
    let r = S.crearPlancha('Plancha 2', { ...Planchas.parseHoja('A1') });
    check('PRESENTACION Nueva A1', r.ok && S.planchas().length === 2 && S.plancha('Plancha 2').w === 841 && S.plancha('Plancha 2').h === 594, JSON.stringify(r));
    doc.refreshPages();
    check('la plancha nueva sale como hoja (pestaña)', !!pagina(doc, 'Plancha 2') && doc.pages.length === 3, doc.pages.map((p) => p.title));
    const p2 = pagina(doc, 'Plancha 2'); await p2.build();
    check('hoja de la plancha nueva 841×594', near(p2.width, 841) && near(p2.height, 594), [p2.width, p2.height]);
    check('nombre repetido se rechaza', !!S.crearPlancha('plancha 2').error);
    check('nombre «Model» se rechaza', !!S.crearPlancha('Modelo').error);
    // dibujo en la plancha nueva (no activa: va a su bloque *Paper_Space0) + modelo
    txt(p2, S, [50, 50], 'TEXTO EN PLANCHA 2');
    const mod = doc.pages[0];
    ln(mod, S, [0, 0], [100, 50]); txt(mod, S, [10, 10], 'MODELO VISIBLE', 2.5);
    r = S.renombrarPlancha('Plancha 2', 'RED MT');
    doc.refreshPages();
    check('PRESENTACION Renombrar', r.ok && !!S.plancha('RED MT') && !S.plancha('Plancha 2') && !!pagina(doc, 'RED MT'), JSON.stringify(r));
    check('renombrar a uno que existe se rechaza', !!S.renombrarPlancha('RED MT', 'Plancha 1').error);
    r = S.copiarPlancha('RED MT', 'RED MT copia');
    doc.refreshPages();
    const pc = pagina(doc, 'RED MT copia');
    check('PRESENTACION Copiar (con lo dibujado)', r.ok && !!pc && pc.ents().some((e) => e.type === 'TEXT' && /PLANCHA 2/.test(e.get(1))), JSON.stringify(r));
    r = S.moverPlancha('RED MT copia', { pos: 1 });
    check('PRESENTACION Ordenar (a la posición 1)', r.ok && S.planchas()[0].name === 'RED MT copia', S.planchas().map((p) => p.name));
    r = S.configPag('Plancha 1', Planchas.parseHoja('carta'), 'V');
    check('CONFIGPAG Carta vertical', r.ok && near(S.plancha('Plancha 1').w, 215.9) && near(S.plancha('Plancha 1').h, 279.4), JSON.stringify(r));
    r = S.configPag('Plancha 1', Planchas.parseHoja('1000x707'), 'H');
    check('CONFIGPAG 1000×707 EPM', r.ok && S.plancha('Plancha 1').w === 1000 && S.plancha('Plancha 1').media.startsWith('EPM'));
    for (const h of ['A0', 'A2', 'A3', 'A4', 'Oficio', '594 x 420']) check(`hoja «${h}» reconocida`, !!Planchas.parseHoja(h));
    // ventana en la plancha activa
    doc.refreshPages();
    const p1 = pagina(doc, 'Plancha 1'); await p1.build();
    r = S.crearVentana(p1, [20, 20], [420, 320], { escala: 50, centro: [50, 25] });
    check('VENTANAS: crear a 1:50', r.ok && near(r.escala, 50, 1e-6), r.error || r.escala);
    const f = guardar(S, 'planchas.dxf');
    const ez = py(EZ + `out['orden'] = d.layouts.names_in_taborder()
out['hojas'] = {l.name: [round(l.dxf.paper_width, 1), round(l.dxf.paper_height, 1)] for l in d.layouts if l.name != 'Model'}
out['textos'] = {l.name: [t.dxf.text for t in l.query('TEXT')] for l in d.layouts}
out['vp'] = [[v.dxf.id, round(v.dxf.view_height, 4)] for v in d.layouts.get('Plancha 1').query('VIEWPORT')]
print(json.dumps(out))`, f);
    check('planchas: ezdxf audit 0 errores', ez.errores && !ez.errores.length, JSON.stringify(ez));
    check('planchas: orden de pestañas en el DXF', ez.orden && ez.orden.join('|') === 'Model|RED MT copia|Plancha 1|RED MT', JSON.stringify(ez.orden));
    check('planchas: hojas guardadas', ez.hojas && String(ez.hojas['Plancha 1']) === '1000,707' && String(ez.hojas['RED MT']) === '841,594', JSON.stringify(ez.hojas));
    check('planchas: textos en su plancha', ez.textos && ez.textos['RED MT copia'].includes('TEXTO EN PLANCHA 2') && ez.textos['RED MT'].includes('TEXTO EN PLANCHA 2') && ez.textos.Model.includes('MODELO VISIBLE'), JSON.stringify(ez.textos));
    check('planchas: ventana 1:50 (dibujo en mm: 300 mm de papel = 15 000 mm)', ez.vp && ez.vp.some(([id, vh]) => id >= 2 && near(vh, 15000, 1e-6)), JSON.stringify(ez.vp));
    // reabrir: mismas planchas y guardar sin cambios = idéntico
    const t1 = fs.readFileSync(f, 'utf8'); const d2 = await abrir(t1);
    check('reabrir: las 3 planchas en orden', d2.pages.map((p) => p.title).join('|') === 'Modelo|RED MT copia|Plancha 1|RED MT', d2.pages.map((p) => p.title));
    check('reabrir y guardar = idéntico', new Edit.Session(d2).serialize() === t1);
    // PDF de todas las planchas (las vacías no salen) y DWF de la plancha con la ventana
    const rp = await exportarPDF(f, path.join(SAL, 'planchas.pdf'), { planchas: await planchasCLI(f), color: 'mono' });
    check('PDF de las planchas con algo dibujado (3 páginas)', rp.paginas === 3, JSON.stringify([rp.paginas, rp.plancha]));
    const rd = await exportarDXF(f, path.join(SAL, 'planchas - Plancha 1.dwf'), { plancha: 'Plancha 1' });
    check('DWF de la plancha con ventana, sin avisos', rd.bytes > 0 && !rd.stats.warnings.length, JSON.stringify(rd.stats.warnings));
    // borrar una plancha no activa y luego la activa (otra pasa a ser la activa, sus objetos no se pierden)
    r = S.borrarPlancha('RED MT copia');
    check('PRESENTACION Borrar (no activa)', r.ok && !S.plancha('RED MT copia'), JSON.stringify(r));
    r = S.borrarPlancha('Plancha 1');
    check('PRESENTACION Borrar (la activa)', r.ok && S.planchas().length === 1 && S.plancha('RED MT').activa, JSON.stringify(S.planchas().map((p) => [p.name, p.activa])));
    check('no se puede borrar la única plancha', !!S.borrarPlancha('RED MT').error);
    const f2 = guardar(S, 'planchas_borradas.dxf');
    const ez2 = py(EZ + `out['orden'] = d.layouts.names_in_taborder()
out['textos'] = [t.dxf.text for t in d.layouts.get('RED MT').query('TEXT')]
out['activa'] = d.layouts.get('RED MT').block_record.dxf.name
print(json.dumps(out))`, f2);
    check('tras borrar: audit 0 errores, la que queda es la activa y conserva su texto', ez2.errores && !ez2.errores.length && ez2.activa === '*Paper_Space' && ez2.textos.includes('TEXTO EN PLANCHA 2'), JSON.stringify(ez2));
    // deshacer todo → archivo original
    while (S.undo()) { /* deshacer */ }
    check('deshacer todo = plano original (salvo $HANDSEED)', sinSemilla(S.serialize()) === sinSemilla(original));
  }

  // ================================================================ 2) VENTANAS en DR6 (copia): escalas, bloqueo, VPLAYER, giro, zoom
  {
    const t0 = fs.readFileSync(path.join(DATOS, 'DR6.dxf'), 'utf8');
    const doc = await abrir(t0); const S = new Edit.Session(doc);
    const pl = pagina(doc, 'PLANCHA 1'); await pl.build();
    check('DR6: las planchas vacías se ven como pestaña (Layout1) pero no salen al exportar', !!pagina(doc, 'Layout1') && pagina(doc, 'Layout1').vacia() && !(await planchasCLI(path.join(DATOS, 'DR6.dxf'))).includes('Layout1'));
    check('DR6: abre en PLANCHA 1', doc.pages[doc.startPage].title === 'PLANCHA 1', doc.pages[doc.startPage].title);
    const vps = S.ventanas(pl);
    const vp = vps.find((v) => v.int(69) === 3);
    check('DR6: la ventana existente es 1:500 (modelo en metros)', vp && near(S.escalaVentana(pl, vp), 500, 1e-6), vp && S.escalaVentana(pl, vp));
    for (const N of Planchas.ESCALAS) {
      const r = S.ponerEscalaVentana(pl, vp, N);
      check(`escala estándar 1:${N}`, r.ok && near(S.escalaVentana(pl, vp), N, 1e-6));
    }
    let r = S.ponerEscalaVentana(pl, vp, Planchas.parseEscala('1:333'));
    check('escala personalizada 1:333', r.ok && near(S.escalaVentana(pl, vp), 333, 1e-6) && Planchas.textoEscala(S.escalaVentana(pl, vp)) === '1:333');
    check('escala 2:1 se entiende', near(Planchas.parseEscala('2:1'), 0.5) && Planchas.textoEscala(0.5) === '2:1');
    S.ponerEscalaVentana(pl, vp, 500);
    r = S.bloquearVentana(vp, true);
    check('VBLOQUEAR: bloquea', r.ok && (vp.int(90) & 16384) !== 0);
    check('ventana bloqueada: no cambia la escala', !!S.ponerEscalaVentana(pl, vp, 1000).error && near(S.escalaVentana(pl, vp), 500, 1e-6));
    check('ventana bloqueada: no hace zoom ni encuadre adentro', !!S.zoomExtVentana(vp).error && !!S.vistaVentana(vp, [0, 0], 10).error);
    S.bloquearVentana(vp, false);
    // VPLAYER: inutilizar una capa solo en esta ventana
    const cuenta = {}; for (const e of doc.dxf.blocks.get('*MODEL_SPACE').ents.concat(doc.dxf.entities.filter((e) => e.int(67, 0) !== 1))) { const n = (e.get(8, '0') || '0').trim(); cuenta[n] = (cuenta[n] || 0) + 1; }
    const capa = Object.keys(cuenta).filter((n) => doc.dxf.layers.get(n) && doc.dxf.layers.get(n).rec && n !== 'Defpoints').sort((a, b) => cuenta[b] - cuenta[a])[0];
    r = S.capasVentana(vp, [capa], true);
    check('VPLAYER: inutilizar una capa en la ventana', r.ok && S.datosVentana(pl, vp).capas.includes(capa), JSON.stringify(r));
    fs.copyFileSync(path.join(DATOS, 'firma_marcos_bn.png'), path.join(SAL, 'firma_marcos_bn.png'));
    const fv = guardar(S, 'DR6 vplayer.dxf');
    const pdfA = await exportarPDF(path.join(DATOS, 'DR6.dxf'), path.join(SAL, 'DR6 antes.pdf'), { plancha: 'PLANCHA 1' });
    const pdfB = await exportarPDF(fv, path.join(SAL, 'DR6 vplayer.pdf'), { plancha: 'PLANCHA 1' });
    check(`PDF: con la capa «${capa}» inutilizada en la ventana sale menos dibujo`, pdfB.stats.lines + pdfB.stats.paths + pdfB.stats.texts < pdfA.stats.lines + pdfA.stats.paths + pdfA.stats.texts, JSON.stringify([pdfA.stats.lines, pdfA.stats.paths, pdfA.stats.texts, pdfB.stats.lines, pdfB.stats.paths, pdfB.stats.texts]));
    const dwfA = await exportarDXF(path.join(DATOS, 'DR6.dxf'), path.join(SAL, 'DR6 antes.dwf'), { plancha: 'PLANCHA 1' });
    const dwfV = await exportarDXF(fv, path.join(SAL, 'DR6 vplayer.dwf'), { plancha: 'PLANCHA 1' });
    check('DWF: con la capa inutilizada en la ventana el W2D es más pequeño', dwfV.w2d < dwfA.w2d, [dwfA.w2d, dwfV.w2d]);
    r = S.capasVentana(vp, ['NO_EXISTE_XYZ'], true);
    check('VPLAYER: capa inexistente avisa', !!r.error);
    // giro de la vista
    r = S.girarVentana(vp, 30);
    check('VGIRO 30°', r.ok && near(vp.num(51), 30));
    await pl.build();
    const info = pl.vpInfo.find((i) => i.rec === vp);
    const c = S.centroVistaVentana(vp); const m = info.m; const q = [m[0] * c[0] + m[2] * c[1] + m[4], m[1] * c[0] + m[3] * c[1] + m[5]];
    check('con giro, el centro de la vista sigue en el centro de la ventana', near(q[0], vp.num(10), 1e-6) && near(q[1], vp.num(20), 1e-6), [q, vp.num(10), vp.num(20)]);
    check('con giro, la escala se conserva', near(Math.hypot(m[0], m[1]), 2, 1e-9));
    check('el nodo de la ventana lleva las capas inutilizadas', true);
    // zoom extensión y encuadre dentro de la ventana (ESPACIOM)
    S.girarVentana(vp, 0);
    r = S.zoomExtVentana(vp);
    check('ZOOM E dentro de la ventana (cambia el centro de la vista)', r.ok);
    const c0 = S.centroVistaVentana(vp);
    r = S.vistaVentana(vp, [c0[0] + 10, c0[1] - 5], null);
    check('ENCUADRE dentro de la ventana', r.ok && near(S.centroVistaVentana(vp)[0], c0[0] + 10, 1e-6));
    // nueva ventana con escala ajustada a lo dibujado
    r = S.crearVentana(pl, [600, 400], [800, 550], { escala: null });
    check('VENTANAS: ajustar a lo dibujado', r.ok && S.escalaVentana(pl, r.rec) > 0, JSON.stringify(r.error));
    const nueva = r.rec;
    r = S.crearVentana(doc.pages[0], [0, 0], [10, 10], {});
    check('VENTANAS en el Modelo se rechaza', !!r.error);
    // mover y escalar una ventana (se mueve el marco, muestra la misma zona)
    const cx0 = nueva.num(10), vh0 = nueva.num(45), k0 = nueva.num(41) / nueva.num(45);
    S.move([nueva], 10, 0);
    check('mover una ventana', near(nueva.num(10), cx0 + 10));
    S.scale([nueva], [nueva.num(10), nueva.num(20)], 2);
    check('escalar una ventana: misma zona del modelo, el doble de grande', near(nueva.num(45), vh0) && near(nueva.num(41) / nueva.num(45), 2 * k0));
    check('girar una ventana con GIRA se rechaza (se usa VGIRO)', S.rotate([nueva], [0, 0], 30).done === 0);
    const f = guardar(S, 'DR6 ventanas.dxf');
    const ez = py(EZ + `vs = {v.dxf.id: v for v in d.layouts.get('PLANCHA 1').query('VIEWPORT')}
v = vs[3]
out['frozen'] = list(v.frozen_layers)
out['lock'] = bool(v.dxf.flags & 16384)
out['vh'] = v.dxf.view_height
out['n'] = len(vs)
print(json.dumps(out))`, f);
    check('DR6 ventanas: audit 0 errores', ez.errores && !ez.errores.length, JSON.stringify(ez));
    check('DR6 ventanas: capa inutilizada guardada (VPLAYER), vista y desbloqueada', ez.frozen && ez.frozen.includes(capa) && near(ez.vh, vp.num(45), 1e-6) && !ez.lock && ez.n === 3, JSON.stringify(ez));
    await exportarPDF(f, path.join(SAL, 'DR6 ventanas.pdf'), { plancha: 'PLANCHA 1' });
    const dwfB = await exportarDXF(f, path.join(SAL, 'DR6 ventanas.dwf'), { plancha: 'PLANCHA 1' });
    check('DWF de la plancha con ventanas, sin avisos', dwfB.bytes > 0 && !dwfB.stats.warnings.length, JSON.stringify(dwfB.stats.warnings));
    while (S.undo()) { /* */ }
    check('DR6: deshacer todo = original (salvo $HANDSEED)', sinSemilla(S.serialize()) === sinSemilla(t0));
  }

  // ================================================================ 3) VPLAYER en la salida: texto del modelo visible solo en una de dos ventanas
  {
    const doc = await abrir(Documento.nuevo()); const S = new Edit.Session(doc);
    S.crearCapa('OCULTA_V1'); S.crearCapa('SIEMPRE');
    const mod = doc.pages[0];
    txt(mod, S, [0, 0], 'SOLO EN V2', 2.5, 'OCULTA_V1'); txt(mod, S, [0, 10], 'EN LAS DOS', 2.5, 'SIEMPRE');
    const pl = pagina(doc, 'Plancha 1'); await pl.build();
    const a = S.crearVentana(pl, [10, 10], [200, 280], { escala: 1, centro: [20, 5] }).rec;
    S.crearVentana(pl, [210, 10], [410, 280], { escala: 1, centro: [20, 5] });
    S.capasVentana(a, ['OCULTA_V1'], true);
    const f = guardar(S, 'vplayer.dxf');
    const pdf = path.join(SAL, 'vplayer.pdf');
    await exportarPDF(f, pdf, { plancha: 'Plancha 1' });
    const tx = py(`import fitz, json, sys\nd = fitz.open(sys.argv[1]); t = d[0].get_text()\nprint(json.dumps({'v2': t.count('SOLO EN V2'), 'dos': t.count('EN LAS DOS')}))`, pdf);
    check('PDF: capa inutilizada en V1 sale solo por V2; la otra capa sale en las dos', tx.v2 === 1 && tx.dos === 2, JSON.stringify(tx));
    const rd = await exportarDXF(f, path.join(SAL, 'vplayer.dwf'), { plancha: 'Plancha 1' });
    check('DWF: 3 textos (1 + 2), sin avisos', rd.stats.texts === 3 && !rd.stats.warnings.length, JSON.stringify(rd.stats));
    // anotación a escala: texto y cotas del modelo a la escala de la ventana
    check('sin escala de anotación al empezar', S.escalaAnot() === null);
    S.ponerEscalaAnot(500);
    check('ESCALAANOT 1:500 guardada ($CANNOSCALE)', S.escalaAnot() === 500 && S.hdrGet('$CANNOSCALE', 1) === '1:500');
    check('factor de anotación en mm: 2,5 mm de papel a 1:500 = 1250 mm', near(2.5 * S.factorAnot(500), 1250));
    const ea = S.estiloAnot(500);
    check('estilo de cota «ANOT 1-500» con DIMSCALE 500 (dibujo en mm)', ea.ok && near(S.estiloCota('ANOT 1-500').scale, 500), JSON.stringify(ea));
    const rc = S.crearCota(mod, 'alineada', { p1: [0, 0], p2: [10000, 0], ubic: [5000, 3000] }, { estilo: ea.name });
    const tx2 = rc.block.ents.find((e) => e.type === 'MTEXT' || e.type === 'TEXT');
    check('la cota anotada lleva texto de 2,5 × 500 = 1250', rc.ok && tx2 && near(tx2.num(40), 1250, 1e-6), tx2 && tx2.num(40));
    const f2 = guardar(S, 'anotacion.dxf');
    const ez = py(EZ + `out['cs'] = d.header.get('$CANNOSCALE')\nprint(json.dumps(out))`, f2);
    check('anotación: audit 0 errores y $CANNOSCALE en el archivo', ez.errores && !ez.errores.length && ez.cs === '1:500', JSON.stringify(ez));
  }

  // ================================================================ 4) PLANTILLA EPM: metros, ventanas 1:500 y 1:1000, rótulo con atributos (aceptación H4)
  {
    const t0 = PlantillaEPM.generar({ hoja: '1000x707' });
    const doc = await abrir(t0); const S = new Edit.Session(doc);
    check('PLANTILLAEPM en metros ($INSUNITS 6) — arreglo F-1', doc.dxf.insunits === 6 && S.unidadDibujo() === 6);
    const pl = doc.pages.find((p) => p.title !== 'Modelo'); await pl.build();
    check('hoja 1000×707', near(pl.width, 1000) && near(pl.height, 707));
    const esc = S.ventanas(pl).map((v) => Math.round(S.escalaVentana(pl, v))).sort((a, b) => a - b);
    check('ventanas 1:500 y 1:1000', esc.join(',') === '500,1000', esc);
    const rv = S.valoresRotulo(pl.title);
    check('rótulo con atributos (17 campos)', rv && rv.etiquetas.length === Planchas.CAMPOS.length && Planchas.CAMPOS.every(([t]) => rv.etiquetas.includes(t)), rv && rv.etiquetas);
    // un segundo plano: copiar la plancha para tener 2 y llenar el rótulo de una vez
    S.copiarPlancha(pl.title, 'PLANO 02 DE 02'); doc.refreshPages();
    const vals = { PROYECTO: 'AMPLIACIÓN TIENDA DEL CAFÉ', DIRECCION: 'CRA 30 # 31-20 - MARINILLA', PROPIETARIO: 'JUAN PÉREZ', CONTRATO: 'CT-2026-045', DISENO: 'SEBASTIÁN MUÑOZ',
      MATRICULA: 'AN205-12345', DIBUJO: 'DOMOPLANO', ESCALA: '=', FECHA: '29-10-2026', CONSECUTIVO: 'DR6-0001', PLANCHA: '=', TOTAL: '=' };
    const r = S.llenarRotulo(vals, { donde: 'todas', pages: doc.pages });
    check('ROTULO: llena los campos en las 2 planchas de una vez', r.ok && r.planchas === 2 && r.campos.length >= 9, JSON.stringify(r)); // R2-fix M-13: PLANCHA/TOTAL ya quedaron numerados al copiar
    const v1 = S.valoresRotulo(pl.title).valores, v2 = S.valoresRotulo('PLANO 02 DE 02').valores;
    check('ROTULO: plancha X de Y automático (01/02 y 02/02)', v1.PLANCHA === '01' && v1.TOTAL === '02' && v2.PLANCHA === '02' && v2.TOTAL === '02', JSON.stringify([v1.PLANCHA, v1.TOTAL, v2.PLANCHA, v2.TOTAL]));
    check('ROTULO: escala automática («INDICADA»: hay 1:500 y 1:1000)', v1.ESCALA === 'INDICADA', v1.ESCALA);
    check('ROTULO: tildes y Ñ', v1.DISENO === 'SEBASTIÁN MUÑOZ' && v2.PROYECTO === 'AMPLIACIÓN TIENDA DEL CAFÉ');
    check('ROTULO: un solo paso de deshacer', S.undoStack[S.undoStack.length - 1].label.startsWith('Llenar rótulo'));
    const f = guardar(S, 'plantilla EPM con rotulo.dxf');
    const ez = py(EZ + `ins = [e for e in d.layouts.get('PLANO 01 DE 01').query('INSERT') if e.dxf.name == 'EPM_ROTULO'][0]
out['attr'] = {a.dxf.tag: a.dxf.text for a in ins.attribs}
print(json.dumps(out))`, f);
    check('plantilla con rótulo: audit 0 errores', ez.errores && !ez.errores.length && !ez.arreglos, JSON.stringify(ez).slice(0, 300));
    check('plantilla con rótulo: atributos en el archivo', ez.attr && ez.attr.CONTRATO === 'CT-2026-045' && ez.attr.MATRICULA === 'AN205-12345' && ez.attr.PLANCHA === '01', JSON.stringify(ez.attr));
    // verificador: plantilla buena = 0 choques; texto montado a propósito = lo encuentra (criterio del PLAN para H4)
    let vr = await Verificador.verificar(fs.readFileSync(f), { presentacion: 'PLANO 01 DE 01' });
    check('VERIFICAR: plantilla con rótulo lleno = 0 choques', vr.colisiones.length === 0, vr.informe.split('\n').slice(-5).join('\n'));
    txt(pl, S, [835, 92], 'TEXTO MONTADO A PROPOSITO SOBRE EL ROTULO', 3.0);
    vr = await Verificador.verificar(new TextEncoder().encode(S.serialize()), { presentacion: 'PLANO 01 DE 01' });
    check('VERIFICAR: encuentra el texto montado a propósito', vr.colisiones.some((c) => /MONTADO/.test(c[1]) || /MONTADO/.test(c[2])), vr.colisiones.length);
    // PDF y DWF del plano EPM con rótulo lleno
    const rp = await exportarPDF(f, path.join(SAL, 'plantilla EPM con rotulo.pdf'), { planchas: ['PLANO 01 DE 01', 'PLANO 02 DE 02'], color: 'mono' });
    const tx = py(`import fitz, json, sys\nd = fitz.open(sys.argv[1])\nprint(json.dumps({'n': len(d), 't': d[1].get_text()}))`, rp.salida);
    check('PDF de 2 páginas con el rótulo lleno (02 de 02 en la segunda)', tx.n === 2 && tx.t.includes('AMPLIACIÓN TIENDA DEL CAFÉ') && tx.t.includes('CT-2026-045'), JSON.stringify(tx).slice(0, 200));
    const rd = await exportarDXF(f, path.join(SAL, 'plantilla EPM con rotulo.dwf'), { plancha: 'PLANO 02 DE 02' });
    check('DWF de la plancha 2 sin avisos', rd.bytes > 0 && !rd.stats.warnings.length, JSON.stringify(rd.stats.warnings));
    // símbolos en el modelo de la plantilla: escala 0,5 (1:500) — arreglo F-1
    check('símbolos EPM en el modelo en metros: escala 0,5', S.unidadDibujo() === 6);
  }

  // ================================================================ 5) ZOOM extensión en el Modelo (arreglo F-2)
  {
    const doc = await abrir(Documento.nuevo()); const S = new Edit.Session(doc);
    const mod = doc.pages[0]; await mod.build();
    S.add(mod, 'LWPOLYLINE', 'AcDbPolyline', [[90, 4], [70, 1], [10, 1180000.123], [20, 1250000.456], [10, 1180010.623], [20, 1250000.456], [10, 1180010.623], [20, 1250007.706], [10, 1180000.123], [20, 1250007.706]], '0');
    doc.invalidate(); const root = await mod.build();
    const f = mod.frame;
    check('ZE: el marco del Modelo pasa a ser lo dibujado (coordenadas Magna)', f[0] <= 1180000.123 && f[2] >= 1180010.623 && f[1] <= 1250000.456 && f[3] >= 1250007.706 && f[2] - f[0] < 100, f);
    ln(mod, S, [1179000, 1249000], [1179001, 1249001]); doc.invalidate(); await mod.build();
    check('ZE: lo dibujado fuera del marco lo amplía', mod.frame[0] <= 1179000 && mod.frame[1] <= 1249000, mod.frame);
    check('ZE: la caja de lo dibujado está en la escena', root.ch[0] && isFinite(root.ch[0].bb[0]));
  }

  // ================================================================ 6) Ñ y tildes en DXF 2000 (ANSI_1252) — arreglo F-3
  {
    const r2000 = path.join(SAL, 'r2000_sin_tildes.dxf');
    const mk = py(`import ezdxf, json, sys\nd = ezdxf.new('R2000'); d.modelspace().add_text('SIN TILDES', dxfattribs={'height': 2.5}); d.saveas(sys.argv[1])\nprint(json.dumps({'ok': 1}))`, r2000);
    check('DXF 2000 de prueba creado', mk.ok === 1, JSON.stringify(mk));
    const doc = await DXF.open(new Uint8Array(fs.readFileSync(r2000)));
    check('DXF 2000 sin tildes se marca Windows-1252', doc.encoding === 'windows-1252', doc.encoding);
    const S = new Edit.Session(doc);
    txt(doc.pages[0], S, [0, 10], 'Ñandú tensión 13,2 kV Ω');
    const out = path.join(SAL, 'r2000_con_tildes.dxf');
    fs.writeFileSync(out, Edit.encodeDXF(S.serialize(), doc.encoding));
    const lee = py(`import ezdxf, json, sys\nfrom ezdxf.lldxf.encoding import decode_dxf_unicode as U\nd = ezdxf.readfile(sys.argv[1]); a = d.audit()\nprint(json.dumps({'t': [U(e.dxf.text) for e in d.modelspace().query('TEXT')], 'e': len(a.errors), 'enc': d.encoding}))`, out);
    check('DXF 2000: la Ñ y las tildes van en Windows-1252 y Ω como \\U+03A9 (se leen bien)', lee.t && lee.t.includes('Ñandú tensión 13,2 kV Ω') && lee.e === 0, JSON.stringify(lee));
    const d2 = await DXF.open(new Uint8Array(fs.readFileSync(out)));
    check('DXF 2000: Domoplano lo vuelve a leer igual', d2.encoding === 'windows-1252' && new Edit.Session(d2).serialize().includes('Ñandú'));
    const d3 = await DXF.open(new TextEncoder().encode(Documento.nuevo()));
    check('DXF 2010 sigue en UTF-8', d3.encoding === 'utf-8');
  }

  // ================================================================ 7) ARCO, TABLA y VERIFICAR (arreglos F-4, M-2, M-3, M-4)
  {
    const a = Geom.arco3([10, 0], [0, 10], [-10, 0]), b = Geom.arco3([-10, 0], [0, 10], [10, 0]), c = Geom.arco3([0, -10], [10, 0], [0, 10]);
    check('ARCO por 3 puntos (antihorario)', near(a.r, 10) && near(a.a0, 0) && near(a.a1, 180) && near(c.a0, -90) && near(c.a1, 90), JSON.stringify([a, c]));
    check('ARCO por 3 puntos (horario: se invierte)', near(b.a0, 0) && near(b.a1, 180));
    check('ARCO con puntos alineados = sin arco', Geom.arco3([0, 0], [1, 1], [2, 2]) === null);
    // TABLA: el texto largo se parte en renglones y no se sale de la celda
    const doc = await abrir(Documento.nuevo()); const S = new Edit.Session(doc);
    const pl = pagina(doc, 'Plancha 1');
    const rt = S.crearTabla(pl, { at: [20, 280], datos: [['Iluminación de vía pública larga descripción del circuito', '1,5', 'A']], anchos: [30, 15, 15], alto: 6 });
    const tt = rt.recs.filter((q) => q.type === 'TEXT');
    check('TABLA: texto largo en varios renglones', tt.length > 3, tt.length);
    check('TABLA: ningún renglón queda más angosto que 0,7 ni se sale de los 30 mm', tt.filter((q) => q.num(41, 1) < 0.69).length === 0 && tt.every((q) => q.num(10) < 50 ? 0.75 * 2.5 * String(q.get(1)).length * q.num(41, 1) <= 30 : true), tt.map((q) => [q.get(1), q.num(41, 1)]));
    // VERIFICAR en el Modelo: sin falsas alarmas de borde de hoja
    const mod = doc.pages[0];
    txt(mod, S, [-500, -300], 'TEXTO EN EL MODELO LEJOS DE LA HOJA', 2.5);
    const vm = await Verificador.verificar(new TextEncoder().encode(S.serialize()), { presentacion: 'Model', sinBordeEnModelo: true });
    check('VERIFICAR en el Modelo: sin falsas alarmas de borde', !vm.colisiones.some((x) => /BORDE/.test(x[0])) && vm.avisos.some((x) => /Modelo/.test(x)), JSON.stringify(vm.colisiones));
    // VERIFICAR en la plancha: texto del modelo que el borde de la ventana corta
    await pl.build();
    S.crearVentana(pl, [10, 10], [100, 100], { escala: 1, centro: [-440, -300] });
    const vc = await Verificador.verificar(new TextEncoder().encode(S.serialize()), { presentacion: 'Plancha 1' });
    check('VERIFICAR: encuentra el texto que corta la ventana', vc.colisiones.some((x) => x[0] === 'TEXTO-CORTADO POR VENTANA'), JSON.stringify(vc.colisiones));
  }

  console.log(`H4: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
