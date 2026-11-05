// Domoplano F4 — motor SIN APP: carga el mismo código de la app (web/*.js) en Node, sin ventana.
// Abre un DXF, lo edita con la misma sesión de edición y la misma línea de comandos (cad.js) y lo guarda/exporta.
// Código propio. No abre puertos ni toca el teclado o el ratón.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const RAIZ = path.join(__dirname, '..');
const WEB = path.join(RAIZ, 'web') + '/';

// ---------------------------------------------------------------- entorno del navegador para node
// (medidas de letra, fetch de imágenes, Scene, DXF, Edit, DWFWriter: lo arma el exportador DWF de la línea de comandos)
const { planchas: planchasDe } = require(path.join(RAIZ, 'cli', 'dxf_a_dwf.js'));
global.Path2D = global.Path2D || class { moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} addPath() {} };
global.window = global;
// Elementos de interfaz de mentira: cad.js escribe mensajes en la barra de comandos (se recogen aparte) y abre paletas.
function elemento() {
  const cl = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'isPointInStroke' || k === 'isPointInPath' ? () => false : k === 'measureText' ? (s) => ({ width: String(s).length * 5 }) : () => {})), set: (t, k, v) => { t[k] = v; return true; } });
  const base = { style: {}, dataset: {}, classList: cl, children: [], textContent: '', innerHTML: '', value: '', checked: false,
    appendChild(c) { return c; }, removeChild() {}, addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, getContext() { return ctx; }, focus() {}, blur() {}, click() {}, remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 1000, right: 1600, bottom: 1000 }; } };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { t[k] = v; return true; } });
}
const elementos = new Map();
global.document = {
  getElementById(id) { if (!elementos.has(id)) elementos.set(id, elemento()); return elementos.get(id); },
  createElement() { return elemento(); }, querySelectorAll() { return []; }, querySelector() { return null; },
  addEventListener() {}, removeEventListener() {}, body: elemento(), activeElement: null,
};
global.devicePixelRatio = 1;
global.confirm = () => false; global.alert = () => {};

