// Pruebas del bloque H6-D «Abrir y convertir DWG de terceros sin AutoCAD» (LibreDWG 0.14, GPLv3, programa aparte).
// 1) Convierte las COPIAS de tests/datos/dwg/*.dwg (plantillas EPM F123/F124/F125, TDC v3 y DWG de terceros
//    R2004/R2007/R2010/R2013) con cli/dwg_a_dxf.js: versión, tiempo, entidades DWG→DXF, pérdidas, Domoplano lo abre,
//    ezdxf lo lee (audit).
// 2) Compara contra el DXF que exportó AutoCAD (referencia/): mismas entidades por tipo y mismo dibujo (render de la
//    plancha con el motor de Domoplano en Chrome sin ventana, tolerancia 0,5 mm).
// 3) Modelo de los DWG de terceros a PNG (para revisar a ojo) en tests/salida/dwg/.
// 4) Salida a DWG con dxf2dwg: R2004 y R2000 sí; R2007+ se rechaza (límite de LibreDWG 0.14). Se relee el DWG escrito.
//    Con --acad además se abre el DWG escrito en AcCoreConsole (sin guardar nada).
// Uso: node tests/dwgtest.js [--sin-render] [--acad]      Nunca toca los originales: solo copias en tests/datos/dwg.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http');
const { convertir, aDWG, binario, contarDXF, versionDWG } = require('../cli/dwg_a_dxf.js');
const ROOT = path.join(__dirname, '..');
const DATOS = path.join(__dirname, 'datos', 'dwg'), REF = path.join(DATOS, 'referencia');
const SAL = path.join(__dirname, 'salida', 'dwg');
fs.mkdirSync(SAL, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info === undefined ? '' : info); } };
const py = (code, ...args) => {
  const r = cp.spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) return { fallo: r.stderr.slice(-800) };
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
const EZ = 'import ezdxf, json, sys\nd = ezdxf.readfile(sys.argv[1])\na = d.audit()\nprint(json.dumps({"errores": len(a.errors), "arreglos": len(a.fixes), "ej": [str(e.message) for e in a.errors[:3]]}))';

function renderPNG(rel, params) {
  return new Promise((resolve, reject) => {
    let chrome = null, done = false;
    const srv = http.createServer((req, res) => {
      if (req.method === 'POST') {
        const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
          res.end('ok'); const body = Buffer.concat(ch).toString(); done = true;
          if (chrome) chrome.kill(); srv.close();
          if (!body.startsWith('data:image/png;base64,')) return reject(new Error(body.slice(0, 400)));
          resolve(Buffer.from(body.slice(22), 'base64'));
        }); return;
      }
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream');
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const u = `http://127.0.0.1:${port}/tests/render_dwg.html?dxf=${encodeURIComponent(rel)}&post=/resultado&${params}`;
      const prof = fs.mkdtempSync(path.join(require('os').tmpdir(), 'domoplano-chrome-'));
      chrome = cp.spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + prof, u], { stdio: 'ignore' });
      setTimeout(() => { if (!done) { chrome.kill(); srv.close(); reject(new Error('Chrome no respondió en 120 s')); } }, 120000);
    });
  });
}
const DIFF = String.raw`
import sys, json, numpy as np
from PIL import Image
a, b, out, R = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
A = np.asarray(Image.open(a).convert('RGB')); B = np.asarray(Image.open(b).convert('RGB'))
H, W = min(A.shape[0], B.shape[0]), min(A.shape[1], B.shape[1])
ia = (A[:H, :W] < 200).any(2); ib = (B[:H, :W] < 200).any(2)
def dil(m):
    o = m.copy()
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1): o |= np.roll(np.roll(m, dy, 0), dx, 1)
    return o
da, db = dil(ia), dil(ib)
d = np.full((H, W, 3), 255, np.uint8); d[ia & ib] = (150, 150, 150); d[ia & ~db] = (230, 0, 0); d[ib & ~da] = (0, 60, 230)
Image.fromarray(d).save(out)
print(json.dumps({'tam': [W, H], 'mismo_tam': list(A.shape) == list(B.shape), 'tinta_a': int(ia.sum()), 'tinta_b': int(ib.sum()),
  'a_cubierto': round(float((ia & db).sum()) / max(1, ia.sum()) * 100, 2), 'b_cubierto': round(float((ib & da).sum()) / max(1, ib.sum()) * 100, 2)}))
`;
const TINTA = 'import sys, json, numpy as np\nfrom PIL import Image\nA = np.asarray(Image.open(sys.argv[1]).convert("RGB"))\nprint(json.dumps({"tam": [A.shape[1], A.shape[0]], "tinta": round(float((A < 200).any(2).mean()) * 100, 2)}))';

