import { estadoPorEtapa, type ExtracaoNegociacao } from "@/agentes/guardiao";
import type { EstadoComercial } from "@/tipos";

/**
 * O conjunto de referência do Agente 2.
 *
 * Como no Curador, o rótulo é a decisão (o estado comercial), não a etapa: duas
 * etapas que levam ao mesmo estado derrubam os mesmos anúncios.
 *
 * O erro caro tem nome: **tirar do mercado um imóvel que ainda está à venda.**
 * Qualquer estado diferente de `disponivel` pausa os anúncios na hora, antes
 * de gente nenhuma olhar. O erro contrário deixa um anúncio no ar a mais, e o
 * próximo documento corrige.
 */

export interface CasoNegociacao {
  id: string;
  porque: string;
  documento: string;
  esperado: { estado: EstadoComercial };
}

export const CASOS_NEGOCIACAO: CasoNegociacao[] = [
  {
    id: "contraproposta",
    porque: "contraproposta não é aceite — o imóvel segue em negociação, não em venda",
    documento:
      "Cliente ofereceu 780 mil. Proprietário respondeu que por menos de 820 não fecha. Vou levar a contraproposta amanhã.",
    esperado: { estado: "em_negociacao" },
  },
  {
    id: "aceite-verbal",
    porque: "aceite verbal conta como aceite, mas ainda não é processo de venda",
    documento: "Falei com o seu Jorge por telefone, ele topou os 800 mil. Vou montar a proposta formal.",
    esperado: { estado: "em_negociacao" },
  },
  {
    id: "financiamento",
    porque: "banco analisando financiamento depois do aceite é processo de venda",
    documento:
      "Proposta aceita e assinada pelo vendedor. Comprador deu entrada no financiamento na Caixa, aguardando avaliação do imóvel.",
    esperado: { estado: "em_processo_venda" },
  },
  {
    id: "desistiu",
    porque: "desistência devolve o imóvel ao mercado",
    documento: "Comprador desistiu, o financiamento foi negado. Proprietário pediu pra voltar a anunciar.",
    esperado: { estado: "disponivel" },
  },
];

export interface ConferenciaNegociacao {
  id: string;
  porque: string;
  ok: boolean;
  estadoEsperado: EstadoComercial;
  estadoObtido: EstadoComercial;
  /** Tirou do mercado o que estava à venda. O erro caro. */
  tirouDoMercado: boolean;
}

export function conferirNegociacao(
  caso: CasoNegociacao,
  e: ExtracaoNegociacao,
): ConferenciaNegociacao {
  const obtido = estadoPorEtapa(e.etapa);
  const esperado = caso.esperado.estado;
  return {
    id: caso.id,
    porque: caso.porque,
    ok: obtido === esperado,
    estadoEsperado: esperado,
    estadoObtido: obtido,
    tirouDoMercado: esperado === "disponivel" && obtido !== "disponivel",
  };
}
