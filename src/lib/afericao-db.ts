import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * O rótulo que a equipe já escreve sem saber.
 *
 * Todo caso de referência custa alguém sentar e escrever o laudo esperado. Mas
 * existe um conjunto de rótulos que já está no banco de graça: **quando alguém
 * nega um pedido no painel, essa negativa é uma correção.** O agente leu, a
 * regra decidiu, o pedido subiu — e uma pessoa disse não.
 *
 * A leitura de `expirado` é diferente de propósito: ninguém discordou, ninguém
 * respondeu. Isso é problema de processo, não de leitura, e contar como erro do
 * modelo seria culpar o agente pelo fim de semana da equipe.
 */
export async function concordanciaDoPainel(limite = 50) {
  const l = schema.leituraModelo;
  const a = schema.aprovacao;

  return db
    .select({
      agente: l.agente,
      modelo: l.modelo,
      promptHash: l.promptHash,
      tipo: a.tipo,
      decididos: sql<number>`count(*)::int`,
      aprovados: sql<number>`count(*) filter (where ${a.estado} = 'aprovado')::int`,
      negados: sql<number>`count(*) filter (where ${a.estado} = 'negado')::int`,
    })
    .from(l)
    .innerJoin(a, eq(a.idEvento, l.idEvento))
    .where(and(isNotNull(l.idEvento), sql`${a.estado} in ('aprovado','negado')`))
    .groupBy(l.agente, l.modelo, l.promptHash, a.tipo)
    .orderBy(sql`count(*) desc`)
    .limit(limite);
}

/**
 * As leituras que uma pessoa negou, com o texto que o agente leu.
 *
 * É a fila de onde saem os próximos casos de referência: cada linha aqui é um
 * caso que a realidade escreveu, e que ninguém precisou inventar.
 */
export async function negadasRecentes(limite = 20) {
  const l = schema.leituraModelo;
  const a = schema.aprovacao;

  return db
    .select({
      idLeitura: l.id,
      agente: l.agente,
      promptHash: l.promptHash,
      entrada: l.entrada,
      saida: l.saida,
      tipo: a.tipo,
      motivo: a.motivo,
      decididoPor: a.decididoPor,
      decididoEm: a.decididoEm,
    })
    .from(l)
    .innerJoin(a, eq(a.idEvento, l.idEvento))
    .where(eq(a.estado, "negado"))
    .orderBy(sql`${a.decididoEm} desc nulls last`)
    .limit(limite);
}
