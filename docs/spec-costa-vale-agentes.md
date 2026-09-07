# Project Spec: Costa & Vale Imóveis
### Fase 3 (arquitetura de agentes) + Fase 4 (modelagem de dados)

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

Antes de listar os agentes, uma decisão de arquitetura que evita gastar modelo de linguagem à toa:

**Agente de IA só onde existe ambiguidade de linguagem.** Ou seja, onde a informação chega em texto solto, escrita por um humano do jeito que ele quis.

**Regra determinística (código puro, sempre a mesma resposta pra mesma entrada) onde a decisão é binária.** Não precisa de IA pra decidir se um imóvel pode ser anunciado, isso é uma comparação de campos no banco.

Aplicando isso:

| Etapa | Natureza | Implementação |
|---|---|---|
| Ler o laudo que o vendedor escreveu e entender "a casa tá limpa e a documentação saiu" | Texto livre | Agente |
| Decidir se o imóvel pode ir pro ar | Comparação de status | Regra |
| Entender no documento de venda em que pé está a negociação | Texto livre | Agente |
| Derrubar o anúncio quando a venda fecha | Gatilho de status | Regra |
| Achar o corretor com agenda livre | Consulta + cálculo | Regra |
| Escolher entre dois corretores igualmente livres, um deles com domínio do imóvel | Critério com peso | Regra com pontuação |
| Conversar com o lead e extrair o que ele quer | Texto livre | Agente |

Isso muda o desenho: os quatro agentes existem, mas boa parte do que eles fazem é chamar ferramenta e escrever no banco, e o modelo de linguagem só aparece na hora de interpretar texto humano. Isso deixa o sistema mais barato, mais rápido e muito mais fácil de testar.

---

## 3. A espinha do sistema: o estado do imóvel

Tudo gira em torno de saber em que ponto cada imóvel está. Hoje isso é um campo só (`status`), e é justamente aí que o sistema quebra: três agentes diferentes querem escrever no mesmo campo ao mesmo tempo.

A solução é separar em três estados independentes, cada um com um dono único:

**Estado operacional** (dono: Agente 1)
`captado` → `em_preparacao` → `pronto` → `com_pendencia`

Responde: o imóvel está apresentável e com documento em ordem?

**Estado comercial** (dono: Agente 2)
`disponivel` → `em_negociacao` → `em_processo_venda` → `fechado` → `arquivado`

Responde: alguém já está comprando isso?

**Estado do anúncio** (dono: Agente 1, mas obedece o Agente 2)
`sem_anuncio` → `no_ar` → `pausado` → `removido`

Responde: estamos gastando dinheiro divulgando isso?

A regra de publicação vira uma linha só:

> Anúncio só sobe se `estado_operacional = pronto` **e** `estado_comercial = disponivel`.
> Anúncio cai automaticamente quando `estado_comercial` sai de `disponivel`.

---

## 4. Especificação dos agentes

Cada agente é descrito por seis coisas: gatilho (o que faz ele acordar), leitura, decisão, escrita, saída pra equipe e limite (o que ele explicitamente não faz).

### Agente 1: Curador de Estoque

**Papel:** decide o que pode ser anunciado.

- **Gatilho:** um afiliado ou vendedor lança um documento sobre o imóvel (laudo de limpeza, reforma, documentação, atualização de preço).
- **Leitura:** o documento em texto livre + o registro atual do imóvel.
- **Decisão:** extrai do texto o que mudou e classifica em pendência resolvida ou pendência aberta. Se todas as pendências obrigatórias estão resolvidas, marca `pronto`.
- **Escrita:** `estado_operacional`, `preco`, `estado_anuncio`, e um registro na tabela de laudos com o texto original preservado.
- **Saída pra equipe:** "Imóvel 47 liberado pra anúncio. Faltava documentação, o Marcos subiu hoje."
- **Limite:** não decide nada sobre venda. Se o Agente 2 marcou como `em_negociacao`, o Agente 1 não sobe anúncio mesmo com tudo pronto.

Por que ele é um agente e não um formulário: o vendedor escreve "passei lá hoje, a casa tá em ordem, só falta o pessoal tirar o entulho do fundo". Nenhum formulário captura isso. O agente lê, entende que existe uma pendência parcial, e não libera.

### Agente 2: Guardião da Negociação

**Papel:** é a fonte única de verdade sobre o estado de venda.

