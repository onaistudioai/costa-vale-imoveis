# PROJECT_SPEC — Costa & Vale Imóveis

Sistema de estoque, anúncio e atendimento imobiliário operado por quatro agentes de IA sobre um núcleo de regras determinísticas.

> Este documento consolida `spec-costa-vale-agentes.md` (Fases 3 e 4) com as quatro decisões que estavam em aberto na seção 8 daquele arquivo. O original foi preservado como histórico.

---

## 1. Princípio que sustenta o projeto

O anúncio é consequência do estoque, não causa dele.

Tráfego pago só faz sentido quando existem três coisas ao mesmo tempo:

1. O imóvel está fisicamente e documentalmente pronto pra ser vendido
2. Ninguém já está negociando ele
3. Existe alguém (humano ou agente) capaz de responder a mensagem que o anúncio gera, a qualquer hora

Se faltar qualquer uma das três, o dinheiro do anúncio vira lead perdido. Todo o sistema abaixo existe pra garantir essas três condições antes de qualquer verba ser gasta.

---

## 2. Onde entra agente e onde entra regra

**Agente de IA só onde existe ambiguidade de linguagem.** Ou seja, onde a informação chega em texto solto, escrita por um humano do jeito que ele quis.

**Regra determinística (código puro, sempre a mesma resposta pra mesma entrada) onde a decisão é binária.** Não precisa de IA pra decidir se um imóvel pode ser anunciado, isso é uma comparação de campos no banco.

| Etapa | Natureza | Implementação |
|---|---|---|
| Ler o laudo que o vendedor escreveu e entender "a casa tá limpa e a documentação saiu" | Texto livre | Agente |
| Decidir se o imóvel pode ir pro ar | Comparação de status | Regra |
| Entender no documento de venda em que pé está a negociação | Texto livre | Agente |
| Derrubar o anúncio quando a venda fecha | Gatilho de status | Regra |
| Achar o corretor com agenda livre | Consulta + cálculo | Regra |
| Escolher entre dois corretores igualmente livres, um deles com domínio do imóvel | Critério com peso | Regra com pontuação |
| Respeitar o corretor que já atende aquele lead | Comparação de data | Regra |
| Rotear o lead pro corretor certo (o Agente 3 inteiro) | Soma das três linhas acima | Regra — **sem modelo de linguagem** |
| Conversar com o lead e extrair o que ele quer | Texto livre | Agente |
| Cruzar o que o lead quer com o estoque disponível | Texto livre + consulta | Agente |

Os quatro agentes existem, mas boa parte do que eles fazem é chamar ferramenta e escrever no banco, e o modelo de linguagem só aparece na hora de interpretar texto humano. Isso deixa o sistema mais barato, mais rápido e muito mais fácil de testar.

---

## 3. A espinha do sistema: o estado do imóvel

Tudo gira em torno de saber em que ponto cada imóvel está. Um campo `status` único quebra o sistema: três agentes diferentes querem escrever nele ao mesmo tempo.

A solução é separar em três estados independentes, cada um com um dono único:

**Estado operacional** (dono: Agente 1)
`captado` → `em_preparacao` → `pronto` → `com_pendencia` → `reprovado`

Responde: o imóvel está apresentável e com documento em ordem?

`com_pendencia` é reversível pelo próprio Agente 1 assim que um novo laudo resolver o que faltava. `reprovado` não: é o estado em que um humano barrou o imóvel, e a saída dele só acontece por aprovação humana (ver seção 5). A distinção existe porque sem ela um novo laudo otimista reabriria um imóvel que uma pessoa deliberadamente travou.

**Estado comercial** (dono: Agente 2)
`disponivel` → `em_negociacao` → `em_processo_venda` → `fechado` → `arquivado`

Responde: alguém já está comprando isso?

**Estado do anúncio** (dono: Agente 1, mas obedece o Agente 2)
`sem_anuncio` → `no_ar` → `pausado` → `removido`

Responde: estamos gastando dinheiro divulgando isso?

A regra de publicação:

> Anúncio só sobe se `estado_operacional = pronto` **e** `estado_comercial = disponivel` **e** existe aprovação humana registrada.
> Anúncio cai automaticamente quando `estado_comercial` sai de `disponivel`, mas o gasto de mídia paga só é interrompido com confirmação humana.

---

## 4. Especificação dos agentes

