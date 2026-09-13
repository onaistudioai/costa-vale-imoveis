# LangGraph, Pydantic e CrewAI — como os três trabalham juntos aqui

> Escrito depois de construir, não antes. Todo número deste documento foi
> medido nesta máquina em 12/09/2026. Dos problemas listados, onze
> aconteceram rodando; dois (9 e 10) foram achados lendo o código do CrewAI
> antes de virarem falha.

## O papel de cada um, em uma frase

| Framework | Papel | Onde mora | Linguagem |
|---|---|---|---|
| **LangGraph** | O mapa: qual agente acorda, em que ordem, onde o fluxo para esperando gente | `src/grafo/` | TypeScript (`@langchain/langgraph`) |
| **Pydantic** | O controle de entrega: nada entra nem sai do serviço fora do formato combinado | `servicos/mesa/mesa/modelos.py` | Python |
| **Zod** | O mesmo papel do Pydantic, do lado TS — já existia antes | `src/mesa/index.ts`, agentes | TypeScript |
| **CrewAI** | A equipe: vários papéis olhando o mesmo caso e um supervisor consolidando | `servicos/mesa/mesa/crew.py` | Python |

Versões instaladas: `crewai 1.15.21`, `pydantic 2.12.5`, Python 3.11,
`@langchain/langgraph 1.4.14`, `zod 4`.

---

## 1. A cadeia de ativação — quem acorda quem

```
 mensagem do cliente chega
   │
   ▼
 app/api/eventos ── recepcao: quem é essa pessoa? (sem modelo)
   │
   ▼
 LangGraph: processarEvento("mensagem.recebida")
   │  a tabela GATILHOS diz: este evento acorda o Agente 4, e só ele (R1)
   ▼
 Agente 4 — atendimento (TS)
   │  modelo lê a mensagem ─► Zod valida a leitura
   │  "permuta" → foraDoPadrao → classificar() → faixa AMARELA
   │
   ├── verde/vermelha: não passa pela mesa
   │
   └── amarela: revisarSePreciso(faixa, caso)
          │
          │  ① HANDOFF TS → Python: POST {MESA_URL}/mesa  { assunto, fatos }
          ▼
        FastAPI ─► Pydantic valida o Caso  (campo a mais ou vazio = 422, zero token gasto)
          │
          ▼
        memória: busca casos parecidos (só embedding, sem modelo)
          │
          ▼
        CrewAI: crew.kickoff()
          ├─ Task cauteloso ┐  ② HANDOFF INTERNO: rodam em paralelo,
          ├─ Task operador  ┘     context=[] → nenhuma lê a outra
          └─ Task supervisor      context=[cauteloso, operador] → recebe as duas
               cada saída passa pelo Pydantic (Olhar, Olhar, Consolidado)
          │
          ▼
        regra de divergência (if em Python, não prompt)
          │
          ▼
        memória: guarda "assunto → conclusão" (nunca os fatos)
          │
          │  ③ HANDOFF Python → TS: JSON
          ▼
 Agente 4 ─► Zod valida DE NOVO a resposta
   │
   ▼
 pedirAprovacao({ faixa, proposta }) ─► interrupt()
   │  LangGraph congela o fluxo e grava o estado no Postgres
   ▼
 painel: a pessoa lê a proposta e decide
   │
   │  ④ HANDOFF humano → LangGraph: retomar(threadId, decisão)
   ▼
 o fluxo continua de onde parou
```

### Quem ativa quem, sem ambiguidade

- **LangGraph ativa o agente** — por evento e por aresta. Ele não sabe que o
  CrewAI existe, e é de propósito: a mesa não é nó do grafo, então as regras R1
  (um evento, um agente) e R4 (agente não fala com agente) continuam valendo.
- **O agente ativa o CrewAI** — por HTTP, e só quando a faixa é amarela. A
  decisão de chamar é de `revisarSePreciso`, num lugar só; se cada agente
  decidisse, bastaria um esquecer o `if`.
- **O CrewAI ativa as próprias tasks** — as duas primeiras juntas, a terceira
  quando as duas terminam. O "handoff" entre agentes do CrewAI é o parâmetro
  `context`: a task do supervisor lista as outras duas, e o CrewAI cola as
  saídas delas no prompt dele.
- **Pydantic e Zod não ativam nada** — são portas. Formato errado para ali.
- **A pessoa reativa o LangGraph.** O CrewAI nunca fala com humano.

