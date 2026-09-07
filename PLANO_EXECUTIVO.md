# PLANO_EXECUTIVO — Costa & Vale Imóveis

Derivado de `PROJECT_SPEC.md`. Waves montadas pela dependência real entre as partes, não pela ordem de leitura da spec.

**Agentes simultâneos:** máx. 3 por wave.
**Tempo total estimado:** ~11h de execução.

---

## Princípio de fatiamento

A spec já separa o sistema em duas naturezas (seção 2): regra determinística e agente de IA. As waves respeitam isso — **toda regra determinística nasce antes de qualquer agente**. Motivo prático: as regras são testáveis sem banco e sem modelo de linguagem, então elas viram o contrato contra o qual os agentes são construídos. Se as regras vierem depois, cada agente inventa a sua versão da mesma decisão e o sistema se contradiz — exatamente o que a seção 5 existe pra impedir.

A classificação da seção 10 reforça isso: só três dos quatro agentes chamam modelo. O Agente 3 é regra pura, então nasce junto com as outras regras e não espera agente nenhum.

---

## WAVE 1 — Fundação (paralelo | ~3h30)

Nenhuma parte aqui depende de outra. As quatro rodam juntas.

**Parte 1.1: Schema e migrations** — Timeout: 90min
As 13 tabelas da seção 6, com os três enums de estado como tipos do Postgres (não strings livres — o banco recusa transição inválida sem precisar de código). Constraint que garante o invariante da seção 3: nenhum `anuncio` pode estar em `no_ar` se o `imovel` não estiver `pronto` + `disponivel`.
Saída: `db/schema.sql`, `db/migrations/`, seed mínimo pra teste.

**Parte 1.2: Motor de regras determinísticas** — Timeout: 120min
TypeScript puro, sem import de banco e sem import de SDK de modelo. Três módulos:
- `podePublicar(imovel, aprovacao)` — a regra da seção 3
- `derrubarAnuncio(imovel, anuncios)` — o gatilho de saída de `disponivel`
- `pontuarCorretores(lead, imovel, corretores, agenda, vinculo, config)` — as duas etapas do Agente 3 (janela de vínculo, depois pontuação por domínio)

Cada um com testes de tabela cobrindo os casos de fronteira: vínculo expirando exatamente na janela, corretor com domínio mas agenda cheia, imóvel `pronto` sem aprovação.
Saída: `src/regras/`, `src/regras/*.test.ts`.

**Parte 1.3: Scaffolding e contratos** — Timeout: 60min

> **Armadilha de diretório.** `D:\projetos` tem um `package.json` próprio, de um app Next.js sem relação com este (check-in/dashboard, Drizzle, next-auth). Todo comando `npm` e `npx` precisa rodar **dentro de** `D:\projetos\imobiliaria`, que agora tem `package.json` próprio. Sem isso o npm sobe na árvore e instala no app do vizinho — em silêncio, sem erro. Já aconteceu uma vez.

Projeto Next.js (ler `node_modules/next/dist/docs/` antes de escrever qualquer rota — a versão diverge do conhecido; o app vizinho está em Next 16.2.6, boa referência do que esperar). Tipos compartilhados das entidades. Interface `AgenteContexto` que implementa a **R5** da seção 11: cada agente recebe writer só dos campos que são dele, então escrever fora do próprio domínio não compila. É o contrato que permite as waves seguintes rodarem em paralelo sem se esbarrar.
Saída: projeto rodando, `src/tipos/`, `src/agentes/contrato.ts`.

**Parte 1.4: Grafo e coordenação** — Timeout: 90min
`StateGraph` do LangGraph.js com o estado tipado do sistema. Implementa as regras R1-R4 e R6 da seção 11:
- roteador de eventos com a tabela evento→agente (**R1**), rejeitando evento que não pertence ao agente
- checkpointer com thread por `id_imovel` (**R2**) — é o lock, e o escopo por imóvel é o que preserva o paralelismo
- fila com teto por tipo de agente e prioridade do Agente 4 (**R3**)
- arestas tipadas para todo handoff (**R4**), incluindo Agente 4 → Agente 3
- deduplicação por id de evento (**R6**)
- `interrupt()` nos três gates N2 e na escalação N3

Nós entram como stubs — as waves seguintes só preenchem o corpo. Teste de concorrência obrigatório: dois eventos no mesmo imóvel serializam, dois eventos em imóveis diferentes rodam juntos.
Saída: `src/grafo/`, `src/grafo/eventos.ts`, teste de concorrência.

