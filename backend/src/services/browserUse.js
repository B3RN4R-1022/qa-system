const prisma = require('../lib/prisma')

const QA_AGENT_URL = process.env.QA_AGENT_URL || 'http://127.0.0.1:8000'

/**
 * Executa o agente QA chamando o serviço Python local
 */
async function runBrowserUseAgent(taskId) {
  // Busca task com checks
  const task = await prisma.qATask.findUnique({
    where: { id: taskId },
    include: { checks: true }
  })

  if (!task) throw new Error('Task não encontrada')
  if (!task.previewUrl) throw new Error('Task não tem URL de preview')

  // Busca base de conhecimento e skills em paralelo
  const [knowledge, skills] = await Promise.all([
    task.projectName
      ? prisma.aIKnowledge.findUnique({
          where: { type_name: { type: 'project', name: task.projectName } }
        }).catch(() => null)
      : Promise.resolve(null),
    prisma.aIKnowledge.findMany({ where: { type: 'skill' } })
  ])

  const criteria = task.checks?.map(c => c.label) || []
  const knowledgeText = knowledge?.content || ''
  const skillsText = skills?.filter(s => s.content?.trim()).map(s => `### ${s.name}\n${s.content}`).join('\n\n') || ''

  // Marca como running
  await prisma.aIReport.upsert({
    where: { taskId },
    create: { taskId, status: 'running' },
    update: { status: 'running', report: null }
  })

  try {
    // Health check: confirma que o serviço Python está no ar
    try {
      const health = await fetch(`${QA_AGENT_URL}/`, { method: 'GET' })
      if (!health.ok) throw new Error('health não OK')
      console.log(`[BrowserUse] ✅ QA Agent online em ${QA_AGENT_URL}`)
    } catch {
      const msg = `Serviço QA Agent não está rodando em ${QA_AGENT_URL}.\nInicie abrindo o arquivo: qa-agent/start.bat`
      await prisma.aIReport.update({
        where: { taskId },
        data: { status: 'error', report: msg }
      })
      throw new Error(msg)
    }

    // Chama o serviço Python
    const res = await fetch(`${QA_AGENT_URL}/run-qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        title: task.title,
        preview_url: task.previewUrl,
        criteria,
        project_name: task.projectName || '',
        description: task.description || '',   // Requisitos da task como contexto
        knowledge: knowledgeText,
        skills: skillsText,
        headless: false  // mostra o Chromium na tela
      })
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'QA Agent não respondeu corretamente')
    }

    // Polling sem timeout — aguarda até o agente terminar
    while (true) {
      await new Promise(r => setTimeout(r, 5000))

      const pollRes = await fetch(`${QA_AGENT_URL}/result/${taskId}`)
      const pollData = await pollRes.json()

      console.log(`[BrowserUse] Polling — status: ${pollData.status}`)

      if (pollData.status === 'done' || pollData.status === 'error') {
        const saved = await prisma.aIReport.update({
          where: { taskId },
          data: {
            status: pollData.status,
            report: pollData.report || 'Sem resultado',
          }
        })
        return saved
      }
    }

  } catch (err) {
    console.error('[BrowserUse] Erro:', err.message)

    // Verifica se o serviço Python está rodando
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      const msg = `Serviço QA Agent não está rodando.\nInicie abrindo o arquivo: qa-agent/start.bat`
      await prisma.aIReport.update({
        where: { taskId },
        data: { status: 'error', report: msg }
      })
      throw new Error(msg)
    }

    await prisma.aIReport.update({
      where: { taskId },
      data: { status: 'error', report: `Erro: ${err.message}` }
    })
    throw err
  }
}

module.exports = { runBrowserUseAgent }
