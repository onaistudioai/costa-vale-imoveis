import { describe, expect, it } from "vitest";
import { casarComEstoque, type ImovelOfertavel } from "./match";

const imovel = (over: Partial<ImovelOfertavel> = {}): ImovelOfertavel => ({
  idImovel: "i1",
  tipo: "casa",
  preco: 400_000,
  bairro: "Centro",
  cidade: "Sorocaba",
  estadoAnuncio: "no_ar",
  estadoComercial: "disponivel",
  ...over,
});

const tudo = { valorMin: null, valorMax: null, tipoImovel: null, bairrosDesejados: [] };

describe("o limite mais importante: só oferece o que está no ar", () => {
  it("descarta imóvel em negociação mesmo que o chamador passe ele", () => {
    const r = casarComEstoque(tudo, [
      imovel({ idImovel: "vendendo", estadoComercial: "em_negociacao" }),
      imovel({ idImovel: "livre" }),
    ]);
    expect(r.map((i) => i.idImovel)).toEqual(["livre"]);
  });

  it("descarta anúncio pausado e removido", () => {
    const r = casarComEstoque(tudo, [
      imovel({ idImovel: "a", estadoAnuncio: "pausado" }),
      imovel({ idImovel: "b", estadoAnuncio: "removido" }),
      imovel({ idImovel: "c", estadoAnuncio: "sem_anuncio" }),
    ]);
    expect(r).toHaveLength(0);
  });
});

describe("faixa de preço", () => {
  it("respeita mínimo e máximo", () => {
    const r = casarComEstoque({ ...tudo, valorMin: 300_000, valorMax: 450_000 }, [
      imovel({ idImovel: "barato", preco: 250_000 }),
      imovel({ idImovel: "certo", preco: 400_000 }),
      imovel({ idImovel: "caro", preco: 600_000 }),
    ]);
    expect(r.map((i) => i.idImovel)).toEqual(["certo"]);
  });

  it("fronteira é inclusiva nos dois lados", () => {
    const r = casarComEstoque({ ...tudo, valorMin: 400_000, valorMax: 400_000 }, [
      imovel({ preco: 400_000 }),
    ]);
    expect(r).toHaveLength(1);
  });

  it("imóvel sem preço cadastrado não some da lista", () => {
    const r = casarComEstoque({ ...tudo, valorMax: 300_000 }, [
      imovel({ idImovel: "sem-preco", preco: null }),
    ]);
    expect(r.map((i) => i.idImovel)).toEqual(["sem-preco"]);
  });
});

describe("tipo e bairro", () => {
  it("filtra por tipo", () => {
    const r = casarComEstoque({ ...tudo, tipoImovel: "apartamento" }, [
      imovel({ idImovel: "casa", tipo: "casa" }),
      imovel({ idImovel: "apto", tipo: "apartamento" }),
    ]);
    expect(r.map((i) => i.idImovel)).toEqual(["apto"]);
  });

  it("bairro é caixa-insensível — o cliente escreve como quiser", () => {
    const r = casarComEstoque({ ...tudo, bairrosDesejados: ["CENTRO"] }, [
      imovel({ bairro: "Centro" }),
    ]);
    expect(r).toHaveLength(1);
  });

  it("aceita qualquer um dos bairros pedidos", () => {
    const r = casarComEstoque({ ...tudo, bairrosDesejados: ["Centro", "Vila Hortência"] }, [
      imovel({ idImovel: "a", bairro: "Vila Hortência" }),
      imovel({ idImovel: "b", bairro: "Éden" }),
    ]);
    expect(r.map((i) => i.idImovel)).toEqual(["a"]);
  });

  it("sem bairro pedido, não filtra por bairro", () => {
    const r = casarComEstoque(tudo, [imovel({ bairro: null })]);
    expect(r).toHaveLength(1);
  });
});
