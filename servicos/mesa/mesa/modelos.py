"""O contrato da mesa, em Pydantic.

Espelho de `src/mesa/index.ts` (Zod). Os dois lados precisam dizer a mesma
coisa, e quem garante isso não é disciplina: `contrato.json` é gerado daqui e um
teste do Vitest compara com o schema do Zod. Mudou um lado só, a suíte quebra.
"""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Recomendacao(str, Enum):
    aprovar = "aprovar"
    negar = "negar"
    precisa_humano = "precisa_humano"


class Caso(BaseModel):
    """O que entra pela rede. Pydantic barra aqui, antes de gastar um token."""

    model_config = ConfigDict(extra="forbid")

    assunto: str = Field(min_length=1, max_length=300)
    fatos: str = Field(min_length=1, max_length=4000)


class Olhar(BaseModel):
    leitura: str = Field(description="o que você entendeu do caso, em uma frase")
    preocupacao: str = Field(
        description="o que pode dar errado se a decisão for tomada às pressas"
    )
    recomendacao: Recomendacao


class Consolidado(BaseModel):
    recomendacao: Recomendacao
    justificativa: str = Field(
        description="por que, em uma ou duas frases, para quem vai decidir"
    )
    convergiu: bool = Field(
        description="true só se os dois olhares apontam para o mesmo lado"
    )
    ressalva: str | None = Field(
        description="o que ficou em aberto; null se não ficou nada"
    )
