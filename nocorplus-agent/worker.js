'use strict'

require('dotenv').config()

const fs       = require('fs')
const path     = require('path')
const readline = require('readline')
const { spawn } = require('child_process')
const { NocorPlus } = require('nocorplus')

const BACKEND_URL  = (process.env.BACKEND_URL || 'https://qa-system-5vpf.onrender.com').replace(/\/$/, '')
const POLL_MS      = 5000
const SESSION_FILE = path.join(__dirname, '.session.json')
const ENV_FILE     = path.join(__dirname, '.env')
const VER_FILE     = path.join(__dirname, '.version')
const GITHUB_REPO  = 'B3RN4R-1022/qa-system'
const AGENT_PATH   = 'nocorplus-agent/worker.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

function saveEnv(key, value) {
  let content = ''
  try { content = fs.readFileSync(ENV_FILE, 'utf8') } catch {}
  const re = new RegExp(`^${key}=.*$`, 'm')
  content = re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content + `\n${key}=${value}\n`
  fs.writeFileSync(ENV_FILE, content, 'utf8')
  process.env[key] = value
}

function clearApiKeys() {
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    let content = ''
    try { content = fs.readFileSync(ENV_FILE, 'utf8') } catch {}
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=`)
    try { fs.writeFileSync(ENV_FILE, content, 'utf8') } catch {}
    delete process.env[key]
  }
}

function isInvalidKeyError(err) {
  const m = err?.message || ''
  return m.includes('authentication_error') || m.includes('invalid x-api-key') ||
         m.includes('invalid_api_key') || m.includes('Incorrect API key')
}

function maskKey(key) {
  if (!key || key.length < 12) return '—'
  return `${key.slice(0, 10)}...${key.slice(-4)}`
}

function loadSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) } catch { return null }
}

function saveSession(data) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data), 'utf8')
}

// ── 1. Verificar atualizações ─────────────────────────────────────────────────

async function checkUpdates() {
  process.stdout.write('  Verificando atualizações...  ')
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/commits?path=${AGENT_PATH}&per_page=1`,
      { headers: { 'User-Agent': 'nocorplus-agent' } }
    )
    if (!res.ok) { console.log('(ignorado)\n'); return false }

    const [commit] = await res.json()
    let localSha = ''
    try { localSha = fs.readFileSync(VER_FILE, 'utf8').trim() } catch {}

    if (commit.sha === localSha) {
      console.log('✅ Atualizado\n')
      return false
    }

    const date = new Date(commit.commit.author.date).toLocaleDateString('pt-BR')
    console.log(`\n  ⚡ Nova versão disponível (${date})`)
    const ans = await ask('  Atualizar agora? (s/N): ')
    if (ans.toLowerCase() !== 's') {
      fs.writeFileSync(VER_FILE, commit.sha, 'utf8')
      console.log()
      return false
    }

    process.stdout.write('  Baixando atualização... ')
    const dl = await fetch(
      `https://raw.githubusercontent.com/${GITHUB_REPO}/master/${AGENT_PATH}`
    )
    fs.writeFileSync(__filename, await dl.text(), 'utf8')
    fs.writeFileSync(VER_FILE, commit.sha, 'utf8')
    console.log('✅ Concluído')

    console.log('  Atualizando pacotes NocorPlus...')
    await new Promise((resolve, reject) => {
      const npm = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], {
        cwd: __dirname, stdio: 'inherit',
      })
      npm.on('close', code => code === 0 ? resolve() : reject(new Error(`npm install falhou (${code})`)))
    }).catch(e => console.log(`  ⚠️  ${e.message}`))

    console.log('  Reiniciando...\n')
    spawn(process.execPath, [__filename], { stdio: 'inherit' })
      .on('exit', code => process.exit(code ?? 0))
    return true  // sinaliza que vai reiniciar

  } catch {
    console.log('(sem conexão)\n')
    return false
  }
}

// ── 2. Chave de API ───────────────────────────────────────────────────────────

async function ensureApiKey() {
  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) return

  console.log('  Configuração da chave de IA')
  console.log('  ─────────────────────────────────────────────')

  const choice = await ask('  Provedor  (1) Claude  (2) OpenAI  → ')

  let keyName, prefix, hint
  if (choice === '2') {
    keyName = 'OPENAI_API_KEY'
    prefix  = 'sk-'
    hint    = 'Crie em: platform.openai.com → API keys'
  } else {
    keyName = 'ANTHROPIC_API_KEY'
    prefix  = 'sk-ant-'
    hint    = 'Crie em: console.anthropic.com → API Keys'
  }
  console.log(`  ${hint}`)

  let key = ''
  while (!key.startsWith(prefix)) {
    key = await ask(`  Cole sua chave (${prefix}...): `)
    if (!key.startsWith(prefix))
      console.log(`  Chave inválida — deve começar com "${prefix}"`)
  }
  saveEnv(keyName, key)
  console.log('  ✅ Chave salva\n')
}

