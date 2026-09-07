import { describe, expect, it } from "vitest";
import { Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import { EstadoGrafo, type EstadoGrafoT } from "./estado";

/**
 * Fecha o risco 2 registrado no PLANO_EXECUTIVO: o `interrupt()` do LangGraph.js
 * retoma o estado como o do Python?
 *
 * O que precisa ser verdade para os gates N2 funcionarem sem tabela de polling:
 *  1. o grafo para no ponto do pedido e devolve o payload pra fora;
 *  2. o trabalho ANTES da pausa não é perdido;
 *  3. ao retomar, a execução continua de onde parou — não do começo;
 *  4. o valor da decisão humana chega dentro do nó.
 */

const evento = { idEvento: "e1", tipo: "laudo.criado" as const, idImovel: "i1" };
const config = { configurable: { thread_id: "imovel:i1" } };

function grafoComGate(registro: string[]) {
  return new StateGraph(EstadoGrafo)
    .addNode("antes", async () => {
      registro.push("antes");
      return { trilha: ["antes"] };
    })
    .addNode("gate", async () => {
      registro.push("gate:entrou");
      const decisao = interrupt<{ tipo: string }, { aprovado: boolean; por: string }>({
        tipo: "subir_anuncio",
      });
      // Só executa depois que a decisão chega.
      registro.push(`gate:decidido:${decisao.aprovado}:${decisao.por}`);
      return { trilha: [`decidido:${decisao.aprovado}`] };
    })
    .addNode("depois", async () => {
      registro.push("depois");
      return { trilha: ["depois"] };
    })
    .addEdge(START, "antes")
    .addEdge("antes", "gate")
    .addEdge("gate", "depois")
    .addEdge("depois", END)
    .compile({ checkpointer: new MemorySaver() });
}

describe("interrupt() — o mecanismo dos gates N2", () => {
  it("pausa no gate, preserva o que veio antes e não roda o que vem depois", async () => {
    const registro: string[] = [];
    const app = grafoComGate(registro);

    const parcial = await app.invoke({ evento }, config);

    expect(registro).toEqual(["antes", "gate:entrou"]);
    expect(parcial.trilha).toEqual(["antes"]);

    // O pedido fica pendurado na thread — é daqui que a fila do painel lê o
    // que está esperando decisão.
    const pausado = await app.getState(config);
    expect(pausado.tasks[0]?.interrupts[0]?.value).toMatchObject({
      tipo: "subir_anuncio",
    });
  });

  it("retoma no nó do gate — e o NÓ INTEIRO re-executa", async () => {
    const registro: string[] = [];
    const app = grafoComGate(registro);

    await app.invoke({ evento }, config);
    const final = await app.invoke(
      new Command({ resume: { aprovado: true, por: "fabiano" } }),
      config,
    );

    // Nós já concluídos não repetem: "antes" aparece uma vez.
    // Mas o nó que interrompeu roda do começo de novo — "gate:entrou" duas
    // vezes. Na segunda passada o interrupt() devolve a decisão em vez de
    // pausar.
    expect(registro).toEqual([
      "antes",
      "gate:entrou",
      "gate:entrou",
      "gate:decidido:true:fabiano",
      "depois",
    ]);

    // O ESTADO é aplicado uma vez só: o retorno do nó só conta na passada que
    // completa. Quem duplica é efeito colateral, não estado.
    expect(final.trilha).toEqual(["antes", "decidido:true", "depois"]);
  });

  it("efeito colateral antes do interrupt() acontece DUAS vezes", async () => {
    // Este é o teste que protege o dinheiro. Se um agente chamar o modelo, ou
    // escrever no banco, antes do interrupt() dentro do mesmo nó, isso roda de
    // novo no resume: LLM cobrado duas vezes, linha de aprovacao duplicada.
    //
    // A regra que sai daqui: a função do agente roda num nó que NÃO
    // interrompe. O gate é um nó separado, e o interrupt() é a primeira coisa
    // dentro dele.
    const efeitos: string[] = [];
    const registro: string[] = [];

    const app = new StateGraph(EstadoGrafo)
      .addNode("agente_e_gate_juntos", async () => {
        efeitos.push("chamou_o_modelo");
        const d = interrupt<unknown, { aprovado: boolean }>({ tipo: "subir_anuncio" });
        return { trilha: [`fim:${d.aprovado}`] };
      })
      .addEdge(START, "agente_e_gate_juntos")
      .addEdge("agente_e_gate_juntos", END)
      .compile({ checkpointer: new MemorySaver() });

    const cfg = { configurable: { thread_id: "imovel:i9" } };
    await app.invoke({ evento }, cfg);
    await app.invoke(new Command({ resume: { aprovado: true } }), cfg);

    expect(efeitos).toEqual(["chamou_o_modelo", "chamou_o_modelo"]);
    expect(registro).toEqual([]);
  });

  it("a negativa também retoma — o grafo segue, o efeito é que muda", async () => {
    const registro: string[] = [];
    const app = grafoComGate(registro);

    await app.invoke({ evento }, config);
    const final = await app.invoke(
      new Command({ resume: { aprovado: false, por: "fabiano" } }),
      config,
    );

    expect(final.trilha).toContain("decidido:false");
  });

  it("threads diferentes pausam de forma independente — é a base da R2", async () => {
    const registro: string[] = [];
    const app = grafoComGate(registro);

    await app.invoke({ evento }, { configurable: { thread_id: "imovel:i1" } });
    await app.invoke(
      { evento: { ...evento, idImovel: "i2" } },
      { configurable: { thread_id: "imovel:i2" } },
    );

    // Decidir i1 não mexe em i2.
    await app.invoke(
      new Command({ resume: { aprovado: true, por: "fabiano" } }),
      { configurable: { thread_id: "imovel:i1" } },
    );

    const estadoI2 = await app.getState({ configurable: { thread_id: "imovel:i2" } });
    expect(estadoI2.tasks[0]?.interrupts?.length).toBe(1);
  });
});
