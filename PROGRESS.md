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
- **IA Chat:** **Cerebras** (`gpt-oss-120b`, fallback `zai-glm-4.7`) via REST API — 1M tokens/dia. Lê a key do banco. **Migrado do Groq.**
- **IA QA Agent:** Python local + browser-use 0.12.9 + Playwright (Chromium) + **Claude Haiku 4.5** (padrão) / **GPT-4o mini** (alternativo). Provider configurado via menu `[2]` no worker → salva `AI_PROVIDER` + chave no `.env`.
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

- **QATask** — task em QA. Campos: asanaId, title, description, previewUrl, assignee, **assigneeEmail** (novo — capturado do Asana via webhook para match exato no Dashboard), status, projectName, wasRejectedBefore, wasSuggestedBefore
- **QACheck** — item do checklist (label, checked) ligado à QATask
- **QAComment** — histórico de comentários local (type, text) ligado à QATask
- **QAEvent** — registro PERMANENTE de cada ação para gráficos (asanaId, action, projectName, assignee, wasFirstApproval). NÃO deletado nas limpezas automáticas.
- **User** — name, email, password (bcrypt), **role** (`qa`|`dev`|`admin`), totpSecret; relações: devTests[], **aiReports[]** (novo)
- **ChatMessage** — histórico do chat por usuário (**userId** isolado por conta), role, content
- **AIKnowledge** — base de conhecimento + configs do sistema. Campo `type`:
  - `skill` / `project` — base de conhecimento da IA
  - `config` / `cerebras_api_key` — key da IA
  - `site_cache` / `<projeto>` — cache de UI (JSON: navigation/loginFlow/knownRoutes/uiPatterns/notes)
  - `project_repo` / `<projeto>` — config do projeto (JSON): `repoPath`, `lastCommit`, `analyzedAt`, `fileCount`, `projectType`, `pendingRemap`
  - `repo_cache` / `<projeto>` — **resumo QA do repositório** gerado pela Cerebras (JSON estruturado: rotas, features, auth, endpoints, regras de negócio). Não armazena código bruto.
  - `wix_sitemap` / `<projeto>` — mapa do site Wix Velo (JSON: baseUrl, pageCount, pages{})
- **ProjectToolCall** — knowledge base por projeto (nova, v1.4.7). Campos: `projectName`, `topic` (ex: `auth/login`), `title`, `description`, `content` (detalhes para QA), `source` (arquivo origem). Chave única: `[projectName, topic]`. Gerada automaticamente a partir do código-fonte do repo (lotes de 3 arquivos → Cerebras) ou descoberta pelo agente durante testes Wix (`source: agent_discovery`).
- **AIReport** — relatório do agente por task. Campos: taskId (unique), **userId** (novo — quem enfileirou, para isolamento de fila), status, report, tokensUsed
- **DevTest** — teste manual iniciado por dev. Campos: userId, title, description, previewUrl, projectName, criteria (JSON), **loginEmail** (novo v1.4.12), **loginPassword** (novo v1.4.12), status, report, tokensUsed

> **DIRECT_URL (CRÍTICO para migrations):** `DATABASE_URL` porta 6543 (Transaction Pooler).
> `DIRECT_URL` porta 5432 (Session Pooler, migrations). Usar `npx prisma db push`.

---

## Rotas do backend

### Públicas
- `POST /auth/register` — exige `registerSecret` + `role` opcional (`qa`|`dev`)
- `POST /auth/login` — valida credenciais; cookie `trusted_device` pula TOTP; JWT inclui `role`
- `POST /auth/verify-totp` — valida TOTP, retorna JWT + cookie
- `POST /webhook` — recebe eventos do Asana; agora salva **assigneeEmail** além do nome

