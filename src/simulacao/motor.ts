import { pontuarCorretores } from "@/regras/roteamento";
import { CONFIG_ROTEAMENTO } from "@/lib/config";
import { dentroDoExpediente, proximaAbertura } from "@/lib/expediente";
import type { Corretor, Dominio, Slot } from "@/tipos";
import { MEDIDO, PESQUISADO, SUPOSTO } from "./parametros";
import { diaDoCorretor, estadoEm, latenciaDaResposta, sorteio, type Bloco } from "./rotina";

/**
 * A simulação do caminho do lead, da chegada até ter dono.
 *
 * Duas decisões que a tornam defensável:
 *
 * 1. **A escolha do corretor é a regra de produção.** `pontuarCorretores` é
 *    importado, não reescrito. Simulação que copia a regra mede a cópia.
 * 2. **A retenção da oferta fora do expediente também é a de produção**
 *    (`dentroDoExpediente` / `proximaAbertura`), porque é ela que cria o
 *    acúmulo da manhã seguinte — e é justamente esse acúmulo que decide o
 *    resultado.
 *
 * O que a simulação acrescenta é a única coisa que o sistema real não sabe: se
 * o corretor **podia** responder no minuto em que a mensagem chegou.
 */

export interface Cenario {
  nome: string;
  /** Falso = ninguém recebe nada. É o estado de hoje: corretor sem telefone. */
  notificacaoChega: boolean;
  /**
   * Falso = a resposta do corretor não tem por onde entrar, e o aceite só
   * acontece se ele abrir o painel. É o estado de hoje, um passo adiante.
   */
  respostaInterpretada: boolean;
  prazoAceiteMin?: number;
  maxOfertas?: number;
  /** Chance de o corretor abrir o painel por conta própria dentro do prazo. */
  abrePainelSozinho?: number;
}

export interface Resultado {
  cenario: string;
  leads: number;
  ofertas: number;
  entregues: number;
  aceitas: number;
  /** Aceites ÷ ofertas entregues. Vazio quando nada foi entregue. */
  taxaDeteccao: number | null;
  medianaAceiteMin: number | null;
  p90AceiteMin: number | null;
  medianaAteDonoMin: number | null;
  semDono: number;
  percentualSemDono: number;
  /** Ninguém pontuou o bastante: nem chegou a haver oferta. */
  semDonoPorEscalacao: number;
  /** Houve oferta, ninguém respondeu no prazo. É o que a rotina explica. */
  semDonoPorSilencio: number;
}

interface Oferta {
  idCorretor: string;
  enviadaEm: Date;
  respondidaEm: Date | null;
}

const MIN = 60_000;

const mediana = (xs: number[]) => percentil(xs, 0.5);

function percentil(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const ord = [...xs].sort((a, b) => a - b);
  return ord[Math.min(ord.length - 1, Math.floor(p * ord.length))]!;
}

/** Slots sempre disponíveis: a agenda não é o gargalo que estamos medindo. */
const slotsDe = (agora: Date): Slot[] => [
  { inicio: new Date(agora.getTime() + 20 * 60 * MIN), fim: new Date(agora.getTime() + 21 * 60 * MIN) },
];

/**
 * Quem conhece o imóvel deste lead.
 *
 * Não é enfeite: sem domínio nenhum a pontuação de produção fica em 35, abaixo
 * do mínimo de 40, e a regra escala em vez de alocar — o mesmo caso que o
 * estoque de demonstração guarda de propósito ("2 imóveis sem domínio nenhum").
 * Ignorar isso faria a simulação medir um sistema que não existe.
 */
function dominiosDoLead(corretores: Corretor[], aleatorio: () => number): Dominio[] {
  const saida: Dominio[] = [];
  for (const c of corretores) {
    if (aleatorio() > 0.6) continue;
    const d = aleatorio();
    saida.push({
      idCorretor: c.idCorretor,
      idImovel: "i1",
      nivel: d < 0.05 ? "captou" : d < 0.3 ? "ja_visitou" : "conhece_regiao",
    });
  }
  return saida;
}

