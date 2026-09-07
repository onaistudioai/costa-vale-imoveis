import { decidirEstado, type ExtracaoLaudo } from "@/agentes/curador";
import type { EstadoOperacional } from "@/tipos";
import type { Caso } from "./casos";

/**
 * A conferência de uma leitura contra o caso de referência.
 *
 * A medida não é "o JSON bateu". A medida é **a decisão bateu** — porque é a
 * decisão que chega no cliente. Por isso a extração passa pela mesma
 * `decidirEstado()` que roda em produção: o que se afere é o par
 * modelo + regra, que é o que existe de verdade.
 *
 * E os erros não valem o mesmo. Segurar um imóvel que podia ser anunciado
 * custa um dia de venda; **anunciar um imóvel com inventário aberto custa um
 * processo.** Um número só de "acerto" esconde exatamente essa diferença, então
 * aqui ela tem nome e coluna própria: `liberouIndevidamente`.
 */

/** Todo caso parte daqui: imóvel em análise, ainda não liberado nem travado. */
const PARTIDA: EstadoOperacional = "em_preparacao";

/** Estados em que o imóvel pode ir para o ar. */
const LIBERA = (e: EstadoOperacional) => e === "pronto";

export interface Conferencia {
  id: string;
  porque: string;
  estadoEsperado: EstadoOperacional;
  estadoObtido: EstadoOperacional;
  estadoOk: boolean;
  precoEsperado: number | null;
  precoObtido: number | null;
  precoOk: boolean;
  /** Disse que podia anunciar quando não podia. O erro que custa caro. */
  liberouIndevidamente: boolean;
  /** Travou um imóvel que estava liberado. Custa um dia, não um processo. */
  travouSemMotivo: boolean;
  confianca: ExtracaoLaudo["confianca"];
}

export function conferir(caso: Caso, e: ExtracaoLaudo): Conferencia {
  const obtido = decidirEstado(PARTIDA, e);
  const esperado = caso.esperado.estado;

  return {
    id: caso.id,
    porque: caso.porque,
    estadoEsperado: esperado,
    estadoObtido: obtido,
    estadoOk: obtido === esperado,
    precoEsperado: caso.esperado.preco,
    precoObtido: e.precoMencionado,
    precoOk: e.precoMencionado === caso.esperado.preco,
    liberouIndevidamente: LIBERA(obtido) && !LIBERA(esperado),
    travouSemMotivo: !LIBERA(obtido) && LIBERA(esperado),
    confianca: e.confianca,
  };
}

export interface Resumo {
  total: number;
  estado: number;
  preco: number;
  liberouIndevidamente: string[];
  travouSemMotivo: string[];
  precoErrado: string[];
}

/**
 * O resumo não devolve nota geral de propósito.
 *
 * Duas versões de prompt com o mesmo "80% de acerto" podem ser opostas em
 * qualidade: uma erra travando, a outra erra liberando. Quem decide se subiu
 * ou desceu precisa ver os dois números separados.
 */
export function resumir(cs: Conferencia[]): Resumo {
  return {
    total: cs.length,
    estado: cs.filter((c) => c.estadoOk).length,
    preco: cs.filter((c) => c.precoOk).length,
    liberouIndevidamente: cs.filter((c) => c.liberouIndevidamente).map((c) => c.id),
    travouSemMotivo: cs.filter((c) => c.travouSemMotivo).map((c) => c.id),
    precoErrado: cs.filter((c) => !c.precoOk).map((c) => c.id),
  };
}
