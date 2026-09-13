"""A porta HTTP da mesa. O handoff JS → Python entra aqui, e a resposta sai.

Sem banco, de propósito: o serviço não recebe DATABASE_URL. A mesa sugere, e o
que ela sugere só vira coisa quando o lado TS anexa ao pedido e uma pessoa
decide.
"""

import os
import sys

# Antes de importar o CrewAI, que lê isto no import:
# - telemetria vem LIGADA por padrão (métricas anônimas para a CrewAI);
# - os logs dele têm emoji, e o console do Windows (cp1252) derruba o handler.
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("CREWAI_STORAGE_DIR", os.path.join(os.path.dirname(__file__), "..", ".memoria"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import truststore  # noqa: E402

# Antes de qualquer cliente HTTP: nesta máquina o antivírus inspeciona HTTPS, e
# o certifi (usado pelo cliente da OpenAI e pelo HuggingFace) não conhece o
# certificado dele. truststore faz o Python usar o repositório do Windows.
truststore.inject_into_ssl()

from fastapi import FastAPI  # noqa: E402

from .crew import reunir  # noqa: E402
from .modelos import Caso, Consolidado  # noqa: E402

app = FastAPI(title="mesa")


@app.get("/saude")
def saude() -> dict:
    return {"ok": True}


# `def`, não `async def`: kickoff bloqueia por segundos, e o FastAPI roda rota
# síncrona numa thread em vez de travar o loop de eventos.
@app.post("/mesa", response_model=Consolidado)
def mesa(caso: Caso) -> Consolidado:
    return reunir(caso)
