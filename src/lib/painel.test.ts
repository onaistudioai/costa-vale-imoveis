import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// revalidatePath só existe dentro do runtime do Next; aqui interessa o efeito
// no banco, não o cache.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * A sessão do painel, fingida.
 *
 * `decidir` recusa quem não está logado — e é essa recusa que impede alguém de
 * assinar uma decisão com o nome de outra pessoa mandando o POST à mão. Aqui o
 * `x-usuario` é o mesmo que o `proxy.ts` carimba depois de conferir a senha.
 */
let logado: string | null = "fabiano";
vi.mock("next/headers", () => ({
  headers: async () => new Headers(logado ? { "x-usuario": logado } : {}),
}));

const { db, pool, schema } = await import("@/lib/db");
const { decidir } = await import("../../app/actions");
const { descrever, filaPendente, historicoDoImovel } = await import("./painel");
const { MODO } = await import("@/regras/modo");

const temBanco = Boolean(process.env.DATABASE_URL);
const d = temBanco ? describe : describe.skip;

async function limpar() {
  // As tabelas da Wave 8 entram antes de `imovel`: contrato de locação e
  // processo de escritura apontam pra ele com `restrict`, e é assim que tem
  // que ser — ninguém apaga um imóvel que tem inquilino dentro.
  for (const t of [
    schema.logEvento,
    schema.aprovacao,
    schema.parcelaAluguel,
    schema.contratoLocacao,
    schema.processoEscritura,
    schema.atendimento,
    schema.anuncio,
    schema.imovel,
  ]) {
    await db.delete(t);
  }
}

async function cenario() {
  const [imovel] = await db
    .insert(schema.imovel)
    .values({
      tipo: "casa",
      endereco: "Rua das Acácias, 47",
      cidade: "Sorocaba",
      estadoOperacional: "pronto",
      estadoAnuncio: "no_ar",
    })
    .returning();

  const [pedido] = await db
    .insert(schema.aprovacao)
    .values({
      tipo: "derrubar_midia",
      entidade: "imovel",
      idEntidade: imovel!.idImovel,
      solicitadoPorAgente: "2_guardiao",
      contexto: { custoEmRisco: 340.5, canais: ["meta"] },
      idEvento: crypto.randomUUID(),
    })
    .returning();

  return { imovel: imovel!, pedido: pedido! };
}

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
};

afterAll(async () => {
  if (!temBanco) return;
  await limpar();
  await pool.end();
});

d("painel — fila", () => {
  beforeEach(limpar);

  it("mostra só o que está pendente", async () => {
    const { pedido } = await cenario();
    await db
      .insert(schema.aprovacao)
      .values({
        tipo: "subir_anuncio",
        entidade: "imovel",
        idEntidade: pedido.idEntidade,
        solicitadoPorAgente: "1_curador",
        estado: "aprovado",
        idEvento: crypto.randomUUID(),
      });

    const fila = await filaPendente();
    expect(fila.map((p) => p.id)).toEqual([pedido.id]);
  });
});

