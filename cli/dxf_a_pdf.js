#!/usr/bin/env node
// Domoplano — exportar un DXF a PDF vectorial (una plancha por archivo, tamaño de hoja real) sin abrir la app.
// Usa el MISMO motor de la app (web/dxf.js + web/pdf_writer.js). Código propio, sin nada de Autodesk.
//
// Uso:  node cli/dxf_a_pdf.js plano.dxf [salida.pdf] [--plancha "PLANO 01 DE 01"] [--todas | --un-pdf]
//                             [--mono | --grises] [--sin-capas] [--grosor-min 0.05] [--titulo "…"] [--autor "…"]
//   Sin salida: escribe <plano>.pdf junto al DXF (con --todas: <plano> - <plancha>.pdf por cada plancha).
//   --un-pdf: todas las planchas en UN solo PDF (una página por plancha, cada una de su tamaño).
//   --mono: todo en negro (como el estilo «monochrome» para EPM). --grises: colores pasados a gris.
// Desde código:  const { exportarPDF } = require('./cli/dxf_a_pdf.js'); await exportarPDF(entrada, salida, { plancha })
'use strict';
const fs = require('fs');
const path = require('path');
// El entorno de node (medidas de letra, fetch de imágenes, DXF, Scene…) es el mismo del exportador DWF.
const { planchas } = require('./dxf_a_dwf.js');
const PDFWriter = require(path.join(__dirname, '..', 'web', 'pdf_writer.js'));
global.PDFWriter = PDFWriter;

async function exportarPDF(entrada, salida, o = {}) {
  const u8 = new Uint8Array(fs.readFileSync(entrada));
  const dir = path.dirname(path.resolve(entrada));
  const base = path.basename(entrada).replace(/\.dxf$/i, '');
  const r = await PDFWriter.fromDXF(u8, {
    plancha: o.plancha,
    planchas: o.planchas,
    resolveURL: (f) => { const r = path.resolve(dir, String(f).replace(/\\/g, '/')); return fs.existsSync(r) ? r : path.join(dir, String(f).split(/[\\/]/).pop()); }, // ruta relativa al DXF, o el mismo nombre junto al DXF
    loadBytes: async (src) => new Uint8Array(fs.readFileSync(src)),
    color: o.color || 'color',
    capas: o.capas !== false,
    grosorMinimoMM: o.grosorMinimoMM,
    title: o.titulo || base,
    author: o.autor,
  });
  const out = salida || path.join(dir, base + '.pdf');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, r.bytes);
  return { salida: out, bytes: r.bytes.length, plancha: (r.pages || [r.page]).map((p) => p.title).join(', '), paginas: r.paginas || 1, hoja: r.hoja, stats: r.stats };
}

module.exports = { exportarPDF, planchas };

if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2); const o = {}; const pos = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--plancha') o.plancha = a[++i];
      else if (a[i] === '--titulo') o.titulo = a[++i];
      else if (a[i] === '--autor') o.autor = a[++i];
      else if (a[i] === '--todas') o.todas = true;
      else if (a[i] === '--un-pdf') o.unPdf = true;
      else if (a[i] === '--mono') o.color = 'mono';
      else if (a[i] === '--grises') o.color = 'grises';
      else if (a[i] === '--sin-capas') o.capas = false;
      else if (a[i] === '--grosor-min') o.grosorMinimoMM = parseFloat(a[++i]);
      else pos.push(a[i]);
    }
    if (!pos[0]) { console.log('Uso: node cli/dxf_a_pdf.js plano.dxf [salida.pdf] [--plancha NOMBRE] [--todas] [--mono|--grises] [--sin-capas] [--grosor-min MM] [--titulo T] [--autor A]'); process.exit(1); }
    if (o.unPdf) o.planchas = await planchas(pos[0]); // todas las planchas en un solo PDF de varias páginas
    const list = o.todas && !o.unPdf ? await planchas(pos[0]) : [o.plancha];
    for (const pl of list) {
      let out = pos[1];
      if (o.todas && !o.unPdf) { const b = pos[0].replace(/\.dxf$/i, ''); out = (pos[1] ? path.join(pos[1], path.basename(b)) : b) + ' - ' + pl.replace(/[\\/:*?"<>|]/g, '_') + '.pdf'; }
      const t0 = Date.now();
      const r = await exportarPDF(pos[0], out, { ...o, plancha: pl });
      const s = r.stats;
      console.log(`✓ ${r.salida}\n  plancha «${r.plancha}» · hoja ${r.hoja} · ${(r.bytes / 1024).toFixed(1)} KB · ${Date.now() - t0} ms`);
      console.log(`  líneas ${s.lines} · polilíneas ${s.paths} · arcos/círculos ${s.arcs} · rellenos ${s.fills} · sombreados ${s.hatches} · textos ${s.texts} · imágenes ${s.images} · ventanas ${s.clips}`);
      if (s.warnings.length) console.log('  avisos: ' + s.warnings.join(' | '));
    }
  })().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
}