(async () => {
  const conRender = !process.argv.includes('--sin-render') && fs.existsSync(CHROME);
  const conAcad = process.argv.includes('--acad');
  check('LibreDWG compilado: dwg2dxf, dxf2dwg y dwgread', binario('dwg2dxf') && binario('dxf2dwg') && binario('dwgread'));
  const ver = cp.spawnSync(binario('dwg2dxf'), ['--version'], { encoding: 'utf8' }).stdout.trim();
  check('versión LibreDWG 0.14', /0\.14/.test(ver), ver);

  // ---------------------------------------------------------------- 1) conversión de cada copia
  const archivos = fs.readdirSync(DATOS).filter((f) => /\.dwg$/i.test(f)).sort();
  check('hay 8 DWG de prueba (3 plantillas EPM, TDC v3 y 4 de terceros)', archivos.length >= 8, archivos);
  const tabla = [];
  const res = {};
  for (const f of archivos) {
    const b = f.replace(/\.dwg$/i, '');
    const antes = fs.readFileSync(path.join(DATOS, f));
    let r;
    try { r = await convertir(path.join(DATOS, f), path.join(SAL, b + '.dxf'), { sobrescribir: true }); }
    catch (e) { check(`${b}: convierte`, false, e.message); continue; }
    res[b] = r;
    check(`${b}: convierte`, r.bytesDXF > 1000);
    check(`${b}: el DWG copiado no cambió`, Buffer.compare(antes, fs.readFileSync(path.join(DATOS, f))) === 0);
    check(`${b}: Domoplano abre el DXF`, r.abreEnDomoplano === true, r.errorAbrir);
    check(`${b}: menos de 10 s`, r.segundos < 10, r.segundos);
    const perdidasGeom = Object.entries(r.perdidas || {}).reduce((a, [, n]) => a + n, 0);
    check(`${b}: llega ≥ 99,9 % de las entidades`, r.totalDWG && (r.totalDWG - perdidasGeom) / r.totalDWG >= 0.999, r.perdidas);
    const az = py(EZ, r.salida);
    check(`${b}: ezdxf lee el DXF convertido`, !az.fallo, az.fallo);
    tabla.push({ archivo: b, version: `${r.version.codigo} ${r.version.nombre}`, KB: Math.round(r.bytesDWG / 1024), s: r.segundos,
      entDWG: r.totalDWG, entDXF: r.totalDXF, perdidas: JSON.stringify(r.perdidas || {}), proxy: r.especiales.proxy, ole: r.especiales.ole,
      dinamicos: r.especiales.bloquesDinamicos, xref: r.especiales.xref, avisos: r.avisos.total, errLibreDWG: r.avisos.errores,
      ezdxf: az.fallo ? 'NO LEE' : `${az.errores} err/${az.arreglos} arreglos`, planchas: (r.planchas || []).length });
  }
  console.table(tabla);
  fs.writeFileSync(path.join(SAL, 'informe.json'), JSON.stringify({ fecha: new Date().toISOString(), libredwg: ver, tabla, res }, null, 1));
  const v = new Set(Object.values(res).map((r) => r.version.codigo));
  check('versiones variadas: AC1018, AC1021, AC1024, AC1027 y AC1032', ['AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].every((x) => v.has(x)), [...v]);
  check('D-PHI-042 (EPM, R2007): se detectan 4 OLE y bloques dinámicos', res['tercero_R2007_EPM_D-PHI-042'] && res['tercero_R2007_EPM_D-PHI-042'].especiales.ole === 4 && res['tercero_R2007_EPM_D-PHI-042'].especiales.bloquesDinamicos > 0);
  check('aviso claro con lo que no llegó', res['tercero_R2007_EPM_D-PHI-042'] && /OLE/.test(res['tercero_R2007_EPM_D-PHI-042'].aviso) && /LARGE_RADIAL_DIMENSION/.test(res['tercero_R2007_EPM_D-PHI-042'].aviso));
  // no sobrescribe sin -y, y nunca la salida = el DWG
  let err = ''; try { await convertir(path.join(DATOS, 'TDC_v3.dwg'), path.join(SAL, 'TDC_v3.dxf')); } catch (e) { err = e.message; }
  check('no reemplaza un DXF existente sin -y', /Ya existe/.test(err), err);
  err = ''; try { await convertir(path.join(DATOS, 'TDC_v3.dwg'), path.join(DATOS, 'TDC_v3.dwg'), { sobrescribir: true }); } catch (e) { err = e.message; }
  check('nunca escribe sobre el DWG', /mismo DWG/.test(err), err);
  err = ''; try { await convertir(path.join(REF, 'TDC_v3_acad.dxf'), path.join(SAL, 'x.dxf'), { sobrescribir: true }); } catch (e) { err = e.message; }
  check('un DXF no se toma como DWG', /no parece un DWG/.test(err), err);

  // ---------------------------------------------------------------- 2) contra el DXF de AutoCAD
  for (const [b, ref] of [['TDC_v3', 'TDC_v3_acad.dxf'], ['F125', 'F125_acad.dxf']]) {
    if (!res[b]) continue;
    const A = contarDXF(fs.readFileSync(path.join(REF, ref), 'latin1')).ent, B = res[b].entidadesDXF;
    const dif = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => (A[k] || 0) !== (B[k] || 0)).map((k) => `${k} ${A[k] || 0}/${B[k] || 0}`);
    check(`${b}: mismas entidades por tipo que el DXF de AutoCAD`, dif.length === 0, dif);
    if (!conRender) continue;
    try {
      const pl = res[b].planchas && res[b].planchas[0];
      const q = `px=4${pl ? '&plancha=' + encodeURIComponent(pl) : ''}`;
      const fa = path.join(SAL, `${b} - render AutoCAD-DXF.png`), fb = path.join(SAL, `${b} - render LibreDWG-DXF.png`);
      fs.writeFileSync(fa, await renderPNG('datos/dwg/referencia/' + ref, q));
      fs.writeFileSync(fb, await renderPNG('salida/dwg/' + b + '.dxf', q));
      const d = py(DIFF, fa, fb, path.join(SAL, `${b} - diferencias.png`), '2');
      console.log(`  render ${b} («${pl}», 0,5 mm): AutoCAD cubierto ${d.a_cubierto} % · LibreDWG cubierto ${d.b_cubierto} % · ${d.tam.join('×')} px`);
      check(`${b}: mismo dibujo que el DXF de AutoCAD (≥ 99,5 % / 99,5 %)`, d.mismo_tam && d.a_cubierto >= 99.5 && d.b_cubierto >= 99.5, JSON.stringify(d));
    } catch (e) { check(`${b}: render`, false, e.message); }
  }

  // ---------------------------------------------------------------- 3) Modelo de los terceros a PNG (revisión a ojo)
  if (conRender) {
    for (const b of Object.keys(res).filter((x) => /^tercero_/.test(x))) {
      try {
        // si el Modelo trae objetos sueltos muy lejos (JOMACAR: 812 km de ancho) el dibujo queda subpíxel: se usa la 1.ª plancha
        const pl = (res[b].planchas || [])[0];
        const usarPlancha = pl && b === 'tercero_R2004_JOMACAR';
        const f = path.join(SAL, `${b} - ${usarPlancha ? 'plancha ' + pl : 'Modelo'}.png`);
        fs.writeFileSync(f, await renderPNG('salida/dwg/' + b + '.dxf', usarPlancha ? 'px=3&plancha=' + encodeURIComponent(pl) : 'modelo=1&max=2400'));
        const t = py(TINTA, f);
        check(`${b}: se dibuja (no queda en blanco)`, t.tinta > 0.5, t);
        console.log(`  Modelo ${b}: ${t.tam.join('×')} px, tinta ${t.tinta} %`);
      } catch (e) { check(`${b}: render del Modelo`, false, e.message); }
    }
  }

  // ---------------------------------------------------------------- 4) salida a DWG (dxf2dwg)
  // Casos: DXF propio sencillo (Domoplano/ezdxf, TDC v3), DXF propio con planchas (DR6) y DXF exportado por AutoCAD (TDC v3).
  const casos = [
    ['TDC_v3 propio', path.join(__dirname, 'datos', 'TDC_v3.dxf'), 'r2000', { relee: true, acad: true }],
    ['TDC_v3 propio', path.join(__dirname, 'datos', 'TDC_v3.dxf'), 'r2004', { relee: false, acad: false }],
    ['TDC_v3 AutoCAD', path.join(REF, 'TDC_v3_acad.dxf'), 'r2000', { relee: true, acad: false }],
    ['DR6 propio con planchas', path.join(__dirname, 'datos', 'DR6.dxf'), 'r2000', { relee: true, acad: false }],
  ];
  const paraAcad = [];
  for (const [nom, src, as, esperado] of casos) {
    const out = path.join(SAL, `${nom} - ${as}.dwg`);
    const w = aDWG(src, out, { as, sobrescribir: true });
    check(`dxf2dwg ${nom} ${as}: escribe el DWG (${as === 'r2004' ? 'AC1018' : 'AC1015'})`, w.ok && w.version.codigo === (as === 'r2004' ? 'AC1018' : 'AC1015'), w);
    if (!w.ok) continue;
    check(`dxf2dwg ${nom} ${as}: ${esperado.relee ? 'se relee completo' : 'se DETECTA dañado (límite conocido)'}`, w.verificado === esperado.relee, `${w.entidadesReleidas}/${w.entidadesDXF}`);
    console.log(`  dxf2dwg ${nom} ${as}: ${(w.bytes / 1024).toFixed(0)} KB en ${w.segundos} s; releído ${w.entidadesReleidas}/${w.entidadesDXF} → ${w.verificado ? 'bien' : 'DAÑADO'}`);
    paraAcad.push([out, esperado.acad]);
  }
  let err2 = ''; try { aDWG(path.join(REF, 'TDC_v3_acad.dxf'), path.join(SAL, 'no.dwg'), { as: 'r2018', sobrescribir: true }); } catch (e) { err2 = e.message; }
  check('dxf2dwg r2018 se rechaza con mensaje claro', /solo escribe r12, r14, r2000 y r2004/.test(err2), err2);
  try { fs.unlinkSync(path.join(SAL, 'r2007.dwg')); } catch (_) { /* nada */ }
  const r07 = cp.spawnSync(binario('dxf2dwg'), ['-y', '--as', 'r2007', '-o', path.join(SAL, 'r2007.dwg'), path.join(REF, 'TDC_v3_acad.dxf')], { encoding: 'utf8' });
  check('dxf2dwg --as r2007 (directo) no escribe nada', !fs.existsSync(path.join(SAL, 'r2007.dwg')), r07.status);
  if (conAcad) {
    for (const [f, abre] of paraAcad) {
      const acc = cp.spawnSync('python3', [path.join(__dirname, 'acad_abrir.py'), f], { encoding: 'utf8', timeout: 300000 });
      const si = /^ABRE /m.test(acc.stdout);
      console.log(`  AutoCAD (AcCoreConsole) ${path.basename(f)}: ${si ? 'ABRE' : 'NO ABRE'} ${(acc.stdout.match(/OBJETOS=\d+/) || [''])[0]}`);
      if (/SIN-ACAD/.test(acc.stdout)) continue;
      check(`AutoCAD ${path.basename(f)}: ${abre ? 'abre' : 'no abre (límite conocido)'}`, si === abre, acc.stdout.slice(-300));
    }
  }

  // ---------------------------------------------------------------- 5) aviso de la app (web/dwg.js)
  {
    const DWGPuente = require('../web/dwg.js');
    const base = { dwg: 'x.dwg', version: 'AC1021 (AutoCAD 2007)', segundos: 0.4, entidades: 5978, avisos: 10, errores: 23, ole: 4, proxy: 2, dinamicos: true, xref: ['fondo.dwg'], shx: ['romans.shx'] };
    const t = DWGPuente.texto(base);
    check('aviso: dice OLE, PROXY, dinámicos, xref, SHX y errores', /4 objeto\(s\) OLE/.test(t) && /2 objeto\(s\) PROXY/.test(t) && /dinámicos/.test(t) && /fondo\.dwg/.test(t) && /romans\.shx/.test(t) && /23 error/.test(t), t);
    check('aviso: recuerda que el .dwg no se modifica', /no se modifica/.test(t));
    const t0 = DWGPuente.texto({ ...base, errores: 0, ole: 0, proxy: 0, dinamicos: false, xref: [], shx: [] });
    check('aviso sin pérdidas', /Sin pérdidas detectadas/.test(t0), t0);
    check('alias del comando', ['ABRIRDWG', 'IMPORTARDWG', 'DWGIN'].every((a) => DWGPuente.ALIAS.has(a)));
  }

  console.log(`\nH6-D DWG: ${ok} bien / ${bad} fallas`);
  process.exit(bad ? 1 : 0);
})();
