import { beforeAll, describe, expect, it } from "vitest";
import { cifrar, decifrar, indice, mesmoIndice } from "./cripto";

beforeAll(() => {
  process.env.PII_KEY = "11".repeat(32);
  process.env.PII_INDEX_KEY = "22".repeat(32);
});

describe("cifrar/decifrar", () => {
  it("ida e volta devolve o valor original", () => {
    expect(decifrar(cifrar("123.456.789-00"))).toBe("123.456.789-00");
    expect(decifrar(cifrar("ana@exemplo.com"))).toBe("ana@exemplo.com");
    expect(decifrar(cifrar("acentuação e emoji 🏠"))).toBe("acentuação e emoji 🏠");
  });

  it("o mesmo valor gera cifras diferentes — senão a coluna conta quem repete", () => {
    expect(cifrar("11999990000")).not.toBe(cifrar("11999990000"));
  });

  it("a cifra não contém o valor em claro", () => {
    expect(cifrar("123.456.789-00")).not.toContain("123");
  });

  it("vazio e nulo atravessam: cifrar o nada só ocupa espaço", () => {
    expect(cifrar(null)).toBeNull();
    expect(cifrar(undefined)).toBeNull();
    expect(cifrar("")).toBe("");
    expect(decifrar(null)).toBeNull();
  });

  it("valor ainda não cifrado volta como está — é o que permite migrar sem parar", () => {
    expect(decifrar("11999990000")).toBe("11999990000");
  });

  it("adulteração é erro, não valor vazio", () => {
    const c = cifrar("segredo")!;
    const [v, iv, tag, ct] = c.split(":") as [string, string, string, string];
    // Troca o último caractere do ciphertext: a tag do GCM tem que recusar.
    const mexido = ct.slice(0, -2) + (ct.endsWith("A") ? "B=" : "A=");
    expect(() => decifrar([v, iv, tag, mexido].join(":"))).toThrow();
  });

  it("sem chave, falha alto em vez de gravar em claro", () => {
    const guardada = process.env.PII_KEY;
    delete process.env.PII_KEY;
    expect(() => cifrar("x")).toThrow(/PII_KEY/);
    process.env.PII_KEY = guardada;
  });
});

describe("indice", () => {
  it("é determinístico: é isso que faz a busca exata funcionar", () => {
    expect(indice("ana@exemplo.com")).toBe(indice("ana@exemplo.com"));
  });

  it("normaliza caixa e espaço — o e-mail chega dos canais de mil jeitos", () => {
    expect(indice("  Ana@Exemplo.COM ")).toBe(indice("ana@exemplo.com"));
  });

  it("valores diferentes dão índices diferentes", () => {
    expect(indice("ana@exemplo.com")).not.toBe(indice("joao@exemplo.com"));
  });

  it("não devolve o valor: são 64 hex e nada do original", () => {
    const i = indice("ana@exemplo.com");
    expect(i).toMatch(/^[0-9a-f]{64}$/);
    expect(i).not.toContain("ana");
  });

  it("mesmoIndice compara sem vazar tempo", () => {
    expect(mesmoIndice(indice("a"), indice("a"))).toBe(true);
    expect(mesmoIndice(indice("a"), indice("b"))).toBe(false);
  });
});
