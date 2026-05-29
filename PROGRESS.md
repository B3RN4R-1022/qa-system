# QA System — Progresso do Projeto

Sistema de QA que integra com o Asana via webhooks. Quando uma task entra em "Em QA",
ela cai no sistema com checklist, preview e screenshots para o QA aprovar, reprovar ou
sugerir alteração — acionando os botões nativos de aprovação do Asana.

## Stack
- **Frontend:** React (Vite) + Tailwind CSS + Shadcn/ui + React Router + Recharts
- **Backend:** Node.js + Express
- **Banco:** PostgreSQL no Supabase + Prisma ORM (5.22.0 — NÃO usar v7, tem breaking changes)
- **Auth:** JWT (8h) + TOTP 2FA (Google Authenticator) via speakeasy/qrcode + bcrypt
- **Integração:** Asana REST API + Webhooks (via `fetch`, não SDK)
- **Deploy:** Vercel (frontend e backend como dois projetos separados do mesmo repo)
- **Repositório:** https://github.com/B3RN4R-1022/qa-system

---

## Fluxo principal

1. Task muda para **"Em QA"** no Asana → webhook dispara
2. Backend valida campos obrigatórios: **Prioridade, Complexidade, Tipo, Início** (+ Título e Descrição)
   - Se faltar algo → comenta no Asana (`⚠️ Devolvida pelo QA`), muda para **"QA Falhou"** e salva como `rejected`
3. Parser extrai os **Critérios de Aceitação** da descrição → vira checklist (QACheck)
4. Parser extrai links de **Link de Teste** e **Mockups/Designs** da descrição
5. Pega o campo **"Instâncias"** do Asana → vira `projectName`
6. Task aparece no Dashboard (auto-refresh a cada 30s)
7. QA abre a task, vê checklist + screenshots (anexos do Asana) + links + preview
8. QA toma uma ação:
   - **✓ Aprovar** (só com todos os checks marcados) → aciona `approval_status: approved` no Asana
   - **↺ Sugerir alteração** (comentário obrigatório) → `changes_requested` + comenta
   - **✗ Recusar** (mostra itens não checados + comentário opcional) → `rejected` + comenta
9. Cada ação salva um **QAEvent permanente** (para os gráficos) e um **QAComment** (histórico local)

> Status no Asana: só existe **"Em QA"** → vira **"Feito"** (aprovado) ou **"QA Falhou"** (recusado/sugerido).
> NÃO existe "Pronto para Revisão" nem "Em Correção".

---

## Modelos do banco (prisma/schema.prisma)

- **QATask** — task em QA. Campos: asanaId, title, description, previewUrl, assignee,
  status (`in_qa`/`approved`/`rejected`/`suggested`/`pending`), projectName,
  wasRejectedBefore, wasSuggestedBefore, createdAt, updatedAt
- **QACheck** — item do checklist (label, checked) ligado à QATask
- **QAComment** — histórico de comentários local (type, text, createdAt) ligado à QATask
- **QAEvent** — registro PERMANENTE de cada ação para os gráficos.
  Campos: asanaId, action, projectName, assignee, wasFirstApproval, createdAt.
  Não é deletado quando a task some — por isso os stats sobrevivem.
- **User** — name, email, password (bcrypt), totpSecret

---

## Rotas do backend

### Públicas
- `POST /auth/register` — exige `registerSecret`, gera TOTP secret + QR code
- `POST /auth/login` — passo 1: valida credenciais, retorna tempToken (5min)
- `POST /auth/verify-totp` — passo 2: valida código TOTP, retorna JWT (8h)
- `POST /webhook` — recebe eventos do Asana (handshake x-hook-secret + eventos)

### Protegidas (authMiddleware)
- `GET /tasks` — lista tasks (ordenado por createdAt desc, inclui checks)
- `GET /tasks/:id` — busca task com checks
- `GET /tasks/:id/comments` — histórico de comentários local
- `GET /tasks/:id/attachments` — screenshots (anexos do Asana)
- `POST /tasks/:id/approve` — aprova (checks + comentário opcional)
- `POST /tasks/:id/reject` — recusa (checks não feitos + comentário)
- `POST /tasks/:id/suggest` — sugere alteração (comentário obrigatório)
- `POST /tasks/:id/move-to-qa` — marca status in_qa local
- `GET /stats?period=7d|30d|6m` — dados dos gráficos (general, byProject, byDev)
- `POST /admin/setup-webhooks` — registra webhook em TODOS os projetos do workspace
- `GET /admin/webhooks` — lista webhooks ativos
- `DELETE /admin/clear-test-data` — apaga tasks, checks, comentários e eventos

### Serviços (src/services/)
- **asana.js:** getTask, addComment, getPreviewUrl, updateStatusByName,
  updateApprovalStatus, getAttachments, getMyWorkspaceGid, listAllProjects,
  registerWebhook, listWebhooks
