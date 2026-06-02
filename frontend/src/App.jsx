import { BrowserRouter, Routes, Route, useLocation, Link } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import DashboardStats from './pages/DashboardStats'
import Settings from './pages/Settings'
import QAReview from './pages/QAReview'
import Chat from './pages/Chat'
import DevTests from './pages/DevTests'
import Projects from './pages/Projects'
import Login from './pages/Login'
import Register from './pages/Register'
import { NocorpLogo } from './components/NocorpLogo'

function Layout({ children }) {
  const { pathname } = useLocation()
  const isPublic = pathname === '/login' || pathname === '/register'

  return (
    <div className="min-h-screen">
      <div className={!isPublic ? 'ml-[72px]' : ''}>
        {children}
      </div>
      {!isPublic && <Sidebar />}
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={
              <ProtectedRoute><Dashboard /></ProtectedRoute>
            } />
            <Route path="/dashboard" element={
              <ProtectedRoute><DashboardStats /></ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute><Settings /></ProtectedRoute>
            } />
            <Route path="/chat" element={
              <ProtectedRoute><Chat /></ProtectedRoute>
            } />
            <Route path="/dev-tests" element={
              <ProtectedRoute><DevTests /></ProtectedRoute>
            } />
            <Route path="/projects" element={
              <ProtectedRoute><Projects /></ProtectedRoute>
            } />
            <Route path="/review/:id" element={
              <ProtectedRoute><QAReview /></ProtectedRoute>
            } />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}

export default App
