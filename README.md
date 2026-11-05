# ⚡ DomoPlano

> **Motor CAD Autónomo, Headless y Servidor MCP para Diseños Eléctricos de Distribución, Media/Baja Tensión y Normativa EPM / RETIE / NTC 2050.**  
> *Desarrollado por el Ing. Sebastián Muñoz (DOMOTEX Ingeniería) como software libre y agente autónomo de ingeniería eléctrica.*

[![Licencia](https://img.shields.io/badge/Licencia-MIT-blue.svg)](LICENSE)
[![Protocolo MCP](https://img.shields.io/badge/MCP-JSON--RPC%202.0-orange.svg)](mcp/)
[![Pruebas](https://img.shields.io/badge/Pruebas-882%20OK%20%2F%200%20Fallas-brightgreen.svg)](tests/)
[![Compatibilidad](https://img.shields.io/badge/EPM-NC--RA8--001-blueviolet.svg)](plantillas/epm/)

---

## 🎯 ¿Qué es DomoPlano?

**DomoPlano** es una plataforma CAD de ingeniería eléctrica diseñada específicamente para **Agentes de Inteligencia Artificial (IAs autónomas)** y profesionales de la ingeniería. Permite generar, auditar, transformar y validar planos eléctricos completos (Media Tensión, Baja Tensión, Subestaciones en Poste, Redes Aéreas y Residencial) **sin necesidad de licencias privativas de AutoCAD**, consumiendo 0 tokens en procesamiento geométrico y ejecutándose al 100% de forma local y ultrarrápida.

---

## 🚀 Capacidades Principales

1. **Servidor MCP Nativo (Model Context Protocol):**
   - Expone **24 herramientas CAD de precisión** vía stdio (JSON-RPC 2.0) compatibles con Antigravity, Claude, Gemini y ChatGPT.
   - Permite a cualquier agente dibujar líneas, polilíneas, arcos, círculos, textos, tramas sólidas, cuadros de carga, acotaciones y simbología con un solo llamado de herramienta.

2. **Pipeline Multi-Formato Vectorial Puro:**
   - **DXF:** Lectura y escritura estricta R2000 a R2018 con ezdxf y motor nativo JavaScript.
   - **DWG:** Conversión bidireccional mediante el puente desacoplado LibreDWG.
   - **DWF / DWFx:** Generación nativa de streams binarios DWF V06.00 y empaquetado OPC estándar (XPS) exigido por EPM para radicación oficial.
   - **PDF:** Exportación vectorial de planchas A0 y A1 (260 DPI) con capas independientes, textos vectoriales buscables y cero fuentes faltantes.

3. **Validador de Normativa EPM (NC-RA8-001) y RETIE 40284:**
   - Auditoría automatizada de los **8 Espacios Reglamentarios de la Plancha EPM**:
     - Espacio 1: Planta General y Trazado de Red.
     - Espacio 2: Diagrama Unifilar y Cuadro de Cargas.
     - Espacio 3: Cuadro de Coordenadas y Puntos de Conexión.
     - Espacio 4: Notas Generales y Obligaciones Técnicas.
     - Espacio 5: Memorias y Especificaciones de Materiales.
     - Espacio 6: Convenciones Normalizadas (Símbolo Existente vs Símbolo Proyectado).
     - Espacio 7: Detalles Constructivos y Estructuras (DR5/DR6/Centros de Transformación).
     - Espacio 8: Rótulo Oficial EPM con sellos y escalas normativas.

4. **Algoritmo de Cero Colisiones (Zero-Collision Spatial Engine):**
   - Indexación espacial jerárquica con árboles AABB (Axis-Aligned Bounding Box).
   - Detección y corrección automática de solapamiento: texto sobre línea, texto sobre texto, y textos que invaden márgenes de recuadros o tuberías.

---

## 📂 Estructura del Repositorio

```bash
Domoplano/
├── cli/                 # Herramientas de línea de comandos para conversión y validación
│   ├── dwg_a_dxf.js     # Conversión rápida DWG -> DXF
│   ├── dxf_a_dwf.js     # Conversor a DWF binario V06.00
│   ├── dxf_a_pdf.js     # Renderizador vectorial a PDF Planchas A0/A1
│   ├── generar_epm.js   # Generador maestro de planchas normalizadas
│   ├── validar_epm.js   # Validador de cumplimiento de pliegos y normas EPM
│   └── verificar.js     # Detector de colisiones espaciales
├── mcp/                 # Servidor Model Context Protocol (MCP) para Agentes IA
│   ├── canal_app.js     # Puente de comunicación IPC con la aplicación de escritorio
│   ├── cliente.mjs      # Cliente de pruebas JSON-RPC
│   ├── motor.js         # Motor CAD headless para ejecución en memoria
│   ├── permisos.js      # Sandbox y control de acceso a rutas del sistema
│   ├── server.js        # Punto de entrada ejecutable para Antigravity / Claude
│   └── servidor.js      # Implementación de las 24 herramientas CAD
├── web/                 # Motor de renderizado Canvas / WebGL y biblioteca de geometría
│   ├── cad.js           # Estado global y despachador de comandos
│   ├── dibujo.js        # Renderizado de primitivas vectoriales
│   ├── geom.js          # Aritmética geométrica de alta velocidad
│   ├── simbolos_epm.js  # Catálogo vectorial de estructuras y aparamenta EPM
│   └── index.html       # Interfaz visual de alta velocidad
├── mac/                 # Aplicación nativa macOS (Swift + WebKit)
│   ├── main.swift       # Shell nativo Cocoa
│   └── build.sh         # Script de compilación a Domoplano.app
├── plantillas/          # Plantillas oficiales EPM (F123, F124, F125, DR5, DR6)
└── tests/               # 14 Suites de pruebas automatizadas unitarias y de integración
```

---

## 🛠️ Instalación y Uso Rápido

### Requisitos
- **Node.js:** Versión 18.0 o superior.
- **Python 3:** Versión 3.9+ (opcional, para verificación cruzada con `ezdxf` y `matplotlib`).
- **macOS / Linux:** Soporte multiplataforma completo.

### Instalación
```bash
git clone https://github.com/sebastianmunoz/domoplano.git
cd domoplano
```

### Ejecutar Pruebas de Calidad
```bash
npm test
# Ejecuta las 14 suites (882 pruebas: geometría, colisiones, formatos, MCP y EPM)
```

---

## 🤖 Integración con Agentes IA (Configuración MCP)

Para conectar DomoPlano a **Antigravity**, **Claude Desktop** o **Gemini**:

Agregue el siguiente bloque a su archivo `mcpServers` (`claude_desktop_config.json` o configuración de Antigravity):

```json
{
  "mcpServers": {
    "domoplano": {
      "command": "node",
      "args": [
        "/ruta/a/domoplano/mcp/server.js"
      ]
    }
  }
}
```

### Catálogo de Herramientas Disponibles para la IA:
| Herramienta | Descripción |
| :--- | :--- |
| `status` | Consulta el estado del motor CAD, capas activas y memoria. |
| `new_drawing` | Inicializa un nuevo plano en blanco o basado en plantilla EPM. |
| `open_drawing` | Carga un plano DXF o DWG existente para edición o inspección. |
| `draw_line` | Dibuja segmentos de línea especificando coordenadas $(x_1, y_1)$ a $(x_2, y_2)$ y capa. |
| `draw_polyline` | Dibuja polilíneas abiertas o cerradas para ruteo de circuitos o redes. |
| `draw_circle` | Dibuja postes, cajas de paso, pozos de inspección y nodos. |
| `draw_arc` | Dibuja abatimiento de puertas, flechas de conductores y tubería en techo. |
| `draw_text` / `draw_mtext` | Inserta textos con rotulado calibrado (1.15 a 1.95 mm) y política de cero colisión. |
| `draw_hatch` | Aplica tramas sólidas o normativas a muros y áreas técnicas. |
| `draw_table` | Genera cuadros de carga y especificaciones técnicas balanceadas. |
| `insert_symbol` | Inserta bloques normalizados EPM (transformadores, crucetas, seccionadores). |
| `verify` | Ejecuta la auditoría integral de cero colisiones y normativas EPM. |
| `export_pdf` / `export_dwf` | Compila los archivos finales para radicación oficial en minutos. |

---

## 📜 Licencia

Distribuido bajo la Licencia **MIT**. Consulte `LICENSE` para más información.  
El conector opcional de LibreDWG se ejecuta como un proceso aislado respetando su licencia GPLv3.

---

## 👤 Autor
**Ing. Sebastián Muñoz**  
DOMOTEX Ingeniería — Colombia  
Especialista en Sistemas de Distribución Eléctrica y Automatización con Inteligencia Artificial.
