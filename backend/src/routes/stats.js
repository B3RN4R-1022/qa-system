const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

function getPeriodDate(period) {
  const now = new Date()
  if (period === '7d')  { const d = new Date(now); d.setDate(d.getDate() - 7);   return d }
  if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30);  return d }
  if (period === '6m')  { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d }
  return new Date(0) // sem filtro
}

function calcStats(tasks) {
  return {
    // Aprovadas sem nenhum retorno anterior
    approved_clean: tasks.filter(t => t.status === 'approved' && !t.wasRejectedBefore && !t.wasSuggestedBefore).length,
    // Aprovadas após ter sido reprovada ou sugerida alguma vez
    approved_after: tasks.filter(t => t.status === 'approved' && (t.wasRejectedBefore || t.wasSuggestedBefore)).length,
    // Total de tasks que já foram reprovadas (independente do status atual)
    rejected:       tasks.filter(t => t.wasRejectedBefore || t.status === 'rejected').length,
    // Total de tasks que já receberam sugestão (independente do status atual)
    suggested:      tasks.filter(t => t.wasSuggestedBefore || t.status === 'suggested').length,
  }
}

router.get('/', async (req, res) => {
  try {
    const { period = '30d' } = req.query
    const since = getPeriodDate(period)

    const tasks = await prisma.qATask.findMany({
      where: { updatedAt: { gte: since } },
      select: { status: true, wasRejectedBefore: true, wasSuggestedBefore: true, assignee: true, projectName: true }
    })

    // Geral
    const general = calcStats(tasks)

    // Por projeto
    const projectMap = {}
    tasks.forEach(t => {
      const key = t.projectName || 'Sem projeto'
      if (!projectMap[key]) projectMap[key] = []
      projectMap[key].push(t)
    })
    const byProject = Object.entries(projectMap).map(([name, list]) => ({
      name, ...calcStats(list)
    }))

    // Por dev
    const devMap = {}
    tasks.forEach(t => {
      const key = t.assignee || 'Não atribuído'
      if (!devMap[key]) devMap[key] = []
      devMap[key].push(t)
    })
    const byDev = Object.entries(devMap).map(([name, list]) => ({
      name, ...calcStats(list)
    }))

    res.json({ general, byProject, byDev })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
