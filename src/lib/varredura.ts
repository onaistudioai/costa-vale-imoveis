import { and, eq, isNotNull, isNull, lte, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { entregar } from "@/agentes/contexto-db";
import { retomar } from "@/grafo/runtime";
import { reavaliarAtendimentos, varrerEscrituras, varrerLocacao } from "@/lib/ciclos";

/**
 * A varredura de prazo.
 *
 * É a peça que faz o silêncio virar decisão. O corretor que não responde não
 * bloqueia o lead: passado `expira_em`, o pedido é marcado `expirado` e a
 * thread do grafo é retomada com uma negativa — o Agente 3 então oferece pro
 * próximo colocado sozinho.
 *
 * Sem isto, "push com aceite" seria pior que o push direto: o lead ficaria
 * preso esperando alguém que talvez esteja dirigindo.
 *
 * Ela também é o carteiro das ofertas adiadas: o que foi registrado fora do
 * expediente sai na primeira passagem depois que o expediente abre.
 *
 * ponytail: roda por chamada (`npm run varredura`, ou o cron do VPS batendo em
 * `/api/varredura`). Vira agendador interno só se um dia não houver cron.
 */
export async function varrerPrazos(agora = new Date()) {
  const entregues = await entregarPendentes(agora);

  const vencidos = await db
    .select()
    .from(schema.aprovacao)
    .where(
      and(
        eq(schema.aprovacao.estado, "pendente"),
        isNotNull(schema.aprovacao.expiraEm),
        lt(schema.aprovacao.expiraEm, agora),
      ),
    );

  const expirados: string[] = [];

  for (const p of vencidos) {
    // Fecha o registro ANTES de retomar, pela mesma razão do painel: se o
    // grafo falhar ao voltar, a expiração não se perde e a retomada pode ser
    // repetida.
    await db
      .update(schema.aprovacao)
      .set({ estado: "expirado", decididoEm: agora, motivo: "prazo esgotado" })
      .where(eq(schema.aprovacao.id, p.id));

    await db.insert(schema.logEvento).values({
      agenteOrigem: "regra",
      entidade: p.entidade,
      idEntidade: p.idEntidade,
      campo: `expirou.${p.tipo}`,
      valorAnterior: "pendente",
      valorNovo: "expirado",
      idEvento: p.idEvento,
    });

    if (p.threadId) {
      await retomar(p.threadId, {
        aprovado: false,
        por: "prazo",
        motivo: "nao_respondeu_no_prazo",
      });
    }

    expirados.push(p.id);
  }

  // Os três ciclos do tempo rodam depois dos prazos: expirar oferta é o que
  // não pode atrasar um minuto; aluguel e cartório aguentam a mesma passada.
  const funil = await reavaliarAtendimentos(agora);
  const locacao = await varrerLocacao(agora);
  const escrituras = await varrerEscrituras(agora);

  return {
    entregues,
    expirados: expirados.length,
    ids: expirados,
    funil,
    locacao,
    escrituras,
  };
}

/**
 * Ofertas que ficaram guardadas esperando o expediente. Sai primeiro na
 * varredura: entregar antes de expirar evita o absurdo de vencer o prazo de
 * uma mensagem que nunca foi mandada.
 */
async function entregarPendentes(agora: Date): Promise<number> {
  const aguardando = await db
    .select()
    .from(schema.aprovacao)
    .where(
      and(
        eq(schema.aprovacao.estado, "pendente"),
        isNull(schema.aprovacao.enviadoEm),
        isNotNull(schema.aprovacao.enviarEm),
        lte(schema.aprovacao.enviarEm, agora),
        isNotNull(schema.aprovacao.destinatario),
      ),
    );

  for (const p of aguardando) {
    const mensagem = (p.contexto as { mensagem?: string } | null)?.mensagem;
    if (!mensagem) continue;
    await entregar(p.id, p.destinatario!, mensagem);
  }

  return aguardando.length;
}
