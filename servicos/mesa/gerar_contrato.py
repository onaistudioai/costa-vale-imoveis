"""Gera contrato.json a partir do Pydantic.

Rodar depois de mudar mesa/modelos.py: `uv run python gerar_contrato.py`.
O teste `src/mesa/contrato.test.ts` compara este arquivo com o Zod.
"""

import json
from pathlib import Path

from mesa.modelos import Consolidado

Path(__file__).with_name("contrato.json").write_text(
    json.dumps(Consolidado.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