**Gate:** `npm test` verde no motor de regras e no teste de concorrência, migrations aplicam e revertem limpo, app sobe, grafo executa ponta a ponta com nós stub.

---

## WAVE 2 — Estoque e roteamento (paralelo | ~3h)

Dependem da Wave 1 inteira. Independentes entre si: cada um é dono dos próprios campos (seção 5) e nunca escreve no do outro.

**Parte 2.1: Agente 1 — Curador de Estoque** — Timeout: 150min
Extração dos três campos do laudo, classificação em pendência resolvida/aberta, escrita de `estado_operacional` e `preco`, abertura de `aprovacao` tipo `subir_anuncio`. Grava `extracao_estruturada` ao lado do texto original — é o par que torna o erro auditável.
Fixtures de laudo real, incluindo o caso da spec ("só falta o pessoal tirar o entulho do fundo") que deve resultar em pendência aberta, não em `pronto`.
Saída: `src/agentes/curador/`, fixtures, testes de extração.

**Parte 2.2: Agente 2 — Guardião da Negociação** — Timeout: 150min
Identificação da etapa da negociação a partir de documento em texto livre, escrita de `estado_comercial` e `transacao`, consulta de anúncios vinculados, abertura de `aprovacao` tipo `derrubar_midia` com o custo acumulado no corpo do aviso.
Saída: `src/agentes/guardiao/`, fixtures, testes.

**Parte 2.3: Agente 3 — Roteador de Corretor** — Timeout: 90min
Subiu da Wave 3. Sem LLM (seção 10), ele depende só de `pontuarCorretores` (1.2) e do schema (1.1) — não tem por que esperar os agentes de estoque. Camada fina sobre a pontuação já testada: reserva de agenda, criação/renovação de vínculo, notificação com o resumo da conversa, e os três casos de saída do envelope escalando pro painel.
Saída: `src/grafo/nos/roteador.ts`, testes de integração com agenda e testes dos três casos de envelope.

**Gate:** Fluxo A e Fluxo B executam ponta a ponta em banco de teste, parando corretamente nos gates de aprovação. Roteador aloca corretamente nos dois caminhos (vínculo dentro da janela e vínculo expirado) e escala nos três casos de envelope.

---

## WAVE 3 — Atendimento (~2h30)

Depende da Wave 2 (precisa de estoque com estado real e do roteador pronto pra receber o handoff). Parte única.

**Parte 3.1: Agente 4 — Atendimento e Qualificação** — Timeout: 150min
Entrada multicanal, resposta a dúvida básica, extração da busca com `texto_original` preservado, match contra estoque `no_ar`, classificação de lead qualificado. Handoff pro Agente 3 por aresta do grafo (**R4**), nunca por chamada direta.

Os três limites da seção 4 viram teste explícito: não agenda, não fala preço de imóvel em negociação, não promete documentação. Mais o comportamento N3 da seção 10: lead fora do padrão vai pro painel, **não** pro Agente 3 — este é o teste que distingue N3 de N4 na prática.
Saída: `src/agentes/atendimento/`, testes de limite, teste de escalação N3.

**Gate:** Fluxo C executa ponta a ponta, nos dois caminhos (vínculo dentro da janela e vínculo expirado), e o caminho de escalação N3 desvia pro painel sem tocar o Agente 3.

---

## WAVE 4 — Superfície humana (~2h)

Depende da Wave 3. Sequencial — é uma parte só.

**Parte 4.1: Painel de aprovação e auditoria** — Timeout: 120min
Fila única, com duas origens: os três gates N2 (`aprovacao` com `estado = pendente`) e as escalações N3 de qualquer agente. Cada item mostra o que está travado e o custo de não decidir. Decidir no painel resolve o `interrupt()` e o grafo retoma de onde parou — o painel não reinicia fluxo, ele destrava.

Consulta do `log_evento` que responde "por que esse anúncio caiu?" — a pergunta que a seção 6 usa pra justificar a tabela.
Saída: rotas e telas de aprovação, view de auditoria por imóvel.

**Gate:** os três tipos de aprovação e as escalações N3 são decidíveis pela interface, e a decisão retoma o grafo no ponto exato da pausa.

---

## WAVE 5 — Produção (~2h30)

A wave que faltava: até a 4 os agentes existiam e eram testados, mas nada os
ligava a um evento real. Aqui o sistema passa a rodar sozinho.

