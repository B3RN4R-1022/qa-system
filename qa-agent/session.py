"""
Gerencia a sessão local do QA Agent — cross-platform.

Windows : DPAPI (CryptProtectData) — chave vinculada ao usuário Windows
macOS   : Keychain via CLI `security` — protegido pelo login do usuário
Linux   : arquivo com permissão 600 (sem criptografia extra)

Em qualquer caso, JWT e Cerebras API key NUNCA ficam em texto puro em disco
nos sistemas que suportam criptografia nativa.
"""
import os
import sys
import json
import subprocess

PLATFORM = sys.platform  # 'win32' | 'darwin' | 'linux'

# ─── Paths (Windows usa APPDATA, demais usam ~/.config) ──────────────────────
if PLATFORM == "win32":
    _BASE = os.path.join(os.getenv("APPDATA", os.path.expanduser("~")), "NocorpQA")
else:
    _BASE = os.path.join(os.path.expanduser("~"), ".config", "NocorpQA")

SESSION_FILE = os.path.join(_BASE, "session.dat")

# ─── macOS Keychain ───────────────────────────────────────────────────────────
_KC_SERVICE = "NocorpQAAgent"
_KC_ACCOUNT = "qa-agent-session"


def _mac_save(data: dict):
    json_str = json.dumps(data)
    subprocess.run(
        ["security", "delete-generic-password", "-a", _KC_ACCOUNT, "-s", _KC_SERVICE],
        capture_output=True
    )
    result = subprocess.run(
        ["security", "add-generic-password", "-a", _KC_ACCOUNT, "-s", _KC_SERVICE, "-w", json_str],
        capture_output=True
    )
    if result.returncode != 0:
        raise RuntimeError("Falha ao salvar no macOS Keychain")


def _mac_load() -> dict:
    result = subprocess.run(
        ["security", "find-generic-password", "-a", _KC_ACCOUNT, "-s", _KC_SERVICE, "-w"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout.strip())
    except Exception:
        return {}


def _mac_clear():
    subprocess.run(
        ["security", "delete-generic-password", "-a", _KC_ACCOUNT, "-s", _KC_SERVICE],
        capture_output=True
    )


# ─── Windows DPAPI ────────────────────────────────────────────────────────────

def _win_encrypt(data: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def _to_bytes(blob):
        buf = ctypes.create_string_buffer(blob.cbData)
        ctypes.memmove(buf, blob.pbData, blob.cbData)
        ctypes.windll.kernel32.LocalFree(blob.pbData)
        return buf.raw

    blob_in  = _BLOB(len(data), ctypes.cast(ctypes.c_char_p(data), ctypes.POINTER(ctypes.c_char)))
    blob_out = _BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(blob_in), "NocorpQA", None, None, None, 0, ctypes.byref(blob_out)
    ):
        raise RuntimeError("DPAPI: falha ao criptografar")
    return _to_bytes(blob_out)


def _win_decrypt(data: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def _to_bytes(blob):
        buf = ctypes.create_string_buffer(blob.cbData)
        ctypes.memmove(buf, blob.pbData, blob.cbData)
        ctypes.windll.kernel32.LocalFree(blob.pbData)
        return buf.raw

    blob_in  = _BLOB(len(data), ctypes.cast(ctypes.c_char_p(data), ctypes.POINTER(ctypes.c_char)))
    blob_out = _BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    ):
        raise RuntimeError("DPAPI: falha ao descriptografar")
    return _to_bytes(blob_out)


# ─── API pública ──────────────────────────────────────────────────────────────

def load() -> dict:
    """Carrega a sessão salva. Retorna {} se não existir ou estiver corrompida."""
    try:
        if PLATFORM == "darwin":
            return _mac_load()

        if not os.path.exists(SESSION_FILE):
            return {}

        with open(SESSION_FILE, "rb") as f:
            raw = f.read()

        if PLATFORM == "win32":
            raw = _win_decrypt(raw)

        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def save(data: dict) -> None:
    """Salva a sessão protegida pelo mecanismo nativo do SO."""
    if PLATFORM == "darwin":
        _mac_save(data)
        return

    os.makedirs(_BASE, exist_ok=True)
    raw = json.dumps(data).encode("utf-8")

    if PLATFORM == "win32":
        raw = _win_encrypt(raw)

    with open(SESSION_FILE, "wb") as f:
        f.write(raw)

    # Linux: restringe permissão ao dono do arquivo
    if PLATFORM == "linux":
        os.chmod(SESSION_FILE, 0o600)


def clear() -> None:
    """Remove a sessão (logout)."""
    if PLATFORM == "darwin":
        _mac_clear()
        return
    if os.path.exists(SESSION_FILE):
        os.remove(SESSION_FILE)


def location() -> str:
    if PLATFORM == "darwin":
        return f"macOS Keychain ({_KC_SERVICE})"
    return SESSION_FILE
