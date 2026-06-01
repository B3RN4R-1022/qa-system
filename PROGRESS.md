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
- **IA Chat:** Groq (`llama-3.3-70b-versatile`) via REST API — 6.000 req/dia grátis
- **IA QA Agent:** microserviço Python (FastAPI) + browser-use 0.12.9 + Playwright (Chromium) + Groq
- **Deploy:** Vercel (frontend e backend como dois projetos separados do mesmo repo)
- **Repositório:** https://github.com/B3RN4R-1022/qa-system

> **Três processos rodam em paralelo no dev local:**
> 1. Backend Node.js (`cd backend && npm run dev`) → porta 3001
> 2. Frontend Vite (`cd frontend && npm run dev`) → porta 5173
> 3. Agente Python (`cd qa-agent && .\venv\Scripts\python.exe main.py`) → porta 8000

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
- **ChatMessage** — histórico do chat de treinamento da IA. Campos: role (`user`|`assistant`), content, createdAt
- **AIKnowledge** — base de conhecimento da IA. Campos: type (`skill`|`project`), name, content, updatedAt.
  Unique em `[type, name]`. Skills = instruções gerais; projects = contexto por projeto.
- **AIReport** — relatório do agente de QA por task. Campos: taskId (unique), sessionId,
  status (`pending`|`running`|`done`|`error`), report, updatedAt

> **DIRECT_URL (CRÍTICO para migrations):** Supabase Transaction Pooler (6543) trava no `migrate dev`.
> Adicionar `directUrl = env("DIRECT_URL")` no datasource apontando para Session Pooler (porta **5432**).
> `DATABASE_URL` (6543) = runtime; `DIRECT_URL` (5432) = migrations. Alternativa rápida: `npx prisma db push`.

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
- `GET /chat/history` — histórico do chat de treinamento
- `POST /chat/message` — envia mensagem; injeta skills + base de conhecimento no system prompt do Groq
- `DELETE /chat/history` — limpa histórico do chat
- `GET /knowledge` — lista skills e projetos da base de conhecimento
- `POST /knowledge` — cria skill ou projeto (`{type, name, content}`)
- `PUT /knowledge/:id` — atualiza conteúdo
- `DELETE /knowledge/:id` — remove item
- `GET /tasks/:id/ai-report` — retorna o relatório atual do agente de QA
- `POST /tasks/:id/run-ai-qa` — dispara o agente em background (aceita `previewUrl` override no body)

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
- **Sidebar.jsx** — menu fixo à **esquerda** (72px): Tasks, Dashboard, Config, **Chat** (ativo),
  Conta (em breve), botão Sair, botão tema (lua/sol animado). Ícone Nocorp no topo.
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

## Chat de Treinamento da IA (frontend/src/pages/Chat.jsx)

- Página `/chat` (ativada na sidebar). Conversa com Groq para treinar padrões de QA da Nocorp.
- Backend (`routes/chat.js`) monta o system prompt dinamicamente:
  `SYSTEM_PROMPT` base + skills (`type:skill`) + projetos (`type:project`) da AIKnowledge.
- Histórico persiste no banco (ChatMessage) → contexto entre sessões.
- UI: bolhas user/assistant, markdown básico (negrito, listas), starter prompts, indicador de digitação.

## Base de Conhecimento (frontend/src/pages/Settings.jsx)

Duas seções novas em Configurações:
- **🧠 Skills da IA** — instruções gerais de comportamento (ex: "sempre testar mobile"). `type:skill`.
- **📚 Base de Conhecimento** — contexto por projeto (descrição + padrões de QA). `type:project`.
  Accordion expansível, badge "sem conteúdo"/"preenchido", CRUD completo.
- Tudo é injetado automaticamente no Chat E no Agente de QA — sem reiniciar nada.

## Agente de QA Automatizado (pasta qa-agent/)

Microserviço Python separado que abre o Chromium e testa o sistema sozinho.

**Arquitetura:**
```
QAReview → POST /tasks/:id/run-ai-qa (Node)
   → services/browserUse.js chama POST http://127.0.0.1:8000/run-qa (Python)
   → agent.py: browser-use abre Chromium, navega, testa
   → Node faz polling de GET /result/:taskId até status done/error
   → salva AIReport → QAReview exibe (polling 4s no frontend)
```

**Arquivos qa-agent/:**
- `main.py` — FastAPI. Rotas: `/` (health), `POST /run-qa` (dispara em background), `GET /result/:id`.
  Guarda resultados em `results_store` (dict em memória).
- `agent.py` — lógica do browser-use. Contém:
  - `build_task(...)` — monta o prompt com descrição + critérios + skills + knowledge.
    Inclui passo a passo FORÇADO (login → cadastro) para evitar loop de navegação.
  - `convert_messages(...)` — **CRÍTICO:** converte tipos `browser_use.llm.messages`
    (SystemMessage/UserMessage/AssistantMessage) → LangChain (SystemMessage/HumanMessage/AIMessage).
  - `BrowserUseLLM` — wrapper que torna qualquer LLM LangChain compatível com browser-use 0.12+.
    Intercepta `ainvoke(messages, output_format=...)`, usa `with_structured_output`,
    retorna `_CompletionWrapper` com `.completion`. Expõe `.provider`, `.model`, `.model_name`.
  - `available_file_paths` — coleta imagens de ~/Pictures, ~/Desktop e cria `dummy.png` (1x1)
    para uploads em formulários.
  - **Config do Agent (browser-use 0.12.9):**
    - `use_vision=False` — Groq llama-3.3-70b não tem visão; navega pelo DOM
    - `flash_mode=True` — schema reduzido (só `memory`+`action`); essencial para Groq cumprir o tool call
    - `use_thinking=False` — remove campo `thinking` do schema
    - `initial_actions=[{'navigate': {'url': preview_url}}]` — abre a URL UMA vez antes do loop
    - prompt PROÍBE a ação `navigate` no resto (senão entra em loop re-navegando)
    - `max_actions_per_step=3`
