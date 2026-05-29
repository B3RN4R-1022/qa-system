const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

function getPeriodDate(period) {
  const now = new Date()
  if (period === '7d')  { const d = new Date(now); d.setDate(d.getDate() - 7);   return d }
  if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30);  return d }
  if (period === '6m')  { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d }
  return new Date(0)
}

function calcStats(events) {
  // Agrupa todos os eventos por task
  const byTask = {}
  for (const e of events) {
    if (!byTask[e.asanaId]) byTask[e.asanaId] = []
    byTask[e.asanaId].push(e)
  }

  let approved_clean = 0
  let approved_after = 0
  let rejected = 0
  let suggested = 0

  for (const taskEvents of Object.values(byTask)) {
    const approvedEvent = taskEvents.find(e => e.action === 'approved')
    const wasRejected   = taskEvents.some(e => e.action === 'rejected')
    const wasSuggested  = taskEvents.some(e => e.action === 'suggested')

    // Aprovações: mutuamente exclusivas entre si
    if (approvedEvent) {
      if (approvedEvent.wasFirstApproval) approved_clean++
      else approved_after++
    }

    // Rejeições e sugestões: independem do estado final
    if (wasRejected)  rejected++
    if (wasSuggested) suggested++
  }

  return {
    approved_clean,
    approved_after,
    rejected,
    suggested,
    total_tasks:   Object.keys(byTask).length,
    total_actions: approved_clean + approved_after + rejected + suggested,
  }
}

router.get('/', async (req, res) => {
  try {
    const { period = '30d' } = req.query
    const since = getPeriodDate(period)

    // Lê da tabela permanente de eventos
    const events = await prisma.qAEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { asanaId: true, action: true, wasFirstApproval: true, projectName: true, assignee: true }
    })

    const general = calcStats(events)

    // Por projeto
    const projectMap = {}
    events.forEach(e => {
      const key = e.projectName || 'Sem projeto'
      if (!projectMap[key]) projectMap[key] = []
      projectMap[key].push(e)
    })
    const byProject = Object.entries(projectMap).map(([name, list]) => ({ name, ...calcStats(list) }))

    // Por dev
    const devMap = {}
    events.forEach(e => {
      const key = e.assignee || 'Não atribuído'
      if (!devMap[key]) devMap[key] = []
      devMap[key].push(e)
    })
    const byDev = Object.entries(devMap).map(([name, list]) => ({ name, ...calcStats(list) }))

    res.json({ general, byProject, byDev })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
