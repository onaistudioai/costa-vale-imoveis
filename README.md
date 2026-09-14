# Costa & Vale Imóveis

Sistema de estoque, anúncio e atendimento para uma imobiliária, conduzido por
**seis agentes de IA sobre um núcleo de regras determinísticas**.

A ideia que organiza tudo: **o modelo lê texto de gente; nenhuma decisão sai
dele.** Ele extrai o que um vendedor escreveu num laudo de vistoria — e quem
decide se o imóvel pode ser anunciado é uma função em TypeScript, testável sem
chave de API e sem banco. O que o modelo erra vira dado errado, nunca ação
errada.

> Sistema funcional e pronto para rodar, com dados de demonstração de uma
> imobiliária de Sorocaba. Não está em produção: a implantação em servidor está
> descrita no plano e ainda não foi executada.

## O problema

Uma imobiliária pequena perde dinheiro em lugares que ninguém vê: o imóvel que
ficou pronto e nunca foi anunciado, a campanha paga que continua rodando num
imóvel já vendido, o lead que chegou às 22h de domingo e foi respondido na
terça, o cliente que fez proposta e sumiu sem ninguém registrar por quê.

Nenhum desses problemas é de atendimento. Todos são de **coordenação** — e é
isso que o sistema faz.

## Os seis agentes

| # | Agente | O que faz | Chama modelo? |
|---|---|---|---|
| 1 | **Curador** | Lê o laudo de vistoria, decide o estado do imóvel por regra e pede aprovação para publicar | sim, só na extração |
| 2 | **Guardião** | Lê documentos da negociação e protege o estoque quando um imóvel sai do mercado | sim, só na extração |
| 3 | **Roteador** | Escolhe o corretor e oferece o lead com prazo | **não** — é determinístico |
| 4 | **Atendimento** | Responde 24/7, qualifica e entrega ao Roteador | sim |
| 5 | **Consulta** | Responde perguntas da equipe sobre 6 relatórios | sim, mas o número vem do banco |
| 6 | **Alterador** | Traduz "muda o preço do apartamento do Campolim" em alteração de cadastro | sim |

Repare no 3: **o agente mais autônomo é o único sem IA.** Tipo de agente e
nível de autonomia são eixos independentes — o Guardião é o mais sofisticado e
o que mais precisa de gente; o Roteador é quase um gatilho e o que age mais
sozinho.

## As decisões que valem ler

**A escrita fora do próprio campo é erro de compilação.** Cada agente recebe um
contexto tipado com os campos que ele possui. Escrever no campo de outro não
passa no `tsc` — não é observação de code review, é erro de tipo.

**O nó que interrompe não age.** O `interrupt()` do LangGraph re-executa o nó do
começo quando a execução é retomada. Isso significa que qualquer efeito
colateral antes dele acontece duas vezes: modelo cobrado em dobro, pedido
virando duas linhas na fila. A defesa é topológica — o nó do agente e o nó que
interrompe são nós diferentes — mais memoização no estado e índices únicos no
banco. Está provado em `src/grafo/r7.test.ts`.

**Atender é 24 horas; alocar corretor não é.** Um lead que chega às 3h da manhã
é respondido na hora, mas a oferta ao corretor espera as 7h30. Sem isso, o
rodízio de 5 minutos queimaria os três melhores corretores contra gente
dormindo — e ainda registraria os três como quem não respondeu.

**Identidade entre canais nunca funde sozinha.** A mesma pessoa chega pelo
Instagram como `@ju.mendes.sp` e pelo WhatsApp como "Ju Mendes", sem nenhum
campo em comum. O sistema reconhece pelo miolo do apelido, mas o palpite vira
uma pergunta no painel, nunca uma escrita — porque **duplicar é chato e fundir
errado é vazamento**: mostra a negociação de um cliente para outro.

**O cérebro guarda o que entendemos, nunca o que é verdade.** As observações da
equipe vivem num schema Postgres separado, entram no prompt marcadas como
observação, e perdem de qualquer dado do cadastro. É isso que torna seguro
entregar o botão de editar: o pior que uma nota errada faz é o agente responder
pior — nenhuma nota altera um contrato. E nada é rasurado: corrigir escreve
embaixo, com data e autor, como averbação de matrícula.

**Mensagem fora do assunto não vira lead.** Número errado, spam e pergunta de
outro ramo recebem uma resposta fixa, escrita em código — o que a imobiliária
faz e não faz não é coisa que o modelo decide na hora. E nada é gravado: sem
isso o funil enche de gente que nunca quis comprar nada, e a fila ordenada por
urgência perde o sentido. A exceção é a proposta atípica (permuta, litígio):
essa escala, porque **calar um cliente de verdade custa mais que responder a um
engano**.

**O sistema nunca fecha um atendimento sozinho.** Passado o tempo de silêncio,
o caso sobe ao topo da fila pedindo um desfecho de alguém. Fechar por
inatividade é escrever "não quis" onde a verdade é "não sei".