Cada agente é descrito por seis coisas: gatilho (o que faz ele acordar), leitura, decisão, escrita, saída pra equipe e limite (o que ele explicitamente não faz).

### Agente 1: Curador de Estoque

**Papel:** decide o que pode ser anunciado.

- **Gatilho:** um afiliado ou vendedor lança um laudo sobre o imóvel (limpeza, reforma, documentação, atualização de preço).
- **Leitura:** os três campos do laudo em texto livre + o registro atual do imóvel.
- **Decisão:** extrai do texto o que mudou e classifica em pendência resolvida ou pendência aberta. Se todas as pendências obrigatórias estão resolvidas, marca `pronto` e abre pedido de aprovação pra subir anúncio.
- **Escrita:** `estado_operacional`, `preco`, `estado_anuncio`, registro na tabela `laudo` com os textos originais preservados, pedido em `aprovacao`.
- **Saída pra equipe:** "Imóvel 47 liberado pra anúncio. Faltava documentação, o Marcos subiu hoje. Confirma que publico?"
- **Limite:** não decide nada sobre venda. Se o Agente 2 marcou como `em_negociacao`, o Agente 1 não sobe anúncio mesmo com tudo pronto. Não tira imóvel de `reprovado` — isso é aprovação humana.

Por que ele é um agente e não um formulário: o vendedor escreve "passei lá hoje, a casa tá em ordem, só falta o pessoal tirar o entulho do fundo". Nenhum formulário captura isso. O agente lê, entende que existe uma pendência parcial, e não libera.

### Agente 2: Guardião da Negociação

**Papel:** é a fonte única de verdade sobre o estado de venda.

- **Gatilho:** corretor registra proposta, envia documento de negociação, ou muda o andamento de uma transação.
- **Leitura:** documentos da transação + registro do imóvel + anúncios vinculados.
- **Decisão:** identifica em que etapa a negociação está (proposta feita, aceita, documentação em análise, assinada).
- **Escrita:** `estado_comercial`, tabela `transacao`, pedido em `aprovacao` quando há mídia paga rodando.
- **Saída pra equipe:** ele não informa o estado geral, ele avisa a pessoa certa sobre a consequência. Exemplo: "Imóvel 47 entrou em processo de venda com a Ana. Tem anúncio ativo no ZAP e uma campanha rodando no Meta. Confirma que derrubo os dois?"
- **Limite:** não derruba o anúncio sozinho. Ele sinaliza, a regra derruba, e o gasto de mídia só é interrompido com confirmação humana (dinheiro envolvido, então tem gente no meio).

### Agente 3: Roteador de Corretor

**Papel:** liga o lead ao corretor que realmente conhece aquele imóvel e tem hora livre.

> **Este não é um agente de linguagem.** Todas as três linhas da tabela da seção 2 que compõem a decisão dele são regra determinística. Ele é um nó de função pura no grafo: mesma entrada, mesma saída, testável sem banco e sem modelo, custo zero por execução. Continua sendo peça de primeira classe do fluxo — só não gasta LLM. Ver seção 10 para o nível de autonomia e o envelope.

- **Gatilho:** o Agente 4 sinaliza que um lead está pronto pra falar com humano ou quer agendar visita.
- **Leitura:** `vinculo_lead_corretor`, agenda dos corretores, `dominio_corretor`, carga atual de cada um.
- **Decisão:** duas etapas, nesta ordem.
  1. **Vínculo com prazo.** Se o lead tem vínculo ativo cuja `ultima_interacao` está dentro da janela de inatividade (`config.janela_vinculo_dias`), ele vai pro corretor da carteira e a pontuação nem roda. Só é ignorado se esse corretor estiver inativo ou sem agenda nas próximas 48h.
  2. **Pontuação.** Vínculo expirado ou inexistente: pontua por domínio do imóvel e agenda livre. Domínio pesa mais que disponibilidade imediata, porque corretor que conhece a casa responde melhor e converte mais. Se ninguém com domínio está livre nas próximas 48h, cai pro segundo critério.

  Ao alocar, cria ou renova o vínculo.
- **Escrita:** tabela `agenda` (evento reservado), `vinculo_lead_corretor`.
- **Saída pra equipe:** notificação pro corretor escolhido, com o resumo do que o lead quer.
- **Limite:** não conversa com o cliente. Ele resolve alocação, não relacionamento. Fora do envelope da seção 10, não improvisa: escala pro painel.

