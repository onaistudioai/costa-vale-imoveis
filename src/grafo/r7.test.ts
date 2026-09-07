import { describe, expect, it } from "vitest";
import { Command, MemorySaver } from "@langchain/langgraph";
import { construirGrafo } from "./index";
import { depsFalsas } from "./_teste/mundo-falso";
import type { ExtracaoLaudo } from "@/agentes/curador";

/**
 * R7 — o nó que interrompe não tem efeito colateral antes do `interrupt()`.
 *
 * `interrupt.test.ts` documenta o comportamento cru do LangGraph: o nó que
 * interrompe re-executa inteiro no resume. Este arquivo prova que a topologia
 * do grafo real neutraliza isso: o agente roda num nó que não interrompe, o
 * gate é um nó separado, e o memo do estado impede que a re-execução cobre o
 * modelo de novo ou duplique o pedido na fila.
 *
 * É o teste que protege o dinheiro.
 */

/** Sem pendência e com confiança alta: o imóvel fica `pronto` e o gate abre. */
const laudoAprovavel: ExtracaoLaudo = {
  pendencias: [],
  precoMencionado: null,
  confianca: "alta",
  resumo: "casa pronta pra anunciar",
};

const montar = () => {
  const f = depsFalsas([laudoAprovavel]);
  return {
    ...f,
    app: construirGrafo(f.deps).compile({ checkpointer: new MemorySaver() }),
    config: { configurable: { thread_id: "imovel:i1#e1" } },
    evento: { idEvento: "e1", tipo: "laudo.criado" as const, idImovel: "i1" },
  };
};

describe("R7 — agente e gate em nós separados", () => {
  it("para no gate com o pedido na fila e sem publicar nada", async () => {
    const t = montar();
    const estado = await t.app.invoke({ evento: t.evento }, t.config);

    expect(estado.trilha).toEqual(["curador:pausa"]);
    expect(estado.pausa?.pedido).toMatchObject({ tipo: "subir_anuncio", idEntidade: "i1" });
    expect(t.pedidos).toHaveLength(1);
    expect(t.publicados).toEqual([]);
    expect(t.chamadasDoModelo()).toBe(1);
  });

  it("retomar NÃO chama o modelo de novo nem duplica o pedido", async () => {
    const t = montar();
    await t.app.invoke({ evento: t.evento }, t.config);
    const final = await t.app.invoke(
      new Command({ resume: { aprovado: true, por: "fabiano" } }),
      t.config,
    );

    // O nó do curador roda duas vezes — é o que o LangGraph faz. O que NÃO
    // acontece duas vezes é o que custa: chamada de modelo e linha na fila.
    expect(final.trilha).toEqual(["curador:pausa", "gate", "curador"]);
    expect(t.chamadasDoModelo()).toBe(1);
    expect(t.pedidos).toHaveLength(1);

    // E o efeito depois do gate acontece uma vez só, na passada que completa.
    expect(t.publicados).toEqual(["i1"]);
    expect(final.pausa).toBeNull();
  });

  it("negativa também retoma: o grafo segue, o anúncio é que não sobe", async () => {
    const t = montar();
    await t.app.invoke({ evento: t.evento }, t.config);
    const final = await t.app.invoke(
      new Command({ resume: { aprovado: false, por: "fabiano" } }),
      t.config,
    );

    expect(final.pausa).toBeNull();
    expect(t.publicados).toEqual([]);
    expect(
      t.escritas.some((e) => e.campo === "imovel.estadoAnuncio"),
    ).toBe(false);
  });

  it("a re-execução repete a escrita — é a idempotência do banco que fecha a conta", async () => {
    const t = montar();
    await t.app.invoke({ evento: t.evento }, t.config);
    await t.app.invoke(
      new Command({ resume: { aprovado: true, por: "fabiano" } }),
      t.config,
    );

    // Documenta por que `log_por_evento_idx` existe: sem a unique em
    // (id_evento, campo, id_entidade), o histórico do imóvel viria em dobro.
    const estados = t.escritas.filter((e) => e.campo === "imovel.estadoOperacional");
    expect(estados).toHaveLength(2);
    expect(estados[0]).toMatchObject({ valorNovo: "pronto" });
  });
});
