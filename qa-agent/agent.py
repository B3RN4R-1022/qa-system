import os
import copy
import time
import asyncio
import logging
from browser_use.agent.service import Agent
from browser_use.browser.profile import BrowserProfile
from browser_use.browser.session import BrowserSession
from browser_use.llm.messages import SystemMessage as BUSystemMessage, UserMessage as BUUserMessage, AssistantMessage as BUAssistantMessage
from langchain_core.messages import SystemMessage as LCSystemMessage, HumanMessage, AIMessage

# ─── Timing log ───────────────────────────────────────────────────────────────
# Log separado para analisar o que está demorando: LLM vs ações do browser
_TIMING_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'timing.log')

def _write_timing(msg: str):
    """Appenda uma linha ao timing.log — log separado de performance."""
    try:
        with open(_TIMING_LOG_PATH, 'a', encoding='utf-8') as _f:
            _f.write(msg + '\n')
    except Exception:
        pass


# Campos de JSON Schema não suportados por alguns providers (Cerebras, etc.)
_SCHEMA_UNSUPPORTED = frozenset({'min_items', 'max_items', 'uniqueItems', 'exclusiveMinimum', 'exclusiveMaximum'})

def _clean_schema(obj):
    """Remove campos de JSON Schema não suportados por alguns providers."""
    if isinstance(obj, dict):
        return {k: _clean_schema(v) for k, v in obj.items() if k not in _SCHEMA_UNSUPPORTED}
    elif isinstance(obj, list):
        return [_clean_schema(item) for item in obj]
    return obj


# Mapeamento de nomes de ação que o LLM usa (treinamento antigo) → nome real no browser-use 0.12+
# O LLM gera "input_text" mas a ação foi renomeada para "input" no browser-use 0.12.9
_ACTION_ALIASES: dict[str, str] = {
    'input_text': 'input',
    'type_text':  'input',
    'fill':       'input',
}

# Renomeia parâmetros de ações específicas (LLM usa "element_index" mas o campo real é "index")
_PARAM_ALIASES: dict[str, dict[str, str]] = {
    'input': {'element_index': 'index'},
}


def _fix_action_args(args: dict) -> dict:
    """
    Corrige nomes de ação e de parâmetros antes da validação Pydantic.

    Problema: o LLM (treinado em exemplos antigos do browser-use) gera:
      {"action": [{"input_text": {"element_index": 8, "text": "..."}}]}

    Mas browser-use 0.12.9 espera:
      {"action": [{"input": {"index": 8, "text": "..."}}]}

    Sem esta correção, Pydantic gera ~150 ValidationErrors tentando encaixar
    a ação em cada modelo do union AgentOutput.
    """
    if 'action' not in args:
        return args

    import copy
    result = copy.deepcopy(args)
    fixed_actions = []

    for action_dict in result.get('action', []):
        if not isinstance(action_dict, dict):
            fixed_actions.append(action_dict)
            continue

        new_dict = {}
        for key, val in action_dict.items():
            # 1. Corrige nome da ação (ex: input_text → input)
            real_key = _ACTION_ALIASES.get(key, key)

            # 2. Corrige nomes de parâmetros dentro da ação
            if isinstance(val, dict) and real_key in _PARAM_ALIASES:
                param_map = _PARAM_ALIASES[real_key]
                val = {param_map.get(k, k): v for k, v in val.items()}

            new_dict[real_key] = val

        fixed_actions.append(new_dict)

    result['action'] = fixed_actions
    return result


async def _invoke_clean_function_calling(llm, output_format, messages):
    """
    Usa function_calling com schema limpo (sem min_items etc.).
    Retorna (response_bruto, parsed_model) para permitir tracking de tokens.
    """
    from langchain_core.utils.function_calling import convert_to_openai_tool

    raw_tool = convert_to_openai_tool(output_format)
    clean_tool = _clean_schema(copy.deepcopy(raw_tool))
    tool_name = raw_tool.get('function', {}).get('name', 'output')

    llm_bound = llm.bind_tools([clean_tool], tool_choice=tool_name)
    response = await llm_bound.ainvoke(messages)

    if hasattr(response, 'tool_calls') and response.tool_calls:
        args = response.tool_calls[0].get('args', {})
        # Corrige nomes de ação/parâmetro antes de validar (ex: input_text→input, element_index→index)
        args = _fix_action_args(args)
        return response, output_format.model_validate(args)

    raise ValueError(f"Cerebras não retornou tool_call. Conteúdo: {str(getattr(response, 'content', ''))[:200]}")