---

## 2. Onde está o pensamento — e onde ele não pode estar

| Etapa | Quem pensa | Pode decidir? |
|---|---|---|
| Ler a mensagem do cliente | modelo (Agente 4) | não — só extrai campos |
| Classificar a faixa | código (`src/regras/faixa.ts`) | sim, e é determinístico |
| Parecer do cauteloso / operador | modelo (CrewAI) | não — sugere |
| Consolidar | modelo (supervisor) | não — resume |
| Divergência → humano | código (`servicos/mesa/mesa/regra.py`) | sim, e vence o supervisor |
| Aprovar ou negar | **pessoa** | sim |

A regra de divergência é o ponto mais importante do desenho. O supervisor é
instruído a mandar para humano quando os pareceres discordam — mas instrução em
prompt é pedido, e o caso em que ela mais importa é o ambíguo, onde o modelo é
menos confiável. Então o `if` roda depois do CrewAI e sobrescreve o que o
supervisor disse. O teste `test_divergencia_vira_humano_mesmo_se_o_supervisor_escolheu_lado`
existe para isso.

---

## 3. Machine learning e "aprendizado" — o que é de verdade

**Nada aqui treina modelo.** Nenhum peso muda. O que o CrewAI chama de memória
é recuperação:

1. um texto vira um vetor de 384 números (embedding), pelo modelo
   `paraphrase-multilingual-MiniLM-L12-v2`, rodando **na máquina**;
2. o vetor vai para um banco vetorial local (LanceDB, em `servicos/mesa/.memoria/`);
3. no caso seguinte, o assunto vira vetor e os 3 mais próximos voltam;
4. eles são colados no texto do caso que os papéis leem.

Medido: na segunda revisão da mesma permuta, a memória devolveu a conclusão da
primeira, e os papéis a receberam como contexto.

### O limite honesto

O que a memória guarda hoje é **o que a própria mesa concluiu**. Isso é o
modelo lembrando de si mesmo — se ele errou uma vez, tende a repetir com mais
confiança. Por isso o texto injetado diz explicitamente "sugestões anteriores
da mesa, NÃO decisões de gente".

O aprendizado que vale é outro: **guardar o que a pessoa decidiu**. O caminho
está pronto do lado Python (`guardar()`); falta o painel chamar o serviço
quando alguém aprova ou nega em `app/actions.ts`. Não foi feito porque exige
decidir o que conta como "caso parecido" — e essa decisão é de negócio.

---

## 4. Problemas reais encontrados (em ordem)

A última coluna aponta onde está a correção no código.

| # | Sintoma | Causa | Correção |
|---|---|---|---|
| 1 | `uv` não baixava o Python 3.12 | CrewAI exige Python **<3.14**; o padrão da máquina é 3.14, e o download falhou | Python 3.11 local (`.python-version`) |
| 2 | `invalid peer certificate: BadSignature` em todo download | O **Avast** inspeciona HTTPS, e o plugin watch-skill definiu `SSL_CERT_FILE` para um arquivo sem o certificado do Avast | `uv --system-certs` sem `SSL_CERT_FILE`; em runtime, `truststore` (`app.py`) |
| 3 | CrewAI sem Groq | O 1.15 **não tem provedor Groq** e não traz o LiteLLM | Provedor OpenAI com `base_url` do Groq (`crew.py:_llm`) |
| 4 | Groq 404 `gpt-oss-120b` | `custom_openai=True` **corta o prefixo** `openai/` do nome do modelo | `provider="openai"` explícito |
| 5 | `Sync handler error ... 'charmap' codec` a cada chamada que falhava | Emoji nos logs do CrewAI; console do Windows é cp1252 | `sys.stdout.reconfigure(encoding="utf-8")` |
| 6 | Operador podia ler o cauteloso | Sem `context`, o CrewAI injeta **a saída de todas as tasks anteriores** (`NOT_SPECIFIED`) | `context=[]` explícito + teste |
| 7 | Groq 400 "tool `Olhar` not in request.tools" | Com só `output_pydantic`, o agente chama o modelo sem schema; o gpt-oss acha que o schema é uma ferramenta | `response_format=` no LLM de cada agente |
| 8 | Groq 400 "json mode cannot be combined with tool calling" | `Crew(memory=True)` dá ferramentas de memória aos agentes; o Groq não aceita ferramenta com JSON forçado | Memória usada **por fora** dos agentes (`memoria()`, `lembrar_parecidos`, `guardar`) |
| 9 | (lendo o código) memória mandaria texto para a OpenAI | O embedder **padrão** da memória do CrewAI é OpenAI | `embedder` local explícito |
| 10 | (lendo o código) embedding padrão não entende português | O padrão (`all-MiniLM-L6-v2`) é só inglês | modelo multilíngue |
| 11 | Groq 429 | Limite da conta: **8.000 tokens/minuto**; uma revisão gasta ~3.440 | Nenhuma no código: a mesa falha, o pedido segue sem proposta. Ver "Custos" |
| 12 | Pedido novo respondia com código velho | `TaskStop` matou o `npm`, mas o `uvicorn` filho ficou vivo segurando a porta 8001 | Matar por porta; o erro `[Errno 10048]` no log é o sinal |
| 13 | Teste de contrato falhando sem divergência real | Zod escreve nulo como `type: ["string","null"]`, Pydantic como `anyOf` | Normalização em `contrato.test.ts` |

