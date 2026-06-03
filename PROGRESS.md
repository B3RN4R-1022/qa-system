# QA System — Progresso do Projeto

Sistema de QA que integra com o Asana via webhooks. Quando uma task entra em "Em QA",
ela cai no sistema com checklist, preview e screenshots para o QA aprovar, reprovar ou
sugerir alteração — acionando os botões nativos de aprovação do Asana.

---

## Stack

- **Frontend:** React 19 (Vite) + Tailwind CSS v4 + Shadcn/ui + React Router + Recharts
- **Backend:** Node.js + Express 5 (hospedado no **Render**)
- **Banco:** PostgreSQL no Supabase + Prisma ORM 5.22.0 (NÃO usar v7, tem breaking changes)
- **Auth:** JWT (30d) + TOTP 2FA (Google Authenticator) via speakeasy/qrcode + bcrypt + cookie-parser
- **Integração:** Asana REST API + Webhooks (via `fetch` nativo, NÃO SDK — tem `hasOwnProperty` errors)
- **IA Chat:** **Cerebras** (`gpt-oss-120b`, fallback `zai-glm-4.7`) via REST API — 1M tokens/dia. Lê a key do banco (mesma do QA Agent). **Migrado do Groq.**
- **IA QA Agent:** Python local + browser-use 0.12.9 + Playwright (Chromium) + Cerebras (primário)
- **Deploy:** Render (backend) + Vercel (frontend)
- **Repositório:** https://github.com/B3RN4R-1022/qa-system (público — necessário para o installer)

### Processos em dev local
```
1. Backend Node.js  → cd backend && npm run dev   → porta 3001
2. Frontend Vite    → cd frontend && npm run dev  → porta 5173
3. QA Agent worker  → C:\Users\<user>\NocorpQAAgent\start.bat
```

---

## Deploy

### Backend → Render (Web Service)
- **Root Directory:** `backend`
- **Build Command:** `npm install` (postinstall já faz `prisma generate`)
- **Start Command:** `npm start`
- **URL:** `https://qa-system-5vpf.onrender.com`
- **⚠️ Plano Free:** dorme após 15 min → primeira requisição do dia demora ~30-50s
- Variáveis de ambiente no painel do Render (sem aspas):
  ```
  DATABASE_URL, DIRECT_URL, JWT_SECRET, REGISTER_SECRET, ASANA_TOKEN
  ```
  > `GROQ_API_KEY` não é mais usada (chat migrado para Cerebras, que lê a key do banco). Pode remover do Render.

### Frontend → Vercel (Static Site)
- **Root Directory:** `frontend`
- Variável de ambiente:
  ```
  VITE_API_URL = https://qa-system-5vpf.onrender.com   (SEM barra no final)
  ```

---

## Roles de Usuário

| Role | Acesso |
|------|--------|
| `qa` | Tudo: tasks (clicáveis), dashboard completo, settings completo, chat |
| `dev` | Tasks próprias (somente leitura), dashboard filtrado, settings só IA, chat + /teste-qa, testes |
| `admin` | Igual QA (reservado para futuro) |

- Role definida no cadastro (`/register`) → botão "QA Analyst" ou "Desenvolvedor"
- Incluída no JWT payload → `useAuth()` expõe `isDev`, `isQA`, `isAdmin`

---

## Fluxo principal

1. Task muda para **"Em QA"** no Asana → webhook dispara para Render
2. Backend valida campos obrigatórios: **Prioridade, Complexidade, Tipo, Início** (+ Título e Descrição)
   - Se faltar algo → comenta no Asana (`⚠️ Devolvida pelo QA`), muda para **"QA Falhou"** e salva como `rejected`
3. Parser extrai os **Critérios de Aceitação** da descrição → vira checklist (QACheck)
4. Parser extrai links de **Link de Teste** e **Mockups/Designs** da descrição
5. Pega o campo **"Instâncias"** do Asana → vira `projectName`
6. Task aparece no Dashboard (auto-refresh a cada 30s)
7. QA abre a task, vê checklist + screenshots + links + preview
8. QA toma uma ação:
   - **✓ Aprovar** (só com todos os checks marcados)
   - **↺ Sugerir alteração** (comentário obrigatório)
   - **✗ Recusar** (comentário opcional)