def convert_messages(messages):
    """Converte mensagens do browser-use para o formato LangChain"""
    lc_messages = []
    for msg in messages:
        if isinstance(msg, BUSystemMessage):
            lc_messages.append(LCSystemMessage(content=msg.text))
        elif isinstance(msg, BUUserMessage):
            if isinstance(msg.content, str):
                lc_messages.append(HumanMessage(content=msg.content))
            else:
                # Conteúdo com imagens — filtra para provedores sem visão
                content = []
                for part in msg.content:
                    if part.type == 'text':
                        content.append({"type": "text", "text": part.text})
                    elif part.type == 'image_url':
                        content.append({
                            "type": "image_url",
                            "image_url": {"url": part.image_url.url}
                        })
                lc_messages.append(HumanMessage(content=content))
        elif isinstance(msg, BUAssistantMessage):
            lc_messages.append(AIMessage(content=msg.text or ""))
        else:
            # Fallback: tenta converter pelo role
            role = getattr(msg, 'role', 'user')
            text = getattr(msg, 'text', str(msg))
            if role == 'system':
                lc_messages.append(LCSystemMessage(content=text))
            elif role == 'assistant':
                lc_messages.append(AIMessage(content=text))
            else:
                lc_messages.append(HumanMessage(content=text))
    return lc_messages


class _CompletionWrapper:
    """Wrapper que dá .completion e .usage ao resultado do structured output"""
    def __init__(self, completion):
        self.completion = completion
        self.usage = None


class BrowserUseLLM:
    """
    Wrapper compatível com browser-use 0.12+ para qualquer LangChain LLM.

    Browser-use 0.12+ chama:
        response = await llm.ainvoke(messages, output_format=AgentOutput)
        parsed = response.completion

    Mas LangChain retorna AIMessage (sem .completion).
    Este wrapper:
    1. Converte mensagens browser-use → LangChain
    2. Intercepta output_format e usa with_structured_output
    3. Retorna _CompletionWrapper com .completion
    """

    def __init__(self, llm, provider_override=None, fallback_llm=None):
        self._llm = llm
        self._fallback_llm = fallback_llm
        self._using_fallback = False
        self.provider = provider_override or getattr(llm, 'provider', 'local')
        self.model = getattr(llm, 'model', getattr(llm, 'model_name', 'unknown'))
        # Contadores de tokens
        self._step = 0
        self._tokens_in  = 0
        self._tokens_out = 0
        self._tokens_total = 0
        # Contadores de timing (segundos)
        self._t_last_step_end  = time.time()  # para calcular tempo browser entre steps
        self._total_llm_s      = 0.0          # tempo total em chamadas LLM
        self._total_browser_s  = 0.0          # tempo total em ações do browser

    @property
    def model_name(self):
        return self.model

    def _track_usage(self, response):
        """Extrai e acumula uso de tokens da resposta LangChain."""
        inp = out = total = 0
        # usage_metadata (LangChain >= 0.2)
        um = getattr(response, 'usage_metadata', None)
        if um:
            inp   = getattr(um, 'input_tokens',  0) or um.get('input_tokens',  0) if isinstance(um, dict) else getattr(um, 'input_tokens',  0)
            out   = getattr(um, 'output_tokens', 0) or um.get('output_tokens', 0) if isinstance(um, dict) else getattr(um, 'output_tokens', 0)
            total = getattr(um, 'total_tokens',  0) or um.get('total_tokens',  0) if isinstance(um, dict) else getattr(um, 'total_tokens',  0)
        else:
            # response_metadata (providers OpenAI-compat)
            rm = getattr(response, 'response_metadata', {}) or {}
            tu = rm.get('token_usage') or rm.get('usage') or {}
            inp   = tu.get('prompt_tokens',     tu.get('input_tokens',  0))
            out   = tu.get('completion_tokens', tu.get('output_tokens', 0))
            total = tu.get('total_tokens', inp + out)

        if total == 0 and (inp or out):
            total = inp + out

        self._tokens_in    += inp
        self._tokens_out   += out
        self._tokens_total += total
        self._step         += 1

        limit_day = 1_000_000  # Cerebras free tier
        pct = (self._tokens_total / limit_day * 100) if limit_day else 0

        print(
            f"[Tokens] Step {self._step:>2} | "
            f"step: {total:>6} (in:{inp} out:{out}) | "
            f"total: {self._tokens_total:>7} | "
            f"limite diário: {pct:.1f}% usado"
        )

    async def ainvoke(self, messages, output_format=None, **kwargs):
        kwargs.pop('session_id', None)
        _t0    = time.time()
        _gap   = _t0 - self._t_last_step_end  # tempo gasto pelo browser desde o último step
        print(f"[BrowserUseLLM] ainvoke | output_format={output_format is not None} | msgs={len(messages)}")

        try:
            if output_format is not None:
                lc_msgs = convert_messages(messages)

                async def _invoke_structured(llm):
                    if self.provider == 'cerebras':
                        # Cerebras: function_calling com schema limpo + captura usage da resposta bruta
                        raw, parsed = await _invoke_clean_function_calling(llm, output_format, lc_msgs)
                        self._track_usage(raw)
                        return parsed
                    # Outros providers: function_calling padrão com include_raw para capturar usage
                    structured = llm.with_structured_output(output_format, include_raw=True)
                    raw_result = await structured.ainvoke(lc_msgs)
                    self._track_usage(raw_result.get('raw'))
                    return raw_result['parsed']

                try:
                    result = await _invoke_structured(self._llm)
                    print(f"[BrowserUseLLM] structured OK → type={type(result).__name__}")
                    return _CompletionWrapper(completion=result)

                except Exception as e:
                    err_str = str(e)
                    is_rate_limit = '429' in err_str or 'queue_exceeded' in err_str or 'too_many_requests' in err_str

                    # 429 → troca para modelo fallback automaticamente
                    if is_rate_limit and self._fallback_llm and not self._using_fallback:
                        print(f"[BrowserUseLLM] 429 → trocando para modelo fallback")
                        self._llm = self._fallback_llm
                        self._using_fallback = True
                        self.model = getattr(self._fallback_llm, 'model', 'fallback')
                        result = await _invoke_structured(self._llm)
                        print(f"[BrowserUseLLM] fallback OK → type={type(result).__name__}")
                        return _CompletionWrapper(completion=result)

                    # Schema incompatível ou Pydantic ValidationError (ex: LLM gerou ação com
                    # formato antigo usando 'index' em vez do campo atual do browser-use) →
                    # tenta de novo com function_calling e schema limpo
                    is_schema_error = (
                        'min_items'        in err_str or
                        'wrong_api_format' in err_str or
                        'validation error' in err_str.lower()  # pydantic ValidationError
                    )
                    if is_schema_error and not is_rate_limit:
                        print(f"[BrowserUseLLM] Schema/ValidationError → retentando com function_calling limpo")
                        try:
                            raw, parsed = await _invoke_clean_function_calling(self._llm, output_format, lc_msgs)
                            self._track_usage(raw)
                            print(f"[BrowserUseLLM] function_calling limpo OK → type={type(parsed).__name__}")
                            return _CompletionWrapper(completion=parsed)
                        except Exception as e2:
                            print(f"[BrowserUseLLM] function_calling limpo também falhou → {type(e2).__name__}: {e2}")
                            raise e2

                    print(f"[BrowserUseLLM] structured FALHOU → {type(e).__name__}: {e}")
                    raise
            else:
                lc_msgs = convert_messages(messages) if messages else messages
                return await self._llm.ainvoke(lc_msgs, **kwargs)
        finally:
            # ── Timing: registra duração desta chamada LLM e tempo de browser entre steps
            _t1 = time.time()
            _llm_s = _t1 - _t0
            self._t_last_step_end   = _t1
            self._total_llm_s      += _llm_s
            self._total_browser_s  += _gap
            _timing = (
                f"[TIMING] Step {self._step:>2} | "
                f"LLM: {_llm_s:.1f}s | "
                f"Browser: {_gap:.1f}s"
            )
            print(_timing)
            _write_timing(_timing)

    def with_structured_output(self, schema, **kwargs):
        return self._llm.with_structured_output(schema, **kwargs)

    def bind_tools(self, *args, **kwargs):
        return self._llm.bind_tools(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._llm, name)

    def __setattr__(self, name, value):
        if name.startswith('_') or name in ('provider', 'model'):
            object.__setattr__(self, name, value)
        else:
            object.__setattr__(self, name, value)


