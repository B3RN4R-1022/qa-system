import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import API from '@/lib/api'
import { NocorpLogo } from '@/components/NocorpLogo'
import AgentInstallButton from '@/components/AgentInstallButton'

// ─── Helpers de texto ────────────────────────────────────────────────────────

function parseBold(text) {
  const parts = text.split(/\*\*(.*?)\*\*/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

function MessageContent({ content, isUser }) {
  if (isUser) {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
  }
  return (
    <div className="text-sm leading-relaxed space-y-0.5">
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />
        if (line.startsWith('## ')) return (
          <p key={i} className="font-semibold text-sm mt-2 mb-0.5">{line.slice(3)}</p>
        )
        if (line.startsWith('### ')) return (
          <p key={i} className="font-medium text-sm mt-1.5">{line.slice(4)}</p>
        )
        if (line.startsWith('- ') || line.startsWith('* ')) return (
          <div key={i} className="flex gap-1.5 ml-2">
            <span className="shrink-0 text-gray-400 dark:text-gray-500 mt-0.5">•</span>
            <span>{parseBold(line.slice(2))}</span>
          </div>
        )
        const numMatch = line.match(/^(\d+)\.\s(.*)/)
        if (numMatch) return (
          <div key={i} className="flex gap-1.5 ml-2">
            <span className="shrink-0 text-gray-400 dark:text-gray-500 min-w-[1.1rem]">{numMatch[1]}.</span>
            <span>{parseBold(numMatch[2])}</span>
          </div>
        )
        return <p key={i}>{parseBold(line)}</p>
      })}
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex gap-1.5 items-center h-5 px-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

function PulsingDots() {
  return (
    <div className="flex gap-1.5 items-center">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-2 h-2 rounded-full bg-amber-400 animate-bounce"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  )
}

function BotAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center shrink-0 mt-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    </div>
  )
}

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  )
}

// ─── Formulário /teste-qa ────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: '',
  previewUrl: '',
  projectName: '',
  projectType: '',     // 'wix_velo' | 'wix_headless' | 'repo' | ''
  requestRemap: false,
  description: '',
  expectedBehavior: '',
  criteria: [''],
  notes: '',
  loginEmail: '',
  loginPassword: '',
}

const PROJECT_TYPES = [
  { value: 'wix_velo',    label: 'Wix Velo',    desc: 'No-code, sem repositório' },
  { value: 'wix_headless',label: 'Wix Headless', desc: 'Wix + repositório' },
  { value: 'repo',        label: 'Repositório',  desc: 'Projeto com código' },
]

