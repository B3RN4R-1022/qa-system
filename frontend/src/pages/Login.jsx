import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import API from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [step, setStep] = useState('credentials') // 'credentials' | 'totp'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [tempToken, setTempToken] = useState(null)
  const [erro, setErro] = useState(null)
  const [loading, setLoading] = useState(false)

  // Passo 1 — valida email e senha
  async function handleCredentials(e) {
    e.preventDefault()
    setLoading(true)
    setErro(null)

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.error || 'Erro ao fazer login')
        return
      }

      setTempToken(data.tempToken)
      setStep('totp')
    } catch {
      setErro('Erro de rede. Verifique se o backend está rodando.')
    } finally {
      setLoading(false)
    }
  }

  // Passo 2 — valida código TOTP
  async function handleTotp(e) {
    e.preventDefault()
    setLoading(true)
    setErro(null)

    try {
      const res = await fetch(`${API}/auth/verify-totp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code: totpCode })
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.error || 'Código incorreto')
        return
      }

      login(data.user, data.token)
      navigate('/')
    } catch {
      setErro('Erro de rede. Verifique se o backend está rodando.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">QA System</CardTitle>
        </CardHeader>
        <CardContent>

          {step === 'credentials' && (
            <form onSubmit={handleCredentials} className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="seu@email.com"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="••••••••"
                  required
                />
              </div>

              {erro && <p className="text-sm text-red-500">{erro}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Verificando...' : 'Continuar'}
              </Button>

              <p className="text-sm text-center text-gray-500">
                Não tem conta?{' '}
                <Link to="/register" className="text-black font-medium hover:underline">
                  Criar conta
                </Link>
              </p>
            </form>
          )}

          {step === 'totp' && (
            <form onSubmit={handleTotp} className="space-y-4">
              <p className="text-sm text-gray-600 text-center">
                Abra o <strong>Google Authenticator</strong> ou <strong>Authy</strong> e insira o código de 6 dígitos.
              </p>
              <div>
                <label className="text-sm font-medium block mb-1">Código</label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full border rounded px-3 py-2 text-sm text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>

              {erro && <p className="text-sm text-red-500">{erro}</p>}

              <Button type="submit" className="w-full" disabled={loading || totpCode.length < 6}>
                {loading ? 'Verificando...' : 'Entrar'}
              </Button>

              <button
                type="button"
                onClick={() => { setStep('credentials'); setErro(null); setTotpCode('') }}
                className="w-full text-sm text-gray-500 hover:underline"
              >
                ← Voltar
              </button>
            </form>
          )}

        </CardContent>
      </Card>
    </div>
  )
}

export default Login
