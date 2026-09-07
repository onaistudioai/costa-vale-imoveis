import { describe, expect, it } from "vitest";
import { MemorySaver, START, END, StateGraph } from "@langchain/langgraph";
import { EstadoGrafo, type EstadoGrafoT } from "./estado";
import { atender, type ExtracaoConversa } from "@/agentes/atendimento";
import { rotear, type PortasRoteador } from "@/agentes/roteador";
import { contextoFalso } from "@/agentes/_teste/contexto-falso";
import type { Extrator } from "@/agentes/modelo";
import type { ConfigRoteamento } from "@/tipos";
import type { ImovelOfertavel } from "@/regras/match";

/**
 * Gate da Wave 3: Fluxo C ponta a ponta, nos dois caminhos de vínculo e no
 * desvio N3. Aqui os nós são os agentes de verdade — só o modelo e as portas
 * de banco são substituídos.
 */

const AGORA = new Date("2026-09-06T12:00:00Z");
const slot = (h: number) => ({
  inicio: new Date(AGORA.getTime() + h * 3_600_000),
  fim: new Date(AGORA.getTime() + (h + 1) * 3_600_000),
});
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000);

const config: ConfigRoteamento = {
  janelaVinculoDias: 30,
  horizonteAgendaHoras: 48,
  scoreMinimo: 40,
  prazoAceiteMin: 5,
  maxOfertas: 3,
  pesos: {
    captou: 100,
    jaVisitou: 60,
    conheceRegiao: 25,
    disponibilidadeImediata: 40,
    cargaBaixa: 15,
  },
};

const estoque: ImovelOfertavel[] = [
  {
    idImovel: "i1",
    tipo: "casa",
    preco: 390_000,
    bairro: "Centro",
    cidade: "Sorocaba",
    estadoAnuncio: "no_ar",
    estadoComercial: "disponivel",
  },
];

const extracao = (over: Partial<ExtracaoConversa> = {}): ExtracaoConversa => ({
  resposta: "Tenho uma casa no Centro que encaixa.",
  criterios: { valorMin: null, valorMax: 400_000, tipoImovel: "casa", bairrosDesejados: [] },
  intencaoDeVisita: true,
  imovelDeInteresse: "i1",
  perguntouSobreDocumentacao: false,
  foraDoPadrao: false,
  resumo: "quer visitar a casa do Centro no sábado",
  ...over,
});

const portas = (): PortasRoteador & { notificados: string[] } => {
  const notificados: string[] = [];
  return {
    notificados,
    reservarAgenda: async () => ({ idEvento: "ev-1" }),
    renovarVinculo: async () => {},
    notificarCorretor: async (n) => void notificados.push(n.idCorretor),
  };
};

/** Monta o grafo real, com os agentes ligados nos nós. */
function montar(opts: {
  conversa: ExtracaoConversa;
  vinculo?: { idCliente: string; idCorretor: string; ultimaInteracao: Date; ativo: boolean };
  p: ReturnType<typeof portas>;
  escalacoes: string[];
}) {
  const extrator: Extrator = (async () => opts.conversa) as Extrator;

  const noAtendimento = async (s: EstadoGrafoT) => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      {
        idCliente: "c1",
        idBusca: "b1",
        canal: "whatsapp",
        historico: "",
        mensagem: "quero ver essa casa",
        estoque,
      },
      extrator,
    );
    if (r.escalacao) opts.escalacoes.push(r.escalacao.motivo);
    return {
      trilha: ["atendimento"],
      leadQualificado: r.leadQualificado,
      escalacao: r.escalacao ? { motivo: r.escalacao.motivo, contexto: {} } : undefined,
    };
  };

  const noRoteador = async (s: EstadoGrafoT) => {
    const { ctx } = contextoFalso("3_roteador");
    const lead = s.leadQualificado!;
    const r = await rotear(
      ctx,
      {
        idCliente: lead.idCliente,
        idImovel: lead.idImovel,
        corretores: [
          { idCorretor: "ana", ativo: true },
          { idCorretor: "bruno", ativo: true },
        ],
        dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
        agendaLivre: { ana: [slot(3)], bruno: [slot(3)] },
        carga: { ana: 1, bruno: 1 },
        agora: AGORA,
        vinculo: opts.vinculo,
        resumoDaConversa: lead.resumo,
        estadoComercialMudou: false,
      },
      config,
      opts.p,
    );
    if (r.decisao === "escalado") opts.escalacoes.push(r.motivo);
    return {
      trilha: ["roteador"],
      alocacao:
        r.decisao === "alocado"
          ? { idCorretor: r.idCorretor, idEvento: r.idEventoAgenda, via: r.via }
          : undefined,
    };
  };

  return new StateGraph(EstadoGrafo)
    .addNode("atendimento", noAtendimento)
    .addNode("roteador", noRoteador)
    .addEdge(START, "atendimento")
    .addConditionalEdges(
      "atendimento",
      (s: EstadoGrafoT) => (s.leadQualificado && !s.escalacao ? "roteador" : END),
      ["roteador", END],
    )
    .addEdge("roteador", END)
    .compile({ checkpointer: new MemorySaver() });
}

const rodar = (app: ReturnType<typeof montar>) =>
  app.invoke(
    { evento: { idEvento: "e1", tipo: "mensagem.recebida", idCliente: "c1" } },
    { configurable: { thread_id: "cliente:c1" } },
  );

describe("Fluxo C — lead chega e encontra o corretor certo", () => {
  it("vínculo expirado: pontuação manda, e quem tem domínio leva", async () => {
    const p = portas();
    const escalacoes: string[] = [];
    const r = await rodar(
      montar({
        conversa: extracao(),
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(45),
          ativo: true,
        },
        p,
        escalacoes,
      }),
    );

    expect(r.trilha).toEqual(["atendimento", "roteador"]);
    expect(r.alocacao).toMatchObject({ idCorretor: "ana", via: "pontuacao" });
    expect(p.notificados).toEqual(["ana"]);
    expect(escalacoes).toHaveLength(0);
  });

  it("vínculo dentro da janela: a carteira ganha do domínio", async () => {
    const p = portas();
    const r = await rodar(
      montar({
        conversa: extracao(),
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(5),
          ativo: true,
        },
        p,
        escalacoes: [],
      }),
    );

    expect(r.alocacao).toMatchObject({ idCorretor: "bruno", via: "vinculo" });
  });

  it("lead novo sem vínculo vai pra pontuação", async () => {
    const p = portas();
    const r = await rodar(montar({ conversa: extracao(), p, escalacoes: [] }));
    expect(r.alocacao).toMatchObject({ idCorretor: "ana", via: "pontuacao" });
  });
});

describe("Fluxo C — o desvio N3", () => {
  it("conversa fora do padrão para no atendimento e não toca o Agente 3", async () => {
    const p = portas();
    const escalacoes: string[] = [];
    const r = await rodar(
      montar({ conversa: extracao({ foraDoPadrao: true }), p, escalacoes }),
    );

    // A prova do N3: o roteador nunca roda, e ninguém foi notificado.
    expect(r.trilha).toEqual(["atendimento"]);
    expect(r.alocacao).toBeUndefined();
    expect(p.notificados).toHaveLength(0);
    expect(escalacoes).toEqual(["conversa_fora_do_padrao"]);
  });

  it("sem qualificação a conversa termina sem acionar ninguém", async () => {
    const p = portas();
    const r = await rodar(
      montar({ conversa: extracao({ intencaoDeVisita: false }), p, escalacoes: [] }),
    );
    expect(r.trilha).toEqual(["atendimento"]);
    expect(p.notificados).toHaveLength(0);
  });
});
