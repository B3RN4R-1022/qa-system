const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { addComment, updateStatusByName } = require('../services/asana')

// Aprovar task
router.post('/:id/approve', async (req, res) => {
  try {
    const task = await prisma.qATask.findUnique({
      where: { id: req.params.id }
    })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    // Atualiza no banco
    await prisma.qATask.update({
      where: { id: task.id },
      data: { status: 'approved' }
    })

    // Atualiza no Asana
    await updateStatusByName(task.asanaId, 'Feito')

    res.json({ success: true })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

// Reprovar task
router.post('/:id/reject', async (req, res) => {
  try {
    const { comentario, checks } = req.body

    const task = await prisma.qATask.findUnique({
      where: { id: req.params.id }
    })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    // Monta o comentário com os checks não marcados
    const checksFalhando = checks
      .filter(c => !c.checked)
      .map(c => `- ${c.label}`)
      .join('\n')

    const textoComentario = `❌ Task reprovada no QA\n\n${comentario}\n\nItens pendentes:\n${checksFalhando}`

    // Atualiza no banco
    await prisma.qATask.update({
      where: { id: task.id },
      data: { status: 'rejected' }
    })

    // Comenta e muda status no Asana
    await addComment(task.asanaId, textoComentario)
    await updateStatusByName(task.asanaId, 'Em Correção')

    res.json({ success: true })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router