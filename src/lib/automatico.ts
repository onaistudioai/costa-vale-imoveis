import { and, desc, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { declaracaoDe, type Modo } from "@/regras/modo";

/**
 * O que o sistema fez sem ninguém mandar.
 *
 * A pergunta não tinha resposta até aqui. `/` mostra o que o sistema *quer*
 * fazer (a fila pendente) e o que gente decidiu; `/imovel/[id]` mostra o
 * histórico, mas exige saber o id antes — é forense sob demanda, não
 * descoberta. Faltava a lista do que aconteceu sozinho.
 *
 * Não precisou de tabela nova: `aprovadoPor` só é preenchido quando um humano
 * decidiu, e `agenteOrigem` diz quem escreveu. O par
 * `aprovado_por IS NULL AND agente_origem <> 'humano'` **já era**, no dado, o
 * marcador de "ninguém aprovou isto" — só não existia quem perguntasse.
 */

export interface LinhaAutomatica {
  id: string;
  agenteOrigem: string;
  entidade: string;
  idEntidade: string;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  timestamp: Date;
  modo: Modo | null;
  porque: string | null;
}

export async function feitoSozinho(limite = 200): Promise<LinhaAutomatica[]> {
  const linhas = await db
    .select()
    .from(schema.logEvento)
    .where(
      and(
        // Ninguém aprovou. É a definição inteira do que esta tela procura.
        isNull(schema.logEvento.aprovadoPor),
        ne(schema.logEvento.agenteOrigem, "humano"),
      ),
    )
    .orderBy(desc(schema.logEvento.timestamp))
    .limit(limite);

  return linhas.map((l) => {
    const d = declaracaoDe(l.campo);
    return {
      id: l.id,
      agenteOrigem: l.agenteOrigem,
      entidade: l.entidade,
      idEntidade: l.idEntidade,
      campo: l.campo,
      valorAnterior: l.valorAnterior,
      valorNovo: l.valorNovo,
      timestamp: l.timestamp,
      // Nulo significa campo sem modo declarado. Não deveria acontecer — o
      // teste em `modo.test.ts` barra — mas linha antiga no banco pode carregar
      // um campo que não existe mais no código, e a tela não pode sumir com ela.
      modo: d?.modo ?? null,
      porque: d?.porque ?? null,
    };
  });
}

/** Quantas linhas por modo, para os contadores do topo. */
export function contarPorModo(linhas: LinhaAutomatica[]): Record<string, number> {
  const conta: Record<string, number> = { hotl: 0, hootl: 0, indefinido: 0 };
  for (const l of linhas) conta[l.modo ?? "indefinido"] = (conta[l.modo ?? "indefinido"] ?? 0) + 1;
  return conta;
}

/**
 * O filtro que importa: o que roda sem ninguém revisando.
 *
 * É a lista curta que alguém precisa varrer de vez em quando. O resto é HOTL —
 * o sistema agiu, mas a ação tem dono e caminho de conferência.
 */
export const semRevisao = (linhas: LinhaAutomatica[]) => linhas.filter((l) => l.modo === "hootl");
