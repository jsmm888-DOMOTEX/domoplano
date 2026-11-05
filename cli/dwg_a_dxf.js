#!/usr/bin/env node
// Domoplano — H6-D: abrir DWG de terceros SIN AutoCAD. Convierte DWG → DXF con LibreDWG (dwg2dxf, GNU, GPLv3)
// llamado como PROGRAMA APARTE (no se enlaza código GPL dentro de Domoplano; uso interno DOMOTEX).
// Además informa qué trae el DWG y qué NO llegó al DXF (proxy, OLE, bloques dinámicos, tipos sin soporte).
//
// Uso:  node cli/dwg_a_dxf.js plano.dwg [salida.dxf] [--json] [--sin-detalle] [--sin-abrir]
//         Sin salida: escribe <plano>.dxf junto al DWG (NUNCA sobrescribe el .dwg; si el .dxf existe, pide -y).
//         --sin-detalle: no cuenta los objetos del DWG (más rápido en archivos enormes).
//         --sin-abrir:   no prueba abrir el DXF con el motor de Domoplano.
//       node cli/dwg_a_dxf.js --a-dwg plano.dxf [salida.dwg] [--as r2000|r2004|r14|r12]
//         DXF → DWG con dxf2dwg (por omisión R2000). LÍMITES medidos 29-10-2026 con LibreDWG 0.14 en este Mac:
//         R2007+ no existe; R2004 sale DAÑADO (no se relee, AutoCAD: «archivo no válido»); R2000 se relee completo y
//         AutoCAD lo abre si el DXF es sencillo; con planchas/ventanas o DXF exportados por AutoCAD pide RECUPERAR.
//         Se verifica solo: relee el DWG escrito y avisa si salió dañado.
// Desde código: const { convertir, aDWG, binario } = require('./cli/dwg_a_dxf.js')
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RAIZ = path.join(__dirname, '..');

/** Ruta de un programa de LibreDWG: $DOMOPLANO_LIBREDWG/bin, vendor/ del proyecto o dentro de Domoplano.app. */
function binario(nombre) {
  const cand = [];
  if (process.env.DOMOPLANO_LIBREDWG) cand.push(path.join(process.env.DOMOPLANO_LIBREDWG, 'bin', nombre));
  cand.push(path.join(RAIZ, 'vendor', 'libredwg', 'instalado', 'bin', nombre));
  cand.push(path.join('/Applications/Domoplano.app/Contents/Resources/libredwg', nombre));
  cand.push(path.join(os.homedir(), 'Applications/Domoplano.app/Contents/Resources/libredwg', nombre));
  return cand.find((f) => fs.existsSync(f)) || null;
}

const VERSIONES = {
  AC1009: 'R11/R12', AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018 (hasta 2026)',
};
function versionDWG(f) {
  const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(6); fs.readSync(fd, b, 0, 6, 0); fs.closeSync(fd);
  const v = b.toString('latin1');
  return { codigo: v, nombre: VERSIONES[v] || (/^AC\d{4}$/.test(v) ? 'desconocida' : 'no es DWG') };
}

/** Cuenta entidades por tipo en un DXF de texto (ENTITIES + BLOCKS), y algunos objetos de interés. */
function contarDXF(texto) {
  const L = texto.split(/\r?\n/);
  const ent = {}, obj = {}, xref = [];
  let sec = null;
  const NO = new Set(['BLOCK', 'ENDBLK', 'SEQEND', 'VERTEX', 'ATTRIB', 'ENDSEC', 'SECTION', 'EOF']);
  for (let i = 0; i + 1 < L.length; i += 2) {
    if (L[i].trim() !== '0') continue;
    const v = L[i + 1].trim();
    if (v === 'BLOCK' && sec === 'BLOCKS') { // bloque de referencia externa: código 70 con el bit 4
      let nom = '', fl = 0, ruta = '';
      for (let j = i + 2; j + 1 < L.length && L[j].trim() !== '0'; j += 2) {
        const c = L[j].trim();
        if (c === '2') nom = L[j + 1].trim(); else if (c === '70') fl = parseInt(L[j + 1], 10) || 0; else if (c === '1') ruta = L[j + 1].trim();
      }
      if (fl & 4) xref.push(ruta || nom);
    }
    if (v === 'SECTION') { sec = (L[i + 3] || '').trim(); continue; }
    if (v === 'ENDSEC') { sec = null; continue; }
    if ((sec === 'ENTITIES' || sec === 'BLOCKS') && !NO.has(v)) ent[v] = (ent[v] || 0) + 1;
    else if (sec === 'OBJECTS') obj[v] = (obj[v] || 0) + 1;
  }
  return { ent, obj, xref };
}

