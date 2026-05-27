const express = require('express')
const cors = require('cors')
require('dotenv').config()

const tasksRouter = require('./routes/tasks')

const webhookRouter = require('./routes/webhook')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/tasks', tasksRouter)

app.use('/webhook', webhookRouter)

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'QA System rodando' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`)
})