**Cartório atrasado não é tarefa vencida.** Na esteira de escrituras, cada etapa
sabe de quem é a responsabilidade. Só o que é nosso vira trabalho; o que
depende de cartório ou prefeitura vira acompanhamento. Cobrar prazo de quem não
obedece prazo interno ensina a equipe a ignorar o alerta inteiro.

**Risco é faixa, e nenhuma faixa pula aprovação.** Cada pedido sai verde,
amarelo ou vermelho. A faixa ordena a fila e escolhe o canal de aviso, mas o
verde também espera alguém. O amarelo passa antes por uma mesa de revisão: dois
papéis em tensão (CrewAI, num serviço Python à parte) leem o caso, e se
divergirem quem decide é uma regra de código, que sobe o caso pra gente. A mesa
não tem acesso ao banco.

**A mesa lembra o que a pessoa decidiu.** Aprovação ou recusa no painel vai para
a memória da mesa com o motivo, marcada `[gente]` e com peso maior que o palpite
da própria mesa. No próximo caso parecido, a decisão humana volta no contexto.

**Toda escrita declara quanta autonomia tem.** `src/regras/modo.ts` diz, campo
por campo, se o sistema para e espera (hitl), age e alguém confere (hotl) ou
age sem revisão (hootl), com o porquê. Campo novo sem declaração quebra a
suíte. O que rodou sem aprovação aparece em `/automatico`.

## As telas

| Rota | O que é |
|---|---|
| `/` | Fila de decisões humanas e ofertas de lead em aberto |
| `/funil` | Atendimentos ordenados por urgência, não por data |
| `/locacao` | Contratos, parcelas, atrasos e reajustes devidos |
| `/escrituras` | A esteira até a matrícula, separada por de quem é a bola |
| `/alterar` | Pedido de alteração de cadastro em texto livre |
| `/consulta` | Perguntas da equipe sobre os relatórios |
| `/mensagens` | Tudo que o sistema falou — ou teria falado, com o canal desligado |
| `/automatico` | O que o sistema fez sem ninguém aprovar |
| `/semanas` | As últimas 12 semanas: leads, decisões, expirados, tempo até decidir, falhas do modelo |
| `/cerebro` | O que a equipe entendeu com a operação — editável, e sem poder mexer em cadastro |
| `/imovel/[id]` | "Por que esse anúncio caiu?" — o histórico completo |


## Segurança

- **Painel com senha**, guardada só como hash com sal por pessoa. Sem usuários
  configurados, o painel recusa tudo em vez de abrir.
- **Quem decidiu é quem entrou.** A trilha de auditoria assina com a sessão,
  nunca com um nome digitado no formulário.
- **Dados pessoais cifrados** (CPF, telefone, e-mail, identificadores de canal).
  Um dump do banco sozinho não revela ninguém.
- **Row Level Security** em todas as tabelas, e o agente que responde perguntas
  usa uma conexão só de leitura, sem acesso à trilha de auditoria.
- **Conexão com o banco autenticada** e cifrada.
- **Rotas de integração protegidas por segredo**, comparado em tempo constante.
- **Nenhum segredo no navegador**: sem cookies, sem tokens no `localStorage`,
  sem variável pública, com teste impedindo a regressão.
- **Avisos com lista de permissão**: nada da fala, nome ou telefone do cliente
  sai do painel por WhatsApp ou e-mail.

Os detalhes técnicos estão em [`docs/SEGURANCA.md`](docs/SEGURANCA.md).

## Stack

LangGraph.js · LangChain · Groq · Next.js (App Router) · Drizzle ORM ·
PostgreSQL · Vitest · TypeScript · Zod

Mesa de revisão: Python · FastAPI · CrewAI · Pydantic · LanceDB · pytest. O
contrato entre Zod e Pydantic é conferido por teste nos dois lados.


## Limites conhecidos

O sistema roda inteiro, mas ainda não foi endurecido para produção. O que falta
está documentado, não escondido:

- Nenhum canal está ligado: as mensagens ficam registradas em `/mensagens` com
  o texto exato, mas não saem enquanto `WHATSAPP_BRIDGE_URL` não existir.
- **O sistema não aprende sozinho, e isso é escolha.** Ele registra qual modelo
  e qual versão de prompt produziram cada leitura (`leitura_modelo`), afere a
  leitura contra um conjunto de referência (`npm run aferir`) e guarda o que a
  equipe entendeu num cérebro editável (`/cerebro`). Leitura negada no painel
  vira candidata a caso de referência (`npm run propor-casos`) — mas nenhuma
  nota nem caso vira ajuste sem uma pessoa confirmar.
- O Groq gratuito tem limite de tokens por minuto. Rodar muitas leituras seguidas
  (o `aferir`, por exemplo) pode estourar. O sistema espera o que o Groq pede
  quando é até 15 segundos; acima disso a leitura falha e fica registrada. O plano está em `docs/PLANO_CEREBRO.md`.
- Os números de calibração (`docs/calibracao.json`) são chutes iniciais que
  precisam de operação real para afinar.