- **Gatilho:** corretor registra proposta, envia documento de negociação, ou muda o andamento de uma transação.
- **Leitura:** documentos da transação + registro do imóvel + anúncios vinculados.
- **Decisão:** identifica em que etapa a negociação está (proposta feita, aceita, documentação em análise, assinada).
- **Escrita:** `estado_comercial`, tabela de transações.
- **Saída pra equipe:** este é o diferencial dele. Ele não informa o estado geral, ele avisa a pessoa certa sobre a consequência. Exemplo: "Imóvel 47 entrou em processo de venda com a Ana. Tem anúncio ativo no ZAP e uma campanha rodando no Meta. Confirma que derrubo os dois?"
- **Limite:** não derruba o anúncio sozinho. Ele sinaliza, a regra derruba, e o gasto de mídia só é interrompido com confirmação humana (dinheiro envolvido, então tem gente no meio).

### Agente 3: Roteador de Corretor

**Papel:** liga o lead ao corretor que realmente conhece aquele imóvel e tem hora livre.

- **Gatilho:** o Agente 4 sinaliza que um lead está pronto pra falar com humano ou quer agendar visita.
- **Leitura:** agenda dos corretores, tabela de domínio (qual corretor conhece quais imóveis e em que nível), carga atual de cada um.
- **Decisão:** pontuação. Domínio do imóvel pesa mais que disponibilidade imediata, porque corretor que conhece a casa responde melhor e converte mais. Se ninguém com domínio está livre nas próximas 48h, cai pro segundo critério.
- **Escrita:** tabela de agenda (evento reservado), vínculo lead/corretor.
- **Saída pra equipe:** notificação pro corretor escolhido, com o resumo do que o lead quer.
- **Limite:** não conversa com o cliente. Ele resolve alocação, não relacionamento.

### Agente 4: Atendimento 24/7

**Papel:** é a única porta de entrada. Já existe configurado, entra no sistema como peça integrada.

- **Gatilho:** mensagem nova em qualquer canal (WhatsApp, Direct, formulário, portal).
- **Leitura:** histórico da conversa + estoque disponível (só o que está `no_ar`, ele nunca oferece imóvel em negociação).
- **Decisão:** responde dúvida básica, extrai o que o cliente procura, e classifica se o lead está pronto pra humano.
- **Escrita:** cliente, busca (o que ele procura), histórico.
- **Saída:** chama o Agente 3 quando qualifica.
- **Limite:** não agenda sozinho, não fala preço de imóvel em negociação, não promete nada sobre documentação.

---

## 5. Regra de propriedade de dado

Esta é a regra que impede o sistema de se contradizer. Cada campo tem um dono. Os outros agentes leem, nunca escrevem.

| Campo | Escreve | Leem |
|---|---|---|
| `estado_operacional` | Agente 1 | 2, 3, 4 |
| `preco` | Agente 1 | 2, 4 |
| `estado_anuncio` | Agente 1 | 2 |
| `estado_comercial` | Agente 2 | 1, 3, 4 |
| `transacao.*` | Agente 2 | 3 |
| `agenda.*` | Agente 3 | 4 |
| `cliente.*`, `busca.*` | Agente 4 | 3 |

Se um agente precisa mudar algo que não é dele, ele não muda: ele grava um pedido e o dono do campo decide. É o mesmo padrão de quadro compartilhado que você já usou no OPUS, onde os agentes conversam pelo estado e não entre si.

---

## 6. Modelo de dados

Ajustes em relação ao que você desenhou, com a justificativa de cada um.

### imovel
```
id_imovel, tipo, preco, endereco, bairro, cidade,
pontos_referencia, id_proprietario, id_corretor_captador,
estado_operacional, estado_comercial, estado_anuncio, data_captacao
```
Mudança: `status` virou três campos, pelo motivo da seção 3.

### anuncio (tabela nova)
```
id_anuncio, id_imovel, canal, status, data_publicacao,
data_remocao, custo_acumulado
```
Sem essa tabela é impossível cumprir a regra "se a venda for aprovada o anúncio deve ser removido", porque o sistema não sabe quantos anúncios existem nem onde. Um imóvel pode estar em quatro canais ao mesmo tempo.

### laudo (tabela nova)
```
id_laudo, id_imovel, id_autor, tipo, texto_original,
extracao_estruturada, data
```
Guarda o que o vendedor escreveu **e** o que o agente entendeu. Quando o agente errar (e vai errar), você tem como comparar os dois e corrigir a instrução dele. Isso é o que transforma o sistema em algo auditável.

