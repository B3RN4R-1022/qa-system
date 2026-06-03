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

load_dotenv()

LOCAL_VERSION = "1.3.2"
DEFAULT_BACKEND = os.getenv("BACKEND_URL", "https://qa-system-5vpf.onrender.com").rstrip("/")
VERSION_URL = "https://raw.githubusercontent.com/B3RN4R-1022/qa-system/master/qa-agent/version.txt"
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

CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
CEREBRAS_MODEL = "gpt-oss-120b"


async def _cerebras_call(cerebras_key: str, prompt: str, max_tokens: int = 2048) -> str | None:
    """Chama Cerebras diretamente (sem browser-use) para tarefas de análise."""
    async with httpx.AsyncClient(timeout=120) as c:
        try:
            r = await c.post(
                CEREBRAS_URL,
                headers={"Authorization": f"Bearer {cerebras_key}", "Content-Type": "application/json"},
                json={
                    "model": CEREBRAS_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": max_tokens,
                }
            )
            data = r.json()
            if r.status_code == 429:
                # fallback model
                r2 = await c.post(
                    CEREBRAS_URL,
                    headers={"Authorization": f"Bearer {cerebras_key}", "Content-Type": "application/json"},
                    json={
                        "model": "zai-glm-4.7",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": max_tokens,
                    }
                )
                data = r2.json()
            return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip() or None
        except Exception as e:
            err(f"Erro na chamada Cerebras: {e}")
            return None


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


async def handle_wix_mapping(client, backend_url, headers, project_name, preview_url,
                              has_sitemap: bool, pending_remap: bool, crawl_headless: bool):
    """
    Gerencia o mapeamento Wix Velo.
    - Se há mapa e não foi pedido remap: retorna o mapa existente
    - Se não há mapa: pergunta se quer mapear agora
    - Se pending_remap=True: remapeia automaticamente
    Retorna: (site_map: dict | None, headless_preference: bool)
    """
    # Remap pedido via formulário — remapeia sem perguntar
    if pending_remap:
        info("🔄 Re-mapeamento solicitado pelo usuário.")
        await _save_repo_meta(client, backend_url, headers, project_name, {'pendingRemap': False})
        site_map, count, e = await crawl_wix_site(preview_url, headless=crawl_headless)
        if e:
            err(f"Erro no mapeamento: {e}")
            return None, crawl_headless
        await _save_wix_sitemap(client, backend_url, headers, project_name, site_map)
        ok(f"Re-mapeamento concluído — {count} páginas.")
        return site_map, crawl_headless

    # Mapa já existe e não há remap pendente — usa o existente
    if has_sitemap:
        existing = await _get_wix_sitemap(client, backend_url, headers, project_name)
        if existing:
            info(f"🗺️  Usando mapa existente ({existing.get('pageCount', '?')} páginas).")
            return existing, crawl_headless

    # Não há mapa — pergunta ao usuário
    print()
    info(f"Projeto '{project_name}' é Wix Velo e ainda não foi mapeado.")
    info("O mapeamento lê todas as páginas do site para acelerar os testes futuros.")
    print()

    resp_map = input("  Mapear o site agora? [s/n]: ").strip().lower()
    if resp_map != 's':
        info("Mapeamento pulado. Será perguntado novamente na próxima sessão.")
        return None, crawl_headless

    # Pergunta preferência de visibilidade do browser (salva por projeto)
    print()
    resp_vis = input("  Deseja visualizar o browser durante o mapeamento? [s/n]: ").strip().lower()
    headless = resp_vis != 's'

    # Salva preferência
    await _save_repo_meta(client, backend_url, headers, project_name, {'crawlHeadless': headless})

    print()
    info(f"Iniciando mapeamento {'em segundo plano' if headless else 'com browser visível'}...")
    info("Aguarde — percorrendo todas as páginas do site...")
    print()

    site_map, count, e = await crawl_wix_site(preview_url, headless=headless)
    if e:
        err(f"Erro no mapeamento: {e}")
        return None, headless

    await _save_wix_sitemap(client, backend_url, headers, project_name, site_map)
    ok(f"Mapeamento concluído — {count} páginas mapeadas.")
    return site_map, headless


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
    start = time.time()
    spin  = 0
    short = title[:35] + '…' if len(title) > 35 else title
    try:
        while True:
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
    task_id      = job["task_id"]
    job_type     = job.get("type", "qa_task")
    project_name = job.get("project_name", "")
    site_cache   = job.get("site_cache")  # conhecimento prévio do site (pode ser None)

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
        wix_map, _ = await handle_wix_mapping(
            client, backend_url, headers,
            project_name, job['preview_url'],
            has_sitemap, pending_remap, crawl_headless
        )
        if wix_map:
            site_map_context = format_site_map_for_agent(wix_map)

    # ── Análise de repositório (Wix Headless ou Repo) ─────────────────────
    # O worker lê o código completo mas passa ao agente apenas um RESUMO QA
    # gerado pela Cerebras — não o código bruto. O resumo é salvo em cache
    # e reutilizado (só o diff atualiza o cache nas próximas execuções).
    repo_cache_context = job.get('repo_cache')  # cache já salvo, se houver
    new_head = None

    if project_name and project_type in ('wix_headless', 'repo'):
        repo_path = await ensure_repo_path(client, backend_url, headers, project_name)

        if repo_path:
            repo_meta   = await _get_repo_meta(client, backend_url, headers, project_name)
            last_commit = repo_meta.get('lastCommit') if repo_meta else None

            if not last_commit or not repo_cache_context:
                # Primeira análise — lê tudo e resume via Cerebras
                info("🔍 Primeira análise — lendo repositório completo...")
                print()
                raw_code, new_head, repo_err = analyze_repo_full(repo_path)
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

    info("Abrindo Chromium — aguarde...")
    print()

    # Roda agente + watcher de cancelamento em paralelo
    agent_task  = asyncio.create_task(run_qa_agent(
        title=job["title"],
        preview_url=job["preview_url"],
        criteria=criterios,
        project_name=project_name,
        description=job.get("description", ""),
        knowledge=job.get("knowledge", ""),
        skills=job.get("skills", ""),
        headless=False,
        cerebras_api_key=cerebras_key,
        site_cache=site_cache,
        code_context=repo_cache_context,   # resumo QA, não código bruto
        site_map=site_map_context,
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

        # Cancela a task que ainda está pendente
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

    # ── Usuário cancelou ──────────────────────────────────────────────────
    if cancel_task in done and agent_task not in done:
        print()
        info("Análise cancelada pelo usuário.")
        print("  ─────────────────────────────────────────────")
        print()
        return  # volta ao loop de polling sem postar resultado

    # ── Agente terminou (normal ou erro) ──────────────────────────────────
    try:
        result       = agent_task.result()
        status       = "done" if result["success"] else "error"
        report       = result["report"]
        tokens       = result.get("tokens_total")
        cache_update = result.get("cache_update")  # novo campo — cache do site
    except Exception as e:
        status, report, tokens, cache_update = "error", f"Erro inesperado no agente: {e}", None, None

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
