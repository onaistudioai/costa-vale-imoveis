import { describe, expect, it } from "vitest";
import { CASOS } from "./casos";
import { laudoDaEntrada, propor } from "./proposta";

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
