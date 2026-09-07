import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { construirGrafo } from "./index";
import { depsFalsas, mundoFalso } from "./_teste/mundo-falso";
import { threadDoEvento, type Evento } from "./eventos";
import { CONFIG_ROTEAMENTO } from "@/lib/config";
import type { Mundo } from "./mundo";
import type { IoDoNo } from "./no";
import type { Extrator } from "@/agentes/modelo";

/**
 * O Agente 6 dentro do grafo de verdade.
 *
 * O ponto do arquivo é provar que ele obedece a R7 igual aos outros quatro:
 * o nó do agente não interrompe, o gate interrompe, e a re-execução depois da
 * decisão não chama o modelo de novo nem duplica a escrita.
 */

const evento = (texto: string): Evento => ({
  idEvento: "ev-alt-1",
  tipo: "alteracao.solicitada",
  idImovel: "im-1",
  payload: { texto },
});

function montar(over: {
  candidatos?: unknown[];
  extracao?: Record<string, unknown>;
} = {}) {
  const alterados: { campo: string; valorNovo: string; por: string }[] = [];
  const base = mundoFalso();

  const mundo: Mundo = {
    ...base.mundo,
    portasAlterador: {
      async procurar() {
        return (over.candidatos ?? [
          { id: "im-1", rotulo: "Apartamento — Campolim", valorAtual: "846000" },
        ]) as never;
      },
      async aplicar(a, por) {
        alterados.push({ campo: a.campo, valorNovo: a.valorNovo, por });
      },
    },
  };

  let chamadas = 0;
  const extrator: Extrator = (async () => {
    chamadas++;
    return (
      over.extracao ?? {
        entidade: "imovel",
        descricaoAlvo: "apartamento do Campolim",
        campo: "preco",
        valorNovo: "820000",
        confianca: "alta",
      }
    );
  }) as Extrator;

  const pedidos: unknown[] = [];
  const io: IoDoNo = {
    ...base.io,
    async registrarPedido(_a, _e, _t, p) {
      pedidos.push(p);
    },
  };

  const app = construirGrafo({
    mundo,
    io,
    extrator,
    config: CONFIG_ROTEAMENTO,
  }).compile({ checkpointer: new MemorySaver() });

  return { app, alterados, pedidos, chamadas: () => chamadas };
}

describe("Agente 6 no grafo", () => {
  it("para no gate antes de escrever, e escreve só depois da confirmação", async () => {
    const { app, alterados, pedidos, chamadas } = montar();
    const e = evento("muda o preço do apartamento do Campolim pra 820 mil");
    const cfg = { configurable: { thread_id: threadDoEvento(e) } };

    const parado = await app.invoke({ evento: e }, cfg);

    // Antes da decisão: pedido na fila, banco intocado.
    expect(parado.trilha).toEqual(["alterador:pausa"]);
    expect(pedidos).toHaveLength(1);
    expect(alterados).toHaveLength(0);

    const final = await app.invoke(
      new Command({ resume: { aprovado: true, por: "ana" } }),
      cfg,
    );

    expect(final.trilha).toEqual(["alterador:pausa", "gate", "alterador"]);
    expect(alterados).toEqual([{ campo: "preco", valorNovo: "820000", por: "ana" }]);
    // R7: o nó re-executa inteiro depois do gate, mas o memo segura a extração.
    // Sem isso, cada confirmação cobraria uma chamada de modelo a mais.
    expect(chamadas()).toBe(1);
    // E o pedido não vira duas linhas na fila do painel.
    expect(pedidos).toHaveLength(1);
  });

  it("recusado na confirmação, nada é escrito", async () => {
    const { app, alterados } = montar();
    const e = evento("muda o preço pra 820 mil");
    const cfg = { configurable: { thread_id: threadDoEvento(e) } };

    await app.invoke({ evento: e }, cfg);
    const final = await app.invoke(
      new Command({ resume: { aprovado: false, por: "ana", motivo: "era o outro imóvel" } }),
      cfg,
    );

    expect(alterados).toHaveLength(0);
    expect(final.alteracao).toMatchObject({ desfecho: "recusada" });
  });

  it("ambíguo nem chega ao gate — não há o que confirmar ainda", async () => {
    const { app, pedidos } = montar({
      candidatos: [
        { id: "im-1", rotulo: "Apto — Gisele Constantino, Campolim", valorAtual: "846000" },
        { id: "im-2", rotulo: "Apto — Comitre, Campolim", valorAtual: "1178000" },
      ],
    });
    const e = evento("muda o preço do Campolim");

    const r = await app.invoke(
      { evento: e },
      { configurable: { thread_id: threadDoEvento(e) } },
    );

    expect(r.trilha).toEqual(["alterador"]);
    expect(pedidos).toHaveLength(0);
    expect(r.alteracao).toMatchObject({ desfecho: "ambigua" });
  });

  it("campo bloqueado morre na regra, sem gastar confirmação de ninguém", async () => {
    const { app, pedidos } = montar({
      extracao: {
        entidade: "imovel",
        descricaoAlvo: "apartamento do Campolim",
        campo: "estadoComercial",
        valorNovo: "fechado",
        confianca: "alta",
      },
    });
    const e = evento("marca o Campolim como fechado");

    const r = await app.invoke(
      { evento: e },
      { configurable: { thread_id: threadDoEvento(e) } },
    );

    expect(pedidos).toHaveLength(0);
    expect(r.alteracao).toMatchObject({ desfecho: "recusada" });
  });
});
