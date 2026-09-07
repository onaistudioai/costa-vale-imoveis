import { END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { curar } from "@/agentes/curador";
import { guardar } from "@/agentes/guardiao";
import { rotear } from "@/agentes/roteador";
import { atender } from "@/agentes/atendimento";
import { alterar } from "@/agentes/alterador";
import type { AgenteContexto, PedidoAprovacao } from "@/agentes/contrato";
import type { Extrator } from "@/agentes/modelo";
import { comProcedencia } from "@/agentes/procedencia";
import { comCerebro } from "@/cerebro/aplicar";
import type { Agente } from "@/tipos";
import { EstadoGrafo, type EstadoGrafoT } from "./estado";
import { donoDoEvento, threadDoEvento } from "./eventos";
import type { Dependencias } from "./mundo";
import {
  contextoDoNo,
  executarAgente,
  extratorMemoizado,
  type Decisao,
} from "./no";

/**
 * O grafo de verdade: quatro nós de agente, um nó de gate, e nada mais.
 *
 * A separação agente/gate é a R7 em forma de topologia (ver src/grafo/no.ts):
 * nenhum nó que chama modelo ou escreve no banco é o mesmo nó que chama
 * `interrupt()`.
 */

const NOS: Record<Agente, string> = {
  "1_curador": "curador",
  "2_guardiao": "guardiao",
  "3_roteador": "roteador",
  "4_atendimento": "atendimento",
  "6_alterador": "alterador",
};

/** Envelope comum dos quatro nós: contexto, memo, e tradução da pausa. */
function no<A extends Agente>(
  agente: A,
  deps: Dependencias,
  corpo: (
    ctx: AgenteContexto<A>,
    s: EstadoGrafoT,
    extrair: Extrator,
  ) => Promise<Partial<EstadoGrafoT>>,
) {
  return async (s: EstadoGrafoT): Promise<Partial<EstadoGrafoT>> => {
    const novos: Record<string, unknown> = {};
    // A procedência fica POR DENTRO da memoização, e a ordem é o ponto: a
    // re-execução que a R7 exige não vira segunda linha na auditoria, pela
    // mesma razão que não vira segunda cobrança no modelo.
    const comAuditoria = deps.registrarLeitura
      ? comProcedencia(
          deps.extrator,
          { agente, idEvento: s.evento.idEvento },
          deps.registrarLeitura,
        )
      : deps.extrator;

    // O cérebro fica POR FORA da procedência: assim o hash registrado é o do
    // prompt que o modelo recebeu de verdade, com as notas dentro — e ligar
    // uma nota aparece como versão nova na aferição, que é justamente a
    // pergunta a responder ("a nota ajudou?").
    const notas = deps.notasDoCerebro ? await deps.notasDoCerebro(agente) : [];
    const extrair = extratorMemoizado(
      comCerebro(comAuditoria, notas),
      s.memo,
      `${agente}:${s.evento.idEvento}`,
      novos,
    );
    const ctx = contextoDoNo(
      agente,
      s.evento.idEvento,
      threadDoEvento(s.evento),
      s.memo,
      deps.io,
    );

    const r = await executarAgente(() => corpo(ctx, s, extrair));

    if (r.pausa) {
      return {
        trilha: [`${NOS[agente]}:pausa`],
        memo: novos,
        pausa: { chave: r.pausa.chave, agente, pedido: r.pausa.pedido },
      };
    }
    return { ...r.valor, trilha: [NOS[agente]], memo: novos, pausa: null };
  };
}

export function construirGrafo(deps: Dependencias) {
  const curador = no("1_curador", deps, async (ctx, s, extrair) => {
    const { laudo, imovel } = await deps.mundo.carregarCurador(s.evento);
    await curar(ctx, laudo, imovel, extrair, deps.mundo.portasCurador);
    return {};
  });

  const guardiao = no("2_guardiao", deps, async (ctx, s, extrair) => {
    const entrada = await deps.mundo.carregarGuardiao(s.evento);
    await guardar(ctx, entrada, extrair);
    return {};
  });

  const roteador = no("3_roteador", deps, async (ctx, s) => {
    // O lead chega pela aresta (handoff do Agente 4) ou pelo próprio evento
    // `lead.qualificado`. Nos dois casos é payload de estado — R4, nunca
    // chamada direta.
    const lead =
      s.leadQualificado ??
      (s.evento.payload?.lead as EstadoGrafoT["leadQualificado"]);
    if (!lead) throw new Error(`evento ${s.evento.idEvento} sem lead qualificado`);

    const entrada = await deps.mundo.carregarRoteador(s.evento, lead);
    const r = await rotear(ctx, entrada, deps.config, deps.mundo.portasRoteador);

    return r.decisao === "alocado"
      ? {
          alocacao: { idCorretor: r.idCorretor, idEvento: r.idEventoAgenda, via: r.via },
        }
      : { escalacao: { motivo: r.motivo, contexto: { idCliente: lead.idCliente } } };
  });

  const atendimento = no("4_atendimento", deps, async (ctx, s, extrair) => {
    const entrada = await deps.mundo.carregarAtendimento(s.evento);
    const r = await atender(ctx, entrada, extrair);
    // Só chega aqui na passada que completa — a escalação aborta antes.
    await deps.mundo.responder(s.evento, r.resposta);
    return {
      resposta: r.resposta,
      leadQualificado: r.leadQualificado,
      escalacao: r.escalacao ? { motivo: r.escalacao.motivo, contexto: {} } : undefined,
    };
  });

  const alterador = no("6_alterador", deps, async (ctx, s, extrair) => {
    const texto = String(s.evento.payload?.texto ?? "");
    if (!texto) throw new Error(`evento ${s.evento.idEvento} sem texto da alteração`);
    const r = await alterar(ctx, texto, extrair, deps.mundo.portasAlterador);
    return { alteracao: r };
  });

  /**
   * O único nó que interrompe, e o `interrupt()` é a primeira linha dele.
   * Não escreve, não chama modelo, não lê banco: só troca decisão por memo.
   */
  const gate = async (s: EstadoGrafoT): Promise<Partial<EstadoGrafoT>> => {
    const decisao = interrupt<PedidoAprovacao, Decisao>(s.pausa!.pedido);
    return { memo: { [s.pausa!.chave]: decisao }, trilha: ["gate"] };
  };

  const g = new StateGraph(EstadoGrafo)
    .addNode("curador", curador)
    .addNode("guardiao", guardiao)
    .addNode("roteador", roteador)
    .addNode("atendimento", atendimento)
    .addNode("alterador", alterador)
    .addNode("gate", gate)
    // R1 em runtime: o dono do evento escolhe o nó. Nenhum nó decide sozinho
    // se o evento é dele.
    .addConditionalEdges(
      START,
      (s: EstadoGrafoT) => NOS[donoDoEvento(s.evento)],
      ["curador", "guardiao", "roteador", "atendimento", "alterador"],
    )
    // Agente pausado vai pro gate; o gate devolve pro mesmo agente, que
    // re-executa com a decisão no memo.
    .addConditionalEdges("curador", (s) => (s.pausa ? "gate" : END), ["gate", END])
    .addConditionalEdges("guardiao", (s) => (s.pausa ? "gate" : END), ["gate", END])
    .addConditionalEdges("roteador", (s) => (s.pausa ? "gate" : END), ["gate", END])
    .addConditionalEdges("alterador", (s) => (s.pausa ? "gate" : END), ["gate", END])
    // R4: o único handoff entre agentes é esta aresta. Escalação N3 sai pelo
    // humano, não pelo Agente 3 — é o que separa N3 de N4.
    .addConditionalEdges(
      "atendimento",
      (s: EstadoGrafoT) =>
        s.pausa ? "gate" : s.leadQualificado && !s.escalacao ? "roteador" : END,
      ["gate", "roteador", END],
    )
    .addConditionalEdges(
      "gate",
      (s: EstadoGrafoT) => NOS[s.pausa!.agente],
      ["curador", "guardiao", "roteador", "atendimento", "alterador"],
    );

  return g;
}

export { EstadoGrafo };
export type { EstadoGrafoT };