Por que híbrido e não carteira pura nem fila pura: carteira pura manda lead pra quem não conhece o imóvel; fila pura queima relacionamento no meio de uma conversa em andamento. A janela resolve os dois com uma comparação de data — regra determinística, sem modelo de linguagem.

### Agente 4: Atendimento 24/7 e Qualificação

**Papel:** é a única porta de entrada, e é ele quem casa o que o cliente quer com o estoque.

- **Gatilho:** mensagem nova em qualquer canal (WhatsApp, Direct, formulário, portal).
- **Leitura:** histórico da conversa + estoque disponível (só o que está `no_ar`, ele nunca oferece imóvel em negociação).
- **Decisão:** responde dúvida básica, extrai o que o cliente procura, **cruza essa busca com o estoque `no_ar`** e classifica se o lead está pronto pra humano.
- **Escrita:** `cliente`, `busca` (incluindo o `texto_original`), histórico.
- **Saída:** chama o Agente 3 quando qualifica, passando o imóvel de interesse e o resumo da conversa.
- **Limite:** não agenda sozinho, não fala preço de imóvel em negociação, não promete nada sobre documentação.

O match ficou aqui e não em um agente separado porque o contexto que o match precisa — o histórico inteiro da conversa, incluindo o que o cliente descartou e por quê — já está na mão do Agente 4. Passar isso adiante para um Agente 5 duplicaria a leitura e adicionaria um salto antes do lead chegar no corretor.

---

## 5. Regra de propriedade de dado

Esta é a regra que impede o sistema de se contradizer. Cada campo tem um dono. Os outros agentes leem, nunca escrevem.

| Campo | Escreve | Leem |
|---|---|---|
| `estado_operacional` | Agente 1 | 2, 3, 4 |
| `preco` | Agente 1 | 2, 4 |
| `estado_anuncio` | Agente 1 **e a regra** | 2 |
| `anuncio.*` | Agente 1 | 2 |
| `laudo.*` | Agente 1 | — |
| `estado_comercial` | Agente 2 | 1, 3, 4 |
| `transacao.*` | Agente 2 | 3 |
| `agenda.*` | Agente 3 | 4 |
| `vinculo_lead_corretor.*` | Agente 3 | 4 |
| `cliente.*`, `busca.*` | Agente 4 | 3 |
| `papel.*` | Agente 4 | 1, 2, 3 |
| `dominio_corretor.*` | humano | 3 |
| `aprovacao.*` | 1 e 2 abrem, humano decide | todos |
| `log_evento.*` | todos escrevem, ninguém edita | todos |

Se um agente precisa mudar algo que não é dele, ele não muda: ele grava um pedido e o dono do campo decide. Os agentes conversam pelo estado, nunca entre si.

### A exceção do `estado_anuncio`: a regra também escreve

`estado_anuncio` tem dois escritores, e isso é deliberado. O Agente 1 o sobe; a **regra** o derruba, sem passar por agente nenhum.

O motivo apareceu na implementação e vale registrar. A seção 3 exige que anúncio no ar implique imóvel pronto e disponível — um invariante que o banco reforça com `CHECK`. Quando o Agente 2 muda `estado_comercial` para `em_negociacao`, o invariante quebra na mesma linha. Mas `estado_anuncio` é do Agente 1, e a R5 proíbe o Agente 2 de tocá-lo. Se a queda fosse ação de agente, a transição seria impossível sem violar a propriedade de dado.

A saída já estava na seção 2: *"Derrubar o anúncio quando a venda fecha — Gatilho de status — Regra"*. Não é ninguém escrevendo no campo alheio; é a regra agindo sozinha, no mesmo instante da mudança de estado comercial. Implementado como trigger (`drizzle/0001_queda_automatica_do_anuncio.sql`).

O escopo do trigger é estreito de propósito: ele pausa a vitrine (`imovel.estado_anuncio`) e os anúncios orgânicos. Linhas de `anuncio` com `midia_paga = true` ficam de pé até a aprovação humana. É o que separa **proteger o lead** — que não pode esperar clique — de **parar o gasto**, que exige gente no meio.

### Os três pontos de aprovação humana

| Gate | Quem abre | O que trava |
|---|---|---|
| Subir anúncio | Agente 1 | Publicação não acontece sem confirmação, mesmo com `pronto` + `disponivel` |
| Derrubar mídia paga | Agente 2 | Campanha paga não é interrompida sem confirmação |
| Liberar imóvel reprovado | Agente 1 | Saída de `estado_operacional = reprovado` só por decisão humana |

