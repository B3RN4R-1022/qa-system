const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

// Listar todas as tasks
router.get('/', async (req, res) => {
  const tasks = await prisma.qATask.findMany({
    include: { checks: true }
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

  res.json(task)
})

module.exports = router