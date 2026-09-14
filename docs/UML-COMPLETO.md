# UML completo

Tudo do sistema num lugar só. Os diagramas separados continuam em
[`UML.md`](UML.md). Fontes: `src/lib/db/schema.ts`, `src/cerebro/schema.ts`,
`src/grafo/index.ts`, `src/agentes/`, `src/consulta/`, `src/mesa/`.

## 1. Componentes

```mermaid
flowchart LR
  equipe(["Equipe"]) --> painel
  corretor(["Corretor"]) --> painel
  cliente(["Cliente"]) --> canais["Canais<br/>WhatsApp, Instagram, site, e-mail"]
  canais --> recepcao["Recepção<br/>rotas com segredo"]

  subgraph next["Next.js (App Router)"]
    painel["Painel<br/>fila, funil, locação, escrituras,<br/>alterar, consulta, mensagens,<br/>automático, semanas, cérebro, imóvel"]
    recepcao
    varredura["Varredura<br/>prazos, parcelas, silêncio"]
  end

  subgraph grafo["LangGraph"]
    despachante["Despachante"] --> agentes["Curador · Guardião · Roteador<br/>Atendimento · Alterador"]
    agentes <--> gate["Gate<br/>interrupt()"]
  end

  recepcao --> despachante
  painel -->|decisão retoma thread| gate
  painel --> consulta["Consulta<br/>só leitura"]
  varredura --> despachante

  agentes --> modelo["Porta do modelo<br/>Groq"]
  consulta --> modelo
  agentes -->|faixa amarela| mesa["Mesa de revisão<br/>FastAPI + CrewAI + LanceDB<br/>sem acesso ao banco"]

  agentes --> db[("Postgres<br/>schema public, RLS")]
  consulta -->|papel consulta| db
  painel --> db
  painel --> cerebro[("schema cerebro")]
  agentes -.lê notas.-> cerebro
  agentes --> saida["Mensagens enviadas<br/>WhatsApp / e-mail"]
```

## 2. Entidades (todas as tabelas)

