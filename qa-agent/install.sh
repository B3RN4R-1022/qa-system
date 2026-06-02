#!/bin/bash
# ============================================================
#  Nocorp QA Agent — Instalador macOS
#  Uso: curl -fsSL https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.sh | bash
# ============================================================

set -e

BACKEND_URL="https://qa-system-5vpf.onrender.com"
INSTALL_DIR="$HOME/NocorpQAAgent"
GITHUB_RAW="https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; GRAY='\033[0;37m'; NC='\033[0m'

step() { echo -e "\n  ${CYAN}$1${NC}"; }
ok()   { echo -e "  ✅ ${GREEN}$1${NC}"; }
err()  { echo -e "  ❌ ${RED}$1${NC}"; read -p "  Pressione Enter para sair..."; exit 1; }
info() { echo -e "  ℹ  ${GRAY}$1${NC}"; }

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║        Nocorp QA Agent — Instalador      ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── 1. Python ────────────────────────────────────────────────
step "Verificando Python..."

PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
        MAJOR=$(echo "$VER" | cut -d. -f1)
        MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 11 ]; then
            PYTHON="$cmd"; break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    step "Python 3.11+ não encontrado — tentando instalar via Homebrew..."
    if command -v brew &>/dev/null; then
        brew install python@3.13 || err "Falha ao instalar Python via Homebrew."
        PYTHON="python3"
        ok "Python instalado via Homebrew"
    else
        err "Python 3.11+ não encontrado. Instale em https://www.python.org/downloads/ e rode este script novamente."
    fi
fi

ok "Python: $($PYTHON --version)"

# ── 2. Pasta ─────────────────────────────────────────────────
step "Criando pasta em $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
ok "Pasta criada"

# ── 3. Download dos arquivos ──────────────────────────────────
step "Baixando arquivos do QA Agent..."
FILES=("agent.py" "worker.py" "session.py" "main.py" "requirements.txt" "version.txt")
for file in "${FILES[@]}"; do
    curl -fsSL -H "Cache-Control: no-cache" "$GITHUB_RAW/$file" -o "$INSTALL_DIR/$file" \
        || err "Falha ao baixar $file. Verifique sua conexão."
    ok "Baixado: $file"
done

# ── 4. Ambiente virtual ───────────────────────────────────────
step "Criando ambiente virtual Python..."
rm -rf "$INSTALL_DIR/venv"
"$PYTHON" -m venv "$INSTALL_DIR/venv" || err "Falha ao criar ambiente virtual."
ok "Ambiente virtual criado"

# ── 5. Dependências ───────────────────────────────────────────
step "Instalando dependências (pode demorar 1-2 minutos)..."
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip -q
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt" \
    || err "Falha ao instalar dependências. Veja os erros acima."
ok "Dependências instaladas"

# ── 6. Chromium ───────────────────────────────────────────────
step "Instalando Chromium para automação de navegador..."
"$INSTALL_DIR/venv/bin/python" -m playwright install chromium \
    || err "Falha ao instalar Chromium."
ok "Chromium instalado"

# ── 7. .env ───────────────────────────────────────────────────
step "Configurando conexão com o backend..."
cat > "$INSTALL_DIR/.env" << EOF
BACKEND_URL=$BACKEND_URL
AI_PROVIDER=cerebras
MAX_STEPS=15
EOF
ok "Configuração salva"

# ── 8. Script de inicialização ────────────────────────────────
step "Criando script de inicialização..."
cat > "$INSTALL_DIR/start.sh" << 'STARTSCRIPT'
#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "  Nocorp QA Agent"
echo "  Conectando ao sistema..."
echo "  Mantenha esta janela aberta durante os testes."
echo "  Ctrl+C para encerrar."
echo ""
venv/bin/python worker.py
read -p "  Pressione Enter para fechar..."
STARTSCRIPT
chmod +x "$INSTALL_DIR/start.sh"
ok "Script criado"

# ── 9. Atalho na área de trabalho (.command = duplo clique no Finder) ─────────
step "Criando atalho na área de trabalho..."
DESKTOP="$HOME/Desktop"
SHORTCUT="$DESKTOP/QA Agent - Nocorp.command"

if [ -d "$DESKTOP" ]; then
    cat > "$SHORTCUT" << EOF
#!/bin/bash
"$INSTALL_DIR/start.sh"
EOF
    chmod +x "$SHORTCUT"
    # Remove quarentena do macOS (evita popup de segurança)
    xattr -d com.apple.quarantine "$SHORTCUT" 2>/dev/null || true
    ok "Atalho criado na área de trabalho"
else
    info "Desktop não encontrado — execute manualmente: $INSTALL_DIR/start.sh"
fi

# ── Concluído ─────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  ✅ Instalação concluída!                ║"
echo "  ║                                          ║"
echo "  ║  Clique duas vezes em:                   ║"
echo "  ║  'QA Agent - Nocorp' na área de trabalho ║"
echo "  ║  ou execute: ~/NocorpQAAgent/start.sh    ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
