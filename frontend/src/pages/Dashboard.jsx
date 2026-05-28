import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import API from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

const STATUS_VARIANT = {
  pending: 'secondary',
  in_qa: 'secondary',
  suggested: 'secondary',
  approved: 'default',
  rejected: 'destructive'
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

  // Lista única de devs e projetos para os selects
  const devs = useMemo(() => {
    const set = new Set(tasks.map(t => t.assignee).filter(Boolean))
    return ['all', ...set]
  }, [tasks])

  const projetos = useMemo(() => {
    const set = new Set(tasks.map(t => t.projectName).filter(Boolean))
    return ['all', ...set]
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
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks em QA</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Olá, {user?.name}</span>
          <Button variant="outline" size="sm" onClick={logout}>Sair</Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status */}
        <div className="flex gap-1">
          {STATUS_FILTROS.map(f => (
            <Button
              key={f.value}
              variant={filtroStatus === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFiltroStatus(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {/* Dev */}
        {devs.length > 1 && (
          <select
            value={filtroDev}
            onChange={e => setFiltroDev(e.target.value)}
            className="border rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="all">Todos os devs</option>
            {devs.filter(d => d !== 'all').map(dev => (
              <option key={dev} value={dev}>{dev}</option>
            ))}
          </select>
        )}

        {/* Projeto */}
        {projetos.length > 1 && (
          <select
            value={filtroProjeto}
            onChange={e => setFiltroProjeto(e.target.value)}
            className="border rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="all">Todos os projetos</option>
            {projetos.filter(p => p !== 'all').map(proj => (
              <option key={proj} value={proj}>{proj}</option>
            ))}
          </select>
        )}
      </div>

      {erro && <p className="text-red-500 mb-4">{erro}</p>}

      {tasksFiltradas.length === 0 && (
        <p className="text-gray-500">Nenhuma task encontrada.</p>
      )}

      <div className="grid gap-4">
        {tasksFiltradas.map(task => (
          <Card
            key={task.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(`/review/${task.id}`)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{task.title}</CardTitle>
                <Badge variant={STATUS_VARIANT[task.status] || 'secondary'}>
                  {STATUS_PT[task.status] || task.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex gap-4">
                  <span>Dev: <span className="font-medium text-gray-700">{task.assignee || 'Não atribuído'}</span></span>
                  {task.projectName && (
                    <span>Projeto: <span className="font-medium text-gray-700">{task.projectName}</span></span>
                  )}
                  <span>Checks: {task.checks?.filter(c => c.checked).length}/{task.checks?.length}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(task.createdAt).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                  })}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Dashboard