def build_llm(cerebras_api_key: str = None):
    """
    Cria o LLM conforme AI_PROVIDER no .env:
      - cerebras   → gpt-oss-120b grátis, 1M tokens/dia, 3000 tok/s (rate limit ~1 req/min)
      - sambanova  → Llama-3.3-70B grátis, $5 crédito, sem fila de 60s
      - deepseek   → DeepSeek-R1 via API (~$0.10/teste, requer saldo)
      - ollama     → local, ILIMITADO (requer hardware adequado)
      - groq       → cloud grátis, 100K tokens/dia (~1-2 testes/dia)
    """
    provider = os.getenv("AI_PROVIDER", "groq").lower().strip()

    if provider == "sambanova":
        from langchain_openai import ChatOpenAI
        # cerebras_api_key reutilizado como parâmetro genérico "llm_key" — contém a chave SambaNova
        api_key = cerebras_api_key or os.getenv("SAMBANOVA_API_KEY")
        if not api_key:
            raise ValueError("SAMBANOVA_API_KEY não configurada. Adicione no .env do qa-agent")
        model         = os.getenv("SAMBANOVA_MODEL", "Meta-Llama-3.3-70B-Instruct")
        fallback_model = "Meta-Llama-3.1-8B-Instruct" if "70B" in model else "Meta-Llama-3.3-70B-Instruct"
        print(f"[QA Agent] ⚡ Usando SambaNova — modelo: {model} | fallback: {fallback_model}")
        base_llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url="https://api.sambanova.ai/v1",
            temperature=0.1,
        )
        fallback_llm = ChatOpenAI(
            model=fallback_model,
            api_key=api_key,
            base_url="https://api.sambanova.ai/v1",
            temperature=0.1,
        )
        # provider_override="cerebras" → reutiliza a lógica de function_calling limpo do Cerebras
        # (SambaNova usa a mesma API OpenAI-compatible e responde igual ao Cerebras)
        return BrowserUseLLM(base_llm, provider_override="cerebras", fallback_llm=fallback_llm), model

    elif provider == "cerebras":
        from langchain_openai import ChatOpenAI
        # Prioridade: key passada pelo usuário via Settings > .env
        api_key = cerebras_api_key or os.getenv("CEREBRAS_API_KEY")
        if not api_key:
            raise ValueError("CEREBRAS_API_KEY não configurada. Adicione nas Configurações do QA System ou no .env do qa-agent")
        # gpt-oss-120b: 3000 tok/s, gratuito, disponível no plano free Cerebras
        # zai-glm-4.7: fallback gratuito, mais lento mas confiável
        model = os.getenv("CEREBRAS_MODEL", "gpt-oss-120b")
        # Proteção: modelos que já sabemos que NÃO existem no free tier
        # (podem estar no .env de versões antigas do worker)
        _UNAVAILABLE = {'llama3.1-8b', 'llama3.3-70b', 'llama-3.3-70b', 'llama-3.1-8b', 'llama3.1-70b', 'llama-3.1-70b'}
        if model in _UNAVAILABLE:
            print(f"[QA Agent] ⚠️  Modelo '{model}' não está no free tier → forçando gpt-oss-120b")
            model = 'gpt-oss-120b'
        fallback_model = "zai-glm-4.7" if model != "zai-glm-4.7" else "gpt-oss-120b"
        print(f"[QA Agent] ⚡ Usando Cerebras — modelo: {model} | fallback: {fallback_model}")
        base_llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url="https://api.cerebras.ai/v1",
            temperature=0.1,
        )
        fallback_llm = ChatOpenAI(
            model=fallback_model,
            api_key=api_key,
            base_url="https://api.cerebras.ai/v1",
            temperature=0.1,
        )
        return BrowserUseLLM(base_llm, provider_override="cerebras", fallback_llm=fallback_llm), model

    elif provider == "deepseek":
        from langchain_openai import ChatOpenAI
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise ValueError("DEEPSEEK_API_KEY não configurada no .env do qa-agent")
        model = os.getenv("DEEPSEEK_MODEL", "deepseek-reasoner")
        print(f"[QA Agent] 🧠 Usando DeepSeek R1 — modelo: {model} (~$0.10/teste)")
        base_llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url="https://api.deepseek.com",
            temperature=0,
        )
        return BrowserUseLLM(base_llm, provider_override="deepseek"), model

    elif provider == "ollama":
        from langchain_ollama import ChatOllama
        model = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
        base_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        print(f"[QA Agent] 🦙 Usando Ollama local — modelo: {model} (ILIMITADO)")
        base_llm = ChatOllama(
            model=model,
            base_url=base_url,
            temperature=0.1,
        )
        return BrowserUseLLM(base_llm, provider_override="ollama"), model

    else:  # groq (default)
        from langchain_groq import ChatGroq
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY não configurada no .env do qa-agent")
        model = "llama-3.3-70b-versatile"
        print(f"[QA Agent] ☁️  Usando Groq — modelo: {model} (limite: 100K tokens/dia)")
        base_llm = ChatGroq(
            model=model,
            api_key=groq_api_key,
            temperature=0.1,
        )
        return BrowserUseLLM(base_llm, provider_override="groq"), model