Os três envolvem dinheiro ou risco de anunciar imóvel que não está pronto. Fora deles, a regra decide sozinha.

---

## 6. Modelo de dados

### imovel
```
id_imovel, tipo, preco, endereco, bairro, cidade,
pontos_referencia, id_proprietario, id_corretor_captador,
estado_operacional, estado_comercial, estado_anuncio, data_captacao
```
`status` virou três campos, pelo motivo da seção 3.

### anuncio
```
id_anuncio, id_imovel, canal, status, data_publicacao,
data_remocao, custo_acumulado
```
Sem essa tabela é impossível cumprir a regra "se a venda for aprovada o anúncio deve ser removido", porque o sistema não sabe quantos anúncios existem nem onde. Um imóvel pode estar em quatro canais ao mesmo tempo.

### laudo
```
id_laudo, id_imovel, id_autor, tipo,
texto_estado, texto_documentacao, texto_pendencias,
extracao_estruturada, data
```
O laudo segue um roteiro curto de três campos, cada um em texto livre. Não é formulário: o vendedor continua escrevendo como quiser dentro de cada campo, mas o agente sabe de antemão qual assunto está lendo, o que reduz muito o erro de extração sem burocratizar quem está em campo.

Guarda o que o vendedor escreveu **e** o que o agente entendeu. Quando o agente errar (e vai errar), você tem como comparar os dois e corrigir a instrução dele. Isso é o que transforma o sistema em algo auditável.

### cliente
```
id_cliente, nome, cpf_cnpj, telefone, email, origem_canal, data_entrada
```
Sem campo `tipo`. Uma pessoa pode ser proprietária de um imóvel e compradora de outro ao mesmo tempo, e com um campo só você é obrigado a duplicar o cadastro. O papel virou tabela própria.

### papel
```
id_papel, id_cliente, id_imovel, papel, ativo
```
`papel`: proprietario, comprador, inquilino, lead.

### busca
```
id_busca, id_cliente, valor_min, valor_max, tipo_imovel,
bairros_desejados, texto_original
```
`texto_original` é obrigatório. O cliente escreve "queria algo de dois quartos perto de escola até uns 400". Guardar só os números perde a parte que mais importa pro match.

### corretor
```
id_corretor, nome, telefone, comissao_percentual,
regioes_atuacao, ativo
```

### dominio_corretor
```
id, id_corretor, id_imovel, nivel
```
`nivel`: captou, ja_visitou, conhece_regiao.

Esta é a tabela que resolve a dor de "não mandar imóvel pra corretor que não sabe de nada". Sem ela, o Agente 3 não tem como pontuar ninguém.

### vinculo_lead_corretor
```
id, id_cliente, id_corretor, criado_em, ultima_interacao, ativo
```
O roteamento híbrido precisa de uma relação corretor↔cliente, e ela não existia: `dominio_corretor` é corretor↔imóvel e `papel` é cliente↔imóvel. `ultima_interacao` é o campo que a janela de inatividade lê.

### agenda
```
id_evento, id_corretor, id_imovel, id_cliente,
inicio, fim, status
```

### transacao
```
id_transacao, id_imovel, id_cliente_comprador, id_corretor,
tipo, valor_final, data_fechamento, comissao_paga, etapa
```
`etapa` existe porque o Agente 2 precisa registrar o caminho até o fechamento, não só o resultado final.

### aprovacao
```
id, tipo, entidade, id_entidade, solicitado_por_agente,
estado, decidido_por, decidido_em, motivo
```
`tipo`: subir_anuncio, derrubar_midia, liberar_reprovado.
`estado`: pendente, aprovado, negado.

`log_evento.aprovado_por` registra aprovação consumada, mas não modela o pedido *pendente*. Com três gates humanos, o pedido precisa existir como estado consultável — senão não há como saber o que está esperando decisão.

### log_evento
```
id, agente_origem, entidade, id_entidade, campo,
valor_anterior, valor_novo, timestamp, aprovado_por
```
Registro de tudo que qualquer agente mudou. Quando alguém perguntar "por que esse anúncio caiu?", a resposta está aqui. É o que separa um protótipo de um sistema.

---

## 7. Os três fluxos críticos

