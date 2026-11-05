# -*- coding: utf-8 -*-
"""Domoplano - prepara los DXF de prueba del verificador y las respuestas de referencia del script Python.
Se corrió UNA vez el 29-10-2026 (mientras AutoCAD seguía instalado, porque el script Python mide con romans.shx).
Los resultados quedan en tests/datos/ref_python_*.txt; tests/epmtest.js los compara con el verificador JS (web/verificador.js).
No toca nada fuera de tests/: lee la COPIA tests/datos/TDC_v3.dxf.
Uso: python3 tests/crear_casos_verificador.py
"""
import os, sys, subprocess, shutil
import ezdxf

AQUI = os.path.dirname(os.path.abspath(__file__))
DAT = os.path.join(AQUI, "datos")
PY = "/Users/sebastianmunoz/Documents/Claude/Obsidian - 1/Claude code - 1/Proyectos de redes/Tienda del Café/scripts/tdc_verificar_plano.py"

# ---------------------------------------------------------------- 1) casos sinteticos, uno por regla, bien separados
doc = ezdxf.new("R2010", setup=False)
doc.units = 4
doc.styles.new("E2", dxfattribs={"font": "romans.shx"})
lay = doc.layouts.new("CASOS")
lay.page_setup(size=(1189, 841), margins=(0, 0, 0, 0), units="mm")
T = lambda x, y, s, h=2.5, **k: lay.add_text(s, height=h, dxfattribs={"style": "E2", **k}).set_placement((x, y))
# marco de la hoja a 10 mm (como un plano)
lay.add_lwpolyline([(10, 10), (1179, 10), (1179, 831), (10, 831)], close=True)
# A) texto limpio, lejos de todo (no debe salir)
T(100, 700, "TEXTO LIMPIO SIN CHOQUES")
# B) TEXTO-TEXTO: dos textos uno encima del otro
T(100, 600, "PRIMER TEXTO MONTADO"); T(102, 600.8, "SEGUNDO TEXTO")
# C) TEXTO-TRAZO: una linea vertical que atraviesa el texto
T(300, 600, "TEXTO CRUZADO POR LINEA"); lay.add_line((305, 590), (305, 610))
# D) TEXTO-RELLENO: texto sobre un solido
T(500, 600, "TEXTO SOBRE RELLENO")
h = lay.add_hatch(); h.paths.add_polyline_path([(498, 598), (520, 598), (520, 605), (498, 605)], is_closed=True)
# E) TEXTO-BORDE DE HOJA: texto que se sale por arriba
T(700, 838, "TEXTO FUERA DE LA HOJA")
# F) LLAMADA-CRUZA: llamada (2 puntos + punto relleno) que atraviesa un simbolo (circulo cerrado)
lay.add_circle((150, 450), 2.0)
lay.add_lwpolyline([(130, 450), (170, 450)]); lay.add_circle((170, 450), 0.3)
# G) llamada limpia (no debe salir)
lay.add_lwpolyline([(130, 400), (170, 400)]); lay.add_circle((170, 400), 0.3)
# H) alturas: 1,5 mm (< 2,0) y 2,2 mm (< 2,5)
T(300, 450, "NOTA DE 1,5 mm", 1.5); T(300, 420, "NOTA DE 2,2 mm", 2.2)
# I) texto girado 90 grados cruzado por una linea horizontal
t = T(600, 400, "TEXTO GIRADO", rotation=90); lay.add_line((590, 405), (610, 405))
# J) texto centrado (halign 1 + valign 2) montado sobre un circulo
lay.add_text("CENTRADO", height=2.5, dxfattribs={"style": "E2"}).set_placement((800, 400), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
lay.add_circle((800, 400), 3.0)
# K) simbolo insertado como bloque (poste) con un texto encima
b = doc.blocks.new("POSTE_PRUEBA"); b.add_circle((0, 0), 2.0); b.add_line((-2, 0), (2, 0))
lay.add_blockref("POSTE_PRUEBA", (900, 600)); T(899, 599, "POSTE")
casos = os.path.join(DAT, "verif_casos.dxf")
doc.saveas(casos)

# ---------------------------------------------------------------- 2) el plano real con 3 textos movidos a proposito
src = ezdxf.readfile(os.path.join(DAT, "TDC_v3.dxf"))
pl = src.layouts.get("PLANO 01 DE 01")
txt = [e for e in pl if e.dxftype() == "TEXT"]
movidos = []
for i in (40, 200, 350):   # tres textos cualesquiera: se montan 1,0 mm abajo-derecha de otro texto
    a, b_ = txt[i], txt[i + 1]
    p = b_.dxf.insert
    a.dxf.insert = (p.x + 1.0, p.y - 0.4)
    if a.dxf.hasattr("align_point"): a.dxf.align_point = (p.x + 1.0, p.y - 0.4)
    a.dxf.halign = 0; a.dxf.valign = 0; a.dxf.rotation = b_.dxf.get("rotation", 0)
    movidos.append(a.dxf.text)
mont = os.path.join(DAT, "TDC_v3_montado.dxf")
src.saveas(mont)
print("movidos:", movidos)

# ---------------------------------------------------------------- 3) respuestas del script Python (referencia)
for f, ref in (("TDC_v3.dxf", "ref_python_TDC_v3.txt"), ("verif_casos.dxf", "ref_python_casos.txt"), ("TDC_v3_montado.dxf", "ref_python_TDC_v3_montado.txt")):
    r = subprocess.run([sys.executable, PY, os.path.join(DAT, f), os.path.join(DAT, ref)], capture_output=True, text=True)
    print(f, "-> salida", r.returncode, "|", r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:])
