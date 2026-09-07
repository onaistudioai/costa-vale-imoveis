import { Annotation } from "@langchain/langgraph";
import type { Evento } from "./eventos";
import type { Pausa } from "./no";
import type { MotivoEscalacao } from "@/tipos";
import type { Resultado as ResultadoAlteracao } from "@/agentes/alterador";

/**
 * O quadro compartilhado. É o único meio pelo qual os agentes se comunicam —
 * R4: handoff é aresta com payload tipado, nunca chamada direta.
 */
export const EstadoGrafo = Annotation.Root({
  evento: Annotation<Evento>,

  /** Preenchido pelo Agente 4 ao qualificar; lido pelo Agente 3 (handoff). */
  leadQualificado: Annotation<
    { idCliente: string; idImovel: string; resumo: string } | undefined
  >({ reducer: (_, b) => b, default: () => undefined }),

  /** Resultado do roteamento, pra notificação e auditoria. */
  alocacao: Annotation<
    { idCorretor: string; idEvento: string; via: "vinculo" | "pontuacao" } | undefined
  >({ reducer: (_, b) => b, default: () => undefined }),

  /** Quando algum nó sai do envelope e precisa de humano. */
  escalacao: Annotation<{ motivo: MotivoEscalacao | string; contexto: unknown } | undefined>(
    { reducer: (_, b) => b, default: () => undefined },
  ),

  /**
   * R7 — o pedido que parou o nó do agente. Enquanto estiver preenchido, o
   * roteamento vai pro gate; o gate devolve pro mesmo agente.
   */
  pausa: Annotation<Pausa | null>({ reducer: (_, b) => b, default: () => null }),

  /**
   * Memória do evento: extração de modelo e decisão humana já obtidas. É o que
   * torna a re-execução do nó (exigida pela R7) barata e sem efeito duplicado.
   */
  memo: Annotation<Record<string, unknown>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),

  /** Desfecho do Agente 6, pra quem pediu a alteração saber o que aconteceu. */
  alteracao: Annotation<ResultadoAlteracao | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  /** O que responder ao cliente, quando o evento veio de um canal. */
  resposta: Annotation<string | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  /** Trilha do que rodou, pra depurar o grafo sem abrir o banco. */
  trilha: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type EstadoGrafoT = typeof EstadoGrafo.State;
