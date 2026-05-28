const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { getTask, getPreviewUrl } = require('../services/asana')
const { extrairRequisitos } = require('../services/parser')



router.post('/', async (req, res) => {
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

    /*console.log('TASK DATA:', JSON.stringify({
      start_on: task.start_on,
      estimated_time: task.estimated_time,
      actual_time_minutes: task.actual_time_minutes,
      custom_fields: task.custom_fields?.map(f => ({
        name: f.name,
        display_value: f.display_value,
        type: f.type
      }))
    }, null, 2))*/

    const statusField = task.custom_fields?.find(
      f => f.name === 'Status' || f.name === 'status'
    )
    const status = statusField?.enum_value?.name || ''

    const isQA = status === 'Pronto para Revisão' || status === 'Em QA'
    if (!isQA) continue

    // Todos os campos obrigatórios (incluindo os custom)
    const CAMPOS_OBRIGATORIOS = [
      'Prioridade',
      'Complexidade',
      'Tipo',
      'Início'
    ]

    const faltando = []

    if (!task.name) faltando.push('Título')
    if (!task.notes) faltando.push('Descrição')

    // Valida todos os campos customizados obrigatórios
    for (const nomeCampo of CAMPOS_OBRIGATORIOS) {
      const campo = task.custom_fields?.find(f => f.name === nomeCampo)
      if (!campo || !campo.display_value) faltando.push(nomeCampo)
    }

    if (faltando.length > 0) {
      console.log(`Task ${taskId} faltando: ${faltando.join(', ')}`)
      continue
    }

    const requisitos = extrairRequisitos(task.notes)
    const previewUrl = await getPreviewUrl(taskId)

    const taskSalva = await prisma.qATask.upsert({
      where: { asanaId: taskId },
      update: { status: 'pending', previewUrl },
      create: {
        asanaId: taskId,
        title: task.name,
        description: task.notes,
        previewUrl,
        assignee: task.assignee?.name || null,
        status: 'pending'
      }
    })

    if (requisitos.length > 0) {
      await prisma.qACheck.deleteMany({ where: { taskId: taskSalva.id } })
      await prisma.qACheck.createMany({
        data: requisitos.map(label => ({
          taskId: taskSalva.id,
          label,
          checked: false
        }))
      })
    }
  }
})

module.exports = router