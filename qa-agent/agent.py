import os
import copy
import asyncio
import logging
from browser_use.agent.service import Agent
from browser_use.browser.profile import BrowserProfile
from browser_use.browser.session import BrowserSession
from browser_use.llm.messages import SystemMessage as BUSystemMessage, UserMessage as BUUserMessage, AssistantMessage as BUAssistantMessage
from langchain_core.messages import SystemMessage as LCSystemMessage, HumanMessage, AIMessage

# Campos de JSON Schema não suportados por alguns providers (Cerebras, etc.)
_SCHEMA_UNSUPPORTED = frozenset({'min_items', 'max_items', 'uniqueItems', 'exclusiveMinimum', 'exclusiveMaximum'})

def _clean_schema(obj):
    """Remove campos de JSON Schema não suportados por alguns providers."""
    if isinstance(obj, dict):
        return {k: _clean_schema(v) for k, v in obj.items() if k not in _SCHEMA_UNSUPPORTED}
    elif isinstance(obj, list):
        return [_clean_schema(item) for item in obj]
    return obj


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
        print(f"[BrowserUseLLM] ainvoke | output_format={output_format is not None} | msgs={len(messages)}")

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

                # Schema incompatível em outro provider → fallback para schema limpo
                if 'min_items' in err_str or 'wrong_api_format' in err_str:
                    print(f"[BrowserUseLLM] Schema rejeitado → tentando function_calling com schema limpo")
                    result = await _invoke_clean_function_calling(self._llm, output_format, lc_msgs)
                    return _CompletionWrapper(completion=result)

                print(f"[BrowserUseLLM] structured FALHOU → {type(e).__name__}: {e}")
                raise
        else:
            lc_msgs = convert_messages(messages) if messages else messages
            return await self._llm.ainvoke(lc_msgs, **kwargs)

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
      - cerebras  → llama-3.3-70b grátis, 1M tokens/dia (~6 testes completos)
      - deepseek  → DeepSeek-R1 via API (~$0.10/teste, requer saldo)
      - ollama    → local, ILIMITADO (requer hardware adequado)
      - groq      → cloud grátis, 100K tokens/dia (~1 teste/dia)
    """
    provider = os.getenv("AI_PROVIDER", "groq").lower().strip()

    if provider == "cerebras":
        from langchain_openai import ChatOpenAI
        # Prioridade: key passada pelo usuário via Settings > .env
        api_key = cerebras_api_key or os.getenv("CEREBRAS_API_KEY")
        if not api_key:
            raise ValueError("CEREBRAS_API_KEY não configurada. Adicione nas Configurações do QA System ou no .env do qa-agent")
        model = os.getenv("CEREBRAS_MODEL", "zai-glm-4.7")
        # Modelo de fallback: se o primário der 429, troca automaticamente
        fallback_model = "zai-glm-4.7" if model != "zai-glm-4.7" else "gpt-oss-120b"
        print(f"[QA Agent] 🧠 Usando Cerebras — modelo: {model} | fallback: {fallback_model} (GRÁTIS)")
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


def build_task(title: str, preview_url: str, criteria: list, project_name: str, knowledge: str, skills: str, description: str = "") -> str:
    criteria_text = "\n".join(f"- {c}" for c in criteria) if criteria else "- Verificar funcionamento geral da funcionalidade"

    return f"""Você é um analista de QA testando o sistema da Nocorp.

Acesse esta URL e realize os testes: {preview_url}

## Task em teste
Título: {title}
Projeto: {project_name or 'Não informado'}

{f"## Descrição e Requisitos da Funcionalidade{chr(10)}Use este contexto para entender O QUE foi implementado e O QUE deve ser testado:{chr(10)}{description}" if description else ""}

## Critérios de Aceitação para verificar
{criteria_text}

{f"## Instruções gerais de QA{chr(10)}{skills}" if skills else ""}

{f"## Base de conhecimento do projeto {project_name}{chr(10)}{knowledge}" if knowledge else ""}

## REGRA CRÍTICA — LEIA PRIMEIRO
🚫 **NUNCA use a ação `navigate`/`go_to_url`.** A página JÁ ESTÁ ABERTA na URL correta.
   Se você navegar, vai entrar em loop e falhar. Use APENAS ações que interagem com elementos
   da página atual: `input_text` (digitar), `click_element` (clicar), `scroll`, `upload_file`.

