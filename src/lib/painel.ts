import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Consultas do painel. Ficam fora de `app/` de propósito: são testáveis sem
 * subir o Next e sem renderizar nada.
 */

export const ROTULO: Record<string, string> = {
  subir_anuncio: "Subir anúncio",
  derrubar_midia: "Derrubar mídia paga",
  liberar_reprovado: "Liberar imóvel reprovado",
  escalacao_n3: "Escalação",
  aceite_corretor: "Oferta de lead",
  fundir_identidade: "Mesma pessoa em dois cadastros?",
  aplicar_alteracao: "Confirmar alteração de cadastro",
  reajuste_aluguel: "Reajuste de aluguel",
};

/** Quem abriu o pedido, em nome de gente. */
export const AGENTE: Record<string, string> = {
  "1_curador": "Curador de Estoque",
  "2_guardiao": "Guardião da Negociação",
  "3_roteador": "Roteador de Corretor",
  "4_atendimento": "Atendimento",
  "6_alterador": "Alterador de Cadastro",
  humano: "Humano",
  regra: "Regra",
};

/** Como cada faixa se apresenta na fila. O texto explica, a cor só reforça. */
export const FAIXA: Record<string, { rotulo: string; explicacao: string }> = {
  vermelha: {
    rotulo: "Urgente",
    explicacao: "Dinheiro, sem volta, ou o sistema não entendeu o que leu.",
  },
  amarela: {
    rotulo: "Revisado",
    explicacao: "Caso ambíguo: já veio com uma proposta para você conferir.",
  },
  verde: {
    rotulo: "Rotina",
    explicacao: "Confirmação simples, sem custo e reversível.",
  },
};

/**
 * A fila. Duas origens no mesmo lugar: os três gates N2 e as escalações N3.
 *
 * Ordena por faixa antes de data. A ordem cronológica pura tratava "confirma
 * que derrubo R$ 4.200 de mídia" igual a "cliente perguntou algo fora do
 * padrão", e com volume isso vira fila que ninguém lê. Dentro da mesma faixa,
 * mais antigo primeiro — o custo de não decidir cresce com o tempo.
 */
export async function filaPendente() {
  return db
    .select()
    .from(schema.aprovacao)
    .where(
      and(
        eq(schema.aprovacao.estado, "pendente"),
        // Oferta de lead não é decisão da equipe: quem responde é o corretor,
        // e o prazo responde por ele se ele não responder. Misturar as duas
        // filas faria o operador achar que precisa clicar em algo que não é
        // dele.
        ne(schema.aprovacao.tipo, "aceite_corretor"),
      ),
    )
    .orderBy(ordemDaFaixa, schema.aprovacao.criadoEm);
}

/**
 * A ordem das faixas, escrita no SQL e não no enum.
 *
 * Depender da ordem de declaração do enum do Postgres economizaria esta linha,
 * mas amarraria a fila do painel a uma decisão de migração: inserir uma faixa
 * nova no meio viraria reordenação silenciosa da tela.
 */
const ordemDaFaixa = sql`case ${schema.aprovacao.faixa}
  when 'vermelha' then 0 when 'amarela' then 1 else 2 end`;

/**
 * As ofertas em aberto. Não é fila de trabalho — é visibilidade: mostra pra
 * gestão qual lead está com quem e quanto tempo falta antes de passar adiante.
 */
export async function ofertasAbertas() {
  return db
    .select({
      id: schema.aprovacao.id,
      idEntidade: schema.aprovacao.idEntidade,
      contexto: schema.aprovacao.contexto,
      criadoEm: schema.aprovacao.criadoEm,
      expiraEm: schema.aprovacao.expiraEm,
      corretor: schema.corretor.nome,
    })
    .from(schema.aprovacao)
    .leftJoin(schema.corretor, eq(schema.corretor.idCorretor, schema.aprovacao.destinatario))
    .where(
      and(
        eq(schema.aprovacao.estado, "pendente"),
        eq(schema.aprovacao.tipo, "aceite_corretor"),
      ),
    )
    .orderBy(schema.aprovacao.expiraEm);
}

export async function decididasRecentes(limite = 20) {
  return db
    .select()
    .from(schema.aprovacao)
    .where(eq(schema.aprovacao.estado, "aprovado"))
    .orderBy(desc(schema.aprovacao.decididoEm))
    .limit(limite);
}

/**
 * "Por que esse anúncio caiu?" — a pergunta que justifica a tabela `log_evento`
 * na seção 6. Ordem cronológica inversa: a causa mais recente primeiro.
 */
export async function historicoDoImovel(idImovel: string) {
  const [imovel] = await db
    .select()
    .from(schema.imovel)
    .where(eq(schema.imovel.idImovel, idImovel));

  const eventos = await db
    .select()
    .from(schema.logEvento)
    .where(eq(schema.logEvento.idEntidade, idImovel))
    .orderBy(desc(schema.logEvento.timestamp))
    .limit(200);

  const anuncios = await db
    .select()
    .from(schema.anuncio)
    .where(eq(schema.anuncio.idImovel, idImovel));

  return { imovel, eventos, anuncios };
}

/** Descreve uma mudança do log em português, pra pessoa não ler nome de coluna. */
/**
 * O essencial da busca, sem `textoOriginal`: a fala do cliente fica na
 * conversa, não espalhada pelas telas de auditoria.
 */
