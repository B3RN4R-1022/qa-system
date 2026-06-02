# ============================================================
#  Nocorp QA Agent — Instalador
#  Uso: irm https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.ps1 | iex
# ============================================================

$BACKEND_URL   = "https://qa-system-5vpf.onrender.com"
$INSTALL_DIR   = "$env:USERPROFILE\NocorpQAAgent"
$GITHUB_RAW    = "https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent"
$SHORTCUT_NAME = "QA Agent - Nocorp"

function Write-Step($msg) { Write-Host "`n  $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  ❌ $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  ℹ  $msg" -ForegroundColor Gray }

function Stop-OnError($msg) {
    Write-Err $msg
    Read-Host "`n  Pressione Enter para sair"
    exit 1
}

Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║        Nocorp QA Agent — Instalador      ║" -ForegroundColor Magenta
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ── 1. Python ───────────────────────────────────────────────
Write-Step "Verificando Python..."

$python = $null
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3\.(\d+)") {
            if ([int]$Matches[1] -ge 11) { $python = $cmd; break }
        }
    } catch {}
}

if ($python) {
    Write-OK "Python encontrado: $(& $python --version)"
} else {
    Write-Step "Python não encontrado — instalando via winget..."
    try {
        winget install --id Python.Python.3.13 --silent --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        $python = "python"
        Write-OK "Python instalado com sucesso"
    } catch {
        Stop-OnError "Não foi possível instalar Python. Baixe em https://www.python.org/downloads/ (marque 'Add Python to PATH') e rode este script novamente."
    }
}

# ── 2. Pasta de instalação ───────────────────────────────────
Write-Step "Criando pasta de instalação em $INSTALL_DIR..."
New-Item -ItemType Directory -Force -Path $INSTALL_DIR | Out-Null
Write-OK "Pasta criada"

# ── 3. Download dos arquivos ─────────────────────────────────
Write-Step "Baixando arquivos do QA Agent..."

$files = @("agent.py", "worker.py", "session.py", "main.py", "requirements.txt", "version.txt")
$noCache = @{'Cache-Control'='no-cache'; 'Pragma'='no-cache'}
foreach ($file in $files) {
    try {
        Invoke-WebRequest "$GITHUB_RAW/$file" -OutFile "$INSTALL_DIR\$file" -UseBasicParsing -Headers $noCache
        Write-OK "Baixado: $file"
    } catch {
        Stop-OnError "Falha ao baixar $file. Verifique sua conexão com a internet."
    }
}

# ── 4. Ambiente virtual ──────────────────────────────────────
Write-Step "Criando ambiente virtual Python..."
# Sempre recria para garantir instalação limpa (evita conflitos de versão)
if (Test-Path "$INSTALL_DIR\venv") {
    Write-Info "Recriando ambiente virtual para garantir instalação limpa..."
    Remove-Item -Recurse -Force "$INSTALL_DIR\venv"
}
& $python -m venv "$INSTALL_DIR\venv"
if ($LASTEXITCODE -ne 0) { Stop-OnError "Falha ao criar ambiente virtual." }
Write-OK "Ambiente virtual criado"

# ── 5. Dependências ──────────────────────────────────────────
Write-Step "Instalando dependências (pode demorar 1-2 minutos)..."
& "$INSTALL_DIR\venv\Scripts\pip.exe" install --upgrade pip -q 2>$null
& "$INSTALL_DIR\venv\Scripts\pip.exe" install -r "$INSTALL_DIR\requirements.txt"
if ($LASTEXITCODE -ne 0) {
    Stop-OnError "Falha ao instalar dependências. Veja os erros acima."
}
Write-OK "Dependências instaladas"

# ── 6. Playwright / Chromium ─────────────────────────────────
Write-Step "Instalando Chromium para automação de navegador..."

$playwrightExe = "$INSTALL_DIR\venv\Scripts\playwright.exe"
if (-not (Test-Path $playwrightExe)) {
    Stop-OnError "playwright.exe não encontrado — a instalação das dependências falhou. Verifique os erros acima."
}

& $playwrightExe install chromium
if ($LASTEXITCODE -ne 0) {
    Stop-OnError "Falha ao instalar Chromium."
}
Write-OK "Chromium instalado"

# ── 7. Arquivo .env ──────────────────────────────────────────
Write-Step "Configurando conexão com o backend..."
$envContent = @"
# Nocorp QA Agent — Configuração
BACKEND_URL=$BACKEND_URL
AI_PROVIDER=cerebras
MAX_STEPS=15
"@
$envContent | Out-File -FilePath "$INSTALL_DIR\.env" -Encoding utf8 -Force
Write-OK "Configuração salva"

# ── 8. Script de inicialização ───────────────────────────────
Write-Step "Criando script de inicialização..."
$startScript = @"
@echo off
chcp 65001 >nul
title QA Agent - Nocorp
cd /d "$INSTALL_DIR"
echo.
echo  Nocorp QA Agent
echo  Conectando ao sistema...
echo  Mantenha esta janela aberta durante os testes.
echo  Pressione Ctrl+C para encerrar.
echo.
venv\Scripts\python.exe worker.py
pause
"@
$startScript | Out-File -FilePath "$INSTALL_DIR\start.bat" -Encoding ascii -Force
Write-OK "Script de inicialização criado"

# ── 9. Atalho na área de trabalho ────────────────────────────
Write-Step "Criando atalho na área de trabalho..."
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shell    = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut("$desktopPath\$SHORTCUT_NAME.lnk")
    $shortcut.TargetPath       = "$INSTALL_DIR\start.bat"
    $shortcut.WorkingDirectory = $INSTALL_DIR
    $shortcut.Description      = "Nocorp QA Agent"
    $shortcut.Save()
    Write-OK "Atalho criado em: $desktopPath"
} catch {
    Write-Info "Não foi possível criar atalho na área de trabalho (não crítico)."
    Write-Info "Para iniciar, execute: $INSTALL_DIR\start.bat"
}

# ── Concluído ────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  ✅ Instalação concluída!                ║" -ForegroundColor Green
Write-Host "  ║                                          ║" -ForegroundColor Green
Write-Host "  ║  Execute o atalho na área de trabalho    ║" -ForegroundColor Green
Write-Host "  ║  ou rode: $INSTALL_DIR\start.bat" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Read-Host "Pressione Enter para fechar"
