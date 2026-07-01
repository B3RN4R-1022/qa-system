import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import API from '@/lib/api'

const token = () => localStorage.getItem('qa_token')

function relativeDate(dateStr) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2) return 'agora'
  if (m < 60) return `${m}min atrás`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h atrás`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d atrás`
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

const TYPE_LABEL = { wix_velo: 'Wix Velo', wix_headless: 'Wix Headless', repo: 'Repositório' }
const TYPE_COLOR = {
  wix_velo:    'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800',
  wix_headless:'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
  repo:        'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
}

function CacheCard({ project, onClearRepo, onClearRepoCache, onRemap, onSetType }) {
  const [clearingRepo, setClearingRepo] = useState(false)
  const [clearingRepoCache, setClearingRepoCache] = useState(false)
  const [remapping, setRemapping] = useState(false)
  const [savingType, setSavingType] = useState(false)
  const [editingType, setEditingType] = useState(false)

  async function saveType(type) {
    setSavingType(true)
    try {
      await fetch(`${API}/projects/${encodeURIComponent(project.name)}/repo`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectType: type })
      })
      onSetType(project.name, type)
      setEditingType(false)
    } catch {
      alert('Erro ao salvar tipo do projeto')
    } finally {
      setSavingType(false)
    }
  }

  async function requestRemap() {
    const msg = project.hasSitemap
      ? `Solicitar re-mapeamento completo para "${project.name}"?\nO worker vai re-mapear o site no próximo teste.`
      : `Solicitar mapeamento do site "${project.name}"?\nO worker vai mapear todas as páginas no próximo teste (projeto precisa ser Wix Velo).`
    if (!confirm(msg)) return
    setRemapping(true)
    try {
      // Deleta mapa antigo (se houver) + seta pendingRemap no projeto
      await Promise.all([
        fetch(`${API}/projects/${encodeURIComponent(project.name)}/sitemap`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token()}` }
        }),
        fetch(`${API}/projects/${encodeURIComponent(project.name)}/repo`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingRemap: true })
        })
      ])
      onRemap(project.name)
    } catch { alert('Erro ao solicitar mapeamento') }
    finally { setRemapping(false) }
  }

  async function clearRepo() {
    if (!confirm(`Remover configuração de repositório do projeto "${project.name}"?\nO worker vai perguntar o caminho novamente no próximo teste.`)) return
    setClearingRepo(true)
    try {
      await fetch(`${API}/projects/${encodeURIComponent(project.name)}/repo`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` }
      })
      onClearRepo(project.name)
    } catch {
      alert('Erro ao remover repositório')
    } finally {
      setClearingRepo(false)
    }
  }

  async function clearRepoCache() {
    if (!confirm(`Limpar cache QA do repositório "${project.name}"?\nO worker vai re-analisar o código completo no próximo teste.`)) return
    setClearingRepoCache(true)
    try {
      await fetch(`${API}/projects/${encodeURIComponent(project.name)}/repo-cache`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` }
      })
      onClearRepoCache(project.name)
    } catch {
      alert('Erro ao limpar cache do repositório')
    } finally {
      setClearingRepoCache(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header do card */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-indigo-600 dark:text-indigo-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{project.name}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-400">
                {project.testCount} {project.testCount === 1 ? 'teste' : 'testes'}
              </span>
              {project.lastActivity && (
                <>
                  <span className="text-gray-200 dark:text-gray-700">·</span>
                  <span className="text-xs text-gray-400">{relativeDate(project.lastActivity)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Badges */}
        <div className="shrink-0 flex flex-col gap-1 items-end">
          {project.projectType && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${TYPE_COLOR[project.projectType] || TYPE_COLOR.repo}`}>
              {TYPE_LABEL[project.projectType] || project.projectType}
            </span>
          )}
          {project.hasSitemap ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 text-[10px] font-medium border border-violet-200 dark:border-violet-800">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
              {project.sitemapPageCount ? `${project.sitemapPageCount} págs.` : 'Mapeado'}
            </span>
          ) : null}
          {project.hasRepoCache ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-[10px] font-medium border border-blue-200 dark:border-blue-800">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
              {project.repoFileCount ? `${project.repoFileCount} arq.` : 'Repo analisado'}
            </span>
          ) : project.hasRepo ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-400 text-[10px] font-medium border border-gray-200 dark:border-gray-700">
              Repo (aguardando análise)
            </span>
          ) : null}
        </div>
      </div>

      {/* Datas e repo path */}
      <div className="flex flex-col gap-0.5 mb-3">
        {project.hasSitemap && (
          <p className="text-[11px] text-gray-400">
            🗺️ {project.sitemapPageCount ? `${project.sitemapPageCount} páginas mapeadas` : 'Site mapeado'}
            {project.sitemapUpdatedAt && <span className="ml-1">· {relativeDate(project.sitemapUpdatedAt)}</span>}
          </p>
        )}
        {project.hasRepo && project.repoPath && (
          <p className="text-[11px] text-gray-400 font-mono truncate" title={project.repoPath}>
            📁 {project.repoPath}
            {project.repoAnalyzedAt && <span className="font-sans ml-1 not-italic">· analisado {relativeDate(project.repoAnalyzedAt)}{project.repoFileCount ? ` (${project.repoFileCount} arq.)` : ''}</span>}
          </p>
        )}
        {project.hasRepoCache && project.repoCacheUpdatedAt && (
          <p className="text-[11px] text-gray-400">
            🧠 Cache QA do repo atualizado {relativeDate(project.repoCacheUpdatedAt)}
          </p>
        )}
      </div>

      {/* Seletor de tipo de projeto */}
      <div className="mb-3">
        {(!project.projectType || editingType) ? (
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-2.5">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              {project.projectType ? 'Alterar tipo do projeto:' : 'Definir tipo do projeto:'}
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => saveType(value)}
                  disabled={savingType}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-50 ${
                    project.projectType === value
                      ? (TYPE_COLOR[value] || TYPE_COLOR.repo)
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500'
                  }`}
                >
                  {label}
                </button>
              ))}
              {project.projectType && (
                <button
                  onClick={() => setEditingType(false)}
                  className="px-2 py-1 rounded-lg text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  cancelar
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditingType(true)}
            className="text-[11px] text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors underline"
          >
            Alterar tipo ({TYPE_LABEL[project.projectType]})
          </button>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Botão de remap — só para Wix Velo */}
        {(!project.projectType || project.projectType === 'wix_velo') && (
          <>
            <button
              onClick={requestRemap}
              disabled={remapping}
              title={project.hasSitemap ? 'Re-mapear site' : 'Mapear site'}
              className={`p-1 rounded-lg transition-colors disabled:opacity-50 ${
                remapping
                  ? 'text-blue-400 animate-pulse'
                  : 'text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </button>
          </>
        )}
        {/* Ações de repo — só para projetos com repo */}
        {project.hasRepoCache && (
          <>
            <span className="text-gray-200 dark:text-gray-700 text-xs">·</span>
            <button onClick={clearRepoCache} disabled={clearingRepoCache}
              className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors underline">
              {clearingRepoCache ? 'Limpando...' : 'Limpar cache repo'}
            </button>
          </>
        )}
        {project.hasRepo && (
          <>
            <span className="text-gray-200 dark:text-gray-700 text-xs">·</span>
            <button onClick={clearRepo} disabled={clearingRepo}
              className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors underline">
              {clearingRepo ? 'Removendo...' : 'Remover repo'}
            </button>
          </>
        )}
      </div>

    </div>
  )
}

