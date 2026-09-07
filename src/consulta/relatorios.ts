import { and, asc, count, desc, eq, gte, isNotNull, sql, sum } from "drizzle-orm";
import { dbLeitura as db } from "@/lib/db/leitura";
import * as schema from "@/lib/db/schema";

/**
 * Os relatórios que a equipe pede.
 *
 * Regra do projeto aplicada aqui também: **o número sai do banco, nunca do
 * modelo**. Cada função abaixo é uma consulta determinística — mesma pergunta,
 * mesmo resultado, sem opinião no meio. O modelo entra depois, só pra escrever
 * o texto em cima destas linhas.
 *
 * É o que separa "relatório" de "chute bem redigido".
 */

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000);
const num = (v: string | null) => (v === null ? 0 : Number(v));

export type Relatorio =
  | "estoque"
  | "campanhas"
  | "vendas"
  | "leads"
  | "equipe"
  | "imovel";

/** Quantos imóveis em cada situação, e o que está encalhado. */
export async function estoque() {
  const porEstado = await db
    .select({
      operacional: schema.imovel.estadoOperacional,
      comercial: schema.imovel.estadoComercial,
      anuncio: schema.imovel.estadoAnuncio,
      quantos: count(),
      valor: sum(schema.imovel.preco),
    })
    .from(schema.imovel)
    .groupBy(
      schema.imovel.estadoOperacional,
      schema.imovel.estadoComercial,
      schema.imovel.estadoAnuncio,
    );

  // O que a spec chama de invariante, visto pelo avesso: imóvel pronto e
  // disponível que não está no ar é dinheiro parado na prateleira.
  const prontosForaDoAr = await db
    .select({
      idImovel: schema.imovel.idImovel,
      endereco: schema.imovel.endereco,
      bairro: schema.imovel.bairro,
      preco: schema.imovel.preco,
      desde: schema.imovel.dataCaptacao,
    })
    .from(schema.imovel)
    .where(
      and(
        eq(schema.imovel.estadoOperacional, "pronto"),
        eq(schema.imovel.estadoComercial, "disponivel"),
        eq(schema.imovel.estadoAnuncio, "sem_anuncio"),
      ),
    )
    .orderBy(asc(schema.imovel.dataCaptacao));

  const travados = await db
    .select({
      idImovel: schema.imovel.idImovel,
      endereco: schema.imovel.endereco,
      estado: schema.imovel.estadoOperacional,
      desde: schema.imovel.dataCaptacao,
    })
    .from(schema.imovel)
    .where(
      and(
        sql`${schema.imovel.estadoOperacional} IN ('captado','em_preparacao','com_pendencia')`,
        gte(schema.imovel.dataCaptacao, diasAtras(365)),
      ),
    )
    .orderBy(asc(schema.imovel.dataCaptacao));

  return {
    total: porEstado.reduce((s, l) => s + l.quantos, 0),
    porEstado,
    prontosForaDoAr,
    travados,
  };
}

/** Onde a mídia paga está queimando dinheiro. */
export async function campanhas() {
  const linhas = await db
    .select({
      idAnuncio: schema.anuncio.idAnuncio,
      canal: schema.anuncio.canal,
      status: schema.anuncio.status,
      midiaPaga: schema.anuncio.midiaPaga,
      custo: schema.anuncio.custoAcumulado,
      desde: schema.anuncio.dataPublicacao,
      endereco: schema.imovel.endereco,
      bairro: schema.imovel.bairro,
      estadoComercial: schema.imovel.estadoComercial,
    })
    .from(schema.anuncio)
    .innerJoin(schema.imovel, eq(schema.imovel.idImovel, schema.anuncio.idImovel))
    .orderBy(desc(schema.anuncio.custoAcumulado));

  const pagos = linhas.filter((l) => l.midiaPaga);

  return {
    gastoTotal: pagos.reduce((s, l) => s + num(l.custo), 0),
    gastoNoAr: pagos
      .filter((l) => l.status === "no_ar")
      .reduce((s, l) => s + num(l.custo), 0),
    // O caso que dói: campanha paga rodando em imóvel que saiu de disponível.
    // Se aparecer aqui, tem gate esperando decisão no painel.
    queimandoEmNegociacao: pagos.filter(
      (l) => l.status === "no_ar" && l.estadoComercial !== "disponivel",
    ),
    anuncios: linhas,
  };
}

/** O funil de venda pelo que está registrado nas transações. */
export async function vendas(dias = 90) {
  const porEtapa = await db
    .select({
      etapa: schema.transacao.etapa,
      quantos: count(),
      valor: sum(schema.transacao.valorFinal),
    })
    .from(schema.transacao)
    .groupBy(schema.transacao.etapa);

  const fechadas = await db
    .select({
      idTransacao: schema.transacao.idTransacao,
      valor: schema.transacao.valorFinal,
      data: schema.transacao.dataFechamento,
      comissaoPaga: schema.transacao.comissaoPaga,
      endereco: schema.imovel.endereco,
      bairro: schema.imovel.bairro,
    })
    .from(schema.transacao)
    .innerJoin(schema.imovel, eq(schema.imovel.idImovel, schema.transacao.idImovel))
    .where(
      and(
        eq(schema.transacao.etapa, "assinada"),
        isNotNull(schema.transacao.dataFechamento),
        gte(schema.transacao.dataFechamento, diasAtras(dias)),
      ),
    )
    .orderBy(desc(schema.transacao.dataFechamento));

  return {
    janelaDias: dias,
    porEtapa,
    fechadas,
    valorFechado: fechadas.reduce((s, l) => s + num(l.valor), 0),
  };
}

