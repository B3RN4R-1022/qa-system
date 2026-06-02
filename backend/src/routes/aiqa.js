const express = require('express')
const router = express.Router({ mergeParams: true })
const prisma = require('../lib/prisma')
const { runBrowserUseAgent } = require('../services/browserUse')

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

// POST /tasks/:id/run-ai-qa — dispara o agente (roda em background)
router.post('/', async (req, res) => {
  const taskId = req.params.id
  const { previewUrl: urlOverride } = req.body || {}

  // Verifica se a task existe
  const task = await prisma.qATask.findUnique({
    where: { id: taskId },
    select: { id: true, previewUrl: true, title: true }
  })

  if (!task) return res.status(404).json({ error: 'Task não encontrada' })

  // Usa URL enviada pelo frontend (testUrl) ou a previewUrl do banco
  const urlFinal = urlOverride || task.previewUrl
  if (!urlFinal) return res.status(400).json({ error: 'Task não tem URL de preview configurada' })

  // Salva a URL correta no banco para o agente usar
  if (urlFinal !== task.previewUrl) {
    await prisma.qATask.update({
      where: { id: taskId },
      data: { previewUrl: urlFinal }
    })
  }

  // Responde imediatamente e roda em background
  res.json({ ok: true, message: 'Análise iniciada — pode levar até 2 minutos' })

  // Roda em background sem bloquear a resposta
  runBrowserUseAgent(taskId).catch(err => {
    console.error('[AIReport] Erro no background:', err.message)
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
