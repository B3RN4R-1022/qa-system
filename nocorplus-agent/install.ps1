# Nocorp+ QA Agent — Instalador Windows
# Requer: Node.js 18+ e Git com acesso ao GitHub

Write-Host ""
Write-Host "  Nocorp+ QA Agent - Instalador"
Write-Host "  ================================"
Write-Host ""

# 1. Verifica Node.js
try {
    $v = & node --version 2>&1
    Write-Host "  OK  Node.js $v"
} catch {
    Write-Host "  ERRO: Node.js nao encontrado."
    Write-Host "  Baixe em: https://nodejs.org (versao 18 ou superior)"
    Read-Host "  Pressione Enter para sair"
    exit 1
}

# 2. Verifica Git
try {
    $g = & git --version 2>&1
    Write-Host "  OK  $g"
} catch {
    Write-Host "  ERRO: Git nao encontrado."
    Write-Host "  Baixe em: https://git-scm.com"
    Read-Host "  Pressione Enter para sair"
    exit 1
}

# 3. Define pasta de destino
$dest = "$env:USERPROFILE\nocorplus-agent"

if (Test-Path $dest) {
    Write-Host ""
    Write-Host "  Pasta ja existe: $dest"
    Write-Host "  Atualizando arquivos..."
    Set-Location $dest
    & git pull origin master 2>&1 | Out-Null
} else {
    Write-Host ""
    Write-Host "  Baixando Nocorp+ Agent..."

    # Sparse checkout — baixa so a pasta nocorplus-agent do repositorio qa-system
    $tmpDir = "$env:TEMP\qa-system-tmp"
    if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }

    & git clone --filter=blob:none --sparse https://github.com/B3RN4R-1022/qa-system.git $tmpDir 2>&1 | Out-Null
    Set-Location $tmpDir
    & git sparse-checkout set nocorplus-agent 2>&1 | Out-Null

    if (-not (Test-Path "$tmpDir\nocorplus-agent")) {
        Write-Host "  ERRO: Falha ao baixar os arquivos. Verifique sua conexao e acesso ao GitHub."
        Read-Host "  Pressione Enter para sair"
        exit 1
    }

    Copy-Item -Recurse "$tmpDir\nocorplus-agent" $dest
    Set-Location $env:USERPROFILE
    Remove-Item -Recurse -Force $tmpDir
    Write-Host "  OK  Baixado para: $dest"
}

# 4. Instala dependencias Node.js
Set-Location $dest
Write-Host ""
Write-Host "  Instalando dependencias (pode levar ~1 min na primeira vez)..."
Write-Host "  Se aparecer um prompt de login do GitHub, faca login com sua conta."
Write-Host ""
& npm install 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  ERRO: npm install falhou."
    Write-Host "  Verifique se sua conta GitHub tem acesso ao repositorio nocorplus."
    Read-Host "  Pressione Enter para sair"
    exit 1
}
Write-Host "  OK  Dependencias instaladas"

# 5. Cria .env se nao existir
if (-not (Test-Path "$dest\.env")) {
    Copy-Item "$dest\.env.example" "$dest\.env"
    Write-Host ""
    Write-Host "  ATENCAO: Configure sua chave de API antes de iniciar."
    Write-Host "  Abra o arquivo abaixo e preencha ANTHROPIC_API_KEY:"
    Write-Host "  $dest\.env"
    & notepad "$dest\.env"
}

# 6. Cria atalho na area de trabalho
$shell     = New-Object -ComObject WScript.Shell
$shortcut  = $shell.CreateShortcut("$env:USERPROFILE\Desktop\Nocorp+ Agent.lnk")
$shortcut.TargetPath      = "cmd.exe"
$shortcut.Arguments       = "/k cd /d `"$dest`" && node worker.js"
$shortcut.WorkingDirectory = $dest
$shortcut.Description     = "Nocorp+ QA Agent"
$shortcut.Save()

Write-Host ""
Write-Host "  ================================"
Write-Host "  Instalacao concluida!"
Write-Host "  Atalho criado na area de trabalho: 'Nocorp+ Agent'"
Write-Host ""
Write-Host "  Para iniciar: clique duas vezes no atalho"
Write-Host "  ou abra um terminal e execute: node worker.js"
Write-Host "  ================================"
Write-Host ""
Read-Host "  Pressione Enter para sair"