/** Quantos leads entraram, quantos viraram visita, e onde o funil vaza. */
export async function leads(dias = 30) {
  const [novos] = await db
    .select({ quantos: count() })
    .from(schema.cliente)
    .where(gte(schema.cliente.dataEntrada, diasAtras(dias)));

  const porCanal = await db
    .select({ canal: schema.cliente.origemCanal, quantos: count() })
    .from(schema.cliente)
    .where(gte(schema.cliente.dataEntrada, diasAtras(dias)))
    .groupBy(schema.cliente.origemCanal);

  // As ofertas contam a história real do atendimento: aceita virou visita,
  // expirada é lead que esperou e ninguém pegou.
  const ofertas = await db
    .select({ estado: schema.aprovacao.estado, quantos: count() })
    .from(schema.aprovacao)
    .where(
      and(
        eq(schema.aprovacao.tipo, "aceite_corretor"),
        gte(schema.aprovacao.criadoEm, diasAtras(dias)),
      ),
    )
    .groupBy(schema.aprovacao.estado);

  const escalacoes = await db
    .select({ contexto: schema.aprovacao.contexto, criadoEm: schema.aprovacao.criadoEm })
    .from(schema.aprovacao)
    .where(
      and(
        eq(schema.aprovacao.tipo, "escalacao_n3"),
        gte(schema.aprovacao.criadoEm, diasAtras(dias)),
      ),
    )
    .orderBy(desc(schema.aprovacao.criadoEm))
    .limit(50);

  const [visitas] = await db
    .select({ quantos: count() })
    .from(schema.agenda)
    .where(gte(schema.agenda.inicio, diasAtras(dias)));

  return {
    janelaDias: dias,
    novos: novos?.quantos ?? 0,
    porCanal,
    ofertas,
    visitas: visitas?.quantos ?? 0,
    escalacoes: escalacoes.length,
    motivosDeEscalacao: escalacoes
      .map((e) => (e.contexto as { motivo?: string } | null)?.motivo)
      .filter(Boolean),
  };
}

/** Quem responde e quem deixa vencer. Sai do registro, não da impressão. */
export async function equipe(dias = 30) {
  const linhas = await db
    .select({
      idCorretor: schema.corretor.idCorretor,
      nome: schema.corretor.nome,
      ativo: schema.corretor.ativo,
      estado: schema.aprovacao.estado,
      quantos: count(schema.aprovacao.id),
    })
    .from(schema.corretor)
    .leftJoin(
      schema.aprovacao,
      and(
        eq(schema.aprovacao.destinatario, schema.corretor.idCorretor),
        eq(schema.aprovacao.tipo, "aceite_corretor"),
        gte(schema.aprovacao.criadoEm, diasAtras(dias)),
      ),
    )
    .groupBy(
      schema.corretor.idCorretor,
      schema.corretor.nome,
      schema.corretor.ativo,
      schema.aprovacao.estado,
    );

  const porCorretor = new Map<
    string,
    { nome: string; ativo: boolean; aceitas: number; recusadas: number; expiradas: number; abertas: number }
  >();

  for (const l of linhas) {
    const atual =
      porCorretor.get(l.idCorretor) ??
      { nome: l.nome, ativo: l.ativo, aceitas: 0, recusadas: 0, expiradas: 0, abertas: 0 };
    if (l.estado === "aprovado") atual.aceitas += l.quantos;
    if (l.estado === "negado") atual.recusadas += l.quantos;
    if (l.estado === "expirado") atual.expiradas += l.quantos;
    if (l.estado === "pendente") atual.abertas += l.quantos;
    porCorretor.set(l.idCorretor, atual);
  }

  const dominios = await db
    .select({ idCorretor: schema.dominioCorretor.idCorretor, quantos: count() })
    .from(schema.dominioCorretor)
    .groupBy(schema.dominioCorretor.idCorretor);

  return {
    janelaDias: dias,
    corretores: [...porCorretor.entries()].map(([idCorretor, v]) => ({
      idCorretor,
      ...v,
      imoveisQueConhece: dominios.find((d) => d.idCorretor === idCorretor)?.quantos ?? 0,
    })),
  };
}

/** A ficha de um imóvel e por que ele está como está. */
export async function imovel(idImovel: string) {
  const [ficha] = await db
    .select()
    .from(schema.imovel)
    .where(eq(schema.imovel.idImovel, idImovel));
  if (!ficha) return null;

  const anuncios = await db
    .select()
    .from(schema.anuncio)
    .where(eq(schema.anuncio.idImovel, idImovel));

  const historico = await db
    .select({
      campo: schema.logEvento.campo,
      de: schema.logEvento.valorAnterior,
      para: schema.logEvento.valorNovo,
      quem: schema.logEvento.agenteOrigem,
      aprovadoPor: schema.logEvento.aprovadoPor,
      quando: schema.logEvento.timestamp,
    })
    .from(schema.logEvento)
    .where(eq(schema.logEvento.idEntidade, idImovel))
    .orderBy(desc(schema.logEvento.timestamp))
    .limit(60);

  const laudos = await db
    .select()
    .from(schema.laudo)
    .where(eq(schema.laudo.idImovel, idImovel))
    .orderBy(desc(schema.laudo.data))
    .limit(5);

  return { ficha, anuncios, historico, laudos };
}

/** Busca por endereço ou bairro, pra resolver "aquele imóvel do Centro". */
export async function acharImovel(termo: string) {
  return db
    .select({
      idImovel: schema.imovel.idImovel,
      endereco: schema.imovel.endereco,
      bairro: schema.imovel.bairro,
    })
    .from(schema.imovel)
    .where(
      sql`${schema.imovel.endereco} ILIKE ${"%" + termo + "%"} OR ${schema.imovel.bairro} ILIKE ${"%" + termo + "%"}`,
    )
    .limit(10);
}
