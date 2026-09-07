import { describe, expect, it, vi } from "vitest";
import { rotear, type EntradaAgente3, type PortasRoteador } from "./roteador";
import { contextoFalso } from "./_teste/contexto-falso";
import type { ConfigRoteamento } from "@/tipos";

const AGORA = new Date("2026-09-06T12:00:00Z");
const slot = (h: number) => ({
  inicio: new Date(AGORA.getTime() + h * 3_600_000),
  fim: new Date(AGORA.getTime() + (h + 1) * 3_600_000),
});

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

const portasOk = (): PortasRoteador => ({
  reservarAgenda: vi.fn(async () => ({ idEvento: "ev-agenda-1" })),
  renovarVinculo: vi.fn(async () => {}),
  notificarCorretor: vi.fn(async () => {}),
});

const entrada = (over: Partial<EntradaAgente3> = {}): EntradaAgente3 => ({
  idCliente: "c1",
  idImovel: "i1",
  corretores: [{ idCorretor: "ana", ativo: true }],
  dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
  agendaLivre: { ana: [slot(3)] },
  carga: { ana: 1 },
  agora: AGORA,
  resumoDaConversa: "quer visitar sábado",
  estadoComercialMudou: false,
  ...over,
});

describe("Agente 3 — alocação", () => {
  it("reserva agenda, renova vínculo e notifica o corretor", async () => {
    const { ctx, escritas, pedidos } = contextoFalso("3_roteador");
    const portas = portasOk();

    const r = await rotear(ctx, entrada(), config, portas);

    expect(r).toMatchObject({ decisao: "alocado", idCorretor: "ana", via: "pontuacao" });
    expect(portas.reservarAgenda).toHaveBeenCalledOnce();
    expect(portas.renovarVinculo).toHaveBeenCalledWith({
      idCliente: "c1",
      idCorretor: "ana",
      agora: AGORA,
    });
    expect(portas.notificarCorretor).toHaveBeenCalledOnce();
    // Escreve só no que é dele (R5): agenda e vínculo.
    expect(escritas.map((e) => e.campo).sort()).toEqual(["agenda", "vinculoLeadCorretor"]);
    // Um pedido só, e é a oferta — não gate da equipe. O corretor aceitou na
    // primeira, então ninguém passou a vez.
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ tipo: "aceite_corretor", idEntidade: "ana" });
    expect(r).toMatchObject({ recusaram: [] });
  });

  it("passa o resumo da conversa pro corretor — é o contexto que ele precisa", async () => {
    const { ctx } = contextoFalso("3_roteador");
    const portas = portasOk();
    await rotear(ctx, entrada(), config, portas);
    expect(portas.notificarCorretor).toHaveBeenCalledWith(
      expect.objectContaining({ resumo: "quer visitar sábado" }),
    );
  });
});

describe("Agente 3 — envelope, rebaixamento N4 → N3", () => {
  it("escala quando ninguém passa do mínimo e não reserva nada", async () => {
    const { ctx, pedidos, escritas } = contextoFalso("3_roteador");
    const portas = portasOk();

    const r = await rotear(
      ctx,
      entrada({ dominios: [], agendaLivre: { ana: [slot(47)] } }),
      config,
      portas,
    );

    expect(r).toEqual({
      decisao: "escalado",
      motivo: "nenhum_corretor_acima_do_minimo",
      recusaram: [],
    });
    expect(portas.reservarAgenda).not.toHaveBeenCalled();
    expect(escritas).toHaveLength(0);
    expect(pedidos[0]).toMatchObject({ tipo: "escalacao_n3" });
  });

  it("escala quando o imóvel mudou de estado entre a qualificação e o roteamento", async () => {
    const { ctx, pedidos } = contextoFalso("3_roteador");
    const portas = portasOk();
    const r = await rotear(ctx, entrada({ estadoComercialMudou: true }), config, portas);
    expect(r).toMatchObject({ motivo: "estado_comercial_mudou" });
    expect(portas.reservarAgenda).not.toHaveBeenCalled();
  });

  it("escala quando ninguém tem slot no horizonte", async () => {
    const { ctx } = contextoFalso("3_roteador");
    const r = await rotear(ctx, entrada({ agendaLivre: { ana: [] } }), config, portasOk());
    expect(r).toMatchObject({ motivo: "sem_slot_no_horizonte" });
  });

  it("conflito de agenda escala em vez de re-pontuar em loop", async () => {
    const { ctx, pedidos, escritas } = contextoFalso("3_roteador");
    const portas: PortasRoteador = {
      ...portasOk(),
      reservarAgenda: vi.fn(async () => ({ conflito: true as const })),
    };

    const r = await rotear(ctx, entrada(), config, portas);

    expect(r).toEqual({ decisao: "escalado", motivo: "conflito_de_agenda", recusaram: [] });
    expect(escritas).toHaveLength(0);
    // O primeiro pedido é a oferta; a escalação é a última.
    expect(pedidos.at(-1)?.contexto).toMatchObject({ motivo: "conflito_de_agenda" });
  });
});

