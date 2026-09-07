import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq } from "drizzle-orm";
import { pool } from "@/lib/db";
import { nota, type NotaRow } from "./schema";
import { paraAgente } from "./vigentes";

/**
 * O acesso ao cérebro, e nada além do cérebro.
 *
 * Este cliente Drizzle conhece **uma tabela**: `cerebro.nota`. Compartilha a
 * conexão com o resto do sistema (Neon cobra por conexão, e abrir um pool só
 * pra isso seria pagar por teatro), mas não compartilha o schema: não existe
 * daqui uma expressão que escreva em imóvel, cliente ou contrato — o cliente
 * nem sabe que essas tabelas existem.
 *
 * É a mesma ideia da conexão só-leitura do Agente 5: a garantia é estrutural,
 * não é lembrete em comentário.
 */
const cdb = drizzle(pool, { schema: { nota } });

export const todasAsNotas = (): Promise<NotaRow[]> =>
  cdb.select().from(nota).orderBy(desc(nota.criadaEm));

/** As notas que valem para um agente agora. Nunca lança: cérebro fora do ar
 *  significa agente sem dica, não agente parado. */
export async function notasDoAgente(agente: string, chaves: string[] = []) {
  try {
    return paraAgente(await todasAsNotas(), agente, chaves);
  } catch (e) {
    console.warn("[cerebro] notas não carregadas:", e);
    return [];
  }
}

/** Uma nota nova. Sempre nasce rascunho — proposta não influencia ninguém. */
export const escrever = (n: {
  escopo: string;
  chave?: string;
  texto: string;
  autor: string;
  evidencia?: unknown;
}) =>
  cdb
    .insert(nota)
    .values({
      escopo: n.escopo,
      chave: n.chave ?? "",
      texto: n.texto,
      autor: n.autor,
      evidencia: n.evidencia ?? null,
      estado: "rascunho",
    })
    .returning();

/**
 * As quatro ações humanas, e todas são a mesma escrita: **uma versão nova**.
 *
 * Não existe UPDATE nem DELETE neste arquivo, e é de propósito. Corrigir,
 * confirmar, fixar e desativar inserem linha apontando pra anterior — o que
 * estava escrito antes continua legível, com data e autor, como averbação de
 * matrícula. É o que permite entregar o botão de editar pra equipe sem medo.
 */
export async function versionar(
  id: string,
  mudanca: {
    estado: "rascunho" | "confirmada" | "fixada" | "desativada";
    texto?: string;
    motivo?: string;
    autor: string;
  },
) {
  const [anterior] = await cdb.select().from(nota).where(eq(nota.id, id)).limit(1);
  if (!anterior) throw new Error(`nota ${id} não existe`);

  // Já substituída: versionar a partir de uma versão velha reescreveria a
  // história em vez de continuá-la.
  const [jaSubstituida] = await cdb
    .select({ id: nota.id })
    .from(nota)
    .where(eq(nota.substitui, id))
    .limit(1);
  if (jaSubstituida) throw new Error(`nota ${id} já tem versão mais nova`);

  return cdb
    .insert(nota)
    .values({
      escopo: anterior.escopo,
      chave: anterior.chave,
      texto: mudanca.texto ?? anterior.texto,
      evidencia: anterior.evidencia,
      estado: mudanca.estado,
      autor: mudanca.autor,
      motivo: mudanca.motivo ?? null,
      substitui: id,
    })
    .returning();
}

/** Só as versões vivas de um escopo, pra tela. */
export const notasDoEscopo = (escopo: string, chave = "") =>
  cdb
    .select()
    .from(nota)
    .where(and(eq(nota.escopo, escopo), eq(nota.chave, chave)))
    .orderBy(desc(nota.criadaEm));
