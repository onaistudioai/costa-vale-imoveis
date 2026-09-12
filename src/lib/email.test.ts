import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registrado: Array<{
  destino: string | null | undefined;
  texto: string;
  estado: string;
  motivo: string | null;
  canal: string;
  assunto: string | null;
}> = [];

// O canal é a única porta pro banco daqui. Falsificar só ele mantém o teste
// sem banco e ainda afirma o que importa: toda tentativa vira registro.
vi.mock("@/lib/canal", () => ({
  registrar: async (
    destino: string | null | undefined,
    texto: string,
    estado: string,
    motivo: string | null,
    canal = "whatsapp",
    assunto: string | null = null,
  ) => {
    registrado.push({ destino, texto, estado, motivo, canal, assunto });
  },
}));

const { enviarEmail } = await import("./email");

const AMBIENTE = { ...process.env };

beforeEach(() => {
  registrado.length = 0;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_EQUIPE;
  delete process.env.EMAIL_REMETENTE;
});

afterEach(() => {
  process.env = { ...AMBIENTE };
  vi.unstubAllGlobals();
});

describe("desligado", () => {
  it("sem chave, nada sai — e é o modo em que o projeto roda hoje", async () => {
    process.env.EMAIL_EQUIPE = "equipe@imobiliaria.com";

    expect(await enviarEmail("assunto", "corpo")).toBe(false);
    expect(registrado[0]).toMatchObject({
      estado: "sem_canal",
      canal: "email",
      motivo: "canal de e-mail desligado",
    });
  });

  it("com chave e sem destinatário, o motivo é outro — são problemas diferentes", async () => {
    process.env.RESEND_API_KEY = "re_teste";

    await enviarEmail("assunto", "corpo");
    expect(registrado[0]!.motivo).toBe("sem destinatário");
  });

  it("desligado ainda guarda o texto — é assim que se confere antes de ligar", async () => {
    await enviarEmail("[Urgente] Derrubar mídia paga", "o corpo inteiro do caso");

    expect(registrado[0]!.texto).toBe("o corpo inteiro do caso");
    expect(registrado[0]!.assunto).toBe("[Urgente] Derrubar mídia paga");
  });
});

describe("ligado", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_teste";
    process.env.EMAIL_EQUIPE = "ana@imobiliaria.com, bruno@imobiliaria.com";
  });

  it("manda pra lista inteira e registra como entregue", async () => {
    const enviados: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      enviados.push(init);
      return new Response("{}", { status: 200 });
    });

    expect(await enviarEmail("assunto", "corpo")).toBe(true);

    const corpo = JSON.parse(enviados[0]!.body as string);
    expect(corpo.to).toEqual(["ana@imobiliaria.com", "bruno@imobiliaria.com"]);
    expect(corpo.subject).toBe("assunto");
    expect(registrado[0]).toMatchObject({ estado: "entregue", canal: "email" });
  });

  it("provedor recusando não explode — registra a falha e segue", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 422 }));

    expect(await enviarEmail("assunto", "corpo")).toBe(false);
    expect(registrado[0]).toMatchObject({ estado: "falha" });
    expect(registrado[0]!.motivo).toContain("422");
  });

  it("rede caindo também não explode — o pedido já está no painel", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });

    expect(await enviarEmail("assunto", "corpo")).toBe(false);
    expect(registrado[0]!.motivo).toContain("ECONNREFUSED");
  });
});
