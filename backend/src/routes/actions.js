const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const { addComment, updateApprovalStatus } = require('../services/asana')

// Salva os checks no banco
async function salvarChecks(checks) {
  if (!checks || checks.length === 0) return
  for (const check of checks) {
    await prisma.qACheck.update({
      where: { id: check.id },
      data: { checked: check.checked }
    })
  }
}

// Aprovar task
router.post('/:id/approve', async (req, res) => {
  try {
    const { checks, comentario } = req.body

    const task = await prisma.qATask.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    await salvarChecks(checks)
    await prisma.qATask.update({ where: { id: task.id }, data: { status: 'approved' } })

    // Monta comentário com checks não feitos + comentário adicional (se houver)
    const naoFeitos = (checks || []).filter(c => !c.checked).map(c => `- ${c.label}`).join('\n')
    let texto = '✅ Task aprovada no QA'
    if (naoFeitos) texto += `\n\nItens não verificados:\n${naoFeitos}`
    if (comentario?.trim()) texto += `\n\n${comentario.trim()}`
    if (naoFeitos || comentario?.trim()) await addComment(task.asanaId, texto)

    // Aciona o botão ✓ Aprovar do Asana
    await updateApprovalStatus(task.asanaId, 'approved')

    res.json({ success: true })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

// Recusar task
router.post('/:id/reject', async (req, res) => {
  try {
    const { comentario, checks } = req.body

    const task = await prisma.qATask.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    // Monta comentário: checks não feitos + comentário adicional (opcional)
    const naoFeitos = (checks || []).filter(c => !c.checked).map(c => `- ${c.label}`).join('\n')
    let texto = '❌ Task recusada no QA'
    if (naoFeitos) texto += `\n\nItens não verificados:\n${naoFeitos}`
    if (comentario?.trim()) texto += `\n\n${comentario.trim()}`

    await salvarChecks(checks)
    await prisma.qATask.update({ where: { id: task.id }, data: { status: 'rejected', wasRejectedBefore: true } })
    await addComment(task.asanaId, texto)
    await updateApprovalStatus(task.asanaId, 'rejected')

    res.json({ success: true })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

// Sugerir alteração
router.post('/:id/suggest', async (req, res) => {
  try {
    const { comentario, checks } = req.body

    const task = await prisma.qATask.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    const texto = `💡 Sugestão de alteração\n\n${comentario}`

    await salvarChecks(checks)
    await prisma.qATask.update({
      where: { id: task.id },
      data: { status: 'suggested', wasSuggestedBefore: true }
    })

    await addComment(task.asanaId, texto)
    // Aciona o botão ↺ Request Changes do Asana
    await updateApprovalStatus(task.asanaId, 'changes_requested')

    res.json({ success: true })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

// Mover task para "Em QA" no Asana e salvar no banco
router.post('/:id/move-to-qa', async (req, res) => {
  try {
    const task = await prisma.qATask.findUnique({ where: { id: req.params.id } })
    if (!task) return res.status(404).json({ error: 'Task não encontrada' })

    await updateStatusByName(task.asanaId, 'Em QA')
    await prisma.qATask.update({
      where: { id: task.id },
      data: { status: 'in_qa' }
    })
    res.json({ success: true })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router