- **parser.js:** extrairRequisitos (Critérios de Aceitação), extrairLinkDaSecao
  (Link de Teste / Mockups/Designs)

---

## Frontend (frontend/src/)

### Páginas
- **Login.jsx** — 2 passos: credenciais → código TOTP
- **Register.jsx** — formulário com registerSecret → exibe QR code
- **Dashboard.jsx** (`/`) — lista de tasks. Filtros: status (botões), dev e projeto
  (selects sempre visíveis). Tags "Já reprovada" / "Teve sugestão" persistentes.
  Auto-refresh 30s + botão "atualizar agora". Cards com avatar, projeto, checks, data.
- **DashboardStats.jsx** (`/dashboard`) — analytics com gráficos de pizza (Recharts):
  - Visão Geral: pizza + 4 cards de % (aprovado direto, após retorno, reprovado, sugerido)
  - Por Projeto: grid de pizzas
  - Por Dev: select + pizza individual
  - Filtro de período: 7 dias / 30 dias / 6 meses
- **Settings.jsx** (`/settings`) — registrar webhooks em todos os projetos + limpar dados
- **QAReview.jsx** (`/review/:id`) — checklist, info, screenshots (carousel + lightbox
  com teclado), links de teste/mockup, ícone de chat com histórico de comentários,
  3 botões de ação (✗ ↺ ✓)

### Componentes
- **Sidebar.jsx** — menu fixo à direita: Tasks, Dashboard, Config (ativos); Conta, Chat (em breve)
- **ProtectedRoute.jsx** — guarda rotas autenticadas
- **AuthContext.jsx** — token em localStorage (`qa_token`, `qa_user`)
- **lib/api.js** — `API` = `VITE_API_URL` ou `http://localhost:3001`

---

## Deploy (Vercel)

Dois projetos no Vercel, mesmo repositório:
- **Backend:** Root Directory = `backend`. Usa `api/index.js` que importa o Express de
  `src/index.js`. `vercel.json` faz rewrite de `/(.*)` → `/api/index`.
- **Frontend:** Root Directory = `frontend`. `vercel.json` faz rewrite SPA → `/index.html`.

### Variáveis de ambiente

**Backend (Vercel):**
```
JWT_SECRET
REGISTER_SECRET
DATABASE_URL   (Transaction Pooler do Supabase, ver abaixo)
ASANA_TOKEN
```

**Frontend (Vercel):**
```
VITE_API_URL = https://SEU-BACKEND.vercel.app   (SEM barra no final)
```

### DATABASE_URL para serverless (IMPORTANTE)
O Vercel é serverless → precisa do **Transaction Pooler** do Supabase (porta 6543),
com usuário no formato `postgres.PROJETO`:
```
postgresql://postgres.hzvkjfieogbxdgdimnnr:SENHA@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```
- `pgbouncer=true` resolve o erro `prepared statement "s0" already exists`
- usuário `postgres.PROJETO` (não só `postgres`) resolve `Authentication failed`

---

## Armadilhas conhecidas e soluções

- **Prisma no Vercel:** mover `@prisma/client` e `prisma` para `dependencies`,
  adicionar `postinstall: prisma generate` e `binaryTargets = ["native", "rhel-openssl-1.0.x", "rhel-openssl-3.0.x"]` no schema
- **`Cannot find module 'express'` no Vercel:** todas as deps precisam estar em
  `dependencies` (não devDependencies), e usar a pasta `api/`
- **Cron de limpeza** (tasks com +14 dias) só roda localmente (`require.main === module`),
  não no serverless — por isso os QAEvents são permanentes
- **Webhook do Asana:** exige URL `https://` (usar ngrok local ou URL Vercel),
  responde x-hook-secret no handshake, responde 200 antes de processar
- **SDK do Asana** dá erro `hasOwnProperty` → usar `fetch` direto
- **approval_status nativo:** só funciona em tasks do tipo "Approval Task" no Asana
  (converter via "Convert to approval")
- **Webhooks são entrada (Asana→sistema), GET/POST são saída (sistema→Asana)** —
  não dá para substituir um pelo outro, e GET/POST não interferem em outros usuários
- **OneDrive** pode travar `prisma generate` com EPERM — ignorar, não afeta a migration
- **Stats:** sempre incluir `asanaId` no select e agrupar por task, senão eventos
  colapsam e contam errado

---

## Próximos passos / Ideias futuras
- [ ] Finalizar deploy estável no Vercel (DATABASE_URL pooler)
- [ ] Conectar ao workspace real da empresa
- [ ] Página de Conta e Chat (hoje desativadas na sidebar)
- [ ] Fase 2 — time interno (Next/Nest)
