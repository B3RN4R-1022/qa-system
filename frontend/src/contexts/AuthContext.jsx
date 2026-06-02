import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('qa_user')
    return saved ? JSON.parse(saved) : null
  })

  function login(userData, token) {
    localStorage.setItem('qa_token', token)
    localStorage.setItem('qa_user', JSON.stringify(userData))
    setUser(userData)
  }

  function logout() {
    localStorage.removeItem('qa_token')
    localStorage.removeItem('qa_user')
    setUser(null)
  }

  const role    = user?.role || 'qa'
  const isAdmin = role === 'admin'
  const isQA    = role === 'qa' || isAdmin
  const isDev   = role === 'dev'

  return (
    <AuthContext.Provider value={{ user, login, logout, role, isAdmin, isQA, isDev }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