9. Cada ação salva um **QAEvent permanente** (gráficos) e um **QAComment** (histórico local)

---

## Modelos do banco (prisma/schema.prisma)

- **QATask** — task em QA. Campos: asanaId, title, description, previewUrl, assignee, status, projectName, wasRejectedBefore, wasSuggestedBefore
- **QACheck** — item do checklist (label, checked) ligado à QATask
- **QAComment** — histórico de comentários local (type, text) ligado à QATask
- **QAEvent** — registro PERMANENTE de cada ação para gráficos (asanaId, action, projectName, assignee, wasFirstApproval). NÃO deletado nas limpezas automáticas.
- **User** — name, email, password (bcrypt), **role** (`qa`|`dev`|`admin`), totpSecret
- **ChatMessage** — histórico do chat por usuário (**userId** isolado por conta), role, content
- **AIKnowledge** — base de conhecimento + configs do sistema. Campo `type` agora tem vários usos:
  - `skill` / `project` — base de conhecimento da IA (chat + agente)
  - `config` / `cerebras_api_key` — key da IA
  - `site_cache` / `<projeto>` — **cache de UI:** o que o agente aprendeu navegando no site (JSON: navigation/loginFlow/knownRoutes/uiPatterns/notes)
  - `project_repo` / `<projeto>` — **config do projeto** (JSON): `repoPath`, `lastCommit`, `analyzedAt`, `fileCount`, `projectType` (`wix_velo`|`wix_headless`|`repo`), `crawlHeadless`, `pendingRemap`
  - `wix_sitemap` / `<projeto>` — **mapa do site Wix Velo** (JSON: baseUrl, pageCount, pages{})
- **AIReport** — relatório do agente por task. Campos: taskId (unique), status (`queued`|`running`|`done`|`error`), report, **tokensUsed** (Int?). ⚠️ **Falta `userId`** (ver backlog: fila por usuário)
- **DevTest** — teste manual iniciado por dev via `/teste-qa` no chat. Campos: userId, title, description, previewUrl, projectName, criteria (JSON), status, report, tokensUsed

> **DIRECT_URL (CRÍTICO para migrations):** `DATABASE_URL` porta 6543 (Transaction Pooler).
> `DIRECT_URL` porta 5432 (Session Pooler, migrations). Usar `npx prisma db push`.

---

## Rotas do backend

### Públicas
- `POST /auth/register` — exige `registerSecret` + `role` opcional (`qa`|`dev`)
- `POST /auth/login` — valida credenciais; cookie `trusted_device` pula TOTP; JWT inclui `role`
- `POST /auth/verify-totp` — valida TOTP, retorna JWT + cookie; JWT inclui `role`
- `POST /webhook` — recebe eventos do Asana

### Protegidas (Bearer JWT)
- `GET /tasks` — lista tasks
- `GET|POST|PUT|DELETE /knowledge` — base de conhecimento
- `GET /stats?period=7d|30d|6m` — analytics
- `POST /admin/setup-webhooks` — re-registra webhooks
- `DELETE /admin/clear-test-data` — apaga dados de teste
- `GET|POST|DELETE /chat/history`, `POST /chat/message` — chat **isolado por userId**, agora via **Cerebras** (key do banco)
- `GET|POST|DELETE /tasks/:id/ai-report` — relatório IA (DELETE limpa stuck)
- `POST /tasks/:id/run-ai-qa` — enfileira análise (`status='queued'`)
- `GET|POST|DELETE /settings/ai` — config IA (key mascarada + tokens hoje)
- `GET /qa-jobs/pending` — **Pull model:** worker busca próximo job (AIReport OU DevTest). Retorna também: `site_cache`, `project_type`, `has_sitemap`, `pending_remap`, `crawl_headless`
- `POST /qa-jobs/:id/claim` — worker reivindica job; body: `{ type: 'qa_task'|'dev_test' }`
- `POST /qa-jobs/:id/result` — worker posta resultado; body: `{ status, report, tokensUsed, type, siteCache?, projectName? }` (siteCache salva o cache de UI)
- `GET /dev-tests` — lista DevTests (dev=só seus, QA=todos)
- `POST /dev-tests` — cria e enfileira DevTest; aceita `projectType` + `requestRemap` (salvos no `project_repo`)
- `GET /dev-tests/:id` — status/resultado de um DevTest
- `DELETE /dev-tests/:id` — cancela/remove DevTest
- `GET /projects` — lista projetos com stats: testCount, hasCache, hasRepo (repoPath/fileCount/analyzedAt), projectType, hasSitemap/sitemapPageCount
- `GET|PUT|DELETE /projects/:name/repo` — config do repo/tipo (JSON em `project_repo`). PUT faz merge
- `GET|PUT|DELETE /projects/:name/sitemap` — mapa do site Wix Velo (`wix_sitemap`)
- `GET|DELETE /projects/:name/cache` — cache de UI do agente (`site_cache`)

