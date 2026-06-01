import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Link } from 'react-router-dom'
import API from '@/lib/api'
import { useTheme } from '@/contexts/ThemeContext'
import { NocorpLogo } from '@/components/NocorpLogo'

const COLORS_DARK = {
  approved_clean: '#00D4AA',
  approved_after: '#FFC125',
  rejected:       '#FF2D78',
  suggested:      '#BF5AF2',
}

const COLORS_LIGHT = {
  approved_clean: '#00A887',
  approved_after: '#FFC125',
  rejected:       '#E8185E',
  suggested:      '#9B3FE0',
}

const LABELS = {
  approved_clean: 'Aprovado direto',
  approved_after: 'Aprovado após retorno',
  rejected:       'Reprovado',
  suggested:      'Sugestão de alteração',
}

const PERIODS = [
  { label: '7 dias',   value: '7d' },
  { label: '30 dias',  value: '30d' },
  { label: '6 meses',  value: '6m' },
]

function buildPieData(stats, colors) {
  return Object.entries(LABELS)
    .map(([key, name]) => ({ name, value: stats[key] || 0, color: colors[key] }))
    .filter(d => d.value > 0)
}

function PizzaCard({ title, stats, size = 180, colors, compact = false, onClick }) {
  const data = buildPieData(stats, colors)
  const total = data.reduce((s, d) => s + d.value, 0)
  const taskTotal = stats.total_tasks ?? total
  const totalActions = stats.total_actions ?? total

  // Durações diferentes para abrir (lento/suave) e fechar (rápido)
  const openDur  = '900ms'
  const closeDur = '460ms'
  const easing   = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  const dur = compact ? closeDur : openDur
  const t = (props) => props.map(p => `${p} ${dur} ${easing}`).join(', ')

  const chartSize = compact ? 88 : size

  const tooltipStyle = {
    borderRadius: 10, border: 'none',
    background: '#1a1033', color: '#fff',
    fontSize: 12, padding: '6px 12px',
  }

  if (total === 0) return (
    <div
      className={`bg-white dark:bg-[#1a1033] border border-gray-100 dark:border-purple-900/40 rounded-2xl shadow-sm overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
      style={{ minHeight: compact ? 120 : 200, transition: t(['min-height', 'all']) }}
      onClick={onClick}
    >
      <div style={{ opacity: compact ? 0 : 1, transition: t(['opacity']) }} className="p-5 text-center">
        <p className="font-semibold text-gray-700 dark:text-gray-300 text-sm">{title}</p>
        <p className="text-gray-400 text-sm mt-1">Sem dados</p>
      </div>
    </div>
  )

  return (
    <div
      className={`bg-white dark:bg-[#1a1033] border border-gray-100 dark:border-purple-900/40 rounded-2xl shadow-sm overflow-hidden ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      {/* Header — colapsa via max-height + opacity */}
      <div style={{
        maxHeight: compact ? '0px' : '80px',
        opacity: compact ? 0 : 1,
        overflow: 'hidden',
        padding: compact ? '0 20px' : '20px 20px 0',
        transition: t(['max-height', 'opacity', 'padding']),
      }}>
        <p className="font-semibold text-gray-800 dark:text-white mb-0.5">{title}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 pb-3">
          <span className="font-medium text-gray-600 dark:text-gray-400">{taskTotal}</span> tasks
          <span className="mx-1.5 opacity-40">·</span>
          <span className="font-medium text-gray-600 dark:text-gray-400">{totalActions}</span> ações
        </p>
      </div>

      {/* Donut + legenda */}
      <div className="flex items-center" style={{
        padding: compact ? '12px' : '12px 20px 20px',
        gap: '12px',
        transition: t(['padding']),
      }}>
        {/* Gráfico — anima width/height */}
        <div className="shrink-0" style={{
          width: chartSize,
          height: chartSize,
          transition: t(['width', 'height']),
        }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius="50%" outerRadius="78%" paddingAngle={3} dataKey="value" stroke="none">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [v, n]} contentStyle={tooltipStyle} itemStyle={{ color: '#fff' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legenda — expande/colapsa via max-width + opacity */}
        <div style={{
          flex: 1,
          minWidth: 0,
          maxWidth: compact ? '0px' : '300px',
          opacity: compact ? 0 : 1,
          overflow: 'hidden',
          transition: t(['max-width', 'opacity']),
        }}>
          <div className="flex flex-col gap-2.5">
            {data.map((entry, i) => {
              const pct = taskTotal > 0 ? Math.round((entry.value / taskTotal) * 100) : 0
              return (
                <div key={i} className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: entry.color }} />
                  <span className="text-sm font-bold shrink-0" style={{ color: entry.color }}>{pct}%</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{entry.name}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Nome compacto — aparece quando minimizado */}
        <div style={{
          position: 'absolute',
          opacity: compact ? 1 : 0,
          transition: t(['opacity']),
          pointerEvents: 'none',
        }}>
        </div>
      </div>

      {/* Título compacto embaixo do donut */}
      <div style={{
        maxHeight: compact ? '36px' : '0px',
        opacity: compact ? 1 : 0,
        overflow: 'hidden',
        textAlign: 'center',
        padding: compact ? '0 8px 10px' : '0 8px',
        transition: t(['max-height', 'opacity', 'padding']),
      }}>
        <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate">{title}</p>
        <p className="text-[10px] text-gray-400">{taskTotal}t</p>
      </div>
    </div>
  )
}

export default function DashboardStats() {
  const { dark } = useTheme()
  const COLORS = dark ? COLORS_DARK : COLORS_LIGHT

  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('30d')
  const [devSelecionado, setDevSelecionado] = useState(null)
  const [focusedProject, setFocusedProject] = useState(null)
  const [focusedGeneral, setFocusedGeneral] = useState(false)
  const [focusedDev, setFocusedDev] = useState(false)
  const [loading, setLoading] = useState(true)

  const anim = (dur) => `${dur} cubic-bezier(0.25, 0.46, 0.45, 0.94)`
  const openT = anim('900ms')
  const closeT = anim('460ms')
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
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header — 3 colunas: título | filtro centralizado | logo */}
      <div className="grid grid-cols-3 items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Visão geral de qualidade</p>
        </div>
        {/* Filtro centralizado */}
        <div className="flex justify-center">
        <div className="flex gap-1 bg-gray-100 dark:bg-[#1a1033] border dark:border-purple-900/40 p-1 rounded-xl">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                period === p.value
                  ? 'bg-white dark:bg-purple-900/60 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        </div>
        {/* Logo à direita */}
        <div className="flex justify-end">
          <Link to="/"><NocorpLogo height={26} /></Link>
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
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide text-xs">Visão Geral</h2>
              {focusedGeneral && (
                <button onClick={() => setFocusedGeneral(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline transition-colors">
                  ver detalhes
                </button>
              )}
            </div>
            <div className="flex gap-4 items-start">
              {/* Pizza principal */}
              <div style={{
                flex: focusedGeneral ? '3 1 0%' : '0 0 320px',
                transition: `flex ${focusedGeneral ? openT : closeT}`,
                minWidth: 0,
              }}>
                <PizzaCard
                  title="Todas as tasks"
                  stats={data.general}
                  size={focusedGeneral ? 230 : 190}
                  colors={COLORS}
                  onClick={() => setFocusedGeneral(f => !f)}
                />
              </div>
              {/* Cards de % */}
              <div style={{
                flex: focusedGeneral ? '0 0 120px' : '1 1 0%',
                minWidth: 0,
                transition: `flex ${focusedGeneral ? closeT : openT}`,
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: focusedGeneral ? '1fr' : '1fr 1fr',
                  gap: focusedGeneral ? '6px' : '12px',
                  transition: `gap ${focusedGeneral ? closeT : openT}`,
                }}>
                  {Object.entries(LABELS).map(([key, label]) => {
                    const total = data.general.total_tasks || 1
                    const val = data.general[key] || 0
                    const pct = Math.round((val / total) * 100)
                    return (
                      <div
                        key={key}
                        className="bg-white dark:bg-[#1a1033] border border-gray-100 dark:border-purple-900/40 rounded-xl shadow-sm overflow-hidden"
                        style={{
                          padding: focusedGeneral ? '8px 10px' : '16px',
                          transition: `padding ${focusedGeneral ? closeT : openT}`,
                        }}
                      >
                        <span className="font-bold block" style={{
                          color: COLORS[key],
                          fontSize: focusedGeneral ? '16px' : '30px',
                          lineHeight: 1.1,
                          transition: `font-size ${focusedGeneral ? closeT : openT}`,
                        }}>{pct}%</span>

                        <div style={{
                          maxHeight: focusedGeneral ? '0px' : '40px',
                          opacity: focusedGeneral ? 0 : 1,
                          overflow: 'hidden',
                          transition: `max-height ${focusedGeneral ? closeT : openT}, opacity ${focusedGeneral ? closeT : openT}`,
                        }}>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 leading-tight block mt-0.5">{label}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-600">{val} task{val !== 1 ? 's' : ''}</span>
                          <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-purple-900/30 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS[key], transition: `width ${openT}` }} />
                          </div>
                        </div>

                        {/* Label compacto — aparece quando focado */}
                        <div style={{
                          maxHeight: focusedGeneral ? '20px' : '0px',
                          opacity: focusedGeneral ? 1 : 0,
                          overflow: 'hidden',
                          transition: `max-height ${focusedGeneral ? openT : closeT}, opacity ${focusedGeneral ? openT : closeT}`,
                        }}>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight block truncate">{label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Por Projeto */}
          {data.byProject?.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide text-xs">Por Projeto</h2>
                {focusedProject && (
                  <button
                    onClick={() => setFocusedProject(null)}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline transition-colors"
                  >
                    ver todos
                  </button>
                )}
              </div>

              <div className="flex gap-4 items-start">
                {data.byProject.map(proj => {
                  const isFocused = focusedProject === proj.name
                  const isMinimized = focusedProject && !isFocused
                  return (
                    <div
                      key={proj.name}
                      className="min-w-0"
                      style={{
                        flex: isFocused ? '3 1 0%' : isMinimized ? '0 0 110px' : '1 1 0%',
                        maxWidth: isMinimized ? '110px' : undefined,
                        transition: 'flex 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94), max-width 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                      }}
                    >
                      <PizzaCard
                        title={proj.name}
                        stats={proj}
                        size={isFocused ? 220 : isMinimized ? 90 : 160}
                        compact={isMinimized}
                        colors={COLORS}
                        onClick={() => setFocusedProject(isFocused ? null : proj.name)}
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Por Dev */}
          {data.byDev?.length > 0 && (
            <section>
              <div className="flex items-center gap-4 mb-4">
                <h2 className="text-base font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide text-xs">Por Dev</h2>
                <div style={{
                  maxWidth: focusedDev ? '0px' : '300px',
                  opacity: focusedDev ? 0 : 1,
                  overflow: 'hidden',
                  transition: `max-width ${focusedDev ? closeT : openT}, opacity ${focusedDev ? closeT : openT}`,
                }}>
                  <select
                    value={devSelecionado || ''}
                    onChange={e => setDevSelecionado(e.target.value)}
                    className="border border-gray-200 dark:border-purple-900/40 bg-white dark:bg-[#1a1033] rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 whitespace-nowrap"
                  >
                    {data.byDev.map(d => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                {focusedDev && (
                  <button onClick={() => setFocusedDev(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline transition-colors">
                    reduzir
                  </button>
                )}
              </div>
              {devStats && (
                <div style={{
                  maxWidth: focusedDev ? '100%' : '384px',
                  transition: `max-width ${focusedDev ? openT : closeT}`,
                }}>
                  <PizzaCard
                    title={devSelecionado}
                    stats={devStats}
                    size={focusedDev ? 230 : 180}
                    colors={COLORS}
                    onClick={() => setFocusedDev(f => !f)}
                  />
                </div>
              )}
            </section>
          )}

        </div>
      )}
    </div>
  )
}
