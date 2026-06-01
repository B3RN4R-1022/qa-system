"""
Testa quais modelos Gemini funcionam nessa conta.
Rode: .\venv\Scripts\python.exe test_gemini.py
"""
import asyncio
import os
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
]

async def test():
    api_key = os.getenv("GEMINI_API_KEY")
    print(f"Testando chave: ...{api_key[-6:] if api_key else 'NÃO ENCONTRADA'}\n")

    for model in MODELS:
        try:
            llm = ChatGoogleGenerativeAI(model=model, google_api_key=api_key)
            response = await llm.ainvoke("Responda apenas: OK")
            print(f"✅ {model}: {response.content.strip()}")
        except Exception as e:
            msg = str(e)[:120]
            print(f"❌ {model}: {msg}")

asyncio.run(test())