/** Cuenta entidades y objetos del DWG con dwgread (JSON), leyendo el JSON como texto (no carga todo en memoria). */
function contarDWG(dwg, tmp) {
  const exe = binario('dwgread'); if (!exe) return null;
  const js = path.join(tmp, 'dwg.json');
  const r = cp.spawnSync(exe, ['-O', 'JSON', '-o', js, dwg], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 300000 });
  if (!fs.existsSync(js)) return { error: (r.stderr || '').slice(-400) };
  const ent = {}, obj = {};
  const NO = new Set(['BLOCK', 'ENDBLK', 'SEQEND', 'VERTEX_2D', 'VERTEX_3D', 'VERTEX_MESH', 'VERTEX_PFACE', 'VERTEX_PFACE_FACE', 'ATTRIB']);
  const fd = fs.openSync(js, 'r'); const buf = Buffer.alloc(1 << 22); let resto = '';
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    const s = resto + buf.toString('utf8', 0, n);
    const re = /"(entity|object)": "([A-Za-z0-9_$*-]+)"/g; let m, ult = 0;
    while ((m = re.exec(s))) {
      ult = re.lastIndex;
      if (m[1] === 'entity') { if (!NO.has(m[2])) ent[m[2]] = (ent[m[2]] || 0) + 1; }
      else obj[m[2]] = (obj[m[2]] || 0) + 1;
    }
    resto = s.slice(Math.max(ult, s.length - 200));
  }
  fs.closeSync(fd);
  try { fs.unlinkSync(js); } catch (_) { /* nada */ }
  return { ent, obj };
}

// nombres DWG → DXF que cambian
const DWG_A_DXF = { POLYLINE_2D: 'POLYLINE', POLYLINE_3D: 'POLYLINE', POLYLINE_PFACE: 'POLYLINE', POLYLINE_MESH: 'POLYLINE',
  DIMENSION_LINEAR: 'DIMENSION', DIMENSION_ALIGNED: 'DIMENSION', DIMENSION_ANG2LN: 'DIMENSION', DIMENSION_ANG3PT: 'DIMENSION',
  DIMENSION_RADIUS: 'DIMENSION', DIMENSION_DIAMETER: 'DIMENSION', DIMENSION_ORDINATE: 'DIMENSION', ARC_DIMENSION: 'ARC_DIMENSION',
  LARGE_RADIAL_DIMENSION: 'LARGE_RADIAL_DIMENSION', MULTILEADER: 'MULTILEADER', PROXY_ENTITY: 'ACAD_PROXY_ENTITY',
  OLE2FRAME: 'OLE2FRAME', TABLE: 'ACAD_TABLE', '3DFACE': '3DFACE' };

/** Resume los avisos de LibreDWG por categoría (no se muestran los cientos de líneas al usuario). */
function resumirAvisos(stderr) {
  const lineas = String(stderr || '').split(/\r?\n/).filter((l) => /^(Warning|ERROR)/.test(l));
  const cat = {};
  const add = (k) => { cat[k] = (cat[k] || 0) + 1; };
  for (const l of lineas) {
    if (/HATCH/.test(l)) add('sombreados con referencias incompletas (se dibujan igual)');
    else if (/Unstable Class|TODO|missing fields/.test(l)) add('objetos de soporte poco probado (estilos de tabla/directriz, materiales…)');
    else if (/handle not found|handleoff|Invalid handle/i.test(l)) add('referencias internas que no se encontraron');
    else if (/CMC/.test(l)) add('colores con formato inválido (se usa el de la capa)');
    else if (/Unhandled|unknown|Unknown/i.test(l)) add('objetos desconocidos u omitidos');
    else if (/^ERROR/.test(l)) add('otros errores de lectura');
    else add('otros avisos');
  }
  return { total: lineas.length, errores: lineas.filter((l) => /^ERROR/.test(l)).length, categorias: cat };
}

