# Nocorp+ QA Agent — Instalador Windows

Write-Host ""
Write-Host "  Nocorp+ QA Agent - Instalador"
Write-Host "  ================================"
Write-Host ""

# ── Verifica dependências ─────────────────────────────────────────────────────

try { $v = node --version; Write-Host "  OK  Node.js $v" }
catch {
  Write-Host "  ERRO: Node.js nao encontrado."
  Write-Host "  Baixe em: https://nodejs.org (versao 18 ou superior)"
  Read-Host "  Pressione Enter para sair"; exit 1
}

try { $g = git --version; Write-Host "  OK  $g" }
catch {
  Write-Host "  ERRO: Git nao encontrado."
  Write-Host "  Baixe em: https://git-scm.com"
  Read-Host "  Pressione Enter para sair"; exit 1
}

# ── Download via ZIP ──────────────────────────────────────────────────────────

$dest = "$env:USERPROFILE\nocorplus-agent"

Write-Host ""
if (Test-Path $dest) {
  Write-Host "  Atualizando Nocorp+ Agent..."
} else {
  Write-Host "  Baixando Nocorp+ Agent..."
}

$zip       = "$env:TEMP\qa-system-$(Get-Random).zip"
$extracted = "$env:TEMP\qa-system-$(Get-Random)"

try {
  Invoke-WebRequest "https://github.com/B3RN4R-1022/qa-system/archive/refs/heads/master.zip" `
    -OutFile $zip -UseBasicParsing
} catch {
  Write-Host "  ERRO: Falha ao baixar o arquivo."
  Write-Host "  Verifique sua conexao com a internet e tente novamente."
  Read-Host "  Pressione Enter para sair"; exit 1
}

try {
  Expand-Archive $zip $extracted -Force
} catch {
  Write-Host "  ERRO: Falha ao extrair o arquivo baixado."
  Remove-Item $zip -ErrorAction SilentlyContinue
  Read-Host "  Pressione Enter para sair"; exit 1
}

$src = "$extracted\qa-system-master\nocorplus-agent"
if (-not (Test-Path $src)) {
  Write-Host "  ERRO: Estrutura inesperada no arquivo baixado."
  Remove-Item $zip -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $extracted -ErrorAction SilentlyContinue
  Read-Host "  Pressione Enter para sair"; exit 1
}

# Preserva .env e .session.json ao atualizar
$savedEnv     = if (Test-Path "$dest\.env")          { Get-Content "$dest\.env"          -Raw } else { $null }
$savedSession = if (Test-Path "$dest\.session.json") { Get-Content "$dest\.session.json" -Raw } else { $null }

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse $src $dest

if ($savedEnv)     { Set-Content "$dest\.env"          $savedEnv     }
if ($savedSession) { Set-Content "$dest\.session.json" $savedSession }

Remove-Item $zip -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $extracted -ErrorAction SilentlyContinue
Write-Host "  OK  Pronto em: $dest"

# ── npm install ───────────────────────────────────────────────────────────────

Set-Location $dest
Write-Host ""
Write-Host "  Instalando dependencias (pode levar ~1 min na primeira vez)..."
Write-Host "  Se aparecer prompt de login do GitHub, entre com sua conta."
Write-Host ""
npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  ERRO: npm install falhou."
  Write-Host "  Verifique se sua conta GitHub tem acesso ao repositorio nocorplus."
  Read-Host "  Pressione Enter para sair"; exit 1
}
Write-Host "  OK  Dependencias instaladas"

# ── .env ──────────────────────────────────────────────────────────────────────

if (-not (Test-Path "$dest\.env")) {
  Copy-Item "$dest\.env.example" "$dest\.env"
}

# ── Gera ícone N+ via System.Drawing ─────────────────────────────────────────

Add-Type -AssemblyName System.Drawing

$iconPath = "$dest\nocorp.ico"
try {
  $sz  = 256
  $bmp = New-Object System.Drawing.Bitmap($sz, $sz)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $bg = [System.Drawing.Color]::FromArgb(99, 102, 241)
  $g.Clear($bg)

  $font     = New-Object System.Drawing.Font("Segoe UI", 110, [System.Drawing.FontStyle]::Bold)
  $brush    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sf       = New-Object System.Drawing.StringFormat
  $sf.Alignment     = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect     = New-Object System.Drawing.RectangleF(0, 0, $sz, $sz)
  $g.DrawString("N+", $font, $brush, $rect, $sf)
  $g.Dispose()

  $pngPath  = "$env:TEMP\nocorp_icon_$(Get-Random).png"
  $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngBytes = [System.IO.File]::ReadAllBytes($pngPath)

  $ms     = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($ms)
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]1)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$pngBytes.Length)
  $writer.Write([uint32]22)
  $writer.Write($pngBytes)
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($iconPath, $ms.ToArray())
  $writer.Close(); $ms.Close()
  Remove-Item $pngPath -ErrorAction SilentlyContinue
  Write-Host "  OK  Icone gerado"
} catch {
  Write-Host "  AVISO: Nao foi possivel gerar o icone ($($_.Exception.Message))"
  $iconPath = $null
}

# ── Cria atalho na área de trabalho ──────────────────────────────────────────

$lnk      = "$env:USERPROFILE\Desktop\Nocorp+ Agent.lnk"
$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath       = "cmd.exe"
$shortcut.Arguments        = "/k cd /d `"$dest`" && node worker.js"
$shortcut.WorkingDirectory = $dest
$shortcut.Description      = "Nocorp+ QA Agent"
if ($iconPath -and (Test-Path $iconPath)) {
  $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Save()

Write-Host ""
Write-Host "  ================================"
Write-Host "  Instalacao concluida!"
Write-Host "  Atalho criado na area de trabalho: 'Nocorp+ Agent'"
Write-Host ""
Write-Host "  Para iniciar: clique duas vezes no atalho"
Write-Host "  ================================"
Write-Host ""
Read-Host "  Pressione Enter para sair"
