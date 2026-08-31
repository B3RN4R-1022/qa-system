import { useState, useRef, useEffect } from 'react'
import { CHANGELOG } from '@/data/changelog'

export default function WhatsNewButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

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
        title="Novidades"
        aria-label="Novidades"
        className="w-14 h-14 flex flex-col items-center justify-center gap-1 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-all"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="text-[10px] font-medium leading-none">Novo</span>
      </button>

      {open && (
        <div className="absolute left-full bottom-0 ml-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 p-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Novidades</p>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {CHANGELOG.map(item => (
              <div key={item.version} className="border-b border-gray-100 dark:border-gray-800 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">v{item.version}</span>
                  <span className="text-[11px] text-gray-400">
                    {new Date(item.date).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
