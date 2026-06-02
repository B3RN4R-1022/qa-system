import { useNavigate, useLocation } from 'react-router-dom'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { NocorpIcon } from '@/components/NocorpLogo'

// ícones reutilizáveis
const icons = {
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  tests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
}

export default function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { dark, toggle } = useTheme()
  const { logout, isQA, isDev, isAdmin } = useAuth()

  // Itens visíveis para cada role
  const items = [
    {
      label: 'Tasks',
      path: '/',
      icon: icons.tasks,
      visible: true,
      enabled: true,
    },
    {
      label: 'Dashboard',
      path: '/dashboard',
      icon: icons.dashboard,
      visible: true,
      enabled: true,
    },
    {
      label: 'Testes',
      path: '/dev-tests',
      icon: icons.tests,
      visible: true,   // visível para todos — QA ver todos, dev ver seus
      enabled: true,
    },
    {
      label: 'Chat',
      path: '/chat',
      icon: icons.chat,
      visible: true,
      enabled: true,
    },
    {
      label: 'Config',
      path: '/settings',
      icon: icons.settings,
      visible: true,  // todos acessam, mas dev vê só a seção de IA
      enabled: true,
    },
    {
      label: 'Conta',
      path: null,
      icon: icons.account,
      visible: true,
      enabled: false,
    },
  ]

  return (
    <div className="fixed left-0 top-0 h-screen w-[72px] bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 flex flex-col items-center pt-4 pb-4 gap-1 z-40 shadow-sm">
      {/* Ícone Nocorp no topo */}
      <div className="mb-3">
        <NocorpIcon size={34} />
      </div>
      <div className="w-8 h-px bg-gray-100 dark:bg-gray-800 mb-2" />

      {items.filter(i => i.visible).map(item => {
        const isActive = item.path && pathname === item.path
        return (
          <button
            key={item.label}
            onClick={() => item.enabled && item.path && navigate(item.path)}
            disabled={!item.enabled}
            title={!item.enabled ? `${item.label} (em breve)` : item.label}
            className={`flex flex-col items-center gap-1 w-14 py-3 rounded-xl transition-all
              ${isActive
                ? 'bg-black dark:bg-white dark:text-black text-white'
                : item.enabled
                  ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                  : 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
              }`}
          >
            {item.icon}
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </button>
        )
      })}

      {/* Botões no fundo */}
      <div className="mt-auto flex flex-col items-center gap-1">
        <button
          onClick={logout}
          title="Sair"
          className="w-14 h-14 flex flex-col items-center justify-center gap-1 rounded-xl text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-500 dark:hover:text-red-400 transition-all"
        >
          {icons.logout}
          <span className="text-[10px] font-medium leading-none">Sair</span>
        </button>
      </div>

      {/* Botão tema */}
      <div>
        <button
          onClick={toggle}
          title={dark ? 'Modo claro' : 'Modo noturno'}
          className="w-14 h-14 flex items-center justify-center rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all overflow-hidden"
        >
          <div
            className="transition-all duration-500"
            style={{ transform: dark ? 'rotate(0deg) scale(1)' : 'rotate(180deg) scale(1)' }}
          >
            {dark ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-yellow-400">
                <circle cx="12" cy="12" r="5" />
                <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </div>
        </button>
      </div>
    </div>
  )
}
