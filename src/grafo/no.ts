import type { Agente } from "@/tipos";
import type { AgenteContexto, Escrita, PedidoAprovacao } from "@/agentes/contrato";
import type { Extrator } from "@/agentes/modelo";

/**
 * R7 — o nó que interrompe não tem efeito colateral antes do `interrupt()`.
 *
 * A defesa estrutural mora aqui. O agente continua escrito como uma função
 * linear que chama `pedirAprovacao` no meio — mas dentro do grafo esse pedido
 * não interrompe nada: ele registra a linha pendente e ABORTA o nó com um
 * sinal. Quem interrompe é um nó de gate separado, com `interrupt()` na
 * primeira linha. O nó do agente então re-executa com a decisão em mãos.
 *
 * A re-execução é o preço da R7, e é por isso que existe o `memo`: extração de
 * modelo e decisão humana ficam guardadas no estado do grafo, então a segunda
 * passada não chama LLM nem duplica pedido. O que resta de repetido são
 * `UPDATE`s com o mesmo valor e `INSERT`s idempotentes.
 */

export type Decisao = { aprovado: boolean; por: string; motivo?: string };

/** Sinal de controle, não erro: o nó precisa de gente antes de continuar. */
export class PedidoPendente extends Error {
  constructor(
    readonly chave: string,
    readonly pedido: PedidoAprovacao,
  ) {
    super(`pedido pendente: ${chave}`);
    this.name = "PedidoPendente";
  }
}

/** Mesma chave da unique de `aprovacao`: um pedido por (evento, tipo, entidade). */
export const chaveDoPedido = (p: PedidoAprovacao) => `${p.tipo}:${p.idEntidade}`;

export interface IoDoNo {
  escrever(agente: Agente, idEvento: string, e: Escrita<Agente>): Promise<void>;
  /** Insere a linha pendente da fila do painel. Idempotente por chave. */
  registrarPedido(
    agente: Agente,
    idEvento: string,
    threadId: string,
    p: PedidoAprovacao,
  ): Promise<void>;
  avisar(agente: Agente, mensagem: string): Promise<void>;
}

export function contextoDoNo<A extends Agente>(
  agente: A,
  idEvento: string,
  threadId: string,
  memo: Record<string, unknown>,
  io: IoDoNo,
): AgenteContexto<A> {
  return {
    agente,
    idEvento,
    escrever: (e) => io.escrever(agente, idEvento, e as Escrita<Agente>),
    avisar: (m) => io.avisar(agente, m),

    async pedirAprovacao(p) {
      const chave = chaveDoPedido(p);
      const decidida = memo[chave] as Decisao | undefined;
      if (decidida) return decidida;

      // A linha da fila entra ANTES da pausa — o painel precisa enxergar o
      // pedido enquanto o grafo espera. É idempotente, então a re-execução do
      // nó não vira uma segunda linha.
      await io.registrarPedido(agente, idEvento, threadId, p);
      throw new PedidoPendente(chave, p);
    },
  };
}

/**
 * Extrator que só chama o modelo uma vez por evento. Sem isto a re-execução
 * exigida pela R7 cobraria a chamada de LLM duas vezes.
 */
export function extratorMemoizado(
  base: Extrator,
  memo: Record<string, unknown>,
  prefixo: string,
  novos: Record<string, unknown>,
): Extrator {
  let n = 0;
  return (async (args: Parameters<Extrator>[0]) => {
    const chave = `${prefixo}#${n++}`;
    if (chave in memo) return memo[chave];
    if (chave in novos) return novos[chave];
    const valor = await base(args);
    novos[chave] = valor;
    return valor;
  }) as Extrator;
}

export type Pausa = { chave: string; agente: Agente; pedido: PedidoAprovacao };

/** Roda o corpo do agente e traduz o sinal de pausa em atualização de estado. */
export async function executarAgente<T>(
  fn: () => Promise<T>,
): Promise<{ valor: T; pausa: null } | { valor: null; pausa: PedidoPendente }> {
  try {
    return { valor: await fn(), pausa: null };
  } catch (e) {
    if (e instanceof PedidoPendente) return { valor: null, pausa: e };
    throw e;
  }
}
