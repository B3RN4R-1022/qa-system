const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { getMyWorkspaceGid, listAllProjects, registerWebhook, listWebhooks } = require('../services/asana')

// POST /admin/setup-webhooks
router.post('/setup-webhooks', async (req, res) => {
  try {
    const { webhookUrl } = req.body
    if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl é obrigatório' })

    const workspaceGid = await getMyWorkspaceGid()
    if (!workspaceGid) return res.status(500).json({ error: 'Workspace não encontrado' })

    const existentes = await listWebhooks(workspaceGid)
    const projectsComWebhook = new Set(existentes.map(w => w.resource?.gid))

    const projetos = await listAllProjects(workspaceGid)
    const resultados = []

    for (const projeto of projetos) {
      if (projectsComWebhook.has(projeto.gid)) {
        resultados.push({ name: projeto.name, gid: projeto.gid, status: 'já registrado' })
        continue
      }
      const result = await registerWebhook(projeto.gid, webhookUrl)
      resultados.push({
        name: projeto.name,
        gid: projeto.gid,
        status: result.errors ? `erro: ${result.errors[0]?.message}` : 'registrado ✓'
      })
    }

    res.json({ workspace: workspaceGid, total: projetos.length, resultados })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /admin/webhooks
router.get('/webhooks', async (req, res) => {
  try {
    const workspaceGid = await getMyWorkspaceGid()
    const webhooks = await listWebhooks(workspaceGid)
    res.json(webhooks)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /admin/clear-test-data — limpa tasks e eventos para testes
router.delete('/clear-test-data', async (req, res) => {
  try {
    const checks  = await prisma.qACheck.deleteMany()
    const tasks   = await prisma.qATask.deleteMany()
    const events  = await prisma.qAEvent.deleteMany()
    res.json({
      success: true,
      deletado: { checks: checks.count, tasks: tasks.count, events: events.count }
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