---

## Agente de QA Automatizado — Pull Model (pasta qa-agent/)

### Arquitetura (Pull Model — sem ngrok)

```
Usuário clica "Executar análise" (QAReview) OU submete /teste-qa (Chat)
    ↓
Backend salva AIReport{status:'queued'} ou DevTest{status:'queued'}
    ↓
worker.py (local) → GET /qa-jobs/pending a cada 5s → pega o job mais antigo
    ↓
POST /qa-jobs/:id/claim { type } → (queued → running)
    ↓
[NOVO] Pré-análise conforme projectType:
  - wix_velo     → crawler Playwright mapeia o site (0 tokens) → site_map no prompt
  - repo/headless → lê repo local (full na 1ª vez, git diff depois) → code_context no prompt
    ↓
agent.py abre Chromium (perfil temporário isolado) → testa → retorna resultado + cache_update + console logs
Em paralelo: _watch_cancellation() verifica a cada 5s se job ainda existe
Se usuário cancelar no frontend → asyncio.CancelledError para o agente → volta ao polling
    ↓
POST /qa-jobs/:id/result { status, report, tokensUsed, type, siteCache?, projectName? }
    ↓
Frontend polling /ai-report (QATask) ou /dev-tests/:id (DevTest) a cada 4s → exibe relatório
```

### Contexto que o agente recebe no prompt (build_task)
Camadas opcionais, montadas conforme o projeto:
1. **description** — descrição da feature/task
2. **criteria** — critérios de aceitação
3. **skills** — instruções gerais de QA (AIKnowledge)
4. **knowledge** — base de conhecimento do projeto (AIKnowledge)
5. **site_map** — mapa Wix Velo (navegação completa, formulários, botões por página)
6. **code_context** — código-fonte (repo full na 1ª vez, git diff depois)
7. **site_cache** — o que o agente aprendeu em testes anteriores no browser
+ regras: nunca navegar (página já aberta), **descartar credenciais** (nunca no relatório), verificar erros visíveis, e ao final emitir `🗃️ CACHE_UPDATE_START...END` (o worker extrai e salva como site_cache)

### Arquivos qa-agent/