```mermaid
erDiagram
  CLIENTE ||--o{ PAPEL : exerce
  IMOVEL |o--o{ PAPEL : "papel sobre"
  CLIENTE |o--o{ IMOVEL : "é proprietário"
  CORRETOR |o--o{ IMOVEL : captou
  IMOVEL ||--o{ ANUNCIO : "publicado em"
  IMOVEL ||--o{ LAUDO : "vistoriado por"
  CLIENTE ||--o{ BUSCA : procura
  CLIENTE ||--o{ IDENTIDADE : "chega por"
  CORRETOR ||--o{ DOMINIO_CORRETOR : conhece
  IMOVEL ||--o{ DOMINIO_CORRETOR : "conhecido por"
  CLIENTE ||--o{ VINCULO_LEAD_CORRETOR : "atendido por"
  CORRETOR ||--o{ VINCULO_LEAD_CORRETOR : atende
  CORRETOR ||--o{ AGENDA : agenda
  IMOVEL |o--o{ AGENDA : visita
  CLIENTE |o--o{ AGENDA : visita
  CLIENTE ||--o{ ATENDIMENTO : conversa
  IMOVEL |o--o{ ATENDIMENTO : sobre
  CORRETOR |o--o{ ATENDIMENTO : conduz
  IMOVEL ||--o{ TRANSACAO : negociado
  CLIENTE |o--o{ TRANSACAO : compra
  CORRETOR |o--o{ TRANSACAO : fecha
  IMOVEL ||--o{ CONTRATO_LOCACAO : alugado
  CLIENTE ||--o{ CONTRATO_LOCACAO : "inquilino e proprietário"
  CONTRATO_LOCACAO ||--o{ PARCELA_ALUGUEL : gera
  IMOVEL ||--o{ PROCESSO_ESCRITURA : escriturado
  TRANSACAO |o--o{ PROCESSO_ESCRITURA : formaliza
  CLIENTE |o--o{ PROCESSO_ESCRITURA : "comprador e vendedor"
  APROVACAO }o..|| ENTIDADE_QUALQUER : "entidade + id_entidade"
  LOG_EVENTO }o..|| ENTIDADE_QUALQUER : "entidade + id_entidade"
  APROVACAO }o..o| EVENTO_PROCESSADO : id_evento
  LOG_EVENTO }o..o| EVENTO_PROCESSADO : id_evento
  LEITURA_MODELO }o..o| EVENTO_PROCESSADO : id_evento
  NOTA |o..o| NOTA : substitui

  IMOVEL {
    uuid id_imovel PK
    varchar tipo
    numeric preco
    text endereco
    varchar bairro
    varchar cidade
    uuid id_proprietario FK
    uuid id_corretor_captador FK
    enum estado_operacional
    enum estado_comercial
    enum estado_anuncio
    timestamp data_captacao
  }
  ANUNCIO {
    uuid id_anuncio PK
    uuid id_imovel FK
    varchar canal
    enum status
    boolean midia_paga
    numeric custo_acumulado
  }
  LAUDO {
    uuid id_laudo PK
    uuid id_imovel FK
    text texto_estado
    text texto_documentacao
    text texto_pendencias
    jsonb extracao_estruturada
  }
  CLIENTE {
    uuid id_cliente PK
    varchar nome
    text cpf_cnpj "cifrado"
    text telefone "cifrado"
    text email "cifrado"
    varchar email_indice "HMAC"
    varchar origem_canal
  }
  PAPEL {
    uuid id_papel PK
    uuid id_cliente FK
    uuid id_imovel FK
    enum papel
    boolean ativo
  }
  BUSCA {
    uuid id_busca PK
    uuid id_cliente FK
    numeric valor_min
    numeric valor_max
    varchar tipo_imovel
    text_array bairros_desejados
    text texto_original
  }
  IDENTIDADE {
    uuid id PK
    uuid id_cliente FK
    enum canal
    text identificador "cifrado"
    varchar identificador_indice UK
    varchar apelido
    enum origem
  }
  CORRETOR {
    uuid id_corretor PK
    varchar nome
    text telefone "cifrado"
    numeric comissao_percentual
    text_array regioes_atuacao
    boolean ativo
  }
  DOMINIO_CORRETOR {
    uuid id PK
    uuid id_corretor FK
    uuid id_imovel FK
    enum nivel
  }
  VINCULO_LEAD_CORRETOR {
    uuid id PK
    uuid id_cliente FK
    uuid id_corretor FK
    timestamp ultima_interacao
    boolean ativo
  }
  AGENDA {
    uuid id_evento PK
    uuid id_corretor FK
    timestamp inicio
    timestamp fim
    varchar status
  }
  ATENDIMENTO {
    uuid id_atendimento PK
    uuid id_cliente FK
    uuid id_imovel FK
    uuid id_corretor FK
    enum etapa
    enum etapa_maxima
    enum estado
    text motivo_desfecho
    int prioridade
    boolean precisa_desfecho
  }
  TRANSACAO {
    uuid id_transacao PK
    uuid id_imovel FK
    varchar tipo
    numeric valor_final
    varchar etapa
    boolean comissao_paga
  }
  CONTRATO_LOCACAO {
    uuid id_contrato PK
    uuid id_imovel FK
    uuid id_inquilino FK
    uuid id_proprietario FK
    numeric valor_aluguel
    int dia_vencimento
    enum indice
    numeric taxa_administracao
    enum estado
  }
  PARCELA_ALUGUEL {
    uuid id_parcela PK
    uuid id_contrato FK
    varchar competencia
    numeric valor_base
    numeric valor_encargos
    enum estado
    int estagio_cobranca
  }
  PROCESSO_ESCRITURA {
    uuid id_processo PK
    uuid id_imovel FK
    uuid id_transacao FK
    enum etapa
    timestamp etapa_desde
    varchar matricula
    numeric valor_itbi
  }
  APROVACAO {
    uuid id PK
    enum tipo
    enum estado
    enum faixa
    enum solicitado_por_agente
    varchar thread_id
    timestamp expira_em
    jsonb proposta
    varchar decidido_por
  }
  LOG_EVENTO {
    uuid id PK
    enum agente_origem
    varchar campo
    text valor_anterior
    text valor_novo
    varchar aprovado_por
  }
  EVENTO_PROCESSADO {
    uuid id_evento PK
    varchar tipo
    enum agente
  }
  LEITURA_MODELO {
    uuid id PK
    varchar agente
    varchar modelo
    varchar prompt_hash
    jsonb saida
    text erro
  }
  MENSAGEM_ENVIADA {
    uuid id PK
    varchar canal
    varchar destino
    text texto
    varchar estado
  }
  NOTA {
    uuid id PK "schema cerebro"
    varchar escopo
    varchar chave
    text texto
    enum estado
    uuid substitui
  }
```

