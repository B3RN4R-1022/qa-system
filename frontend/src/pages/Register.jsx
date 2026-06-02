import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import API from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState('form') // 'form' | 'qrcode'
  const [registerSecret, setRegisterSecret] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('qa')
  const [qrCode, setQrCode] = useState(null)
  const [erro, setErro] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleRegister(e) {
    e.preventDefault()
    setLoading(true)
    setErro(null)

    try {
      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, registerSecret, role })
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.error || 'Erro ao criar conta')
        return
      }

      setQrCode(data.qrCode)
      setStep('qrcode')
    } catch {
      setErro('Erro de rede. Verifique se o backend está rodando.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'qrcode') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-center">Configure o Autenticador</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600 text-center">
              Escaneie o QR code abaixo com o <strong>Google Authenticator</strong> ou <strong>Authy</strong>.
            </p>
            <div className="flex justify-center">
              <img src={qrCode} alt="QR Code" className="w-48 h-48" />
            </div>
            <p className="text-sm text-gray-500 text-center">
              Após escanear, clique em continuar para fazer login.
            </p>
            <Button className="w-full" onClick={() => navigate('/login')}>
              Continuar para o login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">Criar conta</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">Senha de registro</label>
              <input
                type="password"
                value={registerSecret}
                onChange={e => setRegisterSecret(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="Código de acesso"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Nome</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="Seu nome"
                required
              />
            </div>
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
                placeholder="mínimo 6 caracteres"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Tipo de conta</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRole('qa')}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                    role === 'qa'
                      ? 'border-black bg-black text-white'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  QA Analyst
                </button>
                <button
                  type="button"
                  onClick={() => setRole('dev')}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                    role === 'dev'
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  Desenvolvedor
                </button>
              </div>
            </div>

            {erro && <p className="text-sm text-red-500">{erro}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Criando conta...' : 'Criar conta'}
            </Button>

            <p className="text-sm text-center text-gray-500">
              Já tem conta?{' '}
              <Link to="/login" className="text-black font-medium hover:underline">
                Entrar
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Register
