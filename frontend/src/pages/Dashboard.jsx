import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function Dashboard() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('http://localhost:3001/tasks')
      .then(r => r.json())
      .then(data => {
        setTasks(data)
        setLoading(false)
      })
  }, [])

  if (loading) return <p className="p-8">Carregando...</p>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Tasks em QA</h1>

      {tasks.length === 0 && (
        <p className="text-gray-500">Nenhuma task pendente.</p>
      )}

      <div className="grid gap-4">
        {tasks.map(task => (
          <Card
            key={task.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate(`/review/${task.id}`)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{task.title}</CardTitle>
                <Badge variant={task.status === 'pending' ? 'secondary' : task.status === 'approved' ? 'default' : 'destructive'}>
                  {task.status === 'pending' ? 'Pendente' : task.status === 'approved' ? 'Aprovado' : 'Reprovado'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                Responsável: {task.assignee || 'Não atribuído'}
              </p>
              <p className="text-sm text-gray-500">
                Checks: {task.checks?.filter(c => c.checked).length}/{task.checks?.length}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Dashboard