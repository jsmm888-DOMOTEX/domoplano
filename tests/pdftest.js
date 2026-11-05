// Pruebas del escritor PDF propio. Uso: node tests/pdftest.js [--sin-render]
// 1) Exporta (solo leyendo) TDC_v2, F125 y las 3 planchas de DR6 desde tests/datos a tests/salida/pdf/.
// 2) Revisa estructura: cabecera, tabla xref con desplazamientos exactos, tamaño de hoja, tamaño < 1 MB.
// 3) Con PyMuPDF (fitz): abre sin avisos, texto seleccionable (se extrae y coincide), capas, firma.
// 4) Render: la plancha se dibuja con el motor de Domoplano (Chrome sin ventana + tests/render_dxf.html) y el PDF con
//    fitz, a 4 px/mm; se mide qué parte de la tinta de cada uno tiene tinta del otro a ≤ 0,5 mm.
const fs = require('fs'), path = require('path'), http = require('http'), { spawn, spawnSync } = require('child_process');
const { exportarPDF } = require('../cli/dxf_a_pdf.js');
const ROOT = path.join(__dirname, '..');
const SAL = path.join(__dirname, 'salida', 'pdf');
const D = path.join(__dirname, 'datos');
const CASOS = [
  { dxf: 'TDC_v2.dxf', plancha: null, pdf: 'TDC_v2.pdf', hoja: [1189, 841], texto: 'PROPIETARIO' },
  { dxf: 'F125.dxf', plancha: null, pdf: 'F125.pdf', hoja: [1000, 707], texto: 'veredales', minRender: 96.5 }, // H4: más texto visible (diagramas unifilares) → la diferencia de letra pesa más
  { dxf: 'DR6.dxf', plancha: 'PLANCHA 1', pdf: 'DR6 - PLANCHA 1.pdf', hoja: [841, 594], texto: 'LA TIENDA DEL CAFE', firma: true },
  { dxf: 'DR6.dxf', plancha: 'PLANCHA 2', pdf: 'DR6 - PLANCHA 2.pdf', hoja: [841, 594], texto: 'ESPACIO 4', firma: true },
  { dxf: 'DR6.dxf', plancha: 'PLANCHA 3', pdf: 'DR6 - PLANCHA 3.pdf', hoja: [841, 594], texto: 'ESPACIO 4', firma: true },
  { dxf: 'DR6.dxf', plancha: 'PLANCHA 1', pdf: 'DR6 - PLANCHA 1 - mono.pdf', hoja: [841, 594], texto: 'LA TIENDA DEL CAFE', firma: true, mono: true },
];
const PX = 4; // px por mm; tolerancia 2 px = 0,5 mm
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function xrefOK(d) {
  const s = d.toString('latin1');
  const sx = +/startxref\s+(\d+)/.exec(s.slice(-64))[1];
  if (s.slice(sx, sx + 4) !== 'xref') return false;
  const m = /xref\n0 (\d+)\n/.exec(s.slice(sx)); const n = +m[1];
  let p = sx + m[0].length + 20;
  for (let i = 1; i < n; i++, p += 20) { const off = +s.slice(p, p + 10); if (!s.startsWith(`${i} 0 obj`, off)) return false; }
  return true;
}

// Render de la plancha con el motor de Domoplano: servidor local + Chrome sin ventana, el PNG llega por POST.
async function renderDXF(dxf, plancha) {
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
      const u = `http://127.0.0.1:${port}/tests/render_dxf.html?dxf=${encodeURIComponent('datos/' + dxf)}&px=${PX}&post=/resultado` + (plancha ? '&plancha=' + encodeURIComponent(plancha) : '');
      const prof = fs.mkdtempSync(path.join(require('os').tmpdir(), 'domoplano-chrome-'));
      chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + prof, u], { stdio: 'ignore' });
      setTimeout(() => { if (!done) { chrome.kill(); srv.close(); reject(new Error('Chrome no respondió en 90 s')); } }, 90000);
    });
  });
}

