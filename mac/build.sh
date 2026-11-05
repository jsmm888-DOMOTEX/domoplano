#!/bin/bash
# Compila e instala "Domoplano.app" (no cambia la app predeterminada de ningún tipo de archivo)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
BUILD="$ROOT/build"
APP="$BUILD/Domoplano.app"
DEST_DIR="${DEST_DIR:-/Applications}"
[ -w "$DEST_DIR" ] || DEST_DIR="$HOME/Applications"
mkdir -p "$BUILD" "$DEST_DIR"

echo "→ Compilando…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/Domoplano" main.swift dwg.swift \
  -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers -target arm64-apple-macos13.0
cp Info.plist "$APP/Contents/Info.plist"
cp -R "$ROOT/web" "$APP/Contents/Resources/web"
# H6-D: LibreDWG (GNU, GPLv3) como programas aparte para abrir DWG; se copian con su licencia (uso interno DOMOTEX)
LDWG="$ROOT/vendor/libredwg/instalado/bin"
if [ -x "$LDWG/dwg2dxf" ]; then
  mkdir -p "$APP/Contents/Resources/libredwg"
  cp "$LDWG/dwg2dxf" "$LDWG/dxf2dwg" "$LDWG/dwgread" "$APP/Contents/Resources/libredwg/"
  cp "$ROOT/vendor/libredwg/fuente/libredwg-0.14/COPYING" "$APP/Contents/Resources/libredwg/COPYING-GPLv3" 2>/dev/null || true
else
  echo "  (aviso: no está LibreDWG en vendor/libredwg/instalado: la app no podrá abrir DWG)"
fi

echo "→ Ícono…"
if [ ! -f "$BUILD/AppIcon.icns" ]; then
  TMP="$(mktemp -d)"; mkdir "$TMP/AppIcon.iconset"
  swift make-icon.swift "$TMP/icon1024.png"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/icon1024.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    d=$((s*2)); sips -z $d $d "$TMP/icon1024.png" --out "$TMP/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$TMP/AppIcon.iconset" -o "$BUILD/AppIcon.icns"
  rm -rf "$TMP"
fi
cp "$BUILD/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "→ Instalando en $DEST_DIR…"
pkill -x Domoplano 2>/dev/null || true
rm -rf "$DEST_DIR/Domoplano.app"
cp -R "$APP" "$DEST_DIR/"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREG" -f "$DEST_DIR/Domoplano.app"
echo "✓ Listo: $DEST_DIR/Domoplano.app"
