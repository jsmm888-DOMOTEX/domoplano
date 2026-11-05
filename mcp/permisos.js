// Domoplano — permisos de escritura del MCP (revisión 2, 29-10-2026).
// El MCP solo escribe en carpetas permitidas:
//   1) la carpeta del plano abierto (y la del DXF de entrada de run_script_on_file / compare / checklist_epm);
//   2) las carpetas de la lista configurable:
//        ~/Library/Application Support/Domoplano/mcp-carpetas.json   →  {"carpetas_permitidas": ["~/Documents/Proyectos", …]}
//        y/o la variable de entorno DOMOPLANO_MCP_CARPETAS (rutas separadas por «:»).
// Nunca reemplaza un archivo que ya existe sin overwrite: true (alias: sobrescribir: true).
// Nunca escribe en el Escritorio ni en Descargas salvo permitir_escritorio_descargas: true (que lo pida Sebastián).
// La lista la edita Sebastián a mano: no hay herramienta del MCP para cambiarla.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG = path.join(os.homedir(), 'Library', 'Application Support', 'Domoplano', 'mcp-carpetas.json');
const exp = (p) => path.resolve(String(p).replace(/^~(?=\/|$)/, os.homedir()));

/** Ruta real (resuelve enlaces) aunque el archivo o sus últimas carpetas todavía no existan. */
function real(p) {
  p = exp(p); let base = p; const resto = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync(base), ...resto); } catch (e) {
      const up = path.dirname(base); if (up === base) return p;
      resto.unshift(path.basename(base)); base = up;
    }
  }
  return p;
}
const dentro = (hijo, padre) => { const r = path.relative(padre, hijo); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };

/** Carpetas de la lista configurable (archivo + variable de entorno), ya resueltas. */
function listaConfigurada() {
  const out = [];
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const L = Array.isArray(j) ? j : (j && (j.carpetas_permitidas || j.carpetas)) || [];
    for (const c of L) if (typeof c === 'string' && c.trim()) out.push(real(c.trim()));
  } catch (e) { /* sin archivo de configuración */ }
  for (const c of String(process.env.DOMOPLANO_MCP_CARPETAS || '').split(path.delimiter)) if (c.trim()) out.push(real(c.trim()));
  return [...new Set(out)];
}
/** Escritorio y Descargas (con sus nombres en español por si existen como carpetas reales). */
function prohibidas() {
  const h = os.homedir();
  return [...new Set(['Desktop', 'Downloads', 'Escritorio', 'Descargas'].map((n) => real(path.join(h, n))))];
}

/**
 * ¿Se puede escribir en `ruta`? o = {abiertas: [carpetas del plano abierto / archivos de entrada], overwrite, escritorio}.
 * Devuelve {ok: true, ruta} o {error: texto claro para Claude}.
 */
function revisar(ruta, o = {}) {
  if (!ruta) return { error: 'Falta la ruta.' };
  const r = real(ruta);
  const raiz = path.parse(r).root;
  if (r === raiz) return { error: 'Ruta no válida.' };
  try { if (fs.existsSync(r) && fs.statSync(r).isDirectory()) return { error: `${r} es una carpeta: dé la ruta de un archivo.` }; } catch (e) { /* sigue */ }
  const prohib = prohibidas().find((p) => dentro(r, p));
  if (prohib && !o.escritorio) return { error: `No escribo en ${prohib} (Escritorio o Descargas) salvo que Sebastián lo pida: use permitir_escritorio_descargas: true solo si él lo pidió, o guarde en la carpeta del proyecto.` };
  const abiertas = [...new Set((o.abiertas || []).filter(Boolean).map(real))];
  const permitidas = [...abiertas, ...listaConfigurada()];
  if (!permitidas.some((p) => dentro(r, p))) {
    return { error: `La carpeta ${path.dirname(r)} no está permitida para el MCP. Permitidas: ${permitidas.length ? permitidas.join(' · ') : '(ninguna: no hay plano abierto desde un archivo)'}. ` +
      `Se permite la carpeta del plano abierto y las de la lista en «${CONFIG}» ({"carpetas_permitidas": [...]}) o en DOMOPLANO_MCP_CARPETAS; esa lista la edita Sebastián.` };
  }
  if (fs.existsSync(r) && !o.overwrite) return { error: `Ya existe ${r}. No lo reemplazo sin overwrite: true (pídalo solo si Sebastián quiere reemplazarlo).` };
  return { ok: true, ruta: r };
}

module.exports = { revisar, listaConfigurada, prohibidas, real, dentro, CONFIG };
