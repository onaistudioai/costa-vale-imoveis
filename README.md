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

## Como rodar

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e GROQ_API_KEY

# As duas chaves da PII. Diferentes entre si, 32 bytes cada. Guarde-as: sem a
# PII_KEY os dados cifrados não voltam.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # PII_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # PII_INDEX_KEY

npm run db:migrate        # aplica as migrations, RLS incluso
npm run acesso -- seunome # gera a senha do painel e a linha do PAINEL_USUARIOS
npm run seed              # estoque de demonstração de Sorocaba
npm run dev               # http://localhost:3000
```

Os testes de integração usam um **banco separado** (`TEST_DATABASE_URL`, um
branch do Neon). Sem essa variável eles se marcam como pulados — a suíte apaga
tabelas a cada teste, e apontá-la para o banco de trabalho apaga o estoque.

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
npm run aferir       # o conjunto de referência contra o modelo real
npm run simular      # o custo do lead sem dono, com a rotina real do corretor
```

Num banco que já tem dados de antes da criptografia, uma vez só:

```bash
npm run cifrar-pii              # modo seco: diz o que faria
npm run cifrar-pii -- aplicar   # grava, numa transação só
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
| `/mensagens` | Tudo que o sistema falou — ou teria falado, com o canal desligado |
| `/cerebro` | O que a equipe entendeu com a operação — editável, e sem poder mexer em cadastro |
| `/imovel/[id]` | "Por que esse anúncio caiu?" — o histórico completo |

O painel inteiro exige senha (`proxy.ts`), e **quem decidiu é quem entrou** — o
campo de auditoria deixou de ser um texto que a pessoa preenche com o nome que
quiser. As rotas de máquina (`/api/eventos`, `/api/varredura`) ficam de fora da
senha porque têm o próprio segredo: cron não faz login.

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

A separação que sustenta o resto: **`src/regras/` não importa banco nem modelo.**
É o que permite testar a decisão de negócio isolada da infraestrutura.

## Levar para o sistema de uma empresa

`docs/IMPLANTACAO.md` descreve o processo completo: levantamento dos números
que precisam mudar, encaixe no que a empresa já usa, carga de dados, duas
semanas em sombra (o sistema decide e não executa), virada de um agente por
vez — o que fala com cliente é sempre o último — e a supervisão em regime.

## Segurança

O que está de pé, e por quê.

### Autenticação

O painel inteiro fica atrás de HTTP Basic, conferido no `proxy.ts` (no Next 16
o antigo `middleware` chama-se `proxy`, e roda no runtime Node). Basic auth é
escolha, não preguiça: o painel tem um punhado de usuários dentro da
imobiliária, e tela de login + tabela de sessão + recuperação de senha é mais
código pra manter do que o problema pede.

As senhas nunca ficam em texto puro. `PAINEL_USUARIOS` guarda `nome:sal:hash`,
com `scrypt` e sal por pessoa; gere com `npm run acesso -- <nome>`. Sem a
variável, o painel responde **503 em tudo** — abrir por falta de configuração
seria pior que não ter porta, porque pareceria protegido.

Quem entrou é carimbado em `x-usuario` pelo `proxy.ts`, que **apaga** qualquer
`x-usuario` vindo de fora antes de escrever o seu. As oito server actions em
`app/actions.ts` chamam `exigirUsuario()`: o campo "decidido por" da trilha de
auditoria sai da sessão e não do formulário. Antes dava pra assinar uma decisão
com o nome de outra pessoa mandando o POST à mão.

O que o Basic auth **não** dá, e fica como dívida conhecida: não há logout, não
há expiração de sessão, e a credencial vai em toda requisição. A defesa de CSRF
em jogo é a checagem de Origin embutida nas server actions do Next.

### Cookies, localStorage e sessionStorage

Nada a proteger, e vale registrar por quê:

- **Nenhum cookie** é definido ou lido no projeto. Basic auth guarda a
  credencial no cofre do navegador; não existe cookie de sessão para marcar
  `HttpOnly` / `Secure` / `SameSite`.
- **Nenhum token no `localStorage`.** Não há uma linha de `localStorage` no
  repositório — todas as páginas são server components.
- **`sessionStorage` já é limpo pelo navegador ao fechar a aba**, por definição
  da API. Também não há uso nenhum aqui.
- **Nenhuma variável `NEXT_PUBLIC_*`**, e portanto nenhum segredo no bundle. O
  teste `src/lib/ambiente.test.ts` é o guarda que impede a regressão.

### Segredos

O `.env` nunca foi commitado (`git log --all -- .env` volta vazio) e o
`.gitignore` cobre `.env*`, com exceção do `.env.example`. Na Vercel, cada
variável entra por `vercel env add <NOME> production`:

`DATABASE_URL`, `DATABASE_URL_LEITURA`, `GROQ_API_KEY`, `GROQ_MODEL`,
`WEBHOOK_SECRET`, `CRON_SECRET`, `PAINEL_USUARIOS`, `WHATSAPP_BRIDGE_URL`,
`PII_KEY`, `PII_INDEX_KEY`.

`TEST_DATABASE_URL` e `TEST_DATABASE_URL_LEITURA` não vão para a Vercel: são só
de desenvolvimento, e apontam para o branch `testes` do Neon porque a suíte de
integração apaga tabelas inteiras.

### Banco

As duas conexões usam `ssl: { rejectUnauthorized: true }`, e as URLs pedem
`sslmode=verify-full`. Cifrar sem autenticar o servidor protege do bisbilhoteiro
passivo e de mais ninguém.

A conexão só-leitura (`DATABASE_URL_LEITURA`, usada só pelo Agente 5) agora é
obrigatória: sem ela a aplicação **não sobe**. Antes ela caía na conexão com
poder de escrita deixando um aviso no log, que é a forma de uma garantia sumir
sem ninguém notar.

A migração `0011_rls.sql` liga Row Level Security com `FORCE` em todas as
tabelas. `FORCE` não é detalhe: sem ele o dono da tabela ignora as políticas, e
como a aplicação roda com o dono, o RLS seria enfeite. O papel `painel` (dado a
quem roda a migração) tem política `FOR ALL USING (true)`; a leitura tem
política `FOR SELECT` em tudo **menos** `aprovacao`, `log_evento`,
`leitura_modelo` e `mensagem_enviada` — o Agente 5 responde pergunta com texto
vindo de fora, é o mais exposto a injeção, e é o que menos precisa da trilha de
auditoria. No RLS, ausência de política é zero linhas, não erro.

Alcance honesto: sem dono por linha, o RLS aqui é *deny-by-default* entre
papéis, não isolamento entre usuários do painel. Ele protege contra uma
conexão com poder menor; não impede um usuário do painel de ver o cliente de
outro corretor. Isolamento por corretor exigiria dono por linha e `SET LOCAL` a
cada requisição, e não é o que este sistema faz.

### Criptografia da PII

`cliente.cpf_cnpj`, `cliente.telefone`, `cliente.email`, `corretor.telefone` e
`identidade.identificador` ficam cifrados com AES-256-GCM (`src/lib/cripto.ts`),
com IV novo a cada gravação — o mesmo telefone gera cifras diferentes, então a
coluna não denuncia quem repete. A chave (`PII_KEY`) nunca passa pela conexão:
quem tiver um dump do banco não tem os dados. A trilha de auditoria guarda o
"de → para" desses campos igualmente cifrado, senão o `log_evento` devolveria
justamente o que a coluna esconde.

Busca exata sobre cifra não funciona, então há dois **índices cegos** (HMAC com
uma chave separada, `PII_INDEX_KEY`): `cliente.email_indice` e
`identidade.identificador_indice`. É o segundo que carrega a unicidade por
canal.

A busca difusa que liga `ju.mendes.sp` a `jumendes` perdeu o `ILIKE` sobre o
identificador — ciphertext não casa com `%jumendes%`. Ela virou varredura
decifrada em memória, com teto, em `src/lib/identidade-db.ts`. O `ILIKE` sobre
o apelido continua no banco: apelido é nome de exibição, não identificador.

Para migrar dados já existentes, uma vez, depois de `npm run db:migrate`:

```
npm run cifrar-pii              # mostra o que faria
npm run cifrar-pii -- aplicar   # grava, numa transação só
```

**Perder a `PII_KEY` é perder os dados.** É esse o ponto.

### Cron

A varredura de prazo (`/api/varredura`) precisa rodar **a cada minuto**: é ela
que faz a oferta expirar e passar o lead pro próximo colocado. O plano Hobby da
Vercel só permite cron uma vez por dia, então `vercel.ts` **não** declara
`crons` — um cron diário não seria "menos frequente", seria o repasse
automático desligado com aparência de ligado.

Quem chama é um cron externo:

```
* * * * * curl -s -X POST -H "x-webhook-secret: $WEBHOOK_SECRET"           https://costa-vale-imoveis.vercel.app/api/varredura
```

Virando Pro, acrescente `crons: [{ path: "/api/varredura", schedule: "* * * * *" }]`
ao `vercel.ts` e desligue o externo. O `src/lib/segredo.ts` já aceita as duas
formas de autenticação.

### O que um não autenticado alcança hoje

| Alcance | Estado |
|---|---|
| `/_next/static/*`, `/_next/image`, `/favicon.ico` | Público. São assets de build. |
| `POST /api/eventos` | Sem login, por necessidade: canal e CRM não sabem fazer login. Protegido por `x-webhook-secret` ou `Authorization: Bearer $CRON_SECRET`, comparados em tempo constante. Sem nenhum segredo no ambiente → 401 em tudo. |
| `GET`/`POST` `/api/varredura` | Idem. `GET` existe porque é assim que um cron costuma chamar; o `Bearer $CRON_SECRET` existe para o dia em que o Vercel Cron assumir, sem o segredo ir na URL. |
| Todo o resto | **401 Basic.** Sem `PAINEL_USUARIOS` → **503 em tudo.** |

Com credencial de painel **não há papéis**: `/`, `/funil`, `/locacao`,
`/escrituras`, `/alterar`, `/consulta`, `/mensagens`, `/cerebro` e
`/imovel/[id]` são iguais para todo mundo, e qualquer usuário aprova, funde
cadastro e fecha atendimento. É decisão consciente para uma equipe pequena, não
esquecimento — o que a auditoria garante é *quem* fez, não *se podia*.

## Limites conhecidos

O sistema roda inteiro, mas ainda não foi endurecido para produção. O que falta
está documentado, não escondido:

- Nenhum canal está ligado: as mensagens ficam registradas em `/mensagens` com
  o texto exato, mas não saem enquanto `WHATSAPP_BRIDGE_URL` não existir.
- **O sistema não aprende sozinho, e isso é escolha.** Ele registra qual modelo
  e qual versão de prompt produziram cada leitura (`leitura_modelo`), afere a
  leitura contra um conjunto de referência (`npm run aferir`) e guarda o que a
  equipe entendeu num cérebro editável (`/cerebro`) — mas nenhuma nota vira
  ajuste sem uma pessoa confirmar. O plano está em `docs/PLANO_CEREBRO.md`.
- Os números de calibração (`docs/calibracao.json`) são chutes iniciais que
  precisam de operação real para afinar.