/**
 * Convierte un DWG a DXF. Devuelve informe: versión, tiempo, entidades, lo que se perdió y si Domoplano lo abre.
 * o = { detalle: true, abrir: true, sobrescribir: false, timeoutMs }
 */
async function convertir(dwg, salida, o = {}) {
  const exe = binario('dwg2dxf');
  if (!exe) throw new Error('No encuentro dwg2dxf (LibreDWG). Compílelo en vendor/libredwg/ (ver bitácora H6-D).');
  if (!fs.existsSync(dwg)) throw new Error(`No existe: ${dwg}`);
  const ver = versionDWG(dwg);
  if (ver.nombre === 'no es DWG') throw new Error(`«${path.basename(dwg)}» no parece un DWG (cabecera «${ver.codigo}»).`);
  const out = salida || dwg.replace(/\.dwg$/i, '') + '.dxf';
  if (path.resolve(out) === path.resolve(dwg)) throw new Error('La salida no puede ser el mismo DWG.');
  if (fs.existsSync(out) && !o.sobrescribir) throw new Error(`Ya existe ${out} (use -y para reemplazarlo).`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'domoplano-dwg-'));
  const t0 = Date.now();
  const r = cp.spawnSync(exe, ['-y', '-o', out, dwg], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: o.timeoutMs || 300000 });
  const segundos = (Date.now() - t0) / 1000;
  const avisos = resumirAvisos(r.stderr);
  if (r.error || !fs.existsSync(out) || fs.statSync(out).size < 100) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`dwg2dxf no pudo convertir (${r.error ? r.error.message : 'código ' + r.status}): ${String(r.stderr || '').split('\n').filter((l) => /ERROR/.test(l)).slice(-3).join(' · ')}`);
  }
  const texto = fs.readFileSync(out, 'latin1');
  const dxf = contarDXF(texto);
  const inf = {
    entrada: dwg, salida: out, version: ver, segundos: +segundos.toFixed(2),
    bytesDWG: fs.statSync(dwg).size, bytesDXF: fs.statSync(out).size, codigoSalida: r.status,
    entidadesDXF: dxf.ent, totalDXF: Object.values(dxf.ent).reduce((a, b) => a + b, 0), avisos,
  };
  // lo especial que suele perderse
  const esp = {};
  const dwgc = o.detalle === false ? null : contarDWG(dwg, tmp);
  if (dwgc && !dwgc.error) {
    inf.entidadesDWG = dwgc.ent;
    inf.totalDWG = Object.values(dwgc.ent).reduce((a, b) => a + b, 0);
    const porDXF = {};
    for (const [t, n] of Object.entries(dwgc.ent)) { const k = DWG_A_DXF[t] || t; porDXF[k] = (porDXF[k] || 0) + n; }
    const perdidas = {};
    for (const [t, n] of Object.entries(porDXF)) { const d = n - (dxf.ent[t] || 0); if (d > 0) perdidas[t] = d; }
    inf.perdidas = perdidas;
    const pick = (src, re) => Object.entries(src).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
    esp.proxy = pick(dwgc.ent, /PROXY/) + pick(dwgc.obj, /PROXY/);
    esp.ole = pick(dwgc.ent, /OLE/);
    esp.desconocidos = pick(dwgc.ent, /UNKNOWN/) + pick(dwgc.obj, /UNKNOWN/);
    esp.bloquesDinamicos = pick(dwgc.obj, /EVALUATION_GRAPH/);
    esp.parametrosDinamicos = pick(dwgc.obj, /^BLOCK.*(PARAMETER|ACTION|GRIP)/);
  } else if (dwgc && dwgc.error) inf.errorDetalle = dwgc.error;
  esp.imagenes = dxf.ent.IMAGE || 0;
  esp.xref = dxf.xref.length; esp.xrefRutas = dxf.xref;   // referencias externas (otros DWG o imágenes no incluidas)
  esp.fuentesSHX = [...new Set((texto.match(/[A-Za-z0-9_-]+\.shx/gi) || []).map((s) => s.toLowerCase()))];
  inf.especiales = esp;
  fs.rmSync(tmp, { recursive: true, force: true });
  if (o.abrir !== false) {
    try {
      const { planchas } = require('./dxf_a_dwf.js');
      const t1 = Date.now();
      inf.planchas = await planchas(out);
      inf.abreEnDomoplano = true; inf.segundosAbrir = +((Date.now() - t1) / 1000).toFixed(2);
    } catch (e) { inf.abreEnDomoplano = false; inf.errorAbrir = String(e && e.message || e); }
  }
  inf.aviso = textoAviso(inf);
  return inf;
}

