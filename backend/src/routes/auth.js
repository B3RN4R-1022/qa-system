const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const speakeasy = require('speakeasy')
const QRCode = require('qrcode')
const prisma = require('../lib/prisma')

// Login — passo 1: valida email e senha
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha incorretos' })
    }

    const senhaCorreta = await bcrypt.compare(password, user.password)
    if (!senhaCorreta) {
      return res.status(401).json({ error: 'Email ou senha incorretos' })
    }

    // Gera token temporário válido por 5 minutos para o passo do TOTP
    const tempToken = jwt.sign(
      { id: user.id, email: user.email, step: 'totp' },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    )

    res.json({ requiresTotp: true, tempToken })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Login — passo 2: valida código TOTP
router.post('/verify-totp', async (req, res) => {
  try {
    const { tempToken, code } = req.body

    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Token e código são obrigatórios' })
    }

    let decoded
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET)
    } catch {
      return res.status(401).json({ error: 'Token expirado. Faça login novamente.' })
    }

    if (decoded.step !== 'totp') {
      return res.status(401).json({ error: 'Token inválido' })
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } })
    if (!user || !user.totpSecret) {
      return res.status(401).json({ error: 'Autenticador não configurado' })
    }

    const valido = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: code,
      window: 1
    })

    if (!valido) {
      return res.status(401).json({ error: 'Código incorreto' })
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    )

    res.json({ token, user: { id: user.id, name: user.name, email: user.email } })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

// Registro
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, registerSecret } = req.body

    // Valida a senha de registro
    if (registerSecret !== process.env.REGISTER_SECRET) {
      return res.status(403).json({ error: 'Senha de registro incorreta' })
    }

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' })
    }

    const existente = await prisma.user.findUnique({ where: { email } })
    if (existente) {
      return res.status(400).json({ error: 'Este email já está cadastrado' })
    }

    // Gera o segredo TOTP
    const totpSecret = speakeasy.generateSecret({
      name: `QA System (${email})`
    })

    const senhaHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { name, email, password: senhaHash, totpSecret: totpSecret.base32 }
    })

    // Gera o QR code para o Google Authenticator
    const qrCodeUrl = await QRCode.toDataURL(totpSecret.otpauth_url)

    res.status(201).json({
      message: 'Conta criada. Configure o autenticador.',
      qrCode: qrCodeUrl,
      user: { id: user.id, name: user.name, email: user.email }
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: 'Erro interno do servidor' })
  }
})

module.exports = router