## O que fazer passo a passo — SIGA EXATAMENTE ESTA ORDEM

**PASSO 1 — LOGIN (a página de login já está carregada):**
- Olhe os elementos interativos disponíveis na página atual
- Use `input_text` no campo de email com: bernardo.michel@nocorp.io
- Use `input_text` no campo de senha com: 123456
- Use `click_element` no botão de login/entrar
- Aguarde o carregamento (NÃO navegue, apenas observe a próxima tela)

**PASSO 2 — APÓS LOGIN:**
- Verifique se o login foi bem-sucedido (deve aparecer dashboard ou área interna)
- Use `click_element` no botão ou menu de cadastro/registro
- Inicie o fluxo de cadastro

**PASSO 3 — FLUXO DE CADASTRO:**
- Use `click_element` no botão "Continuar" para avançar cada etapa
- Use `input_text` para preencher campos obrigatórios com dados de teste
- Em campos de upload, use `upload_file` com qualquer arquivo disponível
- Continue até completar ou encontrar erro

**LEMBRE-SE:** Você já está no site. Só interaja com os elementos. NUNCA navegue.

## Formato obrigatório do relatório final
Responda SEMPRE em português brasileiro com esta estrutura:

✅ APROVADOS:
- (liste o que funcionou)

❌ REPROVADOS:
- (liste o que falhou)

⚠️ AVISOS:
- (comportamentos diferentes do esperado mas não bloqueantes)

🏁 CONCLUSÃO: APROVADO | REPROVADO | SUGESTÃO DE ALTERAÇÃO

📝 OBSERVAÇÕES:
(detalhes adicionais importantes)"""


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
) -> dict:
    if max_steps is None:
        max_steps = int(os.getenv("MAX_STEPS", "15"))
    llm, model_name = build_llm(cerebras_api_key=cerebras_api_key)

    profile = BrowserProfile(headless=headless)
    session = BrowserSession(browser_profile=profile)

    task_text = build_task(title, preview_url, criteria, project_name, knowledge, skills, description)

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

    # Abre a URL automaticamente ANTES do loop do agente (não conta como navegação)
    initial_actions = [{'navigate': {'url': preview_url}}]

    agent = Agent(
        task=task_text,
        llm=llm,
        browser_session=session,
        use_vision=False,         # DOM-based — lê estrutura da página sem visão
        flash_mode=True,          # schema reduzido (só memory+action) — melhor compatibilidade
        use_thinking=False,       # remove campo thinking do schema
        max_actions_per_step=3,
        max_failures=1,           # para imediatamente no primeiro erro (sem retry infinito)
        available_file_paths=image_paths,
        initial_actions=initial_actions,
    )

    def log_token_summary():
        print(
            f"\n[Tokens] ══════════════════════════════\n"
            f"[Tokens] 📊 RESUMO FINAL\n"
            f"[Tokens]    Steps executados : {llm._step}\n"
            f"[Tokens]    Tokens entrada   : {llm._tokens_in:,}\n"
            f"[Tokens]    Tokens saída     : {llm._tokens_out:,}\n"
            f"[Tokens]    TOTAL            : {llm._tokens_total:,}\n"
            f"[Tokens]    Limite diário    : {llm._tokens_total / 1_000_000 * 100:.2f}% de 1.000.000\n"
            f"[Tokens] ══════════════════════════════\n"
        )

    try:
        print(f"[QA Agent] 🔢 Max steps: {max_steps}")
        history = await agent.run(max_steps=max_steps)

        log_token_summary()

        final = None
        if hasattr(history, 'final_result') and callable(history.final_result):
            final = history.final_result()
        if not final and hasattr(history, 'extracted_content') and callable(history.extracted_content):
            final = str(history.extracted_content())
        if not final:
            final = "Agente concluiu a análise mas não retornou texto estruturado."

        return {
            "success": True,
            "report": final,
            "steps": len(history.history) if hasattr(history, 'history') else 0,
            "tokens_total": llm._tokens_total,
        }

    except Exception as e:
        log_token_summary()
        return {
            "success": False,
            "report": f"Erro durante execução do agente: {str(e)}",
            "steps": 0,
            "tokens_total": llm._tokens_total,
        }
    finally:
        try:
            await session.stop()
        except Exception:
            pass