### Protegidas (Bearer JWT)
- `GET /tasks` — lista tasks
- `GET|POST|PUT|DELETE /knowledge` — base de conhecimento
- `GET /stats?period=7d|30d|6m` — analytics
- `POST /admin/setup-webhooks` — re-registra webhooks
- `DELETE /admin/clear-test-data` — apaga dados de teste
- `GET|POST|DELETE /chat/history`, `POST /chat/message` — chat isolado por userId, via Cerebras
- `GET|POST|DELETE /tasks/:id/ai-report` — relatório IA
- `POST /tasks/:id/run-ai-qa` — enfileira análise; **seta userId = req.user.id no AIReport**
- `GET /settings/ai` — uso da API: custo hoje/total em BRL, tokens (AIReport + DevTest), breakdown por usuário para QA/admin. Pricing: Claude Haiku 4.5 ($0,80/$4,00 por 1M in/out), câmbio R$5,75/USD
- `GET /qa-jobs/pending` — Pull model: worker busca próximo job **filtrado por userId** (isolamento por usuário). Retorna: `site_cache`, `repo_cache`, `project_type`, `has_sitemap`, `pending_remap`
- `POST /qa-jobs/:id/claim` — worker reivindica job
- `POST /qa-jobs/:id/result` — worker posta resultado; `siteCache+projectName` salva cache de UI
- `GET /dev-tests`, `POST /dev-tests` (aceita `loginEmail`+`loginPassword`), `GET /dev-tests/:id`, `DELETE /dev-tests/:id`, `POST /dev-tests/:id/rerun` (aceita `loginEmail`+`loginPassword` para sobrescrever — abre formulário inline no frontend), `POST /dev-tests/:id/cancel`
- `GET /projects` — lista projetos com stats: testCount, hasCache, hasRepo, **hasRepoCache**, **repoCacheUpdatedAt**, projectType, hasSitemap/sitemapPageCount, repoFileCount
- `GET|PUT|DELETE /projects/:name/repo` — config do repo/tipo (merge no PUT)
- `GET|PUT|DELETE /projects/:name/repo-cache` — **resumo QA do repositório** (DELETE também limpa lastCommit para forçar re-análise)
- `GET|PUT|DELETE /projects/:name/sitemap` — mapa Wix Velo
- `GET|DELETE /projects/:name/cache` — cache de UI
- `GET /projects/:name/tools?q=query` — lista tool calls (topic+title+description); `?topic=X` retorna um completo (com content)
- `POST /projects/:name/tools` — cria/atualiza tool call (upsert por topic)
- `DELETE /projects/:name/tools[?topic=X]` — remove um topic ou todos do projeto
- `/qa-jobs/pending` — agora inclui `tool_call_titles` pré-carregados no payload

---

## Agente de QA Automatizado — Pull Model (pasta qa-agent/)

### Arquitetura (Pull Model — sem ngrok)

```
Usuário clica "Executar análise" (QAReview) OU submete /teste-qa (Chat)
    ↓
Backend salva AIReport{status:'queued', userId} ou DevTest{status:'queued', userId}
    ↓
worker.py (local) → GET /qa-jobs/pending?userId a cada 5s → pega só os jobs DO próprio usuário
    ↓
POST /qa-jobs/:id/claim { type } → (queued → running)
    ↓
Pré-análise conforme projectType:
  - wix_velo     → crawler Playwright mapeia o site (0 tokens) → site_map no prompt
  - repo/headless → lê repo local (full na 1ª vez, git diff depois)
                  → Cerebras resume para JSON QA (rotas/features/auth/etc) → salva repo_cache
                  → agente recebe resumo (~2-3k chars), NÃO o código bruto
    ↓
Cerebras estima quantos steps o teste precisa (prompt curto, resposta = número inteiro)
Fallback: 8 + 5×critérios, máx 35
    ↓
Pergunta: "Deseja visualizar o browser durante o teste? [s/n]" (a cada execução, sem salvar)
    ↓
agent.py abre Chromium (perfil temporário isolado) → testa → retorna resultado
Em paralelo: _watch_cancellation() verifica cancelamento a cada 5s
    ↓
Se agente falhou/ficou inconclusivo:
  → Pergunta ao analista: "Dica (ou Enter para aceitar resultado atual):"
  → Se der dica: retry com contexto do que já foi aprovado + a dica (estimated_steps + 5)
    ↓
POST /qa-jobs/:id/result { status, report, tokensUsed, type, siteCache?, projectName? }
    ↓
Frontend polling /ai-report ou /dev-tests/:id a cada 4s → exibe relatório
(qaFlow persiste no localStorage — se navegar e voltar, retoma polling automaticamente)
```

