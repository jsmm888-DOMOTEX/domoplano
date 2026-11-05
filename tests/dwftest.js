// Pruebas del escritor DWF propio. Uso: node tests/dwftest.js
// Exporta (solo leyendo) el plano v2 de la Tienda del Café y la plantilla F125 a tests/salida/ y verifica tamaño y
// estructura contra los DWF V06.00 que EPM aceptó. El render se compara con tests/comparar.html (ver bitácora).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { exportarDXF } = require('../cli/dxf_a_dwf.js');
const W2D = require('../web/w2d.js');
const P = '/Users/sebastianmunoz/Documents/Trabajo independiente/Café Marnilla/Proyecto de redes 150 kVA (2026-09)/';
const CASOS = [
  // Copias en tests/datos (29-10-2026): el v2 original se movió a «_versiones anteriores» y no se tocan archivos de clientes
  [path.join(__dirname, 'datos', 'TDC_v2.dxf'), 'TIENDA DEL CAFE v2.dwf'],
  [path.join(__dirname, 'datos', 'F125.dxf'), 'F125_Medida_directa.dwf'],
];
const ACEPTADO = P + 'Subsanacion revision EPM 07-10-2026 - reingreso PED-4109913-Q5S2/1. RADICAR EN EPM/01 - PLANO 01 DE 01 - PROYECTO DE REDES TIENDA DEL CAFE 150 kVA - MEDIDA MULTIPLE CENTRALIZADA.dwf';

function leerZip(d) {
  const e = d.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  const n = d.readUInt16LE(e + 10); let p = d.readUInt32LE(e + 16); const out = [];
  for (let i = 0; i < n; i++) {
    const m = d.readUInt16LE(p + 10), cs = d.readUInt32LE(p + 20), nl = d.readUInt16LE(p + 28), xl = d.readUInt16LE(p + 30), cl = d.readUInt16LE(p + 32), lho = d.readUInt32LE(p + 42);
    const name = d.toString('latin1', p + 46, p + 46 + nl);
    if (d.readUInt32LE(lho) !== 0x04034b50) throw new Error('cabecera local fuera de sitio: ' + name);
    const ln = d.readUInt16LE(lho + 26), lx = d.readUInt16LE(lho + 28);
    const raw = d.subarray(lho + 30 + ln + lx, lho + 30 + ln + lx + cs);
    out.push({ name, method: m, data: m ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nl + xl + cl;
  }
  return out;
}
const forma = (z) => z.map((e) => e.name.replace(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g, 'GUID') + '#' + e.method).join(' | ');

(async () => {
  let ok = 0, bad = 0;
  const check = (n, c, info = '') => { if (c) ok++; else { bad++; console.log('FALLA', n, info); } };
  const ref = fs.readFileSync(ACEPTADO);
  const zr = leerZip(ref);
  for (const [dxf, nombre] of CASOS) {
    const out = path.join(__dirname, 'salida', nombre);
    const r = await exportarDXF(dxf, out, {});
    const d = fs.readFileSync(out);
    const z = leerZip(d);
    console.log(`${nombre}: ${(d.length / 1024).toFixed(1)} KB · plancha «${r.plancha}» · textos ${r.stats.texts}`);
    check(nombre + ' tamaño ≤ 0,6 MB', d.length <= 0.6 * 1024 * 1024, d.length);
    check(nombre + ' cabecera', d.toString('latin1', 0, 12) === '(DWF V06.00)' && ref.toString('latin1', 0, 12) === '(DWF V06.00)');
    check(nombre + ' misma estructura que el aceptado por EPM', forma(z) === forma(zr), forma(z) + '  vs  ' + forma(zr));
    const man = z[0].data.toString(), desc = z[1].data.toString();
    check(nombre + ' manifest', /DWF-Manifest:6\.0/.test(man) && /com\.autodesk\.dwf\.ePlot/.test(man) && man.includes(z[2].name) && man.includes(z[1].name));
    check(nombre + ' descriptor', /DWF-ePlot:1\.2/.test(desc) && /<ePlot:Paper units="mm"/.test(desc) && desc.includes(`size="${z[2].data.length}"`));
    const w = z[2].data;
    check(nombre + ' W2D cabecera', w.toString('latin1', 0, 12) === '(W2D V06.01)' && w.toString('latin1', w.length - 10) === '(EndOfDWF)');
    const p = W2D.parseSync(new Uint8Array(w));
    check(nombre + ' W2D se lee completo y sin avisos', p.complete && !p.warnings.length, JSON.stringify(p.warnings));
    check(nombre + ' W2D tiene texto real', p.items.some((i) => i.t === 'text'));
  }
  console.log(`${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
