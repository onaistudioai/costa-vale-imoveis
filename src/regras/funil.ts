import type { EstadoAtendimento, EtapaAtendimento } from "@/tipos";

/**
 * O funil de atendimento e a lista de quem não respondeu.
 *
 * Duas ideias, uma tabela.
 *
 * **A primeira: etapa não é estado.** A *etapa* diz até onde a conversa
 * chegou; o *estado* diz de quem é a bola. São perguntas diferentes e misturar
 * as duas é o que gera fila que ninguém sabe trabalhar. Três estados, e só:
 *
 * - `aberto` — a bola é nossa. Alguém precisa fazer alguma coisa hoje.
 * - `pendente` — a bola é do cliente. Fizemos nossa parte e esperamos.
 * - `fechado` — tem desfecho escrito. Só sai daqui com motivo.
 *
 * **A segunda: quem chegou mais longe e sumiu vale mais.** Um lead que fez
 * proposta e parou de responder não é igual a um que mandou "quanto custa?" e
 * nunca voltou — e uma lista ordenada por data de contato trata os dois igual.
 * Por isso a prioridade soma profundidade com silêncio: quanto mais fundo o
 * cliente chegou, mais rápido ele sobe na lista quando cala.
 *
 * O que o sistema **não** faz: decidir sozinho que o cliente desistiu. Passado
 * o teto de silêncio, o caso volta pra `aberto` marcado como precisando de
 * desfecho — alguém tem que dar o ponto final. Fechar por inatividade é
 * transformar "não sei" em "não quis", e é assim que a lista de casos não
 * definidos vira lixo em que ninguém confia.
 */

/** A escada, em ordem. O índice é a profundidade. */
export const ETAPAS: EtapaAtendimento[] = [
  "primeiro_contato",
  "qualificado",
  "visita_agendada",
  "visita_feita",
  "proposta",
  "negociacao",
];

/** Peso de cada etapa na prioridade. Salta na visita e de novo na proposta:
 *  é onde o cliente passa a investir tempo e dinheiro, e onde perder dói. */
export const PESO_ETAPA: Record<EtapaAtendimento, number> = {
  primeiro_contato: 5,
  qualificado: 15,
  visita_agendada: 35,
  visita_feita: 55,
  proposta: 80,
  negociacao: 95,
  ganho: 0,
  perdido: 0,
};

export const CONFIG_FUNIL = {
  /**
   * Dias de silêncio até o caso exigir um ponto final. Mais curto quanto mais
   * fundo: quem fez proposta e sumiu há uma semana é urgente; quem só
   * perguntou preço pode esperar um mês antes de virar decisão.
   */
  tetoSilencioDias: {
    primeiro_contato: 30,
    qualificado: 21,
    visita_agendada: 7,
    visita_feita: 10,
    proposta: 5,
    negociacao: 5,
  } as Record<string, number>,
  /** Acima disto o caso aparece destacado, não só ordenado. */
  prioridadeCritica: 120,
};

/** Motivos de desfecho aceitos. Texto livre vira lista que ninguém consegue
 *  contar depois — e "por que perdemos" é a pergunta que paga o relatório. */
export const MOTIVOS_DESFECHO = [
  "comprou_conosco",
  "comprou_com_outro",
  "desistiu_da_compra",
  "sem_interesse",
  "fora_do_perfil",
  "sem_resposta",
  "imovel_indisponivel",
  "preco_acima_do_orcamento",
  "duplicado",
] as const;

export type MotivoDesfecho = (typeof MOTIVOS_DESFECHO)[number];

export const ROTULO_MOTIVO: Record<MotivoDesfecho, string> = {
  comprou_conosco: "Comprou com a gente",
  comprou_com_outro: "Comprou com outra imobiliária",
  desistiu_da_compra: "Desistiu de comprar agora",
  sem_interesse: "Disse que não tem interesse",
  fora_do_perfil: "Não atende ao perfil",
  sem_resposta: "Nunca respondeu (encerrado pela equipe)",
  imovel_indisponivel: "O imóvel saiu do ar",
  preco_acima_do_orcamento: "Preço acima do que podia pagar",
  duplicado: "Cadastro repetido",
};

