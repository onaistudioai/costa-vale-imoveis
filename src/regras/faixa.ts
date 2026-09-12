import type { Risco } from "./alteracao";

/**
 * A faixa de um pedido de aprovação — o que substitui o roteamento binário.
 *
 * Antes, todo caso que o agente não resolvia caía na mesma fila do painel com
 * o mesmo peso: "confirma que derrubo R$ 4.200 de mídia" e "cliente perguntou
 * algo fora do padrão" chegavam iguais. A faixa separa os dois.
 *
 * O que a faixa decide:
 *  - **vermelha** — dispara aviso no canal e pula a mesa (não há o que opinar;
 *    é dinheiro, é irreversível, ou o modelo não entendeu o que leu)
 *  - **amarela** — a mesa opina antes, e a pessoa recebe proposta pronta
 *  - **verde** — só a fila do painel, sem aviso e sem mesa
 *
 * O que a faixa NÃO decide: se existe humano. Nenhuma faixa dispensa a
 * aprovação — `podePublicar` (src/regras/publicacao.ts) exige `aprovado`, e o
 * Agente 6 não tem como escrever sozinho. Verde é pedido de baixa prioridade,
 * não pedido cancelado.
 */
export type Faixa = "verde" | "amarela" | "vermelha";

/** A confiança que os agentes 1, 2 e 6 já extraem do modelo. */
export type Confianca = "alta" | "media" | "baixa";

export interface Entrada {
  /**
   * Quanto o modelo confiou na própria leitura. Ausente quando não houve
   * modelo: o Agente 3 é determinístico e não extrai nada.
   */
  confianca?: Confianca;
  /** Dinheiro já gasto que a decisão coloca em risco. Padrão: nenhum. */
  custoEmRisco?: number;
  /** Dá pra desfazer depois? Padrão: sim. */
  reversivel?: boolean;
  /** O risco que `avaliarAlteracao` já classifica, quando existe. */
  risco?: Risco;
  /**
   * Urgência de relógio: o caso perde valor sozinho se ninguém olhar (lead sem
   * dono esfria). Não é consequência grave, mas não pode dormir na fila.
   */
  urgente?: boolean;
}

export interface Limiares {
  /**
   * Acima deste valor em reais, nenhuma mesa opina — vai direto pra pessoa.
   *
   * O limiar é calibrado pelo custo do erro, não pela precisão média do
   * modelo: acertar 95% das vezes não consola quem perdeu os 5% que eram de
   * mídia paga. Fica em configuração, e não no código, porque limiar envelhece
   * e precisa ser revisto com o tempo.
   */
  tetoCustoRevisao: number;
}

export const LIMIARES_PADRAO: Limiares = { tetoCustoRevisao: 500 };

/**
 * Classifica o pedido. Função pura: sem banco, sem modelo, sem relógio.
 *
 * A ordem importa — vermelha vence amarela, que vence verde. Um caso barato
 * mas irreversível é vermelho; um caso caro e reversível também. Basta uma
 * razão.
 */
export function classificar(e: Entrada, limiares: Limiares = LIMIARES_PADRAO): Faixa {
  const custo = e.custoEmRisco ?? 0;
  const reversivel = e.reversivel ?? true;

  // Irreversível é vermelho mesmo de graça: o que não desfaz não aceita palpite
  // de máquina. Custo zero e sem volta ainda é sem volta.
  if (!reversivel) return "vermelha";

  // Modelo em dúvida sobre o que leu. Mandar a mesa raciocinar em cima de uma
  // leitura ruim só produz confiança falsa — quem precisa olhar é gente.
  if (e.confianca === "baixa") return "vermelha";

  if (custo > limiares.tetoCustoRevisao) return "vermelha";

  if (e.risco === "alto") return "vermelha";

  if (e.urgente) return "vermelha";

  // Daqui pra baixo é reversível, barato e bem lido. O que sobra é ambiguidade,
  // e ambiguidade é exatamente o que a mesa serve pra resolver.
  if (e.confianca === "media") return "amarela";
  if (custo > 0) return "amarela";

  return "verde";
}

/** A mesa só trabalha no meio-termo — nos extremos ela não agrega. */
export const passaPelaMesa = (f: Faixa): boolean => f === "amarela";

/** Só o topo incomoda alguém fora do painel. É a defesa contra fadiga de alerta. */
export const avisaNoCanal = (f: Faixa): boolean => f === "vermelha";

/** Ordem de exibição na fila: o que dói primeiro aparece primeiro. */
export const PESO: Record<Faixa, number> = { vermelha: 0, amarela: 1, verde: 2 };
