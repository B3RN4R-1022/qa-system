"""
Gerencia a sessão local do QA Agent.

Segurança:
- Usa a DPAPI do Windows (CryptProtectData) para criptografar o arquivo.
- A criptografia é atrelada à conta de usuário do Windows: só esse usuário,
  nessa máquina, consegue descriptografar. Se o arquivo for copiado para outro
  PC, fica inútil.
- JWT e a Cerebras API key NUNCA são salvos em texto puro.
"""
import os
import json
import ctypes
from ctypes import wintypes

APPDATA = os.getenv("APPDATA") or os.path.expanduser("~")
SESSION_DIR = os.path.join(APPDATA, "NocorpQA")
SESSION_FILE = os.path.join(SESSION_DIR, "session.dat")


# ─── DPAPI (Windows Data Protection API) ──────────────────────────────────
class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _blob_to_bytes(blob: _DATA_BLOB) -> bytes:
    size = blob.cbData
    buf = ctypes.create_string_buffer(size)
    ctypes.memmove(buf, blob.pbData, size)
    ctypes.windll.kernel32.LocalFree(blob.pbData)
    return buf.raw


def _dpapi_encrypt(data: bytes) -> bytes:
    blob_in = _DATA_BLOB(len(data), ctypes.cast(ctypes.c_char_p(data), ctypes.POINTER(ctypes.c_char)))
    blob_out = _DATA_BLOB()
    ok = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(blob_in), "NocorpQA", None, None, None, 0, ctypes.byref(blob_out)
    )
    if not ok:
        raise RuntimeError("Falha ao criptografar a sessão (DPAPI)")
    return _blob_to_bytes(blob_out)


def _dpapi_decrypt(data: bytes) -> bytes:
    blob_in = _DATA_BLOB(len(data), ctypes.cast(ctypes.c_char_p(data), ctypes.POINTER(ctypes.c_char)))
    blob_out = _DATA_BLOB()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    )
    if not ok:
        raise RuntimeError("Falha ao descriptografar a sessão (DPAPI)")
    return _blob_to_bytes(blob_out)


# ─── API pública ──────────────────────────────────────────────────────────
def load() -> dict:
    """Carrega a sessão salva, ou {} se não existir/estiver corrompida."""
    if not os.path.exists(SESSION_FILE):
        return {}
    try:
        with open(SESSION_FILE, "rb") as f:
            enc = f.read()
        raw = _dpapi_decrypt(enc)
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def save(data: dict) -> None:
    """Salva a sessão criptografada com DPAPI."""
    os.makedirs(SESSION_DIR, exist_ok=True)
    raw = json.dumps(data).encode("utf-8")
    enc = _dpapi_encrypt(raw)
    with open(SESSION_FILE, "wb") as f:
        f.write(enc)


def clear() -> None:
    """Remove a sessão (logout)."""
    if os.path.exists(SESSION_FILE):
        os.remove(SESSION_FILE)


def location() -> str:
    return SESSION_FILE
