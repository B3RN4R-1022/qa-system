import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import API from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
        className="h-9 rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-black hover:border-gray-400 transition-colors min-w-[160px]"
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
  const { user, logout } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [filtroStatus, setFiltroStatus] = useState('all')
  const [filtroDev, setFiltroDev] = useState('all')
  const [filtroProjeto, setFiltroProjeto] = useState('all')

  const token = localStorage.getItem('qa_token')

  useEffect(() => {
    fetch(`${API}/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { setTasks(data); setLoading(false) })
      .catch(() => { setErro('Erro ao carregar tasks.'); setLoading(false) })
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
      if (filtroStatus !== 'all' && t.status !== filtroStatus) return false
      if (filtroDev !== 'all' && t.assignee !== filtroDev) return false
      if (filtroProjeto !== 'all' && t.projectName !== filtroProjeto) return false
      return true
    })
  }, [tasks, filtroStatus, filtroDev, filtroProjeto])

  if (loading) return <p className="p-8">Carregando...</p>

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Tasks em QA</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Olá, <span className="font-medium text-gray-700">{user?.name}</span></span>
          <Button variant="outline" size="sm" onClick={logout}>Sair</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
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
                    ? 'bg-black text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <FilterSelect
          label="Dev"
          value={filtroDev}
          onChange={setFiltroDev}
          options={devOptions}
        />

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
            onClick={() => navigate(`/review/${task.id}`)}
            className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{task.title}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
                  {task.assignee && (
                    <span className="flex items-center gap-1">
                      <span className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                        {task.assignee[0].toUpperCase()}
                      </span>
                      {task.assignee}
                    </span>
                  )}
                  {task.projectName && (
                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs font-medium">
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
