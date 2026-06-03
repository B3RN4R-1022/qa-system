const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

/**
 * Dev Tests — testes manuais iniciados por devs via chat (/teste-qa)
 */

// GET /dev-tests — lista testes (dev vê só os seus, QA/admin vê todos)
router.get('/', async (req, res) => {
  try {
    const where = ['qa', 'admin'].includes(req.user.role)
      ? {}
      : { userId: req.user.id }

    const tests = await prisma.devTest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } }
    })
    res.json(tests)
  } catch (err) {
    console.error('[dev-tests GET /]', err.message)
    res.status(500).json({ error: 'Erro ao buscar testes' })
  }
})

// POST /dev-tests — cria e enfileira novo teste
router.post('/', async (req, res) => {
  const { title, description, previewUrl, projectName, criteria, projectType, requestRemap } = req.body || {}
  if (!title || !description || !previewUrl) {
    return res.status(400).json({ error: 'Título, descrição e URL são obrigatórios' })
  }
  try {
    const ops = []

    // Cria o teste
    const testPromise = prisma.devTest.create({
      data: {
        userId: req.user.id,
        title: title.trim(),
        description: description.trim(),
        previewUrl: previewUrl.trim(),
        projectName: projectName?.trim() || null,
        criteria: Array.isArray(criteria) && criteria.length > 0
          ? JSON.stringify(criteria.filter(c => c?.trim()))
          : null,
        status: 'queued',
      }
    })

    // Se informou projectType ou requestRemap, salva/atualiza project_repo
    const pName = projectName?.trim()
    if (pName && (projectType || requestRemap)) {
      ops.push(
        (async () => {
          const existing = await prisma.aIKnowledge.findUnique({
            where: { type_name: { type: 'project_repo', name: pName } }
          })
          let current = {}
          if (existing?.content) { try { current = JSON.parse(existing.content) } catch {} }

          const updates = {}
          if (projectType && !current.projectType) updates.projectType = projectType
          if (requestRemap) updates.pendingRemap = true

          if (Object.keys(updates).length > 0) {
            const merged = { ...current, ...updates }
            await prisma.aIKnowledge.upsert({
              where: { type_name: { type: 'project_repo', name: pName } },
              create: { type: 'project_repo', name: pName, content: JSON.stringify(merged) },
              update: { content: JSON.stringify(merged) }
            })
          }
        })()
      )
    }

    const [test] = await Promise.all([testPromise, ...ops])
    res.json(test)
  } catch (err) {
    console.error('[dev-tests POST /]', err.message)
    res.status(500).json({ error: 'Erro ao criar teste' })
  }
})

// GET /dev-tests/:id — status e resultado de um teste específico
router.get('/:id', async (req, res) => {
  try {
    const test = await prisma.devTest.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { name: true, email: true } } }
    })
    if (!test) return res.status(404).json({ error: 'Teste não encontrado' })
    if (req.user.role === 'dev' && test.userId !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão' })
    }
    res.json(test)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar teste' })
  }
})

// POST /dev-tests/:id/rerun — re-enfileira um teste já concluído ou com erro
router.post('/:id/rerun', async (req, res) => {
  try {
    const test = await prisma.devTest.findUnique({ where: { id: req.params.id } })
    if (!test) return res.status(404).json({ error: 'Teste não encontrado' })
    if (req.user.role === 'dev' && test.userId !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão' })
    }
    // Só permite re-run em testes finalizados (não re-fila o que já está na fila)
    if (test.status === 'queued' || test.status === 'running') {
      return res.status(400).json({ error: 'Teste já está em execução' })
    }
    const updated = await prisma.devTest.update({
      where: { id: req.params.id },
      data: { status: 'queued', report: null, tokensUsed: null, userId: req.user.id },
      include: { user: { select: { name: true, email: true } } }
    })
    res.json(updated)
  } catch (err) {
    console.error('[dev-tests POST /:id/rerun]', err.message)
    res.status(500).json({ error: 'Erro ao re-enfileirar teste' })
  }
})

// DELETE /dev-tests/:id — cancela/remove um teste
router.delete('/:id', async (req, res) => {
  try {
    const test = await prisma.devTest.findUnique({ where: { id: req.params.id } })
    if (!test) return res.status(404).json({ error: 'Teste não encontrado' })
    if (req.user.role === 'dev' && test.userId !== req.user.id) {
      return res.status(403).json({ error: 'Sem permissão' })
    }
    await prisma.devTest.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar teste' })
  }
})

module.exports = router
