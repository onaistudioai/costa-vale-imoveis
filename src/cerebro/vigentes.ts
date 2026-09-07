import type { NotaRow } from "./schema";

/**
 * O que vale agora, e o que os agentes podem ver.
 *
 * Funções puras de propósito: a regra de "qual versão vale" precisa ser
 * testável sem banco, porque é ela que decide o que entra no prompt de um
 * agente que fala com cliente.
 */

/** Vigente é a versão que nenhuma outra substitui. */
export function vigentes(todas: NotaRow[]): NotaRow[] {
  const substituidas = new Set(todas.map((n) => n.substitui).filter(Boolean) as string[]);
  return todas.filter((n) => !substituidas.has(n.id));
}

/**
 * O que efetivamente influencia um agente.
 *
 * Rascunho não influencia nada — proposta aparece no painel e para por aí.
 * Desativada também não, e continua legível com o motivo. Só o que uma pessoa
 * confirmou ou fixou chega perto de um prompt.
 */
export const ativas = (todas: NotaRow[]) =>
  vigentes(todas).filter((n) => n.estado === "confirmada" || n.estado === "fixada");

/** O histórico de uma nota, da versão atual até a primeira. */
export function historia(todas: NotaRow[], id: string): NotaRow[] {
  const porId = new Map(todas.map((n) => [n.id, n]));
  const linha: NotaRow[] = [];
  let atual = porId.get(id);
  while (atual) {
    linha.push(atual);
    atual = atual.substitui ? porId.get(atual.substitui) : undefined;
  }
  return linha;
}

/**
 * As notas que valem para um agente, do geral para o específico.
 *
 * `escopo: "agente"` fala com um agente só; `"geral"` fala com todos; os
 * demais escopos (bairro, tipo, canal) entram quando o chamador sabe o
 * contexto e passa a chave.
 */
export function paraAgente(todas: NotaRow[], agente: string, chaves: string[] = []): NotaRow[] {
  const alvo = new Set([agente, ...chaves]);
  return ativas(todas).filter(
    (n) => n.escopo === "geral" || (n.chave !== "" && alvo.has(n.chave)),
  );
}