MAX_TASK_CHARS = 95_000   # browser-use hard limit é 100k; folga de 5k
MAX_CODE_CHARS = 40_000   # máx para código-fonte no prompt
MAX_MAP_CHARS  = 30_000   # máx para sitemap no prompt


def build_task(title: str, preview_url: str, criteria: list, project_name: str, knowledge: str, skills: str, description: str = "", site_cache: str = None, code_context: str = None, site_map: str = None, max_steps: int = 15, tool_call_titles: list = None, login_email: str = None, login_password: str = None) -> str:
    # Trunca seções variáveis grandes antes de montar o prompt
    # para não estourar o limite de 100k chars do browser-use
    _code = code_context
    _map  = site_map
    if _code and len(_code) > MAX_CODE_CHARS:
        _code = _code[:MAX_CODE_CHARS] + "\n\n...[código truncado — contexto parcial, foque nos critérios de aceitação]"
        print(f"[build_task] ⚠️  code_context truncado para {MAX_CODE_CHARS} chars")
    if _map and len(_map) > MAX_MAP_CHARS:
        _map = _map[:MAX_MAP_CHARS] + "\n\n...[mapa do site truncado — use as páginas listadas até aqui]"
        print(f"[build_task] ⚠️  site_map truncado para {MAX_MAP_CHARS} chars")

    criteria_text = "\n".join(f"- {c}" for c in criteria) if criteria else "- Verificar funcionamento geral da funcionalidade"

    description_section = (
        f"## Descrição e Requisitos da Funcionalidade\n"
        f"Use este contexto para entender O QUE foi implementado e O QUE deve ser testado:\n{description}"
    ) if description else ""

    skills_section = f"## Instruções gerais de QA\n{skills}" if skills else ""
    knowledge_section = f"## Base de conhecimento do projeto {project_name}\n{knowledge}" if knowledge else ""

    # Seção de mapa Wix Velo — guia de navegação completo do site
    site_map_section = ""
    if _map:
        site_map_section = f"""## MAPA DO SITE (use para navegar diretamente — não explore do zero)
Este site foi mapeado previamente. Você já sabe quais páginas existem, quais formulários há em cada uma,
quais botões estão disponíveis e como é a navegação. Use este mapa para ir direto ao ponto.

{_map}
"""

    # Seção de conhecimento do projeto — tool calls têm prioridade sobre o resumo bruto
    # Tool calls: índice compacto + agent busca detalhes sob demanda (search_project_tools)
    # Fallback: resumo QA gerado pelo Cerebras (40k chars) quando não há tool calls
    code_section = ""
    if tool_call_titles and len(tool_call_titles) > 0:
        _titles_text = "\n".join(f"  {t}" for t in tool_call_titles[:100])
        code_section = f"""## KNOWLEDGE BASE DO PROJETO — {len(tool_call_titles)} funcionalidades mapeadas
Use a ação **search_project_tools(query)** para buscar detalhes de qualquer funcionalidade antes de agir.
💡 Exemplos de uso:
  search_project_tools("login")       → retorna fluxo de autenticação, campos, endpoint
  search_project_tools("criar produto") → retorna formulário, validações, comportamento esperado
Para projetos Wix: use **save_project_tool(...)** para registrar funcionalidades descobertas durante o teste.

Funcionalidades disponíveis:
{_titles_text}
"""
    elif _code:
        code_section = f"""## ANÁLISE DO REPOSITÓRIO — resumo QA (use para guiar os testes)
Este resumo foi gerado automaticamente a partir do código-fonte. Use-o para:
- Saber quais rotas e funcionalidades existem (sem precisar explorar do zero)
- Entender o fluxo de autenticação e os formulários disponíveis
- Conhecer as regras de negócio que devem ser validadas nos testes
- Identificar endpoints de API relevantes

{_code}
"""

    # Seção de login — credenciais explícitas têm prioridade máxima sobre qualquer cache
    if login_email or login_password:
        _cred_lines = []
        if login_email:
            _cred_lines.append(f"- Use `input_text` no campo de email com: {login_email}")
        if login_password:
            _cred_lines.append(f"- Use `input_text` no campo de senha com: {login_password}")
        _cred_block = "\n".join(_cred_lines)
        login_step = f"""**PASSO 1 — LOGIN (a página de login já está carregada):**
- Olhe os elementos interativos disponíveis na página atual
{_cred_block}
- Use `click_element` no botão de login/entrar
- Aguarde o carregamento (NÃO navegue, apenas observe a próxima tela)
⚠️ Credenciais acima têm PRIORIDADE ABSOLUTA — ignore qualquer login diferente no cache ou na memória."""
    else:
        login_step = """**PASSO 1 — LOGIN (se a página exigir):**
- Olhe os elementos interativos disponíveis na página atual
- Use as credenciais fornecidas na descrição ou na base de conhecimento do projeto
- Use `click_element` no botão de login/entrar
- Aguarde o carregamento (NÃO navegue, apenas observe a próxima tela)"""

    # Seção de cache de site — se existir, a IA pula exploração já conhecida
    cache_section = ""
    if site_cache:
        cache_section = f"""## CONHECIMENTO PRÉVIO DESTE PROJETO ⚡ (use para economizar tempo)
Você já explorou este site antes. Use este mapa para ir direto ao ponto — não repita buscas já feitas:

{site_cache}

Com base nisso:
- Pule etapas de exploração que você já conhece (navegação, estrutura de menus, rotas)
- Vá diretamente à área relacionada ao teste atual
- Apenas verifique rapidamente se algo mudou nessas áreas já mapeadas
⚠️ Credenciais de login: SEMPRE use as do PASSO 1 abaixo — nunca use credenciais armazenadas no cache.
"""

    _prompt = f"""Você é um analista de QA testando o sistema da Nocorp.

Acesse esta URL e realize os testes: {preview_url}

## Task em teste
Título: {title}
Projeto: {project_name or 'Não informado'}

{description_section}

## Critérios de Aceitação para verificar
{criteria_text}

{skills_section}

{knowledge_section}

{site_map_section}

{code_section}

{cache_section}

## ORÇAMENTO DE STEPS — LEIA ANTES DE COMEÇAR
Você tem **{max_steps} steps** · cada step executa **até 5 ações** simultaneamente.
Planeje agrupando ações: ex. digitar email + senha + clicar login = **1 step**.
Referência:
- Login: ~1-2 steps  |  Navegação até a feature: ~1-2 steps
- Por critério: ~2-4 steps  |  Relatório final: ~1 step
Assim que tiver verificado TODOS os critérios, escreva o relatório e finalize com `done()`.
**Agrupe tudo que puder em cada step. Velocidade > cautela excessiva.**

## REGRA CRÍTICA — LEIA PRIMEIRO
🚫 **NUNCA use a ação `navigate`/`go_to_url`.** A página JÁ ESTÁ ABERTA na URL correta.
   Se você navegar, vai entrar em loop e falhar. Use APENAS ações que interagem com elementos
   da página atual: `input_text` (digitar), `click_element` (clicar), `scroll`, `upload_file`.

## SEGURANÇA DE CREDENCIAIS — OBRIGATÓRIO
🔐 Se você encontrar ou usar qualquer credencial durante o teste (senhas, tokens, códigos de acesso, dados pessoais):
- Use-as APENAS para executar a ação do teste atual
- **NUNCA as inclua no relatório final**
- **NUNCA as registre como observação ou aviso**
- Ao finalizar, descarte-as — não as repita em nenhuma parte do output
- Trate toda informação de autenticação como temporária e confidencial

## O que fazer passo a passo — SIGA EXATAMENTE ESTA ORDEM

{login_step}

**PASSO 2 — NAVEGUE ATÉ A FUNCIONALIDADE:**
- Confirme que o login funcionou (área interna carregada)
- Use os critérios de aceitação como guia para saber para onde ir
- Use `click_element` para navegar pelos menus, sidebar, abas ou links disponíveis
- Se tiver cache ou mapa do site, vá direto ao ponto — não explore do zero

**PASSO 3 — EXECUTE E VERIFIQUE CADA CRITÉRIO:**
- Teste cada critério listado, um a um
- Use `input_text` para preencher formulários com dados de teste realistas
- Use `upload_file` quando precisar enviar arquivos
- Agrupe ações consecutivas no mesmo step: ex. preencher 3 campos + clicar = 1 step

**LEMBRE-SE:** Você já está no site. Use apenas `click_element`, `input_text`, `scroll`, `upload_file`. NUNCA use `navigate`/`go_to_url`.

## Verificação de erros visíveis (faça antes de escrever o relatório)
- Procure na página por mensagens de erro visíveis (banners vermelhos, toasts, texto com "erro", "falha", "inválido")
- Verifique se há indicadores de falha de rede (timeouts, spinners travados, dados não carregados)
- Inclua qualquer erro encontrado na seção ⚠️ AVISOS do relatório

## Formato obrigatório do relatório final
Responda SEMPRE em português brasileiro com esta estrutura:

✅ APROVADOS:
- (liste o que funcionou)

❌ REPROVADOS:
- (liste o que falhou)

⚠️ AVISOS:
- (comportamentos diferentes do esperado mas não bloqueantes, inclua erros visíveis na página)

🏁 CONCLUSÃO: APROVADO | REPROVADO | SUGESTÃO DE ALTERAÇÃO

📝 OBSERVAÇÕES:
(detalhes adicionais importantes)

## ATUALIZAÇÃO DE CACHE — inclua SEMPRE ao final (o sistema usa para otimizar futuros testes)
Após o relatório acima, adicione exatamente esta seção com o que você aprendeu sobre o site:

🗃️ CACHE_UPDATE_START
{{
  "navigation": "estrutura de navegação que você usou (menus, sidebar, abas, rotas principais)",
  "loginFlow": "como fazer login: campos encontrados e como interagir (se havia login neste teste)",
  "knownRoutes": ["URLs que você visitou durante este teste"],
  "uiPatterns": "componentes e padrões visuais encontrados (cards, tabelas, modais, formulários, tema)",
  "notes": "qualquer informação útil para acelerar futuros testes neste projeto"
}}
🗃️ CACHE_UPDATE_END"""

    # Hard cap de segurança — nunca ultrapassa o limite do browser-use
    if len(_prompt) > MAX_TASK_CHARS:
        print(f"[build_task] ⚠️  prompt ainda longo ({len(_prompt)} chars) — cortando no hard cap")
        _prompt = _prompt[:MAX_TASK_CHARS]
    return _prompt


