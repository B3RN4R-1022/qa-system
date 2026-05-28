const express = require('express')
const cors = require('cors')
require('dotenv').config()

const tasksRouter = require('./routes/tasks')
const actionsRouter = require('./routes/actions')
const webhookRouter = require('./routes/webhook')
const authRouter = require('./routes/auth')
const authMiddleware = require('./middleware/auth')

const app = express()

app.use(cors())
app.use(express.json())

// Rotas públicas
app.use('/auth', authRouter)
app.use('/webhook', webhookRouter)

// Rotas protegidas
app.use('/tasks', authMiddleware, tasksRouter)
app.use('/tasks', authMiddleware, actionsRouter)

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'QA System rodando' })
})

// Roda localmente (não no Vercel serverless)
if (require.main === module) {
  const cron = require('node-cron')
  const prisma = require('./lib/prisma')

  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => {
    console.log(`Backend rodando em http://localhost:${PORT}`)
  })

  // Limpeza automática: remove tasks com mais de 2 semanas sem atualização
  cron.schedule('0 0 * * *', async () => {
    const limite = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const antigas = await prisma.qATask.findMany({
      where: { updatedAt: { lt: limite } },
      select: { id: true }
    })
    if (antigas.length === 0) return
    const ids = antigas.map(t => t.id)
    await prisma.qACheck.deleteMany({ where: { taskId: { in: ids } } })
    await prisma.qATask.deleteMany({ where: { id: { in: ids } } })
    console.log(`[Cron] ${ids.length} task(s) antigas removidas automaticamente`)
  })
}

// Exporta para o Vercel
module.exports = app