function TestForm({ form, onChange, onSubmit, onCancel, submitting, formError, existingProjects, projectConfig }) {
  function updateCriteria(idx, val) {
    const next = [...form.criteria]
    next[idx] = val
    onChange('criteria', next)
  }
  function addCriteria() { onChange('criteria', [...form.criteria, '']) }
  function removeCriteria(idx) {
    const next = form.criteria.filter((_, i) => i !== idx)
    onChange('criteria', next.length ? next : [''])
  }

  const inp = "w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"

  return (
    <div className="bg-white dark:bg-gray-900 border-2 border-blue-200 dark:border-blue-800 rounded-2xl p-5 shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-blue-600 dark:text-blue-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Modo Teste QA</p>
          <p className="text-[11px] text-gray-400">Preencha os detalhes para o QA Worker executar</p>
        </div>
        <button onClick={onCancel} className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">✕</button>
      </div>

      <div className="space-y-3">
        {/* Título */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Título do teste <span className="text-red-400">*</span></label>
          <input
            className={inp}
            placeholder="Ex: Login com Google"
            value={form.title}
            onChange={e => onChange('title', e.target.value)}
          />
        </div>

        {/* URL + Projeto (lado a lado) */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">URL de preview <span className="text-red-400">*</span></label>
            <input
              className={inp}
              placeholder="https://..."
              value={form.previewUrl}
              onChange={e => onChange('previewUrl', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Projeto</label>
            <input
              list="qa-projects-list"
              className={inp}
              placeholder="Selecione ou digite o nome"
              value={form.projectName}
              onChange={e => onChange('projectName', e.target.value)}
            />
            <datalist id="qa-projects-list">
              {(existingProjects || []).map(p => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
            {/* Indicadores de cache/mapa */}
            {form.projectName && projectConfig && (
              <div className="flex gap-2 mt-0.5 flex-wrap">
                {projectConfig.hasCache && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    Cache UI disponível
                  </p>
                )}
                {projectConfig.hasSitemap && (
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    {projectConfig.sitemapPageCount} páginas mapeadas
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tipo de projeto — só aparece na primeira vez (sem tipo salvo) */}
        {form.projectName && projectConfig && !projectConfig.projectType && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">
              Tipo de projeto <span className="text-red-400">*</span>
              <span className="text-gray-400 font-normal ml-1">(salvo automaticamente para próximos testes)</span>
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {PROJECT_TYPES.map(pt => (
                <button
                  key={pt.value}
                  type="button"
                  onClick={() => onChange('projectType', pt.value)}
                  className={`text-left px-3 py-2 rounded-xl border text-xs transition-all ${
                    form.projectType === pt.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-300'
                  }`}
                >
                  <p className="font-semibold">{pt.label}</p>
                  <p className="text-[10px] opacity-70 mt-0.5">{pt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Re-mapear — só para Wix Velo com mapa existente */}
        {form.projectName && projectConfig?.hasSitemap && (projectConfig.projectType === 'wix_velo' || form.projectType === 'wix_velo') && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.requestRemap}
              onChange={e => onChange('requestRemap', e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Solicitar re-mapeamento completo antes do teste
              <span className="block text-[10px] text-gray-400 mt-0.5">Use se o site teve mudanças estruturais significativas</span>
            </span>
          </label>
        )}

        {/* Descrição */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Descrição da feature <span className="text-red-400">*</span></label>
          <textarea
            className={`${inp} resize-none`}
            placeholder="O que foi implementado? Qual o objetivo desta feature? Qual fluxo o usuário percorre?"
            rows={3}
            value={form.description}
            onChange={e => onChange('description', e.target.value)}
          />
        </div>

        {/* Critérios */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Critérios de aceite</label>
          <div className="space-y-1.5">
            {form.criteria.map((c, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  className={`${inp} flex-1`}
                  placeholder={`Critério ${i + 1}`}
                  value={c}
                  onChange={e => updateCriteria(i, e.target.value)}
                />
                {form.criteria.length > 1 && (
                  <button
                    onClick={() => removeCriteria(i)}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors text-sm"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addCriteria}
            className="mt-1.5 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
          >
            <span className="text-base leading-none">+</span> Adicionar critério
          </button>
        </div>

        {/* Comportamento esperado */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Comportamento esperado</label>
          <textarea
            className={`${inp} resize-none`}
            placeholder="Descreva o resultado esperado ao final do fluxo"
            rows={2}
            value={form.expectedBehavior}
            onChange={e => onChange('expectedBehavior', e.target.value)}
          />
        </div>

        {/* Credenciais de login */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
            Credenciais de login
            <span className="text-gray-400 font-normal ml-1">(sobrepõe o cache — use quando mudaram)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inp}
              placeholder="Email"
              autoComplete="off"
              value={form.loginEmail}
              onChange={e => onChange('loginEmail', e.target.value)}
            />
            <input
              className={inp}
              type="password"
              placeholder="Senha"
              autoComplete="new-password"
              value={form.loginPassword}
              onChange={e => onChange('loginPassword', e.target.value)}
            />
          </div>
        </div>

        {/* Notas */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Notas adicionais</label>
          <textarea
            className={`${inp} resize-none`}
            placeholder="Ambientes, cuidados especiais…"
            rows={2}
            value={form.notes}
            onChange={e => onChange('notes', e.target.value)}
          />
        </div>

        {formError && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{formError}</p>
        )}

        {/* Botões */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Enviando...
              </>
            ) : 'Executar Análise QA'}
          </button>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function TestExecutionCard({ phase, testId, onCancel }) {
  const isQueued = phase === 'queued'
  return (
    <div className={`rounded-2xl border-2 p-4 ${
      isQueued
        ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10'
        : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10'
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
          isQueued ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-blue-100 dark:bg-blue-900/40'
        }`}>
          {isQueued ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-amber-600 dark:text-amber-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isQueued ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}`}>
            {isQueued ? 'Na fila — aguardando QA Worker...' : 'QA Worker analisando...'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {isQueued
              ? 'Certifique-se de que o QA Agent está aberto no seu computador'
              : 'O Chromium está aberto e executando os testes'}
          </p>
        </div>
        {isQueued && <PulsingDots />}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors underline"
        >
          ✕ Cancelar teste
        </button>
        <span className="text-xs text-gray-300 dark:text-gray-700">·</span>
        <a
          href="/dev-tests"
          className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors underline"
        >
          Ver em Testes
        </a>
      </div>
    </div>
  )
}

function TestResultCard({ phase, report, tokensUsed, onClose }) {
  const [expanded, setExpanded] = useState(false)
  const isDone = phase === 'done'
  const lines = (report || '').split('\n')
  const preview = lines.slice(0, 6).join('\n')

  return (
    <div className={`rounded-2xl border-2 p-4 ${
      isDone
        ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10'
        : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
          isDone ? 'bg-green-100 dark:bg-green-900/40' : 'bg-red-100 dark:bg-red-900/40'
        }`}>
          <span className="text-lg">{isDone ? '✅' : '❌'}</span>
        </div>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isDone ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            {isDone ? 'Análise concluída!' : 'Análise com erro'}
          </p>
          {tokensUsed && (
            <p className="text-xs text-gray-400 mt-0.5">{tokensUsed.toLocaleString('pt-BR')} tokens utilizados</p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm">✕</button>
      </div>
      {report && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto border border-gray-100 dark:border-gray-700">
          <MessageContent content={expanded ? report : preview} isUser={false} />
          {lines.length > 6 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-2 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline text-xs"
            >
              {expanded ? 'Ver menos' : `Ver mais (${lines.length - 6} linhas)`}
            </button>
          )}
        </div>
      )}
      <div className="mt-2">
        <a href="/dev-tests" className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline">
          Ver relatório completo em Testes →
        </a>
      </div>
    </div>
  )
}

// ─── Starters ────────────────────────────────────────────────────────────────

// ─── Template /prompt-qa ─────────────────────────────────────────────────────

const PROMPT_QA_TEMPLATE = `Você é um especialista em QA. Vou te descrever uma feature que desenvolvi.
Com base nisso, gere os campos completos para eu usar no /teste-qa, neste formato exato:

---
**Título do teste:** [nome curto e objetivo, ex: "Cadastro de usuário com e-mail duplicado"]

**URL de preview:** [deixe em branco — eu vou preencher]

**Projeto:** [nome do projeto se identificável na descrição, senão deixe em branco]

**Descrição da feature:**
[2-4 parágrafos explicando: o que foi implementado, qual o objetivo da feature, qual o fluxo principal que o usuário percorre, e quais são as variações de cenário mais importantes]

**Critérios de aceite:**
- [ ] [critério 1 — verificação objetiva que o agente consegue fazer no browser]
- [ ] [critério 2]
- [ ] [critério 3]
... (liste entre 5 e 10 critérios mensuráveis)

**Comportamento esperado:**
[descreva o estado final da tela/sistema após o fluxo principal ser executado com sucesso]

**Notas para o agente:**
[credenciais de teste se aplicável, ambientes específicos, elementos visuais importantes, edge cases que o agente deve tentar]
---

Regras para gerar os critérios:
- Cada critério deve ser algo que o browser consegue verificar visualmente (texto na tela, botão habilitado, redirecionamento, mensagem de erro, etc.)
- Inclua pelo menos 2 critérios negativos (o que NÃO deve acontecer ou o que deve aparecer ao errar)
- Use linguagem direta: "Deve exibir...", "Ao clicar em X, deve...", "O campo Y deve..."

A feature que desenvolvi é:

[COLE AQUI A DESCRIÇÃO DA SUA FEATURE / TASK DO ASANA]`

// ─── Starters ────────────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  {
    label: '📋 Analisar task',
    desc: 'Cole uma descrição',
    text: 'Vou colar a descrição de uma task do Asana. Analise e me dê um plano de testes detalhado:\n\n',
    fill: true
  },
  {
    label: '🤖 Teste automatizado',
    desc: 'Iniciar /teste-qa',
    text: '/teste-qa',
    fill: false,
    isQaCommand: true,
  },
  {
    label: '📝 Gerar modelo de teste',
    desc: 'Ajuda com /teste-qa',
    text: '/prompt-qa',
    fill: false,
    isPromptQa: true,
  },
  {
    label: '✅ Critérios de aprovação',
    desc: 'O que avaliar',
    text: 'Quais são os critérios gerais que devo usar para decidir se aprovo ou reprovo uma task no QA?'
  },
]

// ─── Chat principal ──────────────────────────────────────────────────────────

export default function Chat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState(null)

  // Estado do fluxo /teste-qa — persiste no localStorage para sobreviver a navegação
  // phase: 'form' | 'submitting' | 'queued' | 'running' | 'done' | 'error'
  const [qaFlow, setQaFlow] = useState(() => {
    try {
      const saved = localStorage.getItem('qa_flow')
      if (!saved) return null
      const parsed = JSON.parse(saved)
      // Só restaura se ainda estava em andamento (queued/running)
      if (['queued', 'running'].includes(parsed?.phase)) return parsed
      return null
    } catch { return null }
  })
  const [qaForm, setQaForm] = useState(EMPTY_FORM)
  const [qaFormError, setQaFormError] = useState(null)
  const [existingProjects, setExistingProjects] = useState([])
  const [projectConfig, setProjectConfig] = useState(null)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const textareaRef = useRef(null)

  const token = localStorage.getItem('qa_token')

  useEffect(() => { loadHistory() }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, qaFlow])

  // Persiste qaFlow no localStorage para sobreviver a navegação entre páginas
  useEffect(() => {
    if (!qaFlow) {
      localStorage.removeItem('qa_flow')
    } else if (['queued', 'running'].includes(qaFlow.phase)) {
      localStorage.setItem('qa_flow', JSON.stringify(qaFlow))
    } else {
      // done/error — mantém no storage só o suficiente para mostrar o resultado,
      // mas limpa na próxima vez que o componente montar
      localStorage.removeItem('qa_flow')
    }
  }, [qaFlow])

  // Polling do status do teste
  useEffect(() => {
    if (!qaFlow?.testId || (qaFlow.phase !== 'queued' && qaFlow.phase !== 'running')) return
    // Polling imediato ao montar (caso usuário tenha voltado ao chat)
    const poll = async () => {
      try {
        const res = await fetch(`${API}/dev-tests/${qaFlow.testId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await res.json()
        if (data?.status && ['done', 'error', 'queued', 'running'].includes(data.status)) {
          setQaFlow(prev => ({
            ...prev,
            phase: data.status,
            report: data.report || null,
            tokensUsed: data.tokensUsed || null,
          }))
        }
      } catch {}
    }
    poll() // checa imediatamente ao (re)montar
    const interval = setInterval(poll, 4000)
    return () => clearInterval(interval)
  }, [qaFlow?.testId, qaFlow?.phase])

  async function loadHistory() {
    try {
      const res = await fetch(`${API}/chat/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setMessages(Array.isArray(data) ? data : [])
    } catch {
      setError('Erro ao carregar histórico')
    } finally {
      setLoadingHistory(false)
    }
  }

  // ─── Envio de mensagem ────────────────────────────────────────────────────

  async function sendMessage(textOverride) {
    const content = (textOverride ?? input).trim()
    if (!content || loading) return

    // Detecta /teste-qa
    if (content.toLowerCase() === '/teste-qa') {
      setInput('')
      setQaForm(EMPTY_FORM)
      setQaFormError(null)
      setQaFlow({ phase: 'form', testId: null, report: null, tokensUsed: null })
      // Carrega projetos existentes para o seletor
      fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => { setExistingProjects(Array.isArray(data) ? data : []); setProjectConfig(null) })
        .catch(() => {})
      return
    }

    // Detecta /prompt-qa — injeta o template como mensagem local (sem chamar a IA)
    if (content.toLowerCase() === '/prompt-qa') {
      setInput('')
      const templateMsg = {
        id: `prompt-qa-${Date.now()}`,
        role: 'assistant',
        content: `Aqui está o modelo para preencher o **/teste-qa**. Substitua a última linha pela descrição da sua feature e envie — a IA vai gerar todos os campos prontos para você copiar:\n\n\`\`\`\n${PROMPT_QA_TEMPLATE}\n\`\`\``,
        createdAt: new Date().toISOString(),
        isLocal: true,
      }
      setMessages(prev => [...prev, templateMsg])
      return
    }

    setInput('')
    setError(null)
    setLoading(true)

    if (textareaRef.current) textareaRef.current.style.height = '42px'

    const optimistic = { id: `opt-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fetch(`${API}/chat/message`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro desconhecido')
      setMessages(prev => [...prev, data.message])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // ─── Fluxo /teste-qa ─────────────────────────────────────────────────────

  function updateQaForm(field, value) {
    setQaForm(prev => ({ ...prev, [field]: value }))
    // Quando o projeto muda, busca config dele
    if (field === 'projectName') {
      const match = existingProjects.find(p => p.name === value)
      if (match) {
        setProjectConfig({
          projectType:       match.projectType || null,
          hasCache:          match.hasCache,
          hasSitemap:        match.hasSitemap,
          sitemapPageCount:  match.sitemapPageCount,
        })
        // Auto-preenche o tipo se já estiver salvo
        if (match.projectType) {
          setQaForm(prev => ({ ...prev, projectName: value, projectType: match.projectType }))
        }
      } else if (value) {
        setProjectConfig({ projectType: null, hasCache: false, hasSitemap: false })
      } else {
        setProjectConfig(null)
      }
    }
  }

  async function submitQaTest() {
    setQaFormError(null)
    if (!qaForm.title.trim())       { setQaFormError('Informe o título do teste'); return }
    if (!qaForm.previewUrl.trim())  { setQaFormError('Informe a URL de preview'); return }
    if (!qaForm.description.trim()) { setQaFormError('Informe a descrição da feature'); return }

    setQaFlow(prev => ({ ...prev, phase: 'submitting' }))

    try {
      // Monta critérios: lista + comportamento esperado como critério extra
      const criteria = [
        ...qaForm.criteria.map(c => c.trim()).filter(Boolean),
        ...(qaForm.expectedBehavior.trim()
          ? [`Comportamento esperado: ${qaForm.expectedBehavior.trim()}`]
          : []),
      ]

      const description = qaForm.description.trim() +
        (qaForm.notes.trim() ? `\n\nNotas adicionais: ${qaForm.notes.trim()}` : '')

      const res = await fetch(`${API}/dev-tests`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:         qaForm.title.trim(),
          description,
          previewUrl:    qaForm.previewUrl.trim(),
          projectName:   qaForm.projectName.trim() || undefined,
          criteria,
          projectType:   qaForm.projectType || undefined,
          requestRemap:  qaForm.requestRemap || undefined,
          loginEmail:    qaForm.loginEmail.trim() || undefined,
          loginPassword: qaForm.loginPassword.trim() || undefined,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar teste')

      setQaFlow(prev => ({ ...prev, phase: 'queued', testId: data.id }))
    } catch (e) {
      setQaFlow(prev => ({ ...prev, phase: 'error', report: e.message }))
    }
  }

  async function cancelQaTest() {
    if (qaFlow?.testId) {
      try {
        await fetch(`${API}/dev-tests/${qaFlow.testId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        })
      } catch {}
    }
    setQaFlow(null)
    setQaForm(EMPTY_FORM)
  }

  // ─── Outros ──────────────────────────────────────────────────────────────

  async function clearHistory() {
    if (!confirm('Limpar todo o histórico do chat?')) return
    await fetch(`${API}/chat/history`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    setMessages([])
    setError(null)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function handleInput(e) {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
  }

  function handleStarterClick(p) {
    if (p.isQaCommand)  { sendMessage('/teste-qa');  return }
    if (p.isPromptQa)   { sendMessage('/prompt-qa'); return }
    if (p.fill) {
      setInput(p.text)
      setTimeout(() => {
        inputRef.current?.focus()
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 128) + 'px'
        }
      }, 50)
    } else {
      sendMessage(p.text)
    }
  }

  const isEmpty = !loadingHistory && messages.length === 0 && !qaFlow
  const inputBlocked = qaFlow?.phase === 'form' || qaFlow?.phase === 'submitting'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-purple-600 dark:text-purple-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">Agente de QA</h1>
            <p className="text-[11px] text-gray-400 leading-tight">
              Digite <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-blue-600 dark:text-blue-400">/teste-qa</code> para executar um teste automatizado
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AgentInstallButton />
          {messages.length > 0 && (
            <button onClick={clearHistory} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">
              Limpar histórico
            </button>
          )}
          <Link to="/"><NocorpLogo height={24} /></Link>
        </div>
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loadingHistory ? (
          <div className="flex justify-center items-center h-full">
            <p className="text-sm text-gray-400">Carregando histórico...</p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-purple-600 dark:text-purple-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Agente de QA</h2>
              <p className="text-sm text-gray-400 mt-1 max-w-sm text-center leading-relaxed">
                Faça perguntas de QA ou execute testes automatizados com o comando <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-blue-600 dark:text-blue-400 text-xs">/teste-qa</code>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {STARTER_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleStarterClick(p)}
                  className={`text-left px-4 py-3 rounded-xl border transition-all ${
                    p.isQaCommand || p.isPromptQa
                      ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/40'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Mensagens normais */}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && <BotAvatar />}
                <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-tr-sm'
                    : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm shadow-sm'
                }`}>
                  <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                  <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-purple-200' : 'text-gray-400'}`}>
                    {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {msg.role === 'user' && <UserAvatar />}
              </div>
            ))}

            {/* Indicador de digitação */}
            {loading && (
              <div className="flex gap-2.5 justify-start">
                <BotAvatar />
                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            )}

            {/* Painel /teste-qa — renderizado inline no stream de mensagens */}
            {qaFlow && (
              <div className="mt-2">
                {(qaFlow.phase === 'form' || qaFlow.phase === 'submitting') && (
                  <TestForm
                    form={qaForm}
                    onChange={updateQaForm}
                    onSubmit={submitQaTest}
                    onCancel={cancelQaTest}
                    submitting={qaFlow.phase === 'submitting'}
                    formError={qaFormError}
                    existingProjects={existingProjects}
                    projectConfig={projectConfig}
                  />
                )}
                {(qaFlow.phase === 'queued' || qaFlow.phase === 'running') && (
                  <TestExecutionCard
                    phase={qaFlow.phase}
                    testId={qaFlow.testId}
                    onCancel={cancelQaTest}
                  />
                )}
                {(qaFlow.phase === 'done' || qaFlow.phase === 'error') && (
                  <TestResultCard
                    phase={qaFlow.phase}
                    report={qaFlow.report}
                    tokensUsed={qaFlow.tokensUsed}
                    onClose={() => setQaFlow(null)}
                  />
                )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <span>⚠️</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Input — desabilitado durante preenchimento do formulário */}
      <div className="shrink-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={el => { inputRef.current = el; textareaRef.current = el }}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            disabled={inputBlocked}
            placeholder={
              inputBlocked
                ? 'Preencha o formulário acima para executar o teste...'
                : 'Digite uma mensagem… ou /teste-qa para iniciar um teste automatizado'
            }
            rows={1}
            className={`flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all overflow-y-auto ${
              inputBlocked
                ? 'bg-gray-100 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500'
            }`}
            style={{ minHeight: '42px', maxHeight: '128px' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading || inputBlocked}
            className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white disabled:text-gray-400 dark:disabled:text-gray-500 flex items-center justify-center transition-all shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[11px] text-gray-400 dark:text-gray-600 mt-1.5">
          Powered by OpenAI · gpt-4o-mini · histórico salvo para contexto entre sessões
        </p>
      </div>
    </div>
  )
}
