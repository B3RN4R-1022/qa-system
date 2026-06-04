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
     → se o usuário cancelar no frontend, para imediatamente

Sem ngrok, sem servidor exposto. A conexão sempre sai desta máquina.
"""
import os
import sys
import time
import asyncio
import getpass
import fnmatch
import subprocess
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

import session as sess
from agent import run_qa_agent

# Carrega o .env do mesmo diretório do worker.py, independente do cwd
# override=True garante que o .env prevalece sobre vars de sistema/sessão anterior
import pathlib as _pathlib
load_dotenv(_pathlib.Path(__file__).parent / '.env', override=True)

LOCAL_VERSION = "1.4.14"

# Corrige CEREBRAS_MODEL imediatamente se .env tiver modelo desatualizado.
# Garante que mesmo sem auto-update o modelo certo é usado na sessão atual.
def _fix_env_model_now():
    import re as _r
    _UNAVAIL = {'llama3.1-8b','llama3.3-70b','llama-3.3-70b','llama-3.1-8b','llama3.1-70b','llama-3.1-70b'}
    try:
        p = _pathlib.Path(__file__).parent / '.env'
        if not p.exists():
            return
        txt = p.read_text(encoding='utf-8', errors='ignore')
        m = _r.search(r'^CEREBRAS_MODEL=(.+)$', txt, _r.MULTILINE)
        if m and m.group(1).strip().strip('"').strip("'") in _UNAVAIL:
            p.write_text(_r.sub(r'^CEREBRAS_MODEL=.*$', 'CEREBRAS_MODEL=gpt-oss-120b', txt, flags=_r.MULTILINE), encoding='utf-8')
            os.environ['CEREBRAS_MODEL'] = 'gpt-oss-120b'
    except Exception:
        pass
_fix_env_model_now()
DEFAULT_BACKEND = os.getenv("BACKEND_URL", "https://qa-system-5vpf.onrender.com").rstrip("/")
RAW_BASE    = "https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent"
VERSION_URL = f"{RAW_BASE}/version.txt"

# Arquivos que o auto-update baixa — só código fonte, sem venv/dependências
UPDATE_FILES = ["worker.py", "agent.py", "session.py", "version.txt"]
POLL_INTERVAL  = 5   # segundos entre polls de jobs
CANCEL_INTERVAL = 5  # segundos entre polls de cancelamento

SPINNER = ['|', '/', '-', '\\']

# Extensões de código-fonte que o worker lê
CODE_EXTENSIONS = frozenset({
    '.js', '.jsx', '.ts', '.tsx',
    '.py', '.prisma',
    '.vue', '.svelte',
    '.css', '.scss', '.sass',
    '.html',
    '.sh', '.bash',
})

# Diretórios que NUNCA são lidos (além do .gitignore)
ALWAYS_SKIP_DIRS = frozenset({
    'node_modules', 'venv', '.venv', 'env', '.env',
    '__pycache__', '.git', '.svn', '.hg',
    'dist', 'build', '.next', 'out', 'output',
    'coverage', '.coverage',
    '.cache', 'tmp', 'temp',
    'vendor', 'bower_components',
    '.idea', '.vscode', '.vs',
    'migrations',
    'static', 'media', 'uploads',
})

# Arquivos que NUNCA são lidos
ALWAYS_SKIP_FILES = frozenset({
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'poetry.lock', 'Pipfile.lock', 'composer.lock',
    '.DS_Store', 'Thumbs.db',
})


# ─── Análise de Repositório ───────────────────────────────────────────────────

def _parse_gitignore(repo_path):
    """Lê .gitignore e retorna lista de padrões extras para ignorar."""
    patterns = []
    path = os.path.join(repo_path, '.gitignore')
    if not os.path.exists(path):
        return patterns
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and not line.startswith('!'):
                    patterns.append(line.rstrip('/'))
    except Exception:
        pass
    return patterns


def _is_ignored(rel_path, gitignore_patterns):
    """Verifica se um caminho deve ser ignorado."""
    name = os.path.basename(rel_path)

    # .env nunca é lido, independente de qualquer coisa
    if name.startswith('.env') or name == '.env':
        return True
    if name in ALWAYS_SKIP_FILES:
        return True

    parts = rel_path.replace('\\', '/').split('/')

    # Diretórios sempre ignorados (em qualquer nível da árvore)
    for part in parts[:-1]:
        if part in ALWAYS_SKIP_DIRS:
            return True

    # Padrões do .gitignore
    rel_unix = rel_path.replace('\\', '/')
    for pattern in gitignore_patterns:
        pat = pattern.strip('/')
        for part in parts:
            if fnmatch.fnmatch(part, pat):
                return True
        if fnmatch.fnmatch(rel_unix, pat) or fnmatch.fnmatch(name, pat):
            return True

    return False


def _run_git(args, cwd, timeout=15):
    """Executa um comando git e retorna stdout ou None se falhar."""
    try:
        r = subprocess.run(
            ['git'] + args,
            capture_output=True, text=True,
            cwd=cwd, timeout=timeout
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def _get_head(repo_path):
    return _run_git(['rev-parse', 'HEAD'], repo_path, timeout=5)


def analyze_repo_full(repo_path):
    """
    PRIMEIRA análise: lê a estrutura completa do repositório.
    Sem limite de arquivos ou linhas — só respeita .gitignore e padrões fixos.
    Retorna: (contexto: str, head_commit: str | None, erro: str | None)
    """
    if not os.path.exists(os.path.join(repo_path, '.git')):
        return None, None, f"Não é um repositório git: {repo_path}"

    ignore_patterns = _parse_gitignore(repo_path)
    lines = []

    # Histórico de commits
    log = _run_git(['log', '--format=%h %s (%ar)', '-20'], repo_path)
    if log:
        lines.append("### Histórico de commits recentes:")
        lines.append(log)

    # Branch atual
    branch = _run_git(['branch', '--show-current'], repo_path)
    if branch:
        lines.append(f"\n### Branch atual: {branch}")

    # Coleta todos os arquivos de código (respeitando .gitignore)
    all_files = []
    try:
        for root, dirs, files in os.walk(repo_path):
            # Remove dirs ignorados in-place (evita descer neles)
            dirs[:] = sorted([
                d for d in dirs
                if d not in ALWAYS_SKIP_DIRS
            ])
            rel_root = os.path.relpath(root, repo_path)
            rel_root = '' if rel_root == '.' else rel_root

            for fname in sorted(files):
                rel = os.path.join(rel_root, fname) if rel_root else fname
                rel = rel.replace('\\', '/')
                ext = os.path.splitext(fname)[1].lower()

                if ext not in CODE_EXTENSIONS:
                    continue
                if _is_ignored(rel, ignore_patterns):
                    continue

                all_files.append(rel)
    except Exception as e:
        return None, None, f"Erro ao percorrer repositório: {e}"

    if not all_files:
        return None, None, "Nenhum arquivo de código encontrado (verifique o caminho e o .gitignore)."

    lines.append(f"\n### Estrutura do projeto ({len(all_files)} arquivos de código):")
    for p in all_files:
        lines.append(f"  {p}")

    # Lê o conteúdo completo de cada arquivo
    lines.append("\n### Conteúdo dos arquivos de código:")
    files_read = 0
    for rel_path in all_files:
        full_path = os.path.join(repo_path, rel_path.replace('/', os.sep))
        try:
            with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            ext = os.path.splitext(rel_path)[1].lstrip('.')
            num_lines = content.count('\n') + 1
            lines.append(f"\n#### {rel_path} ({num_lines} linhas)")
            lines.append(f"```{ext}")
            lines.append(content.rstrip())
            lines.append("```")
            files_read += 1
        except Exception:
            pass

    head = _get_head(repo_path)
    context = '\n'.join(lines)
    print(f"\n  [Repo] {files_read} arquivos lidos | ~{len(context):,} caracteres")
    return context, head, None


def analyze_repo_diff(repo_path, last_commit):
    """
    ANÁLISES SUBSEQUENTES: lê apenas o diff desde o último commit analisado.
    Retorna: (contexto: str | None, head_commit: str | None, sem_mudancas: bool)
    """
    if not os.path.exists(os.path.join(repo_path, '.git')):
        return None, None, False

    head = _get_head(repo_path)
    if not head:
        return None, None, False

    if head == last_commit:
        return None, head, True  # nada mudou

    ignore_patterns = _parse_gitignore(repo_path)
    lines = []

    # Commits novos desde a última análise
    log = _run_git(['log', '--format=%h %s (%ar)', f'{last_commit}..HEAD'], repo_path)
    if log:
        lines.append("### Commits desde a última análise:")
        lines.append(log)

    # Diff completo (com conteúdo das mudanças)
    diff_raw = _run_git(['diff', f'{last_commit}..HEAD'], repo_path, timeout=30)
    if diff_raw:
        lines.append("\n### Diff completo das mudanças:")
        lines.append("```diff")

        # Filtra seções de arquivos ignorados do diff
        keep = True
        for line in diff_raw.split('\n'):
            if line.startswith('diff --git'):
                # Extrai o caminho: "diff --git a/foo b/foo"
                parts = line.split(' b/')
                file_path = parts[-1].strip() if len(parts) > 1 else ''
                keep = not _is_ignored(file_path, ignore_patterns)
            if keep:
                lines.append(line)

        lines.append("```")

    if len(lines) <= 2:
        return None, head, True  # só havia arquivos ignorados

    return '\n'.join(lines), head, False


# ─── Crawler Wix Velo ────────────────────────────────────────────────────────

async def crawl_wix_site(base_url: str, headless: bool = True) -> tuple:
    """
    Crawler recursivo para sites Wix Velo.
    Segue todos os links internos a partir da homepage.
    Usa Playwright puro — zero tokens de IA.
    Retorna: (site_map: dict, page_count: int, erro: str | None)
    """
    from playwright.async_api import async_playwright
    from urllib.parse import urlparse, urljoin, urldefrag

    parsed_base = urlparse(base_url)
    base_domain = parsed_base.netloc

    visited  = set()
    queue    = [base_url]
    pages    = {}
    start_t  = time.time()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )

        try:
            while queue:
                raw_url = queue.pop(0)
                clean_url, _ = urldefrag(raw_url)

                # Normaliza e deduplica
                if clean_url in visited:
                    continue
                # Só processa URLs do mesmo domínio
                parsed = urlparse(clean_url)
                if parsed.netloc and parsed.netloc != base_domain:
                    continue

                visited.add(clean_url)
                path = parsed.path or '/'

                elapsed = int(time.time() - start_t)
                m, s = divmod(elapsed, 60)
                _spin(0, f"Mapeando ({len(pages)+1}): {path}  [{m:02d}:{s:02d}]")

                page = await context.new_page()
                try:
                    await page.goto(clean_url, wait_until='networkidle', timeout=25000)

                    # Tenta fechar banners de cookie (comum em sites Wix)
                    try:
                        for sel in ['button:has-text("Aceitar")', 'button:has-text("Accept")',
                                    '[data-testid="cookie-banner-accept"]']:
                            btn = page.locator(sel).first
                            if await btn.is_visible(timeout=1000):
                                await btn.click()
                                break
                    except Exception:
                        pass

                    # Extrai dados da página via JavaScript
                    data = await page.evaluate('''() => {
                        const getText = el => el?.textContent?.trim() || '';
                        const unique  = arr => [...new Set(arr.filter(Boolean))];

                        // Título
                        const title = document.title || getText(document.querySelector('h1'));

                        // Headings
                        const headings = [];
                        document.querySelectorAll('h1,h2,h3').forEach(h => {
                            const t = getText(h);
                            if (t && t.length < 200) headings.push(h.tagName + ': ' + t);
                        });

                        // Navegação
                        const navItems = [];
                        document.querySelectorAll(
                            'nav a, [role="navigation"] a, [aria-label*="nav" i] a, header a'
                        ).forEach(a => {
                            const t = getText(a);
                            if (t && t.length < 60) navItems.push(t);
                        });

                        // Botões / CTAs
                        const buttons = [];
                        document.querySelectorAll(
                            'button, [role="button"], a[class*="btn"], a[class*="button"]'
                        ).forEach(b => {
                            const t = getText(b);
                            if (t && t.length < 80) buttons.push(t);
                        });

                        // Formulários
                        const forms = [];
                        document.querySelectorAll('form, [data-testid*="form"]').forEach(form => {
                            const fields = [];
                            form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(inp => {
                                const label =
                                    inp.getAttribute('placeholder') ||
                                    inp.getAttribute('aria-label') ||
                                    getText(document.querySelector('label[for="' + inp.id + '"]')) ||
                                    inp.getAttribute('name') || '';
                                if (label) fields.push(label);
                            });
                            const submit = getText(form.querySelector('[type="submit"],button')) || 'Enviar';
                            if (fields.length) forms.push({ fields: unique(fields), submit });
                        });

                        // Links internos
                        const links = [];
                        document.querySelectorAll('a[href]').forEach(a => {
                            const href = a.getAttribute('href');
                            if (href &&
                                !href.startsWith('#') &&
                                !href.startsWith('mailto:') &&
                                !href.startsWith('tel:') &&
                                !href.startsWith('javascript:')) {
                                links.push(href);
                            }
                        });

                        // Componentes Wix (detecta por atributos de data-testid/class)
                        const wixMap = {
                            'Wix Forms':       '[data-testid*="wix-form"], [class*="wixForms"]',
                            'Wix Store':       '[data-testid*="store"], [class*="wixStore"]',
                            'Wix Gallery':     '[data-testid*="gallery"], [class*="proGallery"]',
                            'Wix Members':     '[data-testid*="members"], [class*="members"]',
                            'Wix Bookings':    '[data-testid*="booking"]',
                            'Wix Blog':        '[data-testid*="blog"]',
                            'Wix Chat':        '[data-testid*="chat"]',
                            'Wix Video':       '[data-testid*="video"]',
                            'Lightbox/Modal':  '[data-testid*="lightbox"], [class*="lightBox"]',
                        };
                        const wixComponents = [];
                        for (const [name, sel] of Object.entries(wixMap)) {
                            if (document.querySelector(sel)) wixComponents.push(name);
                        }

                        return {
                            title,
                            headings: unique(headings).slice(0, 8),
                            navItems: unique(navItems).slice(0, 20),
                            buttons:  unique(buttons).slice(0, 20),
                            forms,
                            links,
                            wixComponents,
                        };
                    }''')

                    # Resolve e filtra links internos
                    for href in data.get('links', []):
                        abs_url  = urljoin(clean_url, href)
                        abs_clean, _ = urldefrag(abs_url)
                        pabs = urlparse(abs_clean)
                        # Aceita URLs sem domínio (relativas) ou mesmo domínio
                        if (not pabs.netloc or pabs.netloc == base_domain) and abs_clean not in visited:
                            if abs_clean not in queue:
                                queue.append(abs_clean)

                    pages[path] = {
                        'url':           clean_url,
                        'title':         data.get('title', ''),
                        'headings':      data.get('headings', []),
                        'navigation':    data.get('navItems', []),
                        'buttons':       data.get('buttons', []),
                        'forms':         data.get('forms', []),
                        'wixComponents': data.get('wixComponents', []),
                    }

                except Exception as e:
                    pages[path] = {'url': clean_url, 'error': str(e)[:200]}
                finally:
                    await page.close()

        finally:
            await context.close()
            await browser.close()

    _clear_line()

    site_map = {
        'baseUrl':   base_url,
        'pageCount': len(pages),
        'mappedAt':  datetime.now(timezone.utc).isoformat(),
        'pages':     pages,
    }
    return site_map, len(pages), None


def format_site_map_for_agent(site_map: dict) -> str:
    """
    Converte o mapa JSON do site em texto legível para o prompt do agente.
    """
    if not site_map:
        return ''

    lines = [
        f"### Mapa do Site (mapeado previamente — {site_map.get('pageCount', 0)} páginas)",
        f"Site: {site_map.get('baseUrl', '')}",
        "",
    ]

    for path, page in site_map.get('pages', {}).items():
        if 'error' in page:
            lines.append(f"\n#### {path} ⚠️ erro: {page['error']}")
            continue

        lines.append(f"\n#### {path}  —  {page.get('title', '')}")

        if page.get('navigation'):
            lines.append(f"  Navegação: {' | '.join(page['navigation'][:10])}")
        if page.get('headings'):
            lines.append(f"  Headings: {' · '.join(page['headings'][:5])}")
        if page.get('forms'):
            for f in page['forms']:
                fields_str = ', '.join(f.get('fields', []))
                lines.append(f"  Formulário: [{fields_str}] → [{f.get('submit', 'Enviar')}]")
        if page.get('buttons'):
            lines.append(f"  Botões/CTAs: {', '.join(page['buttons'][:10])}")
        if page.get('wixComponents'):
            lines.append(f"  Componentes Wix: {', '.join(page['wixComponents'])}")

    return '\n'.join(lines)


# ─── Sumário QA do repositório via Cerebras ──────────────────────────────────

CEREBRAS_URL   = "https://api.cerebras.ai/v1/chat/completions"
SAMBANOVA_URL  = "https://api.sambanova.ai/v1/chat/completions"
CEREBRAS_MODEL = "gpt-oss-120b"                    # 3000 tok/s, gratuito no plano free Cerebras
SAMBANOVA_MODEL = "Meta-Llama-3.3-70B-Instruct"   # grátis com $5 de crédito, sem fila de 60s


async def _llm_call(llm_key: str, prompt: str, max_tokens: int = 2048) -> str | None:
    """
    Chama o LLM configurado (Cerebras ou SambaNova) para tarefas de análise
    — sem browser-use, direto via HTTP OpenAI-compatible.
    """
    provider = os.getenv("AI_PROVIDER", "groq").lower().strip()

    if provider == "sambanova":
        url   = SAMBANOVA_URL
        model = os.getenv("SAMBANOVA_MODEL", SAMBANOVA_MODEL)
        fallback = None  # mesmo modelo no fallback para SambaNova
    else:
        # Cerebras (padrão para análise mesmo se provider for groq/deepseek/ollama)
        url   = CEREBRAS_URL
        model = CEREBRAS_MODEL
        fallback = "zai-glm-4.7"

    async with httpx.AsyncClient(timeout=120) as c:
        try:
            r = await c.post(
                url,
                headers={"Authorization": f"Bearer {llm_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": max_tokens,
                }
            )
            data = r.json()
            if r.status_code == 429 and fallback:
                r2 = await c.post(
                    url,
                    headers={"Authorization": f"Bearer {llm_key}", "Content-Type": "application/json"},
                    json={
                        "model": fallback,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": max_tokens,
                    }
                )
                data = r2.json()
            return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip() or None
        except Exception as e:
            err(f"Erro na chamada LLM ({provider}): {e}")
            return None


# Mantém alias para compatibilidade com código existente
_cerebras_call = _llm_call


async def summarize_repo_for_qa(raw_code: str, project_name: str, cerebras_key: str) -> str | None:
    """
    Usa Cerebras para extrair apenas o essencial do repositório para QA.
    Retorna um JSON com rotas, features, auth, endpoints, regras de negócio.
    Esse resumo é salvo em cache — NÃO o código bruto.
    """
    prompt = f"""Você é um assistente de QA analisando o repositório '{project_name}'.