// ── 3. Exibir config + opção de alterar ──────────────────────────────────────

async function showAndConfirmConfig() {
  const provider   = process.env.ANTHROPIC_API_KEY ? 'Claude'
                   : process.env.OPENAI_API_KEY    ? 'OpenAI'
                   : '(não configurado)'
  const keyVal     = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || ''
  const keyDisplay = maskKey(keyVal)

  const session = loadSession()
  const account = session?.email || (session?.token ? 'sessão salva' : '(não autenticado)')

  console.log('  ┌───────────────────────────────────────────────────┐')
  console.log(`  │  Provedor : ${(provider + '  ' + keyDisplay).padEnd(38)}│`)
  console.log(`  │  Conta    : ${account.padEnd(38)}│`)
  console.log('  └───────────────────────────────────────────────────┘')
  console.log()

  const change = await ask('  Alterar chave/conta? (s/N): ')
  if (change.toLowerCase() === 's') {
    clearApiKeys()
    await ensureApiKey()
    try { fs.unlinkSync(SESSION_FILE) } catch {}
  }
  console.log()
}

// ── Perguntas pré/pós-teste ───────────────────────────────────────────────────

async function askSrcRoot() {
  const current = process.env.SRC_ROOT || ''
  const display  = current
    ? (current.length > 40 ? '…' + current.slice(-40) : current)
    : '(nenhum)'
  console.log(`\n  Repositório: ${display}`)
  const ans = await ask('  Alterar código-fonte do projeto? (s/N): ')
  if (ans.toLowerCase() !== 's') return
  const newSrc = await ask('  Caminho do src (Enter para remover): ')
  const trimmed = newSrc.trim()
  if (trimmed && !fs.existsSync(trimmed)) {
    console.log('  ⚠️  Caminho não encontrado — mantendo anterior')
    return
  }
  saveEnv('SRC_ROOT', trimmed)
  console.log(trimmed ? '  ✅ Código-fonte atualizado' : '  ✅ Código-fonte removido')
}

async function askClearCache() {
  const kvDir = path.join(__dirname, '.nocorplus', 'kv')
  let count = 0
  try { count = fs.readdirSync(kvDir).length } catch {}
  if (count === 0) return
  const ans = await ask(`\n  Limpar cache de planos de IA? (${count} planos salvos) (s/N): `)
  if (ans.toLowerCase() !== 's') return
  try {
    fs.rmSync(kvDir, { recursive: true, force: true })
    console.log('  ✅ Cache limpo')
  } catch {}
}

// ── 4. Autenticação ───────────────────────────────────────────────────────────

function loadToken() {
  return loadSession()?.token || null
}

async function login() {
  while (true) {
    console.log('  Faça login com sua conta do QA System:')
    const email    = await ask('  Email: ')
    const password = await ask('  Senha: ')

    const r1 = await fetch(`${BACKEND_URL}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    })
    const d1 = await r1.json()
    if (!r1.ok) { console.log(`  ❌ ${d1.error || 'Email ou senha incorretos'} — tente novamente\n`); continue }

    if (d1.requiresTotp) {
      const code = await ask('  Código do autenticador (6 dígitos): ')
      const r2 = await fetch(`${BACKEND_URL}/auth/verify-totp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tempToken: d1.tempToken, code }),
      })
      const d2 = await r2.json()
      if (!r2.ok) { console.log(`  ❌ ${d2.error || 'Código incorreto'} — tente novamente\n`); continue }
      saveSession({ token: d2.token, email })
      return d2.token
    }

    saveSession({ token: d1.token, email })
    return d1.token
  }
}

async function ensureToken() {
  const stored = loadToken()
  if (stored) {
    const r = await fetch(`${BACKEND_URL}/qa-jobs/pending`, {
      headers: { Authorization: `Bearer ${stored}` },
    }).catch(() => null)
    if (r && r.status !== 401) return stored
  }
  return login()
}

// ── 5. Formatação do relatório ────────────────────────────────────────────────

