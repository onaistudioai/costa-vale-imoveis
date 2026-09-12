import { describe, expect, it } from "vitest";
import { Consolidado, frase, reunir, revisarSePreciso, type Caso } from "./index";
import type { Extrator } from "@/agentes/modelo";

const CASO: Caso = {
  assunto: "Subir anúncio do imóvel 47",
  fatos: "Laudo diz que a documentação saiu hoje. Sem mídia paga rodando.",
};

/**
 * Extrator de teste: responde por posição de chamada. Os dois primeiros são os
 * olhares (rodam em paralelo, mas o `Promise.all` preserva a ordem do array),
 * o terceiro é o supervisor.
 */
function extratorFalso(
  olhares: Array<{ recomendacao: string; leitura?: string; preocupacao?: string }>,
  supervisor: Partial<Consolidado> = {},
) {
  const chamadas: Array<{ sistema: string; entrada: string }> = [];
  let n = 0;

  const extrair = (async (args: { sistema: string; entrada: string }) => {
    chamadas.push({ sistema: args.sistema, entrada: args.entrada });
    const i = n++;
    if (i < olhares.length) {
      return {
        leitura: "leitura",
        preocupacao: "preocupação",
        ...olhares[i],
      };
    }
    return {
      recomendacao: "aprovar",
      justificativa: "parece rotina",
      convergiu: true,
      ressalva: null,
      ...supervisor,
    };
  }) as unknown as Extrator;

  return { extrair, chamadas };
}

describe("reunir", () => {
  it("ouve os dois papéis antes de consolidar — três chamadas, não uma", async () => {
    const { extrair, chamadas } = extratorFalso([
      { recomendacao: "aprovar" },
      { recomendacao: "aprovar" },
    ]);

    await reunir(CASO, extrair);

    expect(chamadas).toHaveLength(3);
    expect(chamadas[0]!.sistema).toContain("sócio conservador");
    expect(chamadas[1]!.sistema).toContain("corretor mais experiente");
    expect(chamadas[2]!.sistema).toContain("gerente");
  });

  it("os olhares não leem um ao outro — senão o segundo só concorda", async () => {
    const { extrair, chamadas } = extratorFalso([
      { recomendacao: "aprovar", leitura: "tudo certo aqui" },
      { recomendacao: "aprovar" },
    ]);

    await reunir(CASO, extrair);

    expect(chamadas[1]!.entrada).not.toContain("tudo certo aqui");
    // Só o supervisor vê os pareceres.
    expect(chamadas[2]!.entrada).toContain("tudo certo aqui");
  });

  it("os dois concordando, a mesa fecha e recomenda", async () => {
    const { extrair } = extratorFalso([
      { recomendacao: "aprovar" },
      { recomendacao: "aprovar" },
    ]);

    const r = await reunir(CASO, extrair);

    expect(r.convergiu).toBe(true);
    expect(r.recomendacao).toBe("aprovar");
  });

  it("discordando, sobe pro humano mesmo que o supervisor queira fechar", async () => {
    const { extrair } = extratorFalso(
      [{ recomendacao: "aprovar" }, { recomendacao: "negar" }],
      // O supervisor tentando decidir sozinho: a regra de código vence.
      { recomendacao: "aprovar", convergiu: true, ressalva: null },
    );

    const r = await reunir(CASO, extrair);

    expect(r.recomendacao).toBe("precisa_humano");
    expect(r.convergiu).toBe(false);
    expect(r.ressalva).toContain("discordaram");
  });

  it("um papel pedindo humano basta, mesmo com o outro tranquilo", async () => {
    const { extrair } = extratorFalso(
      [{ recomendacao: "precisa_humano" }, { recomendacao: "aprovar" }],
      { recomendacao: "aprovar", convergiu: true },
    );

    const r = await reunir(CASO, extrair);

    expect(r.recomendacao).toBe("precisa_humano");
    expect(r.convergiu).toBe(false);
  });

  it("preserva a ressalva que o supervisor escreveu, quando existe", async () => {
    const { extrair } = extratorFalso(
      [{ recomendacao: "aprovar" }, { recomendacao: "negar" }],
      { ressalva: "o laudo não menciona a vaga de garagem" },
    );

    const r = await reunir(CASO, extrair);

    expect(r.ressalva).toBe("o laudo não menciona a vaga de garagem");
  });

  it("leva os fatos do caso pros dois papéis", async () => {
    const { extrair, chamadas } = extratorFalso([
      { recomendacao: "aprovar" },
      { recomendacao: "aprovar" },
    ]);

    await reunir(CASO, extrair);

    for (const c of chamadas) {
      expect(c.entrada).toContain("documentação saiu hoje");
    }
  });
});

describe("revisarSePreciso — quem a faixa deixa entrar", () => {
  it("amarela reúne a mesa", async () => {
    const { extrair, chamadas } = extratorFalso([
      { recomendacao: "aprovar" },
      { recomendacao: "aprovar" },
    ]);

    const r = await revisarSePreciso("amarela", extrair, CASO);

    expect(r?.recomendacao).toBe("aprovar");
    expect(chamadas).toHaveLength(3);
  });

  it("vermelha NÃO chama modelo nenhum — é o caso que já é da pessoa", async () => {
    const { extrair, chamadas } = extratorFalso([]);

    expect(await revisarSePreciso("vermelha", extrair, CASO)).toBeUndefined();
    expect(chamadas).toHaveLength(0);
  });

  it("verde também não chama — rotina não paga três chamadas de modelo", async () => {
    const { extrair, chamadas } = extratorFalso([]);

    expect(await revisarSePreciso("verde", extrair, CASO)).toBeUndefined();
    expect(chamadas).toHaveLength(0);
  });

  it("mesa que explode não derruba o agente: o pedido vai pro painel sem proposta", async () => {
    const extrair = (async () => {
      throw new Error("modelo fora do ar");
    }) as unknown as Extrator;

    expect(await revisarSePreciso("amarela", extrair, CASO)).toBeUndefined();
  });
});

describe("frase", () => {
  const base: Consolidado = {
    recomendacao: "aprovar",
    justificativa: "j",
    convergiu: true,
    ressalva: null,
  };

  it("diz o que a mesa achou, sem soar como decisão tomada", () => {
    expect(frase(base)).toBe("Parece caso de aprovar");
  });

  it("avisa quando a revisão não fechou", () => {
    expect(frase({ ...base, convergiu: false })).toContain("não fechou");
  });

  it("o caso que precisa de gente não finge recomendação", () => {
    expect(frase({ ...base, recomendacao: "precisa_humano", convergiu: false })).toContain(
      "seu olhar",
    );
  });
});
