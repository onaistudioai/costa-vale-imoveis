import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { retomar } from "@/grafo/runtime";
import { normalizar } from "@/lib/canal";
import { decifrar } from "@/lib/cripto";

/**
 * O aceite de uma oferta de lead, num lugar só.
 *
 * Existe porque agora há duas portas para a mesma decisão: o botão do painel e
 * a resposta do corretor no WhatsApp. Duas cópias da mesma lógica dariam dois
 * comportamentos — e o dia em que divergissem seria o dia em que o lead ficaria
 * com dois donos ou nenhum.
 */

/** O corretor dono deste número, se houver. Compara só dígitos, com DDI. */
export async function corretorPorTelefone(identificador: string) {
  const alvo = normalizar(identificador);
  const todos = await db
    .select({ id: schema.corretor.idCorretor, nome: schema.corretor.nome, tel: schema.corretor.telefone })
    .from(schema.corretor)
    .where(eq(schema.corretor.ativo, true));

  // O telefone está cifrado, então a comparação acontece depois de decifrar.
  // A varredura já era em memória antes disso: a lista de corretores ativos de
  // uma imobiliária cabe folgado na resposta de uma consulta.
  return todos.find((c) => {
    const tel = decifrar(c.tel);
    return tel && normalizar(tel) === alvo;
  }) ?? null;
}

/** A oferta que este corretor tem em aberto agora, se houver. */
export async function ofertaAbertaDe(idCorretor: string, agora = new Date()) {
  const [o] = await db
    .select()
    .from(schema.aprovacao)
    .where(
      and(
        eq(schema.aprovacao.tipo, "aceite_corretor"),
        eq(schema.aprovacao.estado, "pendente"),
        eq(schema.aprovacao.destinatario, idCorretor),
        isNotNull(schema.aprovacao.expiraEm),
        gt(schema.aprovacao.expiraEm, agora),
      ),
    )
    .orderBy(desc(schema.aprovacao.criadoEm))
    .limit(1);

  return o ?? null;
}

export type Desfecho = "aceita" | "recusada" | "tarde_demais";

/**
 * Fecha a oferta e devolve o grafo ao ponto em que ele parou.
 *
 * `tarde_demais` não é erro: chegar depois é o caso comum aqui — o prazo é de
 * cinco minutos e o corretor está na rua. A primeira resposta vale.
 */
export async function decidirOferta(
  idOferta: string,
  aceito: boolean,
  por: string,
  motivo?: string,
): Promise<Desfecho> {
  const [oferta] = await db
    .select()
    .from(schema.aprovacao)
    .where(eq(schema.aprovacao.id, idOferta));

  if (!oferta) throw new Error("oferta não encontrada");
  if (oferta.estado !== "pendente") return "tarde_demais";

  await db
    .update(schema.aprovacao)
    .set({
      estado: aceito ? "aprovado" : "negado",
      decididoPor: por,
      decididoEm: new Date(),
      motivo: aceito ? null : (motivo ?? "passou a vez"),
    })
    .where(eq(schema.aprovacao.id, idOferta));

  if (oferta.threadId) {
    await retomar(oferta.threadId, {
      aprovado: aceito,
      por,
      motivo: aceito ? undefined : "recusou",
    });
  }

  return aceito ? "aceita" : "recusada";
}