---

## 5. Custos medidos

| Medida | Valor |
|---|---|
| Tokens por revisão | ~3.440 (2.570 de prompt, 870 de saída, 639 deles de raciocínio) |
| Chamadas de modelo por revisão | 3 |
| Revisões por minuto no limite atual do Groq | **2** |
| Tempo, memória desligada | ~5–6 s |
| Tempo, serviço recém-subido (carrega embedding) | ~44 s |
| Tempo, serviço já quente | ~10 s |
| Ponta a ponta (mensagem → pedido com proposta) | ~22 s |
| Espaço em disco do serviço (`.venv`) | 1,5 GB (a maior parte é o torch) |

---

## 6. Prós e contras — medidos, não prometidos

**Prós**
- Vocabulário padrão de mercado (Agent, Task, Crew) — conversa com cliente e
  com outro desenvolvedor sem explicar um desenho próprio.
- Pydantic barra entrada torta **antes** de gastar token (422 medido).
- Mudar papéis, adicionar um terceiro olhar ou trocar o modelo não toca no TS.
- Memória vetorial local pronta, sem montar banco vetorial à mão.

**Contras**
- Duas linguagens, dois gerenciadores de pacote, dois processos.
- **Menos controle do prompt:** o CrewAI injeta role, goal, backstory e
  instruções próprias. A versão TS mandava exatamente o texto escrito.
- O CrewAI esconde incompatibilidades com o provedor (problemas 7 e 8) que só
  aparecem rodando — nenhum dos dois tem teste sem chamar o Groq.
- A API muda rápido (a memória mudou várias vezes nos changelogs recentes).
- Mais tokens por revisão que a versão manual.

**Complexidade:** a lógica nova é pequena (~200 linhas de Python). O custo real
foi a borda — ambiente, certificados, provedor, contrato entre linguagens.
Dos treze problemas acima, só um (o 6) é da lógica da mesa; os outros são ambiente, certificado, provedor e contrato.

---

## 7. O contrato entre as duas linguagens

O maior risco de ter Zod e Pydantic juntos é os dois se afastarem em silêncio:
o sintoma seria só "revisão falhou, seguindo sem proposta" no log, que é
silencioso por desenho.

- `servicos/mesa/gerar_contrato.py` escreve `contrato.json` a partir do Pydantic.
- `src/mesa/contrato.test.ts` compara com o schema do Zod, campo a campo.
- Provado: mudar `ressalva` para obrigatório só no Python quebrou a suíte.

**Mudou um lado?** Mude o outro e rode, em `servicos/mesa`:
```
uv run --system-certs python gerar_contrato.py
```

---

## 8. Como rodar

```bash
# uma vez
cd servicos/mesa && uv sync --system-certs

# subir o serviço (lê GROQ_API_KEY do .env da raiz)
npm run mesa

# ligar a mesa no sistema: no .env
MESA_URL=http://127.0.0.1:8001

# testes
cd servicos/mesa && uv run --system-certs pytest     # regra, contrato de entrada, delegação
npm test                                             # inclui o fio HTTP e o contrato Zod×Pydantic
```

Se `npm run mesa` falhar com `[Errno 10048]`, há um serviço antigo segurando a
porta 8001 — os pedidos vão cair nele, rodando código velho.
