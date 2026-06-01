# QA System — Progresso do Projeto

Sistema de QA que integra com o Asana via webhooks. Quando uma task entra em "Em QA",
ela cai no sistema com checklist, preview e screenshots para o QA aprovar, reprovar ou
sugerir alteração — acionando os botões nativos de aprovação do Asana.

## Stack
- **Frontend:** React 19 (Vite) + Tailwind CSS v4 + Shadcn/ui + React Router + Recharts
- **Backend:** Node.js + Express 5
- **Banco:** PostgreSQL no Supabase + Prisma ORM (5.22.0 — NÃO usar v7, tem breaking changes)
- **Auth:** JWT (30d) + TOTP 2FA (Google Authenticator) via speakeasy/qrcode + bcrypt + cookie-parser
- **Integração:** Asana REST API + Webhooks (via `fetch` nativo, NÃO SDK — tem hasOwnProperty errors)
- **Deploy:** Vercel (frontend e backend como dois projetos separados do mesmo repo)
- **Repositório:** https://github.com/B3RN4R-1022/qa-system

---

## Fluxo principal

1. Task muda para **"Em QA"** no Asana → webhook dispara
2. Backend valida campos obrigatórios: **Prioridade, Complexidade, Tipo, Início** (+ Título e Descrição)
   - Se faltar algo → comenta no Asana (`⚠️ Devolvida pelo QA`), muda para **"QA Falhou"** e salva como `rejected`
3. Parser extrai os **Critérios de Aceitação** da descrição → vira checklist (QACheck)
4. Parser extrai links de **Link de Teste** e **Mockups/Designs** da descrição (sem GET extra)
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
- **QAComment** — histórico de comentários local (type `rejected`|`suggested`, text, createdAt) ligado à QATask
- **QAEvent** — registro PERMANENTE de cada ação para os gráficos.
  Campos: asanaId, action (`approved`|`rejected`|`suggested`), projectName, assignee, wasFirstApproval, createdAt.
  Não é deletado quando a task some — por isso os stats sobrevivem às 2 semanas de limpeza.
- **User** — name, email, password (bcrypt), totpSecret

---

## Rotas do backend

### Públicas
- `POST /auth/register` — exige `registerSecret`, gera TOTP secret + QR code
- `POST /auth/login` — valida credenciais; se cookie `trusted_device` válido, retorna JWT direto (pula TOTP)
- `POST /auth/verify-totp` — valida código TOTP, retorna JWT 30d + seta cookie `trusted_device` (httpOnly, 30d)
- `POST /webhook` — recebe eventos do Asana (handshake x-hook-secret + eventos)

### Protegidas (authMiddleware Bearer JWT)
- `GET /tasks` — lista tasks (ordenado por createdAt desc, inclui checks + returnCount)
- `GET /tasks/:id` — busca task com checks + mockupUrl + testUrl (extraídos da descrição)
- `GET /tasks/:id/comments` — histórico de comentários local
- `GET /tasks/:id/attachments` — screenshots (anexos do Asana via API)
- `POST /tasks/:id/approve` — aprova; cria QAEvent(approved, wasFirstApproval)
- `POST /tasks/:id/reject` — recusa; cria QAEvent(rejected) + QAComment(rejected)
- `POST /tasks/:id/suggest` — sugere alteração; cria QAEvent(suggested) + QAComment(suggested)
- `GET /stats?period=7d|30d|6m` — dados dos gráficos (general, byProject, byDev)
- `POST /admin/setup-webhooks` — re-registra webhooks em todos os projetos (deleta inativos/URL errada antes)
- `GET /admin/webhooks` — lista webhooks ativos
- `DELETE /admin/clear-test-data` — apaga tasks, checks, comentários e eventos

### Serviços (src/services/)
- **asana.js:** getTask, addComment, updateStatusByName(taskId, statusName, taskData?),
  updateApprovalStatus, getAttachments, getMyWorkspaceGid, listAllProjects,
  registerWebhook, listWebhooks
  > `updateStatusByName` aceita taskData opcional para evitar GET duplicado
