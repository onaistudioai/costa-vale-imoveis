import type { Agente } from "@/tipos";
import type { AgenteContexto, Escrita, PedidoAprovacao } from "../contrato";

/**
 * Contexto de teste. Grava tudo que o agente tentou fazer, para que os testes
 * afirmem sobre efeito e não sobre implementação.
 */
export function contextoFalso<A extends Agente>(
  agente: A,
  decisaoHumana: { aprovado: boolean; por: string; motivo?: string } = {
    aprovado: true,
    por: "teste",
  },
) {
  const escritas: Escrita<A>[] = [];
  const pedidos: PedidoAprovacao[] = [];
  const avisos: string[] = [];

  const ctx: AgenteContexto<A> = {
    agente,
    idEvento: "evento-teste",
    async escrever(e) {
      escritas.push(e);
    },
    async pedirAprovacao(p) {
      pedidos.push(p);
      return decisaoHumana;
    },
    async avisar(m) {
      avisos.push(m);
    },
  };

  return { ctx, escritas, pedidos, avisos };
}
