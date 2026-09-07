import { describe, expect, it } from "vitest";
import { estadoPorEtapa, guardar, type ExtracaoNegociacao } from "./guardiao";
import { contextoFalso } from "./_teste/contexto-falso";
import type { Extrator } from "./modelo";
import type { Anuncio } from "@/tipos";

const extracao = (over: Partial<ExtracaoNegociacao> = {}): ExtracaoNegociacao => ({
  etapa: "proposta_aceita",
  valorProposto: 400000,
  confianca: "alta",
  resumo: "Imóvel 47 entrou em negociação com a Ana.",
  ...over,
});

const extratorFalso = (e: ExtracaoNegociacao): Extrator => (async () => e) as Extrator;

const anuncio = (over: Partial<Anuncio> = {}): Anuncio => ({
  idAnuncio: "a1",
  idImovel: "i1",
  canal: "zap",
  status: "no_ar",
  midiaPaga: false,
  custoAcumulado: 0,
  ...over,
});

const base = {
  idImovel: "i1",
  idTransacao: "t1",
  estadoComercialAtual: "disponivel" as const,
  documento: "vendedor aceitou a proposta de 400 mil",
  anuncios: [] as Anuncio[],
};

describe("estadoPorEtapa — a regra, sem modelo", () => {
  it("mapeia cada etapa a um estado comercial", () => {
    expect(estadoPorEtapa("proposta_feita")).toBe("em_negociacao");
    expect(estadoPorEtapa("proposta_aceita")).toBe("em_negociacao");
    expect(estadoPorEtapa("documentacao_em_analise")).toBe("em_processo_venda");
    expect(estadoPorEtapa("assinada")).toBe("fechado");
  });

  it("desistência devolve o imóvel pro mercado", () => {
    expect(estadoPorEtapa("desistencia")).toBe("disponivel");
  });
});

describe("Fluxo B — o gate de mídia paga", () => {
  it("derruba orgânico sozinho e pede aprovação só pra mídia paga", async () => {
    const { ctx, pedidos } = contextoFalso("2_guardiao");
    const r = await guardar(
      ctx,
      {
        ...base,
        anuncios: [
          anuncio({ idAnuncio: "zap", canal: "zap" }),
          anuncio({ idAnuncio: "meta", canal: "meta", midiaPaga: true, custoAcumulado: 340.5 }),
        ],
      },
      extratorFalso(extracao()),
    );

    expect(r.anunciosPausados).toEqual(["zap"]);
    expect(r.midiaAguardandoAprovacao).toEqual(["meta"]);
    expect(pedidos[0]).toMatchObject({
      tipo: "derrubar_midia",
      contexto: { custoEmRisco: 340.5 },
    });
  });

  it("o aviso à equipe traz o custo — é o número que faz a pessoa decidir", async () => {
    const { ctx, avisos } = contextoFalso("2_guardiao");
    await guardar(
      ctx,
      { ...base, anuncios: [anuncio({ canal: "meta", midiaPaga: true, custoAcumulado: 340.5 })] },
      extratorFalso(extracao()),
    );
    expect(avisos[0]).toContain("340.50");
    expect(avisos[0]).toContain("meta");
  });

  it("sem mídia paga não incomoda ninguém", async () => {
    const { ctx, pedidos } = contextoFalso("2_guardiao");
    await guardar(ctx, { ...base, anuncios: [anuncio()] }, extratorFalso(extracao()));
    expect(pedidos).toHaveLength(0);
  });
});

describe("Fluxo B — o ponto fino: proteção do lead não espera humano", () => {
  it("escreve o estado comercial ANTES de qualquer aprovação", async () => {
    // Contexto que nega a aprovação: mesmo assim o estado tem que mudar,
    // senão o Agente 4 continua oferecendo imóvel em negociação.
    const { ctx, escritas } = contextoFalso("2_guardiao", { aprovado: false, por: "fabiano" });
    await guardar(
      ctx,
      { ...base, anuncios: [anuncio({ midiaPaga: true, custoAcumulado: 900 })] },
      extratorFalso(extracao()),
    );
    const mudanca = escritas.find((e) => e.campo === "imovel.estadoComercial");
    expect(mudanca).toMatchObject({ valorAnterior: "disponivel", valorNovo: "em_negociacao" });
  });
});

describe("Agente 2 — N3, escalação por ambiguidade", () => {
  it("etapa ambígua escala pro humano", async () => {
    const { ctx, pedidos } = contextoFalso("2_guardiao");
    await guardar(ctx, base, extratorFalso(extracao({ confianca: "baixa" })));
    expect(pedidos.some((p) => p.tipo === "escalacao_n3")).toBe(true);
  });

  it("não escala quando o estado nem mudou", async () => {
    const { ctx, pedidos } = contextoFalso("2_guardiao");
    await guardar(
      ctx,
      { ...base, estadoComercialAtual: "em_negociacao" },
      extratorFalso(extracao({ confianca: "baixa" })),
    );
    expect(pedidos).toHaveLength(0);
  });
});

describe("Agente 2 — propriedade de dado (R5)", () => {
  it("nunca escreve estado operacional nem anúncio — são do Agente 1", async () => {
    const { ctx, escritas } = contextoFalso("2_guardiao");
    await guardar(ctx, { ...base, anuncios: [anuncio()] }, extratorFalso(extracao()));
    const campos = escritas.map((e) => e.campo);
    expect(campos).not.toContain("imovel.estadoOperacional");
    expect(campos).not.toContain("anuncio");
    expect(campos.sort()).toEqual(["imovel.estadoComercial", "transacao"]);
  });
});