const PY = String.raw`
import sys, json, fitz, numpy as np
from PIL import Image
pdf, png, px, hw, hh, texto = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
d = fitz.open(pdf); p = d[0]
w = fitz.TOOLS.mupdf_warnings()
r = {'pag_mm': [round(p.rect.width / 72 * 25.4, 2), round(p.rect.height / 72 * 25.4, 2)], 'avisos_mupdf': w}
t = p.get_text()
r['texto_chars'] = len(t); r['texto_encontrado'] = texto in t
r['capas'] = len(d.get_ocgs()); r['imagenes'] = len(p.get_images())
r['fuentes'] = [f[3] for f in p.get_fonts()]
if png != '-':
    fitz.TOOLS.set_aa_level(0)
    pix = p.get_pixmap(matrix=fitz.Matrix(px * 25.4 / 72, px * 25.4 / 72), alpha=False)
    B = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    A = np.asarray(Image.open(png).convert('RGB'))
    H, W = min(A.shape[0], B.shape[0]), min(A.shape[1], B.shape[1])
    ia = (A[:H, :W] < 200).any(2); ib = (B[:H, :W] < 200).any(2)
    R = int(round(px * 0.5))
    def dil(m):
        o = m.copy()
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                s = np.roll(np.roll(m, dy, 0), dx, 1); o |= s
        return o
    da, db = dil(ia), dil(ib)
    r['tinta_dxf'] = int(ia.sum()); r['tinta_pdf'] = int(ib.sum())
    r['dxf_cubierto_por_pdf'] = round(float((ia & db).sum()) / max(1, ia.sum()) * 100, 2)
    r['pdf_cubierto_por_dxf'] = round(float((ib & da).sum()) / max(1, ib.sum()) * 100, 2)
    diff = np.full((H, W, 3), 255, np.uint8); diff[ia & ib] = (150, 150, 150); diff[ia & ~db] = (230, 0, 0); diff[ib & ~da] = (0, 60, 230)
    Image.fromarray(diff).save(pdf[:-4] + ' - diferencias.png')
print(json.dumps(r))
`;

(async () => {
  const sinRender = process.argv.includes('--sin-render');
  let ok = 0, bad = 0;
  const check = (n, c, info = '') => { if (c) ok++; else { bad++; console.log('FALLA', n, info); } };
  const conRender = !sinRender && fs.existsSync(CHROME);
  if (!conRender) console.log('(sin comparación de render: ' + (sinRender ? '--sin-render' : 'no está Chrome') + ')');
  const pngCache = new Map();
  for (const c of CASOS) {
    const out = path.join(SAL, c.pdf);
    const r = await exportarPDF(path.join(D, c.dxf), out, { plancha: c.plancha, color: c.mono ? 'mono' : 'color' });
    const d = fs.readFileSync(out);
    console.log(`${c.pdf}: ${(d.length / 1024).toFixed(1)} KB · hoja ${r.hoja} · textos ${r.stats.texts} · imágenes ${r.stats.images}`);
    check(c.pdf + ' tamaño < 1 MB', d.length < 1024 * 1024, d.length);
    check(c.pdf + ' cabecera y fin', d.toString('latin1', 0, 8) === '%PDF-1.6' && d.toString('latin1', d.length - 6) === '%%EOF\n');
    check(c.pdf + ' tabla xref exacta', xrefOK(d));
    // H4: las ventanas con punto objetivo (F125, ventanas 2 y 4) ya muestran su contenido; allí hay un «∅» que Liberation Sans no trae (límite conocido)
    const avisos = r.stats.warnings.filter((w) => !/U\+2205/.test(w));
    check(c.pdf + ' sin avisos del escritor', !avisos.length, avisos.join(' | '));
    if (c.firma) check(c.pdf + ' trae la firma', r.stats.images >= 1);
    let png = '-';
    if (conRender && !c.mono) {
      const key = c.dxf + '|' + c.plancha;
      if (!pngCache.has(key)) pngCache.set(key, await renderDXF(c.dxf, c.plancha));
      png = path.join(SAL, c.pdf.replace(/\.pdf$/, ' - render DXF.png'));
      fs.writeFileSync(png, pngCache.get(key));
    }
    const py = spawnSync('python3', ['-c', PY, out, png, String(PX), String(c.hoja[0]), String(c.hoja[1]), c.texto], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (py.status !== 0) { check(c.pdf + ' fitz', false, py.stderr.slice(-600)); continue; }
    const f = JSON.parse(py.stdout.trim().split('\n').pop());
    check(c.pdf + ' tamaño de hoja real', Math.abs(f.pag_mm[0] - c.hoja[0]) < 0.5 && Math.abs(f.pag_mm[1] - c.hoja[1]) < 0.5, f.pag_mm);
    check(c.pdf + ' abre sin avisos (MuPDF)', !f.avisos_mupdf, f.avisos_mupdf);
    check(c.pdf + ' texto seleccionable', f.texto_encontrado && f.texto_chars > 1000, f.texto_chars);
    check(c.pdf + ' fuente Liberation Sans incrustada', f.fuentes.some((x) => /LiberationSans/.test(x)), f.fuentes);
    let linea = `   fitz: hoja ${f.pag_mm.join(' × ')} mm · ${f.texto_chars} letras extraíbles · ${f.capas} capas · ${f.imagenes} imagen(es)`;
    if (f.dxf_cubierto_por_pdf != null) {
      linea += ` · render (0,5 mm): DXF cubierto ${f.dxf_cubierto_por_pdf} % · PDF cubierto ${f.pdf_cubierto_por_dxf} %`;
      check(c.pdf + ' render ≥ 98 % / 98 % (la letra del PDF es Liberation Sans; en pantalla, Arial del sistema)', f.dxf_cubierto_por_pdf >= (c.minRender || 98) && f.pdf_cubierto_por_dxf >= (c.minRender || 98), JSON.stringify(f));
    }
    console.log(linea);
  }
  console.log(`${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