Leia o código abaixo e extraia APENAS o que é relevante para um analista de QA realizar testes manuais.

Responda com um JSON válido (sem markdown, sem explicações) com esta estrutura:
{{
  "projectType": "tipo do projeto (ex: React SPA com API Node, Next.js e-commerce)",
  "mainRoutes": ["lista das rotas/páginas principais encontradas"],
  "keyFeatures": ["funcionalidades principais que podem ser testadas"],
  "authFlow": "como funciona o login/autenticação: campos necessários, endpoint, fluxo completo",
  "apiEndpoints": ["endpoints de API relevantes para testes (método + caminho)"],
  "forms": ["formulários encontrados com seus campos principais"],
  "businessRules": ["regras de negócio importantes para validação durante testes"],
  "knownIssues": ["TODOs, FIXMEs ou código comentado que pode causar problemas"],
  "techStack": "tecnologias principais (brevemente)",
  "testingNotes": "dicas específicas para o analista de QA sobre este projeto"
}}

Código do repositório '{project_name}':
{raw_code[:38000]}"""

    info("🤖 Cerebras analisando repositório — extraindo dados essenciais para QA...")
    result = await _cerebras_call(cerebras_key, prompt, max_tokens=2048)
    return result


async def update_repo_cache_with_diff(
    existing_cache: str, diff_context: str,
    project_name: str, cerebras_key: str
) -> str | None:
    """
    Atualiza o cache QA do repositório com base no git diff mais recente.
    Mantém tudo que não mudou e atualiza apenas o que o diff alterou.
    """
    prompt = f"""Este é o cache QA atual do projeto '{project_name}':
{existing_cache}

