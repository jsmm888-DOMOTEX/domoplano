# Abre DXF en AcCoreConsole (motor de AutoCAD, uso normal con licencia, como «caja negra») y NO guarda nada.
# Copia cada DXF a una carpeta temporal antes de abrirlo. Uso: python3 tests/acad_abrir.py a.dxf [b.dxf …]
import subprocess, sys, time, threading, os, shutil, tempfile, re
ACC = '/Applications/Autodesk/AutoCAD 2026/AutoCAD 2026.app/Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole'
if not os.path.exists(ACC):
    print('SIN-ACAD: AcCoreConsole no está instalado'); sys.exit(0)
ok_all = True
for src in sys.argv[1:]:
    tmp = tempfile.mkdtemp(prefix='domoplano_acad_')
    f = os.path.join(tmp, 'prueba' + (os.path.splitext(src)[1].lower() or '.dxf')); shutil.copy(src, f)
    p = subprocess.Popen([ACC, '-i', f], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=tmp)
    buf = []
    threading.Thread(target=lambda: [buf.append(c) for c in iter(lambda: p.stdout.read(1), b'')], daemon=True).start()
    out = lambda: b''.join(buf).decode('utf-8', 'replace').replace('\0', '')
    t0 = time.time()
    while time.time() - t0 < 120 and not re.search(r'(Comando|Command):', out()): time.sleep(0.5)
    code = ('(progn (setq c "" e (tblnext "LAYER" T)) (while e (setq c (strcat c (cdr (assoc 2 e)) "/" (itoa (cdr (assoc 62 e))) "/" (cdr (assoc 6 e)) "; ") e (tblnext "LAYER")))'
            ' (princ (strcat "\\nCAPAS=" c))'
            ' (setq ss (ssget "_X" (list (cons 0 "TEXT")))) (princ (strcat "\\nTEXTOS=" (itoa (if ss (sslength ss) 0))))'
            ' (setq ss (ssget "_X")) (princ (strcat "\\nOBJETOS=" (itoa (if ss (sslength ss) 0))))'
            ' (princ (strcat "\\nESTILO=" (getvar "TEXTSTYLE") " CAPA=" (getvar "CLAYER") " INSUNITS=" (itoa (getvar "INSUNITS"))))'
            ' (princ "\\nCHK-DONE") (princ))\n')
    try: p.stdin.write(code.encode()); p.stdin.flush()
    except BrokenPipeError: pass   # AutoCAD se cerró solo (dibujo que pide RECUPERAR)
    t0 = time.time()
    while time.time() - t0 < 90 and out().count('CHK-DONE') < 2: time.sleep(0.5)
    time.sleep(1)
    try: p.stdin.write(b'_.QUIT\n_N\n'); p.stdin.flush(); time.sleep(2)
    except Exception: pass
    p.kill()
    o = out()
    lines = [l.strip() for l in o.splitlines() if re.search(r'^(CAPAS|TEXTOS|OBJETOS|ESTILO)=|rror|nválid|no válid', l.strip()) and 'acad2026.LSP' not in l]
    abre = any(l.startswith('OBJETOS=') for l in lines)
    ok_all = ok_all and abre
    print(('ABRE  ' if abre else 'NO ABRE ') + os.path.basename(src))
    for l in lines: print('   ', l[:300])
    shutil.rmtree(tmp, ignore_errors=True)
print('TODOS-ABREN' if ok_all else 'ALGUNO-NO-ABRE')
