#!/usr/bin/env node
// Domoplano — Validador integral NC-RA8-001 (CHECKEPM + VERIFICAR + REVISION/AUDIT + COMPARAR) desde línea de comandos.
// Admite archivos .dxf y .dwg (los .dwg se convierten en memoria/temporal con LibreDWG sin tocar el original).
// Uso:
//   node cli/validar_epm.js <plano.dxf|plano.dwg> [opciones]
// Opciones:
//   --presentacion <nombre>   Plancha o presentación a revisar (por omisión la principal con dibujo o el Modelo)
//   --todas                   Revisa todas las planchas con dibujo del archivo
//   --comparar <anterior>     Compara además contra una versión anterior (.dxf o .dwf devuelto por EPM)
//   --md <ruta.md>            Guarda el informe completo en Markdown (para el Cerebro de Obsidian)
//   --pdf <ruta.pdf>          Guarda el informe de chequeo en PDF vectorial
//   --json                    Imprime la salida en formato JSON estructurado
//   --estricto                Sale con código 1 si CHECKEPM tiene alguna falla o si VERIFICAR detecta colisiones
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const motor = require(path.join(__dirname, '..', 'mcp', 'motor.js'));
const Verificador = require(path.join(__dirname, '..', 'web', 'verificador.js'));
const Comparador = require(path.join(__dirname, '..', 'web', 'comparador.js'));
const ChecklistEPM = require(path.join(__dirname, '..', 'web', 'checklist_epm.js'));
const { convertir } = require(path.join(__dirname, 'dwg_a_dxf.js'));

async function cargarDXF(archivo) {
  const abs = path.resolve(archivo);
  if (!fs.existsSync(abs)) throw new Error(`No existe el archivo: ${abs}`);
  if (/\.dwg$/i.test(abs)) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'domoplano-val-'));
    const tmpDXF = path.join(tmpDir, path.basename(abs, path.extname(abs)) + '.dxf');
    const infoDWG = await convertir(abs, tmpDXF, { sobrescribir: true });
    const bytes = new Uint8Array(fs.readFileSync(tmpDXF));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return { bytes, texto: new TextDecoder('utf-8', { fatal: false }).decode(bytes), carpeta: path.dirname(abs), nombre: path.basename(abs), infoDWG };
  }
  const bytes = new Uint8Array(fs.readFileSync(abs));
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (_) { texto = new TextDecoder('windows-1252').decode(bytes); }
  return { bytes, texto, carpeta: path.dirname(abs), nombre: path.basename(abs), infoDWG: null };
}

async function validarArchivo(archivo, o = {}) {
  const t0 = Date.now();
  const { bytes, texto, carpeta, nombre, infoDWG } = await cargarDXF(archivo);
  // 1) REVISION (audit de estructura DXF: handles, capas, bloques, estilos)
  let revision = { errores: [], avisos: [] };
  try {
    const doc = await global.DXF.open(bytes, { resolveURL: (f) => path.resolve(carpeta, String(f).replace(/\\/g, '/')) });
    const S = new global.Edit.Session(doc);
    if (typeof S.auditar === 'function') revision = S.auditar({ arreglar: false });
  } catch (e) {
    revision.errores.push('Error al abrir en el motor DXF: ' + (e.message || e));
  }

  // 2) Determinar planchas a revisar
  const D = Verificador.leer(texto);
  const E = Comparador.espaciosDe(D);
  let planchas = [];
  if (o.presentacion) {
    planchas = [o.presentacion];
  } else if (o.todas) {
    planchas = [...E.entries()].filter(([k, es]) => k !== 'Modelo' && es.length >= 5).map(([k]) => k);
    if (!planchas.length) planchas = [undefined];
  } else {
    planchas = [undefined];
  }

  const revisiones = [];
  for (const pl of planchas) {
    const chk = await ChecklistEPM.revisar(bytes, {
      presentacion: pl,
      nombre,
      medirDWF: async (plancha) => {
        if (!plancha || plancha === 'Modelo') return null;
        const w = await global.DWFWriter.fromDXF(bytes, {
          plancha,
          resolveURL: (f) => path.resolve(carpeta, String(f).replace(/\\/g, '/')),
          loadBytes: async (s) => new Uint8Array(fs.readFileSync(s)),
          title: nombre,
          sourceName: nombre,
        });
        return w.bytes.length;
      },
    });
    const ver = await Verificador.verificar(bytes, {
      presentacion: chk.plancha === 'Modelo' ? 'Model' : chk.plancha,
      nombre,
      sinBordeEnModelo: chk.plancha === 'Modelo',
      anchoExtra: o.anchoExtra || 1,
    });
    revisiones.push({ plancha: chk.plancha, checklist: chk, verificador: ver });
  }

  // 3) Comparación opcional contra versión anterior (.dxf o .dwf)
  let comparacion = null;
  if (o.comparar) {
    const ant = path.resolve(o.comparar);
    if (!fs.existsSync(ant)) throw new Error(`No existe el archivo a comparar: ${ant}`);
    if (/\.dwfx?$/i.test(ant)) {
      const pl = revisiones[0].plancha !== 'Modelo' ? revisiones[0].plancha : undefined;
      const w = await global.DWFWriter.fromDXF(bytes, {
        plancha: pl,
        resolveURL: (f) => path.resolve(carpeta, String(f).replace(/\\/g, '/')),
        loadBytes: async (s) => new Uint8Array(fs.readFileSync(s)),
        title: nombre,
        sourceName: nombre,
      });
      comparacion = await Comparador.compararDWF(new Uint8Array(fs.readFileSync(ant)), w.bytes, {
        nombreA: path.basename(ant),
        nombreB: nombre + ' (DWF actual)',
      });
    } else {
      const antDatos = await cargarDXF(ant);
      comparacion = Comparador.compararDXF(antDatos.bytes, bytes, {
        nombreA: antDatos.nombre,
        nombreB: nombre,
      });
    }
  }

  const principal = revisiones[0];
  const cumpleTodo = revisiones.every((r) => r.checklist.cumple && r.verificador.colisiones.length === 0) && !revision.errores.length;
  const ms = Date.now() - t0;

  // Informes opcionales en disco
  if (o.md) {
    const mdOut = path.resolve(o.md);
    fs.mkdirSync(path.dirname(mdOut), { recursive: true });
    const bloquesMD = revisiones.map((r) => ChecklistEPM.md(r.checklist));
    if (infoDWG) bloquesMD.unshift(`> **Conversión DWG:** ${infoDWG.version.codigo} (${infoDWG.version.nombre}) · ${infoDWG.totalDWG} entidades en ${infoDWG.segundos} s · ${infoDWG.aviso}\n`);
    if (comparacion) bloquesMD.push('\n---\n\n' + Comparador.informeMD(comparacion));
    fs.writeFileSync(mdOut, bloquesMD.join('\n\n'));
  }
  if (o.pdf) {
    const pdfOut = path.resolve(o.pdf);
    fs.mkdirSync(path.dirname(pdfOut), { recursive: true });
    const dxfInf = ChecklistEPM.dxfInforme(principal.checklist);
    await motor.pdfDeTexto(dxfInf, pdfOut, { carpeta, plancha: 'INFORME CHECKEPM', color: 'color', titulo: 'Checklist RA8-001 - ' + nombre });
  }

  return {
    archivo: nombre,
    ms,
    cumple: cumpleTodo,
    dwg: infoDWG ? { version: infoDWG.version, entidadesDWG: infoDWG.totalDWG, entidadesDXF: infoDWG.totalDXF, perdidas: infoDWG.perdidas, aviso: infoDWG.aviso } : null,
    revision,
    planchas: revisiones,
    comparacion,
  };
}

