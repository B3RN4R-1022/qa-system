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
    // Verifica as duas filas em paralelo — filtra por userId para isolamento por usuário
    const [aiJob, devJob] = await Promise.all([
      prisma.aIReport.findFirst({ where: { status: 'queued', userId: req.user.id }, orderBy: { updatedAt: 'asc' } }),
      prisma.devTest.findFirst({ where: { status: 'queued', userId: req.user.id }, orderBy: { createdAt: 'asc' } }),
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

      const [knowledge, skills, siteCache, projectRepo, wixSitemap] = await Promise.all([
        task.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'project', name: task.projectName } } }).catch(() => null)
          : Promise.resolve(null),
        prisma.aIKnowledge.findMany({ where: { type: 'skill' } }),
        task.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'site_cache', name: task.projectName } } }).catch(() => null)
          : Promise.resolve(null),
        task.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'project_repo', name: task.projectName } } }).catch(() => null)
          : Promise.resolve(null),
        task.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'wix_sitemap', name: task.projectName } } }).catch(() => null)
          : Promise.resolve(null),
      ])

      const criteria = task.checks?.map(c => c.label) || []
      const knowledgeText = knowledge?.content || ''
      const skillsText = skills?.filter(s => s.content?.trim()).map(s => `### ${s.name}\n${s.content}`).join('\n\n') || ''
      let repoConfig = {}; try { repoConfig = JSON.parse(projectRepo?.content || '{}') } catch {}

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
        site_cache: siteCache?.content || null,
        project_type: repoConfig.projectType || null,
        has_sitemap: !!wixSitemap?.content,
        pending_remap: repoConfig.pendingRemap || false,
        crawl_headless: repoConfig.crawlHeadless !== false,
      })
    } else {
      // dev_test
      const criteria = winner.criteria ? JSON.parse(winner.criteria) : []

      const [knowledge, skills, siteCache, projectRepo, wixSitemap] = await Promise.all([
        winner.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'project', name: winner.projectName } } }).catch(() => null)
          : Promise.resolve(null),
        prisma.aIKnowledge.findMany({ where: { type: 'skill' } }),
        winner.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'site_cache', name: winner.projectName } } }).catch(() => null)
          : Promise.resolve(null),
        winner.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'project_repo', name: winner.projectName } } }).catch(() => null)
          : Promise.resolve(null),
        winner.projectName
          ? prisma.aIKnowledge.findUnique({ where: { type_name: { type: 'wix_sitemap', name: winner.projectName } } }).catch(() => null)
          : Promise.resolve(null),
      ])

      const knowledgeText = knowledge?.content || ''
      const skillsText = skills?.filter(s => s.content?.trim()).map(s => `### ${s.name}\n${s.content}`).join('\n\n') || ''
      let repoConfig = {}; try { repoConfig = JSON.parse(projectRepo?.content || '{}') } catch {}

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
        site_cache: siteCache?.content || null,
        project_type: repoConfig.projectType || null,
        has_sitemap: !!wixSitemap?.content,
        pending_remap: repoConfig.pendingRemap || false,
        crawl_headless: repoConfig.crawlHeadless !== false,
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
// Body: { status, report, tokensUsed, type, siteCache?, projectName? }
router.post('/:id/result', async (req, res) => {
  const { status, report, tokensUsed, type, siteCache, projectName } = req.body || {}
  try {
    const ops = []

    if (type === 'dev_test') {
      ops.push(prisma.devTest.update({
        where: { id: req.params.id },
        data: {
          status: status === 'error' ? 'error' : 'done',
          report: report || 'Sem resultado',
          tokensUsed: tokensUsed || null,
        }
      }))
    } else {
      ops.push(prisma.aIReport.update({
        where: { taskId: req.params.id },
        data: {
          status: status === 'error' ? 'error' : 'done',
          report: report || 'Sem resultado',
          tokensUsed: tokensUsed || null,
        }
      }))
    }

    // Salva o cache de site atualizado pelo agente, se houver
    if (siteCache && projectName) {
      ops.push(
        prisma.aIKnowledge.upsert({
          where: { type_name: { type: 'site_cache', name: projectName } },
          create: { type: 'site_cache', name: projectName, content: siteCache },
          update: { content: siteCache }
        })
      )
    }

    await Promise.all(ops)
    res.json({ ok: true })
  } catch (err) {
    console.error('[qa-jobs/result]', err)
    res.status(500).json({ error: 'Erro ao salvar resultado' })
  }
})

module.exports = router