export function simular(cenario: Cenario, dias = 30, semente = 42): Resultado {
  const aleatorio = sorteio(semente);
  const prazo = cenario.prazoAceiteMin ?? MEDIDO.prazoAceiteMin.valor;
  const maxOfertas = cenario.maxOfertas ?? MEDIDO.maxOfertas.valor;
  const abrePainel = cenario.abrePainelSozinho ?? 0;

  const corretores: Corretor[] = Array.from(
    { length: MEDIDO.corretoresAtivos.valor },
    (_, i) => ({ idCorretor: `c${i + 1}`, ativo: true }),
  );

  const inicio = new Date(2026, 8, 1, 0, 0, 0);
  const rotinas = new Map<string, Bloco[]>();

  const temposAceite: number[] = [];
  const temposAteDono: number[] = [];
  let leads = 0;
  let ofertas = 0;
  let entregues = 0;
  let aceitas = 0;
  let semDono = 0;
  let semDonoPorEscalacao = 0;
  let semDonoPorSilencio = 0;

  for (let dia = 0; dia < dias; dia++) {
    const data = new Date(inicio.getTime() + dia * 24 * 60 * MIN);

    for (const c of corretores) {
      rotinas.set(`${c.idCorretor}#${dia}`, diaDoCorretor(data, aleatorio));
    }

    for (let n = 0; n < SUPOSTO.leadsPorDia.valor; n++) {
      leads += 1;

      // O lead chega a qualquer hora — é o atendimento que é 24h. A retenção
      // até o expediente é regra de produção, não invenção da simulação.
      const chegada = new Date(data.getTime() + Math.floor(aleatorio() * 24 * 60) * MIN);
      const dominios = dominiosDoLead(corretores, aleatorio);
      const excluidos: string[] = [];
      let dono: string | null = null;
      let tentativa = 0;

      while (tentativa < maxOfertas && !dono) {
        const agora = tentativa === 0 ? chegada : new Date(chegada.getTime() + tentativa * prazo * MIN);
        const quando = dentroDoExpediente(agora) ? agora : proximaAbertura(agora);

        const r = pontuarCorretores(
          {
            idCliente: `l${leads}`,
            idImovel: "i1",
            corretores,
            dominios,
            agendaLivre: Object.fromEntries(corretores.map((c) => [c.idCorretor, slotsDe(quando)])),
            carga: Object.fromEntries(corretores.map((c) => [c.idCorretor, 0])),
            agora: quando,
            excluidos,
          },
          CONFIG_ROTEAMENTO,
        );

        if (r.decisao !== "alocado") {
          // Ninguém pontuou o bastante. É escalação, não silêncio — e as duas
          // pedem providências opostas: uma é falta de gente que conhece a
          // região, a outra é gente que não respondeu.
          if (tentativa === 0) semDonoPorEscalacao += 1;
          break;
        }

        tentativa += 1;
        ofertas += 1;
        excluidos.push(r.idCorretor);

        if (!cenario.notificacaoChega) continue;
        entregues += 1;

        const diaDoTurno = Math.floor((quando.getTime() - inicio.getTime()) / (24 * 60 * MIN));
        const blocos = rotinas.get(`${r.idCorretor}#${diaDoTurno}`) ?? diaDoCorretor(quando, aleatorio);
        const estado = estadoEm(blocos, quando);

        const latencia = cenario.respostaInterpretada
          ? latenciaDaResposta(estado, blocos, quando, aleatorio)
          : aleatorio() < abrePainel
            ? latenciaDaResposta(estado, blocos, quando, aleatorio)
            : null;

        const oferta: Oferta = { idCorretor: r.idCorretor, enviadaEm: quando, respondidaEm: null };

        if (latencia !== null && latencia <= prazo) {
          aceitas += 1;
          dono = r.idCorretor;
          oferta.respondidaEm = new Date(quando.getTime() + latencia * MIN);
          temposAceite.push(latencia);
          temposAteDono.push((oferta.respondidaEm.getTime() - chegada.getTime()) / MIN);
        }
      }

      if (!dono) {
        semDono += 1;
        if (tentativa > 0) semDonoPorSilencio += 1;
      }
    }
  }

  return {
    cenario: cenario.nome,
    leads,
    ofertas,
    entregues,
    aceitas,
    taxaDeteccao: entregues === 0 ? null : aceitas / entregues,
    medianaAceiteMin: mediana(temposAceite),
    p90AceiteMin: percentil(temposAceite, 0.9),
    medianaAteDonoMin: mediana(temposAteDono),
    semDono,
    percentualSemDono: semDono / leads,
    semDonoPorEscalacao,
    semDonoPorSilencio,
  };
}

/**
 * O dinheiro que os leads sem dono levam embora.
 *
 * Devolve **faixa**, nunca número único: o custo por lead vem de mercado
 * estrangeiro e a conversão tem intervalo largo. Faixa é honesta; um número
 * redondo aqui seria invenção com cara de contabilidade.
 */
export function custoPerdido(r: Resultado, dias = 30) {
  const [cplMin, cplMax] = PESQUISADO.custoPorLeadUsd.valor;
  const cambio = PESQUISADO.dolar.valor;
  const [convMin, convMax] = PESQUISADO.conversaoLeadFechamento.valor;
  const ticket = MEDIDO.precoMedioImovel.valor;
  const comissao = MEDIDO.comissaoPercentual.valor / 100;

  const perdidos = r.semDono;
  const aquisicao: [number, number] = [perdidos * cplMin * cambio, perdidos * cplMax * cambio];
  const receita: [number, number] = [
    perdidos * convMin * ticket * comissao,
    perdidos * convMax * ticket * comissao,
  ];

  return {
    dias,
    leadsPerdidos: perdidos,
    aquisicaoDesperdicada: aquisicao,
    receitaEsperadaPerdida: receita,
    porMes: [aquisicao[0] + receita[0], aquisicao[1] + receita[1]] as [number, number],
  };
}