- **parser.js:** extrairRequisitos, extrairTestUrl (Link de Teste), extrairMockupUrl (Mockups/Designs)

---

## Otimização de GETs no webhook

Por evento de webhook processado:
- **Antes:** 2 GETs (caminho feliz) / 3 GETs (caminho de erro)
- **Depois:** 1 GET em ambos os caminhos

Mudanças:
- `updateStatusByName` reutiliza a task já buscada (evita GET duplicado)
- `previewUrl` extraído de `task.notes` via parser (elimina GET de stories)
- Logging de eventos adicionado para diagnóstico

---

## Lógica de Stats (stats.js)

```js
function calcStats(events) {
  // Agrupa todos os eventos por task
  const byTask = {}
  for (const e of events) {
    if (!byTask[e.asanaId]) byTask[e.asanaId] = []
    byTask[e.asanaId].push(e)
  }
  // approved_clean / approved_after: mutuamente exclusivos
  // rejected / suggested: independentes do estado final
  // (uma task pode contar em approved_after E rejected ao mesmo tempo)
}
```

Retorna também: `total_tasks` (tasks únicas) e `total_actions` (soma das categorias, pode > total_tasks).

---

## Frontend (frontend/src/)

### Layout geral
- **App.jsx** — `Layout` wrapper: `ml-[72px]` no conteúdo (compensa sidebar esquerda).
  Rotas: `/login`, `/register` públicas; `/`, `/dashboard`, `/settings`, `/review/:id` protegidas.
- **Sidebar.jsx** — menu fixo à **esquerda** (72px): Tasks, Dashboard, Config, Conta (em breve),
  Chat (em breve), botão Sair, botão tema (lua/sol animado). Ícone Nocorp no topo.
- **ThemeContext.jsx** — dark mode via classe `.dark` no `<html>`. Persiste em localStorage.
  `COLORS_DARK` (neon) / `COLORS_LIGHT` (saturado) nos gráficos.
- **NocorpLogo.jsx** — `NocorpLogo` (ícone + texto SVG vetorial real) e `NocorpIcon` (só ícone).
  Logo aparece no header de cada página (direita), clicável → `/`.

### Páginas
- **Login.jsx** — Logo Nocorp acima do card. 2 passos: credenciais → TOTP.
  Se cookie `trusted_device` presente, backend pula TOTP e retorna token direto.
  Todas as chamadas auth usam `credentials: 'include'` para suportar cookies cross-origin.
- **Register.jsx** — formulário com registerSecret → exibe QR code
- **Dashboard.jsx** (`/`) — lista de tasks. Header com título + "atualizado às" + logo.
  Filtros: status (botões), dev e projeto (selects). Tags "Já reprovada" / "Teve sugestão".
  Badge `↩ Nx` mostra quantas vezes a task voltou (contagem de QAComments rejected+suggested).
  Auto-refresh 30s.
- **DashboardStats.jsx** (`/dashboard`) — analytics. Header grid-cols-3: título | filtros centralizados | logo.
  - Cores: `COLORS_DARK` (neon) no modo escuro, `COLORS_LIGHT` (saturado) no claro
  - Cards clicáveis com animação expand/collapse: 900ms abrir (suave), 460ms fechar
  - Visão Geral: pizza expansível + 4 cards de % com barra de progresso
  - Por Projeto: flex com expand (card foca, outros viram mini-cards compactos)
  - Por Dev: select + pizza expansível
- **Settings.jsx** (`/settings`) — registrar webhooks + limpar dados de teste
- **QAReview.jsx** (`/review/:id`) — checklist, info, screenshots (carousel + lightbox),
  links de teste/mockup, ícone de chat com histórico de comentários, 3 botões de ação (✗ ↺ ✓)

---

## Autenticação e Sessão

