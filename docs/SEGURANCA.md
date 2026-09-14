# Segurança — detalhes técnicos

O que está de pé, e por quê.

## Autenticação

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

## Cookies, localStorage e sessionStorage

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

## Segredos

O `.env` nunca foi commitado (`git log --all -- .env` volta vazio) e o
`.gitignore` cobre `.env*`, com exceção do `.env.example`. Na Vercel, cada
variável entra por `vercel env add <NOME> production`:

`DATABASE_URL`, `DATABASE_URL_LEITURA`, `GROQ_API_KEY`, `GROQ_MODEL`,
`WEBHOOK_SECRET`, `CRON_SECRET`, `PAINEL_USUARIOS`, `WHATSAPP_BRIDGE_URL`,
`PII_KEY`, `PII_INDEX_KEY`.

`TEST_DATABASE_URL` e `TEST_DATABASE_URL_LEITURA` não vão para a Vercel: são só
de desenvolvimento, e apontam para o branch `testes` do Neon porque a suíte de
integração apaga tabelas inteiras.

## Banco

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

## Criptografia da PII

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

## Cron

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

## O que um não autenticado alcança hoje

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