// XML mínimo (solo lectura) para las marcas de revisión de los DWF que devuelve EPM (web/dwf.js usa DOMParser)
class NodoXML {
  constructor(nombre, attrs) { this.nodeName = nombre; this.attrs = attrs; this.children = []; }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  getElementsByTagName(t) { const out = []; const ver = (n) => { for (const c of n.children) { if (t === '*' || c.nodeName === t) out.push(c); ver(c); } }; ver(this); return out; }
}
const entidad = (s) => s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()] || (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)))));
global.DOMParser = global.DOMParser || class {
  parseFromString(xml) {
    const raiz = new NodoXML('#document', {}); const pila = [raiz];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<\s*([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    let m;
    while ((m = re.exec(xml))) {
      if (m[1]) { if (pila.length > 1) pila.pop(); continue; }
      if (!m[2]) continue;
      const attrs = {}; const ra = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let x;
      while ((x = ra.exec(m[3] || ''))) attrs[x[1]] = entidad(x[2] !== undefined ? x[2] : x[3]);
      const n = new NodoXML(m[2], attrs); pila[pila.length - 1].children.push(n);
      if (!m[4]) pila.push(n);
    }
    return { documentElement: raiz.children[0] || { nodeName: 'parsererror', children: [] } };
  }
};
global.Zip = global.Zip || require(WEB + 'zip.js');
global.W2D = global.W2D || require(WEB + 'w2d.js');
global.DWF = require(WEB + 'dwf.js');
global.Documento = require(WEB + 'documento.js');
global.Geom = require(WEB + 'geom.js');
global.Dibujo = require(WEB + 'dibujo.js');
global.DXFGen = require(WEB + 'dxf_generador.js');
global.SimbolosEPM = require(WEB + 'simbolos_epm.js');
global.PlantillaEPM = require(WEB + 'plantilla_epm.js');
global.Verificador = require(WEB + 'verificador.js');
global.GrosoresCapas = (() => { try { return require(WEB + 'grosores_capas.js'); } catch (e) { return undefined; } })();
global.Planchas = require(WEB + 'planchas.js');
global.PDFWriter = require(WEB + 'pdf_writer.js');
global.P2 = require(WEB + 'edicion_p2.js'); // H6-B: LISTA, AREA, UNIR, PARTIR, EDITPOL, SUPRIMEDUPL, COBERTURA, TEXTOM, pegar, CANTIDADES, MAPAOSM
global.Comparador = require(WEB + 'comparador.js');
global.ChecklistEPM = require(WEB + 'checklist_epm.js');
global.CAD = require(WEB + 'cad.js');
global.DomoMCP = require(WEB + 'mcp_puente.js');

const UNIDADES = { 0: 'sin unidades', 1: 'pulgadas', 2: 'pies', 4: 'mm', 5: 'cm', 6: 'm' };

/** Un plano abierto sin la app. Solo uno a la vez (como el dibujo activo de AutoCAD). */
class PlanoSinApp {
  constructor() { this.doc = null; this.archivo = null; this.carpeta = null; this.idx = 0; this.ms = null; }

  /** Abre un DXF (ruta) o un texto DXF (plano nuevo: archivo = null hasta guardar). */
  async abrir({ ruta = null, texto = null, nombre = null, carpeta = null } = {}) {
    let u8;
    if (ruta) { ruta = path.resolve(ruta); u8 = new Uint8Array(fs.readFileSync(ruta)); }
    else u8 = new TextEncoder().encode(texto);
    const dir = ruta ? path.dirname(ruta) : (carpeta || os.homedir());
    const resolveURL = (f) => { const r = path.resolve(dir, String(f).replace(/\\/g, '/')); return fs.existsSync(r) ? r : path.join(dir, String(f).split(/[\\/]/).pop()); };
    const doc = await DXF.open(u8, { resolveURL });
    if (!doc.dxf) throw new Error('El archivo no es un DXF.');
    doc.resolveURL = resolveURL;
    this.doc = doc; this.archivo = ruta; this.nombre = nombre || (ruta ? path.basename(ruta) : 'Plano nuevo.dxf'); this.carpeta = dir; this.ms = null;
    this.idx = doc.startPage || 0;
    await this.pagina().build();
    CAD.attach(this.host());
    CAD.docOpened();
    this.guardadoTop = null;
    return this;
  }
  pagina() { return this.doc.pages[this.idx]; }
  host() {
    const yo = this;
    const pag = () => {
      const page = yo.pagina();
      if (!yo.ms || !page.vpInfo) return page;
      const info = page.vpInfo.find((v) => v.rec === yo.ms.rec); if (!info || yo.ms.rec.deleted) { yo.ms = null; return page; }
      const mo = yo.doc.modelo ? yo.doc.modelo() : null;
      const p = Object.create(page);
      Object.assign(p, { rootM: Scene.mul(page.rootM, info.m), editNode: mo ? mo.inner : null, editOrigin: mo ? mo.origin : [0, 0], edit: yo.doc.pages[0].edit, ms: info, units: yo.doc.pages[0].units, unitMM: undefined });
      return p;
    };
    return {
      doc: () => yo.doc, page: pag, paperPage: () => yo.pagina(), zoom: () => 1,
      entrarVentana: (rec) => { yo.ms = { rec }; }, salirVentana: () => { yo.ms = null; },
      zoomExt() {}, zoomAll() {}, zoomWin() {}, zoomPrev: () => false, panPage() {}, centerOn() {}, fit() {},
      goPage: (name) => yo.irA(name),
      toScreen: (x, y) => [x, y], toPage: (x, y) => [x, y],
      redraw() {}, setDirty() {}, selectionChanged() {},
      rebuild: () => yo.rearmar(),
    };
  }
  async irA(nombre) {
    const i = this.doc.pages.findIndex((p) => p.title.toUpperCase() === String(nombre).toUpperCase() || (/^model/i.test(nombre) && p === this.doc.pages[0]));
    if (i < 0) return false;
    this.idx = i; this.ms = null; await this.pagina().build(); CAD.pageChanged(); return true;
  }
  async rearmar() {
    if (this.doc.pagesDirty && this.doc.refreshPages) {
      const L = this.pagina().layout && this.pagina().layout.rec, t = this.pagina().title, era0 = this.idx === 0;
      this.doc.refreshPages();
      let i = era0 ? 0 : this.doc.pages.findIndex((p) => L && p.layout && p.layout.rec === L);
      if (i < 0) i = this.doc.pages.findIndex((p) => p.title === t);
      if (i < 0) i = Math.min(this.idx, this.doc.pages.length - 1);
      this.idx = i;
    }
    await this.pagina().build();
  }
  /** Contexto para el puente (web/mcp_puente.js). */
  contexto() {
    const yo = this;
    return {
      modo: 'archivo', cad: CAD,
      doc: () => yo.doc, S: () => CAD.session, page: () => CAD.host.page(),
      irA: (n) => yo.irA(n), refrescar: () => yo.rearmar(),
      archivo: () => yo.archivo, nombre: () => yo.nombre,
      sinGuardar: () => { const S = CAD.session; const top = S && S.undoStack.length ? S.undoStack[S.undoStack.length - 1] : null; return !!(S && S.changed && top !== yo.guardadoTop); },
    };
  }
  marcarGuardado() { const S = CAD.session; this.guardadoTop = S && S.undoStack.length ? S.undoStack[S.undoStack.length - 1] : null; if (S) S.changed = false; }
}

/** Bytes del DXF según su codificación (DXF 2000/2004 sin tildes → Windows-1252, como la app). */
function bytesDXF(texto, codificacion) { return Buffer.from(Edit.encodeDXF(texto, codificacion || 'utf-8')); }

/** Escribe un DXF; si el archivo existe, deja una copia «.bak» la primera vez (como la app). */
function escribirDXF(ruta, texto, codificacion, respaldados) {
  ruta = path.resolve(ruta);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  let nota = '';
  if (fs.existsSync(ruta) && !respaldados.has(ruta)) { fs.copyFileSync(ruta, ruta + '.bak'); respaldados.add(ruta); nota = ` (respaldo: ${path.basename(ruta)}.bak)`; }
  const b = bytesDXF(texto, codificacion);
  fs.writeFileSync(ruta, b);
  return { ruta, bytes: b.length, nota };
}

const resolverEn = (dir) => (f) => { const r = path.resolve(dir, String(f).replace(/\\/g, '/')); return fs.existsSync(r) ? r : path.join(dir, String(f).split(/[\\/]/).pop()); };

/** PDF de un texto DXF (mismo escritor de la app). carpeta = donde buscar la firma u otras imágenes. */
async function pdfDeTexto(texto, salida, { carpeta, plancha, todas, color = 'mono', titulo } = {}) {
  const u8 = new TextEncoder().encode(texto);
  let lista = null;
  if (todas) { const doc = await DXF.open(u8, {}); lista = doc.pages.filter((p) => p.title !== 'Modelo' && !(p.vacia && p.vacia())).map((p) => p.title); if (!lista.length) lista = null; }
  const r = await PDFWriter.fromDXF(u8, { plancha, planchas: lista || undefined, resolveURL: resolverEn(carpeta), loadBytes: async (s) => new Uint8Array(fs.readFileSync(s)), color, capas: true, title: titulo || path.basename(salida, '.pdf') });
  fs.mkdirSync(path.dirname(path.resolve(salida)), { recursive: true });
  fs.writeFileSync(salida, r.bytes);
  return { salida: path.resolve(salida), kb: +(r.bytes.length / 1024).toFixed(1), paginas: r.paginas || 1, hoja: r.hoja, planchas: (r.pages || [r.page]).map((p) => p.title), avisos: r.stats.warnings };
}
/** DWF V06.00 de una plancha (mismo escritor de la app). */
async function dwfDeTexto(texto, salida, { carpeta, plancha, titulo } = {}) {
  const u8 = new TextEncoder().encode(texto);
  const r = await DWFWriter.fromDXF(u8, { plancha, resolveURL: resolverEn(carpeta), loadBytes: async (s) => new Uint8Array(fs.readFileSync(s)), title: titulo || path.basename(salida, '.dwf'), sourceName: path.basename(salida, '.dwf') + '.dxf' });
  fs.mkdirSync(path.dirname(path.resolve(salida)), { recursive: true });
  fs.writeFileSync(salida, r.bytes);
  return { salida: path.resolve(salida), kb: +(r.bytes.length / 1024).toFixed(1), plancha: r.page.title, avisos: r.stats.warnings };
}
/** Vista sin app: la plancha a PDF y de ahí a PNG con «sips» (viene con macOS). */
async function vistaPNG(texto, { carpeta, plancha, ancho = 1600 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'domoplano-vista-'));
  try {
    const pdf = path.join(tmp, 'vista.pdf'), png = path.join(tmp, 'vista.png');
    await pdfDeTexto(texto, pdf, { carpeta, plancha, color: 'color' });
    const r = cp.spawnSync('sips', ['-s', 'format', 'png', '-Z', String(ancho), pdf, '--out', png], { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(png)) throw new Error('sips no pudo convertir la vista: ' + (r.stderr || '').slice(-300));
    return fs.readFileSync(png);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/** Marcas de revisión de un DWF (las observaciones que EPM deja con Design Review). Solo lee el archivo. */
async function marcasDWF(ruta) {
  const doc = await DWF.open(new Uint8Array(fs.readFileSync(ruta)));
  const out = [];
  for (const p of doc.pages) {
    if (!p.build) continue;
    let root; try { root = await p.build(); } catch (e) { out.push({ hoja: p.title, error: String(e.message || e) }); continue; }
    const ms = root.markups || [];
    out.push({ hoja: p.title, papel_mm: [r1(p.width), r1(p.height)], marcas: ms.map((m) => ({ numero: m.num || null, tipo: m.tipo, texto: m.texto || '', caja_mm: m.bb.map(r1), centro_mm: [r1((m.focus[0] + m.focus[2]) / 2), r1((m.focus[1] + m.focus[3]) / 2)] })) });
  }
  return { archivo: ruta, hojas: out, total: out.reduce((n, h) => n + (h.marcas ? h.marcas.length : 0), 0), con_texto: out.reduce((n, h) => n + (h.marcas ? h.marcas.filter((m) => m.texto).length : 0), 0), nota: 'Coordenadas en mm de papel desde la esquina superior izquierda de la hoja.' };
}
const r1 = (v) => Math.round(v * 10) / 10;

module.exports = { marcasDWF, PlanoSinApp, escribirDXF, bytesDXF, pdfDeTexto, dwfDeTexto, vistaPNG, planchasDe, UNIDADES, RAIZ };
