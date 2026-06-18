'use strict'

require('dotenv').config()

const fs       = require('fs')
const path     = require('path')
const readline = require('readline')
const { NocorPlus } = require('nocorplus')

const BACKEND_URL  = (process.env.BACKEND_URL || 'https://qa-system-5vpf.onrender.com').replace(/\/$/, '')
const POLL_MS      = 5000
const SESSION_FILE = path.join(__dirname, '.session.json')

// ── Autenticação ──────────────────────────────────────────────────────────────

function loadToken() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')).token || null }
  catch { return null }
}

function saveToken(token) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ token }), 'utf8')
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

async function login() {
  console.log('\n  Faça login com sua conta do QA System:')
  const email    = await ask('  Email: ')
  const password = await ask('  Senha: ')

  const r1 = await fetch(`${BACKEND_URL}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  })
  const d1 = await r1.json()
  if (!r1.ok) throw new Error(d1.error || 'Falha no login')

  if (d1.requiresTotp) {
    const code = await ask('  Código do autenticador (6 dígitos): ')
    const r2 = await fetch(`${BACKEND_URL}/auth/verify-totp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tempToken: d1.tempToken, code }),
    })
    const d2 = await r2.json()
    if (!r2.ok) throw new Error(d2.error || 'Código incorreto')
    saveToken(d2.token)
    return d2.token
  }

  saveToken(d1.token)
  return d1.token
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

// ── Formatação do relatório ───────────────────────────────────────────────────

function formatReport(report) {
  const icon = { PASS: '✅', WARN: '⚠️', FAIL: '❌' }[report.status] || '❌'
  const lines = [
    `${icon} Status: ${report.status}`,
    `Duração: ${(report.durationMs / 1000).toFixed(1)}s  |  Custo: R$ ${report.cost?.brl ?? '?'}`,
    `Steps: ${report.summary?.passed ?? 0}/${report.summary?.total ?? 0} passaram`,
    '',
  ]
  for (const s of report.steps || []) {
    const si     = s.status === 'pass' ? '✓' : '✗'
    const origin = s.toolOrigin ? ` [${s.toolOrigin}]` : ''
    lines.push(`  ${si} ${s.action}${origin} — ${s.description ?? s.target ?? ''}`)
    if (s.error)   lines.push(`      Erro: ${s.error}`)
    if (s.warning) lines.push(`      ⚠️  ${s.warning}`)
  }
  return lines.join('\n')
}

// ── Execução de um job ────────────────────────────────────────────────────────

async function runJob(job, token) {
  const headers    = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const { task_id: taskId, type: jobType = 'qa_task' } = job

  // Reivindica o job atomicamente — se outro worker pegou antes, para aqui
  const claimRes = await fetch(`${BACKEND_URL}/qa-jobs/${taskId}/claim`, {
    method: 'POST',
    headers,
    body:   JSON.stringify({ type: jobType }),
  })
  const { claimed } = await claimRes.json()
  if (!claimed) return

  console.log(`\n  ▶ Iniciando: ${job.title}`)
  console.log(`    URL: ${job.preview_url}`)
  if (job.criteria?.length) console.log(`    Critérios: ${job.criteria.length}`)

  const postResult = (status, report, tokensUsed) =>
    fetch(`${BACKEND_URL}/qa-jobs/${taskId}/result`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ type: jobType, status, report, tokensUsed }),
    })

  try {
    const runner = new NocorPlus({
      headless: job.crawl_headless !== false,
      verbose:  true,
    })

    // Criteria do Asana → scenario[] do NocorPlus
    // Se não há critérios, usa o título como goal simples
    const hasCredentials = job.login_email && job.login_password
    const inputData      = hasCredentials
      ? { email: job.login_email, password: job.login_password }
      : undefined

    const runInput = (job.criteria?.length)
      ? { url: job.preview_url, scenario: job.criteria.map(c => ({ step: c })), data: inputData }
      : { url: job.preview_url, goal: job.title, data: inputData }

    const report     = await runner.run(runInput)
    const statusMap  = { PASS: 'done', WARN: 'done', FAIL: 'error' }
    const tokensUsed = (report.cost?.inputTokens ?? 0) + (report.cost?.outputTokens ?? 0)

    await postResult(statusMap[report.status] || 'done', formatReport(report), tokensUsed)
    console.log(`  ✅ Concluído: ${report.status}  R$ ${report.cost?.brl ?? '?'}`)

  } catch (err) {
    await postResult('error', `Erro: ${err.message}`)
    console.error('  ❌ Erro:', err.message)
  }
}

// ── Loop principal ────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log('  ╔══════════════════════════════════════════╗')
  console.log('  ║         Nocorp+ QA Agent (Node)          ║')
  console.log('  ╚══════════════════════════════════════════╝')
  console.log()

  let token = await ensureToken()
  console.log('  ✅ Autenticado. Aguardando jobs...\n')

  while (true) {
    try {
      const res = await fetch(`${BACKEND_URL}/qa-jobs/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        console.log('  🔄 Sessão expirada — fazendo login novamente...')
        token = await login()
        continue
      }

      const job = await res.json()
      if (job) await runJob(job, token)

    } catch (err) {
      // Rede fora ou backend dormindo (Render free tier) — silencioso
      if (!err.message?.includes('fetch failed') && !err.message?.includes('ECONNREFUSED')) {
        console.error('  [worker]', err.message)
      }
    }

    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
