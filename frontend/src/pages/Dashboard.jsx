import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import API from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

const FILTROS = [
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
  const [filtro, setFiltro] = useState('all')

  const token = localStorage.getItem('qa_token')

  useEffect(() => {
    fetch(`${API}/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        setTasks(data)
        setLoading(false)
      })
      .catch(() => {
        setErro('Erro ao carregar tasks. Verifique se o backend está rodando.')
        setLoading(false)
      })
  }, [])

  const tasksFiltradas = filtro === 'all'
    ? tasks
    : tasks.filter(t => t.status === filtro)

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
      <div className="flex gap-2 mb-6">
        {FILTROS.map(f => (
          <Button
            key={f.value}
            variant={filtro === f.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFiltro(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Erro */}
      {erro && <p className="text-red-500 mb-4">{erro}</p>}

      {/* Lista */}
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
              <p className="text-sm text-gray-500">
                Responsável: {task.assignee || 'Não atribuído'}
              </p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-sm text-gray-500">
                  Checks: {task.checks?.filter(c => c.checked).length}/{task.checks?.length}
                </p>
                <p className="text-xs text-gray-400">
                  {new Date(task.createdAt).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                  })}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Dashboard
