@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     QA Agent — Configuração inicial  ║
echo  ╚══════════════════════════════════════╝
echo.

:: Verifica se Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo  ❌ Python não encontrado.
    echo  Baixe em: https://www.python.org/downloads/
    echo  Marque a opção "Add Python to PATH" durante a instalação.
    pause
    exit /b 1
)

echo  ✅ Python encontrado
echo.

:: Cria o ambiente virtual
if not exist venv (
    echo  📦 Criando ambiente virtual...
    python -m venv venv
    echo  ✅ Ambiente virtual criado
) else (
    echo  ✅ Ambiente virtual já existe
)
echo.

:: Instala dependências
echo  📥 Instalando dependências...
venv\Scripts\pip.exe install --upgrade pip -q
venv\Scripts\pip.exe install -r requirements.txt -q
echo  ✅ Dependências instaladas
echo.

:: Instala o Chromium para o Playwright
echo  🌐 Instalando Chromium...
venv\Scripts\playwright.exe install chromium
echo  ✅ Chromium instalado
echo.

:: Verifica se o .env existe
if not exist .env (
    echo  ⚙️  Criando arquivo .env...
    (
        echo AI_PROVIDER=cerebras
        echo CEREBRAS_API_KEY=cole_sua_key_aqui
        echo CEREBRAS_MODEL=llama3.3-70b
        echo.
        echo BACKEND_URL=https://seu-backend.up.railway.app
        echo BACKEND_TOKEN=qa-system-secret-2024
        echo.
        echo MAX_STEPS=15
        echo PORT=8000
    ) > .env
    echo.
    echo  ⚠️  IMPORTANTE: Edite o arquivo .env com:
    echo     - Sua API key da Cerebras
    echo     - A URL do backend Railway
    echo     - O token do sistema
    echo.
) else (
    echo  ✅ Arquivo .env já configurado
)

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  ✅ Instalação concluída!            ║
echo  ║  Execute start.bat para iniciar.     ║
echo  ╚══════════════════════════════════════╝
echo.
pause
