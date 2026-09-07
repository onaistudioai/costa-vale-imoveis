import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RegistrarLeitura } from "@/agentes/procedencia";

/**
 * A gravação da procedência, sobre Drizzle.
 *
 * Separado de `contexto-db.ts` porque não é escrita de agente: nenhuma linha
 * daqui muda dado da empresa, e nenhuma passa pela R5. É auditoria — por isso
 * também não entra em transação com o resto.
 */
export const registrarLeitura: RegistrarLeitura = async (l) => {
  await db.insert(schema.leituraModelo).values({
    agente: l.agente,
    tarefa: l.tarefa,
    modelo: l.modelo,
    promptHash: l.promptHash,
    entrada: l.entrada,
    entradaHash: l.entradaHash,
    saida: l.saida ?? null,
    ms: l.ms,
    erro: l.erro,
    idEvento: l.idEvento,
  });
};

/**
 * O resumo por versão de prompt — a base da Onda 2 (aferição).
 *
 * Ainda não diz se o modelo acertou; diz quantas vezes cada versão rodou,
 * quanto demorou e quantas falharam. Acerto exige rótulo, e rótulo vem da
 * correção humana no painel.
 */
export async function leiturasPorVersao(limite = 50) {
  const t = schema.leituraModelo;
  return db
    .select({
      agente: t.agente,
      modelo: t.modelo,
      promptHash: t.promptHash,
      chamadas: sql<number>`count(*)::int`,
      falhas: sql<number>`count(*) filter (where ${t.erro} is not null)::int`,
      msMediano: sql<number>`percentile_disc(0.5) within group (order by ${t.ms})::int`,
      ultima: sql<Date>`max(${t.criadoEm})`,
    })
    .from(t)
    .groupBy(t.agente, t.modelo, t.promptHash)
    .orderBy(desc(sql`max(${t.criadoEm})`))
    .limit(limite);
}

/** As leituras de um evento, pra tela "por que esse anúncio caiu?". */
export const leiturasDoEvento = (idEvento: string) =>
  db
    .select()
    .from(schema.leituraModelo)
    .where(eq(schema.leituraModelo.idEvento, idEvento))
    .orderBy(schema.leituraModelo.criadoEm);
