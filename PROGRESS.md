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
- **IA Chat:** Groq (`llama-3.3-70b-versatile`) via REST API — 6.000 req/dia grátis
- **IA QA Agent:** Python local + browser-use 0.12.9 + Playwright (Chromium) + Cerebras (primário)
- **Deploy:** Render (backend) + Vercel (frontend) — dois serviços separados
- **Repositório:** https://github.com/B3RN4R-1022/qa-system

### Processos em dev local
```
1. Backend Node.js  → cd backend && npm run dev   → porta 3001
2. Frontend Vite    → cd frontend && npm run dev  → porta 5173
3. QA Agent worker  → cd qa-agent && start.bat    → sem porta (pull do Render)
```

---

## Deploy

### Backend → Render (Web Service)
- **Root Directory:** `backend`
- **Build Command:** `npm install` (postinstall já faz `prisma generate`)
- **Start Command:** `npm start`
- **URL:** `https://qa-system-5vpf.onrender.com`
- **⚠️ Plano Free:** dorme após 15 min de inatividade → primeira requisição do dia demora ~30-50s
- Variáveis de ambiente no painel do Render (sem aspas):
  ```
  DATABASE_URL, DIRECT_URL, JWT_SECRET, REGISTER_SECRET, ASANA_TOKEN, GROQ_API_KEY
  ```

### Frontend → Vercel (Static Site)
- **Root Directory:** `frontend`
- **Build Command:** `npm run build` (automático)
- Variável de ambiente:
  ```
  VITE_API_URL = https://qa-system-5vpf.onrender.com   (SEM barra no final)
  ```

---

## Fluxo principal

1. Task muda para **"Em QA"** no Asana → webhook dispara para Render
2. Backend valida campos obrigatórios: **Prioridade, Complexidade, Tipo, Início** (+ Título e Descrição)
   - Se faltar algo → comenta no Asana (`⚠️ Devolvida pelo QA`), muda para **"QA Falhou"** e salva como `rejected`
3. Parser extrai os **Critérios de Aceitação** da descrição → vira checklist (QACheck)
4. Parser extrai links de **Link de Teste** e **Mockups/Designs** da descrição (sem GET extra)
5. Pega o campo **"Instâncias"** do Asana → vira `projectName`
6. Task aparece no Dashboard (auto-refresh a cada 30s)
7. QA abre a task, vê checklist + screenshots (anexos do Asana) + links + preview
8. QA toma uma ação:
   - **✓ Aprovar** (só com todos os checks marcados) → `approval_status: approved` no Asana
   - **↺ Sugerir alteração** (comentário obrigatório) → `changes_requested` + comenta
   - **✗ Recusar** (mostra itens não checados + comentário opcional) → `rejected` + comenta
9. Cada ação salva um **QAEvent permanente** (para os gráficos) e um **QAComment** (histórico local)

> Status no Asana: só existe **"Em QA"** → vira **"Feito"** (aprovado) ou **"QA Falhou"** (recusado/sugerido).

---

## Modelos do banco (prisma/schema.prisma)

- **QATask** — task em QA. Campos: asanaId, title, description, previewUrl, assignee,
  status (`in_qa`/`approved`/`rejected`/`suggested`/`pending`), projectName,
  wasRejectedBefore, wasSuggestedBefore, createdAt, updatedAt
- **QACheck** — item do checklist (label, checked) ligado à QATask
- **QAComment** — histórico de comentários local (type `rejected`|`suggested`, text) ligado à QATask
- **QAEvent** — registro PERMANENTE de cada ação para os gráficos.
  Campos: asanaId, action, projectName, assignee, wasFirstApproval, createdAt.
  NÃO deletado quando a task some — stats sobrevivem às 2 semanas de limpeza automática.
- **User** — name, email, password (bcrypt), totpSecret
- **ChatMessage** — histórico do chat de treinamento da IA (role, content)
- **AIKnowledge** — base de conhecimento. type (`skill`|`project`|`config`), name, content.
  Unique em `[type, name]`. `type:config, name:cerebras_api_key` guarda a key da IA.
- **AIReport** — relatório do agente de QA por task.
  Campos: taskId (unique), status (`queued`|`running`|`done`|`error`), report, **tokensUsed** (Int?)

