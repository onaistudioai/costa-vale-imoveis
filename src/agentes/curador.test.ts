import { describe, expect, it } from "vitest";
import { curar, decidirEstado, type ExtracaoLaudo } from "./curador";
import { contextoFalso } from "./_teste/contexto-falso";
import type { Extrator } from "./modelo";

const extracao = (over: Partial<ExtracaoLaudo> = {}): ExtracaoLaudo => ({
  pendencias: [],
  precoMencionado: null,
  confianca: "alta",
  resumo: "tudo certo",
  ...over,
});

const extratorFalso = (e: ExtracaoLaudo): Extrator => (async () => e) as Extrator;

const laudo = {
  idLaudo: "l1",
  idImovel: "i1",
  textoEstado: "passei lá hoje",
  textoDocumentacao: "saiu",
  textoPendencias: "nenhuma",
};

describe("decidirEstado — a regra, sem modelo", () => {
  it("libera quando não há pendência nenhuma", () => {
    expect(decidirEstado("em_preparacao", extracao())).toBe("pronto");
  });

  it("segura quando falta pendência obrigatória", () => {
    expect(
      decidirEstado(
        "em_preparacao",
        extracao({
          pendencias: [
            { descricao: "entulho no fundo", categoria: "limpeza", resolvida: false, obrigatoria: true },
          ],
        }),
      ),
    ).toBe("com_pendencia");
  });

  it("pendência opcional aberta deixa em preparação, não libera", () => {
    expect(
      decidirEstado(
        "captado",
        extracao({
          pendencias: [
            { descricao: "pintar o portão", categoria: "outro", resolvida: false, obrigatoria: false },
          ],
        }),
      ),
    ).toBe("em_preparacao");
  });

  it("confiança baixa nunca libera — na dúvida o agente segura", () => {
    expect(decidirEstado("em_preparacao", extracao({ confianca: "baixa" }))).toBe(
      "com_pendencia",
    );
  });

  it("reprovado não sai por laudo, só por decisão humana", () => {
    expect(decidirEstado("reprovado", extracao())).toBe("reprovado");
  });
});

describe("Agente 1 — o caso da spec", () => {
  // "passei lá hoje, a casa tá em ordem, só falta o pessoal tirar o entulho
  // do fundo" — nenhum formulário captura isso, e não pode liberar.
  const soFaltaOEntulho = extracao({
    pendencias: [
      { descricao: "tirar entulho do fundo", categoria: "limpeza", resolvida: false, obrigatoria: true },
      { descricao: "casa em ordem", categoria: "outro", resolvida: true, obrigatoria: false },
    ],
    resumo: "Falta retirar o entulho do fundo.",
  });

  it("não libera e não pede aprovação pra anunciar", async () => {
    const { ctx, pedidos } = contextoFalso("1_curador");
    const r = await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "em_preparacao", estadoComercial: "disponivel" },
      extratorFalso(soFaltaOEntulho),
    );
    expect(r.novoEstadoOperacional).toBe("com_pendencia");
    expect(r.pediuAprovacaoParaAnunciar).toBe(false);
    expect(pedidos).toHaveLength(0);
  });
});

describe("Agente 1 — gate N2 de subir anúncio", () => {
  it("pronto + disponível pede aprovação e só sobe depois do sim", async () => {
    const { ctx, pedidos, escritas } = contextoFalso("1_curador", {
      aprovado: true,
      por: "fabiano",
    });
    await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "em_preparacao", estadoComercial: "disponivel" },
      extratorFalso(extracao()),
    );
    expect(pedidos[0]).toMatchObject({ tipo: "subir_anuncio", idEntidade: "i1" });
    expect(escritas.some((e) => e.campo === "imovel.estadoAnuncio" && e.valorNovo === "no_ar")).toBe(
      true,
    );
  });

  it("humano nega e o anúncio não sobe", async () => {
    const { ctx, escritas } = contextoFalso("1_curador", { aprovado: false, por: "fabiano" });
    await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "em_preparacao", estadoComercial: "disponivel" },
      extratorFalso(extracao()),
    );
    expect(escritas.some((e) => e.campo === "imovel.estadoAnuncio")).toBe(false);
  });

  it("o limite do Agente 1: imóvel em negociação não vai pro ar mesmo pronto", async () => {
    const { ctx, pedidos, escritas } = contextoFalso("1_curador");
    const r = await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "em_preparacao", estadoComercial: "em_negociacao" },
      extratorFalso(extracao()),
    );
    expect(r.novoEstadoOperacional).toBe("pronto");
    expect(pedidos).toHaveLength(0);
    expect(escritas.some((e) => e.campo === "imovel.estadoAnuncio")).toBe(false);
  });
});

describe("Agente 1 — auditoria e propriedade de dado", () => {
  it("guarda a extração ao lado do laudo original", async () => {
    const { ctx, escritas } = contextoFalso("1_curador");
    const e = extracao({ resumo: "documentação saiu" });
    await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "captado", estadoComercial: "disponivel" },
      extratorFalso(e),
    );
    const gravado = escritas.find((x) => x.campo === "laudo");
    expect(JSON.parse(gravado!.valorNovo!)).toEqual(e);
  });

  it("grava preço quando o laudo declara um valor", async () => {
    const { ctx, escritas } = contextoFalso("1_curador");
    await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "captado", estadoComercial: "em_negociacao" },
      extratorFalso(extracao({ precoMencionado: 415000 })),
    );
    expect(escritas.find((e) => e.campo === "imovel.preco")?.valorNovo).toBe("415000");
  });

  it("nunca escreve estado comercial — esse campo é do Agente 2 (R5)", async () => {
    const { ctx, escritas } = contextoFalso("1_curador");
    await curar(
      ctx,
      laudo,
      { idImovel: "i1", estadoOperacional: "captado", estadoComercial: "disponivel" },
      extratorFalso(extracao()),
    );
    expect(escritas.every((e) => !e.campo.includes("Comercial"))).toBe(true);
  });
});