| Arquivo | Descrição |
|---------|-----------|
| `worker.py` | **v1.3.0.** Login terminal, spinner/timer ao vivo, loop de jobs, watcher de cancelamento. **+ análise de repo local** (`analyze_repo_full`/`analyze_repo_diff`, respeita .gitignore + skip list), **+ crawler Wix Velo** (`crawl_wix_site` recursivo, 0 tokens), `ensure_repo_path`, `handle_wix_mapping`. Instalado em `C:\Users\<user>\NocorpQAAgent\`. |
| `session.py` | **Cross-platform:** Windows=DPAPI, macOS=Keychain (`security` CLI), Linux=arquivo chmod 600. JWT + Cerebras key nunca em texto puro. |
| `agent.py` | browser-use wrapper: BrowserUseLLM, build_llm, token tracking. **+ perfil de browser temporário isolado por teste** (descarta cookies/sessão, sem vazamento entre users), **+ captura de console logs** (Playwright events), **+ params site_map/code_context/site_cache**, **+ parse do CACHE_UPDATE**. |
| `main.py` | FastAPI antigo — mantido para compatibilidade, não usado no fluxo principal. |
| `version.txt` | Versão atual (`1.3.0`). Worker verifica ao iniciar e avisa se há nova. |
| `install.ps1` | **Windows:** `irm .../install.ps1 \| iex`. Sempre recria o venv. Headers no-cache nos downloads. Para em erro. Atalho via `[Environment]::GetFolderPath("Desktop")`. |
| `install.sh` | **macOS:** `curl -fsSL .../install.sh \| bash`. Python via Homebrew, atalho `.command` no Finder, remove quarentena. |
| `requirements.txt` | `browser-use==0.12.9`, `openai==2.16.0`, `langchain-openai`, `langchain-ollama`, `playwright`. SEM `langchain-groq` (incompatível com browser-use — exige groq opostos). |

### Instalação

**Windows (PowerShell como Admin):**
```powershell
irm https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.ps1 | iex
```

**macOS (Terminal):**
```bash
curl -fsSL https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.sh | bash
```

Instalado em: `C:\Users\<user>\NocorpQAAgent\` (Windows) ou `~/NocorpQAAgent/` (macOS)

### Fluxo de primeiro uso (terminal)

```
✅ Backend online.
Email: bernardo@nocorp.io
Senha: ••••••••
✅ Login realizado — sessão válida 30 dias

Cole sua Cerebras API key (csk-...): csk-xxx
✅ Chave salva com segurança

┌─────────────────────────────────────────┐
│  Pronto! Aguardando análises...         │
│  Mantenha esta janela aberta.           │
└─────────────────────────────────────────┘

|  Aguardando análises...    ← spinner ao vivo

⚙️  Iniciando: Tela de login
  /  Analisando: Tela de login  [00:23]   ← timer ao vivo

  ✅ Concluído: Tela de login
  ℹ  Tokens usados: 87,432