Abaixo estão as mudanças recentes no código (git diff):
{diff_context[:18000]}

Atualize o JSON com base nas mudanças. Mantenha todos os campos que não foram afetados.
Responda APENAS com o JSON atualizado, sem markdown ou explicações."""

    info("🤖 Cerebras atualizando cache com as mudanças do repositório...")
    result = await _cerebras_call(cerebras_key, prompt, max_tokens=2048)
    return result


async def estimate_steps_for_test(
    title: str,
    description: str,
    criteria: list,
    has_cache: bool,
    has_repo_cache: bool,
    has_site_map: bool,
    cerebras_key: str,
) -> int:
    """
    Pede ao Cerebras para estimar quantos steps o browser-use vai precisar
    para executar este teste com base nos critérios e na descrição real da feature.
    Retorna um inteiro entre 6 e 25.
    """
    import re as _re

    context_parts = []
    if has_cache:      context_parts.append("cache de navegação do site (sabe onde estão os elementos)")
    if has_repo_cache: context_parts.append("análise do repositório (sabe o que foi implementado)")
    if has_site_map:   context_parts.append("mapa completo do site (conhece todas as páginas)")
    context_str = (
        "Contexto disponível: " + ", ".join(context_parts)
        if context_parts else
        "Nenhum contexto prévio — o agente vai explorar o site do zero."
    )

    criteria_str = "\n".join(f"- {c}" for c in criteria) if criteria else "- Verificação geral de funcionamento"

    prompt = f"""Quantos steps de browser para este teste QA?

Cada step = até 5 ações agrupadas (clicar, digitar, verificar, rolar).
Exemplos: login = 1-2 steps | navegar até a feature = 1-2 steps | verificar critério = 2-4 steps | relatório = 1 step.
Inclua tudo: login, navegação, critérios, relatório.

Task: {title}
Critérios: {criteria_str}
{context_str}

Responda só com o número (entre 10 e 50):"""

    result = await _cerebras_call(cerebras_key, prompt, max_tokens=16)

    if result:
        match = _re.search(r'\b(\d+)\b', result.strip())
        if match:
            n = int(match.group(1))
            estimated = max(10, min(n, 50))
            info(f"🎯 Cerebras estimou {n} steps → usando {estimated}")
            return estimated
        info(f"⚠️  Resposta inesperada da estimativa: '{result.strip()[:40]}' — usando fallback")
    else:
        info("⚠️  Estimativa não retornou resposta — usando fallback")

    # Fallback: 10 base + 5 por critério, máx 50
    fallback = max(10, min(10 + len(criteria) * 5, 50))
    info(f"   Fallback calculado: {fallback} steps")
    return fallback


# ─── Repo: buscar / salvar no backend ────────────────────────────────────────

async def _get_repo_meta(client, backend_url, headers, project_name):
    """Busca a config salva do repo para este projeto."""
    try:
        r = await client.get(
            f"{backend_url}/projects/{project_name}/repo",
            headers=headers, timeout=8
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


async def _save_repo_meta(client, backend_url, headers, project_name, data: dict):
    """Salva/atualiza a config do repo no backend."""
    try:
        await client.put(
            f"{backend_url}/projects/{project_name}/repo",
            headers=headers, json=data, timeout=10
        )
    except Exception:
        pass


async def _get_repo_cache(client, backend_url, headers, project_name):
    """Busca o resumo QA do repositório salvo no backend."""
    try:
        r = await client.get(f"{backend_url}/projects/{project_name}/repo-cache", headers=headers, timeout=8)
        data = r.json() if r.status_code == 200 else None
        return data.get('content') if data else None
    except Exception:
        return None


async def _save_repo_cache(client, backend_url, headers, project_name, content: str):
    """Salva o resumo QA do repositório no backend."""
    try:
        await client.put(
            f"{backend_url}/projects/{project_name}/repo-cache",
            headers={**headers, 'Content-Type': 'application/json'},
            json={"content": content},
            timeout=15
        )
    except Exception as e:
        err(f"Erro ao salvar cache do repositório: {e}")


async def _get_wix_sitemap(client, backend_url, headers, project_name):
    """Busca o mapa de site Wix salvo no backend."""
    try:
        r = await client.get(f"{backend_url}/projects/{project_name}/sitemap", headers=headers, timeout=10)
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


async def _save_wix_sitemap(client, backend_url, headers, project_name, site_map: dict):
    """Salva o mapa de site Wix no backend."""
    import json
    try:
        await client.put(
            f"{backend_url}/projects/{project_name}/sitemap",
            headers={**headers, 'Content-Type': 'application/json'},
            content=json.dumps(site_map),
            timeout=30
        )
    except Exception as e:
        err(f"Erro ao salvar mapa do site: {e}")


# ─── Tool Calls — knowledge base por projeto ──────────────────────────────────

async def _get_tool_call_titles(client, backend_url, headers, project_name):
    """Busca a lista de tool calls (topic+title+description) do projeto no backend."""
    try:
        r = await client.get(
            f"{backend_url}/projects/{project_name}/tools",
            headers=headers, timeout=8
        )
        if r.status_code == 200:
            return r.json()  # [{topic, title, description, source}, ...]
    except Exception:
        pass
    return []


async def _save_tool_call(client, backend_url, headers, project_name,
                          topic: str, title: str, description: str, content: str, source: str = ""):
    """Cria ou atualiza um tool call no backend."""
    try:
        await client.post(
            f"{backend_url}/projects/{project_name}/tools",
            headers={**headers, 'Content-Type': 'application/json'},
            json={"topic": topic, "title": title, "description": description,
                  "content": content, "source": source},
            timeout=10
        )
    except Exception as e:
        err(f"Erro ao salvar tool call '{topic}': {e}")


async def generate_tool_calls_from_repo(raw_code: str, project_name: str, cerebras_key: str) -> list:
    """
    Gera tool calls a partir do código-fonte do repositório.
    Divide em blocos por arquivo, filtra os relevantes (têm rotas/funções/classes)
    e usa Cerebras em lotes de 3 arquivos para extrair tool calls de QA.
    Retorna lista de dicts: [{topic, title, description, content, source}]
    """
    import re, json as _json

    # O raw_code é formatado por analyze_repo_full com \n#### como separador de arquivo
    blocks = re.split(r'\n#### ', raw_code)

    # Detecta arquivos com lógica real (rotas, exports, classes, funções)
    _HAS_LOGIC = re.compile(
        r'(export\s+(default\s+)?(function|class|const|async\s+function)|'
        r'router\.(get|post|put|delete|patch)\s*\(|'
        r'app\.(get|post|put|delete)\s*\(|'
        r'@(Controller|Route|Get|Post|Put|Delete|Patch)\b|'
        r'\bdef\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\()',
        re.MULTILINE
    )

    relevant = []
    for block in blocks:
        if not block.strip() or len(block.strip()) < 120:
            continue
        first_line = block.split('\n')[0]
        file_path  = first_line.split(' (')[0].strip()
        if not file_path:
            continue
        # Só arquivos de lógica — ignora CSS, HTML puro, config simples
        if not any(file_path.endswith(ext) for ext in ('.js', '.ts', '.tsx', '.py', '.jsx', '.mjs', '.cjs')):
            continue
        if _HAS_LOGIC.search(block):
            relevant.append((file_path, block[:2500]))

    if not relevant:
        info("Nenhum arquivo com lógica relevante encontrado para gerar tool calls.")
        return []

    info(f"🔧 Gerando tool calls de {len(relevant)} arquivo(s) em lotes de 3...")

    BATCH = 3
    tool_calls = []

    for i in range(0, len(relevant), BATCH):
        batch      = relevant[i:i + BATCH]
        files_text = ""
        for fp, code in batch:
            files_text += f"\n--- {fp} ---\n{code}\n"

        prompt = f"""Analise estes arquivos e gere ToolCalls relevantes para QA.
Responda APENAS com um array JSON válido (sem markdown, sem explicações).
Máximo 2 ToolCalls por arquivo. Foque em: rotas de API, formulários, autenticação, regras de negócio.
Retorne [] se não houver nada testável.

Estrutura de cada item:
{{
  "topic": "categoria/funcionalidade (ex: auth/login, products/list)",
  "title": "Título curto até 50 chars",
  "description": "Uma frase: o que faz e quando usar",
  "content": "Detalhes para QA: endpoint, campos obrigatórios, comportamento esperado, erros possíveis",
  "source": "nome_do_arquivo.js"
}}

