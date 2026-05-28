import { useNavigate, useLocation } from 'react-router-dom'

const ITEMS = [
  {
    label: 'Tasks',
    path: '/',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    enabled: true,
  },
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
    ),
    enabled: true,
  },
  {
    label: 'Conta',
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    enabled: false,
  },
  {
    label: 'Chat',
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    enabled: false,
  },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="fixed right-0 top-0 h-screen w-[72px] bg-white border-l border-gray-100 flex flex-col items-center pt-6 pb-4 gap-1 z-40 shadow-sm">
      {ITEMS.map(item => {
        const isActive = item.path && pathname === item.path
        return (
          <button
            key={item.label}
            onClick={() => item.enabled && item.path && navigate(item.path)}
            disabled={!item.enabled}
            title={!item.enabled ? `${item.label} (em breve)` : item.label}
            className={`flex flex-col items-center gap-1 w-14 py-3 rounded-xl transition-all
              ${isActive
                ? 'bg-black text-white'
                : item.enabled
                  ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
          >
            {item.icon}
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