function resumoDaBusca(json: string | null): string {
  try {
    const c = JSON.parse(json ?? "{}") as Record<string, unknown>;
    const partes = [
      c.tipoImovel,
      Array.isArray(c.bairrosDesejados) ? c.bairrosDesejados.join("/") : null,
      typeof c.valorMax === "number" ? `até R$ ${c.valorMax.toLocaleString("pt-BR")}` : null,
    ].filter(Boolean);
    return partes.length ? ` (${partes.join(", ")})` : "";
  } catch {
    return "";
  }
}

export function descrever(e: {
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
}): string {
  const de = e.valorAnterior ?? "vazio";
  const para = e.valorNovo ?? "vazio";
  switch (e.campo) {
    case "imovel.estadoOperacional":
      return `Estado operacional: ${de} → ${para}`;
    case "imovel.estadoComercial":
      return `Estado comercial: ${de} → ${para}`;
    case "imovel.estadoAnuncio":
      return `Anúncio: ${de} → ${para}`;
    case "imovel.preco":
      return `Preço atualizado para ${para}`;
    case "laudo":
      return "Laudo lido e extraído";
    case "anuncio":
      return `Anúncio do canal: ${para}`;
    case "transacao":
      return `Negociação avançou para: ${para}`;
    case "agenda":
      return `Visita reservada (${para})`;
    case "vinculoLeadCorretor":
      return `Lead vinculado ao corretor ${para}`;
    case "cliente.fusao":
      return `Cadastro duplicado unificado (${de} → ${para})`;
    case "imovel.endereco":
      return `Endereço corrigido: "${de}" → "${para}"`;
    case "imovel.bairro":
      return `Bairro corrigido: "${de}" → "${para}"`;
    case "imovel.tipo":
      return `Tipo do imóvel corrigido: "${de}" → "${para}"`;
    case "imovel.pontosReferencia":
      return `Pontos de referência corrigidos: "${de}" → "${para}"`;
    case "cliente.telefone":
    case "cliente.email":
    case "cliente.nome":
      return `Cadastro do cliente atualizado: "${de}" → "${para}"`;
    case "busca":
      return `Critérios de busca registrados${resumoDaBusca(e.valorNovo)}`;
    case "conversa":
      // O texto inteiro está na conversa; aqui ele só afogaria a lista.
      return "Resposta enviada ao cliente";
    case "papel":
      return `Papel atribuído: ${para}`;
    case "atendimento":
    case "atendimento.estado":
      return `Atendimento: ${de} → ${para}`;
    case "atendimento.reabertura":
      return `Atendimento reaberto pelo cliente (motivo anterior: ${de})`;
    case "atendimento.desfecho":
      return `Atendimento encerrado: ${para}`;
    case "parcela.atrasada":
      return `Parcela marcada como atrasada — ${para}`;
    case "parcela.cobranca":
      return `Cobrança enviada: ${de} → ${para}`;
    case "cliente.criado":
      return `Cliente novo cadastrado pelo ${de} (${para})`;
    case "identidade.reconhecida":
      return `Cliente reconhecido pelo ${de}: ${para}`;
    default:
      if (e.campo.startsWith("decisao.")) {
        return `Decisão registrada: ${ROTULO[e.campo.slice(8)] ?? e.campo.slice(8)} → ${para}`;
      }
      if (e.campo.startsWith("expirou.")) {
        return `Prazo esgotado: ${ROTULO[e.campo.slice(8)] ?? e.campo.slice(8)}`;
      }
      return `${e.campo}: ${de} → ${para}`;
  }
}


/**
 * A fila do funil: quem precisa de alguma coisa nossa, mais urgente primeiro.
 *
 * Ordena por `prioridade` e não por data, que é a diferença entre uma lista de
 * trabalho e um extrato. Quem fez proposta e sumiu há uma semana aparece acima
 * de quem mandou "quanto custa?" ontem — e é isso que a data sozinha inverte.
 */
export async function filaDoFunil(limite = 30) {
  return db
    .select({
      idAtendimento: schema.atendimento.idAtendimento,
      etapa: schema.atendimento.etapa,
      etapaMaxima: schema.atendimento.etapaMaxima,
      estado: schema.atendimento.estado,
      prioridade: schema.atendimento.prioridade,
      precisaDesfecho: schema.atendimento.precisaDesfecho,
      ultimaInteracao: schema.atendimento.ultimaInteracao,
      ultimoContatoPor: schema.atendimento.ultimoContatoPor,
      cliente: schema.cliente.nome,
      idCliente: schema.cliente.idCliente,
      corretor: schema.corretor.nome,
    })
    .from(schema.atendimento)
    .innerJoin(schema.cliente, eq(schema.cliente.idCliente, schema.atendimento.idCliente))
    .leftJoin(schema.corretor, eq(schema.corretor.idCorretor, schema.atendimento.idCorretor))
    .where(ne(schema.atendimento.estado, "fechado"))
    .orderBy(desc(schema.atendimento.prioridade))
    .limit(limite);
}

/** Os canais por onde cada cliente já apareceu. Alimenta a tela de fusão. */
export async function identidadesDoCliente(idCliente: string) {
  return db
    .select()
    .from(schema.identidade)
    .where(eq(schema.identidade.idCliente, idCliente));
}
