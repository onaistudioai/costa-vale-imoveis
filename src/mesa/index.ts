import { z } from "zod";
import { passaPelaMesa, type Faixa } from "@/regras/faixa";

/**
 * A mesa — a camada do meio entre "o agente resolveu" e "incomoda uma pessoa".
 *
 * Existe porque o sistema roteava de forma binária: ou o agente sabia, ou ele
 * desistia e jogava o caso na fila. A mesa é a tentativa de resolver antes de
 * interromper alguém, e só acontece na faixa amarela (`src/regras/faixa.ts`).
 *
 * **Quem roda a mesa é o CrewAI, num serviço Python** (`servicos/mesa/`). Este
 * arquivo é o lado de cá do fio:
 *
 *   agente ──revisarSePreciso──► POST {MESA_URL}/mesa ──► FastAPI + Pydantic
 *                                                            └─► Crew.kickoff()
 *   agente ◄── Zod valida de novo ◄── JSON ◄─────────────────────┘
 *
 * **A mesa não escreve.** Antes a garantia era a assinatura (sem
 * `AgenteContexto`, sem `escrever`). Agora também é física: o serviço Python
 * não recebe `DATABASE_URL`.
 *
 * A mesa também não é um agente do grafo: não tem evento, nó nem aresta. Roda
 * por dentro do agente que já ia escalar, antes do `pedirAprovacao`. É o que
 * mantém R1 (um evento, um agente) e R4 (agente não fala com agente).
 */

const Recomendacao = z.enum(["aprovar", "negar", "precisa_humano"]);

/**
 * O contrato da resposta. O mesmo formato existe em Pydantic
 * (`servicos/mesa/mesa/modelos.py`), e `contrato.test.ts` quebra se os dois
 * se afastarem.
 */
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

export interface Caso {
  /** O que está em jogo, em uma frase. Vira o título do caso. */
  assunto: string;
  /** Os fatos que o agente já levantou. Texto, nunca objeto cru do banco. */
  fatos: string;
}

/**
 * Três chamadas de modelo e o CrewAI por cima levam de 5 a 20 segundos.
 * Passou disso, o pedido segue sem proposta — a mesa é ajuda, não portão.
 */
const PRAZO_MS = 30_000;

/**
 * Pede a revisão ao serviço.
 *
 * A resposta passa pelo Zod mesmo tendo saído validada do Pydantic: o que
 * chega pela rede pode ser outra versão do serviço, um proxy devolvendo HTML,
 * qualquer coisa. Confiar no outro lado do fio é o mesmo erro que confiar no
 * modelo.
 */
export async function reunir(caso: Caso, url: string): Promise<Consolidado> {
  const resposta = await fetch(`${url.replace(/\/$/, "")}/mesa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assunto: caso.assunto, fatos: caso.fatos }),
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  if (!resposta.ok) throw new Error(`serviço da mesa respondeu ${resposta.status}`);
  return Consolidado.parse(await resposta.json());
}

/**
 * O envelope que os agentes chamam. É ele que faz a faixa mandar na mesa.
 *
 * Fica aqui e não em cada agente por segurança, não estilo: se cada um
 * decidisse quando reunir a mesa, bastaria um esquecer o `if` para um caso
 * vermelho chegar ao painel com uma sugestão que ninguém deveria ter produzido.
 *
 * `MESA_URL` vazio desliga a mesa — o mesmo "VAZIO = nada sai" dos canais.
 * Falha devolve `undefined`, nunca derruba o agente: sem proposta o pedido vai
 * pro painel exatamente como ia antes da mesa existir.
 */
export async function revisarSePreciso(
  faixa: Faixa,
  caso: Caso,
): Promise<Consolidado | undefined> {
  if (!passaPelaMesa(faixa)) return undefined;
  const url = process.env.MESA_URL;
  if (!url) return undefined;
  try {
    return await reunir(caso, url);
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