### Fluxo A: imóvel entra no estoque e vira anúncio
1. Corretor capta o imóvel. Estado: `captado` / `disponivel` / `sem_anuncio`.
2. Vendedor visita e lança laudo nos três campos do roteiro.
3. Agente 1 lê, extrai, atualiza pendências.
4. Todas resolvidas: `estado_operacional = pronto`.
5. Regra confere `estado_comercial = disponivel`.
6. Agente 1 abre `aprovacao` do tipo `subir_anuncio`.
7. Humano aprova. Anúncio sobe, registro criado na tabela `anuncio`.

### Fluxo B: venda avança e o anúncio precisa cair
1. Corretor registra proposta aceita.
2. Agente 2 lê o documento e identifica a etapa.
3. Agente 2 consulta anúncios vinculados ao imóvel.
4. Existe mídia paga: Agente 2 abre `aprovacao` do tipo `derrubar_midia` e avisa a equipe com o custo rodando.
5. Humano confirma.
6. `estado_comercial = em_negociacao`, anúncios marcados como `pausado`.

O ponto fino: o Agente 4 precisa parar de oferecer o imóvel **antes** do anúncio cair, porque anúncio no ar ainda gera mensagem por algumas horas depois de pausado. Por isso o corte do Agente 4 acontece no passo 2, junto com a mudança de `estado_comercial`, e não depende da aprovação do passo 5. A aprovação humana trava só o gasto de mídia — nunca a proteção do lead.

### Fluxo C: lead chega e encontra o corretor certo
1. Mensagem entra em qualquer canal, Agente 4 responde em segundos.
2. Agente 4 extrai a busca em texto livre e cruza com o estoque `no_ar`.
3. Lead demonstra interesse concreto, Agente 4 qualifica e chama o Agente 3.
4. Agente 3 checa `vinculo_lead_corretor`. Vínculo dentro da janela: vai direto pro corretor da carteira.
5. Vínculo expirado ou inexistente: pontua corretores por domínio do imóvel e agenda livre, e cria o vínculo ao alocar.
6. Visita reservada, corretor notificado com o contexto da conversa.
7. Cliente recebe confirmação pelo mesmo canal onde entrou.

---

## 8. Tech stack

- **App e API:** Next.js. A versão deste ambiente diverge do conhecido — os guias em `node_modules/next/dist/docs/` são a fonte, e não a memória de nenhum modelo.
- **Banco:** Postgres (Neon).
- **Orquestração:** LangGraph.js, no mesmo repo. Um deploy, tipos compartilhados entre app e agentes, sem contrato HTTP no meio.
- **Agente único:** LangChain, dentro de cada nó que precisa de modelo.
- **Modelos:** Groq — `openai/gpt-oss-120b` para extração de texto livre; `llama-3.1-8b-instant` onde a tarefa for classificação simples e de alto volume. **Só os Agentes 1, 2 e 4 chamam modelo.** O Agente 3 não. Trocar de provedor é trocar `src/agentes/modelo.ts`, e nada além dele — nenhum agente sabe quem responde.
- **Regras determinísticas:** TypeScript puro, sem framework, testável isoladamente sem banco e sem modelo. Inclui o Agente 3 inteiro.

---

## 9. Decisões fechadas

As quatro pendências da seção 8 do documento original, resolvidas:

1. **Quem qualifica o lead:** o Agente 4. Ele acumula atendimento, extração da busca e match com o estoque `no_ar`. Não entra Agente 5 **de qualificação**.

> **Adendo (Wave 7).** Existe um quinto agente, mas de outra natureza: o **Agente de Consulta**. Os quatro primeiros são reativos — acordam quando um fato acontece. O de consulta é puxado: alguém da equipe pergunta. Ele não escreve, não decide e não dispara evento nenhum; roda sobre um papel do Postgres que só tem `SELECT`. A decisão 1 continua valendo: nenhum agente novo entra no caminho do lead.
2. **Carteira fixa ou fila aberta:** híbrido com prazo. Vínculo tem prioridade dentro da janela de inatividade; expirado, o lead volta pra fila e a pontuação por domínio decide.
3. **Onde entra aprovação humana:** três gates — subir anúncio, derrubar mídia paga, liberar imóvel reprovado.
4. **Formato do laudo:** roteiro curto de três campos (estado, documentação, pendências), texto livre dentro de cada um.

---

## 10. Classificação dos agentes

