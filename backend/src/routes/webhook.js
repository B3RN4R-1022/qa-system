const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { getTask, getPreviewUrl, addComment, updateStatusByName } = require('../services/asana')
const { extrairRequisitos } = require('../services/parser')

router.post('/', async (req, res) => {
  const secret = req.headers['x-hook-secret']
  if (secret) {
    res.setHeader('x-hook-secret', secret)
    return res.sendStatus(200)
  }

  res.sendStatus(200)

  const events = req.body.events || []
  const processadas = new Set()

  for (const event of events) {
    if (event.resource?.resource_type !== 'task') continue

    const taskId = event.resource.gid
    if (processadas.has(taskId)) continue
    processadas.add(taskId)

    try {
      // Task excluída no Asana → remove do sistema
      if (event.action === 'deleted') {
        const taskLocal = await prisma.qATask.findUnique({ where: { asanaId: taskId } })
        if (taskLocal) {
          await prisma.qACheck.deleteMany({ where: { taskId: taskLocal.id } })
          await prisma.qATask.delete({ where: { id: taskLocal.id } })
          console.log(`Task ${taskId} excluída do sistema`)
        }
        continue
      }

      const task = await getTask(taskId)

      const statusField = task.custom_fields?.find(
        f => f.name === 'Status' || f.name === 'status'
      )
      const status = statusField?.enum_value?.name || ''

      if (status !== 'Em QA') continue

      // Valida campos obrigatórios
      const CAMPOS_OBRIGATORIOS = ['Prioridade', 'Complexidade', 'Tipo', 'Início']
      const faltando = []
      if (!task.name) faltando.push('Título')
      if (!task.notes) faltando.push('Descrição')
      for (const nomeCampo of CAMPOS_OBRIGATORIOS) {
        const campo = task.custom_fields?.find(f => f.name === nomeCampo)
        if (!campo || !campo.display_value) faltando.push(nomeCampo)
      }

      if (faltando.length > 0) {
        const mensagem = `⚠️ Devolvida pelo QA\n\nOs seguintes campos obrigatórios estão faltando:\n${faltando.map(f => `- ${f}`).join('\n')}`
        await addComment(taskId, mensagem)
        await updateStatusByName(taskId, 'QA Falhou')
        await prisma.qATask.upsert({
          where: { asanaId: taskId },
          update: { status: 'rejected', title: task.name || 'Sem título' },
          create: {
            asanaId: taskId,
            title: task.name || 'Sem título',
            description: task.notes || null,
            previewUrl: null,
            assignee: task.assignee?.name || null,
            assigneeEmail: task.assignee?.email || null,
            status: 'rejected'
          }
        })
        console.log(`Task ${taskId} devolvida. Faltando: ${faltando.join(', ')}`)
        continue
      }

      const requisitos = extrairRequisitos(task.notes)
      const previewUrl = await getPreviewUrl(taskId)
      const instanciaField = task.custom_fields?.find(f => f.name === 'Instâncias' || f.name === 'Instancia' || f.name === 'Instância')
      const projectName = instanciaField?.display_value || null

      const taskSalva = await prisma.qATask.upsert({
        where: { asanaId: taskId },
        update: {
          status: 'in_qa',
          previewUrl,
          description: task.notes,
          title: task.name,
          assignee: task.assignee?.name || null,
          assigneeEmail: task.assignee?.email || null,
          projectName
        },
        create: {
          asanaId: taskId,
          title: task.name,
          description: task.notes,
          previewUrl,
          assignee: task.assignee?.name || null,
          assigneeEmail: task.assignee?.email || null,
          projectName,
          status: 'in_qa'
        }
      })

      if (requisitos.length > 0) {
        await prisma.qACheck.deleteMany({ where: { taskId: taskSalva.id } })
        await prisma.qACheck.createMany({
          data: requisitos.map(label => ({ taskId: taskSalva.id, label, checked: false }))
        })
      }

      console.log(`Task ${taskId} salva como Em QA`)
    } catch (err) {
      console.error(`Erro ao processar task ${taskId}:`, err.message)
    }
  }
})

module.exports = router