**5.1 — R7 estrutural.** Os quatro agentes entram em nós de verdade, e o gate
vira nó separado com `interrupt()` na primeira linha (`src/grafo/no.ts`). O
agente re-executa depois da decisão; o que não se repete é o que custa —
chamada de modelo e linha na fila — porque extração e decisão ficam no `memo`
do estado. O resto (UPDATE de mesmo valor, INSERT de log) é idempotente por
chave no banco.

**5.2 — Mundo.** `src/grafo/mundo.ts` é a única superfície que os nós têm
contra o banco e os canais; `mundo-db.ts` é a implementação Drizzle. Grafo de
produção e grafo de teste são o MESMO grafo — o que muda é o que se injeta.

**5.3 — Entrada e retomada.** `POST /api/eventos` recebe todo evento externo
(canal, CRM, formulário de laudo) e entrega ao despachante; o painel decide e
`retomar()` volta a thread exatamente de onde parou.

**Gate:** um laudo entra por HTTP, para no gate com a linha na fila, e a
aprovação no painel põe o anúncio no ar — sem que ninguém chame função de
agente diretamente.

---

## WAVE 6 — Distribuição pra equipe (~2h)

O `notificarCorretor` era um `console.log`, e o lead era **empurrado** pro
corretor sem ninguém confirmar nada. Esta wave fecha o laço.

**6.1 — Push com aceite e prazo.** O Agente 3 passa a *oferecer* em vez de
entregar: o melhor colocado recebe a oferta e tem `prazoAceiteMin` (5 min) pra
aceitar. Recusou ou deixou vencer, sai da disputa — inclusive do atalho por
vínculo — e o lead vai pro próximo. Esgotado o `maxOfertas` (3), escala pro
painel com `ninguem_aceitou`.

O laço vive **dentro** do agente, e cada oferta é uma pausa do grafo. Na
retomada o `memo` devolve a resposta e o laço continua de onde parou — nenhum
campo de estado novo, nenhuma aresta nova. É a R7 pagando dividendo.

**6.2 — Varredura de prazo.** `varrerPrazos()` marca como `expirado` o que
venceu e retoma a thread com uma negativa. É o que transforma silêncio em
decisão: sem isso, "push com aceite" seria pior que o push direto, porque o
lead ficaria preso esperando alguém que talvez esteja dirigindo.

**6.3 — Canal.** `enviarMensagem()` fala com o bridge do `whatsapp-mcp`
(`POST /api/send`) — o mesmo contrato do WAHA e, com um adaptador, da Cloud
API. **Sem `WHATSAPP_BRIDGE_URL` definida, nada sai**: a mensagem vai pro log.
É como o projeto roda hoje.

**Gate:** um lead é oferecido, ninguém responde, o prazo vence e o segundo
colocado recebe — sem ninguém clicar em nada.

---

## Implantação (planejada, não executada)

O projeto roda inteiro em máquina local contra o Neon. O que falta pra virar
produção num VPS está listado aqui **de propósito** — é decisão de negócio, não
de código:

| Peça | O que fazer no VPS |
|---|---|
| App Next | `npm ci && npm run build && npm start` atrás de nginx com TLS |
| Bridge WhatsApp | subir o binário Go do `whatsapp-mcp` como serviço, parear o número uma vez e apontar `WHATSAPP_BRIDGE_URL=http://localhost:8080` |
| Varredura | cron de minuto: `curl -s -H "x-webhook-secret: $WEBHOOK_SECRET" localhost:3000/api/varredura` |
| Entrada de eventos | `POST /api/eventos` com `x-webhook-secret`, exposto só pro CRM e pro canal |
| Segredos | `.env` fora do repo; a chave Groq vive no cofre em `D:\projetos\.credentials` |

⚠️ **O bridge usa conta pessoal via WhatsApp Web, não a API oficial.** Serve
pra piloto e portfólio; volume comercial pede Cloud API da Meta (número
comercial, templates aprovados, custo por conversa). A troca é de um arquivo —
`src/lib/canal.ts` — justamente porque o canal ficou atrás de uma função só.

---

## WAVE 7 — Operação 24 horas (~2h30)

O sistema atende de madrugada; a equipe não. Esta wave separa as duas coisas e
abre a porta que faltava pra equipe **perguntar**.

