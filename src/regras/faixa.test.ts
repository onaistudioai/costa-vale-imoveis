import { describe, expect, it } from "vitest";
import {
  avisaNoCanal,
  classificar,
  LIMIARES_PADRAO,
  PESO,
  passaPelaMesa,
  type Entrada,
} from "./faixa";

describe("classificar", () => {
  it("verde: lido com confiança, barato e reversível", () => {
    expect(classificar({ confianca: "alta" })).toBe("verde");
  });

  it("verde sem confiança nenhuma — o Agente 3 não lê modelo e não fica em dúvida", () => {
    expect(classificar({})).toBe("verde");
  });

  it("amarela quando o modelo ficou no meio do caminho", () => {
    expect(classificar({ confianca: "media" })).toBe("amarela");
  });

  it("amarela quando tem dinheiro em jogo, mas pouco", () => {
    expect(classificar({ confianca: "alta", custoEmRisco: 120 })).toBe("amarela");
  });

  it("vermelha quando o modelo não entendeu o que leu", () => {
    expect(classificar({ confianca: "baixa" })).toBe("vermelha");
  });

  it("vermelha acima do teto de custo", () => {
    expect(classificar({ confianca: "alta", custoEmRisco: 4200 })).toBe("vermelha");
  });

  it("vermelha quando não dá pra desfazer, mesmo de graça e bem lido", () => {
    expect(
      classificar({ confianca: "alta", custoEmRisco: 0, reversivel: false }),
    ).toBe("vermelha");
  });

  it("vermelha quando a alteração já vinha marcada como risco alto", () => {
    expect(classificar({ confianca: "alta", risco: "alto" })).toBe("vermelha");
  });

  it("vermelha quando o caso esfria sozinho — lead sem dono não dorme na fila", () => {
    expect(classificar({ confianca: "alta", urgente: true })).toBe("vermelha");
  });

  it("basta uma razão: confiança alta não salva custo alto", () => {
    expect(classificar({ confianca: "alta", custoEmRisco: 10_000 })).toBe("vermelha");
  });
});

describe("a borda do teto", () => {
  const teto = LIMIARES_PADRAO.tetoCustoRevisao;

  it("exatamente no teto ainda é amarela — o corte é acima, não igual", () => {
    expect(classificar({ confianca: "alta", custoEmRisco: teto })).toBe("amarela");
  });

  it("um centavo acima já é vermelha", () => {
    expect(classificar({ confianca: "alta", custoEmRisco: teto + 0.01 })).toBe(
      "vermelha",
    );
  });

  it("o teto vem da configuração, não do código", () => {
    const caso: Entrada = { confianca: "alta", custoEmRisco: 300 };
    expect(classificar(caso, { tetoCustoRevisao: 1000 })).toBe("amarela");
    expect(classificar(caso, { tetoCustoRevisao: 100 })).toBe("vermelha");
  });
});

describe("o que cada faixa dispara", () => {
  it("só a amarela ocupa a mesa", () => {
    expect(passaPelaMesa("amarela")).toBe(true);
    expect(passaPelaMesa("vermelha")).toBe(false);
    expect(passaPelaMesa("verde")).toBe(false);
  });

  it("só a vermelha incomoda alguém fora do painel", () => {
    expect(avisaNoCanal("vermelha")).toBe(true);
    expect(avisaNoCanal("amarela")).toBe(false);
    expect(avisaNoCanal("verde")).toBe(false);
  });

  it("vermelha nunca passa pela mesa E avisa — os dois extremos não se cruzam", () => {
    for (const f of ["verde", "amarela", "vermelha"] as const) {
      expect(passaPelaMesa(f) && avisaNoCanal(f)).toBe(false);
    }
  });

  it("a fila mostra o que dói primeiro", () => {
    const fila = ["verde", "vermelha", "amarela"] as const;
    expect([...fila].sort((a, b) => PESO[a] - PESO[b])).toEqual([
      "vermelha",
      "amarela",
      "verde",
    ]);
  });
});

describe("os 9 pontos de parada do sistema", () => {
  // Os casos reais do mapa, pra classificação não derivar sem ninguém notar.
  const casos: Array<[string, Entrada, string]> = [
    ["subir_anuncio bem lido", { confianca: "alta" }, "verde"],
    ["subir_anuncio em dúvida", { confianca: "media" }, "amarela"],
    ["subir_anuncio ilegível", { confianca: "baixa" }, "vermelha"],
    [
      "derrubar_midia paga",
      { confianca: "alta", custoEmRisco: 4200, reversivel: false },
      "vermelha",
    ],
    ["etapa ambígua", { confianca: "media" }, "amarela"],
    ["conflito de agenda", {}, "verde"],
    ["ninguém aceitou o lead", { urgente: true }, "vermelha"],
    ["conversa fora do padrão", { confianca: "alta" }, "verde"],
    ["alteração simples", { confianca: "alta", risco: "baixo" }, "verde"],
    ["alteração de preço no ar", { confianca: "alta", risco: "alto" }, "vermelha"],
  ];

  it.each(casos)("%s → %s", (_nome, entrada, esperado) => {
    expect(classificar(entrada)).toBe(esperado);
  });
});
