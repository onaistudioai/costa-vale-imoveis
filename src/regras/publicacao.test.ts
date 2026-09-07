import { describe, expect, it } from "vitest";
import { derrubarAnuncio, podePublicar } from "./publicacao";
import type { Anuncio } from "@/tipos";

const anuncio = (over: Partial<Anuncio> = {}): Anuncio => ({
  idAnuncio: "a1",
  idImovel: "i1",
  canal: "zap",
  status: "no_ar",
  midiaPaga: false,
  custoAcumulado: 0,
  ...over,
});

describe("podePublicar", () => {
  it("sobe com pronto + disponivel + aprovado", () => {
    expect(
      podePublicar(
        { estadoOperacional: "pronto", estadoComercial: "disponivel" },
        true,
      ),
    ).toBe(true);
  });

  it("não sobe sem aprovação, mesmo com tudo pronto", () => {
    expect(
      podePublicar(
        { estadoOperacional: "pronto", estadoComercial: "disponivel" },
        false,
      ),
    ).toBe(false);
  });

  it("não sobe em negociação, mesmo pronto e aprovado — o limite do Agente 1", () => {
    expect(
      podePublicar(
        { estadoOperacional: "pronto", estadoComercial: "em_negociacao" },
        true,
      ),
    ).toBe(false);
  });

  it("não sobe imóvel reprovado", () => {
    expect(
      podePublicar(
        { estadoOperacional: "reprovado", estadoComercial: "disponivel" },
        true,
      ),
    ).toBe(false);
  });
});

describe("derrubarAnuncio", () => {
  it("não mexe em nada enquanto o imóvel está disponível", () => {
    const r = derrubarAnuncio({ estadoComercial: "disponivel" }, [anuncio()]);
    expect(r.pausarAgora).toHaveLength(0);
    expect(r.exigemAprovacao).toHaveLength(0);
  });

  it("derruba orgânico na hora e segura mídia paga pra aprovação", () => {
    const r = derrubarAnuncio({ estadoComercial: "em_negociacao" }, [
      anuncio({ idAnuncio: "organico", canal: "zap" }),
      anuncio({ idAnuncio: "pago", canal: "meta", midiaPaga: true, custoAcumulado: 340.5 }),
    ]);
    expect(r.pausarAgora.map((a) => a.idAnuncio)).toEqual(["organico"]);
    expect(r.exigemAprovacao.map((a) => a.idAnuncio)).toEqual(["pago"]);
    expect(r.custoEmRisco).toBe(340.5);
  });

  it("soma o custo de várias campanhas pagas — é o número que vai no aviso", () => {
    const r = derrubarAnuncio({ estadoComercial: "em_processo_venda" }, [
      anuncio({ idAnuncio: "m", midiaPaga: true, custoAcumulado: 100 }),
      anuncio({ idAnuncio: "g", midiaPaga: true, custoAcumulado: 55.25 }),
    ]);
    expect(r.custoEmRisco).toBe(155.25);
  });

  it("ignora anúncio que já estava pausado", () => {
    const r = derrubarAnuncio({ estadoComercial: "fechado" }, [
      anuncio({ status: "pausado", midiaPaga: true, custoAcumulado: 900 }),
    ]);
    expect(r.exigemAprovacao).toHaveLength(0);
    expect(r.custoEmRisco).toBe(0);
  });
});
