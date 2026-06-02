const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

/**
 * Pull model — o qa-agent local busca jobs aqui em vez de receber via HTTP.
 * Suporta dois tipos de job:
 *   'qa_task'  — análise de task do Asana (AIReport)
 *   'dev_test' — teste manual iniciado por dev via chat (DevTest)
 */

// GET /qa-jobs/pending — retorna o job mais antigo na fila (sem reivindicar)
router.get('/pending', async (req, res) => {
  try {
    // Verifica as duas filas em paralelo
    const [aiJob, devJob] = await Promise.all([
      prisma.aIReport.findFirst({ where: { status: 'queued' }, orderBy: { updatedAt: 'asc' } }),
      prisma.devTest.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } }),
    ])

    if (!aiJob && !devJob) return res.json(null)

    // Escolhe o job mais antigo
    let winner, type
    if (aiJob && devJob) {
      if (aiJob.updatedAt <= devJob.createdAt) {
        winner = aiJob; type = 'qa_task'
      } else {
        winner = devJob; type = 'dev_test'
      }
    } else if (aiJob) {
      winner = aiJob; type = 'qa_task'
    } else {
      winner = devJob; type = 'dev_test'
    }

    // Monta contexto de conhecimento (mesmo para os dois tipos)
    const projectName = type === 'qa_task' ? null : winner.projectName

    if (type === 'qa_task') {
      const task = await prisma.qATask.findUnique({
        where: { id: winner.taskId },
        include: { checks: true }
      })
      if (!task) {
        await prisma.aIReport.update({
          where: { taskId: winner.taskId },
          data: { status: 'error', report: 'Task não encontrada' }
        })
        return res.json(null)
      }

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

      return res.json({
        type: 'qa_task',
        task_id: task.id,
        title: task.title,
        preview_url: task.previewUrl,
        criteria,
        project_name: task.projectName || '',
        description: task.description || '',
        knowledge: knowledgeText,
        skills: skillsText,
      })
    } else {
      // dev_test
      const criteria = winner.criteria ? JSON.parse(winner.criteria) : []

      const [knowledge, skills] = await Promise.all([
        winner.projectName
          ? prisma.aIKnowledge.findUnique({
              where: { type_name: { type: 'project', name: winner.projectName } }
            }).catch(() => null)
          : Promise.resolve(null),
        prisma.aIKnowledge.findMany({ where: { type: 'skill' } })
      ])

      const knowledgeText = knowledge?.content || ''
      const skillsText = skills
        ?.filter(s => s.content?.trim())
        .map(s => `### ${s.name}\n${s.content}`)
        .join('\n\n') || ''

      return res.json({
        type: 'dev_test',
        task_id: winner.id,
        title: winner.title,
        preview_url: winner.previewUrl,
        criteria,
        project_name: winner.projectName || '',
        description: winner.description,
        knowledge: knowledgeText,
        skills: skillsText,
      })
    }
  } catch (err) {
    console.error('[qa-jobs/pending]', err.message)
    res.status(500).json({ error: 'Erro ao buscar jobs' })
  }
})

// POST /qa-jobs/:id/claim — reivindica o job (queued → running) de forma atômica
// Body: { type: 'qa_task' | 'dev_test' }
router.post('/:id/claim', async (req, res) => {
  const { type } = req.body || {}
  try {
    let count = 0
    if (type === 'dev_test') {
      const result = await prisma.devTest.updateMany({
        where: { id: req.params.id, status: 'queued' },
        data: { status: 'running' }
      })
      count = result.count
    } else {
      // qa_task (padrão — retrocompatível)
      const result = await prisma.aIReport.updateMany({
        where: { taskId: req.params.id, status: 'queued' },
        data: { status: 'running' }
      })
      count = result.count
    }
    res.json({ claimed: count === 1 })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reivindicar job' })
  }
})

// POST /qa-jobs/:id/result — salva o resultado final da análise
// Body: { status, report, tokensUsed, type }
router.post('/:id/result', async (req, res) => {
  const { status, report, tokensUsed, type } = req.body || {}
  try {
    if (type === 'dev_test') {
      await prisma.devTest.update({
        where: { id: req.params.id },
        data: {
          status: status === 'error' ? 'error' : 'done',
          report: report || 'Sem resultado',
          tokensUsed: tokensUsed || null,
        }
      })
    } else {
      await prisma.aIReport.update({
        where: { taskId: req.params.id },
        data: {
          status: status === 'error' ? 'error' : 'done',
          report: report || 'Sem resultado',
          tokensUsed: tokensUsed || null,
        }
      })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar resultado' })
  }
})

module.exports = router