export function profundidade(e: EtapaAtendimento): number {
  const i = ETAPAS.indexOf(e);
  return i === -1 ? ETAPAS.length : i;
}

/** Avançar sim, pular não. Saltar de primeiro contato pra proposta esconde
 *  que a visita nunca aconteceu, e o relatório de conversão passa a mentir. */
export function podeAvancar(de: EtapaAtendimento, para: EtapaAtendimento): boolean {
  if (para === "ganho" || para === "perdido") return true;
  const a = ETAPAS.indexOf(de);
  const b = ETAPAS.indexOf(para);
  if (a === -1 || b === -1) return false;
  // Voltar é permitido (proposta recusada volta pra negociação); pular não.
  return b <= a + 1;
}

export interface Atendimento {
  etapa: EtapaAtendimento;
  etapaMaxima: EtapaAtendimento;
  estado: EstadoAtendimento;
  ultimaInteracao: Date;
  ultimoContatoPor: "cliente" | "nos";
}

export interface Situacao {
  estado: EstadoAtendimento;
  prioridade: number;
  precisaDesfecho: boolean;
  /** Uma frase pra fila, em português. */
  rotulo: string;
}

export const diasDeSilencio = (a: Atendimento, agora: Date) =>
  Math.floor((agora.getTime() - a.ultimaInteracao.getTime()) / 86_400_000);

/**
 * Recalcula onde o caso está e quanto ele grita.
 *
 * `prioridade` = peso da etapa mais funda já alcançada + pressão do silêncio,
 * e a pressão é proporcional ao quanto o caso já passou do próprio teto. Um
 * lead em proposta parado há 5 dias (teto 5) empata com um em primeiro
 * contato parado há 30 (teto 30) — o que está certo: os dois acabaram de
 * estourar. Passado o teto, quem estava mais fundo sobe mais rápido.
 */
export function avaliar(a: Atendimento, agora = new Date()): Situacao {
  if (a.estado === "fechado") {
    return { estado: "fechado", prioridade: 0, precisaDesfecho: false, rotulo: "Encerrado" };
  }

  const dias = diasDeSilencio(a, agora);
  const teto = CONFIG_FUNIL.tetoSilencioDias[a.etapa] ?? 30;
  const base = PESO_ETAPA[a.etapaMaxima];

  // A bola é nossa se o cliente falou por último. Isso é o que separa "atrasei
  // a resposta" de "ele não respondeu" — e são problemas de donos diferentes.
  if (a.ultimoContatoPor === "cliente") {
    return {
      estado: "aberto",
      // Cliente esperando resposta é sempre urgente, some o que somar: cada
      // hora aqui é speed-to-lead virando conversão perdida.
      prioridade: base + 100 + dias * 10,
      precisaDesfecho: false,
      rotulo: dias === 0 ? "Cliente aguardando resposta" : `Sem resposta nossa há ${dias} dia(s)`,
    };
  }

  const estourou = dias >= teto;
  // A pressão do silêncio é relativa ao teto da etapa, não absoluta em dias.
  const pressao = Math.round((dias / teto) * PESO_ETAPA[a.etapaMaxima]);

  return {
    estado: estourou ? "aberto" : "pendente",
    prioridade: base + pressao,
    precisaDesfecho: estourou,
    rotulo: estourou
      ? `Parado há ${dias} dias em ${a.etapa} — precisa de desfecho`
      : `Aguardando o cliente há ${dias} dia(s)`,
  };
}

/**
 * Fechar exige motivo. É a regra que impede a lista de virar cemitério: sem
 * desfecho não dá pra responder "quantos perdemos por preço?", que é a
 * pergunta que muda a operação.
 */
export function fechar(
  a: Atendimento,
  motivo: MotivoDesfecho,
): { etapa: EtapaAtendimento; estado: EstadoAtendimento; motivoDesfecho: MotivoDesfecho } {
  return {
    etapa: motivo === "comprou_conosco" ? "ganho" : "perdido",
    estado: "fechado",
    motivoDesfecho: motivo,
  };
}