> **DIRECT_URL (CRÍTICO para migrations):** `DATABASE_URL` porta 6543 (Transaction Pooler, runtime).
> `DIRECT_URL` porta 5432 (Session Pooler, migrations). Alternativa: `npx prisma db push`.

---

## Rotas do backend

### Públicas
- `POST /auth/register` — exige `registerSecret`, gera TOTP + QR code
- `POST /auth/login` — valida credenciais; cookie `trusted_device` pula TOTP
- `POST /auth/verify-totp` — valida código TOTP, retorna JWT 30d + cookie `trusted_device`
- `POST /webhook` — recebe eventos do Asana

### Protegidas (Bearer JWT)
- `GET /tasks` — lista tasks
- `GET /tasks/:id` — busca task com checks + mockupUrl + testUrl
- `GET /tasks/:id/comments` — histórico de comentários
- `GET /tasks/:id/attachments` — screenshots via Asana API
- `POST /tasks/:id/approve|reject|suggest` — ações QA
- `GET /stats?period=7d|30d|6m` — dados dos gráficos
- `POST /admin/setup-webhooks` — re-registra webhooks (deleta inativos/URL errada antes)
- `DELETE /admin/clear-test-data` — apaga tasks, checks, comentários e eventos
- `GET /chat/history`, `POST /chat/message`, `DELETE /chat/history` — chat de treinamento
- `GET /knowledge`, `POST /knowledge`, `PUT /knowledge/:id`, `DELETE /knowledge/:id` — base de conhecimento
- `GET /tasks/:id/ai-report` — relatório atual do agente
- `POST /tasks/:id/run-ai-qa` — enfileira análise (`status='queued'`) — **NÃO chama Python diretamente**
- `DELETE /tasks/:id/ai-report` — limpa relatório travado
- `GET /settings/ai` — config da IA (key mascarada + tokens usados hoje)
- `POST /settings/ai` — salva Cerebras key no banco (`type:config`)
- `DELETE /settings/ai` — remove key
- `GET /qa-jobs/pending` — **Pull model:** worker busca próximo job na fila
- `POST /qa-jobs/:taskId/claim` — worker reivindica job (queued → running), atômico
- `POST /qa-jobs/:taskId/result` — worker posta resultado (status, report, tokensUsed)

---

## Agente de QA Automatizado — Pull Model (pasta qa-agent/)

### Arquitetura (Pull Model — sem ngrok)

```
Analista clica "Executar análise" no frontend (Vercel)
    ↓
Backend (Render) salva AIReport{status:'queued'} → responde imediatamente
    ↓
worker.py (local) → GET /qa-jobs/pending a cada 5s → pega o job
    ↓
POST /qa-jobs/:id/claim (queued → running)
    ↓
agent.py abre Chromium → testa → retorna resultado
    ↓
POST /qa-jobs/:id/result → salva no banco
    ↓
Frontend polling /ai-report a cada 4s → exibe relatório
```

**Vantagem:** sem ngrok, sem servidor exposto. O agente sempre inicia a conexão.

### Arquivos qa-agent/

| Arquivo | Descrição |
|---------|-----------|
| `worker.py` | **Principal.** Login terminal + loop de jobs (Pull model). Substituiu main.py. |
| `session.py` | Criptografia DPAPI Windows: JWT + Cerebras key salvos em `%APPDATA%\NocorpQA\session.dat`. Inútil fora da máquina/conta do usuário. |
| `agent.py` | Lógica browser-use: BrowserUseLLM wrapper, convert_messages, build_task, run_qa_agent, contador de tokens. |
| `main.py` | FastAPI antigo (HTTP server). Mantido para compatibilidade mas NÃO é mais usado no fluxo principal. |
| `version.txt` | Versão atual (1.0.0). Worker verifica ao iniciar e avisa se há atualização. |
| `install.ps1` | Instalador one-line. Baixa tudo do GitHub, instala Python/venv/deps/Chromium, cria atalho. |
| `setup.bat` | Setup inicial manual (para quem não quiser o PowerShell one-liner). |
| `start.bat` | Inicia `worker.py`. |
| `requirements.txt` | `browser-use==0.12.9`, `langchain-groq`, `langchain-ollama`, `langchain-openai`, `langchain-core`, `fastapi`, `uvicorn`, `python-dotenv`, `httpx`. |
| `venv/` | NÃO commitar. Criado pelo setup/install. |
| `.env` | NÃO commitar. `BACKEND_URL`, `AI_PROVIDER`, `CEREBRAS_API_KEY`, `CEREBRAS_MODEL`, `MAX_STEPS`, etc. |

