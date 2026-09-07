import { describe, expect, it } from "vitest";
import { FALA, RespostaDoCorretor, SISTEMA_ACEITE, interpretarResposta } from "./aceite";
import type { Extrator } from "./modelo";

const falso = (r: RespostaDoCorretor): Extrator => (async () => r) as Extrator;

const leitura = (over: Partial<RespostaDoCorretor> = {}): RespostaDoCorretor => ({
  decisao: "indefinido",
  motivo: null,
  indicouOutro: null,
  ...over,
});

describe("a leitura da resposta do corretor", () => {
  it("devolve o que o modelo leu, sem efeito nenhum", async () => {
    const r = await interpretarResposta("pego esse", falso(leitura({ decisao: "aceita" })));
    expect(r.decisao).toBe("aceita");
  });

  it("o esquema recusa qualquer decisão fora das três", () => {
    expect(() => RespostaDoCorretor.parse({ decisao: "talvez", motivo: null, indicouOutro: null })).toThrow();
  });

  // A instrução do prompt é o que segura o comportamento no caso duvidoso, e é
  // fácil alguém "melhorar" o texto e tirar justamente essa linha.
  it("o prompt manda escolher indefinido na dúvida", () => {
    expect(SISTEMA_ACEITE).toContain("Na dúvida");
    expect(SISTEMA_ACEITE).toContain("Nunca chute");
  });

  it("o prompt cobre as duas formas de falar, não uma palavra-chave", () => {
    for (const frase of ["pego", "tô indo", "hoje não consigo", "passa pro próximo"]) {
      expect(SISTEMA_ACEITE).toContain(frase);
    }
  });
});

describe("as falas do sistema", () => {
  it("são fixas em código, e nenhuma delas pede palavra-chave pra aceitar", () => {
    expect(FALA.recusou).not.toMatch(/responda SIM|digite/i);
    expect(FALA.semOferta).not.toMatch(/responda SIM|digite/i);
  });

  // Só na hora de desempatar uma dúvida o sistema sugere palavra — e aí é
  // sugestão de exemplo, não comando a decorar.
  it("quando não entende, sugere como responder em vez de mandar um comando", () => {
    expect(FALA.naoEntendi).toContain("pego");
    expect(FALA.naoEntendi).toContain("não dá");
  });

  it("o aceite diz qual imóvel é, porque o corretor pode ter mais de um lead", () => {
    expect(FALA.aceitou("Av. Gisele Constantino, 780")).toContain("Av. Gisele Constantino");
  });

  it("chegar tarde é tratado como normal, não como erro do corretor", () => {
    expect(FALA.tardeDemais).not.toMatch(/erro|inválid/i);
    expect(FALA.tardeDemais).toContain("próximo");
  });
});
