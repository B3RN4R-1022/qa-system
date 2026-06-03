import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import API from '@/lib/api'
import { NocorpLogo } from '@/components/NocorpLogo'
import { useAuth } from '@/contexts/AuthContext'
import AgentInstallButton from '@/components/AgentInstallButton'

// Renderiza markdown básico
function parseBold(text) {
  const parts = text.split(/\*\*(.*?)\*\*/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  )
}

function ReportContent({ content }) {
  return (
    <div className="text-sm leading-relaxed space-y-0.5 text-gray-700 dark:text-gray-300">
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />
        if (line.startsWith('## ')) return <p key={i} className="font-semibold mt-2">{line.slice(3)}</p>
        if (line.startsWith('### ')) return <p key={i} className="font-medium mt-1.5">{line.slice(4)}</p>
        if (line.startsWith('- ') || line.startsWith('* '))
          return <div key={i} className="flex gap-1.5 ml-2"><span className="shrink-0 text-gray-400 mt-0.5">•</span><span>{parseBold(line.slice(2))}</span></div>
        return <p key={i}>{parseBold(line)}</p>
      })}
    </div>
  )
}

const STATUS_LABEL = {
  queued:  'Na fila',
  running: 'Executando',
  done:    'Concluído',
  error:   'Erro',
}
const STATUS_COLOR = {
  queued:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  done:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  error:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const STATUS_ICON = { queued: '🕐', running: '⚙️', done: '✅', error: '❌' }

const FILTER_OPTIONS = [
  { value: 'all',     label: 'Todos' },
  { value: 'queued',  label: 'Na fila' },
  { value: 'running', label: 'Executando' },
  { value: 'done',    label: 'Concluídos' },
  { value: 'error',   label: 'Com erro' },
]

function TestCard({ test, onDelete, onRerun, isQA }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rerunning, setRerunning] = useState(false)

  const isActive = test.status === 'queued' || test.status === 'running'
  const isFinished = test.status === 'done' || test.status === 'error'
  const criteria = test.criteria ? JSON.parse(test.criteria) : []
  const token = localStorage.getItem('qa_token')

  async function handleDelete() {
    if (!confirm('Remover este teste?')) return
    setDeleting(true)
    try {
      await fetch(`${API}/dev-tests/${test.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      onDelete(test.id)
    } catch { setDeleting(false) }
  }

  async function handleRerun() {
    setRerunning(true)
    try {
      const res = await fetch(`${API}/dev-tests/${test.id}/rerun`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok) {
        onRerun(data)
        setExpanded(false)
      }
    } catch {}
    finally { setRerunning(false) }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden transition-all hover:shadow-sm">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0 mt-0.5">{STATUS_ICON[test.status] || '🔵'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{test.title}</h3>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[test.status]}`}>
                {STATUS_LABEL[test.status] || test.status}
              </span>
              {isActive && (
                <span className="flex gap-0.5">
                  {[0,1,2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: `${i*0.2}s` }} />
                  ))}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-400 dark:text-gray-500">
              {test.projectName && (
                <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full font-medium">
                  {test.projectName}
                </span>
              )}
              {isQA && test.user && (
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[9px] font-bold text-blue-600 dark:text-blue-400">
                    {test.user.name?.[0]?.toUpperCase()}
                  </span>
                  {test.user.name}
                </span>
              )}
              <span>{new Date(test.createdAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
              {test.tokensUsed && (
                <span>{test.tokensUsed.toLocaleString('pt-BR')} tokens</span>
              )}
              {test.previewUrl && (
                <a
                  href={test.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline"
                  onClick={e => e.stopPropagation()}
                >
                  Preview →
                </a>
              )}
            </div>

            {/* Descrição resumida */}
            {test.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-2">{test.description}</p>
            )}

            {/* Critérios */}
            {criteria.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {criteria.slice(0, 3).map((c, i) => (
                  <span key={i} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                    {c.length > 40 ? c.slice(0, 40) + '…' : c}
                  </span>
                ))}
                {criteria.length > 3 && (
                  <span className="text-[10px] text-gray-400">+{criteria.length - 3} critérios</span>
                )}
              </div>
            )}
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1 shrink-0">
            {test.report && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                {expanded ? 'Fechar' : 'Ver relatório'}
              </button>
            )}
            {isFinished && (
              <button
                onClick={handleRerun}
                disabled={rerunning}
                title="Re-executar este teste com os mesmos dados"
                className="text-xs text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 px-2 py-1 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-900/10 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {rerunning ? (
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {rerunning ? 'Enfileirando...' : 'Re-executar'}
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 px-2 py-1 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              {deleting ? '...' : 'Remover'}
            </button>
          </div>
        </div>
      </div>

      {/* Relatório expandido */}
      {expanded && test.report && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
          <ReportContent content={test.report} />
        </div>
      )}

      {/* Barra de progresso enquanto executa */}
      {isActive && (
        <div className="h-0.5 bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-400 to-purple-400 animate-pulse w-full" />
        </div>
      )}
    </div>
  )
}

export default function DevTests() {
  const { isQA, isAdmin, isDev } = useAuth()
  const navigate = useNavigate()
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('all')
  const token = localStorage.getItem('qa_token')

  useEffect(() => { fetchTests() }, [])

  // Auto-refresh quando há testes ativos
  useEffect(() => {
    const hasActive = tests.some(t => t.status === 'queued' || t.status === 'running')
    if (!hasActive) return
    const interval = setInterval(fetchTests, 5000)
    return () => clearInterval(interval)
  }, [tests])

  async function fetchTests() {
    try {
      const res = await fetch(`${API}/dev-tests`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setTests(Array.isArray(data) ? data : [])
    } catch {}
    finally { setLoading(false) }
  }

  function handleDelete(id) {
    setTests(prev => prev.filter(t => t.id !== id))
  }

  function handleRerun(updatedTest) {
    setTests(prev => prev.map(t => t.id === updatedTest.id ? updatedTest : t))
  }

  const testsFiltrados = tests.filter(t =>
    filtroStatus === 'all' ? true : t.status === filtroStatus
  )

  const activeCount = tests.filter(t => t.status === 'queued' || t.status === 'running').length

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{isDev ? 'Meus Testes' : 'Testes QA'}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Testes automatizados {isDev ? 'iniciados por você' : 'de todos os devs'} via chat
          </p>
          {activeCount > 0 && (
            <p className="text-xs text-amber-500 font-medium mt-1">
              ⚙️ {activeCount} teste{activeCount > 1 ? 's' : ''} em execução
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AgentInstallButton />
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Novo teste
          </button>
          <Link to="/"><NocorpLogo height={28} /></Link>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {FILTER_OPTIONS.map(f => (
          <button
            key={f.value}
            onClick={() => setFiltroStatus(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filtroStatus === f.value
                ? 'bg-black dark:bg-white dark:text-black text-white'
                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400'
            }`}
          >
            {f.label}
            {f.value !== 'all' && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {tests.filter(t => t.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : testsFiltrados.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-blue-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            {filtroStatus === 'all' ? 'Nenhum teste ainda' : `Nenhum teste com status "${STATUS_LABEL[filtroStatus]}"`}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Digite <code className="bg-gray-100 dark:bg-gray-800 px-1.5 rounded text-blue-600 dark:text-blue-400">/teste-qa</code> no chat para criar um novo teste
          </p>
          <button
            onClick={() => navigate('/chat')}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Ir para o chat
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-400 mb-3">
            {testsFiltrados.length} teste{testsFiltrados.length !== 1 ? 's' : ''}
          </p>
          {testsFiltrados.map(test => (
            <TestCard
              key={test.id}
              test={test}
              onDelete={handleDelete}
              onRerun={handleRerun}
              isQA={isQA || isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  )
}