**7.1 — O conserto das 3h da manhã.** O prazo do aceite não sabia que horas
eram. Um lead de domingo 3h oferecia ao melhor corretor às 3h00, expirava às
3h05, oferecia ao segundo, expirava, oferecia ao terceiro — e às 3h15 estava
numa fila que ninguém abriria antes das 8h, com **três corretores registrados
como quem não respondeu**. Agora o relógio do prazo só começa a correr na
`proximaAbertura`, e a mensagem fica guardada até lá (`enviar_em`). A varredura
virou também o carteiro das ofertas adiadas. Expediente ganhou dia útil —
sábado trabalha, domingo não —, e a mesma grade passou a gerar os horários de
visita: antes ela oferecia visita de domingo.

**7.2 — Agente de Consulta.** A quinta peça, e a primeira **puxada**: relatório
de estoque, campanhas, vendas, funil de leads, desempenho da equipe e ficha de
imóvel. O modelo escolhe qual relatório roda e depois redige em cima das linhas
— **o número nunca sai do modelo**.

**7.3 — Papel somente-leitura.** O agente de consulta usa um papel do Postgres
com `SELECT` e nada mais. Não é promessa, é permissão: há teste que tenta
escrever por essa conexão e exige o erro `42501` do banco.

> ⚠️ Achado: papel criado pela **API do Neon** herda `neon_superuser` e
> **escreve** apesar de qualquer `GRANT` restritivo. O papel de leitura precisa
> ser criado por `CREATE ROLE` em SQL. O primeiro teste passou por isso.

**Gate:** um lead de madrugada não acorda ninguém e chega inteiro às 7h30; e a
equipe pergunta "quanto estou gastando em mídia?" e recebe o número que está no
banco.

---

## WAVE 8 — identidade multicanal, alterador, funil, locação e escrituras

Os cinco pontos que estavam abertos no fechamento do dia anterior. Nenhum era
"falta código simples": dois eram domínio novo, um era decisão de régua, um era
modelagem de identidade, um era tela que não existia.

### 8.1 — Identidade sem telefone

O problema, nas palavras do user: a pessoa é identificável pelo Instagram ou
pelo WhatsApp **sem considerar o número**, e o nome do perfil pode não ter
relação nenhuma com o nome civil.

Três níveis de certeza, tratados diferente:

| Nível | Exemplo | O que acontece |
|---|---|---|
| Determinístico | CPF; o mesmo @ no mesmo canal | Vincula sozinho |
| Declarado | "sim, sou eu do Insta" | Vincula sozinho |
| Probabilístico | mesmo apelido em outro canal + mesma busca | **Vira pergunta, nunca escrita** |

O sinal que ocupa o lugar do telefone é o **miolo do apelido**: `ju.mendes.sp`
no Instagram e "Ju Mendes" no perfil do WhatsApp viram os dois `jumendes`. Vale
exatamente o limite da sugestão (60 de 60): sempre dá pra perguntar, nunca dá
pra fundir.

Duas regras que o próprio teste obrigou a escrever:

1. **Nome de exibição só conta se for composto.** "Roberto" batendo com
   "Roberto" é homônimo, não é a mesma pessoa. Sem essa regra o sistema sugeria
   fundir dois estranhos.
2. **Empate vai pro humano.** Dois candidatos igualmente prováveis significa que
   os sinais não distinguem ninguém — escolher o primeiro é sorteio com cara de
   decisão.

A assimetria que desenha tudo: **duplicar é chato, fundir errado é vazamento.**
Fusão errada mostra a negociação de uma pessoa para outra.

Arquivos: `src/regras/identidade.ts`, `src/lib/identidade-db.ts`, tabela
`identidade` com único em `(canal, identificador)`.

### 8.2 — Agente 6, Alterador de Cadastro

Tira o sistema da dependência de alguém técnico pra mudar um preço ou corrigir
um endereço lido errado.

**Ele não é dono de nenhum campo.** Na tabela da R5 a linha dele é `never`:
`Escrita<"6_alterador">` não tem valor possível, então ele literalmente não
compila uma escrita. Interpreta, mostra o "de → para", e quem escreve é o
humano que confirmou — o log sai com `agenteOrigem: "humano"`, que é a verdade.

Não é precaução: as duas coisas que ele faz (entender texto ambíguo e escolher
entre registros parecidos) são exatamente onde um modelo erra com confiança.
Dois apartamentos no Campolim é o caso normal, não a exceção.

Campos bloqueados com a razão escrita: estado operacional (é conclusão do
laudo), estado comercial (vem do documento), anúncio no ar (é regra + gate).

Arquivos: `src/agentes/alterador.ts`, `src/regras/alteracao.ts`,
`src/lib/alteracao-db.ts`, `app/alterar/`. Nó no grafo com a mesma R7 dos
outros — provada em `src/grafo/alterador.grafo.test.ts`.

