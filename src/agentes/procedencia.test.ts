import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Extrator } from "./modelo";
import { comProcedencia, versaoDoPrompt, type Leitura } from "./procedencia";

const schema = z.object({ ok: z.boolean() });

function falso(saida: unknown = { ok: true }, extras: object = {}) {
  const f = (async () => saida) as Extrator;
  return Object.assign(f, extras);
}

const chamar = (extrair: Extrator, sistema = "prompt do curador") =>
  extrair({ schema, sistema, entrada: "laudo de vistoria" });

describe("versaoDoPrompt", () => {
  it("muda quando o texto do prompt muda", () => {
    expect(versaoDoPrompt("a")).not.toBe(versaoDoPrompt("b"));
  });

  it("ignora espaço nas pontas — reindentar arquivo não é versão nova", () => {
    expect(versaoDoPrompt("  regra  ")).toBe(versaoDoPrompt("regra"));
  });
});

describe("comProcedencia", () => {
  it("registra quem leu, com qual modelo e com qual prompt", async () => {
    const linhas: Leitura[] = [];
    const extrair = comProcedencia(
      falso({ ok: true }, { modelo: "openai/gpt-oss-120b", tarefa: "extracao" }),
      { agente: "1_curador", idEvento: "evt-1" },
      async (l) => void linhas.push(l),
    );

    await chamar(extrair);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      agente: "1_curador",
      modelo: "openai/gpt-oss-120b",
      tarefa: "extracao",
      idEvento: "evt-1",
      erro: null,
      promptHash: versaoDoPrompt("prompt do curador"),
    });
    expect(linhas[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it("não muda o que o modelo devolveu", async () => {
    const saida = { ok: true, pendencias: ["entulho"] };
    const extrair = comProcedencia(falso(saida), { agente: "1_curador" }, async () => {});
    expect(await chamar(extrair)).toBe(saida);
  });

  it("grava o erro do modelo e re-lança", async () => {
    const linhas: Leitura[] = [];
    const quebrado = (async () => {
      throw new Error("429 rate limit");
    }) as Extrator;

    const extrair = comProcedencia(
      quebrado,
      { agente: "2_guardiao" },
      async (l) => void linhas.push(l),
    );

    await expect(chamar(extrair)).rejects.toThrow("429 rate limit");
    expect(linhas[0]).toMatchObject({ erro: "429 rate limit", saida: null });
  });

  // A garantia que justifica o try/catch: auditoria não é caminho crítico.
  // Postgres fora do ar não pode ser o motivo de um cliente ficar sem resposta.
  it("falha de gravação não derruba o atendimento", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const extrair = comProcedencia(falso(), { agente: "4_atendimento" }, async () => {
      throw new Error("banco fora do ar");
    });

    await expect(chamar(extrair)).resolves.toEqual({ ok: true });
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("duas leituras do mesmo prompt compartilham a versão; entradas diferentes, não", async () => {
    const linhas: Leitura[] = [];
    const extrair = comProcedencia(
      falso(),
      { agente: "1_curador" },
      async (l) => void linhas.push(l),
    );

    await extrair({ schema, sistema: "mesmo prompt", entrada: "laudo A" });
    await extrair({ schema, sistema: "mesmo prompt", entrada: "laudo B" });

    expect(linhas[0]!.promptHash).toBe(linhas[1]!.promptHash);
    expect(linhas[0]!.entradaHash).not.toBe(linhas[1]!.entradaHash);
  });
});
