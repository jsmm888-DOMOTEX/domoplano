// Domoplano — TABLA DE GROSORES DE LÍNEA POR CAPA (planos de redes EPM).
//
// ⚠️ PROPUESTA (29-10-2026) — los valores los decide Sebastián (decisión 3 del PLAN, RA8-001 6.3.1 e).
//    Se puede editar aquí mismo: nombre de la capa (sin importar mayúsculas) → grosor en milímetros.
//    Solo valen los grosores estándar del DXF: 0.05 0.09 0.13 0.15 0.18 0.20 0.25 0.30 0.35 0.40 0.50 0.53 0.60 0.70
//    0.80 0.90 1.00 1.06 1.20 1.40 1.58 2.00 2.11 (otro valor se lleva al más cercano).
//
// Se aplica con el comando GROSORES (en la app): «V» muestra la tabla, «A» la aplica a las capas del plano que estén
// en la tabla, «S» solo a las que no tienen grosor propio. Todo se puede deshacer (⌘Z). Lo que sale en PDF y DWF usa
// el grosor de cada capa (o el del objeto, si se le puso uno con PROPIEDADES).
//
// Criterio de la propuesta: lo PROYECTADO grueso (se ve primero), lo EXISTENTE medio, el urbanismo y la cartografía
// finos, los textos finos (la letra ya tiene su propio peso), y el marco del plano grueso.
const GROSORES_CAPAS = {
  estado: 'PROPUESTA — pendiente de aprobación de Sebastián',
  // nombre exacto de capa → mm
  capas: {
    // marco, rótulo y textos
    MARCO: 0.50, TITULOS: 0.35, TEXTO: 0.18, TABLAS: 0.18, SELLO: 0.25, COTAS: 0.13, EJES: 0.09,
    ROTULO: 0.30, TEXTOS: 0.13, 'CUADRO DE CARGA': 0.25, 'CUADRO DE CONVECIONES': 0.25,
    // urbanismo y cartografía (fondo)
    URB_VIAS: 0.18, URB_ANDEN: 0.13, URB_PARAMENTO: 0.25, URB_VERDE: 0.09, URB_TXT: 0.13,
    VIA: 0.13, CARTOGRAFIA: 0.13, VEGETACION: 0.09, QUEBRADA: 0.13, 'ZONA VERDE': 0.09, 'PLANO ARQ': 0.13,
    // red existente (medio)
    MT_EXIST: 0.35, BT_EXIST: 0.25, AP_EXIST: 0.18, POSTE_EXIST: 0.25, TRAFO_EXIST: 0.35,
    // red proyectada (grueso)
    MT_EPM: 0.50, BT_PROY: 0.40, POSTE_PROY: 0.50, TRAFO_PROY: 0.50, CAJAS: 0.35, MEDIDA: 0.35, RUTA: 0.70,
    REDES: 0.35, POSTE: 0.35, TRAFO: 0.35, ACOMETIDA: 0.35, MEDIDOR: 0.35, 'PUESTA TIERRA': 0.25,
    // textos y detalles eléctricos
    ELEC_TXT: 0.18, TIERRA: 0.25, RETIRO: 0.18,
    DET_CONTORNO: 0.35, DET_FINO: 0.13, DET_OCULTO: 0.18, DET_HATCH: 0.09,
    // unifilar
    UNIFILAR: 0.25, UNI_MT: 0.35, UNI_BT: 0.30,
    // isométricos / cortes
    ISO_FILL: 0.09, ISO_LIN: 0.25, ISO_FINO: 0.13, ISO_OCULTO: 0.13, ISO_TXT: 0.13, CORTE: 0.30,
  },
  // si la capa no está arriba: la primera regla cuyo patrón coincide con el nombre
  reglas: [
    [/PROY/i, 0.40], [/EXIST/i, 0.25], [/TXT|TEXT/i, 0.18], [/COTA/i, 0.13], [/HATCH|SOMBR|FILL/i, 0.09],
  ],
};
if (typeof module !== 'undefined') module.exports = GROSORES_CAPAS; else self.GROSORES_CAPAS = GROSORES_CAPAS;
