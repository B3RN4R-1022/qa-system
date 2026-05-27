# QA System — Progresso do Projeto

## Stack
- Frontend: React (Vite) + Tailwind CSS + Shadcn/ui
- Backend: Node.js + Express
- Banco: PostgreSQL no Supabase + Prisma ORM
- Integração: Asana API (webhooks)
- Repositório: https://github.com/B3RN4R-1022/qa-system

## O que o sistema faz
Sistema de QA que recebe tasks do Asana quando o status muda para "Pronto para Revisão" ou "Em QA", valida os campos obrigatórios, e apresenta uma interface com checklist + preview Wix para o QAer aprovar ou reprovar a task.

## Fase atual: Fase 1 — Time Externo (Wix)
A Fase 2 (time interno: Next/Nest) será adicionada depois.

---

## O que já foi feito

### Backend (backend/)
- Express rodando na porta 3001
- Prisma conectado ao Supabase
- Tabelas criadas: QATask, QACheck
- Rotas:
  - GET /tasks — lista todas as tasks
  - GET /tasks/:id — busca task por ID
  - POST /webhook — recebe eventos do Asana
- Serviço Asana (src/services/asana.js):
  - getTask(taskId) — busca task no Asana
  - addComment(taskId, text) — posta comentário
  - updateTaskStatus(taskId, customFieldId, enumOptionId) — muda status

### Frontend (frontend/)
- React + Vite configurado
- Tailwind CSS configurado
- Shadcn/ui inicializado
- Componentes instalados: button, card, badge, textarea
- Ainda sem páginas criadas (próximo passo)

---

## Próximos passos (em ordem)

### Passo 5 — Testar Webhook Asana (ATUAL)
- [ ] Instalar e configurar ngrok
- [ ] Expor backend na porta 3001 com ngrok
- [ ] Criar projeto de teste no Asana
- [ ] Registrar webhook no Asana apontando para URL do ngrok
- [ ] Mudar status de uma task e verificar se chega no backend

### Passo 6 — Frontend: Dashboard
- [ ] Criar página Dashboard (lista de tasks pendentes de QA)
- [ ] Conectar com GET /tasks do backend
- [ ] Exibir cards com título, assignee e status

### Passo 7 — Frontend: Tela de QA Review
- [ ] Checklist de funcionalidades
- [ ] Botão para abrir preview Wix (nova aba)
- [ ] Botão Aprovar
- [ ] Botão Reprovar com campo de comentário

### Passo 8 — Ações ao Aprovar/Reprovar
- [ ] Aprovar: fechar task no Asana
- [ ] Reprovar: comentar na task + mudar status para "Em Correção"

### Passo 9 — Validação automática de campos
- [ ] Quando webhook chegar sem campos obrigatórios, comentar automaticamente e devolver pro dev

---

## Variáveis de ambiente necessárias

### backend/.env
```
PORT=3001
DATABASE_URL="postgresql://postgres:SENHA@db.PROJETO.supabase.co:5432/postgres?schema=public"
ASANA_TOKEN="seu_token_pessoal_asana"
```

## Observações importantes
- O Supabase usa IPv6 por padrão — se der erro de conexão, trocar para Session Pooler
- O Prisma 7 tem breaking changes — projeto usa Prisma 5.22.0
- A Wix bloqueia iframe, então o preview abre em nova aba (window.open)
- Webhook Asana exige resposta em menos de 10 segundos (respondemos 200 antes de processar)
- Asana chama o webhook com x-hook-secret no primeiro request (handshake) — já tratado no código
