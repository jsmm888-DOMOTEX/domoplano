#!/usr/bin/env node
// Domoplano — exportar un DXF a DWF clásico (V06.00, una plancha por archivo) sin abrir la app.
// Usa el MISMO motor de la app (web/dxf.js + web/dwf_writer.js). Código propio, sin nada de Autodesk.
//
// Uso:  node cli/dxf_a_dwf.js plano.dxf [salida.dwf] [--plancha "PLANO 01 DE 01"] [--titulo "…"] [--autor "…"] [--todas]
//   Sin salida: escribe <plano>.dwf junto al DXF (con --todas: <plano> - <plancha>.dwf por cada plancha).
// Desde código:  const { exportarDXF } = require('./cli/dxf_a_dwf.js'); await exportarDXF(entrada, salida, { plancha })
'use strict';
const fs = require('fs');
const path = require('path');
const WEB = path.join(__dirname, '..', 'web') + '/';

// ---------------------------------------------------------------- entorno mínimo del navegador para node
global.self = global;

// Medidas de letra: tablas de anchos de las fuentes TrueType del sistema (solo se leen métricas; nada se copia).
const FONT_DIR = '/System/Library/Fonts/Supplemental/';
const FONT_FILES = {
  'arial narrow': ['Arial Narrow.ttf', 'Arial Narrow Bold.ttf', 'Arial Narrow Italic.ttf', 'Arial Narrow Bold Italic.ttf'],
  'arial': ['Arial.ttf', 'Arial Bold.ttf', 'Arial Italic.ttf', 'Arial Bold Italic.ttf'],
  'times new roman': ['Times New Roman.ttf', 'Times New Roman Bold.ttf', 'Times New Roman Italic.ttf', 'Times New Roman Bold Italic.ttf'],
  'courier new': ['Courier New.ttf', 'Courier New Bold.ttf', 'Courier New Italic.ttf', 'Courier New Bold Italic.ttf'],
};
const fontCache = new Map();
function loadTTF(file) {
  if (fontCache.has(file)) return fontCache.get(file);
  let f = null;
  try {
    const d = fs.readFileSync(FONT_DIR + file);
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const nt = v.getUint16(4); const tab = {};
    for (let i = 0; i < nt; i++) { const o = 12 + 16 * i; tab[d.toString('latin1', o, o + 4)] = v.getUint32(o + 8); }
    const upem = v.getUint16(tab.head + 18);
    const nh = v.getUint16(tab.hhea + 34);
    const adv = []; for (let i = 0; i < nh; i++) adv.push(v.getUint16(tab.hmtx + 4 * i));
    // cmap formato 4 (Unicode BMP)
    const cm = tab.cmap, n = v.getUint16(cm + 2); let sub = -1;
    for (let i = 0; i < n; i++) { const pid = v.getUint16(cm + 4 + 8 * i), eid = v.getUint16(cm + 6 + 8 * i), off = v.getUint32(cm + 8 + 8 * i); if (pid === 3 && eid === 1) sub = cm + off; else if (pid === 0 && sub < 0) sub = cm + off; }
    const map = new Map();
    if (sub >= 0 && v.getUint16(sub) === 4) {
      const segX2 = v.getUint16(sub + 6), ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const e = v.getUint16(ends + s), st = v.getUint16(starts + s), dl = v.getInt16(deltas + s), ro = v.getUint16(ranges + s);
        for (let c = st; c <= e && c !== 0xFFFF; c++) {
          let g;
          if (!ro) g = (c + dl) & 0xFFFF;
          else { const gi = v.getUint16(ranges + s + ro + 2 * (c - st)); g = gi ? (gi + dl) & 0xFFFF : 0; }
          map.set(c, g);
        }
      }
    }
    f = { upem, adv, map };
  } catch (e) { f = null; }
  fontCache.set(file, f);
  return f;
}
function widthOf(str, cssFont) {
  const m = /^(?:(normal|italic|oblique)\s+)?(?:(normal|bold|\d+)\s+)?([\d.]+)px\s+(.*)$/.exec(cssFont.trim());
  const size = m ? parseFloat(m[3]) : 10;
  const ital = !!(m && m[1] && m[1] !== 'normal'), bold = !!(m && m[2] && (m[2] === 'bold' || +m[2] >= 600));
  const fams = (m ? m[4] : 'Arial').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase());
  let f = null;
  for (const fam of fams.concat(['arial'])) {
    const key = fam === 'helvetica' || fam === 'helvetica neue' || fam === 'sans-serif' ? 'arial' : fam;
    const files = FONT_FILES[key]; if (!files) continue;
    f = loadTTF(files[(bold ? 1 : 0) + (ital ? 2 : 0)]) || loadTTF(files[0]);
    if (f) break;
  }
  if (!f) return size * 0.5 * str.length;
  let w = 0;
  for (const ch of str) { const g = f.map.get(ch.codePointAt(0)) || 0; w += f.adv[Math.min(g, f.adv.length - 1)]; }
  return w / f.upem * size;
}
global.OffscreenCanvas = class { constructor() {} getContext() { return { font: '10px Arial', measureText(s) { return { width: widthOf(String(s), this.font) }; } }; } };

