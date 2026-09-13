"""A mesa em CrewAI: dois olhares independentes e um supervisor.

Como o trabalho passa de mão em mão aqui dentro:

  kickoff(inputs={"caso": ...})
    ├─ Task cauteloso  (async_execution=True) ┐ rodam juntas; nenhuma recebe a
    ├─ Task operador   (async_execution=True) ┘ outra em `context`
    └─ Task supervisor (context=[cauteloso, operador])
         o CrewAI espera as duas assíncronas e cola as saídas no prompt dele

`allow_delegation=False` em todos: a delegação do CrewAI deixa um agente mandar
trabalho para outro, que é a R4 ("agente não conversa com agente") quebrada e,
pior, é o que faria o segundo parecer ecoar o primeiro.
"""

import os

from crewai import LLM, Agent, Crew, Process, Task
from pydantic import BaseModel

from .modelos import Caso, Consolidado, Olhar
from .regra import aplicar_divergencia

# O CrewAI 1.15 não tem provedor Groq nem traz o LiteLLM. O Groq fala o
# protocolo da OpenAI, então vai pelo provedor openai com outra base_url.
# `provider="openai"` explícito, e NÃO `custom_openai=True`: esse corta o
# prefixo "openai/" do nome e o Groq responde 404 para "gpt-oss-120b".
MODELO = os.environ.get("MESA_MODELO", "openai/gpt-oss-120b")

# Os mesmos textos de `src/mesa/index.ts`, no formato do CrewAI: `role` e
# `goal` curtos, a instrução inteira no `backstory`.
CAUTELOSO = """Você é o sócio conservador de uma imobiliária. Sua preocupação é prejuízo e retrabalho: dinheiro gasto à toa, imóvel anunciado errado, cliente mal informado.
Você lê o caso e diz o que pode dar errado. Não é seu papel achar solução bonita — é apontar o custo de errar.
Se faltar informação para decidir com segurança, sua recomendação é "precisa_humano". Não invente dado que não está no caso."""

OPERADOR = """Você é o corretor mais experiente da casa, com 20 anos de rua. Sua preocupação é o negócio andar: lead que esfria, cliente que desiste de esperar, processo travado por excesso de conferência.
Você lê o caso e diz o que costuma acontecer na prática, e qual é o caminho normal.
Se o caso for mesmo fora do comum, sua recomendação é "precisa_humano". Não invente dado que não está no caso."""

SUPERVISOR = """Você é o gerente que recebe dois pareceres sobre o mesmo caso e prepara o resumo para quem vai decidir.
Regras, e elas mandam mais que os pareceres:
- Você NÃO decide. Você prepara uma sugestão para uma pessoa conferir.
- Se os dois pareceres divergem, "convergiu" é false e a recomendação é "precisa_humano".
- Se qualquer parecer disse "precisa_humano", a recomendação final é "precisa_humano".
- Nunca afirme número, prazo ou nome que não esteja nos pareceres.
- Escreva para uma pessoa apressada: uma ou duas frases, em português do Brasil, sem jargão."""


def _llm(formato: type[BaseModel]) -> LLM:
    """Um LLM por formato de saída, com o schema na PRÓPRIA requisição.

    Só `output_pydantic` na Task não basta com o gpt-oss: dentro do agente o
    CrewAI chama o modelo sem schema (`response_model=None` no executor) e
    descreve o formato no prompt; o gpt-oss, treinado para usar ferramentas,
    responde "chamando a ferramenta Olhar", e o Groq recusa com 400 porque essa
    ferramenta não existe. Com `response_format` o Groq força o JSON no
    servidor — o modelo não tem como inventar ferramenta.
    """
    return LLM(
        model=MODELO,
        provider="openai",
        base_url="https://api.groq.com/openai/v1",
        api_key=os.environ["GROQ_API_KEY"],
        temperature=0,
        response_format=formato,
    )


_memoria = None


