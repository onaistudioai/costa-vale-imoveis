/**
 * Os números da simulação, cada um com a origem declarada.
 *
 * A regra que torna este arquivo apresentável numa reunião: **nenhum valor
 * entra sem rótulo.** `medido` saiu do nosso próprio sistema, `pesquisado` tem
 * fonte escrita ao lado, `suposto` não tem fonte pública nenhuma e é onde mora
 * a incerteza — por isso os supostos entram como faixa e vão para a análise de
 * sensibilidade.
 *
 * Um relatório que não separa essas três coisas é um relatório que apresenta
 * chute com a mesma cara de medida.
 */

export type Origem = "medido" | "pesquisado" | "suposto";

export interface Valor<T> {
  valor: T;
  origem: Origem;
  /** De onde veio. Em `suposto`, o que precisa ser medido pra virar `medido`. */
  fonte: string;
}

const v = <T>(valor: T, origem: Origem, fonte: string): Valor<T> => ({ valor, origem, fonte });

// ---------------------------------------------------------------------------
// MEDIDO — o que já sabemos porque está no nosso código ou no nosso banco
// ---------------------------------------------------------------------------

export const MEDIDO = {
  prazoAceiteMin: v(5, "medido", "src/lib/config.ts — CONFIG_ROTEAMENTO.prazoAceiteMin"),
  maxOfertas: v(3, "medido", "src/lib/config.ts — CONFIG_ROTEAMENTO.maxOfertas"),
  expedienteInicio: v(7.5, "medido", "src/lib/expediente.ts — 7h30"),
  expedienteFim: v(19, "medido", "src/lib/expediente.ts — 19h"),
  diasUteis: v([1, 2, 3, 4, 5, 6], "medido", "src/lib/expediente.ts — domingo fora"),
  respostaDoAgenteSeg: v(1.1, "medido", "leitura_modelo — mediana real das chamadas"),
  precoMedioImovel: v(
    846_000,
    "medido",
    "cadastro — estoque de R$ 520 mil a R$ 1,17 milhão, mediana no Campolim",
  ),
  comissaoPercentual: v(5, "medido", "cadastro — coluna comissao_percentual do corretor"),
  corretoresAtivos: v(5, "medido", "cadastro — 6 corretores, 1 inativo"),
};

// ---------------------------------------------------------------------------
// PESQUISADO — fonte pública, escrita ao lado
// ---------------------------------------------------------------------------

export const PESQUISADO = {
  /**
   * O estudo que sustenta o prazo de 5 minutos existir. MIT/InsideSales,
   * Dr. James Oldroyd, mais de 1 milhão de leads: responder em até 5 min dá 21×
   * mais chance de qualificar do que responder em 30 min.
   */
  ganhoAte5Min: v(21, "pesquisado", "MIT / InsideSales.com Lead Response Management Study"),
  compradorFechaComOPrimeiro: v(
    0.78,
    "pesquisado",
    "78% dos compradores fecham com o primeiro corretor que responde — citado por NAR e agregadores do setor",
  ),

  /**
   * Quanto tempo alguém leva pra responder um WhatsApp **quando está
   * disponível**. É a base da distribuição de latência; a indisponibilidade da
   * rotina entra separada, em rotina.ts.
   */
  respostaWhatsAppSeg: v(
    [45, 90] as [number, number],
    "pesquisado",
    "benchmarks de WhatsApp Business 2026 — 45 a 90s de média contra 6h+ de e-mail",
  ),

  /**
   * Taxa de abertura. Existem dois números correndo o mercado: 98%, repetido em
   * centenas de artigos sem fonte primária, e 68%, que é medido. Usamos 68% —
   * simulação que escolhe o número bonito não é simulação, é peça de venda.
   */
  aberturaWhatsApp: v(
    0.68,
    "pesquisado",
    "68% medido; a estatística de 98% circula sem fonte primária verificável",
  ),
  taxaRespostaSetor: v(
    [0.25, 0.55] as [number, number],
    "pesquisado",
    "faixa de 25% a 55% de taxa de resposta por setor em WhatsApp Business",
  ),

  conversaoLeadFechamento: v(
    [0.004, 0.012] as [number, number],
    "pesquisado",
    "0,4% a 1,2% em lead de portal; 2% a 5% somando todas as origens",
  ),
  custoPorLeadUsd: v(
    [139, 480] as [number, number],
    "pesquisado",
    "US$ 139–223 em portal, US$ 416–480 na média geral do setor (mercado americano)",
  ),
  dolar: v(5.4, "suposto", "câmbio de referência — ajustar na apresentação"),

  horasSemanaCorretor: v(35, "pesquisado", "NAR Member Profile — mediana de 35h semanais"),
  blocoDeVisitas: v(
    [12, 16.5] as [number, number],
    "pesquisado",
    "rotinas publicadas do setor — visitas concentradas entre 12h e 16h30",
  ),
};

// ---------------------------------------------------------------------------
// SUPOSTO — sem fonte pública. É aqui que a conclusão pode desabar.
// ---------------------------------------------------------------------------

export const SUPOSTO = {
  /** Fração das horas de expediente ao volante. */
  fracaoDirigindo: v(
    0.25,
    "suposto",
    "MEDIR: tempo de deslocamento por corretor, do próprio celular ou da agenda",
  ),
  /** Duração de uma visita, em minutos. */
  duracaoVisitaMin: v(
    45,
    "suposto",
    "MEDIR: duração real das visitas — a agenda do sistema já reserva 60 min",
  ),
  /** Visitas por dia útil, por corretor. */
  visitasPorDia: v(2, "suposto", "MEDIR: contagem de visitas na agenda"),
  /**
   * Quanto tempo depois de ficar livre ele olha o celular. É o parâmetro mais
   * decisivo de todos: com prazo de 5 minutos, qualquer valor acima disso zera
   * a chance de o primeiro colocado pegar o lead.
   */
  atrasoAoFicarLivreMin: v(
    [2, 12] as [number, number],
    "suposto",
    "MEDIR: diferença entre enviadoEm e decididoEm — as duas colunas já existem e estão vazias",
  ),
  /** Chance de responder enquanto dirige. Baixa, e deveria ser zero. */
  respondeDirigindo: v(0.1, "suposto", "MEDIR: comportamento real da equipe"),
  /** Chance de responder no meio de uma visita, com cliente na frente. */
  respondeEmVisita: v(0.15, "suposto", "MEDIR: comportamento real da equipe"),
  /** Chance de simplesmente ignorar uma oferta que chegou em hora livre. */
  ignoraLivre: v(0.15, "suposto", "MEDIR: taxa de recusa silenciosa"),
  /** Leads que chegam por dia. */
  leadsPorDia: v(8, "suposto", "MEDIR: volume real da imobiliária"),
};

/** Tudo junto, pro relatório listar origem por origem. */
export const TODOS = { ...MEDIDO, ...PESQUISADO, ...SUPOSTO } as Record<string, Valor<unknown>>;

export const porOrigem = (o: Origem) =>
  Object.entries(TODOS).filter(([, x]) => x.origem === o);
