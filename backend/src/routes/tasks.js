const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { getAttachments } = require('../services/asana')
const { extrairMockupUrl, extrairTestUrl } = require('../services/parser')

// Listar todas as tasks
router.get('/', async (req, res) => {
  const tasks = await prisma.qATask.findMany({
    include: { checks: true },
    orderBy: { createdAt: 'desc' }
  })
  res.json(tasks)
})

// Buscar uma task pelo ID
router.get('/:id', async (req, res) => {
  const task = await prisma.qATask.findUnique({
    where: { id: req.params.id },
    include: { checks: true }
  })

  if (!task) {
    return res.status(404).json({ error: 'Task não encontrada' })
  }

  res.json({
    ...task,
    mockupUrl: extrairMockupUrl(task.description),
    testUrl: extrairTestUrl(task.description)
  })
})

// Buscar anexos (screenshots) de uma task via Asana
router.get('/:id/attachments', async (req, res) => {
  try {
    const task = await prisma.qATask.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    const attachments = await getAttachments(task.asanaId)
    // Retorna apenas anexos com download_url (arquivos diretos do Asana)
    const images = attachments.filter(a => a.download_url)
    res.json(images)
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router