/** Aviso corto y claro de lo que no se pudo convertir (el mismo texto lo muestra la app). */
function textoAviso(inf) {
  const p = [];
  const e = inf.especiales || {};
  if (inf.perdidas && Object.keys(inf.perdidas).length)
    p.push('No llegaron al DXF: ' + Object.entries(inf.perdidas).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}`).join(', ') + '.');
  if (e.proxy) p.push(`${e.proxy} objeto(s) PROXY (de programas de terceros) no se pueden dibujar.`);
  if (e.ole) p.push(`${e.ole} objeto(s) OLE (Excel/Word pegados) no se muestran.`);
  if (e.bloquesDinamicos) p.push(`${e.bloquesDinamicos} bloque(s) dinámico(s): se ven en su estado actual, sin sus parámetros.`);
  if (e.xref) p.push(`${e.xref} referencia(s) externa(s) (xref) no se cargan.`);
  if (e.fuentesSHX && e.fuentesSHX.length) p.push(`Fuentes SHX (${e.fuentesSHX.slice(0, 4).join(', ')}${e.fuentesSHX.length > 4 ? '…' : ''}) se muestran con Liberation Sans.`);
  if (inf.avisos && inf.avisos.errores) p.push(`LibreDWG reportó ${inf.avisos.errores} error(es) menores de lectura (colores/referencias); revise el plano.`);
  if (inf.abreEnDomoplano === false) p.push('Domoplano NO pudo abrir el DXF convertido: ' + inf.errorAbrir);
  return p.length ? p.join(' ') : 'Convertido sin pérdidas detectadas.';
}

/** DXF → DWG con dxf2dwg. LibreDWG 0.14 escribe R12, R14, R2000 (por omisión) y R2004; R2007 en adelante NO. */
function aDWG(dxf, salida, o = {}) {
  const exe = binario('dxf2dwg');
  if (!exe) throw new Error('No encuentro dxf2dwg (LibreDWG).');
  const as = (o.as || 'r2000').toLowerCase();   // r2000: el único que salió bien en las pruebas (29-10-2026)
  if (!['r12', 'r14', 'r2000', 'r2004'].includes(as)) throw new Error(`dxf2dwg (LibreDWG 0.14) solo escribe r12, r14, r2000 y r2004; pidió ${as}.`);
  const out = salida || dxf.replace(/\.dxf$/i, '') + '.dwg';
  if (fs.existsSync(out) && !o.sobrescribir) throw new Error(`Ya existe ${out} (use -y para reemplazarlo).`);
  const t0 = Date.now();
  const r = cp.spawnSync(exe, ['-y', '--as', as, '-o', out, dxf], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: o.timeoutMs || 300000 });
  const ok = fs.existsSync(out) && fs.statSync(out).size > 100;
  const inf = { ok, salida: out, version: ok ? versionDWG(out) : null, segundos: +((Date.now() - t0) / 1000).toFixed(2),
    bytes: ok ? fs.statSync(out).size : 0, codigoSalida: r.status, avisos: resumirAvisos(r.stderr) };
  if (!ok) return inf;
  // verificación: se relee el DWG escrito con dwg2dxf y se cuentan las entidades (dxf2dwg a veces escribe un DWG dañado)
  const total = (t) => Object.values(contarDXF(t).ent).reduce((a, b) => a + b, 0);
  inf.entidadesDXF = total(fs.readFileSync(dxf, 'latin1'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'domoplano-dwg-'));
  const back = path.join(tmp, 'releido.dxf');
  cp.spawnSync(binario('dwg2dxf'), ['-y', '-o', back, out], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 300000 });
  inf.entidadesReleidas = fs.existsSync(back) ? total(fs.readFileSync(back, 'latin1')) : 0;
  fs.rmSync(tmp, { recursive: true, force: true });
  inf.verificado = inf.entidadesReleidas >= inf.entidadesDXF;
  inf.aviso = inf.verificado
    ? 'DWG escrito y releído completo. Ojo: AutoCAD lo abre si el DXF es sencillo (hecho en Domoplano); con planchas/ventanas o DXF exportados por AutoCAD puede pedir RECUPERAR. El archivo de trabajo sigue siendo el DXF.'
    : `El DWG salió DAÑADO (al releerlo hay ${inf.entidadesReleidas} de ${inf.entidadesDXF} entidades). No lo use; entregue el DXF${as === 'r2004' ? ' o pruebe --as r2000' : ''}.`;
  return inf;
}

module.exports = { convertir, aDWG, binario, versionDWG, contarDXF, textoAviso };

if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2); const o = {}; const pos = [];
    let json = false, inverso = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--json') json = true;
      else if (a[i] === '--sin-detalle') o.detalle = false;
      else if (a[i] === '--sin-abrir') o.abrir = false;
      else if (a[i] === '-y') o.sobrescribir = true;
      else if (a[i] === '--a-dwg') inverso = true;
      else if (a[i] === '--as') o.as = a[++i];
      else pos.push(a[i]);
    }
    if (!pos[0]) {
      console.log('Uso: node cli/dwg_a_dxf.js plano.dwg [salida.dxf] [-y] [--json] [--sin-detalle] [--sin-abrir]\n     node cli/dwg_a_dxf.js --a-dwg plano.dxf [salida.dwg] [--as r2000|r2004|r14|r12] [-y]');
      process.exit(1);
    }
    try {
      if (inverso) {
        const r = aDWG(pos[0], pos[1], o);
        if (json) console.log(JSON.stringify(r, null, 1));
        else console.log(r.ok ? `${r.verificado ? '✓' : '✗'} ${r.salida}  ${r.version.codigo} (${r.version.nombre})  ${(r.bytes / 1024).toFixed(1)} KB  ${r.segundos} s  releído ${r.entidadesReleidas}/${r.entidadesDXF}\n  ${r.aviso}` : `✗ dxf2dwg no escribió el DWG (código ${r.codigoSalida}).`);
        process.exit(r.ok && r.verificado ? 0 : 2);
      }
      const r = await convertir(pos[0], pos[1], o);
      if (json) { console.log(JSON.stringify(r, null, 1)); return; }
      console.log(`✓ ${r.salida}`);
      console.log(`  DWG ${r.version.codigo} (${r.version.nombre}) · ${(r.bytesDWG / 1024).toFixed(0)} KB → DXF ${(r.bytesDXF / 1024).toFixed(0)} KB · ${r.segundos} s`);
      console.log(`  Entidades: DWG ${r.totalDWG ?? '¿?'} → DXF ${r.totalDXF}` + (r.planchas ? ` · Domoplano lo abre (${r.segundosAbrir} s): ${r.planchas.length} plancha(s)` : r.abreEnDomoplano === false ? ' · ✗ Domoplano no lo abre' : ''));
      const top = Object.entries(r.entidadesDXF).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t, n]) => `${t} ${n}`).join(', ');
      console.log(`  Tipos: ${top}`);
      console.log(`  Avisos de LibreDWG: ${r.avisos.total} (${r.avisos.errores} errores menores)`);
      console.log(`  ${r.aviso}`);
    } catch (e) { console.error('✗ ' + (e && e.message || e)); process.exit(2); }
  })();
}
