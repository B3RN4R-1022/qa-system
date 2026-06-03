import { useEffect, useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import API from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { NocorpLogo } from '@/components/NocorpLogo'
import { useAuth } from '@/contexts/AuthContext'

const STATUS_FILTROS = [
  { label: 'Todas', value: 'all' },
  { label: 'Em QA', value: 'in_qa' },
  { label: 'Sugerido', value: 'suggested' },
  { label: 'Aprovado', value: 'approved' },
  { label: 'Reprovado', value: 'rejected' }
]

const STATUS_PT = {
  pending: 'Pendente',
  in_qa: 'Em QA',
  suggested: 'Sugerido',
  approved: 'Aprovado',
  rejected: 'Reprovado'
}

const STATUS_COLOR = {
  pending:   'bg-gray-100 text-gray-600',
  in_qa:     'bg-blue-100 text-blue-700',
  suggested: 'bg-amber-100 text-amber-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700'
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-400 font-medium uppercase tracking-wide px-1">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1 text-sm text-gray-700 dark:text-gray-200 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-black hover:border-gray-400 transition-colors min-w-[160px]"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

function Dashboard() {
  const navigate = useNavigate()
  const { isDev, user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null)
  const [filtroStatus, setFiltroStatus] = useState('all')
  const [filtroDev, setFiltroDev] = useState('all')
  const [filtroProjeto, setFiltroProjeto] = useState('all')

  const token = localStorage.getItem('qa_token')

  function fetchTasks(isManual = false) {
    if (isManual) setLoading(true)
    fetch(`${API}/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => { if (r.status === 401) { logout(); return null } return r.json() })
      .then(data => {
        if (!data) return
        if (!Array.isArray(data)) { setErro('Erro ao carregar tasks.'); setLoading(false); return }
        setTasks(data)
        setUltimaAtualizacao(new Date())
        setLoading(false)
      })
      .catch(() => { setErro('Erro ao carregar tasks.'); setLoading(false) })
  }

  useEffect(() => {
    fetchTasks(true)
    const interval = setInterval(() => fetchTasks(), 30000) // atualiza a cada 30s
    return () => clearInterval(interval)
  }, [])

  const devOptions = useMemo(() => {
    const set = new Set(tasks.map(t => t.assignee).filter(Boolean))
    return [{ value: 'all', label: 'Todos os devs' }, ...[...set].map(d => ({ value: d, label: d }))]
  }, [tasks])

  const projetoOptions = useMemo(() => {
    const set = new Set(tasks.map(t => t.projectName).filter(Boolean))
    return [{ value: 'all', label: 'Todos os projetos' }, ...[...set].map(p => ({ value: p, label: p }))]
  }, [tasks])

  const tasksFiltradas = useMemo(() => {
    return tasks.filter(t => {
      // Dev só vê as suas próprias tasks
      if (isDev) {
        if (t.assigneeEmail) {
          // Match exato por email (tasks novas com email capturado do Asana)
          if (t.assigneeEmail !== user?.email) return false
        } else if (user?.name) {
          // Fallback por nome aproximado para tasks antigas sem email
          const assignee = (t.assignee || '').toLowerCase()
          const uname = user.name.toLowerCase()
          if (!assignee.includes(uname) && !uname.includes(assignee)) return false
        } else {
          return false
        }
      }
      if (filtroStatus !== 'all') {
        if (filtroStatus === 'rejected') {
          if (t.status !== 'rejected' && !t.wasRejectedBefore) return false
        } else if (filtroStatus === 'suggested') {
          if (t.status !== 'suggested' && !t.wasSuggestedBefore) return false
        } else if (t.status !== filtroStatus) {
          return false
        }
      }
      if (!isDev && filtroDev !== 'all' && t.assignee !== filtroDev) return false
      if (filtroProjeto !== 'all' && t.projectName !== filtroProjeto) return false
      return true
    })
  }, [tasks, filtroStatus, filtroDev, filtroProjeto, isDev, user])

  if (loading) return <p className="p-8">Carregando...</p>

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{isDev ? 'Minhas Tasks' : 'Tasks em QA'}</h1>
          {isDev && (
            <p className="text-xs text-blue-500 mt-0.5 font-medium">Visualização somente leitura</p>
          )}
          {ultimaAtualizacao && (
            <p className="text-xs text-gray-400 mt-0.5">
              Atualizado às {ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              <button onClick={() => fetchTasks(true)} className="ml-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline">
                atualizar agora
              </button>
            </p>
          )}
        </div>
        <Link to="/"><NocorpLogo height={28} /></Link>
      </div>

      {/* Filtros */}
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        {/* Status */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wide px-1">Status</span>
          <div className="flex gap-1">
            {STATUS_FILTROS.map(f => (
              <button
                key={f.value}
                onClick={() => setFiltroStatus(f.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filtroStatus === f.value
                    ? 'bg-black dark:bg-white dark:text-black text-white'
                    : 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filtro "Dev" só aparece para QA/admin */}
        {!isDev && (
          <FilterSelect
            label="Dev"
            value={filtroDev}
            onChange={setFiltroDev}
            options={devOptions}
          />
        )}

        <FilterSelect
          label="Projeto"
          value={filtroProjeto}
          onChange={setFiltroProjeto}
          options={projetoOptions}
        />

        {/* Limpar filtros */}
        {(filtroStatus !== 'all' || filtroDev !== 'all' || filtroProjeto !== 'all') && (
          <button
            onClick={() => { setFiltroStatus('all'); setFiltroDev('all'); setFiltroProjeto('all') }}
            className="text-xs text-gray-400 hover:text-gray-700 underline self-end pb-2 transition-colors"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {erro && <p className="text-red-500 mb-4">{erro}</p>}

      {/* Contagem */}
      <p className="text-sm text-gray-400 mb-3">
        {tasksFiltradas.length} task{tasksFiltradas.length !== 1 ? 's' : ''}
      </p>

      {tasksFiltradas.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">Nenhuma task encontrada</p>
          <p className="text-sm mt-1">Tente ajustar os filtros</p>
        </div>
      )}

      {/* Cards */}
      <div className="grid gap-3">
        {tasksFiltradas.map(task => (
          <div
            key={task.id}
            onClick={() => !isDev && navigate(`/review/${task.id}`)}
            className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 transition-all
              ${isDev
                ? 'cursor-default opacity-90'
                : 'cursor-pointer hover:shadow-md hover:border-gray-300 dark:hover:border-gray-500'
              }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 dark:text-white truncate">{task.title}</p>
                  {/* Tags de histórico */}
                  {task.wasRejectedBefore && task.status !== 'rejected' && (
                    <span className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
                      Já reprovada
                    </span>
                  )}
                  {task.wasSuggestedBefore && task.status !== 'suggested' && (
                    <span className="bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
                      Teve sugestão
                    </span>
                  )}
                  {task.returnCount > 0 && (
                    <span className="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-600 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0">
                      ↩ {task.returnCount}×
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {task.assignee && (
                    <span className="flex items-center gap-1">
                      <span className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                        {task.assignee[0].toUpperCase()}
                      </span>
                      {task.assignee}
                    </span>
                  )}
                  {task.projectName && (
                    <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full text-xs font-medium">
                      {task.projectName}
                    </span>
                  )}
                  <span className="text-gray-400">
                    {task.checks?.filter(c => c.checked).length}/{task.checks?.length} checks
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLOR[task.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_PT[task.status] || task.status}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(task.createdAt).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Dashboard
