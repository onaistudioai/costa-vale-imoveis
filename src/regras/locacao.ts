/**
 * Locação.
 *
 * Venda termina; locação continua. A diferença que muda o desenho do sistema:
 * uma venda é um processo com fim, uma locação é um **calendário que não
 * para** — vencimento todo mês, reajuste todo ano, repasse depois de cada
 * pagamento, e a cada um deles alguém precisa ser avisado.
 *
 * O que a pesquisa de mercado mostra que todo sistema de locação bem
 * posicionado faz (ImobiBrasil, Pilota, Alugo e afins), e que este módulo
 * cobre em regra pura:
 *
 * | Função | Onde está aqui |
 * |---|---|
 * | Boleto/cobrança mensal | `gerarParcela` + varredura |
 * | Reajuste automático por índice | `reajusteDevido` / `aplicarReajuste` |
 * | Multa e juros de atraso | `calcularEncargos` |
 * | Régua de inadimplência escalonada | `reguaCobranca` |
 * | Repasse ao proprietário | `calcularRepasse` |
 * | Aviso de fim de contrato | `avisosDeVigencia` |
 *
 * O que fica **fora** de propósito: emissão de boleto e PIX de verdade. Isso é
 * integração com banco, não regra — e num projeto de portfólio uma integração
 * financeira falsa é pior que nenhuma.
 *
 * A decisão de desenho que importa: **o reajuste não é aplicado sozinho.** O
 * valor do índice vem de fora e o reajuste costuma ser negociado (inquilino
 * bom se perde por 8% de IGPM aplicado no automático). O sistema calcula,
 * avisa e espera alguém confirmar.
 */

export interface Contrato {
  idContrato: string;
  valorAluguel: number;
  valorCondominio: number;
  valorIptu: number;
  diaVencimento: number;
  inicio: Date;
  fim: Date;
  ultimoReajuste: Date | null;
  taxaAdministracao: number;
  multaAtraso: number;
  jurosMes: number;
}

export interface Parcela {
  competencia: string;
  vencimento: Date;
  valorBase: number;
  estagioCobranca: number;
}

export const competenciaDe = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Vencimento do mês, com o ajuste que todo sistema de locação erra uma vez:
 * contrato com vencimento dia 31 em mês de 30 vence no último dia, não dia 1
 * do mês seguinte.
 */
export function vencimentoDe(contrato: Contrato, ano: number, mes: number): Date {
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  return new Date(ano, mes, Math.min(contrato.diaVencimento, ultimoDia));
}

/**
 * A parcela do mês. Devolve `null` quando o mês está fora da vigência —
 * gerar cobrança de contrato encerrado é o tipo de erro que só aparece na
 * reclamação do inquilino.
 */
export function gerarParcela(
  contrato: Contrato,
  ano: number,
  mes: number,
): { competencia: string; vencimento: Date; valorBase: number } | null {
  const vencimento = vencimentoDe(contrato, ano, mes);
  if (vencimento < contrato.inicio || vencimento > contrato.fim) return null;

  return {
    competencia: `${ano}-${String(mes + 1).padStart(2, "0")}`,
    vencimento,
    // O inquilino paga um valor só; a separação existe pro repasse e pro
    // reajuste, que incidem sobre partes diferentes.
    valorBase: contrato.valorAluguel + contrato.valorCondominio + contrato.valorIptu,
  };
}

export const diasDeAtraso = (p: Parcela, agora: Date) =>
  Math.max(0, Math.floor((agora.getTime() - p.vencimento.getTime()) / 86_400_000));

/**
 * Multa fixa mais juros proporcionais aos dias — o padrão de contrato de
 * locação no Brasil (multa de 2%, juros de 1% ao mês pro rata die).
 */
export function calcularEncargos(
  contrato: Contrato,
  parcela: Parcela,
  agora = new Date(),
): { dias: number; multa: number; juros: number; total: number } {
  const dias = diasDeAtraso(parcela, agora);
  if (dias === 0) return { dias: 0, multa: 0, juros: 0, total: parcela.valorBase };

  const multa = round2(parcela.valorBase * (contrato.multaAtraso / 100));
  const juros = round2(parcela.valorBase * (contrato.jurosMes / 100) * (dias / 30));
  return { dias, multa, juros, total: round2(parcela.valorBase + multa + juros) };
}