- **JWT 30 dias** — não expira mais em 8h
- **Cookie `trusted_device`** (httpOnly, SameSite=None em prod / Lax em dev, 30 dias):
  - Setado após TOTP bem-sucedido em `/auth/verify-totp`
  - Verificado em `/auth/login`: se válido, pula TOTP e retorna JWT direto
  - Renovado a cada login com dispositivo confiável
- **CORS:** `{ origin: true, credentials: true }` — necessário para cookies cross-origin (Vercel)
- **cookie-parser** adicionado ao middleware do Express

---

## Deploy (Vercel)

Dois projetos no Vercel, mesmo repositório (branch `master`):
- **Backend:** Root Directory = `backend`. Usa `api/index.js` → `src/index.js`.
  `vercel.json` faz rewrite `/(.*) → /api/index`.
- **Frontend:** Root Directory = `frontend`. Vite build estático.
  `vercel.json` faz rewrite SPA → `/index.html`.

> **Atenção:** usar sempre a URL de **produção** do Vercel (ex: `qa-system-backend.vercel.app`),
> não a URL de preview com hash (ex: `qa-system-abc123-...vercel.app`).
> URLs de preview têm Deployment Protection ativa por padrão (retorna 401).

### Variáveis de ambiente

**Backend (Vercel):**
```
JWT_SECRET
REGISTER_SECRET
DATABASE_URL   (Transaction Pooler do Supabase, ver abaixo)
ASANA_TOKEN
NODE_ENV=production   (ativa cookies Secure + SameSite=None)
```

**Frontend (Vercel):**
```
VITE_API_URL = https://SEU-BACKEND.vercel.app   (SEM barra no final)
```

### DATABASE_URL para serverless (CRÍTICO)
```
postgresql://postgres.hzvkjfieogbxdgdimnnr:SENHA@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```
- Porta **6543** = Transaction Pooler (não Session Pooler)
- `pgbouncer=true` resolve `prepared statement "s0" already exists`
- Usuário `postgres.PROJETO` (não só `postgres`) resolve `Authentication failed`

---

## Registro de Webhooks

`POST /admin/setup-webhooks` com `{ webhookUrl }`:
1. Lista webhooks existentes no workspace
2. Para cada projeto: se webhook existe com URL diferente ou inativo → **deleta** antes
3. Registra novo webhook com a URL fornecida
4. Retorna lista de projetos com status (registrado ✓ / já registrado ✓ / erro)

> Usar sempre a URL do backend Vercel: `https://backend.vercel.app/webhook`
> Para desenvolvimento local: iniciar ngrok (`ngrok http 3001`) e re-registrar com nova URL.

---

## Armadilhas conhecidas e soluções

- **Prisma no Vercel:** deps em `dependencies`, `postinstall: prisma generate`,
  `binaryTargets = ["native", "rhel-openssl-1.0.x", "rhel-openssl-3.0.x"]` no schema
- **SDK do Asana** dá `hasOwnProperty` errors → sempre usar `fetch` direto
- **approval_status nativo:** só funciona em **Approval Tasks** (converter via "Convert to approval" no Asana)
- **Cron de limpeza** (tasks +14 dias) só roda local — serverless não mantém processos
- **Webhook do Asana:** exige `https://`, responde x-hook-secret no handshake, responde 200 antes de processar
- **Stats:** sempre incluir `asanaId` no select do Prisma — sem ele todos os eventos colapsam em `byTask[undefined]`
- **CORS com cookies:** precisa de `credentials: true` no CORS do Express E `credentials: 'include'` nos fetches do frontend
- **OneDrive + Prisma:** pode dar EPERM no `prisma generate` — ignorar, não afeta migrations
- **URL de preview vs produção no Vercel:** preview URLs têm proteção ativa (401) — usar sempre a produção

---

## Próximos passos / Ideias futuras
- [ ] Conectar ao workspace real da empresa (registrar webhooks em produção)
- [ ] Página de Conta (perfil do usuário)
- [ ] Chat interno (em breve na sidebar)
- [ ] Fase 2 — time interno com Next.js + NestJS
