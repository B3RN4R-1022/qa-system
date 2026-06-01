import os
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from agent import run_qa_agent

load_dotenv()

app = FastAPI(title="QA Agent", description="Agente de QA automatizado com browser-use + Groq")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Armazena resultados em memória (simples para desenvolvimento local)
results_store: dict = {}


class RunQARequest(BaseModel):
    task_id: str
    title: str
    preview_url: str
    criteria: list[str] = []
    project_name: str = ""
    description: str = ""   # Requisitos/Descrição da Funcionalidade da task
    knowledge: str = ""
    skills: str = ""
    headless: bool = False  # False = mostra o Chromium na tela


@app.get("/")
def health():
    return {
        "status": "ok",
        "service": "Nocorp QA Agent",
        "model": "llama-3.2-11b-vision-preview (Groq)"
    }


@app.get("/result/{task_id}")
def get_result(task_id: str):
    result = results_store.get(task_id)
    if not result:
        return {"task_id": task_id, "status": "not_found"}
    return result


async def run_in_background(task_id: str, request: RunQARequest):
    """Roda o agente em background e salva o resultado"""
    results_store[task_id] = {"task_id": task_id, "status": "running"}
    print(f"\n[QA Agent] 🚀 Iniciando: {request.title}")
    print(f"[QA Agent] 🌐 URL: {request.preview_url}")
    print(f"[QA Agent] {'👁  Modo visual (Chromium visível)' if not request.headless else '🔇 Modo headless'}\n")

    result = await run_qa_agent(
        title=request.title,
        preview_url=request.preview_url,
        criteria=request.criteria,
        project_name=request.project_name,
        description=request.description,
        knowledge=request.knowledge,
        skills=request.skills,
        headless=request.headless,
    )

    status = "done" if result["success"] else "error"
    results_store[task_id] = {
        "task_id": task_id,
        "status": status,
        "report": result["report"],
        "steps": result["steps"],
    }

    icon = "✅" if result["success"] else "❌"
    print(f"\n[QA Agent] {icon} Concluído: {request.title} | Steps: {result['steps']}")


@app.post("/run-qa")
async def run_qa(request: RunQARequest, background_tasks: BackgroundTasks):
    if not request.preview_url or not request.preview_url.startswith("http"):
        raise HTTPException(status_code=400, detail="preview_url inválida ou ausente")

    # Marca como rodando
    results_store[request.task_id] = {"task_id": request.task_id, "status": "running"}

    # Dispara em background
    background_tasks.add_task(run_in_background, request.task_id, request)

    return {"ok": True, "task_id": request.task_id, "message": "Análise iniciada"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"\n🤖 QA Agent rodando em http://localhost:{port}")
    print(f"   Modelo: llama-3.2-11b-vision-preview (Groq)")
    print(f"   Docs: http://localhost:{port}/docs\n")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