def memoria():
    """A memória do CrewAI, usada POR FORA dos agentes.

    Por que não `Crew(memory=True)`: com memória, o CrewAI dá ferramentas de
    lembrar/buscar aos agentes, e o Groq recusa modo JSON junto com ferramenta
    ("json mode cannot be combined with tool/function calling"). Como o gpt-oss
    PRECISA do modo JSON (ver `_llm`), as duas coisas não convivem.

    Por fora também é mais seguro: o código escolhe o que entra. Entra o
    assunto e a conclusão; nunca os `fatos`, que carregam a fala do cliente.

    Embedding local e multilíngue: sem `embedder`, o padrão da memória do
    CrewAI é a OpenAI, e o texto sairia da máquina. O padrão do
    sentence-transformer (all-MiniLM-L6-v2) só entende inglês. Desliga com
    MESA_MEMORIA=0.
    """
    global _memoria
    if os.environ.get("MESA_MEMORIA", "1") == "0":
        return None
    if _memoria is None:
        from crewai.memory.unified_memory import Memory
        from crewai.rag.embeddings.factory import build_embedder

        _memoria = Memory(
            # Sem response_format: a memória usa o LLM para consolidar
            # lembranças parecidas, e isso é texto livre, não um Olhar.
            llm=LLM(
                model=MODELO,
                provider="openai",
                base_url="https://api.groq.com/openai/v1",
                api_key=os.environ["GROQ_API_KEY"],
                temperature=0,
            ),
            embedder=build_embedder(
                {
                    "provider": "sentence-transformer",
                    "config": {"model_name": "paraphrase-multilingual-MiniLM-L12-v2"},
                }
            ),
            root_scope="/mesa",
        )
    return _memoria


def lembrar_parecidos(caso: Caso) -> str:
    """Busca vetorial pura (`shallow`): só embedding, sem chamada de modelo."""
    m = memoria()
    if m is None:
        return ""
    achados = m.recall(caso.assunto, limit=3, depth="shallow")
    if not achados:
        return ""
    linhas = "\n".join(f"- {a.record.content}" for a in achados)
    return (
        "\n\nCASOS PARECIDOS QUE A MESA JÁ VIU (sugestões anteriores da mesa, "
        "NÃO decisões de gente — use como contexto, não como regra):\n" + linhas
    )


def guardar(caso: Caso, c: Consolidado) -> None:
    m = memoria()
    if m is None:
        return
    # Escopo, categoria e importância dados: sem eles o CrewAI chama o modelo
    # para inferir os três a cada gravação.
    m.remember(
        f"{caso.assunto} → {c.recomendacao.value}: {c.justificativa}",
        scope="/casos",
        categories=["mesa"],
        importance=0.5,
    )


def montar(caso: Caso) -> tuple[Crew, Task, Task]:
    """Uma crew por pedido.

    Task guarda a própria saída (`task.output`); reaproveitar as mesmas
    instâncias entre pedidos simultâneos misturaria o parecer de um caso com o
    de outro.
    """
    def agente(role: str, goal: str, backstory: str, formato: type[BaseModel]) -> Agent:
        return Agent(
            role=role,
            goal=goal,
            backstory=backstory,
            llm=_llm(formato),
            allow_delegation=False,
            max_iter=3,
            verbose=False,
        )

    cauteloso = agente("Sócio conservador", "Apontar o custo de errar neste caso", CAUTELOSO, Olhar)
    operador = agente("Corretor de 20 anos", "Dizer o caminho normal na prática", OPERADOR, Olhar)
    supervisor = agente("Gerente", "Resumir os pareceres para quem decide", SUPERVISOR, Consolidado)

    pedido = "Leia o caso e dê seu parecer.\n\n{caso}"
    t_caut = Task(
        description=pedido,
        expected_output="Um parecer",
        agent=cauteloso,
        output_pydantic=Olhar,
        async_execution=True,
        # Vazio de propósito. Sem `context`, o CrewAI injeta a saída de TODAS
        # as tasks anteriores (NOT_SPECIFIED em crew.py:_get_context). Hoje as
        # duas rodam juntas e uma não chega a ver a outra — mas isso seria
        # independência por corrida de tempo, não por regra.
        context=[],
    )
    t_oper = Task(
        description=pedido,
        expected_output="Um parecer",
        agent=operador,
        output_pydantic=Olhar,
        async_execution=True,
        context=[],  # mesmo motivo do cauteloso
    )
    t_sup = Task(
        description="Consolide os dois pareceres sobre o caso.\n\n{caso}",
        expected_output="O resumo consolidado",
        agent=supervisor,
        context=[t_caut, t_oper],
        output_pydantic=Consolidado,
    )

    crew = Crew(
        agents=[cauteloso, operador, supervisor],
        tasks=[t_caut, t_oper, t_sup],
        process=Process.sequential,
        verbose=False,
        memory=False,  # ver `memoria()`
    )
    return crew, t_caut, t_oper


def reunir(caso: Caso) -> Consolidado:
    crew, t_caut, t_oper = montar(caso)
    texto = f"CASO: {caso.assunto}\n\nFATOS APURADOS:\n{caso.fatos}{lembrar_parecidos(caso)}"
    resultado = crew.kickoff(inputs={"caso": texto})
    olhares = [t_caut.output.pydantic, t_oper.output.pydantic]
    if resultado.pydantic is None or any(o is None for o in olhares):
        raise ValueError("a crew terminou sem saída estruturada")
    final = aplicar_divergencia(resultado.pydantic, olhares)
    guardar(caso, final)
    return final
