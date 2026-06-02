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
      where: { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
      take: 100
    })
    res.json(messages)
  } catch (err) {
    console.error('[Chat] Erro ao buscar histórico:', err)
    res.status(500).json({ error: 'Erro ao buscar histórico' })
  }
})

// Chama a Cerebras API (compatível com OpenAI). Tenta primary_model primeiro;
// se receber 429 faz fallback automático para fallback_model.
async function callCerebras(apiKey, messages) {
  const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions'
  const PRIMARY_MODEL  = 'gpt-oss-120b'
  const FALLBACK_MODEL = 'zai-glm-4.7'

  async function attempt(model) {
    const res = await fetch(CEREBRAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048 })
    })
    return { res, data: await res.json() }
  }

  let { res, data } = await attempt(PRIMARY_MODEL)

  // 429 → fallback
  if (res.status === 429) {
    console.warn('[Chat] Cerebras 429 em gpt-oss-120b, tentando zai-glm-4.7...');
    ({ res, data } = await attempt(FALLBACK_MODEL))
  }

  if (!res.ok) {
    throw new Error('Cerebras API error: ' + (data.error?.message || res.status))
  }

  const reply = data.choices?.[0]?.message?.content
  if (!reply) throw new Error('Resposta vazia da Cerebras')
  return reply
}

// POST /chat/message
router.post('/message', async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'Mensagem vazia' })

  try {
    // Busca a Cerebras API key do banco
    const keyRecord = await prisma.aIKnowledge.findUnique({
      where: { type_name: { type: 'config', name: 'cerebras_api_key' } }
    })

    if (!keyRecord?.content) {
      return res.status(500).json({
        error: 'Cerebras API key não configurada. Vá em Configurações → Config de IA e adicione sua chave csk-...'
      })
    }

    // Salva mensagem do usuário
    await prisma.chatMessage.create({ data: { userId: req.user.id, role: 'user', content: content.trim() } })

    // Busca histórico (só deste usuário) e base de conhecimento em paralelo
    const [history, knowledge] = await Promise.all([
      prisma.chatMessage.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' }, take: 50 }),
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

    // Monta messages no formato OpenAI
    const messages = [
      { role: 'system', content: dynamicPrompt },
      ...history.map(m => ({ role: m.role, content: m.content }))
    ]

    // Chama Cerebras (com fallback automático em 429)
    const reply = await callCerebras(keyRecord.content, messages)

    // Salva resposta do assistente
    const saved = await prisma.chatMessage.create({
      data: { userId: req.user.id, role: 'assistant', content: reply }
    })

    res.json({ message: saved })
  } catch (err) {
    console.error('[Chat] Erro interno:', err)
    res.status(500).json({ error: 'Erro interno: ' + err.message })
  }
})

// DELETE /chat/history — limpa histórico do usuário logado
router.delete('/history', async (req, res) => {
  try {
    const { count } = await prisma.chatMessage.deleteMany({
      where: { userId: req.user.id }
    })
    res.json({ ok: true, deletados: count })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao limpar histórico' })
  }
})

module.exports = router
