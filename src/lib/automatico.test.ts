import { describe, expect, it } from "vitest";
import { contarPorModo, semRevisao, type LinhaAutomatica } from "./automatico";

const linha = (over: Partial<LinhaAutomatica> = {}): LinhaAutomatica => ({
  id: "1",
  agenteOrigem: "regra",
  entidade: "parcela",
  idEntidade: "p1",
  campo: "parcela.cobranca",
  valorAnterior: null,
  valorNovo: "estágio 2",
  timestamp: new Date(),
  modo: "hotl",
  porque: "porque sim",
  ...over,
});

describe("separar o que precisa de olho", () => {
  it("só o que roda sem revisão entra na lista curta", () => {
    const linhas = [
      linha({ modo: "hotl" }),
      linha({ modo: "hootl", campo: "cliente.criado" }),
      linha({ modo: "hootl", campo: "identidade.reconhecida" }),
    ];
    expect(semRevisao(linhas)).toHaveLength(2);
  });

  it("linha sem modo declarado não é contada como sem revisão por acidente", () => {
    expect(semRevisao([linha({ modo: null })])).toHaveLength(0);
  });
});

describe("contadores do topo", () => {
  it("conta por modo", () => {
    const c = contarPorModo([
      linha({ modo: "hotl" }),
      linha({ modo: "hotl" }),
      linha({ modo: "hootl" }),
    ]);
    expect(c).toMatchObject({ hotl: 2, hootl: 1, indefinido: 0 });
  });

  it("campo antigo que sumiu do código aparece como indefinido, não some da tela", () => {
    // Linha velha no banco com um campo que o código não escreve mais: a tela
    // não pode engolir o registro só porque ninguém declarou o modo dele.
    const c = contarPorModo([linha({ modo: null })]);
    expect(c.indefinido).toBe(1);
  });

  it("lista vazia não quebra os contadores", () => {
    expect(contarPorModo([])).toEqual({ hotl: 0, hootl: 0, indefinido: 0 });
  });
});