describe("Agente 3 — push com aceite e prazo", () => {
  /** Contexto que responde diferente pra cada corretor: quem recusa, quem aceita. */
  const contextoQueRecusa = (recusam: string[]) => {
    const pedidos: { tipo: string; idEntidade: string }[] = [];
    const ctx = {
      agente: "3_roteador" as const,
      idEvento: "e1",
      escrever: async () => {},
      avisar: async () => {},
      async pedirAprovacao(p: { tipo: string; idEntidade: string }) {
        pedidos.push({ tipo: p.tipo, idEntidade: p.idEntidade });
        return { aprovado: !recusam.includes(p.idEntidade), por: p.idEntidade };
      },
    };
    return { ctx: ctx as never, pedidos };
  };

  const tres = () =>
    entrada({
      corretores: [
        { idCorretor: "ana", ativo: true },
        { idCorretor: "bruno", ativo: true },
        { idCorretor: "carla", ativo: true },
      ],
      dominios: [
        { idCorretor: "ana", idImovel: "i1", nivel: "captou" },
        { idCorretor: "bruno", idImovel: "i1", nivel: "ja_visitou" },
        { idCorretor: "carla", idImovel: "i1", nivel: "conhece_regiao" },
      ],
      agendaLivre: { ana: [slot(3)], bruno: [slot(3)], carla: [slot(3)] },
      carga: { ana: 1, bruno: 1, carla: 1 },
    });

  it("a oferta vai pro melhor colocado, com prazo e mensagem", async () => {
    const { ctx, pedidos } = contextoQueRecusa([]);
    await rotear(ctx, tres(), config, portasOk());

    expect(pedidos[0]).toMatchObject({ tipo: "aceite_corretor", idEntidade: "ana" });
  });

  it("quem passa a vez sai da disputa e o lead vai pro próximo", async () => {
    const { ctx, pedidos } = contextoQueRecusa(["ana"]);
    const portas = portasOk();

    const r = await rotear(ctx, tres(), config, portas);

    expect(pedidos.map((p) => p.idEntidade)).toEqual(["ana", "bruno"]);
    expect(r).toMatchObject({ decisao: "alocado", idCorretor: "bruno", recusaram: ["ana"] });
    // O horário só é reservado depois do aceite — reservar antes deixaria a
    // agenda de quem recusou bloqueada por nada.
    expect(portas.reservarAgenda).toHaveBeenCalledOnce();
    expect(portas.reservarAgenda).toHaveBeenCalledWith(
      expect.objectContaining({ idCorretor: "bruno" }),
    );
  });

  it("ninguém aceita: escala pro humano e diz quem passou a vez", async () => {
    const { ctx, pedidos } = contextoQueRecusa(["ana", "bruno", "carla"]);
    const portas = portasOk();

    const r = await rotear(ctx, tres(), config, portas);

    expect(r).toMatchObject({ decisao: "escalado", motivo: "ninguem_aceitou" });
    expect(r).toMatchObject({ recusaram: ["ana", "bruno", "carla"] });
    expect(portas.reservarAgenda).not.toHaveBeenCalled();
    expect(pedidos.at(-1)).toMatchObject({ tipo: "escalacao_n3" });
  });

  it("o teto de ofertas limita o rodízio mesmo com equipe grande", async () => {
    const { ctx, pedidos } = contextoQueRecusa(["ana", "bruno", "carla", "diego"]);
    const grande = tres();
    grande.corretores.push({ idCorretor: "diego", ativo: true });
    grande.dominios.push({ idCorretor: "diego", idImovel: "i1", nivel: "captou" });
    grande.agendaLivre.diego = [slot(3)];
    grande.carga.diego = 1;

    await rotear(ctx, grande, { ...config, maxOfertas: 2 }, portasOk());

    // Duas ofertas e para: insistir mais só empurra o cliente pra fila sem
    // ninguém responsável.
    expect(pedidos.filter((p) => p.tipo === "aceite_corretor")).toHaveLength(2);
  });

  it("a carteira não devolve o lead pra quem acabou de passar a vez", async () => {
    const { ctx, pedidos } = contextoQueRecusa(["bruno"]);
    const comVinculo = tres();
    comVinculo.vinculo = {
      idCliente: "c1",
      idCorretor: "bruno",
      ultimaInteracao: new Date(AGORA.getTime() - 86_400_000),
      ativo: true,
    };

    const r = await rotear(ctx, comVinculo, config, portasOk());

    // Bruno leva a primeira oferta pelo vínculo; ao recusar, sai da disputa em
    // vez de ser reescolhido pelo mesmo atalho.
    expect(pedidos.map((p) => p.idEntidade)).toEqual(["bruno", "ana"]);
    expect(r).toMatchObject({ idCorretor: "ana", via: "pontuacao" });
  });
});