// Imágenes: dxf.js las pide con fetch + createImageBitmap; el escritor vuelve a leer los bytes del archivo.
const nativeFetch = global.fetch;
global.fetch = async (u, ...rest) => {
  if (typeof u === 'string' && !/^[a-z]+:\/\//i.test(u)) {
    if (!fs.existsSync(u)) return { ok: false, status: 404 };
    const b = fs.readFileSync(u);
    return { ok: true, status: 200, blob: async () => ({ size: b.length }), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  }
  return nativeFetch(u, ...rest);
};
global.createImageBitmap = async () => ({ width: 1, height: 1 });

global.Scene = require(WEB + 'scene.js');
global.ACI = require(WEB + 'aci.js');
global.Edit = require(WEB + 'edit.js');
global.DXF = require(WEB + 'dxf.js');
const DWFWriter = require(WEB + 'dwf_writer.js');
global.DWFWriter = DWFWriter;

// ---------------------------------------------------------------- exportar
async function exportarDXF(entrada, salida, o = {}) {
  const u8 = new Uint8Array(fs.readFileSync(entrada));
  const dir = path.dirname(path.resolve(entrada));
  const base = path.basename(entrada).replace(/\.dxf$/i, '');
  const r = await DWFWriter.fromDXF(u8, {
    plancha: o.plancha,
    resolveURL: (f) => { const r = path.resolve(dir, String(f).replace(/\\/g, '/')); return fs.existsSync(r) ? r : path.join(dir, String(f).split(/[\\/]/).pop()); }, // ruta relativa al DXF, o el mismo nombre junto al DXF
    loadBytes: async (src) => new Uint8Array(fs.readFileSync(src)),
    title: o.titulo || base,
    author: o.autor,
    sourceName: path.basename(entrada),
  });
  const out = salida || path.join(dir, base + '.dwf');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, r.bytes);
  return { salida: out, bytes: r.bytes.length, w2d: r.w2dSize, plancha: r.page.title, stats: r.stats };
}

/** Nombres de las planchas (presentaciones) de un DXF. */
async function planchas(entrada) {
  const doc = await DXF.open(new Uint8Array(fs.readFileSync(entrada)), {});
  return doc.pages.filter((p) => p.title !== 'Modelo' && !(p.vacia && p.vacia())).map((p) => p.title); // las planchas vacías no salen
}

module.exports = { exportarDXF, planchas, widthOf };

if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2); const o = {}; const pos = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--plancha') o.plancha = a[++i];
      else if (a[i] === '--titulo') o.titulo = a[++i];
      else if (a[i] === '--autor') o.autor = a[++i];
      else if (a[i] === '--todas') o.todas = true;
      else pos.push(a[i]);
    }
    if (!pos[0]) { console.log('Uso: node cli/dxf_a_dwf.js plano.dxf [salida.dwf] [--plancha NOMBRE] [--titulo T] [--autor A] [--todas]'); process.exit(1); }
    const list = o.todas ? await planchas(pos[0]) : [o.plancha];
    for (const pl of list) {
      let out = pos[1];
      if (o.todas) { const b = pos[0].replace(/\.dxf$/i, ''); out = (pos[1] ? path.join(pos[1], path.basename(b)) : b) + ' - ' + pl.replace(/[\\/:*?"<>|]/g, '_') + '.dwf'; }
      const t0 = Date.now();
      const r = await exportarDXF(pos[0], out, { ...o, plancha: pl });
      console.log(`✓ ${r.salida}\n  plancha «${r.plancha}» · ${(r.bytes / 1024).toFixed(1)} KB (W2D ${(r.w2d / 1024).toFixed(1)} KB sin comprimir) · ${Date.now() - t0} ms`);
      const s = r.stats;
      console.log(`  líneas ${s.lines} · polilíneas ${s.polylines} · arcos ${s.arcs} · rellenos ${s.fills} · textos ${s.texts} · imágenes ${s.images} · tramos de sombreado ${s.hatchSegs}`);
      if (s.warnings.length) console.log('  avisos: ' + s.warnings.join(' | '));
    }
  })().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
}
