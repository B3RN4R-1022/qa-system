const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function maskKey(key) {
  if (!key || key.length < 10) return '••••••••'
  return key.slice(0, 6) + '••••••••' + key.slice(-4)
}

// GET /settings/ai — retorna config de IA + uso de tokens hoje
router.get('/ai', async (req, res) => {
  try {
    const [keyRecord, tokenAgg] = await Promise.all([
      prisma.aIKnowledge.findUnique({
        where: { type_name: { type: 'config', name: 'cerebras_api_key' } }
      }),
      prisma.aIReport.aggregate({
        where: {
          updatedAt: { gte: startOfToday() },
          tokensUsed: { not: null }
        },
        _sum: { tokensUsed: true }
      })
    ])

    res.json({
      hasKey: !!keyRecord?.content,
      keyMasked: keyRecord?.content ? maskKey(keyRecord.content) : null,
      tokensToday: tokenAgg._sum.tokensUsed || 0,
      tokenLimitDay: 1_000_000,
    })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configurações' })
  }
})

// POST /settings/ai — salva API key da Cerebras
router.post('/ai', async (req, res) => {
  const { cerebrasKey } = req.body || {}
  if (!cerebrasKey?.startsWith('csk-')) {
    return res.status(400).json({ error: 'Chave inválida — deve começar com csk-' })
  }
  try {
    await prisma.aIKnowledge.upsert({
      where: { type_name: { type: 'config', name: 'cerebras_api_key' } },
      create: { type: 'config', name: 'cerebras_api_key', content: cerebrasKey },
      update: { content: cerebrasKey }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar chave' })
  }
})

// DELETE /settings/ai — remove a API key
router.delete('/ai', async (req, res) => {
  try {
    await prisma.aIKnowledge.deleteMany({
      where: { type: 'config', name: 'cerebras_api_key' }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover chave' })
  }
})

module.exports = router
