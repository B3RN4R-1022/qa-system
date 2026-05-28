import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import DashboardStats from './pages/DashboardStats'
import QAReview from './pages/QAReview'
import Login from './pages/Login'
import Register from './pages/Register'

// Só mostra sidebar nas páginas protegidas
function Layout({ children }) {
  const { pathname } = useLocation()
  const isPublic = pathname === '/login' || pathname === '/register'
  return (
    <div className="min-h-screen">
      {children}
      {!isPublic && <Sidebar />}
    </div>
  )
}

function App() {
  return (
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
            <Route path="/review/:id" element={
              <ProtectedRoute><QAReview /></ProtectedRoute>
            } />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