### 8.3 — Funil com três estados

A régua que faltava, definida pelo user: quem chegou ao fim e sumiu vale mais
que quem só iniciou a conversa.

- `aberto` — a bola é nossa;
- `pendente` — a bola é do cliente;
- `fechado` — tem desfecho escrito.

`prioridade` = peso da **etapa mais funda já alcançada** + pressão do silêncio,
e a pressão é relativa ao teto da etapa. Proposta parada há 5 dias empata com
primeiro contato parado há 30: os dois acabaram de estourar. Passado o teto,
quem estava mais fundo sobe mais rápido.

**O sistema nunca fecha sozinho.** Estourado, o caso volta pra `aberto` marcado
como precisando de desfecho. Fechar por silêncio é escrever "não quis" onde a
verdade é "não sei", e é assim que a lista de perdidos deixa de servir pra
decidir qualquer coisa. Motivos são lista fechada — texto livre não responde
"quantos perdemos por preço?".

Arquivos: `src/regras/funil.ts`, tabela `atendimento`, `app/funil/`.

### 8.4 — Módulo de locação

Pesquisa de mercado (ImobiBrasil, Pilota Imóveis, Alugo): o que todo sistema
bem posicionado tem é cobrança mensal, reajuste por índice, multa e juros,
régua de inadimplência, repasse ao proprietário e portal das partes.

Implementado em regra pura e testado: `gerarParcela`, `calcularEncargos`,
`reguaCobranca`, `calcularRepasse`, `reajusteDevido`, `avisosDeVigencia`.

Decisões que valem registro:

- **O reajuste não é aplicado sozinho.** O índice do ano vem de fora e o valor
  se negocia — inquilino bom se perde por 8% de IGPM no automático. O sistema
  calcula, avisa e espera confirmação. `reajusteDevido(contrato, null)` devolve
  `valorNovo: null` de propósito: inventar esse número seria a pior mentira que
  este sistema poderia contar.
- **A taxa de administração incide só sobre o aluguel**, não sobre condomínio e
  IPTU. É a reclamação clássica de proprietário, e ele confere.
- **O primeiro passo da régua é antes do vencimento.** A maior parte do atraso é
  esquecimento; cobrar depois já custou o relacionamento.
- **Vencimento dia 31 em mês de 30 cai no último dia**, não vira dia 1 do mês
  seguinte.

Fora de escopo, de propósito: emissão de boleto e PIX reais. Isso é integração
bancária, e num projeto de portfólio uma integração financeira falsa é pior que
nenhuma.

Arquivos: `src/regras/locacao.ts`, tabelas `contrato_locacao` e
`parcela_aluguel`, `app/locacao/`.

### 8.5 — Módulo de escrituras

A ordem legal, que é a razão de ser uma esteira: **escritura não transfere
imóvel, registro transfere.** Contrato → documentação → ITBI emitido → ITBI pago
→ escritura lavrada → registro protocolado → registro concluído.

O que quebra qualquer tentativa de tratar isso como as outras filas: **metade
das etapas não é nossa.** Cada etapa carrega `responsavel`, e só o que é
`imobiliaria` vira tarefa acionável. Cartório atrasado não gera prazo vencido,
gera "liga lá e pergunta o protocolo" — e a tela separa as duas listas, porque
cobrar prazo de quem não é nosso ensina a equipe a ignorar o alerta inteiro.

Prazos vindos da prática: 1–7 dias pra lavrar, 15–45 pro registro. Custo
estimado 4–5% do valor (ITBI 2–3% + emolumentos).

Arquivos: `src/regras/escritura.ts`, tabela `processo_escritura`,
`app/escrituras/`.

### Os três ciclos do tempo

`src/lib/ciclos.ts` — o que acorda porque o tempo passou, não porque alguém
fez algo: `reavaliarAtendimentos`, `varrerLocacao`, `varrerEscrituras`. Todos
idempotentes, todos pendurados na varredura que já existia.

### 8.6 — A recepção: identidade valendo na entrada

`src/lib/recepcao.ts` resolve quem é a pessoa **antes** do grafo rodar, porque a
chave de lock do Agente 4 já é o cliente — não dá pra descobrir isso lá dentro.

A decisão que define o módulo:

> **O atendimento não espera a fusão.** Cria o cadastro, responde na hora, e o
> pedido de fusão vai pro painel em paralelo.

Segurar a conversa até alguém confirmar deixaria um cliente de 3h da manhã sem
resposta até as 7h30 por causa de dúvida interna de cadastro. Duplicata desfaz
com um clique; lead sem resposta não volta.

