#!/usr/bin/env node
// Domoplano — genera la biblioteca de símbolos EPM y las plantillas EPM propias en plantillas/epm/.
// Uso:  node cli/generar_epm.js [carpeta]      (por defecto ~/Documents/Programas/Domoplano/plantillas/epm)
//   simbolos_EPM_RA8-001.dxf            todos los bloques del Anexo A (+ convenciones propias) con su cuadro, hoja A1
//   plantilla_EPM_1000x707.dxf          hoja de la plantilla EPM (1000 × 707)
//   plantilla_EPM_A0 / _A1 / _A2.dxf    hojas de la Tabla 3 de NC-RA8-001
//   simbolos_EPM_RA8-001.json           lista de bloques: nombre, estado y cita de la norma
'use strict';
const fs = require('fs');
const path = require('path');
const W = path.join(__dirname, '..', 'web') + '/';
global.DXFGen = require(W + 'dxf_generador.js');
global.SimbolosEPM = require(W + 'simbolos_epm.js');
const PlantillaEPM = require(W + 'plantilla_epm.js');

function generarTodo(dir = path.join(__dirname, '..', 'plantillas', 'epm')) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  const w = (n, t) => { const f = path.join(dir, n); fs.writeFileSync(f, t); out.push(f); };
  w('simbolos_EPM_RA8-001.dxf', SimbolosEPM.biblioteca());
  for (const h of ['1000x707', 'A0', 'A1', 'A2']) w(`plantilla_EPM_${h}.dxf`, PlantillaEPM.generar({ hoja: h }));
  w('simbolos_EPM_RA8-001.json', JSON.stringify(SimbolosEPM.lista().map(({ dibujar, ...s }) => s)
    .concat(Object.entries(SimbolosEPM.REDES).flatMap(([t, r]) => ['EX', 'PR'].map((e) => ({ bloque: `EPM_RED_${t}_${e}`, id: 'RED_' + t, nombre: r.nombre, grupo: 'Redes', estado: e === 'EX' ? 'existente' : 'proyectado', cita: 'NC-RA8-001 Anexo A, pág. 51' })))), null, 1));
  return out;
}
module.exports = { generarTodo };
if (require.main === module) for (const f of generarTodo(process.argv[2])) console.log('✓ ' + f);