### Instalação para novos analistas (one-line)

```powershell
irm https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/install.ps1 | iex
```

Faz tudo: Python, venv, deps, Chromium, atalho na área de trabalho.

### Fluxo de primeiro uso (terminal)

```
Email: bernardo@nocorp.io
Senha: ••••••••
Código do autenticador: 123456
✅ Login realizado — sessão válida 30 dias (salva criptografada com DPAPI)

Cole sua Cerebras API key (csk-...): csk-xxx
✅ Chave salva com segurança

👂 Aguardando análises...
```

Da próxima vez só abre o atalho — sessão restaurada automaticamente.

### Segurança da sessão local

- **JWT** salvo em `%APPDATA%\NocorpQA\session.dat` — criptografado com DPAPI Windows
- **Cerebras API key** salva no mesmo arquivo — criptografada com DPAPI
- DPAPI atrela a criptografia à conta Windows: arquivo é inútil em outro PC ou conta
- A key NUNCA é enviada para o backend — usada apenas localmente pelo agente

### Multi-provider LLM

Configurado via `AI_PROVIDER` no `.env`:

| Provider | Modelo | Limite | Uso |
|----------|--------|--------|-----|
| `cerebras` | gpt-oss-120b / zai-glm-4.7 | 1M tokens/dia grátis | **Padrão** |
| `groq` | llama-3.3-70b-versatile | 100K tokens/dia grátis | Fallback |
| `deepseek` | deepseek-reasoner | ~$0.10/teste (pago) | Opcional |
| `ollama` | qualquer modelo local | ilimitado | Requer hardware |

**Fallback automático de modelo:** se `gpt-oss-120b` retornar 429 (fila sobrecarregada),
`BrowserUseLLM` troca automaticamente para `zai-glm-4.7` sem reiniciar.

### Config do Agent (browser-use 0.12.9)

```python
Agent(
    use_vision=False,        # DOM-based — Groq/Cerebras sem visão
    flash_mode=True,         # schema reduzido (só memory+action)
    use_thinking=False,      # remove campo thinking
    max_actions_per_step=3,
    max_failures=3,          # para após 3 falhas consecutivas (429s tratados no wrapper)
    initial_actions=[{'navigate': {'url': preview_url}}],  # abre URL 1x antes do loop
)
```

Prompt **proíbe** a ação `navigate` durante o loop (evita re-navegação em loop infinito).

### Contagem de tokens (terminal)

A cada step do agente aparece no terminal:
```
[Tokens] Step  1 | step:   5842 (in:5600 out:242) | total:    5842 | limite diário: 0.6% usado
[Tokens] Step  2 | ...
[Tokens] 📊 RESUMO FINAL
[Tokens]    TOTAL: 61.300 | Limite diário: 6.13% de 1.000.000
```

`tokensUsed` é salvo no AIReport ao final. Settings mostra barra de consumo diário.

---

## Chat de Treinamento da IA

- Página `/chat`. Conversa com Groq para treinar padrões de QA da Nocorp.
- System prompt: base fixo + skills + projetos da AIKnowledge injetados dinamicamente.
- Histórico persiste no banco (ChatMessage).

## Base de Conhecimento (Settings)

- **🧠 Skills da IA** — instruções gerais de comportamento. `type:skill`.
- **📚 Base de Conhecimento** — contexto por projeto. `type:project`.
- Injetado automaticamente no Chat E no Agente de QA.

## Configuração de IA (Settings → 🧠)

- Campo para inserir Cerebras API key (salva no banco como `type:config`)
- Barra de uso de tokens diário (lê soma de `tokensUsed` dos AIReports de hoje)
- A key do banco é passada ao worker no payload do job e tem prioridade sobre `.env`

---

## Frontend (src/)

