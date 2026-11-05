# ⚡ DomoPlano

> **Autonomous Headless CAD Engine & Native MCP Server for Electrical Distribution Design, Medium/Low Voltage Engineering, and EPM / RETIE / NTC 2050 Compliance.**  
> *Developed by Eng. Sebastián Muñoz (DOMOTEX Engineering) as open-source software and autonomous engineering agent.*

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Protocol](https://img.shields.io/badge/MCP-JSON--RPC%202.0-orange.svg)](mcp/)
[![Test Suite](https://img.shields.io/badge/Tests-882%20OK%20%2F%200%20Failures-brightgreen.svg)](tests/)
[![Compliance](https://img.shields.io/badge/EPM-NC--RA8--001-blueviolet.svg)](plantillas/epm/)

[📖 **English Version**](#-domoplano---autonomous-cad-engine--mcp-server-for-ai-agents) | [📖 **Versión en Español**](#-domoplano---motor-cad-autónomo-y-servidor-mcp-en-español)

---

## ⚡ DomoPlano - Autonomous CAD Engine & MCP Server for AI Agents

### 🎯 What is DomoPlano?

**DomoPlano** is a high-performance electrical CAD platform designed specifically for **Autonomous AI Agents (LLMs)** and engineering professionals. It enables AI systems to autonomously generate, audit, transform, and validate complete electrical distribution plans (Medium Voltage, Low Voltage, Pole-Mounted Subtransformers, Overhead Networks, and Residential Schematics) **without requiring proprietary AutoCAD licenses**, consuming **0 LLM tokens in geometric computations**, and running 100% locally at up to 20 million operations per second.

---

### 🚀 Key Capabilities

1. **Native Model Context Protocol (MCP) Server:**
   - Exposes **24 precision CAD tools** via stdio (JSON-RPC 2.0) compatible with Antigravity, Claude Desktop, Gemini CLI, and ChatGPT.
   - Allows any AI agent to draw lines, polylines, arcs, circles, texts, solid hatches, load balancing schedules, dimension lines, and utility symbols with a single structured tool call.

2. **Pure Vector Multi-Format Pipeline:**
   - **DXF:** Strict R2000 to R2018 read/write compliance with ezdxf and native high-speed JavaScript parsers.
   - **DWG:** Decoupled bidirectional bridge via LibreDWG without proprietary dependencies.
   - **DWF / DWFx:** Native generation of binary DWF V06.00 streams and standardized OPC (XPS) packaging mandatory for official utility filing (EPM).
   - **PDF:** Vector rendering of A0 and A1 sheet plans (260 DPI) featuring isolated layers, selectable/searchable vector text, and zero missing font artifacts.

3. **Regulatory Audit Engine (EPM NC-RA8-001 & RETIE 40284 / NTC 2050):**
   - Automated verification across all **8 mandatory sheet spaces**:
     - Space 1: General Plan & Network Routing.
     - Space 2: Single-Line Diagram & Balanced Load Schedule.
     - Space 3: Geographic Coordinates & Connection Points.
     - Space 4: General Notes & Technical Obligations.
     - Space 5: Bill of Materials & Technical Specifications.
     - Space 6: Standardized Symbology (Existing vs Projected elements).
     - Space 7: Construction Details & Pole Structures (DR5/DR6/Substations).
     - Space 8: Official Utility Title Block, stamps, and standardized scales.

4. **Zero-Collision Spatial Engine (AABB):**
   - Hierarchical spatial indexing with Axis-Aligned Bounding Box (AABB) trees.
   - Automated detection and resolution of overlapping entities: text-line, text-text, and label collisions against conduits or title block borders.

---

### 📂 Repository Structure

```bash
Domoplano/
├── cli/                 # Command-line tools for conversion, validation, and generation
│   ├── dwg_a_dxf.js     # Fast DWG -> DXF converter
│   ├── dxf_a_dwf.js     # Binary DWF V06.00 compiler
│   ├── dxf_a_pdf.js     # High-resolution vector PDF sheet renderer
│   ├── generar_epm.js   # Automated template and symbol builder
│   ├── validar_epm.js   # NC-RA8-001 regulatory compliance auditor
│   └── verificar.js     # Spatial collision and text overlap detector
├── mcp/                 # Native Model Context Protocol (MCP) server
│   ├── canal_app.js     # IPC bridge for desktop communication
│   ├── cliente.mjs      # Stdio JSON-RPC client
│   ├── motor.js         # In-memory headless CAD engine
│   ├── permisos.js      # Sandbox filesystem permissions controller
│   ├── server.js        # Executable entrypoint for Antigravity & Claude
│   └── servidor.js      # Full implementation of the 24 CAD tools
├── web/                 # Interactive Canvas/WebGL rendering engine
│   ├── cad.js           # Core state machine and command dispatcher
│   ├── dibujo.js        # Vector primitive drawing pipeline
│   ├── geom.js          # High-speed 2D arithmetic and vector math
│   ├── simbolos_epm.js  # Standardized utility symbol library
│   └── index.html       # Web-based high-speed CAD interface
├── mac/                 # Native macOS application wrapper (Swift + WebKit)
│   ├── main.swift       # Cocoa shell
│   └── build.sh         # Domoplano.app compilation script
├── plantillas/          # Official utility sheet templates (F123, F124, F125, DR5, DR6)
└── tests/               # 14 Automated test suites (882 unit and integration tests)
```

---

### 🛠️ Quick Start & Global Installation

#### Prerequisites
- **Node.js:** v18.0 or higher.
- **Python 3:** v3.9+ (optional, for cross-validation with ezdxf / matplotlib).
- **macOS / Linux / Windows**.

#### Installation & Global CLI Setup
```bash
# Clone repository
git clone https://github.com/jsmm888-DOMOTEX/domoplano.git
cd domoplano

# Install and link CLI tools globally
npm install
npm link
```

After linking, the following global commands become immediately available in your terminal:
- `domoplano`: Generate standardized electrical distribution templates.
- `domoplano-validar <file.dxf|file.dwg>`: Run the 16-point EPM NC-RA8-001 audit.
- `domoplano-verificar <file.dxf>`: Detect overlapping texts and line collisions.
- `domoplano-mcp`: Run the native Model Context Protocol server.

#### Run Test Suites
```bash
npm test
# Executes all 14 test suites (882 tests: geometry, collisions, formats, MCP, and EPM)
```

---

### 🤖 AI Agent Integration (MCP Configuration)

To connect **DomoPlano** to **Claude Desktop**, **Antigravity**, **Gemini**, or **ChatGPT**:

Add the server to your `mcpServers` configuration (`claude_desktop_config.json` or Antigravity configuration):

```json
{
  "mcpServers": {
    "domoplano": {
      "command": "domoplano-mcp",
      "args": []
    }
  }
}
```

#### Native MCP Tool Reference:
| Tool | Description |
| :--- | :--- |
| `status` | Returns CAD engine status, memory usage, and active layers. |
| `new_drawing` | Initializes a new drawing in memory or from an official template. |
| `open_drawing` | Loads an existing DXF or DWG file for inspection or editing. |
| `draw_line` | Draws line segments between coordinates $(x_1, y_1)$ and $(x_2, y_2)$. |
| `draw_polyline` | Creates open or closed polylines for circuits and network routing. |
| `draw_circle` | Draws poles, junction boxes, manholes, and electrical nodes. |
| `draw_arc` | Draws door swings, conductor arrows, and curved ceiling conduits. |
| `draw_text` / `draw_mtext` | Inserts calibrated text with zero-collision bounding box validation. |
| `draw_hatch` | Applies solid fills or architectural hatches to walls and structures. |
| `draw_table` | Inserts balanced load schedules and technical specifications. |
| `insert_symbol` | Inserts normalized EPM blocks (transformers, crossarms, cutouts). |
| `verify` | Executes zero-collision spatial audit and regulatory checks. |
| `export_pdf` / `export_dwf` | Compiles official submission files in seconds. |

---

### 📜 License
Distributed under the **MIT License**. See `LICENSE` for details.  
The optional LibreDWG bridge runs as an isolated external process respecting GPLv3 licensing.

---

<br><br>

---

## ⚡ DomoPlano - Motor CAD Autónomo y Servidor MCP (en Español)

### 🎯 ¿Qué es DomoPlano?

**DomoPlano** es una plataforma CAD de ingeniería eléctrica diseñada específicamente para **Agentes de Inteligencia Artificial (IAs autónomas)** y profesionales de la ingeniería. Permite generar, auditar, transformar y validar planos eléctricos completos (Media Tensión, Baja Tensión, Subestaciones en Poste, Redes Aéreas y Residencial) **sin necesidad de licencias privativas de AutoCAD**, consumiendo **0 tokens en procesamiento geométrico** y ejecutándose al 100% de forma local y ultrarrápida.

---

### 🚀 Capacidades Principales

1. **Servidor MCP Nativo (Model Context Protocol):**
   - Expone **24 herramientas CAD de precisión** vía stdio (JSON-RPC 2.0) compatibles con Antigravity, Claude, Gemini y ChatGPT.
   - Permite a cualquier agente dibujar líneas, polilíneas, arcos, círculos, textos, tramas sólidas, cuadros de carga, acotaciones y simbología con un solo llamado estructurado.

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

### 🛠️ Instalación Rápida y Uso CLI

```bash
git clone https://github.com/jsmm888-DOMOTEX/domoplano.git
cd domoplano
npm install
npm link
```

Comandos CLI disponibles en terminal:
- `domoplano`: Generador de plantillas y simbología EPM.
- `domoplano-validar <archivo.dxf|archivo.dwg>`: Auditoría de 16 puntos EPM NC-RA8-001.
- `domoplano-verificar <archivo.dxf>`: Verificación de textos montados y colisiones.
- `domoplano-mcp`: Servidor MCP para comunicación con LLMs.

---

### 👤 Autor
**Ing. Sebastián Muñoz**  
DOMOTEX Ingeniería — Colombia  
Especialista en Sistemas de Distribución Eléctrica y Automatización con Inteligencia Artificial.