## 3. Agentes (classes)

```mermaid
classDiagram
  class AgenteContexto {
    <<contrato>>
    escrever(campo do próprio agente)
    pedirAprovacao(pedido)
  }
  class Curador {
    1 · dono de estado_operacional e preço
    extrai ExtracaoLaudo
  }
  class Guardiao {
    2 · dono de estado_comercial
    extrai ExtracaoNegociacao
    derruba mídia paga
  }
  class Roteador {
    3 · sem modelo
    rotear() oferta com prazo
  }
  class Atendimento {
    4 · conversa e qualifica
    usa match.ts
  }
  class Consulta {
    5 · só leitura
    6 relatórios
  }
  class Alterador {
    6 · não é dono de campo
    mostra de → para
  }
  class Mesa {
    <<serviço Python>>
    dois pareceres
    Consolidado
  }
  class Faixa {
    <<regra>>
    verde · amarela · vermelha
  }
  class Extrator {
    <<porta do modelo>>
    grava leitura_modelo
  }
  AgenteContexto <|.. Curador
  AgenteContexto <|.. Guardiao
  AgenteContexto <|.. Roteador
  AgenteContexto <|.. Atendimento
  AgenteContexto <|.. Alterador
  Curador ..> Extrator
  Guardiao ..> Extrator
  Atendimento ..> Extrator
  Alterador ..> Extrator
  Consulta ..> Extrator
  Curador ..> Faixa
  Guardiao ..> Faixa
  Alterador ..> Faixa
  Curador ..> Mesa : faixa amarela
  Guardiao ..> Mesa : faixa amarela
  Atendimento --> Roteador : lead qualificado
```

## 4. Estados

```mermaid
stateDiagram-v2
  state "Imóvel · operacional (Curador)" as op {
    [*] --> captado
    captado --> em_preparacao
    em_preparacao --> pronto
    em_preparacao --> com_pendencia
    com_pendencia --> pronto
    em_preparacao --> reprovado
  }
  state "Imóvel · comercial (Guardião)" as com {
    [*] --> disponivel
    disponivel --> em_negociacao
    em_negociacao --> disponivel : desistência
    em_negociacao --> em_processo_venda
    em_processo_venda --> fechado
    disponivel --> arquivado
  }
  state "Imóvel · anúncio" as an {
    [*] --> sem_anuncio
    sem_anuncio --> no_ar
    no_ar --> pausado
    pausado --> no_ar
    no_ar --> removido
  }
  state "Aprovação" as ap {
    [*] --> pendente
    pendente --> aprovado
    pendente --> negado
    pendente --> expirado
  }
```

```mermaid
stateDiagram-v2
  state "Atendimento · etapa" as et {
    [*] --> primeiro_contato
    primeiro_contato --> qualificado
    qualificado --> visita_agendada
    visita_agendada --> visita_feita
    visita_feita --> proposta
    proposta --> negociacao
    negociacao --> ganho
    qualificado --> perdido
    negociacao --> perdido
  }
  state "Atendimento · estado" as es {
    [*] --> aberto
    aberto --> pendente : respondemos
    pendente --> aberto : cliente falou
    pendente --> fechado : pessoa dá desfecho
    aberto --> fechado : pessoa dá desfecho
  }
  state "Contrato de locação" as ct {
    [*] --> ativo
    ativo --> em_rescisao
    em_rescisao --> encerrado
    ativo --> encerrado
  }
  state "Parcela de aluguel" as pa {
    [*] --> aberta
    aberta --> paga
    aberta --> atrasada
    atrasada --> paga
    paga --> repassada
    aberta --> cancelada
  }
  state "Nota do cérebro" as no {
    [*] --> rascunho
    rascunho --> confirmada
    confirmada --> fixada
    confirmada --> desativada
    fixada --> desativada
  }
```

