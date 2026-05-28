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

## O que já foi feito ✅

### Backend (backend/)
- Express rodando na porta 3001
- Prisma conectado ao Supabase
- Tabelas criadas: QATask, QACheck
- Rotas:
  - GET /tasks — lista todas as tasks
  - GET /tasks/:id — busca task por ID
  - POST /webhook — recebe eventos do Asana
  - POST /tasks/:id/approve — aprova task e muda status no Asana para "Feito"
  - POST /tasks/:id/reject — reprova task, comenta no Asana e muda status para "Em Correção"
- Serviços (src/services/):
  - asana.js: getTask, addComment, getPreviewUrl, updateStatusByName
  - parser.js: extrairRequisitos — extrai Critérios de Aceitação da descrição

### Frontend (frontend/)
- React + Vite + Tailwind + Shadcn/ui configurados
- React Router com duas rotas: / e /review/:id
- Dashboard: lista tasks com status, responsável e progresso dos checks
- QAReview: checklist interativo, informações da task, botão de preview, aprovar e reprovar
- Reprovar: abre campo de comentário, monta mensagem com itens pendentes e envia ao Asana

### Fluxo completo funcionando:
1. Task muda status no Asana → webhook dispara
2. Backend valida campos obrigatórios (Título, Descrição, Prioridade, Complexidade, Tipo, Início)
3. Parser extrai Critérios de Aceitação e cria QAChecks no banco
4. Dashboard exibe a task
5. QAer abre a task, marca os checks e aprova ou reprova
6. Asana é atualizado automaticamente

---

## Próximos passos

### Passo 9 — Validação automática com comentário no Asana
- [ ] Quando webhook chegar com campos faltando, comentar automaticamente na task e devolver pro dev (hoje só faz console.log)

### Passo 10 — Melhorias de UX
- [ ] Loading nos botões Aprovar/Reprovar (evitar double click)
- [ ] Tratamento de erro de rede no frontend
- [ ] Status em português no Dashboard e QAReview
- [ ] Filtro por status no Dashboard (Pendente / Aprovado / Reprovado)

### Passo 11 — Autenticação
- [ ] Login simples com usuário/senha e JWT
- [ ] Proteger rotas do frontend

### Passo 12 — Deploy
- [ ] Backend: Railway ou Render
- [ ] Frontend: Vercel ou Netlify
- [ ] Trocar ngrok pela URL de produção no webhook Asana

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
- SDK do Asana tem problemas com algumas chamadas — usar fetch direto quando der erro de hasOwnProperty
- Webhook registrado no projeto "QA Teste" (GID: 1215200946967290), workspace GID: 1215181860219671
- Campos obrigatórios validados: Título, Descrição, Prioridade, Complexidade, Tipo, Início
- Link de preview vem nos comentários da task com o formato "Link para QA: https://..."
