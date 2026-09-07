import type { EstadoAnuncio, EstadoComercial } from "@/tipos";

export interface ImovelOfertavel {
  idImovel: string;
  tipo: string;
  preco: number | null;
  bairro: string | null;
  cidade: string;
  estadoAnuncio: EstadoAnuncio;
  estadoComercial: EstadoComercial;
}

export interface CriteriosBusca {
  valorMin: number | null;
  valorMax: number | null;
  tipoImovel: string | null;
  bairrosDesejados: string[];
}

/**
 * O que o Agente 4 pode oferecer.
 *
 * A filtragem por faixa e bairro é comparação de campo, então é regra e não
 * modelo — o LLM só extrai os critérios do texto do cliente.
 *
 * O filtro de estado vem PRIMEIRO e não é opcional: o Agente 4 nunca oferece
 * imóvel que não está no ar e disponível. Isso é defensivo de propósito —
 * mesmo que o chamador passe estoque sujo, nada em negociação escapa. É o
 * limite "não fala preço de imóvel em negociação" virando código em vez de
 * instrução de prompt.
 */
export function casarComEstoque(
  criterios: CriteriosBusca,
  estoque: ImovelOfertavel[],
): ImovelOfertavel[] {
  const ofertavel = estoque.filter(
    (i) => i.estadoAnuncio === "no_ar" && i.estadoComercial === "disponivel",
  );

  return ofertavel.filter((i) => {
    if (criterios.tipoImovel && i.tipo !== criterios.tipoImovel) return false;

    if (criterios.bairrosDesejados.length > 0) {
      const bairro = i.bairro?.toLowerCase() ?? "";
      const querido = criterios.bairrosDesejados.some(
        (b) => b.toLowerCase() === bairro,
      );
      if (!querido) return false;
    }

    // Imóvel sem preço cadastrado não é descartado por faixa: o cliente pode
    // querer ver, e esconder estoque por dado faltando é pior que mostrar.
    if (i.preco !== null) {
      if (criterios.valorMin !== null && i.preco < criterios.valorMin) return false;
      if (criterios.valorMax !== null && i.preco > criterios.valorMax) return false;
    }

    return true;
  });
}
