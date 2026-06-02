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
import time
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

SPINNER = ['|', '/', '-', '\\']


# ─── Visual ───────────────────────────────────────────────────────────────────

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

def _clear_line():
    sys.stdout.write('\r' + ' ' * 72 + '\r')
    sys.stdout.flush()

def _spin(idx, msg):
    frame = SPINNER[idx % len(SPINNER)]
    sys.stdout.write(f'\r  {frame}  {msg}')
    sys.stdout.flush()


# ─── Atualização ──────────────────────────────────────────────────────────────

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


# ─── Conexão com o backend ────────────────────────────────────────────────────

async def wait_for_backend(client, url):
    """Aguarda o backend responder — útil quando o Render está acordando."""
    spin = 0
    while True:
        try:
            r = await client.get(url, timeout=10)
            if r.status_code < 500:
                _clear_line()
                return
        except Exception:
            pass
        _spin(spin, "Conectando ao backend (pode levar ~30s se estava inativo)...")
        spin += 1
        await asyncio.sleep(2)


# ─── Login ────────────────────────────────────────────────────────────────────

async def do_login(client, backend_url):
    print("  Faça login com sua conta do QA System:")
    print()
    email = input("  Email: ").strip()
    password = getpass.getpass("  Senha: ")

    # Mostra spinner enquanto aguarda resposta
    sys.stdout.write("  /  Verificando credenciais...")
    sys.stdout.flush()
    try:
        r = await client.post(
            f"{backend_url}/auth/login",
            json={"email": email, "password": password}
        )
    except Exception as e:
        _clear_line()
        err(f"Não foi possível conectar ao backend: {e}")
        return None

    _clear_line()

    if r.status_code != 200:
        err(r.json().get("error", "Falha no login"))
        return None

    data = r.json()

    # Segundo fator (Google Authenticator)
    if data.get("requiresTotp"):
        print()
        code = input("  Código do autenticador (6 dígitos): ").strip()
        sys.stdout.write("  /  Verificando código...")
        sys.stdout.flush()
        r = await client.post(
            f"{backend_url}/auth/verify-totp",
            json={"tempToken": data["tempToken"], "code": code},
        )
        _clear_line()
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


# ─── Cerebras key ─────────────────────────────────────────────────────────────

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


# ─── Timer ao vivo durante execução ───────────────────────────────────────────

async def _live_timer(title):
    """Mostra spinner + tempo decorrido enquanto o agente trabalha."""
    start = time.time()
    spin = 0
    short_title = title[:35] + '…' if len(title) > 35 else title
    try:
        while True:
            elapsed = int(time.time() - start)
            m, s = divmod(elapsed, 60)
            _spin(spin, f"Analisando: {short_title}  [{m:02d}:{s:02d}]")
            spin += 1
            await asyncio.sleep(0.3)
    except asyncio.CancelledError:
        pass


# ─── Execução de um job ───────────────────────────────────────────────────────

async def run_job(client, backend_url, headers, job, cerebras_key):
    task_id  = job["task_id"]
    job_type = job.get("type", "qa_task")

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
    work(f"Iniciando: {job['title']}")
    info(f"URL    : {job['preview_url']}")
    info(f"Tipo   : {'Task Asana' if job_type == 'qa_task' else 'Teste Dev'}")
    criterios = job.get("criteria", [])
    if criterios:
        info(f"Critérios: {len(criterios)} item(s)")
    print()
    info("Abrindo Chromium — aguarde...")
    print()

    # Inicia timer ao vivo
    timer = asyncio.create_task(_live_timer(job["title"]))

    try:
        result = await run_qa_agent(
            title=job["title"],
            preview_url=job["preview_url"],
            criteria=criterios,
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
    finally:
        timer.cancel()
        try:
            await timer
        except asyncio.CancelledError:
            pass
        _clear_line()

    # Envia o resultado de volta
    sys.stdout.write("  /  Enviando relatório...")
    sys.stdout.flush()
    try:
        await client.post(
            f"{backend_url}/qa-jobs/{task_id}/result",
            headers=headers,
            json={"status": status, "report": report, "tokensUsed": tokens, "type": job_type},
        )
        _clear_line()
    except Exception as e:
        _clear_line()
        err(f"Falha ao enviar resultado: {e}")

    icon = "✅" if status == "done" else "❌"
    if tokens:
        info(f"Tokens usados: {tokens:,}")
    print(f"  {icon} Concluído: {job['title']}")
    print("  ─────────────────────────────────────────────")
    print()


# ─── Loop principal ───────────────────────────────────────────────────────────

async def main():
    banner()
    backend_url   = DEFAULT_BACKEND
    session_data  = sess.load()

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as client:

        # Verifica/aguarda o backend (Render pode estar dormindo)
        info("Conectando ao backend...")
        await wait_for_backend(client, f"{backend_url}/")
        ok("Backend online.")
        print()

        await check_update(client)

        # 1. Autenticação
        jwt = session_data.get("jwt")
        sys.stdout.write("  /  Verificando sessão salva...")
        sys.stdout.flush()
        valid = jwt and await token_valid(client, backend_url, jwt)
        _clear_line()

        if valid:
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
        print("  ┌─────────────────────────────────────────┐")
        print("  │  Pronto! Aguardando análises...         │")
        print("  │  Mantenha esta janela aberta.           │")
        print("  │  Ctrl+C para encerrar.                  │")
        print("  └─────────────────────────────────────────┘")
        print()

        spin_idx       = 0
        retry_count    = 0
        MAX_RETRY_MSG  = 3  # mostra mensagem de reconexão após N falhas seguidas

        while True:
            try:
                r = await client.get(f"{backend_url}/qa-jobs/pending", headers=headers)
                retry_count = 0  # conexão ok — reseta contador

                if r.status_code == 401:
                    _clear_line()
                    err("Sessão expirada. Reinicie o agente.")
                    sess.clear()
                    break

                job = r.json()
                if job:
                    _clear_line()
                    await run_job(client, backend_url, headers, job, cerebras_key)
                else:
                    _spin(spin_idx, "Aguardando análises...")
                    spin_idx += 1

            except httpx.RequestError:
                retry_count += 1
                if retry_count >= MAX_RETRY_MSG:
                    _spin(spin_idx, "Reconectando ao backend...")
                    spin_idx += 1
                else:
                    _spin(spin_idx, "Aguardando análises...")
                    spin_idx += 1

            except Exception as e:
                _clear_line()
                err(f"Erro: {e}")

            await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        _clear_line()
        print("\n  👋 QA Agent encerrado.")
    except Exception as e:
        print(f"\n  ❌ Erro fatal: {e}")
        input("\n  Pressione Enter para sair...")
