# UML

Diagramas tirados do código: `src/lib/db/schema.ts`, `src/cerebro/schema.ts` e
`src/grafo/index.ts`. Mudou o schema ou o grafo, atualize aqui.

## Entidades e relacionamentos

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
  CLIENTE ||--o{ ATENDIMENTO : conversa
  IMOVEL |o--o{ ATENDIMENTO : sobre
  CORRETOR |o--o{ ATENDIMENTO : conduz
  IMOVEL ||--o{ TRANSACAO : negociado
  CLIENTE |o--o{ TRANSACAO : compra
  IMOVEL ||--o{ CONTRATO_LOCACAO : alugado
  CLIENTE ||--o{ CONTRATO_LOCACAO : "inquilino e proprietário"
  CONTRATO_LOCACAO ||--o{ PARCELA_ALUGUEL : gera
  IMOVEL ||--o{ PROCESSO_ESCRITURA : escriturado
  TRANSACAO |o--o{ PROCESSO_ESCRITURA : formaliza

  IMOVEL {
    uuid id_imovel PK
    varchar tipo
    numeric preco
    enum estado_operacional
    enum estado_comercial
    enum estado_anuncio
  }
  CLIENTE {
    uuid id_cliente PK
    varchar nome
    text cpf_cnpj "cifrado"
    text telefone "cifrado"
    text email "cifrado"
  }
  CORRETOR {
    uuid id_corretor PK
    varchar nome
    text_array regioes_atuacao
    boolean ativo
  }
  ATENDIMENTO {
    uuid id_atendimento PK
    enum etapa
    enum estado
    int prioridade
    boolean precisa_desfecho
  }
  CONTRATO_LOCACAO {
    uuid id_contrato PK
    numeric valor_aluguel
    enum indice
    enum estado
  }
  PARCELA_ALUGUEL {
    uuid id_parcela PK
    varchar competencia
    enum estado
  }
  PROCESSO_ESCRITURA {
    uuid id_processo PK
    enum etapa
    timestamp etapa_desde
  }
```

Tabelas sem chave estrangeira, ligadas por `entidade` + `id_entidade` ou por
`id_evento`: `aprovacao` (fila de decisões), `log_evento` (trilha de auditoria),
`evento_processado` (idempotência), `leitura_modelo` (procedência),
`mensagem_enviada`. O schema `cerebro.nota` fica fora de propósito, sem nenhuma
chave para o cadastro.

## Estados do imóvel

Três máquinas independentes, cada uma com um dono. O banco recusa anúncio
`no_ar` sem `pronto` e `disponivel` (check `anuncio_exige_pronto_e_disponivel`).

```mermaid
stateDiagram-v2
  state "Operacional (Curador)" as op {
    [*] --> captado
    captado --> em_preparacao
    em_preparacao --> pronto
    em_preparacao --> com_pendencia
    com_pendencia --> pronto
    em_preparacao --> reprovado
  }
  state "Comercial (Guardião)" as com {
    [*] --> disponivel
    disponivel --> em_negociacao
    em_negociacao --> disponivel
    em_negociacao --> em_processo_venda
    em_processo_venda --> fechado
    disponivel --> arquivado
  }
  state "Anúncio" as an {
    [*] --> sem_anuncio
    sem_anuncio --> no_ar : aprovação subir_anuncio
    no_ar --> pausado
    pausado --> no_ar
    no_ar --> removido : aprovação derrubar_midia
  }
```

## Estados da aprovação

```mermaid
stateDiagram-v2
  [*] --> pendente
  pendente --> aprovado : pessoa aprova
  pendente --> negado : pessoa nega, com motivo
  pendente --> expirado : varredura, passou de expira_em
  aprovado --> [*]
  negado --> [*]
  expirado --> [*]
```

## Sequência: lead do WhatsApp até o corretor

```mermaid
sequenceDiagram
  actor Cliente
  participant D as Despachante
  participant A as 4 Atendimento
  participant M as Modelo (Groq)
  participant R as 3 Roteador
  participant G as Gate (interrupt)
  participant DB as Banco
  actor Corretor

  Cliente->>D: mensagem
  D->>A: evento do cliente (um trabalho por cliente)
  A->>DB: identidade pelo canal
  A->>M: extrai intenção e busca
  M-->>A: campos
  A->>DB: grava leitura_modelo, atendimento, busca
  A-->>Cliente: resposta
  alt lead qualificado e sem escalação
    A->>R: handoff (única aresta entre agentes)
    R->>DB: domínio, vínculo, agenda dos corretores
    R->>DB: aprovacao aceite_corretor (expira_em, enviar_em no expediente)
    R->>G: pausa
    Note over G: grafo parado na thread_id
    Corretor->>G: aceita ou recusa pelo painel
    G->>R: decisão no memo, nó re-executa
    alt aceitou
      R->>DB: vinculo_lead_corretor, log_evento
    else recusou ou expirou
      R->>DB: oferta ao próximo colocado
      Note over R: esgotadas as tentativas, escala para a equipe
    end
  else escalação
    A->>G: pausa para a equipe
  end
```