**Tipo e nível de autonomia são eixos independentes.** Amarrar um ao outro produz dois erros opostos: agente deliberativo onde bastava um gatilho (caro e lento), ou autonomia total numa decisão que envolve dinheiro (perigoso).

Neste sistema os dois eixos chegam a andar em direções contrárias, e isso é a prova de que são separados: o Agente 2 é o mais sofisticado dos quatro e é o que mais depende de humano; o Agente 3 é o mais simples e é o que age mais sozinho.

### Eixo 1 — Tipo

- **Gatilho:** condição → ação fixa. Missão única e pré-definida. Detector de fumaça que só liga a água.
- **Reativo:** pondera o ambiente antes de agir. Detector que considera fumaça *e* calor.
- **Deliberativo:** planeja uma sequência e aciona outros atores. Detecta fumaça, liga pro bombeiro, ativa o alarme dos prédios em volta.

### Eixo 2 — Nível de autonomia

- **N2 — sempre assistida.** A ação não acontece sem confirmação humana.
- **N3 — humano no caso fora do padrão.** Na rotina age sozinho; fora dela fala com humano diretamente, **em vez de** acionar outro agente.
- **N4 — independente.** Age sozinho inclusive fora do previsto.

### Classificação

| Agente | Tipo | Nível | Por que este tipo | Por que este nível |
|---|---|---|---|---|
| 1 Curador | Reativo | N3 | Pondera várias pendências contra o estado atual do imóvel e obedece o estado comercial do Agente 2. Multi-sinal e contextual, mas não orquestra ninguém | Laudo de rotina é automático; laudo ambíguo ou pendência crítica vai direto ao humano |
| 2 Guardião | Deliberativo | N3 | Detecta a etapa, consulta anúncios, calcula custo, avisa a pessoa certa, derruba mídia e corta o Agente 4. É o caso do bombeiro mais o alarme da vizinhança | Dinheiro em jogo: fora do padrão fala com humano, nunca com outro agente |
| 3 Roteador | Reativo (quase gatilho) | N4 com envelope | Considera agenda, domínio, vínculo e carga — mas é função de pontuação. Sem texto livre, sem planejamento, sem modelo | Ninguém aprova roteamento. Age sozinho em 100% dos casos dentro do envelope; fora dele rebaixa pra N3 |
| 4 Atendimento | Deliberativo | N3 | Conversa multi-turno, extrai a busca, cruza com o estoque, decide escalar e aciona o Agente 3 | Os três limites da seção 4 são intransponíveis: fora do padrão vai pro painel, não pro Agente 3 |

### Ações sempre assistidas (N2)

O nível é propriedade do agente; estas três ações são N2 independente disso. São os gates da seção 5:

| Ação | Agente | Motivo |
|---|---|---|
| Subir anúncio | 1 | Começa gasto |
| Derrubar mídia paga | 2 | Interrompe gasto |
| Liberar imóvel reprovado | 1 | Desfaz decisão humana |

### O envelope do Agente 3

N4 nele significa autonomia total **dentro de um envelope fixo**, não deliberação. Ele sai do envelope e escala pro painel — comportamento N3 — quando:

1. nenhum corretor pontua acima de `config.roteamento.score_minimo`;
2. o corretor vencedor não tem slot livre dentro de `horizonte_agenda_horas`;
3. o `estado_comercial` do imóvel mudou entre a qualificação do lead e o roteamento.

Sem envelope, "independente" vira "aloca errado em silêncio". O caso 1 é o que protege contra `dominio_corretor` vazia — sem ele, o roteamento degrada pro segundo critério sem ninguém perceber.

---

## 11. Contrato de coordenação

A seção 5 resolve escrita concorrente: cada campo tem um dono. Isto aqui resolve **execução** concorrente — o que acontece quando dois agentes acordam ao mesmo tempo.

**R1 — Gatilho exclusivo.** Cada tipo de evento acorda exatamente um agente. Um agente nunca processa evento que não é do seu tipo, mesmo que tecnicamente consiga.

| Evento | Acorda |
|---|---|
| `laudo.criado`, `preco.alterado` | Agente 1 |
| `transacao.criada`, `transacao.atualizada`, `documento.negociacao` | Agente 2 |
| `lead.qualificado` | Agente 3 |
| `mensagem.recebida` (qualquer canal) | Agente 4 |
| `aprovacao.decidida` | o agente que abriu o pedido |