### Contexto que o agente recebe no prompt (build_task)
1. **description** — descrição da feature/task
2. **criteria** — critérios de aceitação
3. **skills** — instruções gerais de QA
4. **knowledge** — base de conhecimento do projeto
5. **site_map** — mapa Wix Velo (navegação completa, formulários, botões por página)
6. **tool_call_titles** *(v1.4.7, prioridade sobre code_context)* — índice compacto da knowledge base: `[topic] title: description` por linha. Agente usa `search_project_tools(query)` para buscar detalhes sob demanda. Só ativo quando Controller está disponível.
7. **code_context** — **resumo QA do repo** (fallback quando sem tool_call_titles)
8. **site_cache** — o que o agente aprendeu em testes anteriores
9. **max_steps** — orçamento de steps visível no prompt ("Você tem X steps")
+ regras: nunca navegar, descartar credenciais, ao final emitir `🗃️ CACHE_UPDATE_START...END`

### Arquivos qa-agent/

| Arquivo | Descrição |
|---------|-----------|
| `worker.py` | **v1.4.18.** Login terminal, spinner/timer com **custo em BRL ao vivo**, loop de jobs, watcher de cancelamento. Auto-update. **Menu `[2]`** troca provider (Claude/OpenAI) e chave, salva `AI_PROVIDER`+chave no `.env`. `_llm_call()` suporta Anthropic API e OpenAI API (HTTP direto). `ensure_llm_key()`, `_update_env_api_key()`, `_update_env_provider()`. Constantes de precificação `_PRICE_IN_PER_M`/`_PRICE_OUT_PER_M`/`_USD_BRL`. `_cost_brl()` + `_fmt_brl()`. Ao final de cada teste: log de tokens + custo estimado. `_live_timer()` exibe custo acumulado via `get_live_cost_brl()`. Todo parâmetro `cerebras_key` renomeado para `llm_key`. |
| `session.py` | Cross-platform: Windows=DPAPI, macOS=Keychain, Linux=chmod 600. |
| `agent.py` | **v1.4.18.** browser-use wrapper. `max_failures=3`, `max_actions_per_step=5`. **`build_llm` suporta apenas:** `claude` (Anthropic, padrão — Haiku 4.5) e `openai` (GPT-4o mini). Auto-instala `langchain-anthropic` se não instalado. **Custo ao vivo:** `BrowserUseLLM._live_cost_brl` atualizado em `_track_usage()` a cada step; `get_live_cost_brl()` + `reset_live_cost()` exportados. Preços: `_PRICE_IN_PER_M=0.80`, `_PRICE_OUT_PER_M=4.00` (Haiku 4.5). **Credenciais dinâmicas:** `build_task()` e `run_qa_agent()` aceitam `login_email`+`login_password`; PASSO 1 usa credenciais do job com flag `⚠️ PRIORIDADE ABSOLUTA`; site_cache instrui a não usar credenciais armazenadas. Parâmetro renomeado `cerebras_api_key` → `llm_key`. `_fix_action_args()`, `is_schema_error`, `timing.log`, `_external_session`, `_no_initial_navigate`, `step_extension_callback`. |
| `version.txt` | Versão atual (`1.4.18`). **LOCAL_VERSION em worker.py SEMPRE deve bater com este arquivo.** |
| `install.ps1` | Windows: `irm .../install.ps1 \| iex`. Necessário só na primeira instalação. |
| `install.sh` | macOS: `curl -fsSL .../install.sh \| bash`. |

### Auto-update
Ao iniciar, o worker compara `LOCAL_VERSION` com `version.txt` no GitHub.
Se houver atualização: pergunta ao usuário → baixa apenas `worker.py`, `agent.py`, `session.py`, `version.txt` (~50KB total, sem tocar no venv) → reinicia automaticamente com `os.execv`.

**Instalador completo só necessário na primeira instalação.**

### Instalação (primeira vez)