### cliente
```
id_cliente, nome, cpf_cnpj, telefone, email, origem_canal, data_entrada
```
Mudança: tirei o campo `tipo`. Uma pessoa pode ser proprietária de um imóvel e compradora de outro ao mesmo tempo, e com um campo só você é obrigado a duplicar o cadastro. O papel virou tabela própria.

### papel (tabela nova)
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

### dominio_corretor (tabela nova)
```
id, id_corretor, id_imovel, nivel
```
`nivel`: captou, ja_visitou, conhece_regiao.

Esta é a tabela que resolve a sua dor de "não mandar imóvel pra corretor que não sabe de nada". Sem ela, o Agente 3 não tem como pontuar ninguém.

### agenda (tabela nova)
```
id_evento, id_corretor, id_imovel, id_cliente,
inicio, fim, status
```

### transacao
```
id_transacao, id_imovel, id_cliente_comprador, id_corretor,
tipo, valor_final, data_fechamento, comissao_paga, etapa
```
Adicionei `etapa`, porque o Agente 2 precisa registrar o caminho até o fechamento, não só o resultado final.

### log_evento (tabela nova)
```
id, agente_origem, entidade, id_entidade, campo,
valor_anterior, valor_novo, timestamp, aprovado_por
```
Registro de tudo que qualquer agente mudou. Quando alguém perguntar "por que esse anúncio caiu?", a resposta está aqui. É o que separa um protótipo de um sistema.

---

## 7. Os três fluxos críticos

### Fluxo A: imóvel entra no estoque e vira anúncio
1. Corretor capta o imóvel. Estado: `captado` / `disponivel` / `sem_anuncio`.
2. Vendedor visita e lança laudo em texto livre.
3. Agente 1 lê, extrai, atualiza pendências.
4. Todas resolvidas: `estado_operacional = pronto`.
5. Regra confere `estado_comercial = disponivel`.
6. Anúncio sobe, registro criado na tabela `anuncio`.

### Fluxo B: venda avança e o anúncio precisa cair
1. Corretor registra proposta aceita.
2. Agente 2 lê o documento e identifica a etapa.
3. Agente 2 consulta anúncios vinculados ao imóvel.
4. Agente 2 avisa a equipe: existe anúncio ativo, custo rodando.
5. Humano confirma.
6. `estado_comercial = em_negociacao`, anúncios marcados como `pausado`, Agente 4 para de oferecer aquele imóvel.

O ponto fino aqui: o Agente 4 precisa parar de oferecer o imóvel **antes** do anúncio cair, porque anúncio no ar ainda gera mensagem por algumas horas depois de pausado.

### Fluxo C: lead chega e encontra o corretor certo
1. Mensagem entra em qualquer canal, Agente 4 responde em segundos.
2. Agente 4 extrai a busca em texto livre e cruza com o estoque `no_ar`.
3. Lead demonstra interesse concreto, Agente 4 qualifica.
4. Agente 3 pontua corretores por domínio do imóvel e agenda livre.
5. Visita reservada, corretor notificado com o contexto da conversa.
6. Cliente recebe confirmação pelo mesmo canal onde entrou.

---

## 8. Decisões em aberto

Coisas que precisam ser fechadas antes da Fase 5 (especificação técnica de cada agente).

1. **Quem qualifica o lead de verdade?** Hoje o Agente 4 está descrito como "atendimento básico". Se ele só responde dúvida, o sistema não tem quem faça o casamento entre o que o cliente quer e o estoque, e esse é o núcleo do caso. Duas saídas: o Agente 4 ganha essa responsabilidade, ou entra um Agente 5 de qualificação e match.
2. **Carteira fixa ou fila aberta?** Se o lead já é de um corretor, o Agente 3 respeita o vínculo antes de pontuar. Se é fila aberta, o critério de domínio manda sozinho. Isso muda o algoritmo inteiro do Agente 3.
3. **Onde entra aprovação humana?** Está definido para derrubar mídia paga. Falta definir para subir anúncio e para liberar um imóvel que teve pendência reprovada.
4. **O laudo tem formato mínimo?** Texto totalmente livre dá mais trabalho de extração e mais erro. Um roteiro curto ("estado da casa, documentação, pendências") melhora muito a precisão do Agente 1 sem burocratizar o vendedor.
