const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')

const SYSTEM_PROMPT = `Você é um agente de QA (Quality Assurance) especializado, treinado para trabalhar com a equipe da Nocorp.

Contexto do sistema:
- A Nocorp usa um QA System integrado com o Asana via webhooks
- Tasks entram em "Em QA" quando o dev termina; o analista de QA avalia e decide: Aprovar ✓, Sugerir alteração ↺ ou Recusar ✗
- Cada task tem: título, descrição com critérios de aceitação, link de teste (preview), e mockups de design
- Tasks recusadas voltam para o dev com comentário detalhado do motivo
- Tasks com sugestão voltam para ajuste sem reprovar formalmente

Seu papel:
1. Ajudar o analista a criar planos de teste detalhados para cada task
2. Sugerir cenários de borda e casos críticos que podem ser esquecidos
3. Aprender os padrões de qualidade específicos da Nocorp através da conversa
4. Quando receber uma descrição de task, gerar um checklist de testes prático e objetivo
5. Apoiar decisões de aprovação/reprovação com critérios técnicos

Ao analisar uma task, sempre considere:
- ✅ Fluxo principal (caminho feliz — tudo certo)
- ⚠️ Fluxos de erro (campos inválidos, dados ausentes, ações proibidas)
- 📱 Responsividade (desktop, tablet, mobile)
- 🔗 Integrações (links funcionando, dados carregando, APIs respondendo)
- 🎯 Aderência ao mockup/design original
- ⚡ Performance básica (tempo de carregamento aceitável)
- 🔐 Segurança básica (não expor dados, validações no frontend E backend)

Formato das respostas:
- Use listas com marcadores para checklists
- Use **negrito** para destacar pontos críticos
- Seja objetivo e prático — o analista precisa de ações concretas
- Responda sempre em português brasileiro`

// GET /chat/history
router.get('/history', async (req, res) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      orderBy: { createdAt: 'asc' },
      take: 100
    })
    res.json(messages)
  } catch (err) {
    console.error('[Chat] Erro ao buscar histórico:', err)
    res.status(500).json({ error: 'Erro ao buscar histórico' })
  }
})

// POST /chat/message
router.post('/message', async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Mensagem vazia' })

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor. Adicione ao .env do backend.' })
  }

  try {
    // Salva mensagem do usuário
    await prisma.chatMessage.create({ data: { role: 'user', content: content.trim() } })

    // Busca histórico e base de conhecimento em paralelo
    const [history, knowledge] = await Promise.all([
      prisma.chatMessage.findMany({ orderBy: { createdAt: 'asc' }, take: 50 }),
      prisma.aIKnowledge.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] })
    ])

    // Constrói prompt dinâmico com a base de conhecimento
    let dynamicPrompt = SYSTEM_PROMPT

    const skills = knowledge.filter(k => k.type === 'skill' && k.content.trim())
    if (skills.length > 0) {
      dynamicPrompt += '\n\n## Skills e comportamentos aprendidos:\n'
      skills.forEach(s => {
        dynamicPrompt += `\n### ${s.name}\n${s.content}\n`
      })
    }

    const projects = knowledge.filter(k => k.type === 'project' && k.content.trim())
    if (projects.length > 0) {
      dynamicPrompt += '\n\n## Base de conhecimento por projeto:\n'
      projects.forEach(p => {
        dynamicPrompt += `\n### Projeto: ${p.name}\n${p.content}\n`
      })
    }

    // Monta messages no formato OpenAI (compatível com Groq)
    const messages = [
      { role: 'system', content: dynamicPrompt },
      ...history.map(m => ({ role: m.role, content: m.content }))
    ]

    // Chama Groq API (compatível com OpenAI)
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 2048
      })
    })

    const data = await groqRes.json()

    if (!groqRes.ok) {
      console.error('[Chat] Erro Groq:', data)
      return res.status(500).json({
        error: 'Erro na API do Groq: ' + (data.error?.message || 'resposta inválida')
      })
    }

    const reply = data.choices?.[0]?.message?.content
    if (!reply) {
      return res.status(500).json({ error: 'Resposta vazia do Groq' })
    }

    // Salva resposta do assistente
    const saved = await prisma.chatMessage.create({
      data: { role: 'assistant', content: reply }
    })

    res.json({ message: saved })
  } catch (err) {
    console.error('[Chat] Erro interno:', err)
    res.status(500).json({ error: 'Erro interno: ' + err.message })
  }
})

// DELETE /chat/history — limpa todo o histórico
router.delete('/history', async (req, res) => {
  try {
    const { count } = await prisma.chatMessage.deleteMany()
    res.json({ ok: true, deletados: count })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao limpar histórico' })
  }
})

module.exports = router
