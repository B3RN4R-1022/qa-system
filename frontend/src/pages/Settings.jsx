import { useState } from 'react'
import API from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function Settings() {
  const token = localStorage.getItem('qa_token')
  const [webhookUrl, setWebhookUrl] = useState(`${API}/webhook`)
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState(null)

  async function limparDados() {
    if (!confirm('Isso vai apagar TODAS as tasks e eventos. Confirmar?')) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/admin/clear-test-data`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok) alert(`Deletado: ${data.deletado.tasks} tasks, ${data.deletado.events} eventos`)
      else setErro(data.error)
    } catch { setErro('Erro de rede.') }
    finally { setLoading(false) }
  }

  async function registrarWebhooks() {
    setLoading(true)
    setResultado(null)
    setErro(null)
    try {
      const res = await fetch(`${API}/admin/setup-webhooks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ webhookUrl })
      })
      const data = await res.json()
      if (!res.ok) setErro(data.error || 'Erro ao registrar webhooks')
      else setResultado(data)
    } catch {
      setErro('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 pr-24 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-sm text-gray-400 mt-0.5">Gerenciamento do sistema</p>
      </div>

      {/* Limpar dados */}
      <div className="bg-white border border-red-100 rounded-2xl p-6 shadow-sm mb-4">
        <h2 className="font-semibold text-gray-800 mb-1">Limpar dados de teste</h2>
        <p className="text-sm text-gray-400 mb-4">
          Remove todas as tasks e eventos do banco. Use apenas para testes — essa ação não pode ser desfeita.
        </p>
        <button
          onClick={limparDados}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-40"
        >
          🗑 Limpar todos os dados
        </button>
      </div>

      {/* Webhooks */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-1">Projetos do Asana</h2>
        <p className="text-sm text-gray-400 mb-4">
          Registra webhooks em todos os projetos do workspace. Use sempre que adicionar um projeto novo no Asana.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">URL do backend</label>
            <input
              type="text"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <Button onClick={registrarWebhooks} disabled={loading} className="w-full">
            {loading ? 'Registrando...' : '🔗 Registrar webhooks em todos os projetos'}
          </Button>
        </div>

        {erro && <p className="mt-3 text-sm text-red-500">{erro}</p>}

        {resultado && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">
              {resultado.total} projeto{resultado.total !== 1 ? 's' : ''} encontrado{resultado.total !== 1 ? 's' : ''}:
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {resultado.resultados?.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-gray-700 truncate">{r.name}</span>
                  <span className={`text-xs font-medium ml-2 shrink-0 ${
                    r.status === 'registrado ✓' ? 'text-green-600' :
                    r.status === 'já registrado' ? 'text-gray-400' : 'text-red-500'
                  }`}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
