import { pontuarCorretores, type EntradaRoteamento } from "@/regras/roteamento";
import type { AgenteContexto } from "./contrato";
import type { ConfigRoteamento, Slot } from "@/tipos";

/**
 * Agente 3 — Roteador de Corretor.
 *
 * Reativo, quase gatilho. N4 dentro do envelope (PROJECT_SPEC seção 10).
 * NÃO chama modelo de linguagem: a decisão inteira está em
 * `pontuarCorretores`, que já é determinística e testada. Aqui só sobra o
 * efeito colateral — oferecer, reservar agenda, renovar vínculo, notificar.
 *
 * O modelo de distribuição é **push com aceite e prazo**: o melhor corretor
 * recebe primeiro e tem `prazoAceiteMin` pra aceitar. Não aceitou (ou deixou o
 * prazo passar), o lead passa pro próximo colocado; esgotadas as tentativas,
 * vira problema de gente. O oposto do "shark tank": ninguém compete, mas
 * ninguém também fica com um lead parado na mão.
 */

export interface PortasRoteador {
  /** Reserva o slot. Deve falhar se alguém pegou o horário no meio do caminho. */
  reservarAgenda(e: {
    idCorretor: string;
    idImovel: string;
    idCliente: string;
    slot: Slot;
  }): Promise<{ idEvento: string } | { conflito: true }>;

  renovarVinculo(v: { idCliente: string; idCorretor: string; agora: Date }): Promise<void>;

  /** Confirmação pós-aceite: o lead é seu, a visita está reservada. */
  notificarCorretor(n: {
    idCorretor: string;
    idCliente: string;
    idImovel: string;
    resumo: string;
  }): Promise<void>;
}

export interface EntradaAgente3 extends EntradaRoteamento {
  resumoDaConversa: string;
  /** Lido no momento do roteamento — se mudou desde a qualificação, escala. */
  estadoComercialMudou: boolean;
}

export type SaidaAgente3 =
  | {
      decisao: "alocado";
      idCorretor: string;
      idEventoAgenda: string;
      via: "vinculo" | "pontuacao";
      /** Quem passou a vez antes deste aceitar. Vai pro log e pro painel. */
      recusaram: string[];
    }
  | { decisao: "escalado"; motivo: string; recusaram: string[] };

const horario = (s: Slot) =>
  new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(s.inicio);

export async function rotear(
  ctx: AgenteContexto<"3_roteador">,
  entrada: EntradaAgente3,
  config: ConfigRoteamento,
  portas: PortasRoteador,
): Promise<SaidaAgente3> {
  const recusaram: string[] = [];

  // O laço vive DENTRO do agente de propósito. Cada oferta é uma pausa do
  // grafo (R7): na primeira passada ela interrompe, e na retomada o `memo`
  // devolve a resposta e o laço continua de onde estava. Isso mantém o
  // histórico de quem recusou sem inventar campo de estado nenhum.
  for (let tentativa = 0; tentativa < config.maxOfertas; tentativa++) {
    const r = pontuarCorretores(
      { ...entrada, excluidos: recusaram },
      config,
      entrada.estadoComercialMudou,
    );

    if (r.decisao === "escalar") {
      // Saiu do envelope: não improvisa, entrega pro humano. É o rebaixamento
      // N4 → N3 descrito na seção 10.
      await ctx.pedirAprovacao({
        tipo: "escalacao_n3",
        entidade: "cliente",
        idEntidade: entrada.idCliente,
        contexto: {
          motivo: r.motivo,
          idImovel: entrada.idImovel,
          resumo: entrada.resumoDaConversa,
          recusaram,
        },
      });
      return { decisao: "escalado", motivo: r.motivo, recusaram };
    }

    // A oferta. O grafo para aqui até o corretor responder ou o prazo estourar
    // — a varredura de prazo é quem devolve `aprovado: false` no silêncio.
    const aceite = await ctx.pedirAprovacao({
      tipo: "aceite_corretor",
      entidade: "corretor",
      // Chave por corretor: cada oferta do mesmo evento é uma linha própria, e
      // a mesma oferta nunca vira duas.
      idEntidade: r.idCorretor,
      destinatario: r.idCorretor,
      prazoMin: config.prazoAceiteMin,
      mensagem: `Lead novo pra você: ${entrada.resumoDaConversa} Sugestão de visita ${horario(r.slot)}. Responde aqui se puder pegar — em ${config.prazoAceiteMin} min eu passo pro próximo.`,
      contexto: {
        idCliente: entrada.idCliente,
        idImovel: entrada.idImovel,
        via: r.via,
        tentativa: tentativa + 1,
        resumo: entrada.resumoDaConversa,
        inicio: r.slot.inicio,
      },
    });

    if (!aceite.aprovado) {
      recusaram.push(r.idCorretor);
      continue;
    }

    const reserva = await portas.reservarAgenda({
      idCorretor: r.idCorretor,
      idImovel: entrada.idImovel,
      idCliente: entrada.idCliente,
      slot: r.slot,
    });

    // O slot sumiu entre a oferta e a reserva. Não vale re-pontuar em loop: a
    // agenda está disputada, e humano decide mais rápido que retry.
    if ("conflito" in reserva) {
      await ctx.pedirAprovacao({
        tipo: "escalacao_n3",
        entidade: "cliente",
        idEntidade: entrada.idCliente,
        contexto: {
          motivo: "conflito_de_agenda",
          idCorretor: r.idCorretor,
          idImovel: entrada.idImovel,
        },
      });
      return { decisao: "escalado", motivo: "conflito_de_agenda", recusaram };
    }

    await ctx.escrever({
      campo: "agenda",
      idEntidade: reserva.idEvento,
      valorNovo: `reservado:${r.idCorretor}`,
    });

    await portas.renovarVinculo({
      idCliente: entrada.idCliente,
      idCorretor: r.idCorretor,
      agora: entrada.agora,
    });

    await ctx.escrever({
      campo: "vinculoLeadCorretor",
      idEntidade: entrada.idCliente,
      valorNovo: r.idCorretor,
    });

    await portas.notificarCorretor({
      idCorretor: r.idCorretor,
      idCliente: entrada.idCliente,
      idImovel: entrada.idImovel,
      resumo: entrada.resumoDaConversa,
    });

    return {
      decisao: "alocado",
      idCorretor: r.idCorretor,
      idEventoAgenda: reserva.idEvento,
      via: r.via,
      recusaram,
    };
  }

  // Bateu o teto de ofertas. Não é falha de pontuação — é equipe sem resposta,
  // e isso é problema de gestão, não de algoritmo.
  await ctx.pedirAprovacao({
    tipo: "escalacao_n3",
    entidade: "cliente",
    idEntidade: entrada.idCliente,
    contexto: {
      motivo: "ninguem_aceitou",
      idImovel: entrada.idImovel,
      resumo: entrada.resumoDaConversa,
      recusaram,
    },
  });
  return { decisao: "escalado", motivo: "ninguem_aceitou", recusaram };
}
