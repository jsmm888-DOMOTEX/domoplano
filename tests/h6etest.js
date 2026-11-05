// Pruebas H6-E: COMPARAR (versiones de un plano, DXF y DWF, marcas de EPM) y CHECKEPM (lista NC-RA8-001), en el motor,
// en la línea de comandos y por el MCP. Trabaja SOLO con copias en tests/salida/h6e (no toca tests/datos ni planos de clientes).
// Uso:  node tests/h6etest.js
const fs = require('fs'), path = require('path'), cp = require('child_process');
const R = path.join(__dirname, '..');
const DAT = path.join(__dirname, 'datos'), SAL = path.join(__dirname, 'salida', 'h6e');
fs.rmSync(SAL, { recursive: true, force: true }); fs.mkdirSync(SAL, { recursive: true });
let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 700)); } };
const py = (code, ...args) => { const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' }); if (r.status !== 0) return { fallo: r.stderr.slice(-1500) }; return JSON.parse(r.stdout.trim().split('\n').pop()); };
const copia = (n, como = n) => { const d = path.join(SAL, como); fs.copyFileSync(path.join(DAT, n), d); return d; };

const motor = require(path.join(R, 'mcp', 'motor.js'));
const C = require(path.join(R, 'web', 'comparador.js'));
const K = require(path.join(R, 'web', 'checklist_epm.js'));
const leer = (f) => fs.readFileSync(f, 'utf8');
const est = (r, id) => (r.items.find((i) => i.id === id) || {}).estado;
const item = (r, id) => r.items.find((i) => i.id === id) || {};

(async () => {
  const v2 = copia('TDC_v2.dxf'), v3 = copia('TDC_v3.dxf'), v3m = copia('TDC_v3_montado.dxf'), dwfEPM = copia('epm_respuesta_con_marcas.dwf'), firma = copia('firma_marcos_bn.png');

  // ================================================================ COMPARAR DXF: Tienda del Café v2 → v3 (copias)
  let t0 = Date.now();
  const r = C.compararDXF(fs.readFileSync(v2), fs.readFileSync(v3), { nombreA: 'TDC_v2.dxf', nombreB: 'TDC_v3.dxf' });
  console.log(`  v2 → v3: ${r.resumen.iguales} iguales · ${r.resumen.agregados} nuevos · ${r.resumen.borrados} borrados · ${r.resumen.cambiados} cambiados · ${r.textos.editados.length} textos editados (${Date.now() - t0} ms)`);
  check('v2→v3: hay cambios de los cuatro tipos', !r.sinCambios && r.resumen.iguales > 300 && r.resumen.agregados > 50 && r.resumen.borrados > 50 && r.resumen.cambiados > 50, r.resumen);
  check('v2→v3: cuentas cuadran con los objetos de cada versión', r.espacios.every((e) => e.iguales + e.borrados + e.cambiados === e.objetosA && e.iguales + e.agregados + e.cambiados === e.objetosB), r.espacios);
  check('v2→v3: texto editado del gabinete', r.textos.editados.some((t) => /EN FACHADA, IP44/.test(t.antes) && /PROTECCION, IP44$/.test(t.ahora)), r.textos.editados.slice(0, 5));
  check('v2→v3: «Contrato: (?)» → «Contrato: 12386594»', r.textos.editados.some((t) => t.antes === 'Contrato: (?)' && t.ahora === 'Contrato: 12386594'));
  check('v2→v3: capa nueva Defpoints', r.capas.agregadas.includes('Defpoints'), r.capas);
  check('v2→v3: notas nuevas en mayúscula en «textos nuevos»', r.textos.nuevos.some((s) => /^7\. NORMAS COMPLEMENTARIAS/.test(s)));
  check('v2→v3: cada diferencia tiene dónde (centro) y geometría para pintarla', r.items.every((i) => i.centro && i.bb && (i.geo || i.geoA)), r.items.find((i) => !(i.centro && (i.geo || i.geoA))));
  check('v2→v3: movidos con su distancia', r.items.some((i) => i.tipo === 'cambiado' && /^movido \d/.test(i.detalle)));
  check('v2→v3: lista numerada 1..n', r.items.every((i, k) => i.n === k + 1));
  const r0 = C.compararDXF(leer(v3), leer(v3));
  check('v3 contra sí mismo: sin cambios', r0.sinCambios && r0.resumen.iguales === 1411 && !r0.items.length, r0.resumen);
  fs.writeFileSync(path.join(SAL, 'comparar v2-v3.md'), C.informeMD(r));
  check('informe MD de la comparación', /\| # \| Qué \| Objeto \| Hoja/.test(C.informeMD(r)) && /🔴 borrado/.test(C.informeMD(r)));
  check('informe de texto', /^COMPARAR \(DXF\)/.test(r.informe) && /Textos editados/.test(r.informe));

  // ---- cambios conocidos hechos con ezdxf sobre una copia del v3: capa, movido, texto, borrado, nuevo
  const v3e = path.join(SAL, 'TDC_v3_editado.dxf');
  const pe = py(`
import ezdxf, sys, json
d = ezdxf.readfile(sys.argv[1]); l = d.layouts.get('PLANO 01 DE 01')
d.layers.add('CAPA NUEVA', color=5)
pl = [e for e in l if e.dxftype()=='LWPOLYLINE' and len(e) == 2][5]; pl.dxf.layer = 'CAPA NUEVA'
ci = [e for e in l if e.dxftype()=='CIRCLE' and e.dxf.radius > 2][0]; c0 = ci.dxf.center; ci.dxf.center = (c0.x + 5, c0.y)
tx = [e for e in l if e.dxftype()=='TEXT' and e.dxf.text.startswith('6. ESTE PROYECTO')][0]; tx.dxf.text = '6. TEXTO CAMBIADO POR LA PRUEBA'
ar = [e for e in l if e.dxftype()=='ARC'][0]; l.delete_entity(ar)
l.add_line((100, 100), (150, 120))
d.saveas(sys.argv[2]); print(json.dumps({'ok': 1, 'tx': [round(tx.dxf.insert.x, 2), round(tx.dxf.insert.y, 2)]}))`, v3, v3e);
  check('copia editada con ezdxf', pe.ok, pe);
  const re = C.compararDXF(leer(v3), leer(v3e), { nombreA: 'v3', nombreB: 'v3 editado' });
  const de = re.items.map((i) => `${i.tipo} ${i.ent} ${i.detalle}`);
  check('editado: exactamente 1 nuevo (la LÍNEA)', re.resumen.agregados === 1 && re.items.find((i) => i.tipo === 'agregado').ent === 'LINE', de);
  check('editado: exactamente 1 borrado (el ARCO)', re.resumen.borrados === 1 && re.items.find((i) => i.tipo === 'borrado').ent === 'ARC', de);
  check('editado: 3 cambiados (capa, movido 5, texto)', re.resumen.cambiados === 3 && re.items.some((i) => /capa: 0 → CAPA NUEVA/.test(i.detalle)) && re.items.some((i) => i.ent === 'CIRCLE' && /movido 5 \(Δx 5, Δy 0\)/.test(i.detalle)) && re.items.some((i) => /TEXTO CAMBIADO POR LA PRUEBA/.test(i.detalle)), de);
  check('editado: el resto igual', re.resumen.iguales === 1411 - 4, re.resumen);
  check('editado: capa nueva', re.capas.agregadas.includes('CAPA NUEVA'), re.capas);
  check('editado: ubicación del texto cambiado', re.items.some((i) => /TEXTO CAMBIADO/.test(i.texto) && Math.abs(i.bb[0] - pe.tx[0]) < 0.5), re.items.filter((i) => /TEXTO/.test(i.texto)));
  const rr = C.compararDXF(leer(v3e), leer(v3));
  check('al revés: nuevo ↔ borrado se invierten', rr.resumen.agregados === 1 && rr.resumen.borrados === 1 && rr.items.find((i) => i.tipo === 'agregado').ent === 'ARC' && rr.capas.borradas.includes('CAPA NUEVA'), rr.resumen);

  // ---- planos con bloques y planchas (plantilla EPM): atributos del rótulo y capas cambiadas
  const pA = PlantillaEPM.generar({}), pB = PlantillaEPM.generar({ datos: { proyecto: 'PRUEBA H6E', fecha: '29-10-2026' } });
  const rp = C.compararDXF(pA, pB);
  check('plantilla: el rótulo sale CAMBIADO con sus atributos', rp.resumen.cambiados === 1 && /PROYECTO: «\(\?\) NOMBRE DEL PROYECTO» → «PRUEBA H6E»/.test(rp.items[0].detalle) && /FECHA: «\(\?\)» → «29-10-2026»/.test(rp.items[0].detalle) && rp.items[0].ent === 'INSERT', rp.items.map((i) => i.detalle));
  const pC = pA.replace('\n  2\nEPM-TABLAS\n 70\n0\n 62\n7\n', '\n  2\nEPM-TABLAS\n 70\n0\n 62\n1\n');
  const rc = C.compararDXF(pA, pC);
  check('plantilla: capa con otro color', pC !== pA && rc.capas.cambiadas.some((c) => c.capa === 'EPM-TABLAS' && /color 7 → 1/.test(c.cambios.join())) && !rc.items.length, rc.capas);

  // ================================================================ COMPARAR DWF (hoja por hoja) y marcas de EPM
  const d2 = path.join(SAL, 'TDC_v2.dwf'), d3 = path.join(SAL, 'TDC_v3.dwf');
  await motor.dwfDeTexto(leer(v2), d2, { carpeta: SAL }); await motor.dwfDeTexto(leer(v3), d3, { carpeta: SAL });
  const u8 = (f) => new Uint8Array(fs.readFileSync(f));
  const w0 = await C.compararDWF(u8(d3), u8(d3));
  check('DWF v3 contra sí mismo: sin cambios', w0.sinCambios && w0.resumen.iguales > 1000, w0.resumen);
  const w = await C.compararDWF(u8(d2), u8(d3), { nombreA: 'TDC_v2.dwf', nombreB: 'TDC_v3.dwf' });
  check('DWF v2→v3: nuevos, borrados y textos editados', w.resumen.agregados > 100 && w.resumen.borrados > 100 && w.textos.editados.length > 0 && w.planchas.agregadas.length === 0, { r: w.resumen, p: w.planchas });
  const wm = await C.compararDWF(u8(d3), u8(dwfEPM), { nombreA: 'TDC_v3.dwf', nombreB: 'epm_respuesta_con_marcas.dwf' });
  const marcas = wm.items.filter((i) => i.tipo === 'marca');
  check('DWF devuelto por EPM: lista las marcas (observaciones con número y texto)', wm.resumen.marcas >= 6 && marcas.some((m) => m.numero === 1 && m.texto) && marcas.some((m) => /NC-RA8-028/.test(m.texto)), marcas.slice(0, 3));
  check('DWF: las marcas numeradas van primero', marcas[0].numero === 1, marcas.slice(0, 2));
  const wa = await C.compararDWF(u8(dwfEPM), u8(d3));
  check('DWF de EPM como versión ANTERIOR: también lista sus marcas', wa.resumen.marcas === wm.resumen.marcas && wa.items.filter((i) => i.tipo === 'marca').every((i) => i.origen === 'anterior'), wa.resumen);
  const mp = C.marcasEnPapel([{ tipo: 'nube', texto: 'x', bb: [10, 20, 30, 40], focus: [10, 20, 30, 40] }], 707, 'P');
  check('marcas del DWF a coordenadas de la plancha (y hacia arriba)', mp[0].bb.join() === '10,667,30,687' && mp[0].centro.join() === '20,677', mp[0]);

  // ================================================================ CHECKEPM sobre el v3 (copia)
  const pesoDWF = fs.statSync(d3).size;
  t0 = Date.now();
  const k3 = await K.revisar(fs.readFileSync(v3), { nombre: 'TDC_v3.dxf', pesoDWF });
  console.log(`  CHECKEPM v3: ${k3.resumen.ok} ✅ · ${k3.resumen.falla} ❌ · ${k3.resumen.aviso} ⚠️ (${Date.now() - t0} ms)`);
  const esperado3 = { rotulo: 'falla', rotulo_tam: 'falla', firma: 'falla', sello: 'ok', proyeccion: 'ok', escalas: 'falla', norte: 'ok', convenciones: 'ok', notas: 'ok', cuadro: 'falla', alturas: 'ok', montajes: 'ok', capas: 'ok', peso: 'ok', raster: 'ok' };
  for (const [id, e] of Object.entries(esperado3)) check(`CHECKEPM v3: ${id} = ${e}`, est(k3, id) === e, item(k3, id));
  check('CHECKEPM v3: rótulo — fallan b, c, d (consecutivo «(?)») e i (fecha «(?)/2026»)', /❌ b\)/.test(item(k3, 'rotulo').detalle) && /❌ c\)/.test(item(k3, 'rotulo').detalle) && /❌ d\)/.test(item(k3, 'rotulo').detalle) && /❌ i\) Fecha: \(\?\)\/2026/.test(item(k3, 'rotulo').detalle) && /✅ l\) Solicitud \(SN\) o pedido: 23863153/.test(item(k3, 'rotulo').detalle) && /✅ j\)/.test(item(k3, 'rotulo').detalle) && /✅ k\)/.test(item(k3, 'rotulo').detalle), item(k3, 'rotulo').detalle);
  check('CHECKEPM v3: dónde de la fecha', item(k3, 'rotulo').donde.some((d) => /i\) \(\?\)\/2026/.test(d.que) && Math.abs(d.x - 1009.8) < 1 && Math.abs(d.y - 34.6) < 2), item(k3, 'rotulo').donde);
  check('CHECKEPM v3: rótulo mide 380 × 242 mm (máx. 160 × 100)', /380\.\d × 241\.\d mm/.test(item(k3, 'rotulo_tam').detalle), item(k3, 'rotulo_tam'));
  check('CHECKEPM v3: sello 380 × 78 libre encima del rótulo', /380\.4 × 78 mm libre/.test(item(k3, 'sello').detalle), item(k3, 'sello'));
  check('CHECKEPM v3: escalas — localización 1:500 bien; gabinete y espacio de trabajo sin escala', /✅ LOCALIZACION DE REDES - ESCALA 1:500/.test(item(k3, 'escalas').detalle) && item(k3, 'escalas').donde.length === 2 && item(k3, 'escalas').donde.some((d) => /PLANTA - ESPACIO DE TRABAJO/.test(d.que)), item(k3, 'escalas'));
  check('CHECKEPM v3: 2 nortes', /^2 norte/.test(item(k3, 'norte').detalle), item(k3, 'norte'));
  check('CHECKEPM v3: 24 notas numeradas', /^24 nota/.test(item(k3, 'notas').detalle), item(k3, 'notas'));
  check('CHECKEPM v3: cuadro con todas las columnas (Fig. 27/29 + distancia) y 2 celdas «(?)»', !/❌ [^0-9]/.test(item(k3, 'cuadro').detalle) && /❌ 2 celda/.test(item(k3, 'cuadro').detalle), item(k3, 'cuadro').detalle);
  check('CHECKEPM v3: 0 montajes (498 textos)', /498 textos/.test(item(k3, 'montajes').detalle), item(k3, 'montajes'));
  check('CHECKEPM v3: no cumple', !k3.cumple && k3.items.length === 15);
  const km = await K.revisar(fs.readFileSync(v3m), { nombre: 'TDC_v3_montado.dxf', pesoDWF });
  check('CHECKEPM v3 montado: textos montados = falla con 4 «dónde»', est(km, 'montajes') === 'falla' && item(km, 'montajes').donde.length === 4, item(km, 'montajes'));

  // ================================================================ CHECKEPM sobre la plantilla (vacía, llena y con errores puestos a propósito)
  const kp = await K.revisar(pA, { nombre: 'plantilla', pesoDWF: 30000 });
  const esperadoP = { rotulo: 'falla', rotulo_tam: 'ok', firma: 'falla', sello: 'ok', proyeccion: 'ok', escalas: 'ok', norte: 'ok', convenciones: 'ok', notas: 'falla', cuadro: 'falla', alturas: 'ok', montajes: 'ok', capas: 'aviso', peso: 'ok', raster: 'ok' };
  for (const [id, e] of Object.entries(esperadoP)) check(`CHECKEPM plantilla vacía: ${id} = ${e}`, est(kp, id) === e, item(kp, id));
  check('CHECKEPM plantilla: ventanas 1:500 y 1:1000', /ventana de «ESPACIO 2 - LOCALIZACIÓN»: 1:500/.test(item(kp, 'escalas').detalle) && /: 1:1000/.test(item(kp, 'escalas').detalle), item(kp, 'escalas').detalle);
  check('CHECKEPM plantilla: columnas del cuadro completas; solo falta el tipo de carga', !/❌ [^0-9]/.test(item(kp, 'cuadro').detalle) && /❌ 1 celda/.test(item(kp, 'cuadro').detalle), item(kp, 'cuadro').detalle);
  check('CHECKEPM plantilla: rótulo lista los 13 atributos vacíos (SN = «CAMPO DE EPM»)', item(kp, 'rotulo').donde.length === 13 && /❌ l\)/.test(item(kp, 'rotulo').detalle) && /✅ h\)/.test(item(kp, 'rotulo').detalle), item(kp, 'rotulo'));
  const datos = { proyecto: 'TIENDA DEL CAFE 112,5 kVA', direccion: 'CL 28 N 34-151', municipio: 'MARINILLA', firma: 'DOMOTEX', firmaContacto: 'CL 29 - 311 000 0000 - a@b.co - CC 1', propietario: 'TIENDA DE CAFE ORIENTE SAS', propietarioContacto: 'CL 28 - 310 - c@d.co - NIT 9',
    consecutivo: '0000002QYC', contiene: 'DR6', diseno: 'ING. MARCOS ORTIZ', dibujo: 'SEBASTIAN MUNOZ', contrato: '12386594', matricula: 'AN205-110326', sn: '23863153 / PED-4139822-P4K1', fecha: '29-10-2026', tipoCarga: 'COMERCIAL' };
  const pll = path.join(SAL, 'plantilla_llena.dxf'); fs.writeFileSync(pll, PlantillaEPM.generar({ datos }));
  const kl = await K.revisar(leer(pll), { nombre: 'plantilla llena', pesoDWF: 30000 });
  check('CHECKEPM plantilla llena: rótulo ✅ (a–l)', est(kl, 'rotulo') === 'ok' && est(kl, 'cuadro') === 'ok', [item(kl, 'rotulo'), item(kl, 'cuadro')]);
  // firma dentro del rótulo, una imagen raster fuera, algo dentro del sello y una ventana a escala rara
  const plx = path.join(SAL, 'plantilla_con_errores.dxf');
  const px = py(`
import ezdxf, sys, json
d = ezdxf.readfile(sys.argv[1]); l = d.layouts.get('PLANO 01 DE 01')
df = d.add_image_def(filename='firma_marcos_bn.png', size_in_pixel=(400, 200))
l.add_image(df, insert=(920, 25), size_in_units=(40, 20))
l.add_image(df, insert=(100, 600), size_in_units=(60, 30))
l.add_circle((900, 140), 5)
vp = [e for e in l if e.dxftype() == 'VIEWPORT' and e.dxf.id > 1][0]; vp.dxf.view_height = vp.dxf.height / 2.2857
d.saveas(sys.argv[2]); print(json.dumps({'ok': 1}))`, pll, plx);
  check('plantilla con errores (ezdxf)', px.ok, px);
  const kx = await K.revisar(leer(plx), { nombre: 'plantilla con errores', pesoDWF: 30000 });
  check('CHECKEPM: firma en el rótulo = ✅', est(kx, 'firma') === 'ok', item(kx, 'firma'));
  check('CHECKEPM: imagen fuera del rótulo = raster ❌ con dónde', est(kx, 'raster') === 'falla' && item(kx, 'raster').donde.some((d) => Math.abs(d.x - 100) < 1 && Math.abs(d.y - 600) < 1), item(kx, 'raster'));
  check('CHECKEPM: objeto dentro del sello = ❌', est(kx, 'sello') === 'falla' && /1 objeto/.test(item(kx, 'sello').detalle), item(kx, 'sello'));
  check('CHECKEPM: ventana a 1:437,5 = escala no normalizada ❌', est(kx, 'escalas') === 'falla' && /1:437\.\d no es una escala normalizada/.test(item(kx, 'escalas').detalle), item(kx, 'escalas'));
  check('CHECKEPM: DWF de 1,5 MB = ❌', est(await K.revisar(leer(pll), { pesoDWF: 1.5 * 1048576 }), 'peso') === 'falla');

  // ---- informes: texto, Markdown y PDF (por DXF con el escritor de Domoplano)
  fs.writeFileSync(path.join(SAL, 'checklist v3.md'), K.md(k3));
  check('informe MD del checklist', /^# Lista de chequeo NC-RA8-001/.test(K.md(k3)) && /\| 1 \| Rótulo completo/.test(K.md(k3)) && /❌/.test(K.md(k3)));
  const dxfI = K.dxfInforme(k3); fs.writeFileSync(path.join(SAL, 'checklist v3 (informe).dxf'), dxfI);
  const pdf = await motor.pdfDeTexto(dxfI, path.join(SAL, 'checklist v3.pdf'), { carpeta: SAL, plancha: 'INFORME CHECKEPM', color: 'color' });
  const b = fs.readFileSync(pdf.salida);
  check('informe PDF del checklist', b.slice(0, 5).toString() === '%PDF-' && b.length > 5000 && pdf.paginas === 1, pdf);
  const au = py(`
import ezdxf, sys, json
d = ezdxf.readfile(sys.argv[1]); a = d.audit(); print(json.dumps({'errores': len(a.errors), 'textos': len([e for e in d.layouts.get('INFORME CHECKEPM') if e.dxftype() == 'TEXT'])}))`, path.join(SAL, 'checklist v3 (informe).dxf'));
  check('informe DXF limpio (ezdxf audit 0 errores)', au.errores === 0 && au.textos > 40, au);

  // ================================================================ en la app (motor de la app en Node): comandos y módulos
  check('alias COMPARAR / DWGCOMPARE / CHECKEPM / CHECKLIST', CAD.alias('COMPARAR') === 'COMPARAR' && CAD.alias('dwgcompare') === 'COMPARAR' && CAD.alias('CHECKLIST') === 'CHECKEPM' && CAD.alias('CHECKEPM') === 'CHECKEPM');
  const UI = require(path.join(R, 'web', 'h6e_ui.js'));
  check('interfaz H6E carga (iniciar, overlay, mostrar, limpiar)', ['iniciar', 'overlay', 'mostrar', 'limpiar'].every((k) => typeof UI[k] === 'function'));
  const html = leer(path.join(R, 'web', 'index.html'));
  check('index.html carga comparador, checklist e interfaz', /comparador\.js/.test(html) && /checklist_epm\.js/.test(html) && /h6e_ui\.js/.test(html) && /id="cCheck"/.test(html) && /id="cComp"/.test(html));

  // ================================================================ MCP: herramientas compare y checklist_epm
  const { conectar, json, texto } = await import('../mcp/cliente.mjs');
  const c = await conectar();
  const T = async (name, args) => { const x = await c.llamar(name, args); return { j: json(x), t: texto(x), err: !!x.isError }; };
  const tools = (await c.herramientas()).map((t) => t.name);
  check('MCP: herramientas compare y checklist_epm', ['compare', 'checklist_epm', 'checkepm', 'compare_drawings'].every((n) => tools.includes(n)), tools.filter((n) => /comp|check/.test(n)));
  let x = await T('compare', { anterior: v2, nueva: v3, informe_md: path.join(SAL, 'mcp comparar.md'), max_items: 20, overwrite: true });
  check('MCP compare v2 → v3 (rutas)', !x.err && x.j.resumen.cambiados === r.resumen.cambiados && x.j.items.length === 20 && x.j.items_total === r.items.length && !x.j.items[0].geo && fs.existsSync(path.join(SAL, 'mcp comparar.md')), x.t.slice(0, 400));
  x = await T('open_drawing', { ruta: v3 });
  check('MCP open_drawing v3 (copia)', !x.err, x.t);
  x = await T('compare', { anterior: v2 });
  check('MCP compare contra el plano abierto', !x.err && x.j.resumen.agregados === r.resumen.agregados && x.j.resumen.borrados === r.resumen.borrados, x.t.slice(0, 400));
  x = await T('compare', { anterior: d3 });
  check('MCP compare DWF contra el plano abierto (pasado a DWF)', !x.err && x.j.tipo === 'DWF' && x.j.sinCambios, x.t.slice(0, 400));
  x = await T('compare', { anterior: d3, nueva: dwfEPM });
  check('MCP compare DWF → DWF de EPM: marcas', !x.err && x.j.resumen.marcas >= 6, x.t.slice(0, 300));
  x = await T('compare', { anterior: v2, nueva: d3 });
  check('MCP compare DXF con DWF = error claro', x.err && /DXF con DXF o DWF con DWF/.test(x.t), x.t);
  x = await T('checklist_epm', { ruta: v3, informe_md: path.join(SAL, 'mcp checklist.md'), informe_pdf: path.join(SAL, 'mcp checklist.pdf'), overwrite: true });
  check('MCP checklist_epm (ruta) + MD + PDF', !x.err && x.j.cumple === false && x.j.items.length === 15 && x.j.resumen.falla === k3.resumen.falla && fs.existsSync(path.join(SAL, 'mcp checklist.pdf')) && fs.existsSync(path.join(SAL, 'mcp checklist.md')), x.t.slice(0, 400));
  check('MCP checklist_epm midió el DWF (< 1 MB)', !x.err && /pesa \d+\.\d KB/.test(x.j.items.find((i) => i.id === 'peso').detalle), x.j && x.j.items && x.j.items.find((i) => i.id === 'peso'));
  x = await T('checkepm', {});
  check('MCP checkepm sobre el plano abierto', !x.err && x.j.plancha === 'PLANO 01 DE 01' && x.j.resumen.falla === k3.resumen.falla, x.t.slice(0, 300));
  x = await T('checklist_epm', { resaltar: true });
  check('MCP resaltar sin app = aviso (no error)', !x.err && /solo en la app/.test(x.j.resaltado), x.t.slice(0, 300));
  x = await T('run_command', { lineas: ['COMPARAR'] });
  check('MCP run_command COMPARAR sin app avisa (no se cae)', !x.err, x.t.slice(0, 300));
  await c.cerrar();

  console.log(`H6-E: ${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
