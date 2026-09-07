import {
  pgTable,
  pgEnum,
  text,
  varchar,
  uuid,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Estados do imóvel (PROJECT_SPEC seção 3) ---
// Três estados independentes, cada um com um dono único. Enums do Postgres e não
// texto livre: o banco recusa valor inválido sem depender de código de aplicação.

export const estadoOperacional = pgEnum("estado_operacional", [
  "captado",
  "em_preparacao",
  "pronto",
  "com_pendencia",
  "reprovado",
]);

export const estadoComercial = pgEnum("estado_comercial", [
  "disponivel",
  "em_negociacao",
  "em_processo_venda",
  "fechado",
  "arquivado",
]);

export const estadoAnuncio = pgEnum("estado_anuncio", [
  "sem_anuncio",
  "no_ar",
  "pausado",
  "removido",
]);

export const papelCliente = pgEnum("papel_cliente", [
  "proprietario",
  "comprador",
  "inquilino",
  "lead",
]);

export const nivelDominio = pgEnum("nivel_dominio", [
  "captou",
  "ja_visitou",
  "conhece_regiao",
]);

export const tipoAprovacao = pgEnum("tipo_aprovacao", [
  "subir_anuncio",
  "derrubar_midia",
  "liberar_reprovado",
  "escalacao_n3",
  // Não é aprovação da equipe: é o aceite do corretor a quem o lead foi
  // oferecido. Mesmo mecanismo (o grafo para e espera decisão de fora), fila
  // diferente — quem responde é o corretor, não quem opera o painel.
  "aceite_corretor",
  // Duas pessoas no banco que provavelmente são uma só. Fusão nunca é
  // automática: juntar errado mistura a negociação de um com a do outro.
  "fundir_identidade",
  // Mudança de cadastro pedida em texto livre. O agente interpreta, a pessoa
  // confirma o "de → para" antes de qualquer escrita.
  "aplicar_alteracao",
  // Reajuste anual do aluguel. O índice vem de fora e o valor se negocia.
  "reajuste_aluguel",
]);

export const estadoAprovacao = pgEnum("estado_aprovacao", [
  "pendente",
  "aprovado",
  "negado",
  // Ninguém respondeu dentro do prazo. Estado próprio porque "expirou" e
  // "recusou" pedem relatórios diferentes: um é problema de processo, o outro
  // é decisão.
  "expirado",
]);

export const agenteOrigem = pgEnum("agente_origem", [
  "1_curador",
  "2_guardiao",
  "3_roteador",
  "4_atendimento",
  "6_alterador",
  "humano",
  "regra",
]);

// --- imovel ---

export const imovel = pgTable(
  "imovel",
  {
    idImovel: uuid("id_imovel").primaryKey().defaultRandom(),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    preco: numeric("preco", { precision: 14, scale: 2 }),
    endereco: text("endereco").notNull(),
    bairro: varchar("bairro", { length: 120 }),
    cidade: varchar("cidade", { length: 120 }).notNull(),
    pontosReferencia: text("pontos_referencia"),
    idProprietario: uuid("id_proprietario").references(() => cliente.idCliente),
    idCorretorCaptador: uuid("id_corretor_captador").references(
      () => corretor.idCorretor,
    ),
    estadoOperacional: estadoOperacional("estado_operacional")
      .notNull()
      .default("captado"),
    estadoComercial: estadoComercial("estado_comercial")
      .notNull()
      .default("disponivel"),
    estadoAnuncio: estadoAnuncio("estado_anuncio")
      .notNull()
      .default("sem_anuncio"),
    dataCaptacao: timestamp("data_captacao").defaultNow().notNull(),
  },
  (t) => [
    index("imovel_estados_idx").on(
      t.estadoOperacional,
      t.estadoComercial,
      t.estadoAnuncio,
    ),
    // O invariante da seção 3, no banco e não só no código: um imóvel não pode
    // estar com anúncio no ar sem estar pronto e disponível. A regra de negócio
    // ainda existe em src/regras/publicacao.ts, mas isto é a última linha de
    // defesa contra escrita concorrente que passe por fora dela.
    check(
      "anuncio_exige_pronto_e_disponivel",
      sql`${t.estadoAnuncio} <> 'no_ar' OR (${t.estadoOperacional} = 'pronto' AND ${t.estadoComercial} = 'disponivel')`,
    ),
  ],
);

// --- anuncio ---

export const anuncio = pgTable(
  "anuncio",
  {
    idAnuncio: uuid("id_anuncio").primaryKey().defaultRandom(),
    idImovel: uuid("id_imovel")
      .notNull()
      .references(() => imovel.idImovel, { onDelete: "cascade" }),
    canal: varchar("canal", { length: 50 }).notNull(),
    status: estadoAnuncio("status").notNull().default("no_ar"),
    // Um imóvel pode estar em vários canais ao mesmo tempo; é por isso que esta
    // tabela existe (seção 6). Mídia paga é o que exige aprovação pra derrubar.
    midiaPaga: boolean("midia_paga").notNull().default(false),
    dataPublicacao: timestamp("data_publicacao").defaultNow().notNull(),
    dataRemocao: timestamp("data_remocao"),
    custoAcumulado: numeric("custo_acumulado", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
  },
  (t) => [index("anuncio_imovel_idx").on(t.idImovel, t.status)],
);

// --- laudo ---

export const laudo = pgTable(
  "laudo",
  {
    idLaudo: uuid("id_laudo").primaryKey().defaultRandom(),
    idImovel: uuid("id_imovel")
      .notNull()
      .references(() => imovel.idImovel, { onDelete: "cascade" }),
    idAutor: uuid("id_autor"),
    tipo: varchar("tipo", { length: 50 }).notNull(),
    // Roteiro curto de três campos, texto livre dentro de cada um (decisão 4).
    textoEstado: text("texto_estado"),
    textoDocumentacao: text("texto_documentacao"),
    textoPendencias: text("texto_pendencias"),
    // O que o agente entendeu, guardado ao lado do que o humano escreveu.
    // É esse par que torna o erro de extração auditável.
    extracaoEstruturada: jsonb("extracao_estruturada"),
    data: timestamp("data").defaultNow().notNull(),
  },
  (t) => [index("laudo_imovel_idx").on(t.idImovel, t.data)],
);

// --- cliente ---

export const cliente = pgTable("cliente", {
  idCliente: uuid("id_cliente").primaryKey().defaultRandom(),
  nome: varchar("nome", { length: 255 }).notNull(),
  cpfCnpj: varchar("cpf_cnpj", { length: 20 }),
  telefone: varchar("telefone", { length: 30 }),
  email: varchar("email", { length: 255 }),
  origemCanal: varchar("origem_canal", { length: 50 }),
  dataEntrada: timestamp("data_entrada").defaultNow().notNull(),
});

// --- papel ---
// Sem campo `tipo` no cliente: a mesma pessoa pode ser proprietária de um
// imóvel e compradora de outro ao mesmo tempo (seção 6).

export const papel = pgTable(
  "papel",
  {
    idPapel: uuid("id_papel").primaryKey().defaultRandom(),
    idCliente: uuid("id_cliente")
      .notNull()
      .references(() => cliente.idCliente, { onDelete: "cascade" }),
    idImovel: uuid("id_imovel").references(() => imovel.idImovel, {
      onDelete: "cascade",
    }),
    papel: papelCliente("papel").notNull(),
    ativo: boolean("ativo").notNull().default(true),
  },
  (t) => [index("papel_cliente_idx").on(t.idCliente, t.ativo)],
);

// --- busca ---

export const busca = pgTable(
  "busca",
  {
    idBusca: uuid("id_busca").primaryKey().defaultRandom(),
    idCliente: uuid("id_cliente")
      .notNull()
      .references(() => cliente.idCliente, { onDelete: "cascade" }),
    valorMin: numeric("valor_min", { precision: 14, scale: 2 }),
    valorMax: numeric("valor_max", { precision: 14, scale: 2 }),
    tipoImovel: varchar("tipo_imovel", { length: 50 }),
    bairrosDesejados: text("bairros_desejados").array(),
    // Obrigatório: "queria algo de dois quartos perto de escola até uns 400".
    // Guardar só os números perde a parte que mais importa pro match (seção 6).
    textoOriginal: text("texto_original").notNull(),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [index("busca_cliente_idx").on(t.idCliente)],
);

// --- corretor ---

export const corretor = pgTable("corretor", {
  idCorretor: uuid("id_corretor").primaryKey().defaultRandom(),
  nome: varchar("nome", { length: 255 }).notNull(),
  telefone: varchar("telefone", { length: 30 }),
  comissaoPercentual: numeric("comissao_percentual", {
    precision: 5,
    scale: 2,
  }),
  regioesAtuacao: text("regioes_atuacao").array(),
  ativo: boolean("ativo").notNull().default(true),
});

// --- dominio_corretor ---
// Sem esta tabela o Agente 3 não tem como pontuar ninguém (seção 6).

export const dominioCorretor = pgTable(
  "dominio_corretor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idCorretor: uuid("id_corretor")
      .notNull()
      .references(() => corretor.idCorretor, { onDelete: "cascade" }),
    idImovel: uuid("id_imovel")
      .notNull()
      .references(() => imovel.idImovel, { onDelete: "cascade" }),
    nivel: nivelDominio("nivel").notNull(),
  },
  (t) => [
    uniqueIndex("dominio_corretor_par_idx").on(t.idCorretor, t.idImovel),
    index("dominio_imovel_idx").on(t.idImovel),
  ],
);

// --- vinculo_lead_corretor ---
// A relação corretor↔cliente que o roteamento híbrido exige. `ultimaInteracao`
// é o campo que a janela de inatividade lê (seção 6).

export const vinculoLeadCorretor = pgTable(
  "vinculo_lead_corretor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idCliente: uuid("id_cliente")
      .notNull()
      .references(() => cliente.idCliente, { onDelete: "cascade" }),
    idCorretor: uuid("id_corretor")
      .notNull()
      .references(() => corretor.idCorretor, { onDelete: "cascade" }),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
    ultimaInteracao: timestamp("ultima_interacao").defaultNow().notNull(),
    ativo: boolean("ativo").notNull().default(true),
  },
  (t) => [index("vinculo_cliente_idx").on(t.idCliente, t.ativo)],
);

// --- agenda ---

export const agenda = pgTable(
  "agenda",
  {
    idEvento: uuid("id_evento").primaryKey().defaultRandom(),
    idCorretor: uuid("id_corretor")
      .notNull()
      .references(() => corretor.idCorretor, { onDelete: "cascade" }),
    idImovel: uuid("id_imovel").references(() => imovel.idImovel),
    idCliente: uuid("id_cliente").references(() => cliente.idCliente),
    inicio: timestamp("inicio").notNull(),
    fim: timestamp("fim").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("reservado"),
  },
  (t) => [index("agenda_corretor_idx").on(t.idCorretor, t.inicio)],
);

// --- transacao ---

export const transacao = pgTable(
  "transacao",
  {
    idTransacao: uuid("id_transacao").primaryKey().defaultRandom(),
    idImovel: uuid("id_imovel")
      .notNull()
      .references(() => imovel.idImovel, { onDelete: "cascade" }),
    idClienteComprador: uuid("id_cliente_comprador").references(
      () => cliente.idCliente,
    ),
    idCorretor: uuid("id_corretor").references(() => corretor.idCorretor),
    tipo: varchar("tipo", { length: 30 }).notNull(),
    valorFinal: numeric("valor_final", { precision: 14, scale: 2 }),
    dataFechamento: timestamp("data_fechamento"),
    comissaoPaga: boolean("comissao_paga").notNull().default(false),
    // O Agente 2 precisa registrar o caminho até o fechamento, não só o
    // resultado final (seção 6).
    etapa: varchar("etapa", { length: 50 }).notNull(),
  },
  (t) => [index("transacao_imovel_idx").on(t.idImovel)],
);

// --- aprovacao ---
// Registro auditável e fila da interface. NÃO é o mecanismo de controle de
// fluxo — quem pausa e retoma o grafo é o interrupt() do LangGraph (seção 11).

export const aprovacao = pgTable(
  "aprovacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tipo: tipoAprovacao("tipo").notNull(),
    entidade: varchar("entidade", { length: 50 }).notNull(),
    idEntidade: uuid("id_entidade").notNull(),
    solicitadoPorAgente: agenteOrigem("solicitado_por_agente").notNull(),
    estado: estadoAprovacao("estado").notNull().default("pendente"),
    contexto: jsonb("contexto"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
    idEvento: uuid("id_evento"),
    // Para quem o pedido foi endereçado, quando não é a equipe: o corretor da
    // oferta. Nulo nos três gates N2, que são da equipe inteira.
    destinatario: uuid("destinatario"),
    // Prazo do aceite. Passou disso, a varredura expira e o grafo segue sem
    // ninguém clicar — lead parado é lead perdido.
    expiraEm: timestamp("expira_em"),
    // Quando a mensagem da oferta deve sair. Lead que chega 3h da manhã não
    // acorda corretor: o pedido é registrado na hora e entregue quando o
    // expediente abre. Nulo = manda agora.
    enviarEm: timestamp("enviar_em"),
    // Marcado quando a mensagem realmente saiu, pra varredura não repetir.
    enviadoEm: timestamp("enviado_em"),
    // A thread do LangGraph que está parada esperando esta decisão. É o único
    // ponteiro que o painel precisa pra retomar o grafo (seção 11).
    threadId: varchar("thread_id", { length: 120 }),
    decididoPor: varchar("decidido_por", { length: 255 }),
    decididoEm: timestamp("decidido_em"),
    motivo: text("motivo"),
  },
  (t) => [
    index("aprovacao_pendente_idx").on(t.estado, t.criadoEm),
    // A varredura de prazo lê exatamente por aqui.
    index("aprovacao_expira_idx").on(t.estado, t.expiraEm),
    // Idempotência do gate: um nó que interrompe re-executa inteiro no resume
    // (ver src/grafo/interrupt.test.ts). Sem esta chave, um pedido vira duas
    // linhas na fila do painel.
    uniqueIndex("aprovacao_por_evento_idx").on(t.idEvento, t.tipo, t.idEntidade),
  ],
);

// --- log_evento ---
// "Por que esse anúncio caiu?" — a resposta está aqui (seção 6).

export const logEvento = pgTable(
  "log_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agenteOrigem: agenteOrigem("agente_origem").notNull(),
    entidade: varchar("entidade", { length: 50 }).notNull(),
    idEntidade: uuid("id_entidade").notNull(),
    campo: varchar("campo", { length: 80 }).notNull(),
    valorAnterior: text("valor_anterior"),
    valorNovo: text("valor_novo"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    aprovadoPor: varchar("aprovado_por", { length: 255 }),
    idEvento: uuid("id_evento"),
  },
  (t) => [
    index("log_entidade_idx").on(t.entidade, t.idEntidade, t.timestamp),
    // A R7 faz o nó do agente re-executar depois do gate, então a mesma
    // escrita chega duas vezes. O UPDATE é idempotente por natureza; o log
    // não seria — sem esta chave, "por que esse anúncio caiu?" responderia
    // em dobro.
    uniqueIndex("log_por_evento_idx").on(t.idEvento, t.campo, t.idEntidade),
  ],
);

// --- evento_processado ---
// R6, idempotência: reprocessar um evento não duplica efeito. Sem isto, o retry
// de um Agente 2 que estourou timeout abre dois pedidos de derrubar mídia.

export const eventoProcessado = pgTable("evento_processado", {
  idEvento: uuid("id_evento").primaryKey(),
  tipo: varchar("tipo", { length: 60 }).notNull(),
  agente: agenteOrigem("agente").notNull(),
  processadoEm: timestamp("processado_em").defaultNow().notNull(),
});

// ============================================================================
// WAVE 8 — identidade multicanal, funil de atendimento, locação e escrituras
// ============================================================================

// --- identidade ---
// O mesmo ser humano chega por portas diferentes e nenhuma delas carrega o
// telefone: DM de Instagram traz um @, o site traz um cookie, o WhatsApp traz
// um wa_id. Sem esta tabela, cada porta cria um cliente novo.

export const canalIdentidade = pgEnum("canal_identidade", [
  "whatsapp",
  "instagram",
  "facebook",
  "site",
  "email",
  "telefone",
  "portal",
]);

export const origemVinculoIdentidade = pgEnum("origem_vinculo_identidade", [
  // Chave que só pode ser de uma pessoa (CPF, e-mail confirmado).
  "deterministica",
  // A própria pessoa afirmou ("sim, sou eu que falei pelo Insta").
  "declarada",
  // Alguém da equipe confirmou olhando as duas conversas.
  "humana",
  // Aproximação por sinais. NUNCA entra sozinha — vira pedido de fusão.
  "probabilistica",
]);

export const identidade = pgTable(
  "identidade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idCliente: uuid("id_cliente")
      .notNull()
      .references(() => cliente.idCliente, { onDelete: "cascade" }),
    canal: canalIdentidade("canal").notNull(),
    // O que o canal entrega como identificador: @handle, wa_id, id do perfil.
    // Guardado normalizado (minúsculo, sem @) — comparar cru erra por caixa.
    identificador: varchar("identificador", { length: 255 }).notNull(),
    // Como o perfil se apresenta. Não serve de chave (apelido, nome de loja,
    // emoji), mas é sinal de aproximação.
    apelido: varchar("apelido", { length: 255 }),
    origem: origemVinculoIdentidade("origem").notNull().default("deterministica"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [
    // A âncora determinística: um identificador de um canal aponta pra uma
    // pessoa só. É esta chave que faz a segunda mensagem do mesmo @ cair no
    // mesmo cliente em vez de abrir outro.
    uniqueIndex("identidade_canal_idx").on(t.canal, t.identificador),
    index("identidade_cliente_idx").on(t.idCliente),
  ],
);

// --- atendimento ---
// O funil antes da transação. `transacao` guarda negócio; isto guarda a
// conversa, que existe muito antes de haver negócio e continua existindo
// quando o negócio não acontece.

export const etapaAtendimento = pgEnum("etapa_atendimento", [
  "primeiro_contato",
  "qualificado",
  "visita_agendada",
  "visita_feita",
  "proposta",
  "negociacao",
  "ganho",
  "perdido",
]);

export const estadoAtendimento = pgEnum("estado_atendimento", [
  // A bola está com a gente. Alguém precisa fazer alguma coisa.
  "aberto",
  // A bola está com o cliente. Fizemos nossa parte e esperamos resposta.
  "pendente",
  // Tem desfecho escrito. Só sai daqui quem tem motivo.
  "fechado",
]);

export const atendimento = pgTable(
  "atendimento",
  {
    idAtendimento: uuid("id_atendimento").primaryKey().defaultRandom(),
    idCliente: uuid("id_cliente")
      .notNull()
      .references(() => cliente.idCliente, { onDelete: "cascade" }),
    idImovel: uuid("id_imovel").references(() => imovel.idImovel, {
      onDelete: "set null",
    }),
    idCorretor: uuid("id_corretor").references(() => corretor.idCorretor),
    etapa: etapaAtendimento("etapa").notNull().default("primeiro_contato"),
    estado: estadoAtendimento("estado").notNull().default("aberto"),
    // A etapa mais funda que este atendimento já alcançou. Quem chegou em
    // proposta e voltou vale mais que quem nunca passou do primeiro contato —
    // e a etapa atual sozinha esquece isso.
    etapaMaxima: etapaAtendimento("etapa_maxima").notNull().default("primeiro_contato"),
    // Desfecho obrigatório pra fechar. Fechar sem motivo é o mesmo que sumir
    // com o caso: o buraco que o user chamou de "lista de casos não definidos".
    motivoDesfecho: text("motivo_desfecho"),
    ultimaInteracao: timestamp("ultima_interacao").defaultNow().notNull(),
    // Quem falou por último. `cliente` significa que a bola é nossa.
    ultimoContatoPor: varchar("ultimo_contato_por", { length: 20 })
      .notNull()
      .default("cliente"),
    // Recalculada pela varredura. Sobe com a profundidade e com o silêncio.
    prioridade: integer("prioridade").notNull().default(0),
    // Bateu o teto de silêncio: precisa de alguém pra dar o ponto final. O
    // sistema não decide sozinho que o cliente desistiu.
    precisaDesfecho: boolean("precisa_desfecho").notNull().default(false),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [
    index("atendimento_fila_idx").on(t.estado, t.prioridade),
    index("atendimento_cliente_idx").on(t.idCliente, t.estado),
    // Um atendimento aberto por par cliente/imóvel. Duas conversas paralelas
    // sobre o mesmo imóvel com a mesma pessoa é duplicata, não caso novo.
    uniqueIndex("atendimento_par_idx").on(t.idCliente, t.idImovel),
  ],
);

// --- locação ---
// Venda acaba na escritura; locação começa no contrato e dura anos. O que
// pesa aqui não é o cadastro, é o calendário: vencimento todo mês, reajuste
// todo ano, repasse ao proprietário depois de cada pagamento.

export const indiceReajuste = pgEnum("indice_reajuste", ["igpm", "ipca", "inpc"]);

export const estadoContratoLocacao = pgEnum("estado_contrato_locacao", [
  "ativo",
  "em_rescisao",
  "encerrado",
]);

export const estadoParcela = pgEnum("estado_parcela", [
  "aberta",
  "paga",
  "atrasada",
  // Paga pelo inquilino e já repassada ao proprietário: o ciclo fechou.
  "repassada",
  "cancelada",
]);

export const contratoLocacao = pgTable(
  "contrato_locacao",
  {
    idContrato: uuid("id_contrato").primaryKey().defaultRandom(),
    idImovel: uuid("id_imovel")
      .notNull()
      .references(() => imovel.idImovel, { onDelete: "restrict" }),
    idInquilino: uuid("id_inquilino")
      .notNull()
      .references(() => cliente.idCliente),
    idProprietario: uuid("id_proprietario")
      .notNull()
      .references(() => cliente.idCliente),
    valorAluguel: numeric("valor_aluguel", { precision: 12, scale: 2 }).notNull(),
    // Condomínio e IPTU entram separados: reajuste incide sobre o aluguel, não
    // sobre eles, e o repasse ao proprietário também não os inclui.
    valorCondominio: numeric("valor_condominio", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    valorIptu: numeric("valor_iptu", { precision: 12, scale: 2 }).notNull().default("0"),
    diaVencimento: integer("dia_vencimento").notNull().default(10),
    inicio: timestamp("inicio").notNull(),
    fim: timestamp("fim").notNull(),
    indice: indiceReajuste("indice").notNull().default("igpm"),
    // Data do último reajuste aplicado. Nula = nunca reajustou, e o
    // aniversário conta a partir do início.
    ultimoReajuste: timestamp("ultimo_reajuste"),
    taxaAdministracao: numeric("taxa_administracao", { precision: 5, scale: 2 })
      .notNull()
      .default("10"),
    multaAtraso: numeric("multa_atraso", { precision: 5, scale: 2 }).notNull().default("2"),
    jurosMes: numeric("juros_mes", { precision: 5, scale: 2 }).notNull().default("1"),
    estado: estadoContratoLocacao("estado").notNull().default("ativo"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [
    index("contrato_estado_idx").on(t.estado, t.fim),
    index("contrato_imovel_idx").on(t.idImovel),
  ],
);

export const parcelaAluguel = pgTable(
  "parcela_aluguel",
  {
    idParcela: uuid("id_parcela").primaryKey().defaultRandom(),
    idContrato: uuid("id_contrato")
      .notNull()
      .references(() => contratoLocacao.idContrato, { onDelete: "cascade" }),
    // "2026-09". Texto e não data porque é o mês de referência, não um dia.
    competencia: varchar("competencia", { length: 7 }).notNull(),
    vencimento: timestamp("vencimento").notNull(),
    valorBase: numeric("valor_base", { precision: 12, scale: 2 }).notNull(),
    // Multa + juros do atraso, recalculados até o pagamento.
    valorEncargos: numeric("valor_encargos", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    valorPago: numeric("valor_pago", { precision: 12, scale: 2 }),
    pagoEm: timestamp("pago_em"),
    repassadoEm: timestamp("repassado_em"),
    estado: estadoParcela("estado").notNull().default("aberta"),
    // Até onde a régua de cobrança já foi. Evita mandar a mesma cobrança duas
    // vezes e evita pular direto pro jurídico.
    estagioCobranca: integer("estagio_cobranca").notNull().default(0),
  },
  (t) => [
    index("parcela_vencimento_idx").on(t.estado, t.vencimento),
    // Uma parcela por mês por contrato: a varredura roda de minuto em minuto e
    // sem isto geraria uma cobrança nova a cada passagem.
    uniqueIndex("parcela_competencia_idx").on(t.idContrato, t.competencia),
  ],
);

// --- escrituras ---
// O processo que sai das nossas mãos. Metade das etapas depende de cartório e
// prefeitura, que não obedecem prazo interno — por isso o campo `responsavel`
// existe, e por isso só o que é nosso pode "vencer".

export const etapaEscritura = pgEnum("etapa_escritura", [
  "contrato_assinado",
  "documentacao",
  "itbi_emitido",
  "itbi_pago",
  "escritura_lavrada",
  "registro_protocolado",
  "registro_concluido",
  "concluido",
  "cancelado",
]);

export const responsavelEtapa = pgEnum("responsavel_etapa", [
  "imobiliaria",
  "comprador",
  "vendedor",
  "cartorio",
  "prefeitura",
  "banco",
]);

export const processoEscritura = pgTable(
  "processo_escritura",
  {
    idProcesso: uuid("id_processo").primaryKey().defaultRandom(),
    idImovel: uuid("id_imovel")
      .notNull()
      .references(() => imovel.idImovel, { onDelete: "restrict" }),
    idTransacao: uuid("id_transacao").references(() => transacao.idTransacao),
    idComprador: uuid("id_comprador").references(() => cliente.idCliente),
    idVendedor: uuid("id_vendedor").references(() => cliente.idCliente),
    etapa: etapaEscritura("etapa").notNull().default("contrato_assinado"),
    // Quando a etapa atual começou. É daqui que sai "está parado há 40 dias".
    etapaDesde: timestamp("etapa_desde").defaultNow().notNull(),
    // Nome do cartório de notas e do registro de imóveis, quando já definidos.
    cartorioNotas: varchar("cartorio_notas", { length: 255 }),
    cartorioRegistro: varchar("cartorio_registro", { length: 255 }),
    matricula: varchar("matricula", { length: 80 }),
    valorItbi: numeric("valor_itbi", { precision: 12, scale: 2 }),
    // Certidões e comprovantes já entregues, por nome. Lista simples: o que
    // falta é a diferença entre isto e a exigência da etapa.
    documentosEntregues: text("documentos_entregues").array(),
    // Marcado quando a etapa passou do prazo típico. Não expira nada — em
    // etapa de cartório, "atrasado" quer dizer "ligue lá", não "siga sem".
    alertadoEm: timestamp("alertado_em"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
    concluidoEm: timestamp("concluido_em"),
  },
  (t) => [
    index("escritura_etapa_idx").on(t.etapa, t.etapaDesde),
    index("escritura_imovel_idx").on(t.idImovel),
  ],
);

// ============================================================================
// WAVE 9 — procedência das leituras de modelo
// ============================================================================

// --- leitura_modelo ---
// Quem leu, com qual modelo e com qual prompt. O `log_evento` responde "por que
// esse anúncio caiu?"; esta tabela responde a pergunta que vem antes dela: "o
// que foi lido, e por quem, pra chegar nessa conclusão?".
//
// Sem isto, trocar de modelo ou mexer numa linha de prompt é uma mudança
// invisível no histórico — e "melhorou" vira opinião.

export const leituraModelo = pgTable(
  "leitura_modelo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // `varchar` e não o enum `agente_origem` de propósito: o Agente 5 (consulta)
    // não está lá, porque nunca escreveu em campo nenhum. Ele lê modelo como
    // qualquer outro, então precisa caber aqui — e mexer num enum que sete
    // tabelas usam pra acomodar uma auditoria seria o rabo abanando o cachorro.
    agente: varchar("agente", { length: 20 }).notNull(),
    tarefa: varchar("tarefa", { length: 20 }).notNull(),
    modelo: varchar("modelo", { length: 120 }).notNull(),
    // Hash do texto do prompt — versão que se mantém sozinha (ver
    // src/agentes/procedencia.ts).
    promptHash: varchar("prompt_hash", { length: 16 }).notNull(),
    entrada: text("entrada").notNull(),
    entradaHash: varchar("entrada_hash", { length: 16 }).notNull(),
    saida: jsonb("saida"),
    ms: integer("ms").notNull(),
    // Preenchido quando a chamada falhou. É a linha mais valiosa da tabela: a
    // única que conta o que deu errado antes de alguém reclamar.
    erro: text("erro"),
    idEvento: uuid("id_evento"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [
    // A aferição lê exatamente por aqui: acerto por versão de prompt.
    index("leitura_prompt_idx").on(t.agente, t.promptHash, t.criadoEm),
    index("leitura_evento_idx").on(t.idEvento),
  ],
);

// ============================================================================
// WAVE 10 — o que o sistema mandou (ou teria mandado)
// ============================================================================

// --- mensagem_enviada ---
// Toda tentativa de falar com alguém de fora vira linha aqui, inclusive quando
// o canal está desligado. Antes disto, a mensagem da oferta sumia num
// `console.log` e o sistema marcava "enviado" mesmo assim — ninguém tinha como
// conferir o que a imobiliária disse a um cliente ou a um corretor.

export const mensagemEnviada = pgTable(
  "mensagem_enviada",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    destino: varchar("destino", { length: 40 }),
    texto: text("texto").notNull(),
    // "entregue" quando o canal aceitou, "sem_canal" quando não há para onde
    // mandar, "falha" quando o canal recusou. Os três são estados diferentes e
    // pedem providências diferentes.
    estado: varchar("estado", { length: 20 }).notNull(),
    motivo: text("motivo"),
    criadoEm: timestamp("criado_em").defaultNow().notNull(),
  },
  (t) => [index("mensagem_criado_idx").on(t.criadoEm)],
);