Arquivos:
{files_text}"""

        result = await _cerebras_call(cerebras_key, prompt, max_tokens=1200)

        if result:
            try:
                # Remove markdown code fences se presentes
                clean = result.strip()
                if '```' in clean:
                    clean = re.sub(r'```(?:json)?\n?', '', clean).strip()
                json_match = re.search(r'\[[\s\S]*\]', clean)
                if json_match:
                    items = _json.loads(json_match.group(0))
                    for item in items:
                        if isinstance(item, dict) and all(k in item for k in ('topic', 'title', 'description', 'content')):
                            if 'source' not in item and batch:
                                item['source'] = batch[0][0]
                            tool_calls.append(item)
            except Exception:
                pass

        await asyncio.sleep(0.4)  # respeita rate limit do Cerebras

    info(f"✅ {len(tool_calls)} tool call(s) gerado(s) para '{project_name}'.")
    return tool_calls


def build_tool_call_controller(project_name: str, backend_url: str, headers: dict):
    """
    Cria um Controller do browser-use com duas ações personalizadas:
      - search_project_tools(query) : busca funcionalidades na knowledge base do projeto
      - save_project_tool(...)      : salva uma descoberta durante o teste (Wix)
    Retorna None se a versão do browser-use não suportar Controller.
    """
    try:
        from browser_use import Controller
        from browser_use.agent.views import ActionResult
        from pydantic import BaseModel
    except ImportError:
        try:
            from browser_use.controller.service import Controller
            from browser_use.agent.views import ActionResult
            from pydantic import BaseModel
        except ImportError:
            print("[QA Worker] ⚠️  Controller não disponível — tool calls desativados para esta versão do browser-use")
            return None

    controller = Controller()

    class SearchParams(BaseModel):
        query: str

    class SaveParams(BaseModel):
        topic: str
        title: str
        description: str
        content: str

    @controller.registry.action(
        "Buscar detalhes de uma funcionalidade do projeto na knowledge base. "
        "Use antes de testar qualquer feature para saber endpoints, campos e comportamento esperado.",
        param_model=SearchParams
    )
    async def search_project_tools(params: SearchParams) -> ActionResult:
        import httpx as _httpx
        try:
            async with _httpx.AsyncClient(timeout=8) as c:
                # Busca por texto em topic/title/description
                r = await c.get(
                    f"{backend_url}/projects/{project_name}/tools",
                    headers=headers, params={"q": params.query}
                )
                if r.status_code == 200:
                    tools = r.json()
                    if tools:
                        # Retorna conteúdo completo do primeiro resultado mais relevante
                        r2 = await c.get(
                            f"{backend_url}/projects/{project_name}/tools",
                            headers=headers, params={"topic": tools[0]['topic']}
                        )
                        if r2.status_code == 200 and r2.json():
                            full = r2.json()
                            result_text = (
                                f"[{full['topic']}] {full['title']}\n"
                                f"Descrição: {full.get('description', '')}\n"
                                f"Detalhes:\n{full['content']}"
                            )
                            if len(tools) > 1:
                                result_text += f"\n\nOutros resultados para '{params.query}':\n"
                                result_text += "\n".join(
                                    f"  - [{t['topic']}] {t['title']}" for t in tools[1:4]
                                )
                            return ActionResult(extracted_content=result_text, include_in_memory=True)
        except Exception:
            pass
        return ActionResult(
            extracted_content=f"Nenhuma funcionalidade encontrada para: '{params.query}'",
            include_in_memory=True
        )

    @controller.registry.action(
        "Salvar uma descoberta de funcionalidade do projeto durante o teste. "
        "Use em projetos Wix para registrar páginas, formulários e fluxos encontrados.",
        param_model=SaveParams
    )
    async def save_project_tool(params: SaveParams) -> ActionResult:
        import httpx as _httpx
        try:
            async with _httpx.AsyncClient(timeout=8) as c:
                await c.post(
                    f"{backend_url}/projects/{project_name}/tools",
                    headers={**headers, "Content-Type": "application/json"},
                    json={
                        "topic":       params.topic,
                        "title":       params.title,
                        "description": params.description,
                        "content":     params.content,
                        "source":      "agent_discovery",
                    }
                )
        except Exception:
            pass
        return ActionResult(
            extracted_content=f"Descoberta registrada: [{params.topic}] {params.title}",
            include_in_memory=True
        )

    return controller


def _ask_headless(prompt_text: str) -> bool:
    """Pergunta ao usuário se quer ver o browser. Retorna True = headless (oculto)."""
    resp = input(f"  {prompt_text} [s/n]: ").strip().lower()
    return resp != 's'


async def handle_wix_mapping(client, backend_url, headers, project_name, preview_url,
                              has_sitemap: bool, pending_remap: bool):
    """
    Gerencia o mapeamento Wix Velo.
    - Se há mapa e não foi pedido remap: retorna o mapa existente
    - Se não há mapa: pergunta se quer mapear agora
    - Se pending_remap=True: remapeia (pergunta visibilidade)
    Sempre pergunta se quer ver o browser ao mapear — não salva preferência.
    Retorna: site_map: dict | None
    """
    # Mapa já existe e não há remap pendente — usa o existente
    if has_sitemap and not pending_remap:
        existing = await _get_wix_sitemap(client, backend_url, headers, project_name)
        if existing:
            info(f"🗺️  Usando mapa existente ({existing.get('pageCount', '?')} páginas).")
            return existing

    # Remap pedido via formulário
    if pending_remap:
        info("🔄 Re-mapeamento solicitado pelo usuário.")
        await _save_repo_meta(client, backend_url, headers, project_name, {'pendingRemap': False})
    else:
        # Não há mapa — pergunta se quer mapear
        print()
        info(f"Projeto '{project_name}' é Wix Velo e ainda não foi mapeado.")
        info("O mapeamento lê todas as páginas do site para acelerar os testes futuros.")
        print()
        resp_map = input("  Mapear o site agora? [s/n]: ").strip().lower()
        if resp_map != 's':
            info("Mapeamento pulado. Será perguntado novamente na próxima sessão.")
            return None

    # Pergunta visibilidade — sempre, a cada mapeamento
    print()
    headless = _ask_headless("Deseja visualizar o browser durante o mapeamento?")
    print()
    info(f"Iniciando mapeamento {'em segundo plano' if headless else 'com browser visível'}...")
    info("Aguarde — percorrendo todas as páginas do site...")
    print()

    site_map, count, e = await crawl_wix_site(preview_url, headless=headless)
    if e:
        err(f"Erro no mapeamento: {e}")
        return None

    await _save_wix_sitemap(client, backend_url, headers, project_name, site_map)
    ok(f"Mapeamento concluído — {count} páginas mapeadas.")
    return site_map


async def ensure_repo_path(client, backend_url, headers, project_name):
    """
    Retorna o caminho local do repositório para este projeto.
    Se não houver salvo, pergunta no terminal e valida.
    Retorna None se o usuário pular (Enter em branco).
    """
    meta = await _get_repo_meta(client, backend_url, headers, project_name)
    if meta and meta.get('repoPath'):
        path = meta['repoPath']
        if os.path.exists(path) and os.path.exists(os.path.join(path, '.git')):
            return path
        # Caminho salvo não existe mais — pede novo
        err(f"Caminho salvo não encontrado: {path}")

    print()
    info(f"Repositório local não configurado para o projeto '{project_name}'.")
    info("Cole o caminho da pasta raiz do projeto (onde está o .git).")
    info("Deixe em branco para pular a análise de código neste teste.")
    print()
    repo_path = input("  Caminho do repositório: ").strip().strip('"').strip("'")

    if not repo_path:
        return None

    if not os.path.exists(repo_path):
        err(f"Caminho não encontrado: {repo_path}")
        return None

    if not os.path.exists(os.path.join(repo_path, '.git')):
        err(f"Não é um repositório git (falta a pasta .git): {repo_path}")
        return None

    # Salva no backend para não perguntar de novo
    await _save_repo_meta(client, backend_url, headers, project_name, {'repoPath': repo_path})
    ok(f"Caminho salvo para o projeto '{project_name}'.")
    return repo_path


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

def _extract_approved_from_report(report: str) -> list[str]:
    """
    Extrai os itens aprovados (✅) do relatório para o agente saber
    o que já foi verificado e pode pular no retry.
    """
    import re as _re
    approved = []
    for line in report.split('\n'):
        # Linha com ✅ ou "- **Algo**: ..." dentro da seção APROVADOS
        if '✅' in line or ('- **' in line and 'aprovado' in report[:report.find(line)].lower()):
            clean = _re.sub(r'[*#`]', '', line).strip(' -✅')
            if clean:
                approved.append(clean[:100])
    return approved[:8]  # máx 8 itens


def _ask_analyst_hint(title: str, brief_report: str) -> tuple[str | None, str, bool]:
    """
    Quando o agente falha ou fica inconclusivo, pergunta ao analista
    se quer fornecer uma dica para tentar novamente.
    Retorna (dica, contexto_do_progresso, end_requested).
      - dica        → texto para retry  |  None se Enter ou /end
      - end_requested → True se o analista digitou /end (para tudo agora)
    """
    import re as _re

    print()
    print("  ─────────────────────────────────────────────")
    print(f"  ⚠️  O agente precisou de ajuda em: {title[:60]}")

    # Mostra resumo do que aconteceu
    if brief_report:
        print()
        for line in brief_report.split('\n')[:8]:
            if line.strip():
                print(f"     {line.strip()[:90]}")

    # Extrai o que já foi aprovado para o retry poder pular
    approved = _extract_approved_from_report(brief_report or '')
    progress_ctx = ""
    if approved:
        print()
        info("Já verificado com sucesso neste teste:")
        for item in approved:
            print(f"     ✅ {item}")
        progress_ctx = (
            "\n\n## O QUE JÁ FOI VERIFICADO E APROVADO (pule rapidamente):\n" +
            "\n".join(f"- {a}" for a in approved) +
            "\nVá direto ao ponto que ainda falta verificar."
        )

    print()
    info("Você pode dar uma dica para o agente tentar novamente.")
    info("Exemplos: 'O botão Salvar está no rodapé da página'")
    info("          'Após salvar aparece um toast verde de confirmação'")
    info("          'O item foi salvo, continue para o próximo critério'")
    print()
    info("  Enter    → aceitar resultado e continuar para o próximo critério")
    info("  /end     → aceitar resultado e ENCERRAR o teste agora")
    print()
    hint = input("  Dica (ou Enter · /end): ").strip()
    print()
    end_requested = hint.lower() == '/end'
    return (None if (not hint or end_requested) else hint), progress_ctx, end_requested


# ─── Helpers de critério individual ──────────────────────────────────────────

def _criterion_passed(report: str) -> bool:
    """Determina se um critério foi aprovado baseado no relatório do agente."""
    import re as _re
    if not report:
        return False

    # 1. Linha de CONCLUSÃO — mais confiável
    m = _re.search(r'🏁\s*CONCLUSÃO\s*:\s*(APROVADO|REPROVADO)', report, _re.IGNORECASE)
    if m:
        return m.group(1).upper() == 'APROVADO'

    # 2. Seção REPROVADOS — se tiver itens reais, falhou
    m_rep = _re.search(
        r'❌\s*REPROVADOS?\s*:\s*\n(.*?)(?=\n[⚠️🏁📝\n]|\Z)',
        report, _re.DOTALL | _re.IGNORECASE
    )
    if m_rep:
        section = m_rep.group(1).strip()
        if section and section.lower() not in ('(nenhum)', '- (nenhum)'):
            return False

    # 3. Seção APROVADOS com conteúdo real → aprovado
    m_apr = _re.search(
        r'✅\s*APROVADOS?\s*:\s*\n(.*?)(?=\n❌|\Z)',
        report, _re.DOTALL | _re.IGNORECASE
    )
    if m_apr:
        section = m_apr.group(1).strip()
        if section and section.lower() not in ('(nenhum)', '- (nenhum)'):
            return True

    return False


def _extract_criterion_detail(report: str) -> tuple[str, str, str]:
    """
    Extrai detalhes do relatório de um critério individual.
    Retorna: (detalhe_aprovado, detalhe_reprovado, aviso)
    """
    import re as _re

    def _lines(text: str) -> list[str]:
        return [
            l.strip().lstrip('-').strip()
            for l in text.strip().split('\n')
            if l.strip() and l.strip().lower() not in ('(nenhum)', '- (nenhum)')
        ]

    approved_detail = ''
    failed_detail   = ''
    warning         = ''

    m = _re.search(r'✅\s*APROVADOS?\s*:\s*\n(.*?)(?=\n❌|\n⚠️|\n🏁|\Z)', report, _re.DOTALL | _re.IGNORECASE)
    if m:
        approved_detail = '; '.join(_lines(m.group(1))[:3])

    m = _re.search(r'❌\s*REPROVADOS?\s*:\s*\n(.*?)(?=\n⚠️|\n🏁|\Z)', report, _re.DOTALL | _re.IGNORECASE)
    if m:
        failed_detail = '; '.join(_lines(m.group(1))[:3])

    m = _re.search(r'⚠️\s*AVISOS?\s*:\s*\n(.*?)(?=\n🏁|\Z)', report, _re.DOTALL | _re.IGNORECASE)
    if m:
        warning = '; '.join(_lines(m.group(1))[:2])

    return approved_detail, failed_detail, warning


def _compile_final_report(criterion_results: list) -> tuple[str, bool, str | None]:
    """
    Compila o relatório final a partir dos resultados por critério.
    Retorna: (texto_do_relatório, todos_aprovados, último_cache_update)
    """
    approved_lines    = []
    failed_lines      = []
    warning_lines     = []
    last_cache_update = None

    for cr in criterion_results:
        c = cr['criterion']
        if cr['passed']:
            detail = cr.get('approved_detail', '')
            approved_lines.append(f"- {c}" + (f" — {detail}" if detail else ""))
        else:
            detail = cr.get('failed_detail', '') or cr.get('approved_detail', '')
            failed_lines.append(f"- {c}" + (f" — {detail}" if detail else ""))
        if cr.get('warning'):
            warning_lines.append(f"- {cr['warning']}")
        if cr.get('cache_update'):
            last_cache_update = cr['cache_update']

    all_passed   = len(failed_lines) == 0
    conclusion   = "APROVADO" if all_passed else "REPROVADO"
    passed_count = len(approved_lines)
    total        = len(criterion_results)

    lines = [
        "✅ APROVADOS:",
        *(approved_lines or ["- (nenhum)"]),
        "",
        "❌ REPROVADOS:",
        *(failed_lines or ["- (nenhum)"]),
        "",
        "⚠️ AVISOS:",
        *(warning_lines or ["- (nenhum)"]),
        "",
        f"🏁 CONCLUSÃO: {conclusion} ({passed_count}/{total} critérios verificados individualmente)",
    ]
    return '\n'.join(lines), all_passed, last_cache_update


async def _run_single_criterion(
    job, cerebras_key,
    criterion, criterion_idx, all_criteria,
    site_cache, repo_cache_context, site_map_context,
    test_headless, max_steps,
    client, backend_url, headers, task_id, job_type,
    controller=None,         # Controller do browser-use com search/save tool calls
    tool_call_titles=None,   # índice da knowledge base para o prompt do agente
    login_email=None,        # credencial explícita — prioridade sobre cache
    login_password=None,
) -> dict:
    """
    Executa UM critério. O browser permanece ABERTO durante prompts de dica ou
    extensão de steps — só fecha quando o critério conclui ou o analista digita /end.

    Retorna: {criterion, passed, approved_detail, failed_detail, warning,
              cache_update, tokens, cancelled, end_requested}
    """
    import tempfile as _tmpfile, shutil as _shutil
    from browser_use.browser.profile import BrowserProfile
    from browser_use.browser.session import BrowserSession

    # Cria sessão aqui para reutilizá-la entre tentativas sem fechar o browser
    temp_dir = _tmpfile.mkdtemp(prefix='nocorp_qa_')
    session  = BrowserSession(
        browser_profile=BrowserProfile(headless=test_headless, user_data_dir=temp_dir)
    )
    _timer_paused = asyncio.Event()

    # ── Callback: pergunta mais steps quando esgotam (browser fica aberto) ──
    async def _step_ext_cb() -> int | None:
        _timer_paused.set()
        _clear_line()
        print()
        print("  ─────────────────────────────────────────────")
        info(f"⏸  Steps esgotados — Critério {criterion_idx+1}/{len(all_criteria)}")
        info("O browser está ABERTO — você pode ver o estado atual.")
        print()
        while True:
            raw = input("  Steps adicionais (número · /end para encerrar): ").strip()
            if raw.lower() == '/end':
                _timer_paused.clear()
                return None   # None = /end = encerra
            if raw.isdigit() and int(raw) > 0:
                n = int(raw)
                info(f"▶  Continuando com {n} steps adicionais...")
                print()
                _timer_paused.clear()
                return n
            info("Digite um número de steps ou /end.")

    # ── Executa uma tentativa do agente (reutiliza sessão) ──────────────────
    async def _run_attempt(title_sfx: str, desc: str, no_nav: bool):
        _timer_paused.clear()
        _at = asyncio.create_task(run_qa_agent(
            title=f"{job['title']} {title_sfx}",
            preview_url=job['preview_url'],
            criteria=[criterion],
            project_name=job.get('project_name', ''),
            description=desc,
            knowledge=job.get('knowledge', ''),
            skills=job.get('skills', ''),
            headless=test_headless,
            cerebras_api_key=cerebras_key,
            site_cache=site_cache,
            code_context=repo_cache_context,
            site_map=site_map_context,
            max_steps=max_steps,
            _external_session=session,
            _no_initial_navigate=no_nav,
            step_extension_callback=_step_ext_cb,
            controller=controller,
            tool_call_titles=tool_call_titles,
            login_email=login_email,
            login_password=login_password,
        ))
        _tt = asyncio.create_task(
            _live_timer(f"Crit. {criterion_idx+1}: {criterion[:30]}", pause_event=_timer_paused)
        )
        _ct = asyncio.create_task(
            _watch_cancellation(client, backend_url, headers, task_id, job_type)
        )
        try:
            done, pending = await asyncio.wait({_at, _ct}, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
                try: await t
                except (asyncio.CancelledError, Exception): pass
        finally:
            _tt.cancel()
            try: await _tt
            except asyncio.CancelledError: pass
            _clear_line()

        if _ct in done and _at not in done:
            return {'cancelled': True}
        try:
            return _at.result()
        except Exception as exc:
            return {'success': False, 'report': f'Erro: {exc}', 'tokens_total': 0, 'cache_update': None}

    # ── Loop principal: roda → se falhou → pede dica → roda de novo ────────
    try:
        info("Abrindo Chromium — aguarde...")
        print()

        total_tokens     = 0
        cache_update     = None
        current_desc     = job.get('description', '')
        no_nav           = False   # primeira run: navega; retries: browser já está dentro
        attempt          = 0
        passed           = False
        approved_detail  = failed_detail = warning = ''
        report           = ''

        while True:
            sfx    = (f"[Crit. {criterion_idx+1}/{len(all_criteria)}]"
                      if attempt == 0 else
                      f"[Crit. {criterion_idx+1} — retry {attempt}]")
            result = await _run_attempt(sfx, current_desc, no_nav)

            # Cancelado pelo frontend
            if result.get('cancelled'):
                return {'criterion': criterion, 'passed': False, 'cancelled': True,
                        'end_requested': False, 'cache_update': cache_update, 'tokens': total_tokens}

            # /end após steps esgotados
            if result.get('end_requested'):
                return {'criterion': criterion, 'passed': False, 'cancelled': False,
                        'end_requested': True, 'cache_update': cache_update, 'tokens': total_tokens,
                        'approved_detail': '', 'failed_detail': '', 'warning': ''}

            total_tokens += result.get('tokens_total', 0) or 0
            if result.get('cache_update'):
                cache_update = result['cache_update']

            report  = result.get('report', '')
            passed  = _criterion_passed(report)
            approved_detail, failed_detail, warning = _extract_criterion_detail(report)

            if passed:
                break   # ✅ aprovado — fecha browser e retorna

            # ── Critério falhou: browser ABERTO — pede dica ────────────────
            _timer_paused.set()
            _clear_line()
            print()
            print("  ─────────────────────────────────────────────")
            info(f"⚠️  Critério {criterion_idx+1} falhou — browser ABERTO")

            if report:
                print()
                for line in report.split('\n')[:8]:
                    if line.strip():
                        print(f"     {line.strip()[:90]}")

            approved_so_far = _extract_approved_from_report(report)
            if approved_so_far:
                print()
                info("Já verificado com sucesso:")
                for a in approved_so_far:
                    print(f"     ✅ {a}")

            print()
            info("Digite uma dica para o agente, ou /end para encerrar o teste.")
            info("Exemplos: 'O botão Salvar está no rodapé da página'")
            info("          'Após salvar aparece um toast verde'")
            print()

            hint = ''
            while True:
                hint = input("  Dica (ou /end): ").strip()
                if hint.lower() == '/end':
                    return {'criterion': criterion, 'passed': False, 'cancelled': False,
                            'end_requested': True, 'cache_update': cache_update,
                            'tokens': total_tokens, 'approved_detail': approved_detail,
                            'failed_detail': failed_detail, 'warning': warning}
                if hint:
                    break
                info("Digite uma dica ou /end.")

            attempt     += 1
            no_nav       = True   # browser já está dentro do app — não navega de volta
            current_desc = job.get('description', '') + f"\n\n## DICA DO ANALISTA (tentativa {attempt}):\n{hint}"
            info(f"🔄 Retentando critério {criterion_idx+1} com a dica...")
            print()

        return {
            'criterion':       criterion,
            'passed':          passed,
            'approved_detail': approved_detail,
            'failed_detail':   failed_detail,
            'warning':         warning,
            'cache_update':    cache_update,
            'tokens':          total_tokens,
            'cancelled':       False,
            'end_requested':   False,
        }

    finally:
        # Browser fecha AQUI — mantido aberto durante todo o processo acima
        try: await session.stop()
        except Exception: pass
        try: _shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception: pass


def _clear_line():
    sys.stdout.write('\r' + ' ' * 72 + '\r')
    sys.stdout.flush()

def _spin(idx, msg):
    frame = SPINNER[idx % len(SPINNER)]
    sys.stdout.write(f'\r  {frame}  {msg}')
    sys.stdout.flush()


# ─── Atualização ──────────────────────────────────────────────────────────────

async def check_update(client):
    """
    Verifica se há nova versão e, se houver, pergunta ao usuário se quer atualizar.
    Baixa APENAS os arquivos de código (.py + version.txt) — sem tocar no venv.
    """
    try:
        r = await client.get(VERSION_URL, timeout=5)
        remote = r.text.strip()
        if not remote or remote == LOCAL_VERSION:
            return  # já está na versão mais recente
    except Exception:
        return  # falha silenciosa — sem internet ou GitHub fora

    print()
    print(f"  🔄 Nova versão disponível: {remote}  (atual: {LOCAL_VERSION})")
    resp = input("  Atualizar agora? [s/n]: ").strip().lower()
    if resp != 's':
        print()
        return

    script_dir = os.path.dirname(os.path.abspath(__file__))
    failed = []

    print()
    for fname in UPDATE_FILES:
        url = f"{RAW_BASE}/{fname}"
        try:
            r = await client.get(url, timeout=30)
            if r.status_code == 200:
                dest = os.path.join(script_dir, fname)
                with open(dest, 'wb') as f:
                    f.write(r.content)
                print(f"  ✅ {fname}")
            else:
                failed.append(fname)
                print(f"  ❌ {fname}  (HTTP {r.status_code})")
        except Exception as e:
            failed.append(fname)
            print(f"  ❌ {fname}  ({e})")

    print()
    if failed:
        print(f"  ⚠️  {len(failed)} arquivo(s) não puderam ser baixados.")
        print("     Rode o instalador manualmente se o problema persistir.")
    else:
        # Corrige o modelo no .env se estava desatualizado (ex: llama3.1-8b de versões antigas)
        _patch_env_model_on_update(script_dir)
        ok(f"Atualização concluída — versão {remote} instalada.")
        print()
        print("  ↩  Reiniciando o agente para aplicar as mudanças...")
        print()
        # Reinicia o próprio processo com os mesmos argumentos
        os.execv(sys.executable, [sys.executable] + sys.argv)



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
    try:
        r = await client.get(
            f"{backend_url}/qa-jobs/pending",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        return r.status_code != 401
    except Exception:
        return False


# ─── Cerebras key ─────────────────────────────────────────────────────────────

def _update_env_provider(provider: str):
    """Atualiza ou insere AI_PROVIDER no .env local."""
    import re as _re
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    try:
        content = ''
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                content = f.read()
        if 'AI_PROVIDER=' in content:
            content = _re.sub(r'^AI_PROVIDER=.*$', f'AI_PROVIDER={provider}',
                               content, flags=_re.MULTILINE)
        else:
            content += f'\nAI_PROVIDER={provider}\n'
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write(content)
        os.environ['AI_PROVIDER'] = provider
    except Exception:
        pass


def _update_env_cerebras_key(new_key: str):
    """Atualiza CEREBRAS_API_KEY no .env local se o arquivo existir."""
    import re as _re
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            content = f.read()
        new_content = _re.sub(
            r'^CEREBRAS_API_KEY=.*$',
            f'CEREBRAS_API_KEY={new_key}',
            content, flags=_re.MULTILINE
        )
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
    except Exception:
        pass


def _update_env_sambanova_key(new_key: str):
    """Salva SAMBANOVA_API_KEY no .env local (insere se não existir)."""
    import re as _re
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    try:
        content = ''
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                content = f.read()
        if 'SAMBANOVA_API_KEY=' in content:
            content = _re.sub(r'^SAMBANOVA_API_KEY=.*$', f'SAMBANOVA_API_KEY={new_key}',
                               content, flags=_re.MULTILINE)
        else:
            content += f'\nSAMBANOVA_API_KEY={new_key}\n'
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write(content)
        os.environ['SAMBANOVA_API_KEY'] = new_key  # atualiza sessão atual também
    except Exception:
        pass


def ensure_sambanova_key(session_data):
    """Garante que a SAMBANOVA_API_KEY está disponível. Pede ao usuário se necessário."""
    env_key = os.getenv("SAMBANOVA_API_KEY", "").strip()
    if env_key:
        return env_key

    key = session_data.get("sambanova_key")
    if key:
        return key

    print()
    info("Você precisa de uma API key da SambaNova (gratuita, sem cartão).")
    info("Crie a sua em: https://cloud.sambanova.ai  → API → Generate API Key")
    print()
    key = input("  Cole sua SambaNova API key: ").strip()

    while not key:
        err("Chave inválida — não pode ser vazia")
        key = input("  Cole sua SambaNova API key: ").strip()

    session_data["sambanova_key"] = key
    sess.save(session_data)
    _update_env_sambanova_key(key)
    ok("Chave SambaNova salva (sessão + .env).")
    return key


def _patch_env_model_on_update(script_dir: str = None):
    """
    Corrige CEREBRAS_MODEL no .env quando o valor atual não está disponível no free tier.
    Chamado após auto-update e também na inicialização, para cobrir .envs antigos.
    Modelos removidos do free tier: llama3.1-8b, llama3.3-70b e variações.
    """
    import re as _re
    _dir = script_dir or os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(_dir, '.env')
    if not os.path.exists(env_path):
        return
    _UNAVAILABLE = {
        'llama3.1-8b', 'llama3.3-70b',
        'llama-3.3-70b', 'llama-3.1-8b',
        'llama3.1-70b', 'llama-3.1-70b',
    }
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            content = f.read()
        m = _re.search(r'^CEREBRAS_MODEL=(.+)$', content, _re.MULTILINE)
        if not m:
            return  # variável não está no .env — o padrão do código já é gpt-oss-120b
        current_model = m.group(1).strip().strip('"').strip("'")
        if current_model not in _UNAVAILABLE:
            return  # modelo OK
        new_content = _re.sub(
            r'^CEREBRAS_MODEL=.*$',
            'CEREBRAS_MODEL=gpt-oss-120b',
            content, flags=_re.MULTILINE
        )
        with open(env_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  ✅ .env corrigido: CEREBRAS_MODEL {current_model} → gpt-oss-120b")
        # Atualiza variável de ambiente da sessão atual também
        os.environ['CEREBRAS_MODEL'] = 'gpt-oss-120b'
    except Exception:
        pass


def ensure_cerebras_key(session_data):
    # .env tem prioridade → basta editar o arquivo para trocar a chave
    env_key = os.getenv("CEREBRAS_API_KEY", "").strip()
    if env_key and env_key.startswith("csk-"):
        return env_key

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
    _update_env_cerebras_key(key)
    ok("Chave salva com segurança (sessão criptografada + .env).")
    return key


# ─── Timer ao vivo durante execução ───────────────────────────────────────────

async def _live_timer(title, pause_event: asyncio.Event = None):
    start = time.time()
    spin  = 0
    short = title[:35] + '…' if len(title) > 35 else title
    try:
        while True:
            if pause_event is None or not pause_event.is_set():
                elapsed = int(time.time() - start)
                m, s = divmod(elapsed, 60)
                _spin(spin, f"Analisando: {short}  [{m:02d}:{s:02d}]")
                spin += 1
            await asyncio.sleep(0.3)
    except asyncio.CancelledError:
        pass


# ─── Watcher de cancelamento ──────────────────────────────────────────────────

async def _watch_cancellation(client, backend_url, headers, task_id, job_type):
    """
    Verifica a cada CANCEL_INTERVAL segundos se o job ainda existe no backend.
    Retorna quando o job for cancelado/deletado pelo usuário no frontend.
    """
    await asyncio.sleep(CANCEL_INTERVAL)  # primeira verificação após alguns segundos

    while True:
        try:
            if job_type == 'dev_test':
                r = await client.get(
                    f"{backend_url}/dev-tests/{task_id}",
                    headers=headers, timeout=8
                )
                if r.status_code == 404:
                    return  # deletado pelo usuário
                data = r.json()
                if data and data.get('status') not in ('running', 'queued'):
                    return  # mudou de estado inesperadamente

            else:  # qa_task
                r = await client.get(
                    f"{backend_url}/tasks/{task_id}/ai-report",
                    headers=headers, timeout=8
                )
                data = r.json()
                if data is None:
                    return  # AIReport deletado (clearAiReport no frontend)
                if data.get('status') not in ('running',):
                    return  # status mudou (ex: foi sobrescrito)

        except asyncio.CancelledError:
            raise  # propaga cancelamento normalmente
        except Exception:
            pass  # erro de rede — continua verificando

        await asyncio.sleep(CANCEL_INTERVAL)


# ─── Execução de um job ───────────────────────────────────────────────────────

async def run_job(client, backend_url, headers, job, cerebras_key):
    task_id       = job["task_id"]
    job_type      = job.get("type", "qa_task")
    project_name  = job.get("project_name", "")
    site_cache    = job.get("site_cache")   # conhecimento prévio do site (pode ser None)
    login_email   = job.get("login_email")  # credencial explícita — prioridade sobre cache
    login_password = job.get("login_password")

    # Reivindica o job (queued → running)
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
    if project_name:
        cache_status = "✅ cache disponível" if site_cache else "⬜ sem cache (será criado)"
        info(f"Projeto: {project_name}  [{cache_status}]")
    criterios = job.get("criteria", [])
    if criterios:
        info(f"Critérios: {len(criterios)} item(s)")
    print()

    # ── Mapeamento Wix Velo (se aplicável) ───────────────────────────────
    site_map_context = None
    project_type  = job.get('project_type')
    has_sitemap   = job.get('has_sitemap', False)
    pending_remap = job.get('pending_remap', False)
    crawl_headless = job.get('crawl_headless', True)

    if project_name and project_type == 'wix_velo':
        wix_map = await handle_wix_mapping(
            client, backend_url, headers,
            project_name, job['preview_url'],
            has_sitemap, pending_remap
        )
        if wix_map:
            site_map_context = format_site_map_for_agent(wix_map)

    # ── Análise de repositório (Wix Headless ou Repo) ─────────────────────
    # O worker lê o código completo mas passa ao agente apenas um RESUMO QA
    # gerado pela Cerebras — não o código bruto. O resumo é salvo em cache
    # e reutilizado (só o diff atualiza o cache nas próximas execuções).
    repo_cache_context = job.get('repo_cache')  # cache já salvo, se houver
    new_head = None
    raw_code = None  # código-fonte bruto — preenchido apenas na primeira análise completa

    if project_name and project_type in ('wix_headless', 'repo'):
        repo_path = await ensure_repo_path(client, backend_url, headers, project_name)

        if repo_path:
            repo_meta   = await _get_repo_meta(client, backend_url, headers, project_name)
            last_commit = repo_meta.get('lastCommit') if repo_meta else None

            if not last_commit or not repo_cache_context:
                # Primeira análise — lê tudo e resume via Cerebras
                info("🔍 Primeira análise — lendo repositório completo...")
                print()
                raw_code, new_head, repo_err = analyze_repo_full(repo_path)  # raw_code usado depois para gerar tool calls
                if repo_err:
                    err(f"Repositório: {repo_err}")
                elif raw_code:
                    file_count = raw_code.count('\n#### ')
                    print()
                    summary = await summarize_repo_for_qa(raw_code, project_name, cerebras_key)
                    if summary:
                        await _save_repo_cache(client, backend_url, headers, project_name, summary)
                        await _save_repo_meta(client, backend_url, headers, project_name, {
                            'lastCommit': new_head,
                            'analyzedAt': datetime.now(timezone.utc).isoformat(),
                            'fileCount':  file_count,
                        })
                        repo_cache_context = summary
                        ok(f"Cache QA criado — {file_count} arquivos resumidos para o agente.")
                    else:
                        err("Não foi possível gerar o resumo. Teste prossegue sem contexto de código.")
            else:
                # Análises subsequentes — só o diff atualiza o cache
                info("📊 Verificando mudanças de código desde a última análise...")
                diff_context, new_head, no_changes = analyze_repo_diff(repo_path, last_commit)
                if no_changes:
                    info("Sem mudanças de código — usando cache QA existente.")
                elif diff_context:
                    print()
                    updated = await update_repo_cache_with_diff(
                        repo_cache_context, diff_context, project_name, cerebras_key
                    )
                    if updated:
                        await _save_repo_cache(client, backend_url, headers, project_name, updated)
                        await _save_repo_meta(client, backend_url, headers, project_name, {
                            'lastCommit': new_head,
                            'analyzedAt': datetime.now(timezone.utc).isoformat(),
                        })
                        repo_cache_context = updated
                        ok("Cache QA atualizado com as mudanças.")
                    else:
                        info("Erro ao atualizar cache — usando versão anterior.")
        print()

    # ── Tool Calls: carrega ou gera knowledge base do projeto ────────────
    # Prioridade: tool_call_titles já vem no job (/pending os inclui se existirem).
    # Se vierem vazios, busca do backend. Se ainda vazio e temos raw_code, gera agora.
    tool_call_titles = job.get('tool_call_titles') or []

    if project_name and not tool_call_titles:
        existing_tools = await _get_tool_call_titles(client, backend_url, headers, project_name)
        if existing_tools:
            tool_call_titles = [
                f"[{t['topic']}] {t['title']}: {t['description']}" for t in existing_tools
            ]
            info(f"📚 Knowledge base: {len(tool_call_titles)} funcionalidades carregadas.")
        elif raw_code:
            # Primeira vez com repo: gera tool calls automaticamente
            info("🔧 Gerando knowledge base do projeto a partir do repositório...")
            print()
            tc_list = await generate_tool_calls_from_repo(raw_code, project_name, cerebras_key)
            if tc_list:
                for tc in tc_list:
                    await _save_tool_call(
                        client, backend_url, headers, project_name,
                        tc['topic'], tc['title'],
                        tc.get('description', ''), tc['content'], tc.get('source', '')
                    )
                ok(f"Knowledge base criada — {len(tc_list)} funcionalidades salvas.")
                tool_call_titles = [
                    f"[{tc['topic']}] {tc['title']}: {tc.get('description', '')}" for tc in tc_list
                ]
            print()

    # Controller: ações search_project_tools + save_project_tool para o agente
    controller = build_tool_call_controller(project_name, backend_url, headers) if project_name else None

    # ── Estimativa inteligente de steps ──────────────────────────────────
    info("🤖 Estimando steps necessários para o teste...")
    estimated_steps = await estimate_steps_for_test(
        title=job["title"],
        description=job.get("description", ""),
        criteria=criterios,
        has_cache=bool(site_cache),
        has_repo_cache=bool(repo_cache_context),
        has_site_map=bool(site_map_context),
        cerebras_key=cerebras_key,
    )
    print()

    # Pergunta visibilidade do browser — uma vez para todos os critérios
    test_headless = _ask_headless("Deseja visualizar o browser durante o teste?")
    print()

    # ── MODO CHECKPOINT: cada critério é uma sessão independente ──────────
    # Se o critério N falha, só ele reabre — 1..N-1 já estão salvos.
    if criterios:
        per_criterion_steps = max(20, (estimated_steps // len(criterios)) + 10)
        info(f"📋 Checkpoints: {len(criterios)} critério(s) | ~{per_criterion_steps} steps · 5 ações/step cada")
        print()

        criterion_results: list = []
        accumulated_cache = site_cache
        cancelled         = False

        for i, criterion in enumerate(criterios):
            print()
            sep = '─' * max(1, 37 - len(f"{i+1}/{len(criterios)}"))
            print(f"  ─── Critério {i+1}/{len(criterios)} {sep}")
            info(f"▶  {criterion[:80]}")
            print()

            cr = await _run_single_criterion(
                job=job,
                cerebras_key=cerebras_key,
                criterion=criterion,
                criterion_idx=i,
                all_criteria=criterios,
                site_cache=accumulated_cache,
                repo_cache_context=repo_cache_context,
                site_map_context=site_map_context,
                test_headless=test_headless,
                max_steps=per_criterion_steps,
                client=client,
                backend_url=backend_url,
                headers=headers,
                task_id=task_id,
                job_type=job_type,
                controller=controller,
                tool_call_titles=tool_call_titles,
                login_email=login_email,
                login_password=login_password,
            )

            if cr.get('cancelled'):
                info("Análise cancelada pelo usuário.")
                cancelled = True
                break

            # Cache cresce: cada critério aprende sobre o site e passa adiante
            if cr.get('cache_update'):
                accumulated_cache = cr['cache_update']

            icon  = "✅" if cr['passed'] else "❌"
            label = "APROVADO" if cr['passed'] else "REPROVADO"
            info(f"{icon} Critério {i+1}/{len(criterios)}: {label}")
            criterion_results.append(cr)

            if cr.get('end_requested'):
                info(f"🛑 Teste encerrado em critério {i+1}/{len(criterios)} — compilando resultado parcial.")
                break

        # Cancelado antes de qualquer resultado — nada a enviar
        if not criterion_results:
            print()
            print("  ─────────────────────────────────────────────")
            print()
            return

        if cancelled:
            info(f"Interrompido — {len(criterion_results)}/{len(criterios)} critérios executados.")

        # Compila relatório final a partir dos checkpoints
        print()
        report, all_passed, cache_update = _compile_final_report(criterion_results)
        status = "done"
        tokens = sum(cr.get('tokens', 0) for cr in criterion_results)

        approved_count = sum(1 for cr in criterion_results if cr['passed'])
        total_ran      = len(criterion_results)
        if all_passed:
            ok(f"Resultado: {approved_count}/{total_ran} APROVADOS")
        else:
            err(f"Resultado: {approved_count} APROVADOS, {total_ran - approved_count} REPROVADOS de {total_ran}")

    else:
        # ── MODO LEGADO: sem critérios — agent único ──────────────────────
        info("Abrindo Chromium — aguarde...")
        print()

        agent_task  = asyncio.create_task(run_qa_agent(
            title=job["title"],
            preview_url=job["preview_url"],
            criteria=criterios,
            project_name=project_name,
            description=job.get("description", ""),
            knowledge=job.get("knowledge", ""),
            skills=job.get("skills", ""),
            headless=test_headless,
            cerebras_api_key=cerebras_key,
            site_cache=site_cache,
            code_context=repo_cache_context,
            site_map=site_map_context,
            max_steps=estimated_steps,
            controller=controller,
            tool_call_titles=tool_call_titles,
            login_email=login_email,
            login_password=login_password,
        ))
        timer_task  = asyncio.create_task(_live_timer(job["title"]))
        cancel_task = asyncio.create_task(
            _watch_cancellation(client, backend_url, headers, task_id, job_type)
        )

        try:
            done, pending = await asyncio.wait(
                {agent_task, cancel_task},
                return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
        finally:
            timer_task.cancel()
            try:
                await timer_task
            except asyncio.CancelledError:
                pass
            _clear_line()

        if cancel_task in done and agent_task not in done:
            print()
            info("Análise cancelada pelo usuário.")
            print("  ─────────────────────────────────────────────")
            print()
            return

        try:
            result       = agent_task.result()
            status       = "done" if result["success"] else "error"
            report       = result["report"]
            tokens       = result.get("tokens_total")
            cache_update = result.get("cache_update")
        except Exception as e:
            status, report, tokens, cache_update = "error", f"Erro inesperado no agente: {e}", None, None

        # Pergunta ao analista se quer dar uma dica e tentar de novo
        should_ask = (
            status == "error" or
            (report and any(w in report.lower() for w in [
                'não foi possível', 'não encontrou', 'não conseguiu',
                'travado', 'timeout', 'elemento não', 'step limit',
            ]))
        )
        if should_ask:
            hint, progress_ctx, _ = _ask_analyst_hint(job["title"], report or "")
            if hint:
                info("🔄 Tentando novamente com sua dica...")
                print()
                extra_context = (
                    progress_ctx +
                    f"\n\n## DICA DO ANALISTA — leia antes de começar:\n{hint}\n"
                )
                retry_task = asyncio.create_task(run_qa_agent(
                    title=job["title"],
                    preview_url=job["preview_url"],
                    criteria=criterios,
                    project_name=project_name,
                    description=job.get("description", "") + extra_context,
                    knowledge=job.get("knowledge", ""),
                    skills=job.get("skills", ""),
                    headless=test_headless,
                    cerebras_api_key=cerebras_key,
                    site_cache=site_cache,
                    code_context=repo_cache_context,
                    site_map=site_map_context,
                    max_steps=estimated_steps + 5,
                    login_email=login_email,
                    login_password=login_password,
                ))
                timer2 = asyncio.create_task(_live_timer(f"[Retry] {job['title']}"))
                try:
                    retry_result = await retry_task
                    status       = "done" if retry_result["success"] else "error"
                    report       = retry_result["report"]
                    tokens       = (tokens or 0) + (retry_result.get("tokens_total") or 0)
                    cache_update = retry_result.get("cache_update") or cache_update
                except Exception as e2:
                    info(f"Retry também falhou: {e2}")
                finally:
                    timer2.cancel()
                    try: await timer2
                    except: pass
                    _clear_line()

    if cache_update and project_name:
        info(f"🗃️  Cache do projeto '{project_name}' será atualizado.")

    # Monta body do resultado
    result_body = {"status": status, "report": report, "tokensUsed": tokens, "type": job_type}
    if cache_update and project_name:
        result_body["siteCache"]    = cache_update
        result_body["projectName"]  = project_name

    # Envia resultado
    sys.stdout.write("  /  Enviando relatório...")
    sys.stdout.flush()
    try:
        await client.post(
            f"{backend_url}/qa-jobs/{task_id}/result",
            headers=headers,
            json=result_body,
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


# ─── Menu de configurações ────────────────────────────────────────────────────

def _startup_menu(session_data: dict) -> tuple[bool, bool]:
    """
    Exibe o menu de início com o status atual da sessão.
    Retorna (trocar_usuario, trocar_llm_key).
    """
    email    = session_data.get("email", "")
    has_jwt  = bool(session_data.get("jwt"))
    provider = os.getenv("AI_PROVIDER", "groq").lower().strip()

    # Monta display da chave LLM de acordo com o provider configurado
    if provider == "sambanova":
        key = os.getenv("SAMBANOVA_API_KEY", "").strip() or session_data.get("sambanova_key", "")
        provider_label = "SambaNova"
    else:
        key = os.getenv("CEREBRAS_API_KEY", "").strip() or session_data.get("cerebras_key", "")
        provider_label = "Cerebras"

    if key and len(key) > 12:
        key_display = f"{key[:8]}...{key[-4:]}"
        key_source  = "(.env)" if (os.getenv("SAMBANOVA_API_KEY") if provider == "sambanova" else os.getenv("CEREBRAS_API_KEY")) else "(sessão)"
    elif key:
        key_display = "configurada"
        key_source  = ""
    else:
        key_display = "não configurada"
        key_source  = ""

    print()
    print("  ┌─────────────────────────────────────────┐")
    if email and has_jwt:
        user_line = f"  👤 {email}"
        print(f"  │  {user_line:<43}│")
    else:
        print("  │  👤 Nenhuma sessão salva               │")
    key_line = f"  🔑 {provider_label}: {key_display} {key_source}".strip()
    print(f"  │  {key_line:<43}│")
    prov_line = f"  🤖 Provider: {provider}"
    print(f"  │  {prov_line:<43}│")
    print("  └─────────────────────────────────────────┘")
    print()
    print("  [Enter]  Iniciar análises")
    print("  [1]      Trocar usuário")
    print(f"  [2]      Trocar chave {provider_label}")
    print()

    choice = input("  > ").strip()
    print()
    return choice == "1", choice == "2"


# ─── Loop principal ───────────────────────────────────────────────────────────

async def main():
    banner()
    backend_url  = DEFAULT_BACKEND
    session_data = sess.load()

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as client:

        info("Conectando ao backend...")
        await wait_for_backend(client, f"{backend_url}/")
        ok("Backend online.")
        print()

        await check_update(client)

        # ── Menu de configurações ─────────────────────────────────────────
        trocar_usuario, trocar_cerebras = _startup_menu(session_data)

        if trocar_usuario:
            session_data.pop("jwt",   None)
            session_data.pop("email", None)
            sess.save(session_data)
            ok("Sessão de usuário removida.")
            print()

        if trocar_cerebras:
            # Pergunta qual provider antes de pedir a chave
            print()
            print("  Escolha o provider de IA:")
            print("  [1]  Cerebras  — grátis, 1M tokens/dia (pode ter fila de 60s)")
            print("  [2]  SambaNova — grátis com $5 de crédito, sem fila")
            print()
            prov_choice = input("  Provider [1/2]: ").strip()
            print()

            if prov_choice == "2":
                # SambaNova
                session_data.pop("sambanova_key", None)
                sess.save(session_data)
                info("Crie ou consulte sua chave em: https://cloud.sambanova.ai → API")
                print()
                new_key = input("  SambaNova API key: ").strip()
                while not new_key:
                    err("Chave inválida — não pode ser vazia")
                    new_key = input("  SambaNova API key: ").strip()
                session_data["sambanova_key"] = new_key
                sess.save(session_data)
                _update_env_sambanova_key(new_key)
                _update_env_provider("sambanova")
                ok("SambaNova configurada e salva (.env).")
                print()
            else:
                # Cerebras (padrão)
                session_data.pop("cerebras_key", None)
                sess.save(session_data)
                info("Crie uma chave gratuita em: https://cloud.cerebras.ai")
                print()
                new_key = input("  Cerebras API key (csk-...): ").strip()
                while not new_key.startswith("csk-"):
                    err("Chave inválida — deve começar com 'csk-'")
                    new_key = input("  Cerebras API key (csk-...): ").strip()
                session_data["cerebras_key"] = new_key
                sess.save(session_data)
                _update_env_cerebras_key(new_key)
                _update_env_provider("cerebras")
                ok("Cerebras configurada e salva (.env).")
                print()

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

        # 2. Chave do provider LLM — usa o provider configurado no .env (AI_PROVIDER)
        # O menu [2] acima já permite trocar o provider e a chave de forma interativa.
        _active_provider = os.getenv("AI_PROVIDER", "groq").lower().strip()
        if _active_provider == "sambanova":
            cerebras_key = ensure_sambanova_key(session_data)
            ok("SambaNova configurada.")
        else:
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

        spin_idx    = 0
        retry_count = 0

        while True:
            try:
                r = await client.get(f"{backend_url}/qa-jobs/pending", headers=headers)
                retry_count = 0

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
                if retry_count >= 3:
                    _spin(spin_idx, "Reconectando ao backend...")
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
