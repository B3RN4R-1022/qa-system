const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

async function main() {
  const senhaHash = await bcrypt.hash('qa123456', 10)

  const user = await prisma.user.upsert({
    where: { email: 'qa@sistema.com' },
    update: {},
    create: {
      name: 'QA Admin',
      email: 'qa@sistema.com',
      password: senhaHash
    }
  })

  console.log('Usuário criado:', user.email)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