- `start.bat` — atalho para rodar o agente.
- `venv/` — ambiente virtual Python 3.13 (NÃO commitar).
- `.env` — `GROQ_API_KEY`, `GEMINI_API_KEY` (fallback), `PORT=8000`.

**Frontend (QAReview.jsx):** card "🤖 Análise Automática de IA".
- Botão "▶ Executar análise" aparece se task tem `previewUrl` OU `testUrl`.
- Envia `previewUrl: task.previewUrl || task.testUrl` no body.
- Polling de 4s enquanto status === 'running'. Mostra relatório quando 'done'.
- **SEM timeout no polling do Node** — roda até o agente terminar (user interrompe se precisar).

**browserUse.js (Node):**
- `QA_AGENT_URL = http://127.0.0.1:8000` (NÃO localhost — IPv6 quebra).
- Faz **health check** (GET `/`) antes de disparar; se falhar, salva erro "Serviço não está rodando".
- O texto de erro exibido no card pode ser ESTADO ANTIGO do banco — só some ao clicar "Executar análise" de novo.

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
- **browser-use 0.12+ NÃO usa LangChain direto:** tem tipos de mensagem próprios e chama
  `llm.ainvoke(msgs, output_format=X)` esperando `.completion`. Solução: wrapper `BrowserUseLLM`
  + `convert_messages` (ver pasta qa-agent). NÃO basta subclasse com `provider` — precisa converter mensagens.
- **Gemini free tier = 20 req/dia** (`gemini-2.5-flash`) → INVIÁVEL para QA. Usar Groq (6.000/dia).
  Modelos Gemini 1.5 foram REMOVIDOS (404); 2.0 dá `limit:0` em contas novas; só 2.5 funciona mas com cota baixa.
- **Chave Gemini:** criar SÓ em aistudio.google.com (não Google Cloud Console, que dá `limit:0`).
- **greenlet/playwright DLL error no Python 3.13:** resolver com `venv` isolado (instalar fora do venv falha).
- **localhost vs 127.0.0.1:** Node às vezes resolve localhost como IPv6 (`::1`) e não acha o Python.
  Usar `http://127.0.0.1:8000` explícito no `QA_AGENT_URL`.
- **Groq vision models** (`llama-3.2-*-vision`) NÃO suportam structured output do browser-use → loop de falhas.
  Usar `llama-3.3-70b-versatile` com `use_vision=False` (navega pelo DOM).
- **Agente em loop navegando para a mesma URL:** a ação `navigate` "termina a sequência" e o agente
  re-navega sem agir. Solução: PROIBIR `navigate` no prompt + abrir a URL via `initial_actions` (1x antes do loop).
- **Groq omite campos obrigatórios no tool call** (`missing properties: evaluation_previous_goal, memory, next_goal`):
  o modelo gera a ação certa mas esquece os campos de raciocínio. Solução: `flash_mode=True` + `use_thinking=False`
  reduz o schema para só `memory`+`action`.
- **Chromium abria em about:blank:** ao remover `directly_open_url` E proibir `navigate`, nada abria a URL.
  Resolver com `initial_actions=[{'navigate': {'url': preview_url}}]`.
- **Campo webhookUrl voltava para localhost:** salvar em `localStorage('qa_webhook_url')` no Settings.
- **URL de preview vs produção no Vercel:** preview URLs têm proteção ativa (401) — usar sempre a produção

---

## Próximos passos / Ideias futuras
- [ ] Conectar ao workspace real da empresa (registrar webhooks em produção)
- [ ] Página de Conta (perfil do usuário)
- [x] Chat de treinamento da IA (Groq) — FEITO
- [x] Base de conhecimento (skills + projetos) — FEITO
- [x] Agente de QA automatizado (browser-use + Python) — FUNCIONANDO (logou e completou 3 etapas no eTrainer)
- [ ] Preencher base de conhecimento com os projetos reais (deskone.com.br/helpcenter)
- [ ] Deploy do qa-agent (atualmente só roda local — serverless não suporta browser headful)
- [ ] Vision no agente (modelo de visão com cota alta) para sites complexos
- [ ] Fase 2 — time interno com Next.js + NestJS

## Status atual do Agente de QA (IMPORTANTE)

⚙️ **Config atual:** Groq `llama-3.3-70b-versatile`, `use_vision=False`, `flash_mode=True`,
   `use_thinking=False`, `initial_actions` para abrir URL, prompt proíbe `navigate`. 6.000 req/dia.
✅ **Conexão Node↔Python funciona** (health check passa, card vai para "analisando...").
✅ **Chromium abre** e o agente tenta as ações certas (ex: digitar email no login).
🐞 **Em ajuste:** fazer o agente passar do login de forma consistente. Sequência de fixes aplicada:
   1. flash_mode (resolver "missing properties" do Groq)
   2. initial_actions (resolver Chromium em about:blank)
   3. proibir navigate no prompt (resolver loop)
   → Próximo teste: reiniciar Python + executar e ver se preenche login → cadastro até o fim.
   Se `navigate` em initial_actions der erro de nome, tentar `go_to_url`.

**Comando para rodar o agente:** `cd qa-agent && .\venv\Scripts\python.exe main.py` (ou `start.bat`).
