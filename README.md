# Costa & Vale Imóveis

Sistema de estoque, anúncio e atendimento para uma imobiliária, conduzido por
**seis agentes de IA sobre um núcleo de regras determinísticas**.

A ideia que organiza tudo: **o modelo lê texto de gente; nenhuma decisão sai
dele.** Ele extrai o que um vendedor escreveu num laudo de vistoria — e quem
decide se o imóvel pode ser anunciado é uma função em TypeScript, testável sem
chave de API e sem banco. O que o modelo erra vira dado errado, nunca ação
errada.

> Projeto de portfólio. A imobiliária, os corretores, os imóveis e os clientes
> são fictícios. A implantação em servidor está descrita no plano, mas não foi
> executada.

## Por que existe

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

**O sistema nunca fecha um atendimento sozinho.** Passado o tempo de silêncio,
o caso sobe ao topo da fila pedindo um desfecho de alguém. Fechar por
inatividade é escrever "não quis" onde a verdade é "não sei".

**Cartório atrasado não é tarefa vencida.** Na esteira de escrituras, cada etapa
sabe de quem é a responsabilidade. Só o que é nosso vira trabalho; o que
depende de cartório ou prefeitura vira acompanhamento. Cobrar prazo de quem não
obedece prazo interno ensina a equipe a ignorar o alerta inteiro.

## Como rodar

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e GROQ_API_KEY
npm run db:migrate        # aplica as 6 migrations
npm run seed              # estoque fictício de Sorocaba
npm run dev               # http://localhost:3000
```

A suíte roda **sem chave de API e sem banco** — os testes de unidade injetam um
extrator falso, e os de integração se marcam como `skipped` quando não há
`DATABASE_URL`.

```bash
npm test          # 215 testes
npm run typecheck
```

Scripts de demonstração:

```bash
npm run varredura   # o que o tempo passou: prazos, aluguéis, cartórios
npm run recepcao    # a mesma pessoa chegando por dois canais diferentes
npm run perguntar -- "quanto estou gastando em mídia paga agora?"
npm run procedencia  # qual modelo e qual versão de prompt produziram cada leitura
```

## As telas

| Rota | O que é |
|---|---|
| `/` | Fila de decisões humanas e ofertas de lead em aberto |
| `/funil` | Atendimentos ordenados por urgência, não por data |
| `/locacao` | Contratos, parcelas, atrasos e reajustes devidos |
| `/escrituras` | A esteira até a matrícula, separada por de quem é a bola |
| `/alterar` | Pedido de alteração de cadastro em texto livre |
| `/consulta` | Perguntas da equipe sobre os relatórios |
| `/imovel/[id]` | "Por que esse anúncio caiu?" — o histórico completo |

## Stack

LangGraph.js · LangChain · Groq · Next.js (App Router) · Drizzle ORM ·
PostgreSQL · Vitest · TypeScript

## Estrutura

```
app/          telas e rotas de API
src/regras/   regras puras — sem banco, sem modelo, 100% testáveis
src/agentes/  os seis agentes
src/grafo/    o grafo, o despachante e o contrato de coordenação
src/lib/      banco, varredura, recepção, consultas do painel
docs/         especificação, plano executivo e números de calibração
drizzle/      migrations
```

A separação que sustenta o resto: **`src/regras/` não importa banco nem modelo.**
É o que permite testar a decisão de negócio isolada da infraestrutura.

## Segurança e limites conhecidos

Isto é um projeto de portfólio e não está pronto para produção. O que falta
está documentado, não escondido:

- **O painel não tem autenticação.** Qualquer um com o endereço aprova anúncio.
- **O sistema não aprende.** Ele registra tudo — inclusive, agora, qual modelo
  e qual versão de prompt produziram cada leitura (`leitura_modelo`) — mas nada
  se ajusta sozinho. O caminho até lá está em `docs/PLANO_CEREBRO.md`.
- Os números de calibração (`docs/calibracao.json`) são chutes iniciais que
  precisam de operação real para afinar.
- O webhook exige um segredo compartilhado; o agente de consulta usa um papel
  de banco que só tem `SELECT` — provado em teste, não prometido em comentário.