d("painel — decidir", () => {
  beforeEach(limpar);

  it("aprovar fecha o pedido e registra quem decidiu", async () => {
    const { pedido } = await cenario();

    // O `por` do formulário é ignorado de propósito: quem assina é a sessão.
    await decidir(form({ id: pedido.id, decisao: "aprovar", por: "outra pessoa" }));

    const [depois] = await db
      .select()
      .from(schema.aprovacao)
      .where(eq(schema.aprovacao.id, pedido.id));
    expect(depois).toMatchObject({ estado: "aprovado", decididoPor: "fabiano" });
    expect(depois!.decididoEm).toBeInstanceOf(Date);
  });

  // A trava que fecha a porta: sem sessão, a ação não acontece. Um registro com
  // autor inventado é pior que registro nenhum, porque parece auditoria.
  it("sem usuário autenticado, nada é decidido", async () => {
    const { pedido } = await cenario();
    logado = null;
    try {
      await expect(
        decidir(form({ id: pedido.id, decisao: "aprovar", por: "invasor" })),
      ).rejects.toThrow("sem usuário autenticado");
    } finally {
      logado = "fabiano";
    }

    const [depois] = await db
      .select()
      .from(schema.aprovacao)
      .where(eq(schema.aprovacao.id, pedido.id));
    expect(depois).toMatchObject({ estado: "pendente", decididoPor: null });
  });

  it("negar guarda o motivo — é o que explica a decisão meses depois", async () => {
    const { pedido } = await cenario();

    await decidir(
      form({
        id: pedido.id,
        decisao: "negar",
        motivo: "campanha fecha amanhã de qualquer jeito",
      }),
    );

    const [depois] = await db
      .select()
      .from(schema.aprovacao)
      .where(eq(schema.aprovacao.id, pedido.id));
    expect(depois).toMatchObject({
      estado: "negado",
      motivo: "campanha fecha amanhã de qualquer jeito",
    });
  });

  it("a decisão humana também entra no log", async () => {
    const { pedido } = await cenario();
    await decidir(form({ id: pedido.id, decisao: "aprovar" }));

    const [log] = await db
      .select()
      .from(schema.logEvento)
      .where(eq(schema.logEvento.idEntidade, pedido.id));
    expect(log).toMatchObject({
      agenteOrigem: "humano",
      campo: "decisao.derrubar_midia",
      valorNovo: "aprovado",
      aprovadoPor: "fabiano",
    });
  });

  it("dois navegadores abertos: a primeira decisão vale, a segunda não sobrescreve", async () => {
    const { pedido } = await cenario();

    await decidir(form({ id: pedido.id, decisao: "aprovar" }));
    await decidir(form({ id: pedido.id, decisao: "negar" }));

    const [depois] = await db
      .select()
      .from(schema.aprovacao)
      .where(eq(schema.aprovacao.id, pedido.id));
    expect(depois).toMatchObject({ estado: "aprovado", decididoPor: "fabiano" });
  });

  it("pedido inexistente falha alto em vez de fingir que decidiu", async () => {
    await expect(
      decidir(form({ id: crypto.randomUUID(), decisao: "aprovar" })),
    ).rejects.toThrow("não encontrado");
  });
});

d("painel — auditoria", () => {
  beforeEach(limpar);

  it("responde 'por que esse anúncio caiu' em ordem cronológica inversa", async () => {
    const { imovel } = await cenario();
    await db.insert(schema.logEvento).values([
      {
        agenteOrigem: "1_curador",
        entidade: "imovel",
        idEntidade: imovel.idImovel,
        campo: "imovel.estadoAnuncio",
        valorAnterior: "sem_anuncio",
        valorNovo: "no_ar",
        timestamp: new Date("2026-09-01T10:00:00Z"),
      },
      {
        agenteOrigem: "2_guardiao",
        entidade: "imovel",
        idEntidade: imovel.idImovel,
        campo: "imovel.estadoComercial",
        valorAnterior: "disponivel",
        valorNovo: "em_negociacao",
        timestamp: new Date("2026-09-05T18:30:00Z"),
      },
    ]);

    const { eventos } = await historicoDoImovel(imovel.idImovel);
    expect(eventos.map((e) => e.campo)).toEqual([
      "imovel.estadoComercial",
      "imovel.estadoAnuncio",
    ]);
    expect(descrever(eventos[0]!)).toBe("Estado comercial: disponivel → em_negociacao");
  });
});

describe("descrever — o log em português", () => {
  it("traduz campo de banco em frase", () => {
    expect(
      descrever({ campo: "imovel.estadoAnuncio", valorAnterior: "no_ar", valorNovo: "pausado" }),
    ).toBe("Anúncio: no_ar → pausado");
    expect(descrever({ campo: "laudo", valorAnterior: null, valorNovo: "{}" })).toBe(
      "Laudo lido e extraído",
    );
  });

  it("todo campo com modo declarado tem frase própria, não o fallback cru", () => {
    for (const campo of Object.keys(MODO)) {
      // Três chaves são prefixo ou família: o campo gravado tem outro nome.
      const gravado =
        ({ expirou: "expirou.aceite_corretor", decisao: "decisao.aceite_corretor", alteracao: "imovel.endereco" } as Record<string, string>)[campo] ?? campo;
      const frase = descrever({ campo: gravado, valorAnterior: null, valorNovo: "{}" });
      expect(frase.startsWith(`${campo}:`), `${campo} caiu no fallback`).toBe(false);
    }
  });

  it("a busca não repete a fala do cliente", () => {
    const frase = descrever({
      campo: "busca",
      valorAnterior: null,
      valorNovo: JSON.stringify({
        tipoImovel: "apartamento",
        valorMax: 846000,
        bairrosDesejados: [],
        textoOriginal: "oi, quero visitar",
      }),
    });
    expect(frase).toBe("Critérios de busca registrados (apartamento, até R$ 846.000)");
  });

  it("campo desconhecido não quebra a tela", () => {
    expect(descrever({ campo: "novo.campo", valorAnterior: null, valorNovo: "x" })).toBe(
      "novo.campo: vazio → x",
    );
  });
});
