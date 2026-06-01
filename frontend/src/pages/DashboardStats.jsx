import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import API from '@/lib/api'

const COLORS = {
  approved_clean: '#22c55e',
  approved_after: '#3b82f6',
  rejected:       '#ef4444',
  suggested:      '#f59e0b',
}

const LABELS = {
  approved_clean: 'Aprovado direto',
  approved_after: 'Aprovado após retorno',
  rejected:       'Reprovado',
  suggested:      'Sugestão de alteração',
}

const PERIODS = [
  { label: 'Últimos 7 dias', value: '7d' },
  { label: 'Último mês',     value: '30d' },
  { label: 'Últimos 6 meses', value: '6m' },
]

function buildPieData(stats) {
  return Object.entries(LABELS)
    .map(([key, name]) => ({ name, value: stats[key] || 0, color: COLORS[key] }))
    .filter(d => d.value > 0)
}

function PizzaCard({ title, stats, size = 220 }) {
  const data = buildPieData(stats)
  const total = data.reduce((s, d) => s + d.value, 0)

  if (total === 0) return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col items-center justify-center" style={{ minHeight: 280 }}>
      <p className="font-semibold text-gray-800 mb-4 text-center">{title}</p>
      <p className="text-gray-400 text-sm">Sem dados</p>
    </div>
  )

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <p className="font-semibold text-gray-800 mb-1">{title}</p>
      <p className="text-xs text-gray-400 mb-3">
        Qt Tasks: <span className="font-medium text-gray-600">{stats.total_tasks ?? total}</span>
        <span className="mx-1.5 text-gray-300">·</span>
        Ações: <span className="font-medium text-gray-600">{stats.total_actions ?? total}</span>
      </p>
      <ResponsiveContainer width="100%" height={size}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={size * 0.22}
            outerRadius={size * 0.38}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [value, name]}
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span style={{ fontSize: 11, color: '#6b7280' }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function DashboardStats() {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('30d')
  const [devSelecionado, setDevSelecionado] = useState(null)
  const [loading, setLoading] = useState(true)
  const token = localStorage.getItem('qa_token')

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/stats?period=${period}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        setData(d)
        if (!devSelecionado && d.byDev?.length > 0) setDevSelecionado(d.byDev[0].name)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [period])

  const devStats = data?.byDev?.find(d => d.name === devSelecionado)

  return (
    <div className="p-8 pr-24 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Visão geral de qualidade</p>
        </div>
        {/* Filtro de período */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400">Carregando...</p>
      ) : !data ? (
        <p className="text-red-500">Erro ao carregar dados.</p>
      ) : (
        <div className="space-y-10">

          {/* Visão Geral */}
          <section>
            <h2 className="text-base font-semibold text-gray-700 mb-4">Visão Geral</h2>
            <div className="flex flex-wrap items-center gap-6">
              {/* Pizza */}
              <div className="w-72 shrink-0">
                <PizzaCard title="Todas as tasks" stats={data.general} size={260} />
              </div>
              {/* Cards de % */}
              <div className="grid grid-cols-2 gap-3 flex-1 min-w-[260px]">
                {Object.entries(LABELS).map(([key, label]) => {
                  const total = data.general.total_tasks || 1
                  const val = data.general[key] || 0
                  const pct = Math.round((val / total) * 100)
                  return (
                    <div
                      key={key}
                      className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-1"
                      style={{ borderLeft: `4px solid ${COLORS[key]}` }}
                    >
                      <span className="text-3xl font-bold" style={{ color: COLORS[key] }}>
                        {pct}%
                      </span>
                      <span className="text-xs font-medium text-gray-500 leading-tight">{label}</span>
                      <span className="text-xs text-gray-400">{val} task{val !== 1 ? 's' : ''}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Por Projeto */}
          {data.byProject?.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-gray-700 mb-4">Por Projeto</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.byProject.map(proj => (
                  <PizzaCard key={proj.name} title={proj.name} stats={proj} size={200} />
                ))}
              </div>
            </section>
          )}

          {/* Por Dev */}
          {data.byDev?.length > 0 && (
            <section>
              <div className="flex items-center gap-4 mb-4">
                <h2 className="text-base font-semibold text-gray-700">Por Dev</h2>
                <select
                  value={devSelecionado || ''}
                  onChange={e => setDevSelecionado(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-black"
                >
                  {data.byDev.map(d => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
              {devStats && (
                <div className="max-w-sm">
                  <PizzaCard title={devSelecionado} stats={devStats} size={240} />
                </div>
              )}
            </section>
          )}

        </div>
      )}
    </div>
  )
}