Junto:

- O webhook aceita `contato: {canal, identificador, apelido}` — antes exigia que
  o mundo lá fora já soubesse o `id_cliente` do nosso banco, o que nenhum canal
  real sabe.
- **Limite de 4000 caracteres na mensagem** — pendência da auditoria, resolvida
  de passagem.
- Aprovar `fundir_identidade` no painel **de fato funde**; o cadastro antigo é
  quem sobrevive, porque carrega o histórico mais longo.
- Mensagem nova **reabre caso pendurado**, mantendo `etapaMaxima`: quem voltou a
  falar não precisa de ponto final, precisa de resposta — e volta ao topo da
  fila, não ao fim.

`npm run recepcao` demonstra contra o banco real.

**Gate:** 215 testes verdes · build com 7 telas · varredura real gerando parcela,
cobrando o atrasado, avisando dois reajustes devidos e separando o processo
travado do nosso lado do que está sentado no cartório.

---

## Cobertura

Toda tabela da seção 6 é criada na Wave 1 e escrita por alguma parte depois:

| Tabela | Criada | Escrita por |
|---|---|---|
| `imovel` | 1.1 | 2.1, 2.2 |
| `anuncio` | 1.1 | 2.1 |
| `laudo` | 1.1 | 2.1 |
| `transacao` | 1.1 | 2.2 |
| `cliente`, `busca`, `papel` | 1.1 | 3.1 |
| `corretor`, `dominio_corretor` | 1.1 | seed / humano |
| `agenda`, `vinculo_lead_corretor` | 1.1 | 2.3 |
| `aprovacao` | 1.1 | 2.1, 2.2, 2.3, 3.1, 4.1 |
| `log_evento` | 1.1 | todas |
| `identidade` | 8.1 | 4.1 / humano |
| `atendimento` | 8.3 | 4.1, varredura, humano |
| `contrato_locacao`, `parcela_aluguel` | 8.4 | varredura / humano |
| `processo_escritura` | 8.5 | varredura / humano |

Nenhuma wave depende de algo produzido depois dela.

---

## Riscos conhecidos

1. **Next.js divergente.** A Parte 1.3 é a primeira a tocar nisso e pode estourar o timeout se os docs locais mudarem convenção de rota ou de data fetching. É a parte a monitorar na Wave 1.
2. **Maturidade do LangGraph.js.** ~~Risco alto~~ — rebaixado. Verificado e instalado: `@langchain/langgraph` 1.4.14, `@langchain/langgraph-checkpoint-postgres` 1.0.5, `langchain` 1.5.10, `@langchain/groq` 1.3.1. Port JS em 1.x estável, com checkpointer Postgres oficial — que é exatamente o que a R2 precisa. A Parte 1.4 usa só `StateGraph`, arestas condicionais, `interrupt()` e checkpointer. Resta confirmar na prática que o `interrupt()` do port JS retoma o estado como o Python; é o primeiro teste da 1.4.
3. **Qualidade de extração do Agente 1.** O par `texto_*` / `extracao_estruturada` existe justamente porque isso vai errar. Se a taxa de erro nas fixtures ficar alta, o ajuste é de prompt, não de arquitetura — não deve bloquear a wave.
4. **`dominio_corretor` sem dono automático.** A tabela é preenchida por humano e o Agente 3 depende dela pra pontuar. Antes deixava o roteamento degradar em silêncio; agora o caso 1 do envelope (`score_minimo`) transforma isso em escalação visível no painel. O risco virou alerta — mas o `score_minimo` precisa ser calibrado com estoque real, senão ou escala demais ou nunca escala.

5. **Re-execução do nó no resume (R7).** Confirmada em `src/grafo/interrupt.test.ts`: o nó que chama `interrupt()` roda do começo de novo. Neutralizada na Wave 5 por topologia (agente e gate em nós separados) + `memo` no estado + unique em `log_evento` e `aprovacao`. `src/grafo/r7.test.ts` é a trava: se alguém voltar a chamar modelo dentro do nó que interrompe, ele quebra.

6. **Equipe que não responde.** O `prazoAceiteMin` de 5 min vem da literatura de *speed to lead* (comprador de imóvel fala com várias imobiliárias ao mesmo tempo). É chute calibrado por fora: cedo demais o lead pula de corretor sem necessidade, tarde demais o cliente desiste. Precisa de uso real pra afinar, e o sinal de que está errado é a taxa de `expirado` no `log_evento`.
