const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

// GET /projects — lista todos os projetos conhecidos com stats de cache e repo
router.get('/', async (req, res) => {
  try {
    const [qaTasks, devTests, knowledgeProjects, caches, repoConfigs, sitemaps] = await Promise.all([
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
        select: { name: true, updatedAt: true }
      }),
      prisma.aIKnowledge.findMany({
        where: { type: 'project_repo' },
        select: { name: true, content: true, updatedAt: true }
      }),
      prisma.aIKnowledge.findMany({
        where: { type: 'wix_sitemap' },
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

    const cacheMap   = new Map(caches.map(c => [c.name, c]))
    const sitemapMap = new Map(sitemaps.map(s => {
      let parsed = {}
      try { parsed = JSON.parse(s.content) } catch {}
      return [s.name, { pageCount: parsed.pageCount || 0, updatedAt: s.updatedAt }]
    }))
    const repoMap = new Map(repoConfigs.map(r => {
      let parsed = {}
      try { parsed = JSON.parse(r.content) } catch {}
      return [r.name, { ...parsed, updatedAt: r.updatedAt }]
    }))

    const projects = Array.from(projectMap.values()).map(p => {
      const repo    = repoMap.get(p.name)
      const sitemap = sitemapMap.get(p.name)
      return {
        name: p.name,
        testCount: countMap.get(p.name) || 0,
        lastActivity: p.lastActivity,
        projectType: repo?.projectType || null,          // 'wix_velo'|'wix_headless'|'repo'
        hasCache: cacheMap.has(p.name),
        cacheUpdatedAt: cacheMap.get(p.name)?.updatedAt || null,
        hasRepo: !!repo?.repoPath,
        repoPath: repo?.repoPath || null,
        repoAnalyzedAt: repo?.analyzedAt || null,
        repoFileCount: repo?.fileCount || null,
        repoLastCommit: repo?.lastCommit || null,
        hasSitemap: sitemapMap.has(p.name),
        sitemapPageCount: sitemap?.pageCount || null,
        sitemapUpdatedAt: sitemap?.updatedAt || null,
      }
    })

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

// GET /projects/:name/sitemap — retorna o mapa de site Wix Velo
router.get('/:name/sitemap', async (req, res) => {
  try {
    const record = await prisma.aIKnowledge.findUnique({
      where: { type_name: { type: 'wix_sitemap', name: req.params.name } }
    })
    if (!record) return res.json(null)
    try { res.json(JSON.parse(record.content)) }
    catch { res.json({ raw: record.content }) }
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar mapa do site' })
  }
})

// PUT /projects/:name/sitemap — salva o mapa de site (chamado pelo worker)
router.put('/:name/sitemap', async (req, res) => {
  try {
    const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    await prisma.aIKnowledge.upsert({
      where: { type_name: { type: 'wix_sitemap', name: req.params.name } },
      create: { type: 'wix_sitemap', name: req.params.name, content },
      update: { content }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar mapa do site' })
  }
})

// DELETE /projects/:name/sitemap — remove o mapa (força re-mapeamento)
router.delete('/:name/sitemap', async (req, res) => {
  try {
    await prisma.aIKnowledge.deleteMany({
      where: { type: 'wix_sitemap', name: req.params.name }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover mapa do site' })
  }
})

// GET /projects/:name/repo — retorna config do repositório local
router.get('/:name/repo', async (req, res) => {
  try {
    const record = await prisma.aIKnowledge.findUnique({
      where: { type_name: { type: 'project_repo', name: req.params.name } }
    })
    if (!record) return res.json(null)
    try { res.json(JSON.parse(record.content)) }
    catch { res.json({ raw: record.content }) }
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar config do repo' })
  }
})

// PUT /projects/:name/repo — salva/atualiza config do repositório
// Body: { repoPath?, lastCommit?, analyzedAt?, fileCount? }
router.put('/:name/repo', async (req, res) => {
  try {
    // Faz merge com dados existentes para não sobrescrever campos não enviados
    const existing = await prisma.aIKnowledge.findUnique({
      where: { type_name: { type: 'project_repo', name: req.params.name } }
    })
    let current = {}
    if (existing?.content) {
      try { current = JSON.parse(existing.content) } catch {}
    }
    const merged = { ...current, ...req.body }
    await prisma.aIKnowledge.upsert({
      where: { type_name: { type: 'project_repo', name: req.params.name } },
      create: { type: 'project_repo', name: req.params.name, content: JSON.stringify(merged) },
      update: { content: JSON.stringify(merged) }
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[Projects] Erro ao salvar repo:', err)
    res.status(500).json({ error: 'Erro ao salvar config do repo' })
  }
})

// DELETE /projects/:name/repo — remove config do repositório
router.delete('/:name/repo', async (req, res) => {
  try {
    await prisma.aIKnowledge.deleteMany({
      where: { type: 'project_repo', name: req.params.name }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover config do repo' })
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
