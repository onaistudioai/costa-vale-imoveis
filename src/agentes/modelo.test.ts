import { describe, expect, it } from "vitest";
import { comEspera } from "./modelo";

const limite = (s: string) => new Error(`429 rate_limit_exceeded: Please try again in ${s}.`);

describe("comEspera", () => {
  it("espera o que o Groq pediu e tenta de novo", async () => {
    const dormidos: number[] = [];
    let chamadas = 0;
    const r = await comEspera(
      async () => {
        if (++chamadas === 1) throw limite("7.5s");
        return "ok";
      },
      { dormir: async (ms) => void dormidos.push(ms) },
    );
    expect(r).toBe("ok");
    expect(dormidos).toEqual([8000]);
  });

  it("não dorme além do teto: sobe o erro", async () => {
    await expect(
      comEspera(async () => { throw limite("1m2s"); }, { dormir: async () => {} }),
    ).rejects.toThrow("rate_limit");
  });

  it("erro que não é 429 sobe na primeira", async () => {
    let chamadas = 0;
    await expect(
      comEspera(async () => { chamadas++; throw new Error("schema inválido"); }, { dormir: async () => {} }),
    ).rejects.toThrow("schema");
    expect(chamadas).toBe(1);
  });

  it("desiste depois das tentativas", async () => {
    let chamadas = 0;
    await expect(
      comEspera(async () => { chamadas++; throw limite("1s"); }, { dormir: async () => {} }),
    ).rejects.toThrow();
    expect(chamadas).toBe(3);
  });
});
