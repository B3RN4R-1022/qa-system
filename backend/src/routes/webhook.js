const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { getTask } = require('../services/asana')

const CAMPOS_OBRIGATORIOS = ['name', 'notes']

router.post('/', async (req, res) => {
  // Handshake do Asana — primeira vez que ele chama o endpoint
  const secret = req.headers['x-hook-secret']
  if (secret) {
    res.setHeader('x-hook-secret', secret)
    return res.sendStatus(200)
  }

  res.sendStatus(200)

  const events = req.body.events || []

  for (const event of events) {
    if (event.resource?.resource_type !== 'task') continue

    const taskId = event.resource.gid
    const task = await getTask(taskId)

    const statusField = task.custom_fields?.find(
      f => f.name === 'Status' || f.name === 'status'
    )
    const status = statusField?.enum_value?.name || ''

    const isQA = status === 'Pronto para Revisão' || status === 'Em QA'
    if (!isQA) continue

    // Validar campos obrigatórios
    const faltando = []
    if (!task.name) faltando.push('Título')
    if (!task.notes) faltando.push('Descrição')
    if (!task.notes?.includes('http')) faltando.push('Link de Preview')

    if (faltando.length > 0) {
      // TODO: comentar na task e devolver pro dev
      console.log(`Task ${taskId} faltando: ${faltando.join(', ')}`)
      continue
    }

    // Salvar no banco
    await prisma.qATask.upsert({
      where: { asanaId: taskId },
      update: { status: 'pending' },
      create: {
        asanaId: taskId,
        title: task.name,
        description: task.notes,
        previewUrl: task.notes.match(/https?:\/\/[^\s]+/)?.[0] || null,
        assignee: task.assignee?.name || null,
        status: 'pending'
      }
    })
  }
})

module.exports = router