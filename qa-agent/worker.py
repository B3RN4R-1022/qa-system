"""
QA Agent Worker — Nocorp

Fluxo:
  1. Login (email + senha + código do autenticador) na primeira vez
     → JWT salvo localmente (criptografado, válido 30 dias)
  2. Pede a Cerebras API key na primeira vez
     → salva localmente (criptografada via DPAPI)
  3. Fica ouvindo o backend: a cada 5s pergunta "tem análise para fazer?"
     → quando tem, abre o Chromium e executa o teste
     → envia o relatório de volta

Sem ngrok, sem servidor exposto. A conexão sempre sai desta máquina.
"""
import os
import sys
import asyncio
import getpass

import httpx
from dotenv import load_dotenv

import session as sess
from agent import run_qa_agent

load_dotenv()

LOCAL_VERSION = "1.1.0"
DEFAULT_BACKEND = os.getenv("BACKEND_URL", "https://qa-system-5vpf.onrender.com").rstrip("/")
VERSION_URL = "https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/version.txt"
POLL_INTERVAL = 5  # segundos


# ─── Visual ───────────────────────────────────────────────────────────────
def banner():
    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║           Nocorp QA Agent                ║")
    print("  ╚══════════════════════════════════════════╝")
    print()


def info(msg):  print(f"  ℹ  {msg}")
def ok(msg):    print(f"  ✅ {msg}")
def err(msg):   print(f"  ❌ {msg}")
def work(msg):  print(f"  ⚙️  {msg}")


# ─── Atualização ────────────────────────────────────────────────────────────
async def check_update(client):
    try:
        r = await client.get(VERSION_URL, timeout=5)
        remote = r.text.strip()
        if remote and remote != LOCAL_VERSION:
            print()
            print(f"  🔄 Nova versão disponível: {remote} (atual: {LOCAL_VERSION})")
            print("     Rode o instalador novamente para atualizar.")
            print()
    except Exception:
        pass


# ─── Login ──────────────────────────────────────────────────────────────────
async def do_login(client, backend_url):
    print("  Faça login com sua conta do QA System:")
    print()
    email = input("  Email: ").strip()
    password = getpass.getpass("  Senha: ")

    try:
        r = await client.post(f"{backend_url}/auth/login", json={"email": email, "password": password})
    except Exception as e:
        err(f"Não foi possível conectar ao backend: {e}")
        return None

    if r.status_code != 200:
        err(r.json().get("error", "Falha no login"))
        return None

    data = r.json()

    # Segundo fator (Google Authenticator)
    if data.get("requiresTotp"):
        print()
        code = input("  Código do autenticador (6 dígitos): ").strip()
        r = await client.post(
            f"{backend_url}/auth/verify-totp",
            json={"tempToken": data["tempToken"], "code": code},
        )
        if r.status_code != 200:
            err(r.json().get("error", "Código incorreto"))
            return None
        data = r.json()

    return data["token"], data["user"]


async def token_valid(client, backend_url, jwt):
    """Confere se o JWT salvo ainda é válido."""
    try:
        r = await client.get(
            f"{backend_url}/qa-jobs/pending",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        return r.status_code != 401
    except Exception:
        return False


# ─── Cerebras key ─────────────────────────────────────────────────────────
def ensure_cerebras_key(session_data):
    key = session_data.get("cerebras_key")
    if key:
        return key

    print()
    info("Você precisa de uma API key gratuita da Cerebras.")
    info("Crie a sua em: https://cloud.cerebras.ai")
    print()
    key = input("  Cole sua Cerebras API key (csk-...): ").strip()

    while not key.startswith("csk-"):
        err("Chave inválida — deve começar com 'csk-'")
        key = input("  Cole sua Cerebras API key (csk-...): ").strip()

    session_data["cerebras_key"] = key
    sess.save(session_data)
    ok("Chave salva com segurança (criptografada nesta máquina).")
    return key


# ─── Execução de um job ──────────────────────────────────────────────────────
async def run_job(client, backend_url, headers, job, cerebras_key):
    task_id = job["task_id"]
    job_type = job.get("type", "qa_task")  # 'qa_task' | 'dev_test'

    # Reivindica o job (queued → running) — evita execução dupla
    r = await client.post(
        f"{backend_url}/qa-jobs/{task_id}/claim",
        headers=headers,
        json={"type": job_type}
    )
    if not r.json().get("claimed"):
        return  # outro worker pegou primeiro

    print()
    print("  ─────────────────────────────────────────────")
    work(f"Análise: {job['title']}")
    info(f"URL: {job['preview_url']}")
    info("Abrindo Chromium...")
    print()

    try:
        result = await run_qa_agent(
            title=job["title"],
            preview_url=job["preview_url"],
            criteria=job.get("criteria", []),
            project_name=job.get("project_name", ""),
            description=job.get("description", ""),
            knowledge=job.get("knowledge", ""),
            skills=job.get("skills", ""),
            headless=False,
            cerebras_api_key=cerebras_key,
        )
        status = "done" if result["success"] else "error"
        report = result["report"]
        tokens = result.get("tokens_total")
    except Exception as e:
        status, report, tokens = "error", f"Erro inesperado no agente: {e}", None

    # Envia o resultado de volta
    try:
        await client.post(
            f"{backend_url}/qa-jobs/{task_id}/result",
            headers=headers,
            json={"status": status, "report": report, "tokensUsed": tokens, "type": job_type},
        )
    except Exception as e:
        err(f"Falha ao enviar resultado: {e}")

    icon = "✅" if status == "done" else "❌"
    print()
    print(f"  {icon} Análise concluída: {job['title']}")
    print("  ─────────────────────────────────────────────")
    print()
    info("Aguardando próxima análise...")


# ─── Loop principal ─────────────────────────────────────────────────────────
async def main():
    banner()
    backend_url = DEFAULT_BACKEND
    session_data = sess.load()

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as client:
        await check_update(client)

        # 1. Autenticação
        jwt = session_data.get("jwt")
        if jwt and await token_valid(client, backend_url, jwt):
            ok(f"Sessão restaurada — {session_data.get('email', 'usuário')}")
        else:
            result = await do_login(client, backend_url)
            if not result:
                err("Não foi possível autenticar. Encerrando.")
                input("\n  Pressione Enter para sair...")
                return
            jwt, user = result
            session_data["jwt"] = jwt
            session_data["email"] = user["email"]
            sess.save(session_data)
            print()
            ok(f"Login realizado — {user['email']}")
            info("Sessão válida por 30 dias.")

        # 2. Cerebras key
        cerebras_key = ensure_cerebras_key(session_data)
        ok("Cerebras configurada.")

        # 3. Loop de jobs
        headers = {"Authorization": f"Bearer {jwt}"}
        print()
        print("  👂 Aguardando análises... (Ctrl+C para encerrar)")
        print("     Mantenha esta janela aberta enquanto usar o QA System.")
        print()

        while True:
            try:
                r = await client.get(f"{backend_url}/qa-jobs/pending", headers=headers)

                if r.status_code == 401:
                    err("Sessão expirada. Faça login novamente reiniciando o agente.")
                    sess.clear()
                    break

                job = r.json()
                if job:
                    await run_job(client, backend_url, headers, job, cerebras_key)

            except httpx.RequestError:
                # Backend dormindo (Render free) ou rede instável — tenta de novo
                pass
            except Exception as e:
                err(f"Erro: {e}")

            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  👋 QA Agent encerrado.")
    except Exception as e:
        print(f"\n  ❌ Erro fatal: {e}")
        input("\n  Pressione Enter para sair...")
