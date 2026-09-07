import { describe, expect, it } from "vitest";
import { MEDIDO, PESQUISADO, SUPOSTO, porOrigem } from "./parametros";
import { diaDoCorretor, estadoEm, sorteio } from "./rotina";
import { custoPerdido, simular, type Cenario } from "./motor";

const base: Cenario = {
  nome: "base",
  notificacaoChega: true,
  respostaInterpretada: true,
};

describe("os parâmetros", () => {
  it("todo valor declara origem e fonte — é o que separa medida de chute", () => {
    for (const [nome, v] of Object.entries({ ...MEDIDO, ...PESQUISADO, ...SUPOSTO })) {
      expect(v.origem, nome).toMatch(/^(medido|pesquisado|suposto)$/);
      expect(v.fonte.length, nome).toBeGreaterThan(10);
    }
  });

  it("todo suposto diz o que medir pra deixar de ser suposto", () => {
    for (const [nome, v] of porOrigem("suposto")) {
      if (nome === "dolar") continue;
      expect(v.fonte, nome).toContain("MEDIR");
    }
  });

  // Duas estatísticas correm o mercado: 98%, repetida sem fonte primária, e
  // 68%, medida. Escolher a bonita transformaria a simulação em peça de venda.
  it("usa a taxa de abertura medida, não a citada", () => {
    expect(PESQUISADO.aberturaWhatsApp.valor).toBe(0.68);
  });
});

describe("o dia do corretor", () => {
  const dia = () => diaDoCorretor(new Date(2026, 8, 1), sorteio(7));

  it("cobre as 24 horas sem buraco nem sobreposição", () => {
    const blocos = dia();
    expect(blocos[0]!.de).toBe(0);
    expect(blocos[blocos.length - 1]!.ate).toBe(24);
    for (let i = 1; i < blocos.length; i++) {
      expect(blocos[i]!.de).toBeCloseTo(blocos[i - 1]!.ate, 6);
    }
  });

  it("domingo não tem expediente", () => {
    const domingo = diaDoCorretor(new Date(2026, 8, 6), sorteio(7));
    expect(domingo.every((b) => b.estado === "fora_do_expediente")).toBe(true);
  });

  it("tem tempo dirigindo e tempo em visita — que é o ponto do modelo", () => {
    const blocos = dia();
    expect(blocos.some((b) => b.estado === "dirigindo")).toBe(true);
    expect(blocos.some((b) => b.estado === "em_visita")).toBe(true);
  });

  it("às 3 da manhã ele está dormindo, e às 14h não", () => {
    const blocos = dia();
    expect(estadoEm(blocos, new Date(2026, 8, 1, 3))).toBe("dormindo");
    expect(estadoEm(blocos, new Date(2026, 8, 1, 14))).not.toBe("dormindo");
  });
});

describe("o motor", () => {
  it("mesma semente, mesmo resultado — número que muda não sustenta tese", () => {
    expect(simular(base, 10, 99)).toEqual(simular(base, 10, 99));
  });

  // A prova de que o motor não está inventando: o cenário de hoje é o de
  // corretor sem telefone, e hoje ninguém aceita nada.
  it("sem notificação, nada é entregue e ninguém aceita", () => {
    const r = simular({ ...base, nome: "hoje", notificacaoChega: false }, 10);
    expect(r.entregues).toBe(0);
    expect(r.aceitas).toBe(0);
    expect(r.taxaDeteccao).toBeNull();
    expect(r.percentualSemDono).toBe(1);
  });

  it("nunca oferece mais vezes que o teto de tentativas", () => {
    const r = simular({ ...base, maxOfertas: 3 }, 10);
    expect(r.ofertas).toBeLessThanOrEqual(r.leads * 3);
  });

  it("prazo maior nunca piora a taxa de detecção", () => {
    const curto = simular({ ...base, prazoAceiteMin: 5 }, 20);
    const longo = simular({ ...base, prazoAceiteMin: 30 }, 20);
    expect(longo.taxaDeteccao!).toBeGreaterThanOrEqual(curto.taxaDeteccao!);
  });

  it("todo aceite acontece dentro do prazo", () => {
    const r = simular({ ...base, prazoAceiteMin: 5 }, 20);
    expect(r.p90AceiteMin!).toBeLessThanOrEqual(5);
  });
});

describe("o custo perdido", () => {
  it("vem em faixa, e a faixa nunca é um número só", () => {
    const c = custoPerdido(simular(base, 30));
    expect(c.porMes[1]).toBeGreaterThan(c.porMes[0]);
  });

  it("sem lead perdido, não há custo perdido", () => {
    const c = custoPerdido({ ...simular(base, 10), semDono: 0 });
    expect(c.porMes).toEqual([0, 0]);
  });
});