/**
 * A régua de cobrança. Escalonada e com etapa registrada, pra não mandar a
 * mesma mensagem quatro vezes — o erro que faz o inquilino silenciar o número.
 *
 * O lembrete ANTES do vencimento é o que a pesquisa aponta como o que mais
 * reduz inadimplência: a maior parte do atraso é esquecimento, não falta de
 * dinheiro, e cobrar depois já custou o relacionamento.
 */
export const REGUA_COBRANCA = [
  { estagio: 1, dias: -3, tom: "lembrete", texto: "vence em 3 dias" },
  { estagio: 2, dias: 0, tom: "lembrete", texto: "vence hoje" },
  { estagio: 3, dias: 3, tom: "aviso", texto: "3 dias em atraso" },
  { estagio: 4, dias: 7, tom: "cobranca", texto: "7 dias em atraso, com multa e juros" },
  { estagio: 5, dias: 15, tom: "cobranca", texto: "15 dias em atraso" },
  // A partir daqui não é mais mensagem automática: é decisão de gente.
  { estagio: 6, dias: 30, tom: "escalacao", texto: "30 dias — encaminhar para cobrança formal" },
] as const;

/**
 * Qual passo da régua cabe agora, ou `null` se o passo já foi dado. Compara
 * com o estágio já registrado na parcela: é isso que torna a varredura de
 * minuto em minuto segura.
 */
export function reguaCobranca(parcela: Parcela, agora = new Date()) {
  const diff = Math.floor((agora.getTime() - parcela.vencimento.getTime()) / 86_400_000);
  const cabe = REGUA_COBRANCA.filter((r) => diff >= r.dias);
  const passo = cabe[cabe.length - 1];
  if (!passo || passo.estagio <= parcela.estagioCobranca) return null;
  return passo;
}

/**
 * O que vai pro proprietário: aluguel menos a taxa de administração.
 * Condomínio e IPTU passam direto — são dele mas não são receita nossa, e
 * cobrar taxa sobre eles é a reclamação clássica de proprietário.
 */
export function calcularRepasse(contrato: Contrato, valorRecebido: number) {
  const taxa = round2(contrato.valorAluguel * (contrato.taxaAdministracao / 100));
  return {
    taxa,
    aoProprietario: round2(valorRecebido - taxa),
  };
}

/** Aniversário do contrato: 12 meses do último reajuste, ou do início. */
export function proximoReajuste(contrato: Contrato): Date {
  const base = contrato.ultimoReajuste ?? contrato.inicio;
  return new Date(base.getFullYear() + 1, base.getMonth(), base.getDate());
}

/**
 * Reajuste devido, com o índice acumulado vindo de fora.
 *
 * `indiceAcumulado` é percentual (7.2 = 7,2%). Chega por parâmetro de
 * propósito: nem o modelo nem o banco sabem quanto foi o IGPM do ano, e
 * inventar esse número seria a pior mentira que este sistema poderia contar.
 */
export function reajusteDevido(
  contrato: Contrato,
  indiceAcumulado: number | null,
  agora = new Date(),
): { devido: boolean; em: Date; valorAtual: number; valorNovo: number | null } {
  const em = proximoReajuste(contrato);
  const devido = agora >= em && em <= contrato.fim;
  return {
    devido,
    em,
    valorAtual: contrato.valorAluguel,
    valorNovo:
      devido && indiceAcumulado !== null
        ? round2(contrato.valorAluguel * (1 + indiceAcumulado / 100))
        : null,
  };
}

/**
 * Avisos de fim de vigência. 90 dias é o ponto em que ainda dá pra renovar com
 * calma ou recolocar o imóvel no mercado sem mês vago; 30 já é corrida.
 */
export function avisosDeVigencia(contrato: Contrato, agora = new Date()) {
  const dias = Math.floor((contrato.fim.getTime() - agora.getTime()) / 86_400_000);
  for (const marco of [90, 60, 30] as const) {
    if (dias <= marco && dias > marco - 30) {
      return { dias, marco, texto: `Contrato encerra em ${dias} dias` };
    }
  }
  if (dias <= 0) return { dias, marco: 0, texto: "Contrato vencido" };
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
