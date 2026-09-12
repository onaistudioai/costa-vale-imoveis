import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CAMPOS_EDITAVEIS, type Alteracao } from "@/regras/alteracao";
import type { Candidato, PortasAlterador } from "@/agentes/alterador";
import { cifrar, decifrar, indice } from "@/lib/cripto";

/**
 * As portas do Agente 6 sobre o banco.
 *
 * A busca é **determinística de propósito**. Poderia ser embedding e "o que
 * mais se parece", mas encontrar o registro errado com alta similaridade é
 * exatamente o modo de falha que este agente inteiro existe pra evitar. Aqui,
 * se o termo não bate, ninguém é devolvido — e não achar é um desfecho
 * honesto, ao contrário de achar o vizinho.
 */

/** Quebra "apartamento do Campolim" em palavras que valem busca. */
function termos(texto: string): string[] {
  const vazias = new Set([
    "o", "a", "os", "as", "de", "do", "da", "dos", "das", "no", "na", "em",
    "um", "uma", "com", "para", "pra", "que", "e",
  ]);
  return texto
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^\wáàâãéêíóôõúç.-]/gi, ""))
    .filter((t) => t.length >= 3 && !vazias.has(t));
}

export const portasAlteradorDb: PortasAlterador = {
  async procurar(entidade, termo, campo) {
    const palavras = termos(termo);
    if (palavras.length === 0) return [];

    if (entidade === "cliente") {
      const linhas = await db
        .select()
        .from(schema.cliente)
        .where(
          or(...palavras.map((p) => ilike(schema.cliente.nome, `%${p}%`))),
        )
        .limit(6);

      return linhas.map(
        (c): Candidato => ({
          id: c.idCliente,
          // Decifrar aqui, na borda: o rótulo é o que a pessoa lê pra saber
          // qual dos três "Ana Silva" ela está prestes a alterar.
          rotulo: (() => {
            const tel = decifrar(c.telefone);
            return `${c.nome}${tel ? ` — ${tel}` : ""}`;
          })(),
          valorAtual: valorDoCliente(c, campo),
        }),
      );
    }

    const linhas = await db
      .select()
      .from(schema.imovel)
      .where(
        or(
          ...palavras.flatMap((p) => [
            ilike(schema.imovel.bairro, `%${p}%`),
            ilike(schema.imovel.endereco, `%${p}%`),
            ilike(schema.imovel.tipo, `%${p}%`),
          ]),
        ),
      )
      .limit(8);

    // Um termo como "apartamento do Campolim" casa por bairro E por tipo. Quem
    // bate em mais palavras é mais provável de ser o pedido — e se dois
    // empatam no topo, os dois voltam e o agente pergunta.
    const pontuado = linhas
      .map((i) => {
        const alvo = `${i.tipo} ${i.endereco} ${i.bairro ?? ""}`.toLowerCase();
        return { i, pontos: palavras.filter((p) => alvo.includes(p)).length };
      })
      .sort((a, b) => b.pontos - a.pontos);

    const melhor = pontuado[0]?.pontos ?? 0;
    const finalistas = pontuado.filter((p) => p.pontos === melhor);

    return finalistas.map(
      ({ i }): Candidato => ({
        id: i.idImovel,
        rotulo: `${i.tipo} — ${i.endereco}${i.bairro ? `, ${i.bairro}` : ""}`,
        valorAtual: valorDoImovel(i, campo),
        anuncioNoAr: i.estadoAnuncio === "no_ar",
        emNegociacao:
          i.estadoComercial === "em_negociacao" || i.estadoComercial === "em_processo_venda",
      }),
    );
  },

  async aplicar(a: Alteracao, por: string, idEvento: string) {
    const def = CAMPOS_EDITAVEIS[a.campo];
    if (!def) throw new Error(`campo não editável: ${a.campo}`);

    if (a.entidade === "imovel") {
      await db
        .update(schema.imovel)
        .set({ [a.campo]: a.valorNovo })
        .where(eq(schema.imovel.idImovel, a.idEntidade));
    } else {
      // Telefone e e-mail vão cifrados; o e-mail leva junto o índice cego,
      // senão a aproximação de identidade para de achar quem já existe.
      const valor = ehPii(a.campo) ? cifrar(a.valorNovo) : a.valorNovo;
      await db
        .update(schema.cliente)
        .set({
          [a.campo]: valor,
          ...(a.campo === "email"
            ? { emailIndice: a.valorNovo ? indice(a.valorNovo) : null }
            : {}),
        })
        .where(eq(schema.cliente.idCliente, a.idEntidade));
    }

    // `agenteOrigem: "humano"` não é detalhe de auditoria: é a verdade. Quem
    // decidiu foi a pessoa que leu o "de → para" e clicou. O agente só
    // traduziu a frase.
    await db
      .insert(schema.logEvento)
      .values({
        agenteOrigem: "humano",
        entidade: a.entidade,
        idEntidade: a.idEntidade,
        campo: `${a.entidade}.${a.campo}`,
        // A trilha guarda "de → para" cifrado quando o campo é PII. Um log com
        // o telefone em claro devolveria, num dump, exatamente o que a coluna
        // cifrada esconde — a auditoria não pode ser a porta dos fundos.
        valorAnterior: ehPii(a.campo) ? cifrar(a.valorAnterior) : a.valorAnterior,
        valorNovo: ehPii(a.campo) ? cifrar(a.valorNovo) : a.valorNovo,
        aprovadoPor: por,
        idEvento,
      })
      .onConflictDoNothing({
        target: [schema.logEvento.idEvento, schema.logEvento.campo, schema.logEvento.idEntidade],
      });
  },
};

function valorDoImovel(i: typeof schema.imovel.$inferSelect, campo: string): string | null {
  switch (campo) {
    case "preco":
      return i.preco;
    case "endereco":
      return i.endereco;
    case "bairro":
      return i.bairro;
    case "tipo":
      return i.tipo;
    case "pontosReferencia":
      return i.pontosReferencia;
    default:
      return null;
  }
}

/** Os campos do cliente que moram cifrados. `nome` não é um deles: é o rótulo. */
const ehPii = (campo: string) => campo === "telefone" || campo === "email";

function valorDoCliente(c: typeof schema.cliente.$inferSelect, campo: string): string | null {
  switch (campo) {
    case "nome":
      return c.nome;
    case "telefone":
      return decifrar(c.telefone);
    case "email":
      return decifrar(c.email);
    default:
      return null;
  }
}

/** Quantos imóveis batem com um termo — usado pelo painel pra prever ambiguidade. */
export async function contarCandidatos(termo: string): Promise<number> {
  const [linha] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.imovel)
    .where(
      and(
        or(...termos(termo).map((p) => ilike(schema.imovel.bairro, `%${p}%`))),
      ),
    );
  return linha?.n ?? 0;
}
