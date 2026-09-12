import { z } from "zod";
import type { Extrator } from "@/agentes/modelo";
import { passaPelaMesa, type Faixa } from "@/regras/faixa";

/**
 * A mesa — a camada do meio entre "o agente resolveu" e "incomoda uma pessoa".
 *
 * Existe porque o sistema roteava de forma binária: ou o agente sabia, ou ele
 * desistia e jogava o caso na fila. Ninguém tentava resolver antes de
 * interromper alguém. A mesa é essa tentativa, e só acontece na faixa amarela
 * (`src/regras/faixa.ts`) — caso reversível, barato e bem lido, onde o que
 * trava é ambiguidade e não risco.
 *
 * **A mesa não escreve.** A garantia não é comentário, é a assinatura: `reunir`
 * recebe texto e um extrator, e nunca um `AgenteContexto`. Sem contexto não há
 * `escrever`, então não existe caminho de código que a faça mexer no banco —
 * mesma ideia do `never` do Agente 6 em `src/agentes/contrato.ts`.
 *
 * A mesa também não é um agente do grafo: não tem evento que a acorde, não tem
 * nó, não tem aresta. Ela roda por dentro do agente que já ia escalar, antes do
 * `pedirAprovacao`. Isso é o que mantém R1 (um evento, um agente) e R4 (agente
 * não fala com agente) intactos.
 */

const Recomendacao = z.enum(["aprovar", "negar", "precisa_humano"]);

const Olhar = z.object({
  leitura: z.string().describe("o que você entendeu do caso, em uma frase"),
  preocupacao: z
    .string()
    .describe("o que pode dar errado se a decisão for tomada às pressas"),
  recomendacao: Recomendacao,
});

export const Consolidado = z.object({
  recomendacao: Recomendacao,
  justificativa: z
    .string()
    .describe("por que, em uma ou duas frases, para quem vai decidir"),
  convergiu: z
    .boolean()
    .describe("true só se os dois olhares apontam para o mesmo lado"),
  ressalva: z
    .string()
    .nullable()
    .describe("o que ficou em aberto; null se não ficou nada"),
});

export type Consolidado = z.infer<typeof Consolidado>;

/**
 * Os papéis. Dois, e não seis: cada papel é uma chamada de modelo, e a mesa
 * roda no caminho de um atendimento. Dois olhares em tensão real — quem teme o
 * prejuízo e quem teme a paralisia — já produzem o desacordo que interessa.
 * Papel a mais que concorda com os outros custa dinheiro e não informa nada.
 */
const PAPEIS = [
  {
    nome: "cauteloso",
    sistema: `Você é o sócio conservador de uma imobiliária. Sua preocupação é prejuízo e retrabalho: dinheiro gasto à toa, imóvel anunciado errado, cliente mal informado.
Você lê o caso e diz o que pode dar errado. Não é seu papel achar solução bonita — é apontar o custo de errar.
Se faltar informação para decidir com segurança, sua recomendação é "precisa_humano". Não invente dado que não está no caso.`,
  },
  {
    nome: "operador",
    sistema: `Você é o corretor mais experiente da casa, com 20 anos de rua. Sua preocupação é o negócio andar: lead que esfria, cliente que desiste de esperar, processo travado por excesso de conferência.
Você lê o caso e diz o que costuma acontecer na prática, e qual é o caminho normal.
Se o caso for mesmo fora do comum, sua recomendação é "precisa_humano". Não invente dado que não está no caso.`,
  },
] as const;

const SUPERVISOR = `Você é o gerente que recebe dois pareceres sobre o mesmo caso e prepara o resumo para quem vai decidir.

Regras, e elas mandam mais que os pareceres:
- Você NÃO decide. Você prepara uma sugestão para uma pessoa conferir.
- Se os dois pareceres divergem, "convergiu" é false e a recomendação é "precisa_humano". Divergência não se resolve escolhendo o parecer mais bonito.
- Se qualquer parecer disse "precisa_humano", a recomendação final é "precisa_humano".
- Nunca afirme número, prazo ou nome que não esteja nos pareceres.
- Escreva para uma pessoa apressada: uma ou duas frases, em português do Brasil, sem jargão.`;