**R2 — Lock por imóvel, não global.** No máximo um agente por `id_imovel` de cada vez; imóveis diferentes rodam em paralelo sem se enxergar. O escopo do lock é o que separa paralelismo real de escada: lock global serializa tudo e desperdiça capacidade; lock nenhum empilha dois agentes no mesmo registro e o segundo trabalha sobre estado que já mudou. Dois agentes em velocidade plena valem mais que um entregue e um processando em cima do outro.

*Exceção — o Agente 4 é chaveado por conversa, não por imóvel.* Uma `mensagem.recebida` de lead novo não tem `id_imovel` nenhum ainda, então não há por onde travar. Ele é chaveado por `id_cliente`. Isso é seguro porque o Agente 4 só **lê** imóvel — escreve em `cliente` e `busca`, que são dele. O custo é que ele pode ler estoque com alguns segundos de atraso; ele relê o estoque a cada turno da conversa, então uma mudança de `estado_comercial` é capturada no turno seguinte. É por isso que o corte do Agente 4 no Fluxo B acontece na entrada da transação e não na aprovação: alguns segundos de atraso são toleráveis, minutos esperando um humano clicar não são.

**R3 — Teto de concorrência.** Limite de execuções simultâneas por tipo de agente (`config.concorrencia`). Sem teto, os quatro competem por processamento e o Agente 4 perde pra trabalho de fundo — justamente ele, o único com uma pessoa esperando resposta do outro lado. Por isso ele tem o teto mais alto e prioridade na fila.

**R4 — Handoff só por aresta do grafo.** Agente nunca chama agente diretamente. A passagem é uma aresta com payload tipado e o estado compartilhado é o único meio. Agente 4 → Agente 3 é aresta, não chamada de função.

**R5 — Escrita só no que é seu.** A tabela da seção 5, com efeito em runtime: o contrato `AgenteContexto` só expõe escrita para os campos daquele agente. Violação vira erro de tipo, não observação de code review.

**R6 — Idempotência por evento.** Todo evento carrega id e reprocessar não duplica efeito. É o que torna retry seguro quando um agente estoura timeout — sem isso, o retry de um Agente 2 abre dois pedidos de derrubar mídia pro mesmo imóvel.

### Mapeamento pro LangGraph

O princípio da seção 5 — agentes conversam pelo estado, nunca entre si — é o modelo nativo do LangGraph, não uma adaptação.

| Conceito | Primitiva |
|---|---|
| Estado compartilhado | `StateGraph` com estado tipado |
| Agentes 1, 2, 4 | Nós com agente LangChain dentro |
| Agente 3 e as regras da seção 2 | Nós de função pura, sem LLM |
| Gates N2 | `interrupt()` — o grafo pausa e retoma na decisão |
| Escalação N3 pro painel | mesma `interrupt()`, origem diferente |
| Lock por imóvel (R2) e retomada | checkpointer com thread por `id_imovel` |
| Regra de publicação da seção 3 | aresta condicional |

Consequência prática: os gates N2 **não** precisam de polling nem de máquina de estado própria. `interrupt()` pausa e retoma exatamente de onde parou quando a aprovação chega. A tabela `aprovacao` continua existindo como registro auditável e fila da interface — não como mecanismo de controle de fluxo.

### R7 — o nó que interrompe não tem efeito colateral antes do `interrupt()`

Verificado na implementação (`src/grafo/interrupt.test.ts`): quando o grafo retoma, **o nó que pausou re-executa do começo**. Nós já concluídos não repetem, e o estado é aplicado uma vez só — mas tudo que roda dentro daquele nó *antes* do `interrupt()` roda duas vezes.

Isso é caro e errado nas duas pontas: uma chamada de modelo cobrada em dobro, e um pedido de aprovação virando duas linhas na fila do painel.

Duas defesas, e as duas são necessárias:

1. **Estrutural.** A função do agente roda num nó que não interrompe. O gate é um nó separado, e o `interrupt()` é a primeira coisa dentro dele. Assim a re-execução do nó do gate não custa nada.
2. **Idempotência.** `aprovacao` tem chave única em `(id_evento, tipo, id_entidade)`, e `pedirAprovacao` reaproveita o pedido existente em vez de abrir outro. Isso protege mesmo quando alguém esquecer a primeira defesa.

A segunda sozinha não basta — ela evita a linha duplicada, mas não a segunda chamada de modelo.
