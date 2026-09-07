import { describe, expect, it } from "vitest";
import { versaoDoPrompt } from "@/agentes/procedencia";
import type { NotaRow } from "./schema";
import { ativas, historia, paraAgente, vigentes } from "./vigentes";
import { comCerebro, comDicas, dicasDe, TETO_CARACTERES } from "./aplicar";

let n = 0;
const nota = (over: Partial<NotaRow> = {}): NotaRow => ({
  id: `n${++n}`,
  escopo: "geral",
  chave: "",
  texto: "cliente do Campolim costuma perguntar por vaga coberta",
  evidencia: null,
  estado: "confirmada",
  autor: "fabiano",
  motivo: null,
  substitui: null,
  criadaEm: new Date(2026, 0, n),
  ...over,
});

describe("vigência", () => {
  it("a versão nova substitui a antiga sem apagá-la", () => {
    const velha = nota({ id: "a", texto: "versão errada" });
    const nova = nota({ id: "b", substitui: "a", texto: "versão corrigida" });

    expect(vigentes([velha, nova]).map((x) => x.id)).toEqual(["b"]);
    // O ponto da averbação: a antiga continua legível.
    expect(historia([velha, nova], "b").map((x) => x.texto)).toEqual([
      "versão corrigida",
      "versão errada",
    ]);
  });

  it("rascunho e desativada não influenciam agente nenhum", () => {
    const notas = [
      nota({ id: "r", estado: "rascunho" }),
      nota({ id: "d", estado: "desativada", motivo: "amostra pequena demais" }),
      nota({ id: "c", estado: "confirmada" }),
      nota({ id: "f", estado: "fixada" }),
    ];
    expect(ativas(notas).map((x) => x.id).sort()).toEqual(["c", "f"]);
  });

  it("desativar é uma versão nova, não um apagar", () => {
    const viva = nota({ id: "a" });
    const morta = nota({
      id: "b",
      substitui: "a",
      estado: "desativada",
      motivo: "amostra pequena demais",
    });

    expect(ativas([viva, morta])).toEqual([]);
    expect(historia([viva, morta], "b")[1]).toMatchObject({ id: "a", estado: "confirmada" });
  });

  it("nota de escopo específico só chega em quem é do escopo", () => {
    const notas = [
      nota({ id: "g", escopo: "geral" }),
      nota({ id: "a1", escopo: "agente", chave: "1_curador" }),
      nota({ id: "a4", escopo: "agente", chave: "4_atendimento" }),
      nota({ id: "b", escopo: "bairro", chave: "campolim" }),
    ];

    expect(paraAgente(notas, "1_curador").map((x) => x.id)).toEqual(["g", "a1"]);
    expect(paraAgente(notas, "4_atendimento", ["campolim"]).map((x) => x.id)).toEqual([
      "g",
      "a4",
      "b",
    ]);
  });
});

describe("o que o cérebro pode fazer com um prompt", () => {
  it("sem notas, o prompt sai intacto", () => {
    expect(comDicas("PROMPT", [])).toBe("PROMPT");
  });

  // A regra inteira em um teste: nota é observação da equipe, e o texto que
  // acompanha diz ao modelo que dado de sistema vence observação.
  it("toda nota chega marcada como observação, e o dado do sistema vence", () => {
    const p = comDicas("PROMPT", [nota({ texto: "o Campolim está saindo por 820 mil" })]);

    expect(p).toContain("não são dados do sistema");
    expect(p).toContain("o dado do sistema vence");
    expect(p).toContain("Nunca repita um número daqui como se fosse cadastro");
    // E o número continua sendo só texto de observação: não existe caminho
    // daqui até um campo do cadastro.
    expect(p.startsWith("PROMPT")).toBe(true);
  });

  it("nota fixada entra antes das outras", () => {
    const d = dicasDe([
      nota({ texto: "confirmada antiga", criadaEm: new Date(2025, 0, 1) }),
      nota({ texto: "fixada", estado: "fixada", criadaEm: new Date(2026, 5, 1) }),
    ]);
    expect(d[0]).toBe("fixada");
  });

  it("respeita o teto — acúmulo de nota não pode virar a maior parte da instrução", () => {
    const muitas = Array.from({ length: 40 }, (_, i) =>
      nota({ id: `x${i}`, texto: "o".repeat(100) }),
    );
    const d = dicasDe(muitas);
    expect(d.join("").length).toBeLessThanOrEqual(TETO_CARACTERES);
    expect(d.length).toBeLessThan(muitas.length);
  });

  it("ligar uma nota muda a versão do prompt — é assim que a aferição vê", async () => {
    const chamadas: string[] = [];
    const base = (async (a: { sistema: string }) => {
      chamadas.push(a.sistema);
      return {};
    }) as never;

    const semNota = comCerebro(base, []);
    const comNota = comCerebro(base, [nota()]);
    const args = { schema: {} as never, sistema: "PROMPT", entrada: "x" };

    await semNota(args);
    await comNota(args);

    expect(versaoDoPrompt(chamadas[0]!)).not.toBe(versaoDoPrompt(chamadas[1]!));
  });
});
