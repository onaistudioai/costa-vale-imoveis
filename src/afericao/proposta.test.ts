import { describe, expect, it } from "vitest";
import { CASOS } from "./casos";
import { CASOS_ALTERACAO, conferirAlteracao } from "./alteracao";
import { CASOS_NEGOCIACAO, conferirNegociacao } from "./negociacao";
import { laudoDaEntrada, propor, proporAlteracao, proporNegociacao } from "./proposta";

describe("conferência do Guardião e do Alterador", () => {
  it("guardião: desistência lida como proposta tira do mercado", () => {
    const desistiu = CASOS_NEGOCIACAO.find((c) => c.id === "desistiu")!;
    const c = conferirNegociacao(desistiu, { etapa: "proposta_feita", valorProposto: null, confianca: "alta", resumo: "" });
    expect(c).toMatchObject({ ok: false, tirouDoMercado: true });
  });

  it("alterador: preço com pontuação é o mesmo preço; valor errado com certeza é marcado", () => {
    const caso = CASOS_ALTERACAO[0]!;
    const lido = { entidade: "imovel" as const, descricaoAlvo: "", campo: "preco", confianca: "alta" as const };
    expect(conferirAlteracao(caso, { ...lido, valorNovo: "R$ 820.000" }).ok).toBe(true);
    expect(conferirAlteracao(caso, { ...lido, valorNovo: "820" })).toMatchObject({ ok: false, erradoComCerteza: true });
  });

  it("rascunhos copiam o lido, pedem conferência e não repetem caso existente", () => {
    const base = { idLeitura: "abcdef123456", motivo: "leu errado" };
    expect(proporNegociacao({ ...base, entrada: "doc novo", saida: { etapa: "assinada" } }, CASOS_NEGOCIACAO))
      .toMatchObject({ esperado: { estado: "fechado" }, porque: expect.stringContaining("CONFIRA") });
    expect(proporNegociacao({ ...base, entrada: CASOS_NEGOCIACAO[0]!.documento, saida: null }, CASOS_NEGOCIACAO)).toBeNull();
    expect(proporAlteracao({ ...base, entrada: "pedido novo", saida: { entidade: "cliente", campo: "email", valorNovo: "a@b" } }, CASOS_ALTERACAO))
      .toMatchObject({ esperado: { entidade: "cliente", campo: "email", valorNovo: "a@b" } });
  });
});

const entrada = "ESTADO DA CASA:\nok\n\nDOCUMENTAÇÃO:\nfalta certidão\n\nsegundo parágrafo\n\nPENDÊNCIAS:\nnada";

describe("proposta de caso a partir do painel", () => {
  it("desmonta a entrada nos três campos", () => {
    expect(laudoDaEntrada(entrada)).toEqual({
      textoEstado: "ok",
      textoDocumentacao: "falta certidão\n\nsegundo parágrafo",
      textoPendencias: "nada",
    });
  });

  it("propõe com o motivo e o preço lido", () => {
    const c = propor(
      { idLeitura: "abcdef123456", entrada, saida: { precoMencionado: 500000 }, motivo: "certidão" },
      CASOS,
    );
    expect(c).toMatchObject({
      id: "painel-abcdef12",
      porque: "negado no painel: certidão",
      esperado: { estado: "com_pendencia", preco: 500000 },
    });
  });

  it("não repete caso que já está no conjunto", () => {
    const l = CASOS[0]!.laudo;
    const texto = [
      l.textoEstado && `ESTADO DA CASA:\n${l.textoEstado}`,
      l.textoDocumentacao && `DOCUMENTAÇÃO:\n${l.textoDocumentacao}`,
      l.textoPendencias && `PENDÊNCIAS:\n${l.textoPendencias}`,
    ].filter(Boolean).join("\n\n");
    expect(propor({ idLeitura: "x", entrada: texto, saida: null, motivo: null }, CASOS)).toBeNull();
  });
});
