// Domoplano — PLANTILLA EPM PROPIA (NC-RA8-001 §6.2): hoja, marco, distribución de la información (Figura 1),
// rótulo 160 × 100 mm con los campos a–l (Figura 4), espacio 9 para sello 160 × 70 mm encima del rótulo, símbolo de
// proyección del TERCER cuadrante (6.2.3.1 j), espacios 2–8 con títulos y escalas (Tabla 4), norte, convenciones
// (espacio 6, con los símbolos de simbolos_epm.js) y cuadro de cargas (espacio 7).
// Dibujada de cero por Domoplano: no copia la plantilla F125 de EPM ni nada de Autodesk.
// Hojas: Tabla 3 de la norma (A0 1189×841, A1 841×594, A2 594×420) y la de la plantilla de EPM 1000×707.
//
// Uso:  PlantillaEPM.generar({ hoja: '1000x707' | 'A0' | 'A1' | 'A2', datos: { proyecto, direccion, … } }) → texto DXF
//   El modelo se dibuja en METROS (MAGNA-SIRGAS, 6.3.1 d); las ventanas muestran el modelo a 1:500 (espacio 2) y
//   1:1000 (espacio 3). Los campos vacíos salen como «(?)» para llenarlos con EDITATEXTO.
const PlantillaEPM = (() => {
  const G = (typeof DXFGen !== 'undefined') ? DXFGen : require('./dxf_generador.js');
  const S = (typeof SimbolosEPM !== 'undefined') ? SimbolosEPM : require('./simbolos_epm.js');
  const HOJAS = { '1000X707': [1000, 707, 'EPM 1000 x 707 mm'], A0: [1189, 841, 'A0 1189 x 841 mm'], A1: [841, 594, 'A1 841 x 594 mm'], A2: [594, 420, 'A2 594 x 420 mm'] };
  const Q = '(?)';

  function generar({ hoja = '1000x707', datos = {}, plancha = 'PLANO 01 DE 01', centroModelo = [0, 0] } = {}) {
    const [W, H, nombrePapel] = HOJAS[String(hoja).toUpperCase()] || HOJAS['1000X707'];
    const D = new G.Dibujo({ papel: [W, H], plancha, nombrePapel, unidades: 6 }); // el modelo va en METROS (6.3.1 d)
    // capas (grosores propuestos; la tabla definitiva es la decisión 3 del PLAN)
    D.capa('EPM-MARCO', { color: 7, grosor: 50 }).capa('EPM-ROTULO', { color: 7, grosor: 35 }).capa('EPM-TEXTO', { color: 7, grosor: 18 })
      .capa('EPM-ESPACIOS', { color: 7, grosor: 35 }).capa('EPM-CONVENCIONES', { color: 7, grosor: 25 }).capa('EPM-TABLAS', { color: 7, grosor: 18 })
      .capa('EPM-FIRMA', { color: 7, grosor: 18 })
      .capa('RED-MT-PROY', { color: 1, grosor: 35 }).capa('RED-MT-EXIST', { color: 1, grosor: 25 }).capa('RED-BT-PROY', { color: 3, grosor: 35 })
      .capa('RED-BT-EXIST', { color: 3, grosor: 25 }).capa('POSTES', { color: 7, grosor: 25 }).capa('TRANSFORMADORES', { color: 1, grosor: 35 })
      .capa('VIAS', { color: 8, grosor: 13 }).capa('CONSTRUCCIONES', { color: 8, grosor: 13 }).capa('COTAS', { color: 7, grosor: 13 });
    D.tipoLinea('EPM_TRAZOS', 'Trazos __ __ __ (proyectado)', [3, -1.5]);
    D.tipoLinea('EPM_TRAZO_PUNTO', 'Trazo y punto __ . __ .', [5, -0.8, 0, -0.8]);
    D.tipoLinea('EPM_TRAZO_2PUNTOS', 'Trazo y dos puntos __ .. __ ..', [5, -0.8, 0, -0.8, 0, -0.8]);
    const P = D.plancha; const T = (p, h, s, o = {}) => P.texto(p, h, s, { capa: 'EPM-TEXTO', ...o });
    const box = (x0, y0, x1, y1, capa = 'EPM-ESPACIOS') => P.rect(x0, y0, x1, y1, { capa });
    const dato = (k, def = Q) => (datos[k] != null && datos[k] !== '' ? String(datos[k]) : def);

    // ---------------------------------------------------------------- marco y distribución (Figura 1)
    const M = 10, X0 = M, Y0 = M, X1 = W - M, Y1 = H - M;
    box(X0, Y0, X1, Y1, 'EPM-MARCO');
    const RX0 = X1 - 160;                        // columna derecha de 160 mm (rótulo y sello)
    const ROT = [RX0, Y0, X1, Y0 + 100];        // espacio 1: rótulo 160 × 100 (6.2.3.1)
    const SEL = [RX0, Y0 + 100, X1, Y0 + 170];  // espacio 9: sellos 160 × 70 mínimo (6.2.3.9)
    const resto = Y1 - SEL[3];
    const NOT = [RX0, SEL[3], X1, SEL[3] + resto * 0.5];   // espacio 8: notas
    const UNI = [RX0, NOT[3], X1, Y1];                      // espacio 5: diagrama unifilar
    const yMedio = Y0 + (Y1 - Y0) * 0.42;
    const ancho = RX0 - X0;
    const E2 = [X0, yMedio, X0 + ancho * 0.38, Y1];             // localización
    const E3 = [E2[2], yMedio, E2[2] + ancho * 0.30, Y1];       // diagrama de ubicación geográfica
    const E6 = [E3[2], yMedio, RX0, Y1];                         // convenciones
    const E4 = [X0, Y0, X0 + ancho * 0.62, yMedio];              // vistas complementarias
    const E7 = [E4[2], Y0, RX0, yMedio];                         // cuadro de cargas
    const hT = W >= 840 ? 3.5 : 3.0;
    const titulo = (r, n, nombre, escala) => {
      box(...r);
      T([r[0] + 3, r[3] - 3 - hT], hT, `ESPACIO ${n} - ${nombre}`);
      if (escala) T([r[2] - 3, r[3] - 3 - hT], 2.5, escala, { just: 'D' });
      P.linea([r[0], r[3] - 6 - hT], [r[2], r[3] - 6 - hT], { capa: 'EPM-ESPACIOS' });
      return r[3] - 6 - hT; // y bajo la franja del título
    };
    const y2 = titulo(E2, 2, 'LOCALIZACIÓN', 'ESCALA 1:500');
    const y3 = titulo(E3, 3, W >= 700 ? 'DIAGRAMA DE UBICACIÓN GEOGRÁFICA' : 'UBICACIÓN GEOGRÁFICA', 'ESCALA 1:1000');
    const y6 = titulo(E6, 6, 'CONVENCIONES', null);
    const y4 = titulo(E4, 4, 'VISTAS COMPLEMENTARIAS', 'ESCALAS INDICADAS');
    const y7 = titulo(E7, 7, 'CUADRO DE CARGAS', null);
    const y5 = titulo(UNI, 5, 'DIAGRAMA UNIFILAR', 'SIN ESCALA');
    const y8 = titulo(NOT, 8, 'NOTAS', null);
    box(...SEL);
    T([SEL[0] + 3, SEL[3] - 3 - hT], hT, 'ESPACIO 9 - SELLOS');
    T([SEL[0] + 3, SEL[1] + 3], 2.5, 'Espacio para el sello de aceptación de EPM (160 x 70 mm)');

    // ventanas al modelo (en metros): 1:500 → 2 mm de papel por metro; 1:1000 → 1 mm por metro
    const vent = (r, ytop, mmPorM) => { const w = r[2] - r[0] - 6, h = ytop - r[1] - 6; P.ventana([(r[0] + r[2]) / 2, r[1] + 3 + h / 2], w, h, centroModelo, mmPorM); };
    vent(E2, y2, 2); vent(E3, y3, 1);
    // norte en la localización (6.2.3.2: «incluyendo siempre el norte geográfico»)
    S.definir(D, ['EPM_NORTE']);
    P.insertar('EPM_NORTE', [E2[2] - 12, y2 - 16], { capa: 'EPM-TEXTO' });
    // H6-E: también en la ubicación geográfica (6.2.3.3 a: «Siempre se debe incluir el norte geográfico»)
    P.insertar('EPM_NORTE', [E3[2] - 12, y3 - 16], { capa: 'EPM-TEXTO' });

    // ---------------------------------------------------------------- espacio 6: convenciones (Anexo A, texto ≥ 2,5 mm)
    const CONV = [
      ['Poste de concreto', 'EPM_POSTE_CONCRETO_EX', 'EPM_POSTE_CONCRETO_PR'],
      ['Poste de fibra (PRFV)', 'EPM_POSTE_FIBRA_EX', 'EPM_POSTE_FIBRA_PR'],
      ['Transformador 1 Ø', 'EPM_TRAFO_1F_EX', 'EPM_TRAFO_1F_PR'],
      ['Transformador 3 Ø 13,2 kV', 'EPM_TRAFO_3F_EX', 'EPM_TRAFO_3F_PR'],
      ['Línea primaria aérea desnuda', 'EPM_RED_MT_DESNUDA_EX', 'EPM_RED_MT_DESNUDA_PR'],
      ['Cable cubierto primario', 'EPM_RED_MT_CUBIERTO_EX', 'EPM_RED_MT_CUBIERTO_PR'],
      ['Línea secundaria trenzada', 'EPM_RED_BT_TRENZADA_EX', 'EPM_RED_BT_TRENZADA_PR'],
      ['Secundario subterráneo', 'EPM_RED_BT_SUBTERRANEO_EX', 'EPM_RED_BT_SUBTERRANEO_PR'],
      ['Bajante', 'EPM_BAJANTE_EX', 'EPM_BAJANTE_PR'],
      ['Caja de inspección', 'EPM_CAJA_DISTRIBUCION_EX', 'EPM_CAJA_DISTRIBUCION_PR'],
      ['Cortacircuito con fusible', 'EPM_CORTACIRCUITO_EX', 'EPM_CORTACIRCUITO_PR'],
      ['DPS', 'EPM_DPS_EX', 'EPM_DPS_PR'],
      ['Gabinete de medida', 'EPM_GABINETE_MEDIDA_EX', 'EPM_GABINETE_MEDIDA_PR'],
      ['Puesta a tierra', 'EPM_PUESTA_TIERRA', null],
      ['Punto de conexión «A»', 'EPM_PUNTO_A', null],
      ['Retirar', 'EPM_RETIRAR', null],
    ];
    S.definir(D, CONV.flatMap((c) => c.slice(1)).filter(Boolean));
    {
      const r = E6, wC = r[2] - r[0]; const cE = r[0] + wC * 0.52, cP = r[0] + wC * 0.76;
      let y = y6 - 7;
      T([r[0] + 3, y], 2.5, 'DEFINICIÓN', { capa: 'EPM-CONVENCIONES' }); T([cE, y], 2.5, 'EXISTENTE', { capa: 'EPM-CONVENCIONES' }); T([cP, y], 2.5, 'PROYECTADA', { capa: 'EPM-CONVENCIONES' });
      const fh = Math.min(13, (y - r[1] - 14) / CONV.length);
      y -= 4;
      for (const [txt, ex, pr] of CONV) {
        y -= fh;
        T([r[0] + 3, y - 1.25], 2.5, txt, { capa: 'EPM-CONVENCIONES' });
        const red = ex.startsWith('EPM_RED_');
        const sx = red ? 0.75 : 1;
        P.insertar(ex, [cE + (red ? 0 : 4), y], { capa: 'EPM-CONVENCIONES', escala: sx, atributos: { ALTURA: 'Altura', CARGA: 'kgf', KVA: 'kVA', TIPO: 'RS3' } });
        if (pr) P.insertar(pr, [cP + (red ? 0 : 4), y], { capa: 'EPM-CONVENCIONES', escala: sx, atributos: { ALTURA: 'Altura', CARGA: 'kgf', KVA: 'kVA', TIPO: 'RS3' } });
        else T([cP + 4, y - 1.25], 2.5, '(igual)', { capa: 'EPM-CONVENCIONES' });
      }
      T([r[0] + 3, r[1] + 3], 2.5, 'Símbolos según NC-RA8-001 Anexo A (biblioteca Domoplano)', { capa: 'EPM-CONVENCIONES' });
    }

    // ---------------------------------------------------------------- espacio 7: cuadro de cargas (6.2.3.7)
    {
      const r = E7; const w = r[2] - r[0] - 6; const x = r[0] + 3;
      T([x, y7 - 6], 2.5, `TIPO DE CARGA: ${dato('tipoCarga', Q + ' (residencial y estrato, comercial o industrial)')}`, { capa: 'EPM-TABLAS' });
      // H6-E: columnas de la Figura 27/29 (6.2.3.7) + la distancia de cada alimentador (patrón Praga, nota 25)
      // encabezado en dos renglones para que quepa también en A2
      const cols = [[['TRANS.', 'Nº'], 0.12], [['kVA', 'TRANS.'], 0.13], [['Nº', 'INST.'], 0.11], [['kVA/', 'INST.'], 0.13], [['kVA', 'TOTAL'], 0.13], [['%', 'CARGA'], 0.12], [['DIST.', '(m)'], 0.12], [['%', 'REG.'], 0.14]];
      const top = y7 - 10, fh = 7, hh = 11, nf = 6, bot = top - hh - fh * nf;
      P.rect(x, bot, x + w, top, { capa: 'EPM-TABLAS' });
      for (let i = 0; i < nf; i++) P.linea([x, top - hh - fh * i], [x + w, top - hh - fh * i], { capa: 'EPM-TABLAS' });
      let cx = x;
      cols.forEach(([[t1, t2], f], i) => {
        if (i) P.linea([cx, top], [cx, bot], { capa: 'EPM-TABLAS' });
        T([cx + 1.2, top - 4.2], 2.5, t1, { capa: 'EPM-TABLAS' }); T([cx + 1.2, top - 8.4], 2.5, t2, { capa: 'EPM-TABLAS' });
        cx += w * f;
      });
      T([x + 1.2, bot + 2.2], 2.5, 'TOTAL', { capa: 'EPM-TABLAS' });
    }

    // ---------------------------------------------------------------- espacio 8: notas (Anexo B y carta de factibilidad)
    T([NOT[0] + 3, y8 - 6], 2.5, 'Notas del Anexo B (NC-RA8-001) y de la carta de factibilidad:', { capa: 'EPM-TEXTO' });
    T([NOT[0] + 3, y8 - 11], 2.5, `1. ${Q}`, { capa: 'EPM-TEXTO' });

    // ---------------------------------------------------------------- espacio 1: rótulo 160 × 100 (Figura 4, campos a–l)
    // H4: el rótulo es un BLOQUE «EPM_ROTULO» con ATRIBUTOS (se llenan todos de una vez con el comando ROTULO).
    const [rx, ry] = [ROT[0], ROT[1]];
    const RB = D.bloque('EPM_ROTULO', { base: [0, 0], desc: 'Rótulo EPM 160 x 100 mm (NC-RA8-001 Figura 4) con atributos — Domoplano' });
    const oR = { capa: 'EPM-ROTULO' };
    const R = (x0, y0, x1, y1) => RB.rect(x0, y0, x1, y1, oR);
    const RT = (x, y, h, s2, just = 'I') => RB.texto([x, y], h, s2, { ...oR, just });
    const AT = (tag, prompt, def, x, y, h, just = 'I') => RB.atributo(tag, prompt, def, [x, y], h, { ...oR, just });
    R(0, 0, 160, 100);
    // a) proyecto (nombre, dirección y municipio)
    R(0, 85, 160, 100); RT(2, 95.5, 2.0, 'PROYECTO:');
    AT('PROYECTO', 'Nombre del proyecto', Q + ' NOMBRE DEL PROYECTO', 80, 92, 2.5, 'C'); AT('DIRECCION', 'Dirección - municipio', Q + ' DIRECCIÓN - MUNICIPIO', 80, 87.3, 2.0, 'C');
    // b) firma que diseña y presenta
    R(0, 70, 160, 85); RT(2, 80.5, 2.0, 'FIRMA QUE DISEÑA Y PRESENTA:');
    AT('FIRMA', 'Firma que diseña y presenta', Q + ' NOMBRE', 80, 77, 2.5, 'C'); AT('FIRMA_CONTACTO', 'Contacto de la firma', `${Q} DIRECCIÓN - CONTACTO - E-MAIL - NIT/CC`, 80, 72.3, 2.0, 'C');
    // c) propietario
    R(0, 55, 160, 70); RT(2, 65.5, 2.0, 'PROPIETARIO O USUARIO:');
    AT('PROPIETARIO', 'Propietario o usuario', Q + ' NOMBRE', 80, 62, 2.5, 'C'); AT('PROPIETARIO_CONTACTO', 'Contacto del propietario', `${Q} DIRECCIÓN - CONTACTO - E-MAIL - NIT/CC`, 80, 57.3, 2.0, 'C');
    // d) consecutivo · e) contiene · f) diseñó · g) dibujó (columna izquierda de 80 mm)
    R(0, 47, 80, 55); RT(2, 52, 2.0, 'CONSECUTIVO DE IDENTIFICACIÓN:'); AT('CONSECUTIVO', 'Consecutivo de identificación', Q, 2, 48.3, 2.5);
    R(0, 31, 80, 47); RT(2, 43.5, 2.0, 'CONTIENE:'); AT('CONTIENE', 'Contiene (tipo de proyecto)', Q + ' TIPO DE PROYECTO (DR1 a DR11)', 2, 38.5, 2.5);
    R(0, 20, 80, 31); RT(2, 27.5, 2.0, 'DISEÑÓ:'); AT('DISENO', 'Diseñó', Q, 2, 22.3, 2.5);
    R(0, 9, 80, 20); RT(2, 16.5, 2.0, 'DIBUJÓ:'); AT('DIBUJO', 'Dibujó', Q, 2, 11.3, 2.5);
    // contrato (franja de 8 mm) y f) firma escaneada (derecha)
    R(80, 47, 160, 55); RT(82, 52, 2.0, 'CONTRATO:'); AT('CONTRATO', 'Contrato', Q, 82, 48.3, 2.5);
    R(80, 22, 160, 47); RT(82, 43.5, 2.0, 'FIRMA:');
    R(80, 9, 140, 22); RT(82, 18.5, 2.0, 'MATRÍCULA PROFESIONAL:'); AT('MATRICULA', 'Matrícula profesional', Q, 82, 12.3, 2.5);
    // k) numeración n/p con diagonal (plancha X de Y)
    R(140, 0, 160, 22); RB.linea([140, 0], [160, 22], oR);
    AT('PLANCHA', 'Plancha número', '01', 142, 14.5, 3.5); AT('TOTAL', 'De (total de planchas)', '01', 158, 3, 3.5, 'D');
    // l) SN · h) escala · i) fecha · j) proyección (fila de abajo)
    R(0, 0, 62, 9); RT(2, 3.2, 2.0, 'SN:'); AT('SN', 'SN (campo de EPM)', 'CAMPO DE EPM', 9, 3.2, 2.2);
    R(62, 0, 92, 9); RT(63.5, 3.2, 2.0, 'ESCALA:'); AT('ESCALA', 'Escala', 'INDICADA', 76.5, 3.2, 2.2);
    R(92, 0, 122, 9); RT(93.5, 3.2, 2.0, 'FECHA:'); AT('FECHA', 'Fecha', Q, 104, 3.2, 2.2);
    R(122, 0, 140, 9);
    proyeccion(RB, 131, 4.5);
    const dir = datos.direccion || datos.municipio ? `${dato('direccion', Q + ' DIRECCIÓN')} - ${dato('municipio', Q + ' MUNICIPIO')}` : Q + ' DIRECCIÓN - MUNICIPIO';
    P.insertar('EPM_ROTULO', [rx, ry], { capa: 'EPM-ROTULO', atributos: {
      PROYECTO: dato('proyecto', Q + ' NOMBRE DEL PROYECTO'), DIRECCION: dir, FIRMA: dato('firma', Q + ' NOMBRE'),
      FIRMA_CONTACTO: dato('firmaContacto', `${Q} DIRECCIÓN - CONTACTO - E-MAIL - NIT/CC`), PROPIETARIO: dato('propietario', Q + ' NOMBRE'),
      PROPIETARIO_CONTACTO: dato('propietarioContacto', `${Q} DIRECCIÓN - CONTACTO - E-MAIL - NIT/CC`), CONSECUTIVO: dato('consecutivo'),
      CONTIENE: dato('contiene', Q + ' TIPO DE PROYECTO (DR1 a DR11)'), DISENO: dato('diseno'), DIBUJO: dato('dibujo'), CONTRATO: dato('contrato'),
      MATRICULA: dato('matricula'), PLANCHA: dato('n', '01'), TOTAL: dato('p', '01'), SN: dato('sn', 'CAMPO DE EPM'), ESCALA: dato('escala', 'INDICADA'), FECHA: dato('fecha'),
    } });
    D.limitesModelo = [centroModelo[0] - 200, centroModelo[1] - 150, centroModelo[0] + 200, centroModelo[1] + 150];
    return D.toString();
  }

  /** Símbolo del método de proyección del tercer cuadrante (6.2.3.1 j), como lo muestra la propia norma EPM en su
   *  cajetín: círculos concéntricos a la izquierda y cono truncado a la derecha con el lado angosto hacia los círculos. */
  function proyeccion(P, cx, cy) {
    const o = { capa: 'EPM-ROTULO' };
    const r = 2.6, xc = cx - 4.2; // P puede ser la plancha o el bloque del rótulo
    P.circulo([xc, cy], r, o); P.circulo([xc, cy], r * 0.5, o);
    P.linea([xc - r - 0.8, cy], [xc + r + 0.8, cy], o); P.linea([xc, cy - r - 0.8], [xc, cy + r + 0.8], o);
    const e0 = xc + r + 1.6, e1 = e0 + 5.4;
    P.polilinea([[e0, cy - r * 0.5], [e1, cy - r], [e1, cy + r], [e0, cy + r * 0.5]], { ...o, cerrada: true });
  }

  return { generar, HOJAS };
})();
if (typeof module !== 'undefined') module.exports = PlantillaEPM; else self.PlantillaEPM = PlantillaEPM;
