import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

function QAReview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState(null)
  const [checks, setChecks] = useState([])
  const [comentario, setComentario] = useState('')
  const [reprovar, setReprovar] = useState(false)

  useEffect(() => {
    fetch(`http://localhost:3001/tasks/${id}`)
      .then(r => r.json())
      .then(data => {
        setTask(data)
        setChecks(data.checks || [])
      })
  }, [id])

  function toggleCheck(checkId) {
    setChecks(prev =>
      prev.map(c => c.id === checkId ? { ...c, checked: !c.checked } : c)
    )
  }

  async function handleAprovar() {
    const res = await fetch(`http://localhost:3001/tasks/${id}/approve`, {
      method: 'POST'
    })
    if (res.ok) {
      alert('Task aprovada!')
      navigate('/')
    } else {
      const err = await res.json()
      alert('Erro: ' + err.error)
    }
  }

  async function handleReprovar() {
    const res = await fetch(`http://localhost:3001/tasks/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comentario, checks })
    })
    if (res.ok) {
      alert('Task reprovada e comentário enviado ao dev!')
      navigate('/')
    } else {
      const err = await res.json()
      alert('Erro: ' + err.error)
    }
  }

  if (!task) return <p className="p-8">Carregando...</p>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button onClick={() => navigate('/')} className="text-sm text-gray-500 mb-4 hover:underline">
        ← Voltar
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">{task.title}</h1>
        <div className="flex gap-2">
          {task.previewUrl && (
            <Button variant="outline" onClick={() => window.open(task.previewUrl, '_blank')}>
              Abrir Preview
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Critérios de Aceitação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {checks.map(check => (
              <label key={check.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={check.checked}
                  onChange={() => toggleCheck(check.id)}
                  className="mt-1"
                />
                <span className={check.checked ? 'line-through text-gray-400' : ''}>
                  {check.label}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        {/* Informações da task */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-medium">Responsável:</span> {task.assignee || '—'}</p>
            <p><span className="font-medium">Status:</span> <Badge variant="secondary">{task.status}</Badge></p>
            <p><span className="font-medium">Checks:</span> {checks.filter(c => c.checked).length}/{checks.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Área de reprovar */}
      {reprovar && (
        <div className="mt-6">
          <Textarea
            placeholder="Descreva o que precisa ser corrigido..."
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            className="mb-2"
          />
        </div>
      )}

      {/* Botões */}
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="destructive" onClick={() => setReprovar(!reprovar)}>
          {reprovar ? 'Cancelar' : 'Reprovar'}
        </Button>
        {reprovar && (
          <Button variant="destructive" disabled={!comentario} onClick={handleReprovar}>
            Confirmar Reprovação
          </Button>
        )}
        <Button disabled={checks.some(c => !c.checked)} onClick={handleAprovar}>
          Aprovar ✓
        </Button>
      </div>
    </div>
  )
}

export default QAReview