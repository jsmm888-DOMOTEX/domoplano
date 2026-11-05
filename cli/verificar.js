#!/usr/bin/env node
// Domoplano — verificar textos montados de un plano DXF sin abrir la app (puerto propio de tdc_verificar_plano.py).
// Uso:  node cli/verificar.js plano.dxf [salida.txt] [--json] [--ancho 1.25] [--presentacion "PLANO 01 DE 01"]
//   Revisa la presentación con más objetos (o la que se indique): texto-texto, texto-trazo, texto-relleno, texto-borde,
//   tinta-trazo, llamadas que cruzan símbolos o textos, y alturas (< 2,0 y < 2,5 mm).
//   Sale con código 1 si hay algún choque (igual que el script Python), 0 si está limpio.
//   --ancho 1.25: cajas de texto 25 % más anchas (revisión más exigente, p. ej. si el plano se abrirá con letras SHX).
// Desde código:  const { verificarArchivo } = require('./cli/verificar.js'); const r = await verificarArchivo('plano.dxf');
'use strict';
const fs = require('fs');
const path = require('path');
const Verificador = require(path.join(__dirname, '..', 'web', 'verificador.js'));

async function verificarArchivo(archivo, o = {}) {
  const u8 = new Uint8Array(fs.readFileSync(archivo));
  return Verificador.verificar(u8, { ...o, nombre: o.nombre || archivo });
}
module.exports = { verificarArchivo };

if (require.main === module) {
  (async () => {
    const a = process.argv.slice(2); const o = {}; const pos = []; let json = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '--json') json = true;
      else if (a[i] === '--ancho') o.anchoExtra = parseFloat(String(a[++i]).replace(',', '.'));
      else if (a[i] === '--presentacion') o.presentacion = a[++i];
      else pos.push(a[i]);
    }
    if (!pos[0]) { console.log('Uso: node cli/verificar.js plano.dxf [salida.txt] [--json] [--ancho 1.25] [--presentacion NOMBRE]'); process.exit(2); }
    const r = await verificarArchivo(pos[0], o);
    const txt = json ? JSON.stringify({ ...r, informe: undefined }, null, 1) : r.informe;
    console.log(txt);
    if (pos[1]) fs.writeFileSync(pos[1], txt + '\n');
    process.exit(r.colisiones.length ? 1 : 0);
  })().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(2); });
}
