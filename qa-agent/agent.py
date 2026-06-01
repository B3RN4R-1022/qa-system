import os
import asyncio
import logging
from browser_use.agent.service import Agent
from browser_use.browser.profile import BrowserProfile
from browser_use.browser.session import BrowserSession
from browser_use.llm.messages import SystemMessage as BUSystemMessage, UserMessage as BUUserMessage, AssistantMessage as BUAssistantMessage
from langchain_core.messages import SystemMessage as LCSystemMessage, HumanMessage, AIMessage
from langchain_groq import ChatGroq


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
                # Conteúdo com imagens
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

    def __init__(self, llm):
        self._llm = llm
        self.provider = getattr(llm, 'provider', 'groq')
        self.model = getattr(llm, 'model', getattr(llm, 'model_name', 'unknown'))

    @property
    def model_name(self):
        return self.model

    async def ainvoke(self, messages, output_format=None, **kwargs):
        # Remove kwargs que LangChain não entende
        kwargs.pop('session_id', None)

        print(f"[BrowserUseLLM] ainvoke chamado | output_format={output_format is not None} | msgs={len(messages)}")

        if output_format is not None:
            try:
                lc_msgs = convert_messages(messages)
                structured = self._llm.with_structured_output(output_format)
                result = await structured.ainvoke(lc_msgs)
                print(f"[BrowserUseLLM] structured OK → type={type(result).__name__}")
                return _CompletionWrapper(completion=result)
            except Exception as e:
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
) -> dict:
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        raise ValueError("GROQ_API_KEY não configurada no .env do qa-agent")

    # llama-3.3-70b para raciocínio/planejamento (6.000 req/dia grátis)
    groq = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=groq_api_key,
        temperature=0.1,
    )

    llm = BrowserUseLLM(groq)

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
        use_vision=False,       # DOM-based — Groq lê estrutura da página
        flash_mode=True,        # schema reduzido (só memory+action) — Groq cumpre melhor
        use_thinking=False,     # remove campo thinking do schema
        max_actions_per_step=3,
        available_file_paths=image_paths,
        initial_actions=initial_actions,
    )

    try:
        history = await agent.run(max_steps=25)

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
        }

    except Exception as e:
        return {
            "success": False,
            "report": f"Erro durante execução do agente: {str(e)}",
            "steps": 0,
        }
    finally:
        try:
            await session.stop()
        except Exception:
            pass