module.exports = { validarArchivo, cargarDXF };

if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2);
    const o = {};
    const pos = [];
    let json = false, estricto = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--json') json = true;
      else if (a[i] === '--estricto') estricto = true;
      else if (a[i] === '--todas') o.todas = true;
      else if (a[i] === '--presentacion' || a[i] === '--plancha') o.presentacion = a[++i];
      else if (a[i] === '--ancho') o.anchoExtra = parseFloat(String(a[++i]).replace(',', '.'));
      else if (a[i] === '--comparar') o.comparar = a[++i];
      else if (a[i] === '--md') o.md = a[++i];
      else if (a[i] === '--pdf') o.pdf = a[++i];
      else pos.push(a[i]);
    }
    if (!pos[0]) {
      console.log('Uso: node cli/validar_epm.js <plano.dxf|plano.dwg> [--presentacion NOMBRE | --todas] [--comparar ANTERIOR] [--md SALIDA.md] [--pdf SALIDA.pdf] [--json] [--estricto]');
      process.exit(2);
    }
    const r = await validarArchivo(pos[0], o);
    if (json) {
      const outJson = JSON.stringify({
        archivo: r.archivo,
        ms: r.ms,
        cumple: r.cumple,
        dwg: r.dwg,
        revision: r.revision,
        planchas: r.planchas.map((p) => ({
          plancha: p.plancha,
          cumple: p.checklist.cumple,
          resumen: p.checklist.resumen,
          items: p.checklist.items,
          colisiones: p.verificador.colisiones,
          textos: p.verificador.textos,
          alturaMinima: p.verificador.alturaMinima,
        })),
        comparacion: r.comparacion ? { resumen: r.comparacion.resumen, textos: r.comparacion.textos, total_items: r.comparacion.items.length } : null,
      }, null, 2);
      process.stdout.write(outJson + '\n', () => process.exit(estricto && !r.cumple ? 1 : 0));
      return;
    } else {
      if (r.dwg) console.log(`DWG: ${r.dwg.version.codigo} (${r.dwg.version.nombre}) · ${r.dwg.aviso}`);
      if (r.revision.errores.length || r.revision.avisos.length) {
        console.log(`REVISION DXF: ${r.revision.errores.length} error(es), ${r.revision.avisos.length} aviso(s)`);
      }
      for (const p of r.planchas) {
        console.log(p.checklist.informe);
        if (p.verificador.colisiones.length) {
          console.log(`  VERIFICAR (${p.plancha}): ${p.verificador.colisiones.length} colisión(es) detectada(s)`);
        }
      }
      if (r.comparacion) {
        console.log('\n' + r.comparacion.informe.split('\n').slice(0, 25).join('\n'));
      }
    }
    process.exit(estricto && !r.cumple ? 1 : 0);
  })().catch((e) => {
    console.error('✗ ' + ((e && e.stack) || e));
    process.exit(2);
  });
}
