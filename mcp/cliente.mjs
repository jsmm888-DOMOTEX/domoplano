// Cliente MCP de prueba (sin dependencias): arranca mcp/servidor.js por stdio y llama herramientas en orden.
// Uso:  node mcp/cliente.mjs llamadas.json        (llamadas.json = [["herramienta", {argumentos}], …]; ["__list"] = lista)
//       OUT_DIR=/carpeta node mcp/cliente.mjs …   (dónde guardar las imágenes de screenshot; por omisión la carpeta temporal)
// Desde código:  import { conectar } from './cliente.mjs'; const c = await conectar(); await c.llamar('status', {}); c.cerrar();
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export async function conectar({ servidor = path.join(AQUI, 'servidor.js'), env = {} } = {}) {
  const p = spawn(process.execPath, [servidor], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let n = 0, buf = ''; const esperando = new Map(); let stderr = '';
  p.stderr.on('data', (d) => { stderr += d; if (process.env.TRACE) process.stderr.write(d); });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue;
      const m = JSON.parse(l); const w = esperando.get(m.id); if (w) { esperando.delete(m.id); w(m); }
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++n; esperando.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cliente-domoplano', version: '1' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return {
    init, proceso: p, get stderr() { return stderr; },
    herramientas: async () => (await rpc('tools/list', {})).tools,
    llamar: (name, args = {}) => rpc('tools/call', { name, arguments: args }),
    cerrar: () => { p.stdin.end(); return new Promise((r) => p.on('exit', r)); },
  };
}

/** Texto de una respuesta (y JSON si se puede). */
export const texto = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
export const json = (r) => { try { return JSON.parse(texto(r)); } catch { return null; } };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const llamadas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const OUT = process.env.OUT_DIR || os.tmpdir();
  const c = await conectar();
  for (const [name, args] of llamadas) {
    if (name === '__list') { for (const t of await c.herramientas()) console.log(t.name); continue; }
    const r = await c.llamar(name, args || {});
    for (const ct of r.content) {
      if (ct.type === 'text') console.log(`[${name}]${r.isError ? ' ERROR' : ''}`, ct.text);
      else if (ct.type === 'image') { const f = path.join(OUT, `${name}-${Date.now()}.png`); fs.writeFileSync(f, Buffer.from(ct.data, 'base64')); console.log(`[${name}] imagen -> ${f}`); }
    }
  }
  await c.cerrar();
}
