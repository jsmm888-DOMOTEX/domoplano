// Pruebas de geometría de Domoplano (recortar, alargar, desfase, girar, escalar). Uso: node tests/geomtest.js
const W=require('path').join(__dirname, '..', 'web') + '/';
global.self = global; global.Path2D = class { moveTo(){} lineTo(){} arc(){} ellipse(){} rect(){} closePath(){} bezierCurveTo(){} quadraticCurveTo(){} addPath(){} };
global.Scene = require(W+'scene.js'); global.DXF = require(W+'dxf.js'); global.Edit = require(W+'edit.js'); const G = require(W+'geom.js');
const R = (type, o) => new DXF.Rec(type, Object.entries(o).flatMap(([k,v]) => Array.isArray(v) ? v.map(x=>[+k.replace(/_.*/,''), String(x)]) : [[+k.replace(/_.*/,''), String(v)]]));
const line = (x0,y0,x1,y1) => new DXF.Rec('LINE', [[8,'0'],[100,'AcDbLine'],[10,''+x0],[20,''+y0],[30,'0'],[11,''+x1],[21,''+y1],[31,'0']]);
const pts = (r) => r.p.filter(q=>[10,20,11,21,40,50,51].includes(q[0])).map(q=>q[0]+'='+(+q[1]).toFixed(3)).join(' ');
let ok = 0, bad = 0; const check = (name, cond, info) => { if (cond) ok++; else { bad++; console.log('FALLA', name, info || ''); } };
// 1 recortar un extremo
let r = G.trim(line(0,0,10,0), 8, 0, [line(5,-5,5,5)]);
check('trim extremo', r.mods && pts({p:r.mods[0].pairs}) === '10=0.000 20=0.000 11=5.000 21=0.000', JSON.stringify(r));
// 2 recortar el medio
r = G.trim(line(0,0,10,0), 5, 0.1, [line(3,-5,3,5), line(7,-5,7,5)]);
check('trim medio', r.mods && pts({p:r.mods[0].pairs}).endsWith('11=3.000 21=0.000') && r.adds.length===1 && pts({p:r.adds[0].pairs}).startsWith('10=7.000'), JSON.stringify(r));
// 3 círculo → arco
const circ = new DXF.Rec('CIRCLE', [[5,'A1'],[8,'0'],[100,'AcDbCircle'],[10,'0'],[20,'0'],[30,'0'],[40,'5']]);
r = G.trim(circ, 0, 5, [line(-10,0,10,0)]);
check('trim círculo', r.dels && r.adds[0].type==='ARC' && pts({p:r.adds[0].pairs}).includes('50=180.000 51=0.000'), JSON.stringify(r));
// 4 alargar
r = G.extend(line(0,0,4,0), 3.9, 0, [line(10,-5,10,5), line(20,-5,20,5)]);
check('alarga', r.mods && pts({p:r.mods[0].pairs}).includes('11=10.000'), JSON.stringify(r));
r = G.extend(line(0,0,4,0), 0.1, 0, [line(-3,-5,-3,5)]);
check('alarga inicio', r.mods && pts({p:r.mods[0].pairs}).startsWith('10=-3.000'), JSON.stringify(r));
// 5 desfase polilínea cuadrada cerrada hacia afuera
const sq = new DXF.Rec('LWPOLYLINE', [[8,'0'],[100,'AcDbPolyline'],[90,'4'],[70,'1'],[10,'0'],[20,'0'],[10,'10'],[20,'0'],[10,'10'],[20,'10'],[10,'0'],[20,'10']]);
r = G.offset(sq, 1, 5, -3);
check('desfase cuadrado', r.pairs && pts({p:r.pairs}) === '10=-1.000 20=-1.000 10=11.000 20=-1.000 10=11.000 20=11.000 10=-1.000 20=11.000', JSON.stringify(r.pairs));
r = G.offset(line(0,0,10,0), 2, 5, -1);
check('desfase línea', pts({p:r.pairs}) === '10=0.000 20=-2.000 11=10.000 21=-2.000', pts({p:r.pairs}));
// 6 girar TEXT sin 50 → agrega 50
const T = Edit.similarity({ base:[0,0], deg: 90 });
let tp = Edit.transformPairs('TEXT', [[100,'AcDbText'],[10,'10'],[20,'0'],[30,'0'],[40,'2.5'],[1,'Hola'],[100,'AcDbText']], T, false);
check('gira texto', JSON.stringify(tp) === JSON.stringify([["100","AcDbText"],[10,"0.0"],[20,"10.0"],[30,"0"],[40,"2.5"],[1,"Hola"],[50,"90.0"],[100,"AcDbText"]].map(([c,v])=>[+c||c,v])) || (tp[6][0]===50 && tp[6][1]==='90.0' && tp[1][1]==='0.0' && tp[2][1]==='10.0'), JSON.stringify(tp));
// 7 escalar INSERT sin 41
tp = Edit.transformPairs('INSERT', [[100,'AcDbBlockReference'],[2,'POSTE'],[10,'2'],[20,'0'],[30,'0']], Edit.similarity({ base:[0,0], s:3, deg:30 }), false);
check('escala insert', tp.map(q=>q[0]).join(',') === '100,2,10,20,30,41,42,43,50' && tp[2][1]==='5.1961524227' && tp[8][1]==='30.0', JSON.stringify(tp));
// 8 arco reflejado: mover +5 en X debe moverlo +5 en WCS (OCS x invertida)
tp = Edit.transformPairs('ARC', [[100,'AcDbCircle'],[10,'-3'],[20,'0'],[30,'0'],[40,'1'],[210,'0'],[220,'0'],[230,'-1'],[100,'AcDbArc'],[50,'0'],[51,'90']], Edit.similarity({ dx:5 }), true);
check('arco reflejado mover', tp[1][1]==='-8.0', JSON.stringify(tp));
// 9 girar arco 90°
tp = Edit.transformPairs('ARC', [[10,'1'],[20,'0'],[40,'1'],[50,'0'],[51,'90']], Edit.similarity({ base:[0,0], deg:90 }), false);
check('gira arco', tp.map(q=>(+q[1]).toFixed(3)).join(' ') === '0.000 1.000 1.000 90.000 180.000', JSON.stringify(tp));
// 10 recortar arco por bulge de polilínea (borde arco)
const pl = new DXF.Rec('LWPOLYLINE', [[90,'2'],[70,'0'],[10,'-5'],[20,'0'],[42,'1'],[10,'5'],[20,'0']]); // semicírculo r5 por debajo? bulge 1 = 180°
const e = G.edges(pl)[0];
check('bulge semicírculo', e.k==='arc' && Math.abs(e.r-5)<1e-9 && Math.abs(e.c[0])<1e-9, JSON.stringify(e));
r = G.trim(line(0,-10,0,10), 0, 8, [pl]);
check('trim contra arco', r.mods && pts({p:r.mods[0].pairs}).includes('21=-5.000'), JSON.stringify(r));
console.log('pruebas OK', ok, 'fallas', bad);
