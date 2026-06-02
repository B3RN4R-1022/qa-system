const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

/**
 * Pull model — o qa-agent local busca jobs aqui em vez de receber via HTTP.
 * Isso elimina a necessidade de ngrok: a conexão sempre sai da máquina local.
 */

// GET /qa-jobs/pending — retorna o job mais antigo na fila (sem reivindicar)
router.get('/pending', async (req, res) => {
  try {
    const job = await prisma.aIReport.findFirst({
      where: { status: 'queued' },
      orderBy: { updatedAt: 'asc' }
    })
    if (!job) return res.json(null)

    const task = await prisma.qATask.findUnique({
      where: { id: job.taskId },
      include: { checks: true }
    })
    if (!task) {
      await prisma.aIReport.update({
        where: { taskId: job.taskId },
        data: { status: 'error', report: 'Task não encontrada' }
      })
      return res.json(null)
    }

    // Monta o contexto: base de conhecimento do projeto + skills globais
    const [knowledge, skills] = await Promise.all([
      task.projectName
        ? prisma.aIKnowledge.findUnique({
            where: { type_name: { type: 'project', name: task.projectName } }
          }).catch(() => null)
        : Promise.resolve(null),
      prisma.aIKnowledge.findMany({ where: { type: 'skill' } })
    ])

    const criteria = task.checks?.map(c => c.label) || []
    const knowledgeText = knowledge?.content || ''
    const skillsText = skills
      ?.filter(s => s.content?.trim())
      .map(s => `### ${s.name}\n${s.content}`)
      .join('\n\n') || ''

    res.json({
      task_id: task.id,
      title: task.title,
      preview_url: task.previewUrl,
      criteria,
      project_name: task.projectName || '',
      description: task.description || '',
      knowledge: knowledgeText,
      skills: skillsText,
    })
  } catch (err) {
    console.error('[qa-jobs/pending]', err.message)
    res.status(500).json({ error: 'Erro ao buscar jobs' })
  }
})

// POST /qa-jobs/:taskId/claim — reivindica o job (queued → running) de forma atômica
router.post('/:taskId/claim', async (req, res) => {
  try {
    const result = await prisma.aIReport.updateMany({
      where: { taskId: req.params.taskId, status: 'queued' },
      data: { status: 'running' }
    })
    // count===1 → este worker reivindicou; count===0 → outro pegou primeiro
    res.json({ claimed: result.count === 1 })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reivindicar job' })
  }
})

// POST /qa-jobs/:taskId/result — salva o resultado final da análise
router.post('/:taskId/result', async (req, res) => {
  const { status, report, tokensUsed } = req.body || {}
  try {
    await prisma.aIReport.update({
      where: { taskId: req.params.taskId },
      data: {
        status: status === 'error' ? 'error' : 'done',
        report: report || 'Sem resultado',
        tokensUsed: tokensUsed || null,
      }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar resultado' })
  }
})

module.exports = router