```mermaid
stateDiagram-v2
  direction LR
  [*] --> contrato_assinado
  contrato_assinado --> documentacao
  documentacao --> itbi_emitido
  itbi_emitido --> itbi_pago
  itbi_pago --> escritura_lavrada
  escritura_lavrada --> registro_protocolado
  registro_protocolado --> registro_concluido
  registro_concluido --> concluido
  contrato_assinado --> cancelado
  documentacao --> cancelado
```

## 5. Sequências

### Curador: laudo até anúncio

```mermaid
sequenceDiagram
  actor Vendedor
  participant C as 1 Curador
  participant M as Modelo
  participant F as Faixa
  participant Me as Mesa
  participant G as Gate
  participant DB as Banco
  actor Equipe

  Vendedor->>C: laudo (estado, documentação, pendências)
  C->>M: extrai pendências e preço
  M-->>C: ExtracaoLaudo
  C->>C: regra decide estado_operacional
  C->>DB: laudo, estado_operacional, log_evento
  opt ficou pronto e disponível
    C->>F: classificar subir_anuncio
    alt amarela
      C->>Me: revisarSePreciso
      Me-->>C: Consolidado
    end
    C->>DB: aprovacao subir_anuncio
    C->>G: pausa
    Equipe->>G: aprova ou nega
    G->>C: decisão, nó re-executa
    C->>DB: anúncio no_ar (se aprovado)
  end
```

### Guardião: documento até derrubar mídia

```mermaid
sequenceDiagram
  actor Corretor
  participant Gu as 2 Guardião
  participant M as Modelo
  participant G as Gate
  participant DB as Banco
  actor Equipe

  Corretor->>Gu: documento da negociação
  Gu->>M: extrai etapa e valor
  M-->>Gu: ExtracaoNegociacao
  Gu->>DB: estado_comercial, transacao, log_evento
  opt saiu do mercado com anúncio no ar
    Gu->>DB: anúncios e custo acumulado
    Gu->>DB: aprovacao derrubar_midia
    Gu->>G: pausa
    Equipe->>G: aprova ou nega
    G->>Gu: decisão, nó re-executa
    Gu->>DB: anúncio removido
  end
```

### Atendimento e Roteador: lead até corretor

```mermaid
sequenceDiagram
  actor Cliente
  participant A as 4 Atendimento
  participant M as Modelo
  participant R as 3 Roteador
  participant G as Gate
  participant DB as Banco
  actor Corretor

  Cliente->>A: mensagem
  A->>DB: identidade pelo canal
  A->>M: intenção e busca
  A->>DB: atendimento, busca
  A-->>Cliente: resposta
  alt qualificado
    A->>R: handoff
    R->>DB: aprovacao aceite_corretor com prazo
    R->>G: pausa
    Corretor->>G: aceita ou recusa
    G->>R: decisão
    alt aceitou
      R->>DB: vinculo_lead_corretor
    else recusou ou expirou
      R->>DB: oferta ao próximo, ou escala
    end
  else escalação
    A->>G: pausa para a equipe
  end
```

### Alterador: texto livre até cadastro

```mermaid
sequenceDiagram
  actor Equipe
  participant Al as 6 Alterador
  participant M as Modelo
  participant G as Gate
  participant DB as Banco

  Equipe->>Al: "muda o preço do apartamento do Campolim"
  Al->>M: extrai entidade, alvo, campo, valor
  Al->>DB: procura candidatos
  Al->>DB: aprovacao aplicar_alteracao (de → para)
  Al->>G: pausa
  Equipe->>G: confirma o registro certo
  G->>Al: decisão
  Al->>DB: escrita assinada por quem confirmou, log_evento
```

### Consulta: pergunta da equipe

```mermaid
sequenceDiagram
  actor Equipe
  participant Co as 5 Consulta
  participant M as Modelo
  participant DB as Banco (só leitura)

  Equipe->>Co: pergunta
  Co->>M: qual dos 6 relatórios
  M-->>Co: Intencao
  Co->>DB: consulta determinística
  DB-->>Co: linhas
  Co->>M: redige sobre as linhas
  Co-->>Equipe: resposta com números do banco
```
