"""
Teste manual do agente de QA no eTrainer.
Roda direto: .\venv\Scripts\python.exe test_etrainer.py
"""
import asyncio
import os
from dotenv import load_dotenv
from browser_use.agent.service import Agent
from browser_use.browser.profile import BrowserProfile
from browser_use.browser.session import BrowserSession
from langchain_groq import ChatGroq

load_dotenv()

TASK = """Você é um analista de QA testando o sistema eTrainer da Nocorp.

## Objetivo
Fazer login no sistema e completar o fluxo de cadastro/registro.

## Passo a passo

1. Acesse: https://www.etrainer.com.br/login
2. Faça login com:
   - Email: bernardo.michel@nocorp.io
   - Senha: 123456
3. Após o login, localize o botão ou link de cadastro/registro
4. Inicie o fluxo de registro
5. Em cada etapa que pedir uma imagem ou foto, use QUALQUER imagem disponível no computador ou faça upload de qualquer arquivo de imagem — o objetivo é apenas testar se o sistema aceita e avança
6. Clique em "Continuar" (ou botão equivalente) em cada etapa para avançar
7. Tente completar todas as etapas do registro até o final

## O que verificar em cada etapa
- O botão "Continuar" funciona e avança para a próxima página
- Mensagens de erro aparecem de forma clara
- O sistema aceita os dados inseridos
- O fluxo não trava ou fecha inesperadamente

## Relatório final obrigatório (em português)

✅ APROVADOS:
- (etapas que funcionaram corretamente)

❌ REPROVADOS:
- (etapas que falharam ou não avançaram)

⚠️ AVISOS:
- (comportamentos inesperados mas não bloqueantes)

🏁 CONCLUSÃO: APROVADO | REPROVADO | SUGESTÃO DE ALTERAÇÃO

📝 OBSERVAÇÕES:
- Quantas etapas foram concluídas
- Em qual etapa parou (se parou)
- Descrição detalhada do que aconteceu
"""


async def main():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("❌ GROQ_API_KEY não encontrada no .env")
        return

    print("=" * 60)
    print("🤖 Nocorp QA Agent — Teste eTrainer")
    print("=" * 60)
    print(f"🌐 URL: https://www.etrainer.com.br/login")
    print(f"👤 Login: bernardo.michel@nocorp.io")
    print(f"👁  Chromium abrirá na sua tela")
    print("=" * 60)
    print()

    llm = ChatGroq(
        model="llama-3.2-11b-vision-preview",
        api_key=api_key,
        temperature=0.1,
        max_tokens=4096,
    )

    profile = BrowserProfile(headless=False)  # False = você vê o browser
    session = BrowserSession(browser_profile=profile)

    agent = Agent(
        task=TASK,
        llm=llm,
        browser_session=session,
        use_vision=True,
        max_actions_per_step=5,
    )

    try:
        print("🚀 Iniciando agente...\n")
        history = await agent.run(max_steps=40)

        # Extrai resultado
        final = None
        if hasattr(history, 'final_result') and callable(history.final_result):
            final = history.final_result()
        if not final and hasattr(history, 'extracted_content') and callable(history.extracted_content):
            final = str(history.extracted_content())
        if not final:
            final = "Agente concluiu mas não retornou texto estruturado."

        steps = len(history.history) if hasattr(history, 'history') else 0

        print("\n" + "=" * 60)
        print(f"✅ ANÁLISE CONCLUÍDA — {steps} steps executados")
        print("=" * 60)
        print(final)
        print("=" * 60)

    except KeyboardInterrupt:
        print("\n⏹  Interrompido pelo usuário.")
    except Exception as e:
        print(f"\n❌ Erro: {e}")
    finally:
        try:
            await session.stop()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
