import { describe, expect, it } from "vitest";
import { alterar, type Candidato, type PortasAlterador } from "./alterador";
import { contextoFalso } from "./_teste/contexto-falso";
import type { Extrator } from "./modelo";

/**
 * O Agente 6 tem uma responsabilidade e uma proibição.
 *
 * A responsabilidade: traduzir "muda o preço do apartamento do Campolim pra
 * 820 mil" em uma mudança concreta.
 *
 * A proibição: escrever qualquer coisa sem que alguém tenha lido o "de → para".
 * Quase todo teste aqui existe pra provar a proibição.
 */

const extratorFixo =
  (saida: Record<string, unknown>): Extrator =>
  (async () => saida) as Extrator;

function portas(candidatos: Candidato[]) {
  const aplicadas: { campo: string; valorNovo: string; por: string }[] = [];
  const p: PortasAlterador = {
    async procurar() {
      return candidatos;
    },
    async aplicar(a, por) {
      aplicadas.push({ campo: a.campo, valorNovo: a.valorNovo, por });
    },
  };
  return { p, aplicadas };
}

const umImovel: Candidato[] = [
  { id: "im-1", rotulo: "Apartamento — Av. Gisele Constantino, 780, Campolim", valorAtual: "846000" },
];

const pedidoPreco = {
  entidade: "imovel",
  descricaoAlvo: "apartamento do Campolim",
  campo: "preco",
  valorNovo: "820000",
  confianca: "alta",
};

describe("o caminho feliz", () => {
  it("não escreve nada antes da confirmação", async () => {
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: false, por: "ana" });
    const { p, aplicadas } = portas(umImovel);

    const r = await alterar(ctx, "muda o preço do apartamento do Campolim pra 820 mil", extratorFixo(pedidoPreco), p);

    expect(pedidos).toHaveLength(1);
    expect(aplicadas).toHaveLength(0);
    expect(r.desfecho).toBe("recusada");
  });

  it("confirmado, aplica e assina com quem confirmou", async () => {
    const { ctx } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p, aplicadas } = portas(umImovel);

    const r = await alterar(ctx, "muda o preço pra 820 mil", extratorFixo(pedidoPreco), p);

    expect(r).toMatchObject({ desfecho: "aplicada", idEntidade: "im-1" });
    // A assinatura é de gente. O agente traduziu; quem decidiu foi a pessoa.
    expect(aplicadas[0]).toMatchObject({ campo: "preco", valorNovo: "820000", por: "ana" });
  });

  it("a confirmação mostra o de → para, não nome de coluna", async () => {
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p } = portas(umImovel);

    await alterar(ctx, "muda o preço", extratorFixo(pedidoPreco), p);

    const ctxPedido = pedidos[0]!.contexto as { mudanca: string; registro: string };
    expect(ctxPedido.mudanca).toContain("Preço");
    expect(ctxPedido.mudanca).toContain("→");
    expect(ctxPedido.registro).toContain("Campolim");
  });
});

describe("o que ele se recusa a fazer", () => {
  it("dois imóveis no Campolim: pergunta em vez de escolher", async () => {
    // O caso que justifica o agente inteiro. Escolher o primeiro da lista
    // seria alterar o imóvel errado com total confiança.
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p, aplicadas } = portas([
      ...umImovel,
      { id: "im-2", rotulo: "Apartamento — Rua Comitre, 210, Campolim", valorAtual: "1178000" },
    ]);

    const r = await alterar(ctx, "muda o preço do Campolim", extratorFixo(pedidoPreco), p);

    expect(r.desfecho).toBe("ambigua");
    expect(aplicadas).toHaveLength(0);
    expect(pedidos).toHaveLength(0);
  });

  it("estado operacional não se altera por mensagem — e explica por quê", async () => {
    // Estado é conclusão de laudo. Deixar alguém escrever "põe como pronto"
    // desmonta o Agente 1.
    const { ctx } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p, aplicadas } = portas(umImovel);

    const r = await alterar(
      ctx,
      "põe o imóvel do Campolim como pronto",
      extratorFixo({ ...pedidoPreco, campo: "estadoOperacional", valorNovo: "pronto" }),
      p,
    );

    expect(r).toMatchObject({ desfecho: "recusada" });
    if (r.desfecho === "recusada") expect(r.motivo).toContain("laudo");
    expect(aplicadas).toHaveLength(0);
  });

  it("registro não encontrado é desfecho honesto, não o vizinho mais parecido", async () => {
    const { ctx } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p } = portas([]);

    const r = await alterar(ctx, "muda o preço da casa da lua", extratorFixo(pedidoPreco), p);
    expect(r.desfecho).toBe("nao_encontrado");
  });

  it("valor igual ao atual não vira pedido de confirmação", async () => {
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p } = portas(umImovel);

    const r = await alterar(
      ctx,
      "muda pra 846 mil",
      extratorFixo({ ...pedidoPreco, valorNovo: "846000" }),
      p,
    );
    expect(r.desfecho).toBe("recusada");
    expect(pedidos).toHaveLength(0);
  });
});

describe("o risco vai na confirmação, não vira recusa", () => {
  it("salto de unidade (820 em vez de 820000) é sinalizado pra pessoa conferir", async () => {
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: false, por: "ana" });
    const { p } = portas(umImovel);

    await alterar(ctx, "muda pra 820", extratorFixo({ ...pedidoPreco, valorNovo: "820" }), p);

    const c = pedidos[0]!.contexto as { risco: string; observacao: string };
    expect(c.risco).toBe("alto");
    expect(c.observacao).toContain("unidade");
  });

  it("anúncio no ar avisa que o preço muda pra quem está vendo agora", async () => {
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: false, por: "ana" });
    const { p } = portas([{ ...umImovel[0]!, anuncioNoAr: true }]);

    await alterar(ctx, "muda o preço pra 820 mil", extratorFixo(pedidoPreco), p);

    expect((pedidos[0]!.contexto as { risco: string }).risco).toBe("alto");
  });

  it("leitura incerta do modelo vira aviso na tela, não recusa", async () => {
    const { ctx, pedidos } = contextoFalso("6_alterador", { aprovado: true, por: "ana" });
    const { p, aplicadas } = portas(umImovel);

    await alterar(
      ctx,
      "muda o preço",
      extratorFixo({ ...pedidoPreco, confianca: "baixa" }),
      p,
    );

    expect((pedidos[0]!.contexto as { leituraIncerta: boolean }).leituraIncerta).toBe(true);
    // Quem lê o "de → para" resolve em dois segundos o que o modelo não
    // resolveu com o texto que recebeu.
    expect(aplicadas).toHaveLength(1);
  });
});
