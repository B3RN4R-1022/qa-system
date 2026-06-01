const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

// GET /knowledge — lista tudo
router.get('/', async (req, res) => {
  try {
    const items = await prisma.aIKnowledge.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }]
    })
    res.json(items)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar base de conhecimento' })
  }
})

// POST /knowledge — cria novo item
router.post('/', async (req, res) => {
  const { type, name, content } = req.body
  if (!type || !name) return res.status(400).json({ error: 'type e name são obrigatórios' })
  if (!['skill', 'project'].includes(type)) return res.status(400).json({ error: 'type deve ser "skill" ou "project"' })

  try {
    const item = await prisma.aIKnowledge.create({
      data: { type, name: name.trim(), content: content?.trim() || '' }
    })
    res.json(item)
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `Já existe um ${type} com esse nome` })
    res.status(500).json({ error: 'Erro ao criar item' })
  }
})

// PUT /knowledge/:id — atualiza conteúdo (e opcionalmente nome)
router.put('/:id', async (req, res) => {
  const { name, content } = req.body
  try {
    const item = await prisma.aIKnowledge.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(content !== undefined && { content: content.trim() })
      }
    })
    res.json(item)
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item não encontrado' })
    res.status(500).json({ error: 'Erro ao atualizar item' })
  }
})

// DELETE /knowledge/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.aIKnowledge.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item não encontrado' })
    res.status(500).json({ error: 'Erro ao deletar item' })
  }
})

module.exports = router
