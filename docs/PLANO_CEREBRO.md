# Plano — o cérebro compartilhado

> **Estado (07/09/2026): as três ondas estão implementadas.** Procedência em
> `leitura_modelo`, aferição em `npm run aferir` (baseline 10/10 do prompt
> `83a509bb1c39`), cérebro em `/cerebro`. 240 testes.

Como os seis agentes passam a **aprender sem poder errar sobre a empresa**.

O sistema hoje registra tudo e não ajusta nada. Este plano fecha esse buraco em
três ondas, na ordem em que uma destrava a outra: primeiro saber **quem leu**,
depois saber **se leu bem**, e só então guardar **o que se aprendeu**.

---

## A regra que sustenta tudo

> **O cérebro não guarda o que é verdade sobre a empresa.
> Guarda o que a gente entendeu sobre ela.**

Preço, contrato, matrícula, comissão: nada disso mora no cérebro. Se uma nota
disser 820 mil e o cadastro disser 846, o cliente ouve **846** — sempre.

É essa regra que torna a edição humana segura: o pior que uma nota errada faz é
o agente responder pior. Nenhuma nota altera um contrato. E ela não é promessa
de comentário — é topologia:

- o cérebro vive num **schema Postgres separado** (`cerebro`), com migration
  própria;
- `src/cerebro/` **não importa** `@/lib/db/schema` — nem pra ler;
- o que sai do cérebro é **dica de texto** e **ajuste de peso limitado**, nunca
  um valor de campo. Um teste prova isso: uma nota afirmando um preço não muda
  o preço que o sistema responde.

---

## Onda 1 — Procedência (saber quem leu)

**Por quê primeiro:** sem saber qual modelo e qual prompt produziram cada
leitura, "melhorou" é opinião. É também a onda mais barata: não muda o
comportamento de agente nenhum.

**O que entra**

| Peça | Onde |
|---|---|
| Tabela `leitura_modelo` | `src/lib/db/schema.ts` + migration 0007 |
| Envelope `comProcedencia()` | `src/agentes/procedencia.ts` |
| Gravação no banco | `src/lib/leitura-db.ts` |
| Ligação no grafo e na consulta | `src/grafo/index.ts`, `app/actions.ts` |

**Decisões**

- **A versão do prompt é o hash do próprio prompt.** Nada de campo `v2` que
  alguém esquece de subir: `sha256(sistema)` muda sozinho quando o texto muda.
- **Registrar nunca pode derrubar o atendimento.** Falha de escrita vira
  `console.warn`, não exceção — auditoria não é caminho crítico.
- **Erro do modelo é a linha mais valiosa.** Se a chamada estourou, grava com
  `erro` preenchido e re-lança.
- **A memoização fica por fora.** Re-execução exigida pela R7 não gera segunda
  linha, pela mesma razão que não gera segunda cobrança.
- O agente 5 (consulta) não está no enum `agente_origem` do banco. A coluna
  aqui é `varchar`, pra não mexer num enum que sete tabelas usam.

**Gate:** testes verdes sem banco e sem chave; uma varredura real mostrando
linhas com modelo, hash de prompt e latência.

---

## Onda 2 — Aferição (saber se leu bem)

**Por quê depois:** só dá pra medir o que já está registrado.

**O que entra**

- `src/afericao/casos.ts` — o conjunto de referência: entrada + o que a leitura
  correta teria dito. Sai do que já existe no banco (laudos, mensagens) e das
  correções que a equipe fez no painel.
- `npm run aferir` — roda os casos contra o modelo real e imprime acerto por
  campo e por `prompt_hash`.

**A parte que não é óbvia:** a correção humana no painel **já é o rótulo**.
Quando alguém reprova um "pode anunciar", isso é um caso de teste que se
escreveu sozinho.

**Gate:** um número por versão de prompt. Não uma nota geral — acerto por
campo, porque errar `obrigatoria` custa caro e errar `resumo` não custa nada.

---

## Onda 3 — O cérebro (guardar o que se aprendeu)

**O que entra**

- Schema `cerebro`, tabela `nota`: escopo, chave, texto, evidência, estado,
  autor, e `substitui` apontando pra nota anterior.
- **Nada é rasurado.** Corrigir escreve linha nova apontando pra antiga, como
  averbação de matrícula. O registro velho continua legível, com o motivo.
- Quatro ações humanas: **confirmar, corrigir, desativar e fixar**. A quarta é
  a que quase todo sistema esquece — sem ela a pessoa corrige, o sistema erra
  igual na semana seguinte, e aí ninguém corrige mais nada.
- Tela `/cerebro`: consultar, editar e ver de onde veio cada nota.
- `src/cerebro/aplicar.ts`: transforma notas vigentes em dicas de prompt, com
  **teto de caracteres** — acúmulo de nota não pode virar a maior parte da
  instrução e deixar o prompt aferido em minoria.
- **Ajuste de peso ficou de fora, e é decisão, não pendência.** Nota mexendo em
  `scoreMinimo` ou nos pesos do roteamento é o mesmo sistema com dois botões de
  calibração e nenhum dono. Primeiro a aferição precisa mostrar que a dica em
  texto ajuda; se ajudar, aí faz sentido discutir peso.

**Gate:** o teste do parágrafo da regra passando, e a tela funcionando com a
equipe podendo desfazer qualquer coisa.

---

## O que fica de fora de propósito

- Ajuste automático de peso sem gente no meio. Nesta fase o cérebro **propõe**;
  quem confirma é humano.
- Treinar ou afinar modelo. Não há volume pra isso e não é o gargalo.
- Cérebro por corretor. Antes de personalizar, é preciso acertar no geral.
