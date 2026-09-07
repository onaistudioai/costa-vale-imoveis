import type { Agente } from "@/tipos";

export type TipoEvento =
  | "laudo.criado"
  | "preco.alterado"
  | "transacao.criada"
  | "transacao.atualizada"
  | "documento.negociacao"
  | "lead.qualificado"
  | "mensagem.recebida"
  | "alteracao.solicitada"
  | "aprovacao.decidida";

/**
 * R1 — gatilho exclusivo. Cada evento acorda exatamente um agente.
 *
 * `aprovacao.decidida` volta pro agente que abriu o pedido, então é resolvida
 * em runtime a partir do payload, não por esta tabela.
 */
export const GATILHOS: Record<Exclude<TipoEvento, "aprovacao.decidida">, Agente> = {
  "laudo.criado": "1_curador",
  "preco.alterado": "1_curador",
  "transacao.criada": "2_guardiao",
  "transacao.atualizada": "2_guardiao",
  "documento.negociacao": "2_guardiao",
  "lead.qualificado": "3_roteador",
  "mensagem.recebida": "4_atendimento",
  "alteracao.solicitada": "6_alterador",
};

export interface Evento {
  idEvento: string;
  tipo: TipoEvento;
  idImovel?: string;
  idCliente?: string;
  /** Só em aprovacao.decidida: pra quem devolver. */
  agenteDestino?: Agente;
  payload?: Record<string, unknown>;
}

export function donoDoEvento(e: Evento): Agente {
  if (e.tipo === "aprovacao.decidida") {
    if (!e.agenteDestino) {
      throw new Error(`aprovacao.decidida sem agenteDestino (evento ${e.idEvento})`);
    }
    return e.agenteDestino;
  }
  return GATILHOS[e.tipo];
}

/**
 * R2 — escopo do lock.
 *
 * Chave por imóvel, porque é o registro que os agentes disputam. O escopo é o
 * que separa paralelismo real de escada: global serializaria tudo, ausente
 * empilharia dois agentes no mesmo registro.
 *
 * Exceção: o Agente 4. Uma `mensagem.recebida` de lead novo não tem imóvel
 * nenhum ainda, então não há por onde travar — ele é chaveado por conversa. É
 * seguro porque ele só lê imóvel; escreve em cliente/busca, que são dele.
 */
export function chaveDeLock(e: Evento): string {
  // O alterador é chaveado pelo alvo quando já se sabe qual é, e pelo próprio
  // evento quando não se sabe — na primeira passada o registro ainda não foi
  // resolvido, então não há por onde travar. Duas alterações no mesmo imóvel
  // continuam serializadas, que é o que importa.
  if (donoDoEvento(e) === "6_alterador") {
    return e.idImovel ? `imovel:${e.idImovel}` : `alteracao:${e.idEvento}`;
  }
  if (donoDoEvento(e) === "4_atendimento") {
    if (!e.idCliente) throw new Error(`evento do Agente 4 sem idCliente (${e.idEvento})`);
    return `cliente:${e.idCliente}`;
  }
  if (!e.idImovel) throw new Error(`evento sem idImovel (${e.idEvento}, ${e.tipo})`);
  return `imovel:${e.idImovel}`;
}

/**
 * A thread do checkpointer. É por EVENTO, não por imóvel: eventos do mesmo
 * imóvel já são serializados pelo lock da R2, e compartilhar thread faria um
 * evento novo retomar o checkpoint de um gate ainda pendente.
 */
export function threadDoEvento(e: Evento): string {
  return `${chaveDeLock(e)}#${e.idEvento}`;
}