async def _attach_console_listeners(session, console_logs: list):
    """
    Background task: aguarda o browser iniciar e anexa listeners de console.
    Captura erros e warnings da página sem interferir no browser-use.
    """
    for _ in range(120):  # tenta por até 60s (120 × 0.5s)
        await asyncio.sleep(0.5)
        try:
            ctx = (
                getattr(session, 'browser_context', None) or
                getattr(session, 'context', None) or
                getattr(session, '_browser_context', None)
            )
            if ctx is None:
                continue

            def _on_console(msg):
                if msg.type in ('error', 'warning'):
                    console_logs.append({'type': msg.type, 'text': msg.text})

            def _on_page_error(err):
                console_logs.append({'type': 'pageerror', 'text': str(err)})

            def _on_new_page(page):
                page.on('console', _on_console)
                page.on('pageerror', _on_page_error)

            # Páginas já abertas
            for page in (ctx.pages or []):
                page.on('console', _on_console)
                page.on('pageerror', _on_page_error)

            # Novas páginas que abrirem durante o teste
            ctx.on('page', _on_new_page)
            return  # listeners annexados com sucesso

        except asyncio.CancelledError:
            raise
        except Exception:
            pass  # browser ainda não iniciou — tenta de novo


async def run_qa_agent(
    title: str,
    preview_url: str,
    criteria: list = [],
    project_name: str = "",
    knowledge: str = "",
    skills: str = "",
    description: str = "",
    headless: bool = False,
    max_steps: int = None,
    cerebras_api_key: str = None,
    site_cache: str = None,
    code_context: str = None,
    site_map: str = None,
    _external_session=None,          # sessão externa — não cria nem fecha o browser
    _no_initial_navigate: bool = False,  # pula navegação inicial (retry com mesmo browser)
    step_extension_callback=None,    # async fn() -> int|None — pergunta mais steps ao analista
    controller=None,                 # Controller do browser-use com tool calls personalizados
    tool_call_titles: list = None,   # índice da knowledge base (substitui code_context no prompt)
    login_email: str = None,         # email de login para este teste (prioridade sobre cache)
    login_password: str = None,      # senha de login para este teste (prioridade sobre cache)
) -> dict:
    import tempfile, shutil

    if max_steps is None:
        max_steps = int(os.getenv("MAX_STEPS", "15"))

    # ── Cabeçalho no timing.log ──────────────────────────────────────────
    _t_test_start = time.time()
    _ts = time.strftime('%Y-%m-%d %H:%M:%S')
    _timing_header = (
        f"\n{'='*62}\n"
        f"[TIMING] TESTE : {title}\n"
        f"[TIMING] Início: {_ts} | max_steps={max_steps}"
    )
    print(_timing_header)
    _write_timing(_timing_header)

    llm, model_name = build_llm(cerebras_api_key=cerebras_api_key)

    # Sessão do browser — cria uma nova ou reutiliza uma externa (para retries sem fechar o browser)
    if _external_session is not None:
        temp_profile_dir = None   # não gerenciado aqui
        session = _external_session
    else:
        # Diretório temporário isolado — cookies/localStorage descartados ao final
        temp_profile_dir = tempfile.mkdtemp(prefix='nocorp_qa_')
        session = BrowserSession(
            browser_profile=BrowserProfile(headless=headless, user_data_dir=temp_profile_dir)
        )

    # tool_call_titles só vai para o prompt se o controller está disponível —
    # sem controller, o agente não tem a ação search_project_tools para chamar
    # e veria títulos sem poder buscar detalhes. Nesse caso usa code_context como fallback.
    _effective_titles = tool_call_titles if controller is not None else None
    task_text = build_task(title, preview_url, criteria, project_name, knowledge, skills, description, site_cache=site_cache, code_context=code_context, site_map=site_map, max_steps=max_steps, tool_call_titles=_effective_titles, login_email=login_email, login_password=login_password)

    # Imagens disponíveis para o agente fazer upload quando necessário
    import glob as _glob
    image_paths = []
    for pattern in [
        os.path.expanduser("~/Pictures/*.png"),
        os.path.expanduser("~/Pictures/*.jpg"),
        os.path.expanduser("~/Desktop/*.png"),
        os.path.expanduser("~/Desktop/*.jpg"),
        os.path.join(os.path.dirname(__file__), "*.png"),
        os.path.join(os.path.dirname(__file__), "*.jpg"),
    ]:
        image_paths.extend(_glob.glob(pattern))

    # Garante pelo menos um arquivo disponível
    dummy_path = os.path.join(os.path.dirname(__file__), "dummy.png")
    if not os.path.exists(dummy_path):
        # Cria um PNG mínimo válido (1x1 pixel branco)
        import struct, zlib
        def _make_png():
            sig = b'\x89PNG\r\n\x1a\n'
            ihdr = b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
            idat_data = zlib.compress(b'\x00\xff\xff\xff')
            idat = struct.pack('>I', len(idat_data)) + b'IDAT' + idat_data + struct.pack('>I', zlib.crc32(b'IDAT' + idat_data) & 0xffffffff)
            iend = b'\x00\x00\x00\x00IEND\xaeB`\x82'
            return sig + ihdr + idat + iend
        with open(dummy_path, 'wb') as f:
            f.write(_make_png())
    image_paths.append(dummy_path)

    # Navega para a URL apenas na primeira execução — retries reutilizam o estado atual do browser
    initial_actions = [] if _no_initial_navigate else [{'navigate': {'url': preview_url}}]

    _agent_kwargs = dict(
        task=task_text,
        llm=llm,
        browser_session=session,
        use_vision=False,         # DOM-based — lê estrutura da página sem visão
        flash_mode=True,          # schema reduzido (só memory+action) — melhor compatibilidade
        use_thinking=False,       # remove campo thinking do schema
        max_actions_per_step=5,   # 5 ações por step = ~3x mais rápido que o padrão
        max_failures=3,           # 3 falhas consecutivas antes de parar — permite recuperar de tropeços
        available_file_paths=image_paths,
        initial_actions=initial_actions,
    )
    if controller is not None:
        _agent_kwargs['controller'] = controller
    try:
        agent = Agent(**_agent_kwargs)
    except TypeError:
        # Versão do browser-use sem suporte a controller — fallback sem ele
        _agent_kwargs.pop('controller', None)
        agent = Agent(**_agent_kwargs)

    def log_token_summary():
        _t_end   = time.time()
        _total_s = _t_end - _t_test_start
        _avg_s   = _total_s / max(llm._step, 1)
        _llm_pct = (llm._total_llm_s / _total_s * 100) if _total_s > 0 else 0
        _br_pct  = (llm._total_browser_s / _total_s * 100) if _total_s > 0 else 0

        _token_summary = (
            f"\n[Tokens] ══════════════════════════════\n"
            f"[Tokens] 📊 RESUMO FINAL\n"
            f"[Tokens]    Steps executados : {llm._step}\n"
            f"[Tokens]    Tokens entrada   : {llm._tokens_in:,}\n"
            f"[Tokens]    Tokens saída     : {llm._tokens_out:,}\n"
            f"[Tokens]    TOTAL            : {llm._tokens_total:,}\n"
            f"[Tokens]    Limite diário    : {llm._tokens_total / 1_000_000 * 100:.2f}% de 1.000.000\n"
            f"[Tokens] ══════════════════════════════\n"
        )
        print(_token_summary)

        _timing_summary = (
            f"[TIMING] ── RESUMO ──────────────────────────────────────\n"
            f"[TIMING] Duração total  : {_total_s:.1f}s\n"
            f"[TIMING] Steps          : {llm._step} | Média/step: {_avg_s:.1f}s\n"
            f"[TIMING] Tempo LLM      : {llm._total_llm_s:.1f}s ({_llm_pct:.0f}%)\n"
            f"[TIMING] Tempo Browser  : {llm._total_browser_s:.1f}s ({_br_pct:.0f}%)\n"
            f"[TIMING] ─────────────────────────────────────────────────\n"
            f"{'='*62}"
        )
        print(_timing_summary)
        _write_timing(_timing_summary)

    # Lista compartilhada para acumular logs do console (preenchida pelo background task)
    console_logs = []
    console_task = asyncio.create_task(_attach_console_listeners(session, console_logs))

    try:
        # ── Loop: suporta extensão de steps com browser aberto ────────────
        _steps_now   = max_steps
        _first_run   = True
        history      = None

        while True:
            print(f"[QA Agent] 🔢 Executando: {_steps_now} steps")
            history = await agent.run(max_steps=_steps_now)

            # Verifica se o agente concluiu normalmente (chamou done())
            _raw_final = None
            if hasattr(history, 'final_result') and callable(history.final_result):
                _raw_final = history.final_result()

            if bool(_raw_final) or step_extension_callback is None:
                break  # concluído ou sem callback — aceita resultado

            # Steps esgotados sem done() — limpa initial_actions p/ não re-navegar
            if _first_run:
                if hasattr(agent, 'initial_actions'):
                    agent.initial_actions = []
                _first_run = False

            # Pergunta mais steps ao analista (callback fica no worker.py)
            extra = await step_extension_callback()
            if extra and isinstance(extra, int) and extra > 0:
                _steps_now = extra
                continue

            # Analista usou /end — encerra e retorna end_requested
            log_token_summary()
            return {
                "success":      False,
                "report":       "Teste encerrado pelo analista (/end após steps esgotados).",
                "steps":        len(history.history) if hasattr(history, 'history') else 0,
                "tokens_total": llm._tokens_total,
                "cache_update": None,
                "end_requested": True,
            }

        log_token_summary()

        final = None
        if hasattr(history, 'final_result') and callable(history.final_result):
            final = history.final_result()
        if not final and hasattr(history, 'extracted_content') and callable(history.extracted_content):
            final = str(history.extracted_content())
        if not final:
            final = "Agente concluiu a análise mas não retornou texto estruturado."

        # Extrai atualização de cache do relatório (seção especial)
        import re as _re
        cache_update = None
        cache_match = _re.search(
            r'🗃️ CACHE_UPDATE_START\s*([\s\S]*?)\s*🗃️ CACHE_UPDATE_END',
            final or ''
        )
        if cache_match:
            cache_update = cache_match.group(1).strip()
            final = final[:cache_match.start()].strip()
            print(f"[QA Agent] 🗃️  Cache do projeto extraído ({len(cache_update)} chars)")

        # Appenda logs de console ao relatório se houver erros relevantes
        if console_logs:
            errors   = [l for l in console_logs if l['type'] in ('error', 'pageerror')]
            warnings = [l for l in console_logs if l['type'] == 'warning']
            if errors or warnings:
                lines = ["\n\n🖥️ LOGS DO CONSOLE DURANTE O TESTE:"]
                if errors:
                    lines.append(f"🔴 Erros ({len(errors)}):")
                    lines.extend(f"  - {e['text'][:300]}" for e in errors[:10])
                if warnings:
                    lines.append(f"🟡 Avisos ({len(warnings)}):")
                    lines.extend(f"  - {w['text'][:200]}" for w in warnings[:5])
                final = (final or '') + '\n'.join(lines)

        return {
            "success": True,
            "report": final,
            "steps": len(history.history) if hasattr(history, 'history') else 0,
            "tokens_total": llm._tokens_total,
            "cache_update": cache_update,
        }

    except Exception as e:
        log_token_summary()
        return {
            "success": False,
            "report": f"Erro durante execução do agente: {str(e)}",
            "steps": 0,
            "tokens_total": llm._tokens_total,
            "cache_update": None,
        }
    finally:
        # Cancela o background task de console
        console_task.cancel()
        try:
            await console_task
        except (asyncio.CancelledError, Exception):
            pass

        # Fecha o browser APENAS se foi criado aqui — sessão externa é responsabilidade do caller
        if _external_session is None:
            try:
                await session.stop()
            except Exception:
                pass
            try:
                shutil.rmtree(temp_profile_dir, ignore_errors=True)
            except Exception:
                pass
