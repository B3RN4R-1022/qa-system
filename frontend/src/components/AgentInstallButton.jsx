import { useState, useRef, useEffect } from 'react'

const WINDOWS_CMD = `irm https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/nocorplus-agent/install.ps1 | iex`

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className="shrink-0 px-2.5 py-1 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 text-green-500"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          Copiado
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path strokeLinecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          Copiar
        </>
      )}
    </button>
  )
}

export default function AgentInstallButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Fecha ao clicar fora
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Instalar QA Agent"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Instalar Agent
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[480px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">N+</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Instalar Nocorp+ Agent</p>
              <p className="text-[11px] text-gray-400">Cole no PowerShell e pressione Enter</p>
            </div>
          </div>

          {/* Windows */}
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-blue-500" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
              </svg>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Windows</span>
              <span className="text-[10px] text-gray-400">PowerShell</span>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-700">
              <code className="flex-1 text-[11px] text-gray-700 dark:text-gray-300 font-mono truncate">{WINDOWS_CMD}</code>
              <CopyButton text={WINDOWS_CMD} />
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            O instalador baixa o Nocorp+ Agent, instala as dependências e cria um atalho na área de trabalho. Requer Node.js 18+ e Git. Mantenha o Agent aberto para receber análises.
          </p>
        </div>
      )}
    </div>
  )
}
