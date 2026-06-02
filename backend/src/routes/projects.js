const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

// GET /projects — lista todos os projetos conhecidos com stats de cache
router.get('/', async (req, res) => {
  try {
    const [qaTasks, devTests, knowledgeProjects, caches] = await Promise.all([
      prisma.qATask.findMany({
        select: { projectName: true, updatedAt: true },
        where: { projectName: { not: null } }
      }),
      prisma.devTest.findMany({
        select: { projectName: true, updatedAt: true },
        where: { projectName: { not: null } }
      }),
      prisma.aIKnowledge.findMany({
        where: { type: 'project' },
        select: { name: true, updatedAt: true }
      }),
      prisma.aIKnowledge.findMany({
        where: { type: 'site_cache' },
        select: { name: true, content: true, updatedAt: true }
      })
    ])

    // Merge de todos os nomes de projeto com data de última atividade
    const projectMap = new Map()
    const addProject = (name, date) => {
      if (!name?.trim()) return
      const existing = projectMap.get(name)
      if (!existing || (date && (!existing.lastActivity || date > existing.lastActivity))) {
        projectMap.set(name, { name, lastActivity: date || null })
      }
    }

    qaTasks.forEach(t => addProject(t.projectName, t.updatedAt))
    devTests.forEach(t => addProject(t.projectName, t.updatedAt))
    knowledgeProjects.forEach(k => addProject(k.name, k.updatedAt))

    // Contagem de testes por projeto
    const countMap = new Map()
    qaTasks.forEach(t => {
      if (t.projectName) countMap.set(t.projectName, (countMap.get(t.projectName) || 0) + 1)
    })
    devTests.forEach(t => {
      if (t.projectName) countMap.set(t.projectName, (countMap.get(t.projectName) || 0) + 1)
    })

    const cacheMap = new Map(caches.map(c => [c.name, c]))

    const projects = Array.from(projectMap.values()).map(p => ({
      name: p.name,
      testCount: countMap.get(p.name) || 0,
      lastActivity: p.lastActivity,
      hasCache: cacheMap.has(p.name),
      cacheUpdatedAt: cacheMap.get(p.name)?.updatedAt || null
    }))

    projects.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return a.name.localeCompare(b.name)
      if (!a.lastActivity) return 1
      if (!b.lastActivity) return -1
      return new Date(b.lastActivity) - new Date(a.lastActivity)
    })

    res.json(projects)
  } catch (err) {
    console.error('[Projects] Erro:', err)
    res.status(500).json({ error: 'Erro ao listar projetos' })
  }
})

// GET /projects/:name/cache — busca o cache de site de um projeto
router.get('/:name/cache', async (req, res) => {
  try {
    const cache = await prisma.aIKnowledge.findUnique({
      where: { type_name: { type: 'site_cache', name: req.params.name } }
    })
    res.json(cache || null)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar cache' })
  }
})

// DELETE /projects/:name/cache — limpa o cache de um projeto
router.delete('/:name/cache', async (req, res) => {
  try {
    await prisma.aIKnowledge.deleteMany({
      where: { type: 'site_cache', name: req.params.name }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover cache' })
  }
})

module.exports = router
