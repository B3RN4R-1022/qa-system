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

# ── Download ──────────────────────────────────────────────────────────────────

$dest = "$env:USERPROFILE\nocorplus-agent"

if (Test-Path $dest) {
  Write-Host ""
  Write-Host "  Pasta ja existe — atualizando arquivos..."
  Set-Location $dest
  git fetch origin master --quiet 2>&1 | Out-Null
  git reset --hard origin/master --quiet 2>&1 | Out-Null
} else {
  Write-Host ""
  Write-Host "  Baixando Nocorp+ Agent..."
  $tmp = "$env:TEMP\qa-system-tmp-$(Get-Random)"
  git clone --filter=blob:none --sparse https://github.com/B3RN4R-1022/qa-system.git $tmp --quiet 2>&1 | Out-Null
  Set-Location $tmp
  git sparse-checkout set nocorplus-agent --quiet 2>&1 | Out-Null
  if (-not (Test-Path "$tmp\nocorplus-agent")) {
    Write-Host "  ERRO: Falha ao baixar. Verifique sua conexao e acesso ao GitHub."
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Read-Host "  Pressione Enter para sair"; exit 1
  }
  Copy-Item -Recurse "$tmp\nocorplus-agent" $dest
  Set-Location $env:USERPROFILE
  Remove-Item -Recurse -Force $tmp
  Write-Host "  OK  Baixado para: $dest"
}

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
  Write-Host ""
  Write-Host "  Configure sua chave de API antes de iniciar:"
  Write-Host "  $dest\.env"
  Start-Process notepad "$dest\.env" -Wait
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

  # Fundo indigo (cor Nocorp+)
  $bg = [System.Drawing.Color]::FromArgb(99, 102, 241)
  $g.Clear($bg)

  # Texto N+
  $font     = New-Object System.Drawing.Font("Segoe UI", 110, [System.Drawing.FontStyle]::Bold)
  $brush    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sf       = New-Object System.Drawing.StringFormat
  $sf.Alignment     = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect     = New-Object System.Drawing.RectangleF(0, 0, $sz, $sz)
  $g.DrawString("N+", $font, $brush, $rect, $sf)
  $g.Dispose()

  # Salva PNG temporário e converte para ICO (formato moderno suporta PNG embutido)
  $pngPath  = "$env:TEMP\nocorp_icon_$(Get-Random).png"
  $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngBytes = [System.IO.File]::ReadAllBytes($pngPath)

  $ms     = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($ms)
  $writer.Write([uint16]0)                  # Reserved
  $writer.Write([uint16]1)                  # Type ICO
  $writer.Write([uint16]1)                  # 1 imagem
  $writer.Write([byte]0)                    # Width  (0 = 256)
  $writer.Write([byte]0)                    # Height (0 = 256)
  $writer.Write([byte]0)                    # Color count
  $writer.Write([byte]0)                    # Reserved
  $writer.Write([uint16]1)                  # Planes
  $writer.Write([uint16]32)                 # Bit depth
  $writer.Write([uint32]$pngBytes.Length)   # Tamanho PNG
  $writer.Write([uint32]22)                 # Offset (6 header + 16 dir)
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

$lnk = "$env:USERPROFILE\Desktop\Nocorp+ Agent.lnk"
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