- **App.jsx** — rotas: `/login`, `/register` públicas; demais protegidas.
- **Sidebar.jsx** — Tasks, Dashboard, Config, Chat, Sair.
- **Login.jsx** — 2 passos: credenciais → TOTP. Cookie `trusted_device` pula TOTP.
- **Dashboard.jsx** — lista de tasks, filtros, badge `↩ Nx`, auto-refresh 30s.
- **DashboardStats.jsx** — analytics (pizza, cards, por projeto, por dev).
- **Settings.jsx** — webhooks + skills + base de conhecimento + **🧠 config de IA** (key + tokens).
- **QAReview.jsx** — checklist, screenshots, ações QA, card de análise de IA.
  - Status `queued` → "na fila — abra o QA Agent" (amarelo)
  - Status `running` → "analisando..." (roxo + dots)
  - Status `done` → relatório + botão Re-analisar
  - Botão **✕ Cancelar** quando queued/running (DELETE ai-report)
- **Chat.jsx** — chat de treinamento com markdown, starter prompts, indicador de digitação.

---

## Armadilhas conhecidas

- **Render Free dorme:** após 15 min → primeira req do dia demora ~30s para acordar
- **Prisma no Render:** `postinstall: prisma generate` no package.json + binaryTargets com rhel no schema
- **SDK do Asana** dá `hasOwnProperty` errors → sempre usar `fetch` direto
- **Stats:** sempre incluir `asanaId` no select do Prisma — sem ele tudo colapsa em `byTask[undefined]`
- **CORS com cookies:** `credentials: true` no Express + `credentials: 'include'` nos fetches
- **OneDrive + Prisma:** pode dar EPERM no generate — ignorar, não afeta migrations
- **localhost vs 127.0.0.1:** Node resolve localhost como IPv6 (`::1`) → usar `127.0.0.1` explícito
- **browser-use 0.12+ mensagens próprias:** `convert_messages()` converte BU → LangChain (CRÍTICO)
- **Groq 100K tokens/dia:** um teste completo (25 steps × ~6K tokens) = 150K → excede o limite
- **Cerebras rejeita `min_items` no JSON Schema:** `with_structured_output` com `method="function_calling"` + `_clean_schema()` remove campos inválidos. `json_mode` não funciona porque modelo gera nomes de campos errados e Pydantic falha.
- **Cerebras 429 queue_exceeded:** `gpt-oss-120b` fica sobrecarregado → fallback automático para `zai-glm-4.7`
- **Agente loop de navegação:** ação `navigate` termina a sequência e o agente re-navega. Proibir no prompt + `initial_actions` para abrir URL antes.
- **flash_mode obrigatório:** sem ele Groq/Cerebras omitem campos do tool call → `missing properties: evaluation_previous_goal, memory, next_goal`
- **Chromium abre em about:blank:** sem `initial_actions` e sem `navigate` a URL nunca abre.
- **max_failures=1 muito agressivo:** page readiness timeout conta como falha → agente para antes de agir. Usar 3.
- **DPAPI:** só funciona no Windows. Para outros SOs seria necessário implementar `keyring` do Python.
- **Repo privado + install.ps1:** `raw.githubusercontent.com` exige autenticação para repos privados → manter repo público OU usar GitHub Releases.

---

## Próximos passos

- [x] Chat de treinamento da IA (Groq) — FEITO
- [x] Base de conhecimento (skills + projetos) — FEITO
- [x] Agente de QA automatizado (browser-use + Python) — FEITO
- [x] Multi-provider LLM (Cerebras, Groq, DeepSeek, Ollama) — FEITO
- [x] Pull model (sem ngrok, sem servidor exposto) — FEITO
- [x] Login via terminal + sessão criptografada DPAPI — FEITO
- [x] Contador de tokens (por step + diário + Settings) — FEITO
- [x] Instalador one-line PowerShell — FEITO
- [x] Deploy backend no Render — FEITO
- [x] Deploy frontend no Vercel — FEITO
- [ ] Testar fluxo completo end-to-end (worker → job → Chromium → relatório)
- [ ] Sistema de auto-update (worker verifica version.txt e baixa arquivos novos)
- [ ] Preencher base de conhecimento com projetos reais (deskone.com.br/helpcenter)
- [ ] Página de Conta (perfil do usuário, trocar senha)
- [ ] Vision no agente (para sites que precisam de comparação visual)
- [ ] Fase 2 — time interno com Next.js + NestJS
