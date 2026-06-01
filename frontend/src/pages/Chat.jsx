import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import API from '@/lib/api'
import { NocorpLogo } from '@/components/NocorpLogo'

// Renderiza markdown básico das respostas da IA
function parseBold(text) {
  const parts = text.split(/\*\*(.*?)\*\*/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

function MessageContent({ content, isUser }) {
  if (isUser) {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
  }
  return (
    <div className="text-sm leading-relaxed space-y-0.5">
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />
        if (line.startsWith('## ')) return (
          <p key={i} className="font-semibold text-sm mt-2 mb-0.5">{line.slice(3)}</p>
        )
        if (line.startsWith('### ')) return (
          <p key={i} className="font-medium text-sm mt-1.5">{line.slice(4)}</p>
        )
        if (line.startsWith('- ') || line.startsWith('* ')) return (
          <div key={i} className="flex gap-1.5 ml-2">
            <span className="shrink-0 text-gray-400 dark:text-gray-500 mt-0.5">•</span>
            <span>{parseBold(line.slice(2))}</span>
          </div>
        )
        const numMatch = line.match(/^(\d+)\.\s(.*)/)
        if (numMatch) return (
          <div key={i} className="flex gap-1.5 ml-2">
            <span className="shrink-0 text-gray-400 dark:text-gray-500 min-w-[1.1rem]">{numMatch[1]}.</span>
            <span>{parseBold(numMatch[2])}</span>
          </div>
        )
        return <p key={i}>{parseBold(line)}</p>
      })}
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex gap-1.5 items-center h-5 px-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

function BotAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center shrink-0 mt-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    </div>
  )
}

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  )
}

const STARTER_PROMPTS = [
  {
    label: '📋 Analisar task',
    desc: 'Cole uma descrição',
    text: 'Vou colar a descrição de uma task do Asana. Analise e me dê um plano de testes detalhado:\n\n',
    fill: true
  },
  {
    label: '📱 Checklist mobile',
    desc: 'Responsividade',
    text: 'Me dê um checklist padrão de testes para validar responsividade mobile de uma funcionalidade web.'
  },
  {
    label: '📝 Testar formulário',
    desc: 'Cenários de validação',
    text: 'Quais cenários devo testar em um formulário de cadastro típico? Inclua casos de borda e validações.'
  },
  {
    label: '✅ Critérios de aprovação',
    desc: 'O que avaliar',
    text: 'Quais são os critérios gerais que devo usar para decidir se aprovo ou reprovo uma task no QA?'
  },
]

export default function Chat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const textareaRef = useRef(null)

  const token = localStorage.getItem('qa_token')

  useEffect(() => { loadHistory() }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function loadHistory() {
    try {
      const res = await fetch(`${API}/chat/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setMessages(Array.isArray(data) ? data : [])
    } catch {
      setError('Erro ao carregar histórico')
    } finally {
      setLoadingHistory(false)
    }
  }

  async function sendMessage(textOverride) {
    const content = (textOverride ?? input).trim()
    if (!content || loading) return

    setInput('')
    setError(null)
    setLoading(true)

    // Resetar altura do textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = '42px'
    }

    // Adiciona mensagem do usuário otimisticamente
    const optimistic = { id: `opt-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fetch(`${API}/chat/message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro desconhecido')
      setMessages(prev => [...prev, data.message])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function clearHistory() {
    if (!confirm('Limpar todo o histórico do chat? Isso não pode ser desfeito.')) return
    await fetch(`${API}/chat/history`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    setMessages([])
    setError(null)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleInput(e) {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
  }

  function handleStarterClick(p) {
    if (p.fill) {
      setInput(p.text)
      setTimeout(() => {
        inputRef.current?.focus()
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 128) + 'px'
        }
      }, 50)
    } else {
      sendMessage(p.text)
    }
  }

  const isEmpty = !loadingHistory && messages.length === 0

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-purple-600 dark:text-purple-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">Agente de QA</h1>
            <p className="text-[11px] text-gray-400 leading-tight">Powered by Groq · Treinamento de IA</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              Limpar histórico
            </button>
          )}
          <Link to="/"><NocorpLogo height={24} /></Link>
        </div>
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loadingHistory ? (
          <div className="flex justify-center items-center h-full">
            <p className="text-sm text-gray-400">Carregando histórico...</p>
          </div>
        ) : isEmpty ? (
          /* Tela inicial vazia */
          <div className="flex flex-col items-center justify-center h-full gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-purple-600 dark:text-purple-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Agente de QA</h2>
              <p className="text-sm text-gray-400 mt-1 max-w-sm text-center leading-relaxed">
                Treine a IA com os padrões de qualidade da Nocorp. Cole descrições de tasks, faça perguntas e refine como ela analisa.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {STARTER_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleStarterClick(p)}
                  className="text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all"
                >
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Lista de mensagens */
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && <BotAvatar />}

                <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-tr-sm'
                    : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-sm shadow-sm'
                }`}>
                  <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                  <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-purple-200' : 'text-gray-400'}`}>
                    {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {msg.role === 'user' && <UserAvatar />}
              </div>
            ))}

            {/* Indicador de digitação */}
            {loading && (
              <div className="flex gap-2.5 justify-start">
                <BotAvatar />
                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={el => { inputRef.current = el; textareaRef.current = el }}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Digite uma mensagem… (Enter para enviar, Shift+Enter para nova linha)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all overflow-y-auto"
            style={{ minHeight: '42px', maxHeight: '128px' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white disabled:text-gray-400 dark:disabled:text-gray-500 flex items-center justify-center transition-all shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[11px] text-gray-400 dark:text-gray-600 mt-1.5">
          Powered by Groq · Llama 3.3 70B · histórico salvo para contexto entre sessões
        </p>
      </div>
    </div>
  )
}
