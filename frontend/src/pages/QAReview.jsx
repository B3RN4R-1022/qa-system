import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import API from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

const STATUS_PT = {
  pending: 'Pendente',
  in_qa: 'Em QA',
  suggested: 'Solicitado',
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

function QAReview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = localStorage.getItem('qa_token')

  const [task, setTask] = useState(null)
  const [checks, setChecks] = useState([])
  const [acao, setAcao] = useState(null) // null | 'approve' | 'suggest' | 'reject'
  const [comentario, setComentario] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [imgIndex, setImgIndex] = useState(0)
  const [lightbox, setLightbox] = useState(false)

  useEffect(() => {
    fetch(`${API}/tasks/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { setTask(data); setChecks(data.checks || []) })
      .catch(() => setErro('Erro ao carregar a task. Verifique se o backend está rodando.'))
  }, [id])

  useEffect(() => {
    if (!task) return
    fetch(`${API}/tasks/${id}/attachments`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => setAttachments(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [task])

  useEffect(() => {
    function onKeyDown(e) {
      if (!lightbox) return
      if (e.key === 'Escape') setLightbox(false)
      if (e.key === 'ArrowLeft') setImgIndex(i => (i - 1 + attachments.length) % attachments.length)
      if (e.key === 'ArrowRight') setImgIndex(i => (i + 1) % attachments.length)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightbox, attachments.length])

  function toggleCheck(checkId) {
    setChecks(prev => prev.map(c => c.id === checkId ? { ...c, checked: !c.checked } : c))
  }

  function toggleAcao(nova) {
    setAcao(prev => prev === nova ? null : nova)
    setComentario('')
    setErro(null)
  }

  async function handleAprovar() {
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch(`${API}/tasks/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ checks })
      })
      if (res.ok) { alert('Task aprovada!'); navigate('/') }
      else { const err = await res.json(); setErro(err.error || 'Erro ao aprovar.') }
    } catch { setErro('Erro de rede.') }
    finally { setLoading(false) }
  }

  async function confirmar() {
    setLoading(true)
    setErro(null)
    const endpoint = acao === 'suggest' ? 'suggest' : 'reject'
    try {
      const res = await fetch(`${API}/tasks/${id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ checks, comentario })
      })
      if (res.ok) {
        alert(acao === 'suggest' ? 'Alteração solicitada!' : 'Task recusada!')
        navigate('/')
      } else {
        const err = await res.json()
        setErro(err.error || 'Erro ao processar ação.')
      }
    } catch { setErro('Erro de rede.') }
    finally { setLoading(false) }
  }

  if (!task && !erro) return <p className="p-8">Carregando...</p>
  if (erro && !task) return (
    <div className="p-8">
      <p className="text-red-500">{erro}</p>
      <button onClick={() => navigate('/')} className="text-sm text-gray-500 mt-4 hover:underline">← Voltar</button>
    </div>
  )

  const checksNaoFeitos = checks.filter(c => !c.checked)
  const podeConfirmar = acao === 'suggest'
    ? comentario.trim().length > 0  // solicitar alteração precisa de comentário
    : true                           // recusar: comentário é opcional

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button onClick={() => navigate('/')} className="text-sm text-gray-500 mb-4 hover:underline">
        ← Voltar
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">{task.title}</h1>
        {task.previewUrl && (
          <Button variant="outline" onClick={() => window.open(task.previewUrl, '_blank')}>
            Abrir Preview
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Checklist */}
        <Card>
          <CardHeader><CardTitle className="text-base">Critérios de Aceitação</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {checks.map(check => (
              <label key={check.id} className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={check.checked} onChange={() => toggleCheck(check.id)} className="mt-1" />
                <span className={check.checked ? 'line-through text-gray-400' : ''}>{check.label}</span>
              </label>
            ))}
          </CardContent>
        </Card>

        {/* Informações */}
        <Card>
          <CardHeader><CardTitle className="text-base">Informações</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-medium">Responsável:</span> {task.assignee || '—'}</p>
            <p>
              <span className="font-medium">Status: </span>
              <Badge variant={STATUS_VARIANT[task.status] || 'secondary'}>
                {STATUS_PT[task.status] || task.status}
              </Badge>
            </p>
            <p><span className="font-medium">Checks:</span> {checks.filter(c => c.checked).length}/{checks.length}</p>
            {task.mockupUrl && (
              <p>
                <span className="font-medium">Mockup: </span>
                <a href={task.mockupUrl} target="_blank" rel="noreferrer"
                  className="text-blue-600 hover:underline break-all">
                  Abrir ↗
                </a>
              </p>
            )}
            {task.testUrl && (
              <p>
                <span className="font-medium">Link de Teste: </span>
                <a href={task.testUrl} target="_blank" rel="noreferrer"
                  className="text-blue-600 hover:underline break-all">
                  Abrir ↗
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Screenshots */}
      {attachments.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              Screenshots <span className="text-gray-400 font-normal text-sm ml-1">({attachments.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative bg-gray-50 rounded-lg overflow-hidden flex items-center justify-center" style={{ minHeight: '200px' }}>
              <img
                src={attachments[imgIndex].download_url}
                alt={attachments[imgIndex].name}
                className="w-full max-h-[480px] object-contain cursor-zoom-in"
                onClick={() => setLightbox(true)}
                title="Clique para ampliar"
              />
              {attachments.length > 1 && (
                <>
                  <button onClick={() => setImgIndex(i => (i - 1 + attachments.length) % attachments.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-9 h-9 flex items-center justify-center text-xl transition-colors">‹</button>
                  <button onClick={() => setImgIndex(i => (i + 1) % attachments.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-9 h-9 flex items-center justify-center text-xl transition-colors">›</button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {attachments.map((_, i) => (
                      <button key={i} onClick={() => setImgIndex(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${i === imgIndex ? 'bg-white' : 'bg-white/50 hover:bg-white/80'}`} />
                    ))}
                  </div>
                </>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center truncate">{attachments[imgIndex].name}</p>
          </CardContent>
        </Card>
      )}

      {/* Lightbox */}
      {lightbox && attachments.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setLightbox(false)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl" onClick={() => setLightbox(false)}>✕</button>
          <img src={attachments[imgIndex].download_url} alt={attachments[imgIndex].name}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-2xl cursor-zoom-out"
            onClick={e => e.stopPropagation()} />
          {attachments.length > 1 && (
            <>
              <button className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full w-11 h-11 flex items-center justify-center text-2xl"
                onClick={e => { e.stopPropagation(); setImgIndex(i => (i - 1 + attachments.length) % attachments.length) }}>‹</button>
              <button className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full w-11 h-11 flex items-center justify-center text-2xl"
                onClick={e => { e.stopPropagation(); setImgIndex(i => (i + 1) % attachments.length) }}>›</button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">{imgIndex + 1} / {attachments.length}</div>
            </>
          )}
        </div>
      )}

      {/* Painel da ação selecionada */}
      {acao && (
        <Card className="mt-6 border-2 border-dashed">
          <CardContent className="pt-4 space-y-3">

            {/* Solicitar alterações — comentário obrigatório */}
            {acao === 'suggest' && (
              <Textarea
                placeholder="Descreva o que precisa ser alterado..."
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                rows={4}
                autoFocus
              />
            )}

            {/* Recusar — checks não feitos + comentário opcional */}
            {acao === 'reject' && (
              <>
                {checksNaoFeitos.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                    <p className="font-medium text-red-700 mb-1">Itens não verificados:</p>
                    <ul className="space-y-0.5 text-red-600">
                      {checksNaoFeitos.map(c => <li key={c.id}>• {c.label}</li>)}
                    </ul>
                  </div>
                )}
                <Textarea
                  placeholder="Comentário adicional (opcional)..."
                  value={comentario}
                  onChange={e => setComentario(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </>
            )}

            {erro && <p className="text-sm text-red-500">{erro}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => toggleAcao(acao)} disabled={loading}>Cancelar</Button>
              <Button
                disabled={!podeConfirmar || loading}
                onClick={confirmar}
                className={
                  acao === 'approve' ? 'bg-green-600 hover:bg-green-700 text-white' :
                  acao === 'suggest' ? 'bg-amber-500 hover:bg-amber-600 text-white' :
                  'bg-red-600 hover:bg-red-700 text-white'
                }
              >
                {loading ? 'Enviando...' :
                  acao === 'approve' ? '✓ Confirmar Aprovação' :
                  acao === 'suggest' ? '↺ Confirmar Solicitação' :
                  '✗ Confirmar Recusa'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botões de ação */}
      <div className="flex justify-end items-center gap-3 mt-6">
        <button onClick={() => toggleAcao('reject')} disabled={loading} title="Recusar"
          className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-lg font-bold transition-colors ${
            acao === 'reject' ? 'border-red-500 bg-red-500 text-white' : 'border-gray-300 text-red-400 hover:border-red-400 hover:text-red-500'
          }`}>✗</button>

        <button onClick={() => toggleAcao('suggest')} disabled={loading} title="Solicitar alterações"
          className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-lg transition-colors ${
            acao === 'suggest' ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-300 text-gray-500 hover:border-amber-400 hover:text-amber-500'
          }`}>↺</button>

        <button
          onClick={handleAprovar}
          disabled={loading || checksNaoFeitos.length > 0}
          title={checksNaoFeitos.length > 0 ? 'Marque todos os critérios antes de aprovar' : 'Aprovar'}
          className="flex items-center gap-2 px-5 py-2 rounded-lg border-2 border-green-500 text-green-600 hover:bg-green-50 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          ✓ Aprovar
        </button>
      </div>
    </div>
  )
}

export default QAReview
