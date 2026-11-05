// Domoplano F4 — cliente del canal local hacia la app abierta (socket Unix del usuario; sin red, sin teclado ni ratón).
'use strict';
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SOCKET = process.env.DOMOPLANO_SOCKET || path.join(os.homedir(), 'Library', 'Application Support', 'Domoplano', 'mcp.sock');

/** Una petición al canal: devuelve el objeto de respuesta (o {error}). */
function pedir(req, { espera = 300000 } = {}) {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCKET)) { resolve({ error: 'Domoplano no está abierto (no hay canal local).', sin_app: true }); return; }
    const s = net.createConnection(SOCKET);
    let buf = '', listo = false;
    const fin = (r) => { if (listo) return; listo = true; clearTimeout(t); s.destroy(); resolve(r); };
    const t = setTimeout(() => fin({ error: `Domoplano no respondió en ${Math.round(espera / 1000)} s.` }), espera);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify({ ...req, espera: espera / 1000 }) + '\n'));
    s.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { try { fin(JSON.parse(buf.slice(0, i))); } catch (e) { fin({ error: 'Respuesta ilegible del canal.' }); } } });
    s.on('error', (e) => fin({ error: 'Domoplano no está abierto o no responde (' + e.code + ').', sin_app: true }));
    s.on('close', () => fin({ error: 'El canal se cerró sin respuesta.' }));
  });
}

/** Operación del puente (web/mcp_puente.js) en la ventana de Claude. */
const js = (fn, args, extra = {}) => pedir({ op: 'js', fn, args: args || {}, ...extra });

async function disponible() { const r = await pedir({ op: 'ventanas' }, { espera: 5000 }); return r.ok ? r : null; }

/** Abre Domoplano en segundo plano (no le quita el foco a Sebastián) y espera el canal. */
async function lanzar({ espera = 20000 } = {}) {
  if (await disponible()) return true;
  cp.spawnSync('open', ['-g', '-a', 'Domoplano', '--args', '--mcp']);
  const t0 = Date.now();
  while (Date.now() - t0 < espera) { await new Promise((r) => setTimeout(r, 400)); if (await disponible()) return true; }
  return false;
}

/** Espera a que la ventana de Claude tenga un DXF listo para editar (tras abrir o crear). */
async function esperarPlano({ nombre = null, espera = 30000 } = {}) {
  const t0 = Date.now(); let ultimo = null;
  while (Date.now() - t0 < espera) {
    await new Promise((r) => setTimeout(r, 300));
    const r = await js('info', {}); ultimo = r;
    if (r && r.abierto && (!nombre || r.nombre === nombre)) return r;
  }
  return ultimo || { error: 'El plano no terminó de abrir.' };
}

module.exports = { pedir, js, disponible, lanzar, esperarPlano, SOCKET };
