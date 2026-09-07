# O gargalo do lead não é o sistema — é a agenda do corretor

Simulação de 90 dias, 8 leads por dia, 5 corretores ativos, com a rotina real de
quem trabalha na rua. Rodar: `npm run simular`.

## A tese

> Sob prazo de 5 minutos e rodízio de 3 corretores, quem decide quantos leads
> ficam sem dono é a indisponibilidade normal da rotina — dirigindo, em visita,
> fora do expediente — e não a velocidade do sistema.

**Confirmada.** O sistema responde ao cliente em 1,1 segundo (medido). O aceite
humano leva, na mediana, 1,1 **minuto** quando acontece — e em 57% das ofertas
entregues ele simplesmente não acontece.

## Os cenários

| | Detecção | Aceite | Até ter dono | Sem dono |
|---|---|---|---|---|
| **A — hoje** (corretor sem telefone) | — | — | — | **100%** (720) |
| **B** — avisa, aceite só pelo painel | 11% | 1,1 min | 4h49 | 74% (532) |
| **C** — avisa e entende a resposta | **43%** | 1,1 min | 5h08 | **28%** (201) |
| **D** — C com prazo de 10 min | 44% | 1,1 min | 4h29 | 26% (187) |
| **E** — C com 5 tentativas | 42% | 1,1 min | 4h09 | 26% (188) |

**A conclusão que muda decisão:** entre C, D e E há um ponto percentual. Mexer
no prazo ou no número de tentativas **não resolve nada**. O salto está entre B e
C — de 11% para 43% — e ele é sobre poder responder por mensagem, não sobre
calibração.

## Por que o lead ficou sem dono

| | Silêncio | Ninguém pontuou |
|---|---|---|
| A — hoje | 709 | 11 |
| C | 194 | 7 |

Praticamente todo lead perdido é **silêncio**, não falta de gente qualificada. As
duas causas pedem providências opostas: uma é captação de conhecimento de região,
a outra é canal de resposta. Misturar as duas num número só faz a imobiliária
contratar corretor quando o problema é WhatsApp.

## O tempo até ter dono é o número escondido

Mesmo no melhor cenário, a mediana entre o lead chegar e ter dono é de **~5
horas**. Não é lentidão de ninguém: é a regra de produção segurando a oferta até
as 7h30. O cliente é atendido na hora, 24h por dia; o corretor só é acionado no
expediente.

Isso está certo — oferecer lead às 3h queimaria os três melhores contra gente
dormindo, e ainda registraria os três como quem não respondeu. Mas convém dizer
o número em voz alta antes que alguém o descubra num relatório.

## Dinheiro, em 90 dias

Faixa, nunca número único: o custo por lead vem de mercado estrangeiro e a
conversão tem intervalo largo.

| | Perda estimada |
|---|---|
| A — hoje | R$ 662 mil a R$ 2,23 mi |
| C | R$ 185 mil a R$ 623 mil |
| **Diferença** | **R$ 477 mil a R$ 1,61 mi** |

Composição: custo de aquisição desperdiçado (lead pago que ninguém atendeu) mais
receita esperada perdida (conversão × preço médio do estoque × comissão do
cadastro).

## De onde vem cada número

**Medidos aqui dentro** — prazo, tentativas, expediente, tempo de resposta do
agente (1,1s, mediana real de `leitura_modelo`), preço do estoque, comissão do
cadastro, corretores ativos.

**Pesquisados, com fonte:**
- MIT/InsideSales (~1 milhão de leads): responder em até 5 min dá 21× mais chance
  de qualificar do que em 30 min — é o estudo que justifica o prazo existir
- 78% dos compradores fecham com o primeiro corretor que responde
- WhatsApp: resposta em 45–90s quando a pessoa está disponível; taxa de resposta
  por setor entre 25% e 55%
- **Abertura: 68%.** A estatística de 98% circula em centenas de artigos sem
  fonte primária verificável. Usar a bonita transformaria isto em peça de venda
- Conversão lead→fechamento: 0,4%–1,2% em portal, 2%–5% no geral
- Custo por lead: US$ 139–223 em portal, US$ 416–480 na média do setor
- NAR: mediana de 35h semanais; visitas concentradas entre 12h e 16h30

**Supostos — e é aqui que a conclusão pode desabar:** fração do dia dirigindo,
duração da visita, visitas por dia, demora até olhar o celular, chance de
responder dirigindo ou em visita, chance de ignorar em hora livre, volume de
leads.

## Sensibilidade — o que precisa ser medido primeiro

Variando cada suposto para metade e para o dobro, no cenário C:

| Parâmetro | Metade | Dobro | Amplitude |
|---|---|---|---|
| chance de ignorar em hora livre | 48% | 37% | **11 pontos** |
| fração do dia dirigindo | 48% | 38% | **10 pontos** |
| visitas por dia | 44% | 44% | 1 ponto |
| demora pra olhar o celular | 43% | 43% | 0 |

Só dois parâmetros movem o resultado, e os dois são medíveis em uma semana de
operação. Os outros dois podem ficar como estão.

O de "demora pra olhar o celular" dar zero tem explicação e vale entender: com
prazo de 5 minutos, quem está ocupado **não volta a tempo de qualquer jeito** —
então a demora dele é irrelevante. Ou o corretor está livre e responde em
segundos, ou está ocupado e perde. Não existe meio-termo, e é por isso que
aumentar o prazo para 10 minutos quase não muda nada.

## O que esta simulação não prova

- Não substitui medição. É a melhor estimativa possível antes de existir dado.
- Custo por lead vem de mercado estrangeiro e câmbio arbitrado.
- Não mede qualidade de atendimento, só quem pega o lead e em quanto tempo.
- Não modela concorrência entre imobiliárias pelo mesmo comprador.

## O que fazer com isso

1. **Cadastrar telefone dos corretores** — sem isso o sistema está no cenário A,
   e nenhum outro número importa.
2. **Abrir o canal de resposta do corretor** — é o salto de 11% para 43%.
3. **Medir duas coisas por uma semana**: quanto tempo a equipe passa dirigindo e
   quantas ofertas são ignoradas em horário livre. São os dois únicos parâmetros
   que mudam a conta.
4. **Não mexer no prazo nem no número de tentativas** antes disso. A simulação
   mostra que dá um ponto percentual.
