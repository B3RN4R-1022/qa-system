#!/bin/bash
# Nocorp+ QA Agent — Instalador macOS

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     Nocorp+ QA Agent — Instalador        ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Verifica dependências ─────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "  ERRO: Node.js não encontrado."
  echo "  Baixe em: https://nodejs.org (versão 18 ou superior)"
  read -p "  Pressione Enter para sair"; exit 1
fi
echo "  OK  Node.js $(node --version)"

if ! command -v git &>/dev/null; then
  echo "  ERRO: Git não encontrado."
  echo "  Instale com: xcode-select --install"
  read -p "  Pressione Enter para sair"; exit 1
fi
echo "  OK  $(git --version)"

# ── Download via ZIP (sem precisar de auth git) ───────────────────────────────

DEST="$HOME/nocorplus-agent"

echo ""
if [ -d "$DEST" ]; then
  echo "  Atualizando Nocorp+ Agent..."
else
  echo "  Baixando Nocorp+ Agent..."
fi

TMP="$(mktemp -d)"
ZIP="$TMP/qa-system.zip"

curl -fsSL "https://github.com/B3RN4R-1022/qa-system/archive/refs/heads/master.zip" -o "$ZIP"
if [ $? -ne 0 ] || [ ! -f "$ZIP" ]; then
  echo "  ERRO: Falha ao baixar. Verifique sua conexão com a internet."
  rm -rf "$TMP"
  read -p "  Pressione Enter para sair"; exit 1
fi

unzip -q "$ZIP" -d "$TMP"
SRC="$TMP/qa-system-master/nocorplus-agent"

if [ ! -d "$SRC" ]; then
  echo "  ERRO: Estrutura inesperada no arquivo baixado."
  rm -rf "$TMP"
  read -p "  Pressione Enter para sair"; exit 1
fi

# Preserva .env e .session.json ao atualizar
[ -f "$DEST/.env" ]          && cp "$DEST/.env"          "$TMP/save.env"
[ -f "$DEST/.session.json" ] && cp "$DEST/.session.json" "$TMP/save.session.json"

mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"

[ -f "$TMP/save.env" ]          && cp "$TMP/save.env"          "$DEST/.env"
[ -f "$TMP/save.session.json" ] && cp "$TMP/save.session.json" "$DEST/.session.json"

rm -rf "$TMP"
echo "  OK  Pronto em: $DEST"

# ── npm install ───────────────────────────────────────────────────────────────

cd "$DEST"
echo ""
echo "  Instalando dependências (pode levar ~1 min na primeira vez)..."
echo "  Se aparecer prompt de login do GitHub, entre com sua conta."
echo ""
npm install
if [ $? -ne 0 ]; then
  echo ""
  echo "  ERRO: npm install falhou."
  echo "  Verifique se sua conta GitHub tem acesso ao repositório nocorplus."
  read -p "  Pressione Enter para sair"; exit 1
fi
echo "  OK  Dependências instaladas"

# ── .env ──────────────────────────────────────────────────────────────────────

if [ ! -f "$DEST/.env" ]; then
  cp "$DEST/.env.example" "$DEST/.env"
fi

# ── Detecta área de trabalho (suporte a qualquer idioma do macOS) ─────────────

DESKTOP=$(osascript -e 'POSIX path of (path to desktop)' 2>/dev/null | sed 's|/$||')
[ -z "$DESKTOP" ] && DESKTOP="$HOME/Desktop"

# ── Cria ícone N+ via Python ──────────────────────────────────────────────────

ICON_DIR="$DEST/icon.iconset"
mkdir -p "$ICON_DIR"

python3 - <<'PYEOF'
import os, struct, zlib

DEST = os.path.expanduser("~/nocorplus-agent")
OUT  = os.path.join(DEST, "icon.iconset")

def make_png(size):
    r, g, b = 99, 102, 241
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)
    raw = b''.join(b'\x00' + bytes([r, g, b] * size) for _ in range(size))
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

for sz in [16, 32, 64, 128, 256, 512]:
    with open(os.path.join(OUT, f'icon_{sz}x{sz}.png'), 'wb') as f:
        f.write(make_png(sz))
PYEOF

ICNS="$DEST/nocorp.icns"
if command -v iconutil &>/dev/null; then
  iconutil -c icns "$ICON_DIR" -o "$ICNS" 2>/dev/null && echo "  OK  Ícone gerado"
fi
rm -rf "$ICON_DIR"

# ── Cria .app na área de trabalho ─────────────────────────────────────────────

APP="$DESKTOP/Nocorp+ Agent.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>            <string>run</string>
  <key>CFBundleIconFile</key>             <string>AppIcon</string>
  <key>CFBundleIdentifier</key>           <string>com.nocorp.qa-agent</string>
  <key>CFBundleName</key>                 <string>Nocorp+ Agent</string>
  <key>CFBundleVersion</key>              <string>1.0</string>
  <key>CFBundleShortVersionString</key>   <string>1.0</string>
  <key>LSUIElement</key>                  <false/>
</dict>
</plist>
PLIST

[ -f "$ICNS" ] && cp "$ICNS" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/MacOS/run" << 'RUN'
#!/bin/bash
cd ~/nocorplus-agent
osascript - <<'APPLESCRIPT'
tell application "Terminal"
  activate
  if (count of windows) = 0 then
    do script "cd ~/nocorplus-agent && node worker.js"
  else
    do script "cd ~/nocorplus-agent && node worker.js" in window 1
  end if
end tell
APPLESCRIPT
RUN
chmod +x "$APP/Contents/MacOS/run"

# Remove quarantine (evita bloqueio do Gatekeeper na primeira abertura)
xattr -cr "$APP" 2>/dev/null

touch "$APP"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║        Instalação concluída!             ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  App criado na área de trabalho: 'Nocorp+ Agent'"
echo ""
echo "  Para iniciar: clique duas vezes no app"
echo ""