**Windows:**
```powershell
irm https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.ps1 | iex
```
**macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.sh | bash
```

### Multi-provider LLM (v1.4.15+)

| Provider | Modelo padrão | Preço (in/out /1M) | Custo real/critério | Observações |
|----------|--------------|-------------------|---------------------|-------------|
| `claude` (**padrão**) | claude-haiku-4-5-20251001 | $0,80 / $4,00 | ~R$ 1,50–3,00 | Confiável, rápido |
| `openai` | gpt-4o-mini | $0,15 / $0,60 | ~R$ 0,25–0,50 | 6x mais barato que Haiku |

> **Custo alto por critério:** browser-use acumula contexto crescente a cada step (step 15 já carrega ~80k tokens de histórico). O custo é proporcional ao número de steps × tamanho do contexto.

**Trocar provider:** pressionar `[2]` no menu inicial → escolher Claude (1) ou OpenAI (2) → colar chave → salva `AI_PROVIDER` + chave no `.env` automaticamente.
**Modelo custom:** `CLAUDE_MODEL=claude-sonnet-4-6` ou `OPENAI_MODEL=gpt-4o` no `.env` do worker.

---

## Fila por usuário (isolamento completo)

- `AIReport.userId` — gravado ao clicar "Run AI QA" (req.user.id do JWT)
- `DevTest.userId` — já existia
- `GET /qa-jobs/pending` filtra por `userId: req.user.id` → worker só pega seus próprios jobs
- Nunca mais um job de um usuário aparece no terminal de outro

## Visibilidade de tasks por assignee email

- `QATask.assigneeEmail` — capturado do Asana via webhook (`assignee.email` no opt_fields)
- Dashboard.jsx: dev filtra por `assigneeEmail === user.email` (match exato)
- Fallback por nome aproximado para tasks antigas sem email

---

## Página Projetos (/projects) — cache e configuração por projeto

Cada projeto card mostra:
- **Badge de tipo:** Wix Velo (violeta) / Wix Headless (laranja) / Repositório (cinza)
- **Badge de mapa:** páginas mapeadas (ex: "23 págs.") — visível quando hasSitemap
- **Badge de repo:** azul com nº de arquivos quando `hasRepoCache` (resumo QA gerado); cinza "aguardando análise" quando tem repo mas sem cache ainda
- **Linha de detalhes:** "X páginas mapeadas · Y atrás", "Cache QA do repo atualizado Z atrás", caminho do repo
- **Botão re-mapear (ícone 🗺️):** visível APENAS para projetos `wix_velo`
- **Ações:** Ver/Limpar cache UI, Limpar cache repo (força re-análise completa), Remover repo
- **Seletor de tipo** inline no card

---

## repo_cache — Resumo QA do Repositório

Fluxo para projetos `repo` e `wix_headless`:
1. **Primeira análise:** lê repo completo → Cerebras extrai JSON com: `projectType`, `mainRoutes`, `keyFeatures`, `authFlow`, `apiEndpoints`, `forms`, `businessRules`, `knownIssues`, `techStack`, `testingNotes` → salva como `repo_cache` no AIKnowledge
2. **Análises seguintes:** `git diff lastCommit..HEAD` → Cerebras atualiza apenas o que mudou no cache
3. **Agente recebe:** o resumo JSON (~2-3k chars), nunca o código bruto (~40k+ chars)
4. **Limpar cache repo:** DELETE `/projects/:name/repo-cache` também limpa `lastCommit` para forçar re-leitura completa

---

## Frontend (src/)

- **App.jsx** — rotas: `/login`, `/register`, `/`, `/dashboard`, `/settings`, `/chat`, `/dev-tests`, `/projects`, `/review/:id`
- **AuthContext.jsx** — user (com email), login, logout, `role`, `isDev`, `isQA`, `isAdmin`
- **Sidebar.jsx** — itens filtrados por role
- **Dashboard.jsx** — dev filtra por `assigneeEmail === user.email` (match exato), fallback por nome para tasks antigas
- **Chat.jsx** — `qaFlow` persiste no localStorage enquanto queued/running; ao voltar, retoma polling; poll imediato ao montar
- **Projects.jsx** — badges sitemapPageCount + repoFileCount/repoCache; botão remap só para wix_velo; "Limpar cache repo"
- **DevTests.jsx** — botão **Re-executar** (violeta, só para done/error) + botão **Parar** (laranja, só para queued/running); atualiza card em tempo real
- **AgentInstallButton.jsx** — dropdown instalação Windows/macOS

---

## Armadilhas conhecidas

- **Render Free dorme:** após 15 min → ~30s para acordar. Worker mostra spinner "Conectando..."
- **Prisma no Render:** `postinstall: prisma generate` + binaryTargets rhel no schema
- **SDK do Asana:** dá `hasOwnProperty` errors → sempre usar `fetch` direto
- **Stats:** sempre incluir `asanaId` no select
- **browser-use 0.12.9 rejeita `min_items`:** `_clean_schema()` remove campos inválidos
- **Cerebras 429:** fallback automático para `zai-glm-4.7`
- **langchain-groq incompatível:** removido do requirements.txt
- **openai pinado:** `openai==2.16.0` (browser-use 0.12.9 exige essa versão)
- **playwright:** usar `python -m playwright install chromium`
- **venv com conflitos:** installer sempre recria o venv
- **GitHub CDN cache:** após push pode demorar ~5 min. Usar `-Headers @{'Cache-Control'='no-cache'}`
- **Desktop OneDrive:** usar `[Environment]::GetFolderPath("Desktop")`
- **DPAPI Windows-only:** session.py cross-platform (macOS Keychain, Linux chmod 600)
- **Repo público obrigatório:** raw.githubusercontent.com exige auth para repos privados
- **Chat global (bug corrigido):** ChatMessage agora tem userId
- **flash_mode obrigatório:** sem ele Cerebras omite campos do tool call
- **Browser isolado por teste:** cada teste usa `tempfile.mkdtemp()` apagado no final
- **`hasRepo` ≠ existir registro project_repo:** checar `repoPath` real, não apenas existência do registro
- **Crawler Wix = 0 tokens:** Playwright puro, não passa pelo Cerebras
- **LOCAL_VERSION em worker.py DEVE SEMPRE bater com version.txt:** se divergirem, auto-update fica em loop infinito
- **browser-use limite 100k chars no task:** build_task() trunca code_context (40k) e site_map (30k); hard cap 95k
- **Chrome aviso "extensions-on-chrome-urls":** banner cosmético do Playwright ao lançar Chromium — comportamento normal, ignorar
- **`.env` com modelo antigo sobrevive ao auto-update:** `_fix_env_model_now()` corrige ao iniciar; `_patch_env_model_on_update()` corrige após update
- **LLM é stateless:** toda informação precisa ir no request — não existe "memória" externa sem enviar pelo request. Fine-tuning ensina comportamento, não fatos específicos do projeto
- **"Lost in the middle":** modelos ignoram informação no meio de contextos longos — encher o prompt de código não garante que o agente vai usar
- **Contexto cresce por step:** mensagem 1 (task+DOM) vai em todos os steps. Step 10 = task + 9×(ação+DOM) ≈ 50-75k tokens. Principal causa de lentidão progressiva
- **max_failures=3:** com 1 o agente parava no primeiro tropeço (elemento não encontrado etc)
- **qaFlow é estado React local:** sem localStorage, navegar e voltar ao chat perdía o estado do teste em andamento
- **Estimativa de steps:** Cerebras estima via prompt curto (max_tokens=16); fallback = 10 + 5×critérios, máx 50
- **load_dotenv sem override:** variáveis do sistema Windows/sessão anterior podem prevalecer sobre .env → usar `load_dotenv(path_absoluto, override=True)`
- **Modelos Cerebras free tier:** `llama3.1-8b` e `llama3.3-70b` retornam 404 no plano free. Usar `gpt-oss-120b` (3000 tok/s) ou `zai-glm-4.7` (fallback)
- **PASSO 2/3 hardcoded:** o prompt original tinha instrução específica de "clique em cadastro/registro" — desperdiçava steps em testes não relacionados. Corrigido para instrução genérica baseada nos critérios
- **Teste preso em "running":** worker morreu mas backend não sabe → botão "Parar" na página de testes reseta para error
- **Cerebras rate limit 60s:** free tier limita ~1 req/min → steps alternam 1s (quota disponível) e 61s (espera janela resetar). Solução: usar SambaNova (`AI_PROVIDER=sambanova`)
- **browser-use 0.12.9 renomeou ações:** `input_text` → `input`, parâmetro `index` (não `element_index`). LLM treinado em exemplos antigos gera nomes errados → Pydantic joga ~150 ValidationErrors. Corrigido por `_fix_action_args()` que traduz antes de `model_validate`
- **SambaNova key não passava para build_llm:** `cerebras_api_key` não era usado no case `sambanova` do build_llm. Corrigido: `api_key = cerebras_api_key or os.getenv("SAMBANOVA_API_KEY")`
- **_update_env_* não atualiza os.environ:** salvar no .env não basta para a sessão atual → necessário `os.environ['KEY'] = value` após escrever o arquivo
- **tool_call_titles sem controller:** se Controller não carregou (versão antiga browser-use), mostrar o índice de tool calls no prompt confunde o agente (instrui ações que não existem). Guard: `_effective_titles = tool_call_titles if controller is not None else None`
- **ProjectToolCall.topic com barras:** tópicos como `auth/login` não podem ir como path param em Express → usar query param `?topic=auth/login` com `decodeURIComponent`
- **LOCAL_VERSION desatualizado em worker.py:** versão bumped em version.txt mas não em `LOCAL_VERSION` constante do worker → auto-update em loop infinito. Sempre atualizar os dois juntos.
- **SambaNova Meta-Llama-3.1-8B descontinuado:** fallback model removido pela SambaNova → usar sem fallback ou trocar para Claude/OpenAI
- **SambaNova TPM muito baixo:** 70B model esgota tokens-por-minuto em testes com muitos steps → 429 consecutivos mesmo após sleep de 30s. Não usar SambaNova para browser-use
- **Settings tokensUsed não atualizava:** `GET /settings/ai` só agregava `AIReport`, ignorava `DevTest`. Corrigido: agrega os dois
- **Custo real por critério ~R$1,50–3,00:** browser-use acumula contexto crescente → step 15 já tem ~80k tokens de histórico. Estimativas de "custo por teste" só fazem sentido com dados reais do banco
- **site_cache pode ter credenciais antigas:** `loginFlow` armazenado no cache contém credenciais de runs anteriores. O agente seguia o cache em vez do PASSO 1. Corrigido: cache avisa `⚠️ SEMPRE use as do PASSO 1`; PASSO 1 com credenciais tem flag `PRIORIDADE ABSOLUTA`
- **langchain-anthropic não instalado:** build_llm tenta auto-instalar com `subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'langchain-anthropic'])` na primeira execução com provider=claude

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
- [x] Cancelamento de análise em tempo real — FEITO
- [x] Chat migrado Groq → Cerebras — FEITO
- [x] Browser isolado + descarte de credenciais — FEITO
- [x] Cache de UI por projeto (site_cache) — FEITO
- [x] Análise de repo local (full 1ª vez, git diff depois) → **agora resume via Cerebras** — FEITO
- [x] Crawler Wix Velo (mapeamento recursivo, 0 tokens) + tipos de projeto — FEITO
- [x] Página Projetos (cache/repo/sitemap, seletor de tipo, mapear) — FEITO
- [x] Botão de instalação do Agent (Win/Mac) — FEITO
- [x] Fila por usuário (AIReport.userId + filtro no pending) — FEITO
- [x] Visibilidade de tasks por assignee email — FEITO
- [x] Contagem de páginas mapeadas nos cards de projeto — FEITO
- [x] repo_cache — Cerebras resume repositório, agente recebe só o essencial — FEITO
- [x] Estimativa inteligente de steps (Cerebras decide antes de cada teste) — FEITO
- [x] Auto-update do worker (baixa só .py, reinicia sozinho) — FEITO
- [x] Visibilidade do browser perguntada a cada sessão (sem salvar preferência) — FEITO
- [x] Agente mais resiliente (max_failures 1→3) — FEITO
- [x] Chat persiste qaFlow no localStorage — FEITO
- [x] Analista pode dar dica ao agente quando trava (retry com contexto do progresso) — FEITO
- [x] **Checkpoints por critério** — cada critério é sessão independente; falha em crit. N → só ele reabre — FEITO
- [x] **Menu de configurações ao iniciar** — [1] trocar usuário, [2] trocar chave Cerebras — FEITO
- [x] **Botão Re-executar** em DevTests — re-enfileira teste com os mesmos dados — FEITO
- [x] **Botão Parar** para testes presos em running/queued — FEITO
- [x] **max_actions_per_step 3→5** — agente agrupa mais ações por chamada LLM — FEITO
- [x] **Budget de steps melhorado** — teto 35→50, mínimo por critério 20, fallback 10+5n máx 50 — FEITO
- [x] **Prompt PASSO 2/3 genérico** — não mais hardcoded para cadastro — FEITO
- [x] **load_dotenv caminho absoluto + override=True** — .env sempre prevalece sobre vars do sistema — FEITO
- [x] **Modelo gpt-oss-120b** — único disponível no free tier Cerebras, 3000 tok/s — FEITO
- [x] **v1.4.4 — timing.log separado** — `[TIMING] Step N | LLM: Xs | Browser: Ys` por step + resumo final com % LLM vs % browser — FEITO
- [x] **v1.4.4 — fix automático de modelo no .env** — `_fix_env_model_now()` ao iniciar + `_patch_env_model_on_update()` após auto-update corrigem `llama3.1-8b` etc → `gpt-oss-120b` automaticamente — FEITO
- [x] **v1.4.4 — guard de modelo em agent.py** — `_UNAVAILABLE` força `gpt-oss-120b` mesmo se `.env` antigo chegou ao `build_llm` — FEITO
- [x] **v1.4.5 — comando /end no prompt de dica** — `/end` fecha browser e encerra teste (compila resultado parcial); Enter=continua; texto=dica+retry — FEITO
- [x] **v1.4.6 — browser permanece aberto em falha e steps esgotados** — FEITO
  - Critério falhou → browser aberto → pede dica (`texto`=retry, `/end`=encerra)
  - Steps esgotados → browser aberto → pede mais steps (`número`=continua no mesmo Agent, `/end`=encerra)
  - `_run_single_criterion` gerencia sessão externamente (cria/fecha o browser); retries reutilizam browser já aberto (sem re-login, estado preservado)
  - `_external_session` + `_no_initial_navigate` + `step_extension_callback` em `run_qa_agent`
  - Loop interno de steps: mesmo Agent, mesmo browser, sem re-navegar
- [x] **v1.4.7 — ProjectToolCall: knowledge base com geração automática** — FEITO
  - Tabela `ProjectToolCall` no banco (`projectName+topic` chave única)
  - Endpoints: `GET|POST|DELETE /projects/:name/tools` (busca por `?q=` ou `?topic=`)
  - `/qa-jobs/pending` inclui `tool_call_titles` pré-carregados
  - `generate_tool_calls_from_repo()`: divide código por arquivo, filtra arquivos com lógica, lotes de 3 → Cerebras extrai JSON de tool calls
  - `build_tool_call_controller()`: Controller browser-use com `search_project_tools(query)` e `save_project_tool(...)` usando HTTP para o backend
  - `build_task()`: usa índice compacto de títulos em vez de 40k chars de código; fallback para `code_context` se sem tool calls ou sem Controller
  - Proteção: `_effective_titles = None` quando controller é None (evita prompt com ações inexistentes)
- [x] **v1.4.8 — fix ValidationError browser-use 0.12.9** — FEITO
  - `_fix_action_args()`: traduz nomes de ação antes de `model_validate` (`input_text→input`, `element_index→index`)
  - `is_schema_error` no `ainvoke`: captura ValidationError e retenta com `_invoke_clean_function_calling`
  - Elimina ~150 ValidationErrors por step que desperdiçavam steps e contavam como falhas
- [x] **v1.4.9–1.4.11 — SambaNova como provider alternativo** — FEITO (descontinuado em v1.4.15)
  - `build_llm`: novo case `sambanova` (Meta-Llama-3.3-70B, $5 crédito grátis, sem fila de 60s)
  - `_llm_call()` multi-provider substitui `_cerebras_call` (alias mantido)
  - Fix: `cerebras_api_key or os.getenv("SAMBANOVA_API_KEY")` no case sambanova do `build_llm`
  - **Descontinuado:** SambaNova TPM muito baixo para browser-use com contexto crescente; fallback model (Meta-Llama-3.1-8B) descontinuado pela SambaNova
- [x] **v1.4.12 — Credenciais de login por teste** — FEITO
  - `DevTest` schema: `loginEmail` + `loginPassword` opcionais
  - `POST /dev-tests` e `POST /dev-tests/:id/rerun` aceitam credenciais; rerun sobrescreve
  - `/qa-jobs/pending` inclui `login_email`/`login_password` no payload
  - `build_task()` + `run_qa_agent()` recebem credenciais dinâmicas; PASSO 1 usa as do job com `⚠️ PRIORIDADE ABSOLUTA`; site_cache instrui a não usar credenciais armazenadas
  - Frontend: campos Email/Senha no formulário `/teste-qa`; botão Re-executar abre formulário inline com campos de credenciais
- [x] **v1.4.13–1.4.14 — Fixes SambaNova** — FEITO
  - v1.4.13: removido fallback depreciado (Meta-Llama-3.1-8B)
  - v1.4.14: sleep 30s em 429 antes de propagar para o browser-use retry
- [x] **v1.4.15 — Migração para Claude (Anthropic) e OpenAI** — FEITO
  - `build_llm`: remove Cerebras, SambaNova, Groq, DeepSeek, Ollama; suporta apenas `claude` e `openai`
  - Auto-instala `langchain-anthropic` se não instalado
  - `_llm_call()` reescrito: Anthropic API (`/v1/messages`) e OpenAI API (`/v1/chat/completions`)
  - `ensure_llm_key()` genérico substitui `ensure_cerebras_key`/`ensure_sambanova_key`
  - `_update_env_api_key(key_name, value)` substitui funções específicas por provider
  - Menu `[2]`: Claude (1) / OpenAI (2) — salva provider e chave no `.env`
  - Todo `cerebras_key` renomeado para `llm_key` em todo o pipeline
  - Removido `_fix_env_model_now()` e `_patch_env_model_on_update()` (Cerebras-specific)
- [x] **v1.4.16–1.4.17 — Custo em BRL e contador ao vivo** — FEITO
  - `settings.js`: agrega AIReport + DevTest (fix bug — só AIReport era contado), custo em BRL por pricing Haiku, breakdown por usuário para QA/admin
  - `Settings.jsx`: exibe "Custo hoje" + "Custo total" em R$, tokens secundários, tabela por usuário; remove gerenciamento de chave Cerebras
  - `agent.py`: `BrowserUseLLM._live_cost_brl` atualizado a cada step em `_track_usage()`; `get_live_cost_brl()` + `reset_live_cost()` exportados
  - `worker.py`: `_live_timer()` lê `get_live_cost_brl()` e exibe `R$ X,XXXX` na linha do spinner; constantes de pricing + `_cost_brl()` + `_fmt_brl()`; log de custo ao final de cada teste
- [x] **v1.4.18 — Claude Haiku 4.5 como padrão** — FEITO
  - Modelo padrão: `claude-haiku-4-5-20251001` (era Sonnet 4.6)
  - Pricing atualizado: $0,80/$4,00 por 1M tokens (era $3/$15)
  - ~4x mais barato que Sonnet; custo real ~R$1,50–3,00/critério (Haiku)

### Backlog (aguardando autorização)
- [ ] Botão "Mapear" da página Projetos virar job independente `wix_map` (hoje só seta pendingRemap)
- [ ] Testar fluxo completo end-to-end
- [ ] Preencher base de conhecimento com projetos reais
- [ ] Página de Conta (perfil do usuário, trocar senha)
- [ ] Vision no agente (comparação visual)
- [ ] Heartbeat do worker → auto-reset de testes presos após timeout (hoje: manual via botão Parar)
- [ ] Forçar agrupamento máximo de ações no prompt (hoje `max_actions_per_step=5` permite mas não força — LLM às vezes usa 1-2 por step)
- [ ] Trocar para GPT-4o mini (6x mais barato que Haiku, ~R$0,30/critério) — só trocar AI_PROVIDER no `.env` + OPENAI_API_KEY
- [ ] Investigar `use_vision=False` no browser-use para reduzir tokens de screenshots (~25% do custo)