```

### Multi-provider LLM

| Provider | Modelo | Limite | Uso |
|----------|--------|--------|-----|
| `cerebras` | gpt-oss-120b / zai-glm-4.7 | 1M tokens/dia grátis | **Padrão (agente E chat)** |
| `groq` | llama-3.3-70b-versatile | 100K tokens/dia | Aposentado (agente incompatível com browser-use; chat migrado p/ Cerebras) |
| `deepseek` | deepseek-reasoner | pago | Opcional |
| `ollama` | qualquer modelo local | ilimitado | Requer hardware |

**Fallback automático:** se `gpt-oss-120b` retornar 429, troca para `zai-glm-4.7` sem reiniciar.

---

## Role Dev — Funcionalidades

### Chat — Comandos especiais

- `/teste-qa` — abre formulário inline (título, URL, **tipo de projeto** na 1ª vez, **re-mapear** se Wix Velo, projeto com autocomplete, descrição, critérios, comportamento, notas) → cria DevTest → execution panel com polling → resultado inline. Mostra indicadores de cache UI / páginas mapeadas ao escolher um projeto
- `/prompt-qa` — exibe template de prompt para preencher com descrição da feature e enviar à IA, que gera todos os campos do `/teste-qa` prontos para copiar
- Botão **"Instalar Agent"** no header (Chat e DevTests) — dropdown com comandos Windows/macOS + copiar

### Página Testes (/dev-tests)
- Dev vê seus próprios testes; QA/admin vê todos
- Filtros por status (fila/executando/concluído/erro)
- Relatório expansível por card
- Auto-refresh quando há testes ativos
- Botão "Novo teste" → vai para chat

### Dashboard (Tasks)
- Dev vê só suas próprias tasks (match por `assignee ≈ user.name`)
- Cards não clicáveis (sem acesso à tela de review)
- Filtro "Dev" oculto

### Dashboard Stats
- Dev vê "Visão Geral" + "Por Projeto" + "Meu Desempenho" (sem ver dados de outros)

### Settings
- Dev vê apenas a seção de Configuração de IA (Cerebras key + barra de tokens)
- QA/admin vê tudo

---

## Página Projetos (/projects) — cache e configuração por projeto

Cada projeto é um card com:
- **Badge de tipo:** Wix Velo (violeta) / Wix Headless (laranja) / Repositório (cinza)
- **Seletor de tipo direto no card** — define/altera o tipo sem precisar abrir um teste (salva em `project_repo`)
- **Badges:** Cache UI (verde) e Repo (azul, com nº de arquivos)
- **Ícone de mapa** 🗺️ — agenda mapeamento/re-mapeamento (seta `pendingRemap`)
  - ⚠️ Hoje o mapa só roda junto com um `/teste-qa` (ver backlog: virar job independente)
- **Ver/Limpar cache UI**, **Remover repo**
- Caminho do repo + data da análise, contadores

---

## Frontend (src/)

- **App.jsx** — rotas: `/login`, `/register`, `/`, `/dashboard`, `/settings`, `/chat`, `/dev-tests`, `/projects`, `/review/:id`
- **AuthContext.jsx** — user, login, logout, `role`, `isDev`, `isQA`, `isAdmin`
- **Sidebar.jsx** — itens filtrados por role; Testes + Projetos visíveis para todos
- **Register.jsx** — seletor QA Analyst / Desenvolvedor
- **Dashboard.jsx** — tasks, filtros, role-aware (dev: read-only, filtrado por `assignee ≈ user.name`)
- **DashboardStats.jsx** — analytics; dev vê só "Meu Desempenho"
- **Settings.jsx** — QA: tudo; Dev: só AIConfigSection
- **QAReview.jsx** — checklist, screenshots, ações QA, card IA (queued/running/done/error + cancelar)
- **Chat.jsx** — chat **Cerebras** + `/teste-qa` (form com tipo de projeto + execution panel) + `/prompt-qa`
- **DevTests.jsx** — lista de DevTests com status, relatório, auto-refresh
- **Projects.jsx** — cache/repo/sitemap por projeto, seletor de tipo, mapear
- **AgentInstallButton.jsx** — dropdown de instalação Windows/macOS (componente compartilhado)

---

## Armadilhas conhecidas

- **Render Free dorme:** após 15 min → ~30s para acordar. Worker mostra spinner "Conectando..."
- **Prisma no Render:** `postinstall: prisma generate` + binaryTargets rhel no schema
- **SDK do Asana:** dá `hasOwnProperty` errors → sempre usar `fetch` direto
- **Stats:** sempre incluir `asanaId` no select — sem ele tudo colapsa em `byTask[undefined]`
- **browser-use 0.12.9 rejeita `min_items`:** `_clean_schema()` remove campos inválidos do JSON Schema
- **Cerebras 429:** fallback automático para `zai-glm-4.7`
- **langchain-groq incompatível:** exige `groq<1.0.0` mas browser-use exige `groq==1.0.0` → removido do requirements.txt
- **openai pinado:** `openai==2.16.0` porque browser-use 0.12.9 requer essa versão exata
- **playwright não instala como .exe:** usar `python -m playwright install chromium` em vez de `playwright.exe`
- **venv com conflitos:** installer sempre recria o venv (Remove-Item + venv) para garantir instalação limpa
- **GitHub CDN cache:** após push, `irm` pode pegar versão cacheada por ~5 min. Usar `-Headers @{'Cache-Control'='no-cache'}` para forçar
- **Desktop OneDrive:** `$env:USERPROFILE\Desktop` não existe → usar `[Environment]::GetFolderPath("Desktop")`
- **DPAPI Windows-only:** session.py agora cross-platform (macOS Keychain, Linux chmod 600)
- **Repo público obrigatório:** `raw.githubusercontent.com` exige autenticação para repos privados
- **Chat global (bug corrigido):** ChatMessage não tinha `userId` → histórico era compartilhado. Corrigido: `userId` adicionado, mensagens antigas ficam com `userId='legacy'` e são invisíveis
- **flash_mode obrigatório:** sem ele Groq/Cerebras omitem campos do tool call
- **max_failures=1 agressivo:** page readiness timeout conta como falha → usar 3
- **Browser isolado por teste (corrigido):** sem `user_data_dir` o Chromium persistia cookies entre testes/users → colega via sessão alheia. Agora cada teste usa `tempfile.mkdtemp()` apagado no final
- **`hasRepo` ≠ existir registro project_repo:** o registro `project_repo` agora guarda também `projectType`/`pendingRemap`. `hasRepo` deve checar `repoPath` real, senão um Wix Velo aparece como "repo configurado"
- **Crawler Wix = 0 tokens:** usa Playwright puro (não passa pelo browser-use/Cerebras). Segue links internos recursivamente respeitando .gitignore-like skip
- **Fila NÃO é por usuário (BUG conhecido):** `GET /qa-jobs/pending` não filtra por userId → worker de um user pega job de outro, gasta a chave Cerebras errada. Ver backlog (plano já definido)

---

## Próximos passos

- [x] Chat de treinamento da IA (Groq) — FEITO
- [x] Base de conhecimento (skills + projetos) — FEITO
- [x] Agente de QA automatizado (browser-use + Python) — FEITO
- [x] Multi-provider LLM (Cerebras, Groq, DeepSeek, Ollama) — FEITO
- [x] Pull model (sem ngrok) — FEITO
- [x] Login via terminal + sessão criptografada (DPAPI/Keychain) — FEITO
- [x] Contador de tokens (por step + diário + Settings) — FEITO
- [x] Instalador one-line Windows + macOS — FEITO
- [x] Deploy backend no Render + frontend no Vercel — FEITO
- [x] Role Dev (tasks read-only, /teste-qa, /prompt-qa, DevTests page) — FEITO
- [x] Histórico do chat isolado por usuário — FEITO
- [x] Cancelamento de análise em tempo real (watcher paralelo) — FEITO
- [x] Settings filtrada por role — FEITO
- [x] Chat migrado Groq → Cerebras (key do banco, fallback automático) — FEITO
- [x] Browser isolado + descarte de credenciais por teste — FEITO
- [x] Cache de UI por projeto (agente aprende e reusa) + console logs — FEITO
- [x] Análise de repo local (full 1ª vez, git diff depois) — FEITO
- [x] Crawler Wix Velo (mapeamento recursivo, 0 tokens) + tipos de projeto — FEITO
- [x] Página Projetos (cache/repo/sitemap, seletor de tipo, mapear) — FEITO
- [x] Botão de instalação do Agent (Win/Mac) no Chat e Testes — FEITO

### 🔜 PRÓXIMA TAREFA AUTORIZADA (implementar agora) — Fila por usuário + filtro por assignee
**Decisões fechadas com o usuário:**
1. **Fila por usuário:** cada worker só pega jobs do próprio usuário logado
   - `DevTest` já tem `userId` → filtrar `GET /qa-jobs/pending` por `req.user.id`
   - `AIReport` **não tem `userId`** → adicionar campo (`prisma db push`) + setar no `POST /tasks/:id/run-ai-qa` (quem clicou "Executar análise")
   - Filtrar AS DUAS filas por `req.user.id` no pending; validar dono no claim/result
   - Efeito desejado: teste só roda na máquina de quem criou, com a chave dele
2. **Visibilidade de task do dev = por ATRIBUIÇÃO (assignee), não menção**
   - Dev só vê no Dashboard as tasks **atribuídas a ele** no Asana
   - **Match por EMAIL:** o email do QA System é o mesmo do Asana → match automático, SEM campo extra nas configurações
   - ⚠️ Hoje `QATask.assignee` é guardado como **nome** (texto). Para casar por email, ajustar o **webhook do Asana** para capturar também o **email/GID** do assignee
   - Dashboard.jsx: trocar o match atual (`assignee ≈ user.name`) por match de email

### Backlog (aguardando autorização)
- [ ] **(FILA)** Botão "Mapear" da página Projetos virar job independente tipo `wix_map`: hoje só seta `pendingRemap`, o mapa só roda junto com um `/teste-qa`. Worker pega na hora (sem teste), perguntando a URL ao clicar (projeto pode ter 0 testes = sem URL salva). Mexe em: projects.js, qaJobs.js, worker.py (crawler sem agente), Projects.jsx
- [ ] Testar fluxo completo end-to-end (worker → job → Chromium → relatório)
- [ ] Sistema de auto-update (worker verifica version.txt e baixa arquivos novos)
- [ ] Preencher base de conhecimento com projetos reais
- [ ] Página de Conta (perfil do usuário, trocar senha)
- [ ] Vision no agente (comparação visual)
