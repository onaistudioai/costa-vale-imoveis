import type { ConfigRoteamento } from "@/tipos";

/**
 * Espelha o bloco `roteamento` de `.planning/config.json`.
 *
 * `scoreMinimo` é o botão de calibração: é ele que decide quando o Agente 3
 * escala em vez de alocar mal. 40 é chute inicial — precisa de estoque real e
 * de `dominio_corretor` populada pra afinar.
 */
export const CONFIG_ROTEAMENTO: ConfigRoteamento = {
  janelaVinculoDias: 30,
  horizonteAgendaHoras: 48,
  scoreMinimo: 40,
  // 5 minutos é o corte que a literatura de "speed to lead" usa: comprador de
  // imóvel fala com várias imobiliárias ao mesmo tempo, e a conversão cai forte
  // depois disso. É botão de calibração — se a equipe reclamar de lead pulando
  // rápido demais, sobe; se cliente reclamar de demora, desce.
  prazoAceiteMin: 5,
  // Três tentativas e o lead vira problema de gente. Insistir mais só empurra
  // o cliente pra fila sem ninguém responsável.
  maxOfertas: 3,
  pesos: {
    captou: 100,
    jaVisitou: 60,
    conheceRegiao: 25,
    disponibilidadeImediata: 40,
    cargaBaixa: 15,
  },
};

/**
 * Expediente usado pra gerar slots candidatos de visita: 7h30 às 19h.
 *
 * Em minutos desde a meia-noite porque o dia começa em :30 — hora cheia não
 * expressa o horário real da equipe. O `passoMin` menor que a `duracaoMin`
 * gera grade sobreposta (7h30, 8h, 8h30...), o que aproveita melhor o buraco
 * entre dois compromissos.
 */
export const EXPEDIENTE = {
  inicioMin: 7 * 60 + 30,
  fimMin: 19 * 60,
  duracaoMin: 60,
  passoMin: 30,
  /** 0 = domingo. Imobiliária trabalha sábado; domingo fica de fora. */
  diasUteis: [1, 2, 3, 4, 5, 6],
};
