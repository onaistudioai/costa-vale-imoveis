# Implantação — como este sistema entra no de outra empresa

Este documento não é sobre rodar o projeto (isso é o `README`). É sobre a
**prestação de serviço**: pegar o sistema pronto e instalar dentro do que a
empresa já usa, sem parar a operação dela.

A ordem das fases não é burocracia. Cada uma existe pra matar um risco
específico, e pular uma joga esse risco pra frente — sempre mais caro.

---

## O que se entrega

Não é "um aplicativo". São quatro peças, e o cliente precisa entender as
quatro, porque cada uma tem um dono diferente na casa dele:

| Peça | O que é | Quem toca |
|---|---|---|
| **Entrada** | um endereço que recebe eventos (`POST /api/eventos`, com segredo) | TI do cliente |
| **Núcleo** | as regras de decisão, em código testável | nós |
| **Painel** | a fila de decisões humanas e as telas de acompanhamento | a operação |
| **Saída** | mensagem ao cliente e ao corretor | canal do cliente |

O que **não** se entrega: decisão automática sem gente. Todo ponto caro do
processo para e pergunta.

---

## Fase 0 — Levantamento (antes de escrever uma linha)

Três perguntas, e sem as três respondidas não se começa:

**1. Quais números estão negativos hoje?**
A meta nunca é "economizar X reais". É um número ruim que precisa virar bom.
Nesta imobiliária eles se chamam: lead sem desfecho, aluguel atrasado sem
cobrança, escritura parada do nosso lado, tempo até a primeira resposta.
**Congelar o valor de partida agora.** Depois da virada, ninguém consegue
reconstruir o "antes" — e sem o antes, "melhorou" é conversa.

**2. Quem supervisiona, com nome e horário?**
Sistema com fila de decisão e sem dono da fila não é automação, é acúmulo. O
combinado tem que ter nome de pessoa, turno e prazo de resposta. O agente tem
5 minutos pra responder ao corretor; alguém precisa ter prazo pra responder ao
agente.

**3. Quais sistemas já existem e qual é o dono de cada dado?**
Se o preço vive em duas planilhas e num portal, o sistema não vai resolver a
divergência — ele vai expor. Definir qual fonte manda **antes** de ligar.

---

## Fase 1 — Encaixe

Onde o sistema toca o que já existe. A superfície é pequena de propósito:

| Ligação | Como | Risco |
|---|---|---|
| WhatsApp | bridge com o contrato do WAHA/Cloud API (`src/lib/canal.ts`) | número precisa ser da empresa, não pessoal |
| Instagram / site | webhook chamando `POST /api/eventos` | identidade sem telefone — já tratada |
| Portais (OLX, ZAP, Viva) | hoje o sistema decide; publicar é o que falta | cada portal tem sua API e seu prazo |
| CRM ou planilha atual | carga inicial + eventos de alteração | ver Fase 2 |

**Regra do encaixe:** o sistema entra como **mais um participante**, nunca como
substituto do que já roda. Se o cliente precisa desligar o que tem pra ligar o
nosso no primeiro dia, o projeto está errado.

---

## Fase 2 — Carga de dados (a fase mais cara, sempre)

O erro comum é limpar os dados antes de entrar. Não limpe: **o sistema foi
feito pra encontrar a bagunça e perguntar**, não pra chutar em cima dela.

- cadastro duplicado não é fundido sozinho — vira pergunta no painel, porque
  duplicar é chato e fundir errado mostra a negociação de um cliente pro outro;
- imóvel sem documento não é reprovado sozinho — fica com pendência escrita;
- valor divergente entre fontes não é resolvido por média, é apontado.

**Espere uma fila grande de perguntas na primeira semana.** Ela é o retrato da
bagunça que já existia, e é a primeira entrega de valor visível — normalmente é
aqui que o cliente descobre coisas que ele não sabia sobre a própria base.

---

## Fase 3 — Sombra (o sistema roda, mas nada sai)

Antes de o sistema falar com qualquer cliente do cliente, ele roda em paralelo
com a operação: lê os mesmos eventos, toma as mesmas decisões, **e não executa
nenhuma.** Compara-se o que ele decidiu com o que a equipe fez.

O que já é nativo: sem `WHATSAPP_BRIDGE_URL` configurada, nenhuma mensagem sai
— vai para o log. Nenhuma aprovação se aplica sem clique humano.
O que falta pra sombra completa: uma chave que segure também as escritas de
cadastro. É pequeno e é o primeiro item técnico de qualquer implantação.

**Critério de saída da sombra:** duas semanas, e a concordância entre o sistema
e a equipe medida — não sentida. `npm run aferir` e a tabela
`leitura_modelo` × decisão do painel existem exatamente pra isso.

---

## Fase 4 — Virada, um agente por vez

Nunca tudo de uma vez. A ordem é por risco, do menor pro maior:

1. **Curador** (lê laudo, pede aprovação pra anunciar) — erra pra dentro
2. **Guardião** (protege estoque quando o imóvel sai do mercado) — erra pra dentro
3. **Alterador** (traduz pedido de mudança de cadastro) — tudo confirmado antes
4. **Roteador** (escolhe corretor) — mexe com a equipe, não com o cliente
5. **Atendimento** (fala com o cliente) — **por último, sempre**

Cada degrau fica no ar por uma semana antes do próximo. Se algum precisar
voltar, volta sozinho, sem derrubar os outros.

---

## Fase 5 — Supervisão em regime

O que a pessoa designada olha, e com que frequência:

| Quando | O quê | Onde |
|---|---|---|
| todo dia, começo do turno | fila de decisões | `/` |
| todo dia | atendimentos que subiram pedindo desfecho | `/funil` |
| semanal | aluguéis, reajustes, escrituras paradas do nosso lado | `/locacao`, `/escrituras` |
| semanal | o placar: os números de partida da Fase 0 | a definir por cliente |
| a cada mudança de prompt ou de modelo | a aferição | `npm run aferir` |

**Como identificar erro**, por ordem de profundidade:

1. `/imovel/[id]` — "por que esse anúncio caiu?", com o histórico completo
2. `leitura_modelo` — o que o modelo leu e com qual versão de prompt
3. `npm run procedencia` — se algo mudou de modelo sem ninguém avisar
4. `npm run aferir` — se a leitura piorou, separando errar-travando de
   errar-liberando (os dois não valem o mesmo: travar custa um dia de venda,
   liberar errado custa um processo)

O buraco conhecido: **o alerta só existe dentro do painel.** Se ninguém abrir a
tela, ninguém fica sabendo. Aviso fora do painel é requisito de qualquer
implantação real e não está feito.

---

## O que fica com o cliente na entrega

- acesso ao painel, com senha e por pessoa
- o manual de uso (o que fazer na segunda de manhã)
- este documento
- o placar com os números de partida congelados
- o nome de quem supervisiona e o prazo dele

---

## Corte — o que impede ir ao ar

Nenhum destes é negociável:

- [ ] painel com autenticação
- [ ] a pessoa que supervisiona, com nome e horário combinados
- [ ] números de partida congelados
- [ ] duas semanas de sombra com concordância medida
- [ ] canal de saída no número da empresa, nunca no pessoal de ninguém
- [ ] aviso de escalação fora do painel
- [ ] plano de volta: como desligar um agente sem derrubar o resto
