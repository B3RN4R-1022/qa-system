const express = require('express')
const router = express.Router({ mergeParams: true })
const prisma = require('../lib/prisma')

// GET /tasks/:id/ai-report — retorna o relatório atual
router.get('/', async (req, res) => {
  try {
    const report = await prisma.aIReport.findUnique({
      where: { taskId: req.params.id }
    })
    res.json(report || null)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar relatório' })
  }
})

// POST /tasks/:id/run-ai-qa — coloca a análise na fila (Pull model)
// O qa-agent local busca o job via /qa-jobs/pending e executa na máquina do analista
router.post('/', async (req, res) => {
  const taskId = req.params.id
  const { previewUrl: urlOverride } = req.body || {}

  const task = await prisma.qATask.findUnique({
    where: { id: taskId },
    select: { id: true, previewUrl: true, title: true }
  })

  if (!task) return res.status(404).json({ error: 'Task não encontrada' })

  const urlFinal = urlOverride || task.previewUrl
  if (!urlFinal) return res.status(400).json({ error: 'Task não tem URL de preview configurada' })

  if (urlFinal !== task.previewUrl) {
    await prisma.qATask.update({
      where: { id: taskId },
      data: { previewUrl: urlFinal }
    })
  }

  // Coloca o job na fila — status 'queued' com userId de quem clicou
  await prisma.aIReport.upsert({
    where: { taskId },
    create: { taskId, status: 'queued', userId: req.user.id },
    update: { status: 'queued', report: null, tokensUsed: null, userId: req.user.id }
  })

  res.json({
    ok: true,
    message: 'Análise na fila — abra o QA Agent no seu computador para executá-la.'
  })
})

// DELETE /tasks/:id/ai-report — limpa o relatório (reseta estado stuck)
router.delete('/', async (req, res) => {
  try {
    await prisma.aIReport.deleteMany({ where: { taskId: req.params.id } })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao limpar relatório' })
  }
})

module.exports = router
