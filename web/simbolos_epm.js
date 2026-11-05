// Domoplano — BIBLIOTECA DE SÍMBOLOS EPM (NC-RA8-001, Anexo A «Convenciones», págs. 51–62).
// Cada símbolo lo DIBUJA Domoplano con geometría propia siguiendo la figura de la norma (no se copia ningún bloque de
// plantillas F123/F124/F125 ni nada de Autodesk). Regla general del Anexo A: EXISTENTE = relleno / trazo continuo;
// PROYECTADO = contorno vacío / trazo interrumpido.
// Medidas en mm de PAPEL (escala 1:1 en la plancha). Para insertar en el modelo dibujado en metros a 1:500 use escala 0,5
// (1:1000 → 1,0); en general escala = denominador / 1000.
// Los bloques llevan color y grosor «PorBloque»: toman la capa en que se insertan.
// Los que NO están en el Anexo A (cortacircuito, gabinete, medidor directo/semidirecto, punto «A», electrodo) se marcan
// «convención propia» — la norma lo permite en 6.2.3.6 («podrán agregarse aquellas que no estén contempladas») — y se
// basan en los generadores tdc_*.py del proyecto Tienda del Café (los que EPM ya revisó).
//
// API:
//   SimbolosEPM.lista()                         → [{ bloque, id, nombre, grupo, estado, cita }]
//   SimbolosEPM.definir(dibujo, [bloques])      → define bloques en un DXFGen.Dibujo (todos si no se pasa la lista)
//   SimbolosEPM.trazarRed(lienzo, tipo, estado, puntos, o)  → dibuja una red con su convención (tipos: SimbolosEPM.REDES)
//   SimbolosEPM.biblioteca({ papel })           → texto DXF con todos los bloques y una plancha de convenciones
//   SimbolosEPM.paresBloque(bloque)             → { nombre, base, ents: [[ [código, valor], … ]] } sin handles (para que
//                                                  el editor de la app lo agregue a un plano abierto: INSERTARSIMBOLO)
const SimbolosEPM = (() => {
  const G = (typeof DXFGen !== 'undefined') ? DXFGen : (typeof require !== 'undefined' ? require('./dxf_generador.js') : null);
  const AX = 'NC-RA8-001 Anexo A';
  const PROPIA = 'Convención propia (NC-RA8-001 6.2.3.6 permite agregarla)';
  const HT = 2.5;  // altura de los textos de los símbolos (6.3.1 c: notas y convenciones ≥ 2,5)

  // ---------------------------------------------------------------- contexto de dibujo dentro de un bloque
  function ctx(b) {
    const o = { capa: '0', color: 0 };
    const c = {
      L: (pts, cerrada = false) => (pts.length === 2 && !cerrada ? b.linea(pts[0], pts[1], o) : b.polilinea(pts, { ...o, cerrada })),
      C: (p, r) => b.circulo(p, r, o),
      A: (p, r, a0, a1) => b.arco(p, r, a0, a1, o),
      CF: (p, r) => { b.circuloLleno(p, r, o); b.circulo(p, r, o); },
      F: (pts) => { b.relleno([pts], o); b.polilinea(pts, { ...o, cerrada: true }); },
      /** media luna rellena: semicírculo del lado indicado ('der' | 'izq' | 'arr' | 'aba') */
      HF: (p, r, lado) => {
        const [x, y] = p; const d = { der: [[x, y - r, 1], [x, y + r, 0]], izq: [[x, y + r, 1], [x, y - r, 0]], arr: [[x + r, y, 1], [x - r, y, 0]], aba: [[x - r, y, 1], [x + r, y, 0]] }[lado];
        b.relleno([d], o);
      },
      T: (p, h, s, just = 'I') => b.texto(p, h, s, { ...o, just }),
      ATT: (tag, prompt, def, p, h = HT, just = 'I') => b.atributo(tag, prompt, def, p, h, { ...o, just }),
      /** onda de transformador: dos medias vueltas (∿) centradas en p, de ancho total w */
      onda: (p, w, dy = 0) => { const r = w / 4; c.A([p[0] - r, p[1] + dy], r, 0, 180); c.A([p[0] + r, p[1] + dy], r, 180, 360); },
      /** rayado diagonal de un anillo (poste de fibra) */
      rayasAnillo: (p, r0, r1) => {
        for (let k = -r1 + 0.5; k < r1; k += 0.55) {
          // recta x - y = k recortada al anillo r0 < |q| < r1 (tramos fuera del círculo interior)
          const seg = []; const n = 40;
          for (let i = 0; i <= n; i++) { const t = -r1 + 2 * r1 * i / n; const q = [t + k / 2, t - k / 2]; const d = Math.hypot(q[0], q[1]); seg.push(d <= r1 && d >= r0 ? q : null); }
          let cur = [];
          for (const q of seg.concat([null])) { if (q) cur.push(q); else { if (cur.length > 1) b.linea([p[0] + cur[0][0], p[1] + cur[0][1]], [p[0] + cur[cur.length - 1][0], p[1] + cur[cur.length - 1][1]], o); cur = []; } }
        }
      },
    };
    return c;
  }
  const altura = (c, x) => { c.ATT('ALTURA', 'Altura del poste (m)', 'Altura', [x, 0.3], HT); c.ATT('CARGA', 'Carga de rotura (kgf)', 'kgf', [x, -2.9], HT); };
  const kva = (c, x) => c.ATT('KVA', 'Número y potencia (kVA)', 'No. kVA', [x, -HT / 2], HT);

  // ---------------------------------------------------------------- catálogo
  // estado: 'EX' existente, 'PR' proyectado, '' (igual para los dos). pag = página del Anexo A.
  const R = 1.5; // radio del poste (Ø 3 mm)
  const DEF = [
    // ESTRUCTURAS (pág. 52)
    ['POSTE_CONCRETO', 'Poste de concreto', 'Estructuras', 52, {
      EX: (c) => { c.CF([0, 0], R); altura(c, R + 1); },
      PR: (c) => { c.C([0, 0], R); altura(c, R + 1); } }],
    ['POSTE_METALICO', 'Poste metálico monolítico', 'Estructuras', 52, {
      EX: (c) => { c.C([0, 0], R); c.CF([0, 0], R * 0.45); altura(c, R + 1); },
      PR: (c) => { c.C([0, 0], R); c.C([0, 0], R * 0.45); altura(c, R + 1); } }],
    ['POSTE_METALICO_SECC', 'Poste metálico seccionado', 'Estructuras', 52, {
      EX: (c) => { c.C([0, 0], R); c.CF([0, 0], R * 0.45); c.CF([R * 0.9, R * 0.9], 0.45); altura(c, R + 1.3); },
      PR: (c) => { c.C([0, 0], R); c.C([0, 0], R * 0.45); c.C([R * 0.9, R * 0.9], 0.45); altura(c, R + 1.3); } }],
    ['POSTE_MADERA', 'Poste de madera', 'Estructuras', 52, {
      EX: (c) => { c.C([0, 0], R); c.HF([0, 0], R, 'der'); altura(c, R + 1); },
      PR: (c) => { c.C([0, 0], R); c.L([[0, -R], [0, R]]); altura(c, R + 1); } }],
    ['POSTE_FIBRA', 'Poste de fibra (PRFV) monolítico', 'Estructuras', 52, {
      EX: (c) => { c.C([0, 0], R); c.rayasAnillo([0, 0], R * 0.5, R); c.CF([0, 0], R * 0.5); altura(c, R + 1); },
      PR: (c) => { c.C([0, 0], R); c.rayasAnillo([0, 0], R * 0.5, R); c.C([0, 0], R * 0.5); c.C([0, 0], R * 0.22); altura(c, R + 1); } }],
    ['POSTE_FIBRA_SECC', 'Poste de fibra (PRFV) seccionado', 'Estructuras', 52, {
      EX: (c) => { c.C([0, 0], R); c.rayasAnillo([0, 0], R * 0.5, R); c.CF([0, 0], R * 0.5); c.CF([R * 0.9, R * 0.9], 0.45); altura(c, R + 1.3); },
      PR: (c) => { c.C([0, 0], R); c.rayasAnillo([0, 0], R * 0.5, R); c.C([0, 0], R * 0.5); c.CF([R * 0.9, R * 0.9], 0.45); altura(c, R + 1.3); } }],
    ['TORRECILLA', 'Torrecilla', 'Estructuras', 52, {
      EX: (c) => { c.L([[-R, -R], [R, -R], [R, R], [-R, R]], true); c.L([[-R, -R], [R, R]]); c.L([[-R, R], [R, -R]]); },
      PR: (c) => { for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.L([[sx * R, sy * R], [sx * R * 0.55, sy * R]]); c.L([[sx * R, sy * R], [sx * R, sy * R * 0.55]]); } } }],
    // CONDUCTORES: marcas de número de conductores (pág. 52, existente o proyectada)
    ['MARCA_1F', 'Marca: un conductor de fase', 'Conductores', 52, { '': (c) => { c.L([[-0.8, -1.2], [0.8, 1.2]]); } }],
    ['MARCA_2F', 'Marca: dos conductores', 'Conductores', 52, { '': (c) => { for (const d of [-0.5, 0.5]) c.L([[d - 0.8, -1.2], [d + 0.8, 1.2]]); } }],
    ['MARCA_3F', 'Marca: tres conductores', 'Conductores', 52, { '': (c) => { for (const d of [-1, 0, 1]) c.L([[d - 0.8, -1.2], [d + 0.8, 1.2]]); } }],
    ['MARCA_NEUTRO', 'Marca: conductor de neutro', 'Conductores', 52, { '': (c) => { c.L([[-0.5, -0.75], [0.8, 1.2]]); c.C([-0.7, -1.05], 0.35); } }],
    ['MARCA_TIERRA', 'Marca: conductor de puesta a tierra', 'Conductores', 52, { '': (c) => { c.L([[-0.8, -1.2], [0.8, 1.2]]); c.L([[-0.8, -1.2], [0.6, -1.2]]); } }],
    // BAJANTE (pág. 51)
    ['BAJANTE', 'Bajante', 'Conductores', 51, {
      EX: (c) => { c.L([[-8, 0], [-2.4, 0]]); c.F([[-2.4, 0.7], [-0.9, 0], [-2.4, -0.7]]); c.CF([0, 0], 0.9); },
      PR: (c) => { c.L([[-8, 0], [-2.4, 0]]); c.L([[-2.4, 0.7], [-0.9, 0], [-2.4, -0.7]], true); c.C([0, 0], 0.9); } }],
    // ACOMETIDA PRIMARIA (pág. 54)
    ['ACOMETIDA_PRIMARIA', 'Acometida primaria (voltaje, Nº de fases)', 'Entradas y salidas', 54, {
      EX: (c) => { c.L([[0, 0], [6, 0]]); c.F([[6, 0.6], [16, 0], [6, -0.6]]); },
      PR: (c) => { c.L([[0, 0], [6, 0]]); c.L([[6, 0.6], [16, 0], [6, -0.6]], true); } }],
    // SECCIONAMIENTO (págs. 54, 55 y 62)
    ['CUCHILLA_CERRADA', 'Equipo de desconexión sin carga, cuchilla cerrada', 'Seccionamiento', 54, {
      EX: (c) => { c.CF([-3, 0], 0.5); c.CF([3, 0], 0.5); c.L([[-2.5, 0.1], [2.6, 0.5]]); },
      PR: (c) => { c.C([-3, 0], 0.5); c.C([3, 0], 0.5); c.L([[-2.5, 0.1], [2.6, 0.5]]); } }],
    ['CUCHILLA_ABIERTA', 'Equipo de desconexión sin carga, cuchilla abierta', 'Seccionamiento', 55, {
      EX: (c) => { c.CF([-3, 0], 0.5); c.CF([3, 0], 0.5); c.L([[-2.55, 0.25], [2.6, 2.8]]); },
      PR: (c) => { c.C([-3, 0], 0.5); c.C([3, 0], 0.5); c.L([[-2.55, 0.25], [2.6, 2.8]]); } }],
    ['CORTACIRCUITO', 'Cortacircuito primario con fusible (cuchilla con elemento fusible)', 'Seccionamiento', 0, {
      EX: (c) => { c.CF([-3.5, 0], 0.5); c.CF([3.5, 0], 0.5); c.L([[-3, 0.2], [3.1, 2.2]]); c.L([[-0.9, 0.2], [0.9, 2.2]], false); c.L([[-1.2, 0.6], [1.2, 1.4], [0.9, 2.2], [-0.9, 1.4]], true); },
      PR: (c) => { c.C([-3.5, 0], 0.5); c.C([3.5, 0], 0.5); c.L([[-3, 0.2], [3.1, 2.2]]); c.L([[-1.2, 0.6], [1.2, 1.4], [0.9, 2.2], [-0.9, 1.4]], true); } }],
    ['RECONECTADOR', 'Reconectador automático', 'Seccionamiento', 54, {
      EX: (c) => { c.L([[-2, -2], [2, -2], [2, 2], [-2, 2]], true); c.T([0, 0], HT, 'R', 'MC'); },
      PR: (c) => { for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.L([[sx * 2, sy * 2], [sx * 1, sy * 2]]); c.L([[sx * 2, sy * 2], [sx * 2, sy * 1]]); } c.T([0, 0], HT, 'R', 'MC'); } }],
    ['INTERRUPTOR', 'Interruptor (indicar características)', 'Seccionamiento', 62, {
      '': (c) => { c.L([[-2, -2], [2, -2], [2, 2], [-2, 2]], true); c.T([0, 0], HT, 'I', 'MC'); } }],
    ['INTERRUPTOR_POT_CERRADO', 'Interruptor de potencia cerrado', 'Seccionamiento', 62, {
      '': (c) => { c.L([[-3, -1.6], [3, -1.6], [3, 1.6], [-3, 1.6]], true); c.CF([-1.3, 0], 0.45); c.CF([1.3, 0], 0.45); } }],
    ['INTERRUPTOR_POT_ABIERTO', 'Interruptor de potencia abierto', 'Seccionamiento', 62, {
      '': (c) => { c.L([[-3, -1.6], [3, -1.6], [3, 1.6], [-3, 1.6]], true); c.C([-1.3, 0], 0.45); c.C([1.3, 0], 0.45); } }],
    // TRANSFORMADORES (pág. 55)
    ['TRAFO_1F', 'Transformador 1 Ø, capacidad', 'Transformadores', 55, {
      EX: (c) => { c.C([0, 0], 2.5); c.onda([0, 0], 3.2, 0.45); c.onda([0, 0], 3.2, -0.45); kva(c, 3.5); },
      PR: (c) => { c.C([0, 0], 2.5); kva(c, 3.5); } }],
    ['TRAFO_3F', 'Transformador 3 Ø 13,2 kV, capacidad', 'Transformadores', 55, {
      EX: (c) => { const r = 2.8; c.L([[0, r], [-r * 0.866, -r / 2], [r * 0.866, -r / 2]], true); c.onda([0, -0.2], 2.4, 0.25); c.onda([0, -0.2], 2.4, -0.35); kva(c, 3.5); },
      PR: (c) => { const r = 2.8; c.L([[0, r], [-r * 0.866, -r / 2], [r * 0.866, -r / 2]], true); kva(c, 3.5); } }],
    ['TRAFO_3F_44KV', 'Transformador 3 Ø 44 kV, capacidad', 'Transformadores', 55, {
      EX: (c) => { c.C([0, 0], 2.8); const r = 2.6; c.L([[0, r], [-r * 0.866, -r / 2], [r * 0.866, -r / 2]], true); c.onda([0, -0.1], 2.0, 0.1); kva(c, 3.8); },
      PR: (c) => { c.C([0, 0], 2.8); const r = 2.6; c.L([[0, r], [-r * 0.866, -r / 2], [r * 0.866, -r / 2]], true); kva(c, 3.8); } }],
    ['TRAFO_BIDEVANADO', 'Transformador de potencia bidevanado', 'Transformadores', 61, {
      '': (c) => { c.L([[-7, 0], [-3.4, 0]]); c.C([-1.4, 0], 2); c.C([1.4, 0], 2); c.L([[3.4, 0], [7, 0]]); } }],
    // CAJAS Y CÁMARAS (pág. 56)
    ['CAJA_DISTRIBUCION', 'Caja de distribución, alumbrado público o salida de circuito (caja de inspección)', 'Cajas y cámaras', 56, {
      EX: (c) => { c.F([[-2, -2], [2, -2], [2, 2], [-2, 2]]); c.ATT('TIPO', 'Tipo de caja (RS3, CS-275…)', 'RS3', [3, -HT / 2]); },
      PR: (c) => { c.L([[-2, -2], [2, -2], [2, 2], [-2, 2]], true); c.ATT('TIPO', 'Tipo de caja (RS3, CS-275…)', 'RS3', [3, -HT / 2]); } }],
    ['CAJA_EMPALME', 'Caja de empalme', 'Cajas y cámaras', 56, {
      '': (c) => { c.L([[-2.4, -2], [2.4, -2], [2.4, 2], [-2.4, 2]], true); c.L([[-1.5, -1.3], [1.5, -1.3], [1.5, 1.3], [-1.5, 1.3]], true); c.T([0, 0], 1.8, 'E', 'MC'); c.ATT('TIPO', 'Tipo de caja', 'RS3', [3.4, -HT / 2]); } }],
    ['CAMARA_ACOMETIDA', 'Cámara de acometida primaria', 'Cajas y cámaras', 56, {
      EX: (c) => { c.F([[-2, -2], [2, -2], [2, 2], [-2, 2]]); },
      PR: (c) => { c.L([[-2, -2], [2, -2], [2, 2], [-2, 2]], true); } }],
    // ELEMENTOS DE TABLERO / MEDIDA (pág. 59)
    ['MEDIDOR_CEM', 'Medidor electrónico multifuncional (CEM)', 'Medida', 59, { '': (c) => { c.C([0, 0], 3); c.T([0, 0], 1.8, 'CEM', 'MC'); } }],
    ['MEDIDOR_C', 'Medidor electrónico de energía activa', 'Medida', 59, { '': (c) => { c.C([0, 0], 3); c.T([0, 0], 2, 'C', 'MC'); } }],
    ['MEDIDOR_CME', 'Medidor electrónico multienergía (activa y reactiva)', 'Medida', 59, { '': (c) => { c.C([0, 0], 3); c.T([0, 0.75], 1.5, 'CME', 'MC'); c.T([0, -1.05], 1.5, 'A,R', 'MC'); } }],
    ['MEDIDOR_DIRECTO', 'Medida directa: medidor conectado sin TC', 'Medida', 0, {
      '': (c) => { c.L([[-7, 0], [-3, 0]]); c.C([0, 0], 3); c.T([0, 0], 1.8, 'CME', 'MC'); c.L([[3, 0], [7, 0]]); c.T([0, -5.2], 1.8, 'DIRECTA', 'MC'); } }],
    ['MEDIDOR_SEMIDIRECTO', 'Medida semidirecta: TC en la fase + medidor', 'Medida', 0, {
      '': (c) => { c.L([[-9, 0], [9, 0]]); c.A([-4.5, 0], 1.5, 0, 180); c.A([-1.5, 0], 1.5, 0, 180); c.L([[-3, 1.5], [-3, 4.5]]); c.C([-3, 7.5], 3); c.T([-3, 7.5], 1.8, 'CME', 'MC'); c.T([4.5, 2], 1.8, 'TC', 'I'); } }],
    ['TC', 'Transformador de corriente (relación, clase, VA)', 'Medida', 59, {
      '': (c) => { c.L([[-5, 0], [5, 0]]); c.A([-1.5, 0], 1.5, 0, 180); c.A([1.5, 0], 1.5, 0, 180); c.L([[0, 0], [0, -2.5]]); } }],
    ['TP', 'Transformador de potencial (relación, clase, VA)', 'Medida', 59, {
      '': (c) => { c.L([[-5, 2.5], [-5, -2.5]]); c.L([[-5, 0], [-2.2, 0]]); c.A([-1.2, 1], 1, 270, 90); c.A([-1.2, -1], 1, 270, 90); c.A([1.2, 1], 1, 90, 270); c.A([1.2, -1], 1, 90, 270); c.L([[2.2, 0], [5, 0]]); c.L([[5, 2.5], [5, -2.5]]); } }],
    ['AMPERIMETRO', 'Amperímetro', 'Medida', 59, { '': (c) => { c.C([0, 0], 1.8); c.T([0, 0], 1.8, 'A', 'MC'); } }],
    ['VOLTIMETRO', 'Voltímetro', 'Medida', 59, { '': (c) => { c.C([0, 0], 1.8); c.T([0, 0], 1.8, 'V', 'MC'); } }],
    ['GABINETE_MEDIDA', 'Gabinete de medida y protección', 'Medida', 0, {
      EX: (c) => { c.L([[-5, -3], [5, -3], [5, 3], [-5, 3]], true); c.F([[-5, -3], [-3.6, -3], [-3.6, 3], [-5, 3]]); c.T([0.7, 0], 1.8, 'GM', 'MC'); },
      PR: (c) => { c.L([[-5, -3], [5, -3], [5, 3], [-5, 3]], true); c.L([[-3.6, -3], [-3.6, 3]]); c.T([0.7, 0], 1.8, 'GM', 'MC'); } }],
    // VARIOS (pág. 61)
    ['DPS', 'DPS (descargador de sobretensiones)', 'Varios', 61, {
      EX: (c) => { c.L([[-7, 0], [-3, 0]]); c.L([[-3, -1.5], [3, -1.5], [3, 1.5], [-3, 1.5]], true); c.F([[-2.2, 0.9], [-0.25, 0], [-2.2, -0.9]]); c.F([[2.2, 0.9], [0.25, 0], [2.2, -0.9]]); c.L([[3, 0], [6, 0]]); c.L([[6, 1.5], [6, -1.5]]); c.L([[6.8, 1.1], [6.8, -1.1]]); c.L([[7.6, 0.6], [7.6, -0.6]]); },
      PR: (c) => { c.L([[-7, 0], [-3, 0]]); c.L([[-3, -1.5], [3, -1.5], [3, 1.5], [-3, 1.5]], true); c.L([[-2.2, 0.9], [-0.25, 0], [-2.2, -0.9]], true); c.L([[2.2, 0.9], [0.25, 0], [2.2, -0.9]], true); c.L([[3, 0], [6, 0]]); c.L([[6, 1.5], [6, -1.5]]); c.L([[6.8, 1.1], [6.8, -1.1]]); c.L([[7.6, 0.6], [7.6, -0.6]]); } }],
    ['PUESTA_TIERRA', 'Puesta a tierra', 'Varios', 61, {
      '': (c) => { c.L([[-7, 0], [0, 0]]); c.L([[0, 1.5], [0, -1.5]]); c.L([[0.8, 1.1], [0.8, -1.1]]); c.L([[1.6, 0.6], [1.6, -0.6]]); } }],
    ['ELECTRODO_TIERRA', 'Electrodo de puesta a tierra (vista vertical, RETIE / NC-RA6-010)', 'Varios', 0, {
      '': (c) => { c.L([[0, 0], [0, -3]]); c.L([[-3, -3], [3, -3]]); c.L([[-2, -4], [2, -4]]); c.L([[-1, -5], [1, -5]]); } }],
    ['GENERADOR', 'Planta de generación', 'Varios', 61, { '': (c) => { c.C([0, 0], 2.5); c.T([0, 0], 2, 'G', 'MC'); } }],
    ['CAPACITOR', 'Capacitores', 'Varios', 61, { '': (c) => { c.L([[-6, 0], [-0.6, 0]]); c.L([[-0.6, 2], [-0.6, -2]]); c.L([[0.6, 2], [0.6, -2]]); c.L([[0.6, 0], [6, 0]]); } }],
    ['RETIRAR', 'Señal que indica retirar', 'Varios', 61, { '': (c) => { c.L([[-2.5, -2.5], [2.5, 2.5]]); c.L([[-2.5, 2.5], [2.5, -2.5]]); } }],
    ['PUNTO_A', 'Punto de conexión «A» (derivación autorizada por EPM)', 'Varios', 0, {
      '': (c) => { c.C([0, 0], 3); c.C([0, 0], 2.2); c.T([0, 0], 2.5, 'A', 'MC'); } }],
    ['NORTE', 'Norte geográfico (6.2.3.2: siempre en la localización)', 'Varios', 0, {
      '': (c) => { c.F([[0, 8], [-2.5, -2], [0, 0]]); c.L([[0, 8], [2.5, -2], [0, 0]], true); c.T([0, -5.5], 3, 'N', 'MC'); } }],
  ];
  const nombreBloque = (id, est) => 'EPM_' + id + (est ? '_' + est : '');
  function lista() {
    const out = [];
    for (const [id, nombre, grupo, pag, dib] of DEF) for (const est of Object.keys(dib)) {
      out.push({ bloque: nombreBloque(id, est), id, nombre, grupo, estado: est === 'EX' ? 'existente' : est === 'PR' ? 'proyectado' : 'existente o proyectado',
        cita: pag ? `${AX}, pág. ${pag}` : PROPIA, dibujar: dib[est] });
    }
    return out;
  }

  // ---------------------------------------------------------------- redes (tipos de línea del Anexo A, pág. 51)
  // elementos: ['-', largo] trazo · [' ', largo] espacio · ['.'] punto · ['+', largo] cruz · ['~', largo] onda
  const REDES = {
    MT_DESNUDA: { nombre: 'Línea primaria aérea desnuda (MT)', EX: [['-', 10]], PR: [['-', 3], [' ', 1.5]] },
    MT_CUBIERTO: { nombre: 'Cable cubierto primario (MT semiaislado)', EX: [['-', 5], [' ', 0.8], ['.'], [' ', 0.8], ['.'], [' ', 0.8]], PR: [['+', 1.6], [' ', 1], ['.'], [' ', 0.8], ['.'], [' ', 1]] },
    MT_AISLADO: { nombre: 'Cable aéreo aislado primario', EX: [['-', 5], [' ', 0.8], ['.'], [' ', 0.8]], PR: [['+', 1.6], [' ', 1], ['.'], [' ', 1]] },
    BT_TRENZADA: { nombre: 'Línea secundaria aérea trenzada (BT)', EX: [['~', 3]], PR: [['~', 3], [' ', 1]] },
    BT_ABIERTA: { nombre: 'Línea secundaria aérea abierta (BT)', EX: [['-', 4], [' ', 1.5]], PR: [['-', 3], ['+', 1.6], ['-', 3]] },
    TRANSMISION: { nombre: 'Cable de transmisión', EX: [['-', 5], [' ', 0.8], ['.'], [' ', 0.6], ['.'], [' ', 0.6], ['.'], [' ', 0.6], ['.'], [' ', 0.8]], PR: [['+', 1.6], [' ', 1], ['.'], [' ', 0.6], ['.'], [' ', 0.6], ['.'], [' ', 0.6], ['.'], [' ', 1]] },
    MT_SUBTERRANEO: { nombre: 'Cable primario subterráneo', EX: [['-', 4], [' ', 0.8], ['.'], [' ', 0.6], ['.'], [' ', 0.6], ['.'], [' ', 0.8]], PR: [['+', 1.6], [' ', 1], ['.'], [' ', 0.6], ['.'], [' ', 0.6], ['.'], [' ', 1]] },
    BT_SUBTERRANEO: { nombre: 'Conductor secundario subterráneo (acometida BT)', EX: [['-', 6], [' ', 2]], PR: [['-', 2], [' ', 1], ['+', 1.6], [' ', 1]] },
  };
  /** Dibuja una red con su convención a lo largo de la polilínea `pts` (mm de papel × o.escala para el modelo). */
  function trazarRed(lz, tipo, est, pts, o = {}) {
    const T = REDES[tipo]; if (!T) throw new Error('Tipo de red desconocido: ' + tipo);
    const pat = T[est === 'PR' || est === 'proyectado' ? 'PR' : 'EX'];
    const k = o.escala || 1; const op = { capa: o.capa || '0', color: o.color ?? (lz.tipo === 'bloque' ? 0 : undefined) };
    const segs = []; let tot = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push({ a: pts[i], b: pts[i + 1], s0: tot, L }); tot += L; }
    const at = (s) => { const g = segs.find((q) => s <= q.s0 + q.L + 1e-9) || segs[segs.length - 1]; const t = g.L ? (s - g.s0) / g.L : 0; const u = [(g.b[0] - g.a[0]) / (g.L || 1), (g.b[1] - g.a[1]) / (g.L || 1)]; return { p: [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t], u }; };
    const tramo = (s0, s1) => { const out = [at(s0).p]; for (const g of segs) if (g.s0 > s0 && g.s0 < s1) out.push(g.a); out.push(at(s1).p); return out; };
    if (pat.length === 1 && pat[0][0] === '-') { lz.polilinea(pts.map((q) => [q[0], q[1]]), op); return; }
    let s = 0, guard = 0;
    while (s < tot - 1e-6 && guard++ < 100000) {
      for (const [t, l0] of pat) {
        const l = (l0 || 0) * k; if (s >= tot) break;
        if (t === '-') { const e = Math.min(tot, s + l); const tr = tramo(s, e); if (tr.length === 2) lz.linea(tr[0], tr[1], op); else lz.polilinea(tr, op); s = e; }
        else if (t === ' ') s += l;
        else if (t === '.') { const { p, u } = at(s); const d = 0.12 * k; lz.linea([p[0] - u[0] * d, p[1] - u[1] * d], [p[0] + u[0] * d, p[1] + u[1] * d], op); }
        else if (t === '+') {
          const e = Math.min(tot, s + l); const m = at((s + e) / 2); const h = l / 2;
          lz.linea(at(s).p, at(e).p, op); lz.linea([m.p[0] - m.u[1] * h, m.p[1] + m.u[0] * h], [m.p[0] + m.u[1] * h, m.p[1] - m.u[0] * h], op); s = e;
        } else if (t === '~') {
          const e = Math.min(tot, s + l); const n = 12; const q = []; const A = 0.55 * k;
          for (let i = 0; i <= n; i++) { const si = s + (e - s) * i / n; const { p, u } = at(si); const w = A * Math.sin(Math.PI * 2 * (si - s) / l); q.push([p[0] - u[1] * w, p[1] + u[0] * w]); }
          lz.polilinea(q, op); s = e;
        }
      }
    }
  }

  // ---------------------------------------------------------------- definir bloques en un dibujo
  function definir(D, nombres) {
    const want = nombres ? new Set(nombres.map((n) => n.toUpperCase())) : null;
    const hechos = [];
    for (const s of lista()) {
      if (want && !want.has(s.bloque)) continue;
      if (D.bloques.has(s.bloque)) continue;
      const b = D.bloque(s.bloque, { base: [0, 0], desc: `${s.nombre} (${s.estado}) — ${s.cita}` });
      s.dibujar(ctx(b)); hechos.push(s.bloque);
    }
    for (const [tipo, T] of Object.entries(REDES)) for (const est of ['EX', 'PR']) {
      const n = `EPM_RED_${tipo}_${est}`;
      if ((want && !want.has(n)) || D.bloques.has(n)) continue;
      const b = D.bloque(n, { base: [0, 0], desc: `${T.nombre} (${est === 'EX' ? 'existente' : 'proyectada'}) — ${AX}, pág. 51 (muestra de 24 mm)` });
      trazarRed(b, tipo, est, [[0, 0], [24, 0]]); hechos.push(n);
    }
    return hechos;
  }

  /** Pares de un bloque sin handles: para agregarlo a un plano abierto (integración INSERTARSIMBOLO). */
  function paresBloque(nombre) {
    const D = new G.Dibujo({ papel: [100, 100] });
    definir(D, [nombre]);
    const b = D.bloques.get(nombre.toUpperCase()) || D.bloques.get(nombre); if (!b) return null;
    const txt = D.toString();
    // se extraen las entidades del bloque del DXF generado y se les quitan los códigos 5 y 330 (el editor pone los suyos)
    const L = txt.split('\n'); const P = []; for (let i = 0; i + 1 < L.length; i += 2) P.push([parseInt(L[i], 10), L[i + 1]]);
    let i = P.findIndex(([c, v], k) => c === 0 && v === 'BLOCK' && P.slice(k, k + 12).some(([c2, v2]) => c2 === 2 && v2 === b.nombre));
    const ents = []; let cur = null;
    for (i = i + 1; i < P.length; i++) {
      const [c, v] = P[i];
      if (c === 0) { if (v === 'ENDBLK') break; cur = [[0, v]]; ents.push(cur); continue; }
      if (cur && c !== 5 && c !== 330) cur.push([c, v]);
    }
    return { nombre: b.nombre, base: b.base, desc: b.desc, ents };
  }

  // ---------------------------------------------------------------- biblioteca: DXF con todos los bloques y su cuadro
  function biblioteca({ papel = [841, 594] } = {}) {
    const D = new G.Dibujo({ papel, plancha: 'CONVENCIONES EPM', nombrePapel: `A1 ${papel[0]} x ${papel[1]} mm` });
    D.capa('EPM-CONVENCIONES', { color: 7, grosor: 25 }); D.capa('EPM-MARCO', { color: 7, grosor: 50 });
    definir(D);
    const P = D.plancha; const [W, H] = papel;
    P.rect(10, 10, W - 10, H - 10, { capa: 'EPM-MARCO' });
    P.texto([W / 2, H - 22], 5, 'CONVENCIONES PARA PLANOS DE REDES EPM — NC-RA8-001 ANEXO A', { capa: 'EPM-CONVENCIONES', just: 'C' });
    P.texto([W / 2, H - 30], 2.5, 'Símbolos dibujados por Domoplano según la norma (geometría propia). Bloques EPM_<nombre>_EX (existente) y _PR (proyectado).', { capa: 'EPM-CONVENCIONES', just: 'C' });
    // filas: un renglón por símbolo (existente y proyectado juntos)
    const filas = [];
    for (const [id, nombre, grupo, pag, dib] of DEF) filas.push({ id, nombre, grupo, cita: pag ? `pág. ${pag}` : 'propia', ex: dib.EX ? nombreBloque(id, 'EX') : dib[''] ? nombreBloque(id, '') : null, pr: dib.PR ? nombreBloque(id, 'PR') : null, unico: !!dib[''] });
    for (const [tipo, T] of Object.entries(REDES)) filas.push({ id: tipo, nombre: T.nombre, grupo: 'Redes', cita: 'pág. 51', ex: `EPM_RED_${tipo}_EX`, pr: `EPM_RED_${tipo}_PR`, red: true });
    const COLW = (W - 30) / 2, FH = 14, Y0 = H - 48; const porCol = Math.floor((Y0 - 20) / FH);
    filas.forEach((f, i) => {
      const col = Math.floor(i / porCol), fila = i % porCol; if (col > 1) return;
      const x = 15 + col * COLW, y = Y0 - fila * FH;
      if (fila === 0) {
        for (const [dx, t] of [[0, 'DEFINICIÓN'], [COLW * 0.55, 'EXISTENTE'], [COLW * 0.73, 'PROYECTADA'], [COLW * 0.9, 'ANEXO A']]) P.texto([x + dx, y + 7], 2.5, t, { capa: 'EPM-CONVENCIONES' });
      }
      P.texto([x, y - 1.25], 2.5, f.nombre.length > 60 ? f.nombre.slice(0, 58) + '…' : f.nombre, { capa: 'EPM-CONVENCIONES' });
      const xe = x + COLW * 0.55 + (f.red ? 0 : 6), xp = x + COLW * 0.73 + (f.red ? 0 : 6);
      if (f.ex) P.insertar(f.ex, [xe, y], { capa: 'EPM-CONVENCIONES' });
      if (f.pr) P.insertar(f.pr, [xp, y], { capa: 'EPM-CONVENCIONES' });
      else if (f.unico) P.texto([xp, y - 1.25], 2.5, '(igual)', { capa: 'EPM-CONVENCIONES' });
      P.texto([x + COLW * 0.9, y - 1.25], 2.5, f.cita, { capa: 'EPM-CONVENCIONES' });
    });
    return D.toString();
  }

  return { lista, definir, trazarRed, REDES, biblioteca, paresBloque, nombreBloque };
})();
if (typeof module !== 'undefined') module.exports = SimbolosEPM; else self.SimbolosEPM = SimbolosEPM;
