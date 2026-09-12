# Costa & Vale Imóveis — detalhes do projeto

Sistema de estoque, anúncio e atendimento para uma imobiliária, conduzido por
**seis agentes de IA sobre um núcleo de regras determinísticas**.

Princípio central: **o modelo lê texto de gente; nenhuma decisão sai dele.**
Ele extrai o que um vendedor escreveu num laudo de vistoria — quem decide se o
imóvel pode ser anunciado é uma função em TypeScript, testável sem chave de
API e sem banco. O que o modelo erra vira dado errado, nunca ação errada.

> Sistema funcional e pronto para rodar, com dados de demonstração de uma
> imobiliária de Sorocaba. Não está em produção: a implantação em servidor
> está descrita no plano e ainda não foi executada.

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

O agente mais autônomo (Roteador) é o único sem IA — tipo de agente e nível de
autonomia são eixos independentes.

## Decisões de arquitetura que valem lembrar

- **Escrita fora do próprio campo é erro de compilação.** Cada agente recebe
  um contexto tipado com os campos que possui; escrever no campo de outro não
  passa no `tsc`.
- **O nó que interrompe não age.** `interrupt()` do LangGraph re-executa o nó
  do começo ao retomar — efeito colateral antes dele dobra. Defesa topológica
  (nó do agente separado do nó que interrompe) + memoização de estado + índices
  únicos no banco. Provado em `src/grafo/r7.test.ts`.
- **Atender é 24h; alocar corretor não é.** Lead de madrugada é respondido na
  hora, oferta ao corretor espera o expediente — senão o rodízio de 5 minutos
  queima os melhores corretores contra gente dormindo.
- **Identidade entre canais nunca funde sozinha.** Reconhecimento por
  heurística vira pergunta no painel, nunca escrita automática — duplicar é
  chato, fundir errado é vazamento de dados entre clientes.
- **O cérebro guarda o que a equipe entendeu, nunca o que é verdade.**
  Observações vivem num schema Postgres separado, entram no prompt marcadas
  como observação e perdem para qualquer dado de cadastro. Correção nunca
  apaga — escreve embaixo, com data e autor (como averbação de matrícula).
- **Mensagem fora do assunto não vira lead.** Resposta fixa em código, nada
  gravado — exceto proposta atípica (permuta, litígio), que escala.
- **O sistema nunca fecha um atendimento sozinho.** Silêncio prolongado sobe o
  caso ao topo da fila para desfecho humano.
- **Cartório atrasado não é tarefa vencida.** Só o que é responsabilidade da
  imobiliária vira trabalho; o que depende de terceiro vira acompanhamento.

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
docs/         especificação, plano executivo, implantação e calibração
drizzle/      migrations
```

`src/regras/` não importa banco nem modelo — é o que permite testar a decisão
de negócio isolada da infraestrutura.

## Telas

| Rota | O que é |
|---|---|
| `/` | Fila de decisões humanas e ofertas de lead em aberto |
| `/funil` | Atendimentos ordenados por urgência, não por data |
| `/locacao` | Contratos, parcelas, atrasos e reajustes devidos |
| `/escrituras` | A esteira até a matrícula, separada por de quem é a bola |
| `/alterar` | Pedido de alteração de cadastro em texto livre |
| `/consulta` | Perguntas da equipe sobre os relatórios |
| `/mensagens` | Tudo que o sistema falou — ou teria falado, com o canal desligado |
| `/cerebro` | O que a equipe entendeu com a operação — editável, sem mexer em cadastro |
| `/imovel/[id]` | Histórico completo de por que um anúncio caiu |

Painel inteiro exige senha (`proxy.ts`); quem decidiu é quem entrou (auditoria
não é campo livre). Rotas de máquina (`/api/eventos`, `/api/varredura`) usam
segredo próprio — cron não faz login.

## Como rodar

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e GROQ_API_KEY
npm run db:migrate        # aplica as migrations
npm run acesso -- seunome # gera a senha do painel e a linha do PAINEL_USUARIOS
npm run seed              # estoque de demonstração de Sorocaba
npm run dev               # http://localhost:3000
```

Testes de integração usam banco separado (`TEST_DATABASE_URL`, branch do
Neon) — sem essa variável, marcam-se como pulados. A suíte roda sem chave de
API e sem banco (extrator falso nos testes de unidade).

```bash
npm test          # 215 testes
npm run typecheck
```

Scripts de demonstração: `varredura`, `recepcao`, `perguntar`, `procedencia`,
`aferir`, `simular`.

## Segurança e limites conhecidos

- Nenhum canal está ligado de verdade: mensagens ficam em `/mensagens`, mas
  não saem enquanto `WHATSAPP_BRIDGE_URL` não existir.
- O sistema não aprende sozinho por escolha: registra modelo e versão de
  prompt por leitura (`leitura_modelo`), afere contra referência
  (`npm run aferir`), guarda entendimento num cérebro editável (`/cerebro`) —
  mas nenhuma nota vira ajuste de cadastro sem confirmação humana. Plano em
  `docs/PLANO_CEREBRO.md`.
- `docs/calibracao.json` traz chutes iniciais que precisam de operação real.
- Webhook exige segredo compartilhado; agente de consulta usa role de banco
  só com `SELECT`.

## Documentação de apoio

- `docs/PROJECT_SPEC.md` — especificação completa
- `docs/PLANO_EXECUTIVO.md` — plano executivo
- `docs/IMPLANTACAO.md` — processo de levar para produção em uma empresa real
- `docs/PLANO_CEREBRO.md` — plano do módulo de aprendizado/observações
- `docs/TESE-ROTEAMENTO.md` — tese por trás do roteamento de leads
- `docs/spec-costa-vale-agentes.md` — spec detalhada dos agentes
- `docs/calibracao.json` — números de calibração do modelo
