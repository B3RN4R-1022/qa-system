import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import API from '@/lib/api'
import { Button } from '@/components/ui/button'
import { NocorpLogo } from '@/components/NocorpLogo'
import { useAuth } from '@/contexts/AuthContext'

const token = () => localStorage.getItem('qa_token')

// ─── Seção: Webhooks ───────────────────────────────────────────────────────────
function WebhooksSection() {
  const [webhookUrl, setWebhookUrl] = useState(
    () => localStorage.getItem('qa_webhook_url') || `${API}/webhook`
  )
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)

  async function registrarWebhooks() {
    setLoading(true); setResultado(null); setErro(null)
    try {
      const res = await fetch(`${API}/admin/setup-webhooks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl })
      })
      const data = await res.json()
      if (!res.ok) setErro(data.error || 'Erro ao registrar webhooks')
      else setResultado(data)
    } catch { setErro('Erro de rede.') }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Projetos do Asana</h2>
      <p className="text-sm text-gray-400 mb-4">
        Registra webhooks em todos os projetos do workspace. Use sempre que adicionar um projeto novo no Asana.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">URL do backend</label>
          <input
            type="text"
            value={webhookUrl}
            onChange={e => {
              setWebhookUrl(e.target.value)
              localStorage.setItem('qa_webhook_url', e.target.value)
            }}
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <Button onClick={registrarWebhooks} disabled={loading} className="w-full">
          {loading ? 'Registrando...' : '🔗 Registrar webhooks em todos os projetos'}
        </Button>
      </div>
      {erro && <p className="mt-3 text-sm text-red-500">{erro}</p>}
      {resultado && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {resultado.total} projeto{resultado.total !== 1 ? 's' : ''} encontrado{resultado.total !== 1 ? 's' : ''}:
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {resultado.resultados?.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                <span className="text-gray-700 dark:text-gray-300 truncate">{r.name}</span>
                <span className={`text-xs font-medium ml-2 shrink-0 ${r.status === 'registrado ✓' ? 'text-green-600' : r.status === 'já registrado' ? 'text-gray-400' : 'text-red-500'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Seção: Skills da IA ───────────────────────────────────────────────────────
function SkillsSection({ items, onSave, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [editContent, setEditContent] = useState({})

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    await onSave({ type: 'skill', name: newName, content: newContent })
    setNewName(''); setNewContent(''); setShowForm(false); setSaving(false)
  }

  async function handleUpdate(item) {
    await onSave({ id: item.id, content: editContent[item.id] ?? item.content })
    setExpanded(null)
  }

  function toggleExpand(id, content) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setEditContent(prev => ({ ...prev, [id]: content }))
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">🧠 Skills da IA</h2>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors font-medium"
        >
          + Nova skill
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Instruções gerais de comportamento para o agente de QA. Ex: "sempre testar mobile", "verificar textos em português", etc.
      </p>

      {showForm && (
        <div className="mb-4 p-4 rounded-xl border border-purple-100 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nome da skill (ex: Testes de acessibilidade)"
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="Descreva o comportamento ou instrução para a IA..."
            rows={3}
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !newName.trim()} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors">
              {saving ? 'Salvando...' : 'Salvar skill'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-gray-500 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">Nenhuma skill cadastrada ainda.</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={() => toggleExpand(item.id, item.content)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-purple-500 text-sm">⚡</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.name}</span>
                  {!item.content && <span className="text-xs text-gray-400 italic">(vazia)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(item.id) }}
                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs px-2"
                  >
                    Remover
                  </button>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-gray-400 transition-transform ${expanded === item.id ? 'rotate-180' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {expanded === item.id && (
                <div className="px-4 pb-4 space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                  <textarea
                    value={editContent[item.id] ?? item.content}
                    onChange={e => setEditContent(prev => ({ ...prev, [item.id]: e.target.value }))}
                    rows={4}
                    placeholder="Descreva o comportamento ou instrução para a IA..."
                    className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                  <button
                    onClick={() => handleUpdate(item)}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors"
                  >
                    Salvar alterações
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Seção: Base de Conhecimento por Projeto ───────────────────────────────────
function KnowledgeSection({ items, onSave, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [editContent, setEditContent] = useState({})

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    const created = await onSave({ type: 'project', name: newName, content: '' })
    setNewName(''); setShowForm(false); setSaving(false)
    if (created?.id) {
      setExpanded(created.id)
      setEditContent(prev => ({ ...prev, [created.id]: '' }))
    }
  }

  async function handleUpdate(item) {
    await onSave({ id: item.id, content: editContent[item.id] ?? item.content })
    setExpanded(null)
  }

  function toggleExpand(id, content) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setEditContent(prev => ({ ...prev, [id]: content }))
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">📚 Base de Conhecimento</h2>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors font-medium"
        >
          + Novo projeto
        </button>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Base de conhecimento dividida por projeto. Descreva o que o sistema faz e como o QA deve ser conduzido em cada um.
      </p>

      {showForm && (
        <div className="mb-4 p-4 rounded-xl border border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nome do projeto (ex: Portal do Cliente)"
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !newName.trim()} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? 'Criando...' : 'Criar projeto'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-gray-500 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
          <p className="text-sm text-gray-400">Nenhum projeto na base de conhecimento.</p>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Clique em "+ Novo projeto" para começar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                onClick={() => toggleExpand(item.id, item.content)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-blue-500 text-sm">📁</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.name}</span>
                  {!item.content ? (
                    <span className="text-xs text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">sem conteúdo</span>
                  ) : (
                    <span className="text-xs text-green-500 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">preenchido</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(item.id) }}
                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors text-xs px-2"
                  >
                    Remover
                  </button>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-gray-400 transition-transform ${expanded === item.id ? 'rotate-180' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {expanded === item.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">
                      Descrição do projeto + padrões de QA
                    </label>
                    <textarea
                      value={editContent[item.id] ?? item.content}
                      onChange={e => setEditContent(prev => ({ ...prev, [item.id]: e.target.value }))}
                      rows={8}
                      placeholder={`Descreva o projeto e como o QA deve ser feito. Exemplo:\n\n## O que é o projeto\nPortal onde clientes fazem pedidos e acompanham entregas.\n\n## Fluxos críticos de QA\n- Sempre testar o fluxo completo de pedido\n- Verificar notificações por email\n- Testar filtros de busca com caracteres especiais\n\n## Padrões obrigatórios\n- Todo formulário deve validar campos em tempo real\n- Mensagens de erro em português`}
                      className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
                    />
                  </div>
                  <button
                    onClick={() => handleUpdate(item)}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Salvar base de conhecimento
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtBrl(value) {
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ─── Seção: Uso de IA ──────────────────────────────────────────────────────────
function AIConfigSection() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const { isAdmin, isQA } = useAuth()

  useEffect(() => { loadConfig() }, [])

  async function loadConfig() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/settings/ai`, {
        headers: { 'Authorization': `Bearer ${token()}` }
      })
      const data = await res.json()
      setConfig(data)
    } catch { } finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">💰</span>
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Uso da API de IA</h2>
        </div>
        <button onClick={loadConfig} className="text-xs text-gray-400 hover:text-blue-500 transition-colors">
          Atualizar
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Claude Haiku 4.5 · estimativa baseada em 65% input / 35% output · câmbio R$&nbsp;5,75/USD
      </p>

      {loading ? (
        <div className="space-y-3">
          <div className="h-12 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
          <div className="h-12 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Cards de custo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-4 py-3">
              <p className="text-[11px] text-blue-500 dark:text-blue-400 font-medium mb-0.5">Custo hoje</p>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{fmtBrl(config?.costBrlToday)}</p>
              <p className="text-[11px] text-blue-400 mt-0.5">{(config?.tokensToday || 0).toLocaleString('pt-BR')} tokens</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl px-4 py-3">
              <p className="text-[11px] text-purple-500 dark:text-purple-400 font-medium mb-0.5">Custo total</p>
              <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{fmtBrl(config?.costBrlTotal)}</p>
              <p className="text-[11px] text-purple-400 mt-0.5">{(config?.tokensTotal || 0).toLocaleString('pt-BR')} tokens</p>
            </div>
          </div>

          {/* Tabela por usuário (admin/QA) */}
          {(isAdmin || isQA) && config?.byUser?.length > 0 && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Por usuário (total)</p>
              <div className="space-y-1.5">
                {config.byUser.map(u => (
                  <div key={u.userId} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">
                        {u.name?.[0]?.toUpperCase()}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 truncate">{u.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-gray-400">{u.tokens.toLocaleString('pt-BR')} tk</span>
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{fmtBrl(u.costBrl)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Página principal ──────────────────────────────────────────────────────────
export default function Settings() {
  const { isDev } = useAuth()
  const [knowledge, setKnowledge] = useState([])
  const [loadingKnowledge, setLoadingKnowledge] = useState(true)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => { loadKnowledge() }, [])

  async function loadKnowledge() {
    try {
      const res = await fetch(`${API}/knowledge`, {
        headers: { 'Authorization': `Bearer ${token()}` }
      })
      const data = await res.json()
      setKnowledge(Array.isArray(data) ? data : [])
    } catch { setErro('Erro ao carregar base de conhecimento') }
    finally { setLoadingKnowledge(false) }
  }

  async function handleSave({ id, type, name, content }) {
    try {
      if (id) {
        // Update
        const res = await fetch(`${API}/knowledge/${id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        })
        const updated = await res.json()
        if (!res.ok) { alert(updated.error); return null }
        setKnowledge(prev => prev.map(k => k.id === id ? updated : k))
        return updated
      } else {
        // Create
        const res = await fetch(`${API}/knowledge`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, name, content: content || '' })
        })
        const created = await res.json()
        if (!res.ok) { alert(created.error); return null }
        setKnowledge(prev => [...prev, created])
        return created
      }
    } catch { alert('Erro de rede'); return null }
  }

  async function handleDelete(id) {
    if (!confirm('Remover este item da base de conhecimento?')) return
    try {
      await fetch(`${API}/knowledge/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token()}` }
      })
      setKnowledge(prev => prev.filter(k => k.id !== id))
    } catch { alert('Erro ao remover') }
  }

  async function limparDados() {
    if (!confirm('Isso vai apagar TODAS as tasks e eventos. Confirmar?')) return
    setWebhookLoading(true)
    try {
      const res = await fetch(`${API}/admin/clear-test-data`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token()}` }
      })
      const data = await res.json()
      if (res.ok) alert(`Deletado: ${data.deletado.tasks} tasks, ${data.deletado.events} eventos`)
      else setErro(data.error)
    } catch { setErro('Erro de rede.') }
    finally { setWebhookLoading(false) }
  }

  const skills = knowledge.filter(k => k.type === 'skill')
  const projects = knowledge.filter(k => k.type === 'project')

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Configurações</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {isDev ? 'Configuração de IA' : 'Gerenciamento do sistema'}
          </p>
        </div>
        <Link to="/"><NocorpLogo height={28} /></Link>
      </div>

      {erro && (
        <div className="mb-4 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">
          {erro}
        </div>
      )}

      <div className="space-y-4">

        {/* Configuração de IA — visível para todos */}
        <AIConfigSection />

        {/* Seções exclusivas para QA / admin */}
        {!isDev && (
          <>
            {/* Skills da IA */}
            {loadingKnowledge ? (
              <div className="h-32 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 animate-pulse" />
            ) : (
              <SkillsSection items={skills} onSave={handleSave} onDelete={handleDelete} />
            )}

            {/* Base de Conhecimento por Projeto */}
            {loadingKnowledge ? (
              <div className="h-32 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 animate-pulse" />
            ) : (
              <KnowledgeSection items={projects} onSave={handleSave} onDelete={handleDelete} />
            )}

            {/* Webhooks */}
            <WebhooksSection />

            {/* Limpar dados */}
            <div className="bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900 rounded-2xl p-6 shadow-sm">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Limpar dados de teste</h2>
              <p className="text-sm text-gray-400 mb-4">
                Remove todas as tasks e eventos do banco. Use apenas para testes — essa ação não pode ser desfeita.
              </p>
              <button
                onClick={limparDados}
                disabled={webhookLoading}
                className="px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-40"
              >
                🗑 Limpar todos os dados
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