function formatReport(report) {
  const icon  = { PASS: '✅', WARN: '⚠️', FAIL: '❌' }[report.status] || '❌'
  const lines = [
    `${icon} Status: ${report.status}`,
    `Duração: ${(report.durationMs / 1000).toFixed(1)}s  |  Custo: R$ ${report.cost?.brl ?? '?'}`,
    `Steps: ${report.summary?.passed ?? 0}/${report.summary?.total ?? 0} passaram`,
    '',
  ]
  for (const s of report.steps || []) {
    const si = s.status === 'pass' ? '✓' : '✗'
    const origin = s.toolOrigin ? ` [${s.toolOrigin}]` : ''
    const val    = s.value     ? ` = "${s.value}"`     : ''
    lines.push(`  ${si} ${s.action}${origin} → ${s.target ?? ''}${val}`)
    if (s.warning) lines.push(`      ⚠️  ${s.warning}`)
    if (s.error)   lines.push(`      ✗  ${s.error}`)
  }
  return lines.join('\n')
}

// ── 6. Execução de um job ─────────────────────────────────────────────────────

async function runJob(job, token) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const { task_id: taskId, type: jobType = 'qa_task' } = job

  const claimRes = await fetch(`${BACKEND_URL}/qa-jobs/${taskId}/claim`, {
    method: 'POST', headers, body: JSON.stringify({ type: jobType }),
  })
  const { claimed } = await claimRes.json()
  if (!claimed) return

  console.log(`\n  ▶  ${job.title}`)
  console.log(`     ${job.preview_url}`)
  if (job.criteria?.length) {
    console.log(`     ${job.criteria.length} critério(s) — modo scenario`)
    job.criteria.forEach((c, i) => console.log(`       ${i + 1}. ${c}`))
  } else {
    console.log('     ⚠️  Sem critérios — modo goal único (menos preciso)')
    console.log('        Dica: divida a tarefa em critérios no QA System')
  }

  // Pergunta srcRoot antes de rodar
  await askSrcRoot()

  const postResult = (status, report, tokensUsed) =>
    fetch(`${BACKEND_URL}/qa-jobs/${taskId}/result`, {
      method: 'POST', headers,
      body:   JSON.stringify({ type: jobType, status, report, tokensUsed }),
    })

  try {
    const srcRoot = process.env.SRC_ROOT || undefined
    const runner = new NocorPlus({
      headless: false,
      verbose:  false,
      ...(srcRoot ? { srcRoot } : {}),
    })
    if (srcRoot) console.log(`\n     Code tools: ${srcRoot}`)
    console.log()

    const inputData = (job.login_email && job.login_password)
      ? { email: job.login_email, password: job.login_password }
      : undefined

    const runInput = job.criteria?.length
      ? { url: job.preview_url, scenario: job.criteria.map(c => ({ step: c, data: inputData })) }
      : { url: job.preview_url, goal: job.title, data: inputData }

    const report     = await runner.run(runInput)
    const statusMap  = { PASS: 'done', WARN: 'done', FAIL: 'error' }
    const tokensUsed = (report.cost?.inputTokens ?? 0) + (report.cost?.outputTokens ?? 0)

    await postResult(statusMap[report.status] || 'done', formatReport(report), tokensUsed)
    console.log(`\n  ${report.status}  — R$ ${report.cost?.brl ?? '?'}  (${(report.durationMs / 1000).toFixed(1)}s)`)

  } catch (err) {
    if (isInvalidKeyError(err)) {
      console.error('\n  ❌ Chave de API inválida — configure uma nova:\n')
      clearApiKeys()
      await ensureApiKey()
      return
    }
    await postResult('error', `Erro: ${err.message}`)
    console.error(`  ❌ Erro: ${err.message}`)
  }

  // Pergunta cache depois de rodar e volta a aguardar
  await askClearCache()
  console.log('\n  ─────────────────────────────────────────────')
  console.log('  Aguardando próximo teste...\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log('  ╔══════════════════════════════════════════╗')
  console.log('  ║         Nocorp+ QA Agent (Node)          ║')
  console.log('  ╚══════════════════════════════════════════╝')
  console.log()

  // 1 — update
  const restarting = await checkUpdates()
  if (restarting) return

  // 2 — chave de API (só pergunta se não tiver)
  await ensureApiKey()

  // 3 — exibe config atual + opção de alterar
  await showAndConfirmConfig()

  // 4 — login (usa sessão salva se ainda válida)
  let token = await ensureToken()
  console.log('  ✅ Autenticado. Aguardando jobs...\n')
  console.log('  ─────────────────────────────────────────────')

  while (true) {
    try {
      const res = await fetch(`${BACKEND_URL}/qa-jobs/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        console.log('\n  🔄 Sessão expirada — faça login novamente')
        token = await login()
        continue
      }
      const job = await res.json()
      if (job) await runJob(job, token)
    } catch (err) {
      if (!err.message?.includes('fetch failed') && !err.message?.includes('ECONNREFUSED'))
        console.error('  [worker]', err.message)
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
