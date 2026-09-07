import type { Anuncio, Imovel } from "@/tipos";

/**
 * A regra da seção 3 do PROJECT_SPEC, em uma função.
 *
 * Anúncio só sobe se o imóvel está pronto E disponível E existe aprovação
 * humana registrada. As três condições são necessárias; nenhuma sozinha basta.
 */
export function podePublicar(
  imovel: Pick<Imovel, "estadoOperacional" | "estadoComercial">,
  aprovado: boolean,
): boolean {
  return (
    imovel.estadoOperacional === "pronto" &&
    imovel.estadoComercial === "disponivel" &&
    aprovado
  );
}

export interface EfeitoQueda {
  /** Anúncios que a regra derruba sozinha, sem esperar humano. */
  pausarAgora: Anuncio[];
  /** Anúncios com mídia paga: só param depois de aprovação (dinheiro). */
  exigemAprovacao: Anuncio[];
  /** Soma do custo já gasto no que exige aprovação — vai no aviso à equipe. */
  custoEmRisco: number;
}

/**
 * O gatilho de saída de `disponivel` (Fluxo B).
 *
 * Anúncio orgânico cai imediatamente. Mídia paga espera confirmação humana,
 * porque interromper campanha é decisão de dinheiro. Note que a proteção do
 * lead NÃO depende disto: o corte do Agente 4 acontece na mudança de
 * `estadoComercial`, não na aprovação — ver comentário do Fluxo B na spec.
 */
export function derrubarAnuncio(
  imovel: Pick<Imovel, "estadoComercial">,
  anuncios: Anuncio[],
): EfeitoQueda {
  const vazio: EfeitoQueda = {
    pausarAgora: [],
    exigemAprovacao: [],
    custoEmRisco: 0,
  };
  if (imovel.estadoComercial === "disponivel") return vazio;

  const ativos = anuncios.filter((a) => a.status === "no_ar");
  const exigemAprovacao = ativos.filter((a) => a.midiaPaga);

  return {
    pausarAgora: ativos.filter((a) => !a.midiaPaga),
    exigemAprovacao,
    custoEmRisco: exigemAprovacao.reduce((s, a) => s + a.custoAcumulado, 0),
  };
}
