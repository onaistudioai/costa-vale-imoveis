import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Consolidado, frase, revisarSePreciso, type Caso } from "./index";

/**
 * A lógica da mesa (papéis, paralelismo, regra de divergência) mora no serviço
 * Python e é testada lá: `servicos/mesa/tests/`. Aqui se testa o fio — quem a
 * faixa deixa passar, o que acontece quando o serviço some ou responde torto.
 */

const CASO: Caso = {
  assunto: "Subir anúncio do imóvel 47",
  fatos: "Laudo diz que a documentação saiu hoje. Sem mídia paga rodando.",
};

const OK: Consolidado = {
  recomendacao: "aprovar",
  justificativa: "parece rotina",
  convergiu: true,
  ressalva: null,
};

function servico(corpo: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => vi.stubEnv("MESA_URL", "http://mesa.teste/"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("revisarSePreciso — quem a faixa deixa entrar", () => {
  it("amarela chama o serviço e devolve a proposta", async () => {
    const f = servico(OK);

    expect(await revisarSePreciso("amarela", CASO)).toEqual(OK);
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://mesa.teste/mesa");
    // Só assunto e fatos atravessam o fio — nada de id, contexto ou cliente.
    expect(JSON.parse(init.body as string)).toEqual(CASO);
  });

  it("vermelha NÃO chama o serviço — é o caso que já é da pessoa", async () => {
    const f = servico(OK);
    expect(await revisarSePreciso("vermelha", CASO)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("verde também não chama — rotina não paga três chamadas de modelo", async () => {
    const f = servico(OK);
    expect(await revisarSePreciso("verde", CASO)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("sem MESA_URL a mesa está desligada, e nada sai", async () => {
    vi.stubEnv("MESA_URL", "");
    const f = servico(OK);
    expect(await revisarSePreciso("amarela", CASO)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("o fio falhando não derruba o agente", () => {
  it("serviço fora do ar: segue sem proposta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await revisarSePreciso("amarela", CASO)).toBeUndefined();
  });

  it("serviço com erro: segue sem proposta", async () => {
    servico({ detail: "boom" }, 500);
    expect(await revisarSePreciso("amarela", CASO)).toBeUndefined();
  });

  it("resposta fora do contrato é recusada, não repassada ao painel", async () => {
    servico({ recomendacao: "aprovar_tudo", justificativa: "x", convergiu: true, ressalva: null });
    expect(await revisarSePreciso("amarela", CASO)).toBeUndefined();
  });
});

describe("frase", () => {
  it("diz o que a mesa achou, sem soar como decisão tomada", () => {
    expect(frase(OK)).toBe("Parece caso de aprovar");
  });

  it("avisa quando a revisão não fechou", () => {
    expect(frase({ ...OK, convergiu: false })).toContain("não fechou");
  });

  it("o caso que precisa de gente não finge recomendação", () => {
    expect(frase({ ...OK, recomendacao: "precisa_humano", convergiu: false })).toContain(
      "seu olhar",
    );
  });
});