export default function Projects() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    try {
      const res = await fetch(`${API}/projects`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      const data = await res.json()
      setProjects(Array.isArray(data) ? data : [])
    } catch {
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  function handleRemap(projectName) {
    setProjects(prev => prev.map(p =>
      p.name === projectName ? { ...p, hasSitemap: false, sitemapPageCount: null, sitemapUpdatedAt: null } : p
    ))
  }

  function handleSetType(projectName, type) {
    setProjects(prev => prev.map(p =>
      p.name === projectName ? { ...p, projectType: type } : p
    ))
  }

  function handleClearRepo(projectName) {
    setProjects(prev => prev.map(p =>
      p.name === projectName
        ? { ...p, hasRepo: false, repoPath: null, repoAnalyzedAt: null, repoFileCount: null, repoLastCommit: null }
        : p
    ))
  }

  function handleClearRepoCache(projectName) {
    setProjects(prev => prev.map(p =>
      p.name === projectName
        ? { ...p, hasRepoCache: false, repoCacheUpdatedAt: null, repoAnalyzedAt: null, repoFileCount: null }
        : p
    ))
  }

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Projetos</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Gerencie os projetos e seus dados de QA
            </p>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black dark:bg-white text-white dark:text-black text-sm font-medium hover:opacity-80 transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Novo teste
          </button>
        </div>

        {/* Stats rápidas */}
        {!loading && projects.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{projects.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">Projetos</p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">{projects.filter(p => p.hasSitemap).length}</p>
              <p className="text-xs text-gray-400 mt-0.5">Com sitemap</p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{projects.filter(p => p.hasRepoCache).length}</p>
              <p className="text-xs text-gray-400 mt-0.5">Com repo analisado</p>
            </div>
          </div>
        )}

        {/* Busca */}
        {projects.length > 4 && (
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar projeto..."
              className="w-full max-w-xs text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Lista de projetos */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-gray-400">Carregando projetos...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              {search ? 'Nenhum projeto encontrado' : 'Nenhum projeto ainda'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {search ? 'Tente outro termo de busca' : 'Execute um teste com /teste-qa para criar o primeiro projeto'}
            </p>
            {!search && (
              <button
                onClick={() => navigate('/chat')}
                className="mt-4 px-4 py-2 rounded-xl bg-black dark:bg-white text-white dark:text-black text-sm font-medium hover:opacity-80 transition-opacity"
              >
                Ir para o Chat
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map(project => (
              <CacheCard
                key={project.name}
                project={project}
                onClearRepo={handleClearRepo}
                onClearRepoCache={handleClearRepoCache}
                onRemap={handleRemap}
                onSetType={handleSetType}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