export interface Caso {
  /** O que está em jogo, em uma frase. Vira o título do caso. */
  assunto: string;
  /** Os fatos que o agente já levantou. Texto, nunca objeto cru do banco. */
  fatos: string;
}

/**
 * Junta a mesa e devolve a proposta.
 *
 * Os olhares rodam em paralelo porque são independentes — um não lê o outro, e
 * é isso que os mantém diferentes. Se rodassem em sequência com o anterior no
 * prompt, o segundo concordaria com o primeiro e a mesa viraria teatro.
 */
export async function reunir(caso: Caso, extrair: Extrator): Promise<Consolidado> {
  const entrada = `CASO: ${caso.assunto}\n\nFATOS APURADOS:\n${caso.fatos}`;

  const olhares = await Promise.all(
    PAPEIS.map(async (p) => {
      const o = await extrair({ schema: Olhar, sistema: p.sistema, entrada });
      return { papel: p.nome, ...o };
    }),
  );

  const pareceres = olhares
    .map(
      (o) =>
        `PARECER DO ${o.papel.toUpperCase()}:\n- Leitura: ${o.leitura}\n- Preocupação: ${o.preocupacao}\n- Recomendação: ${o.recomendacao}`,
    )
    .join("\n\n");

  const consolidado = await extrair({
    schema: Consolidado,
    sistema: SUPERVISOR,
    entrada: `${entrada}\n\n${pareceres}`,
  });

  // A regra de divergência é código, não prompt. O supervisor é instruído a
  // respeitá-la, mas instrução em prompt é pedido — e o caso em que ela mais
  // importa é justamente o caso ambíguo, onde o modelo é menos confiável.
  const divergiu = new Set(olhares.map((o) => o.recomendacao)).size > 1;
  const algumPediuHumano = olhares.some((o) => o.recomendacao === "precisa_humano");

  if (divergiu || algumPediuHumano) {
    return {
      ...consolidado,
      recomendacao: "precisa_humano",
      convergiu: false,
      ressalva:
        consolidado.ressalva ??
        (divergiu
          ? "Os dois pareceres discordaram entre si."
          : "Um dos pareceres pediu olhar humano."),
    };
  }

  return { ...consolidado, convergiu: true };
}

/**
 * O envelope que os agentes chamam. É ele que faz a faixa mandar na mesa.
 *
 * Fica aqui e não em cada agente por um motivo de segurança, não de estilo: se
 * cada um decidisse sozinho quando reunir a mesa, bastaria um esquecer o `if`
 * para um caso vermelho começar a gastar três chamadas de modelo — e, pior,
 * chegar ao painel com uma sugestão que ninguém deveria ter produzido.
 *
 * Falha da mesa devolve `undefined`, nunca derruba o agente: sem proposta o
 * pedido continua indo pro painel exatamente como ia antes dela existir.
 */
export async function revisarSePreciso(
  faixa: Faixa,
  extrair: Extrator,
  caso: Caso,
): Promise<Consolidado | undefined> {
  if (!passaPelaMesa(faixa)) return undefined;
  try {
    return await reunir(caso, extrair);
  } catch (e) {
    console.warn("[mesa] revisão falhou, seguindo sem proposta:", (e as Error).message);
    return undefined;
  }
}

/** O texto que aparece no painel. Sem isto, a proposta é JSON na tela. */
export function frase(c: Consolidado): string {
  const verbo = {
    aprovar: "Parece caso de aprovar",
    negar: "Parece caso de negar",
    precisa_humano: "Precisa do seu olhar",
  }[c.recomendacao];
  return c.convergiu ? verbo : `${verbo} (a revisão não fechou)`;
}
