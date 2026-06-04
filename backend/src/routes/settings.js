const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

// Pricing: Claude Haiku 4.5 — $0.80/1M input, $4/1M output
// Assumindo 65% input / 35% output por teste (browser-use tem contexto crescente)
const PRICE_INPUT_PER_M  = 0.80
const PRICE_OUTPUT_PER_M = 4.00
const INPUT_FRACTION     = 0.65
const USD_TO_BRL         = 5.75

function tokensToBrl(tokens) {
  if (!tokens) return 0
  const inp = tokens * INPUT_FRACTION
  const out = tokens * (1 - INPUT_FRACTION)
  const usd = (inp * PRICE_INPUT_PER_M + out * PRICE_OUTPUT_PER_M) / 1_000_000
  return usd * USD_TO_BRL
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// GET /settings/ai — uso de tokens + custo em BRL (hoje e total)
router.get('/ai', async (req, res) => {
  try {
    const isAdmin = ['qa', 'admin'].includes(req.user.role)
    const today = startOfToday()

    // Agrega tokens de hoje — AIReport + DevTest
    const [aiToday, devToday, aiTotal, devTotal] = await Promise.all([
      prisma.aIReport.aggregate({
        where: { updatedAt: { gte: today }, tokensUsed: { not: null } },
        _sum: { tokensUsed: true }
      }),
      prisma.devTest.aggregate({
        where: { updatedAt: { gte: today }, tokensUsed: { not: null } },
        _sum: { tokensUsed: true }
      }),
      prisma.aIReport.aggregate({
        where: { tokensUsed: { not: null } },
        _sum: { tokensUsed: true }
      }),
      prisma.devTest.aggregate({
        where: { tokensUsed: { not: null } },
        _sum: { tokensUsed: true }
      }),
    ])

    const tokensToday = (aiToday._sum.tokensUsed || 0) + (devToday._sum.tokensUsed || 0)
    const tokensTotal = (aiTotal._sum.tokensUsed || 0) + (devTotal._sum.tokensUsed || 0)

    const result = {
      tokensToday,
      tokensTotal,
      costBrlToday: tokensToBrl(tokensToday),
      costBrlTotal: tokensToBrl(tokensTotal),
    }

    // Para QA/admin: breakdown por usuário (all-time)
    if (isAdmin) {
      const [usersAiReport, usersDevTest] = await Promise.all([
        prisma.aIReport.groupBy({
          by: ['userId'],
          where: { tokensUsed: { not: null }, userId: { not: null } },
          _sum: { tokensUsed: true }
        }),
        prisma.devTest.groupBy({
          by: ['userId'],
          where: { tokensUsed: { not: null } },
          _sum: { tokensUsed: true }
        }),
      ])

      // Combina totais por userId
      const byUser = {}
      for (const r of usersAiReport) {
        byUser[r.userId] = (byUser[r.userId] || 0) + (r._sum.tokensUsed || 0)
      }
      for (const r of usersDevTest) {
        byUser[r.userId] = (byUser[r.userId] || 0) + (r._sum.tokensUsed || 0)
      }

      // Busca nomes
      const userIds = Object.keys(byUser)
      const users = userIds.length
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
        : []
      const userMap = Object.fromEntries(users.map(u => [u.id, u]))

      result.byUser = Object.entries(byUser)
        .map(([userId, tokens]) => ({
          userId,
          name: userMap[userId]?.name || 'Desconhecido',
          email: userMap[userId]?.email || '',
          tokens,
          costBrl: tokensToBrl(tokens),
        }))
        .sort((a, b) => b.tokens - a.tokens)
    }

    res.json(result)
  } catch (err) {
    console.error('[settings/ai GET]', err)
    res.status(500).json({ error: 'Erro ao buscar uso' })
  }
})

module.exports = router
