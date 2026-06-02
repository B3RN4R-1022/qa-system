const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
require('dotenv').config()

const tasksRouter = require('./routes/tasks')
const actionsRouter = require('./routes/actions')
const webhookRouter = require('./routes/webhook')
const authRouter = require('./routes/auth')
const adminRouter = require('./routes/admin')
const statsRouter = require('./routes/stats')
const chatRouter = require('./routes/chat')
const knowledgeRouter = require('./routes/knowledge')
const aiqaRouter = require('./routes/aiqa')
const settingsRouter = require('./routes/settings')
const qaJobsRouter = require('./routes/qaJobs')
const authMiddleware = require('./middleware/auth')

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(cookieParser())
app.use(express.json())

// Rotas públicas
app.use('/auth', authRouter)
app.use('/webhook', webhookRouter)

// Rotas protegidas
app.use('/tasks', authMiddleware, tasksRouter)
app.use('/tasks', authMiddleware, actionsRouter)
app.use('/admin', authMiddleware, adminRouter)
app.use('/stats', authMiddleware, statsRouter)
app.use('/chat', authMiddleware, chatRouter)
app.use('/knowledge', authMiddleware, knowledgeRouter)
app.use('/tasks/:id/ai-report', authMiddleware, aiqaRouter)
app.use('/tasks/:id/run-ai-qa', authMiddleware, aiqaRouter)
app.use('/settings', authMiddleware, settingsRouter)
app.use('/qa-jobs', authMiddleware, qaJobsRouter)

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
