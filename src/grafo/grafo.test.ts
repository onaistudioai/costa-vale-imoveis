import { describe, expect, it } from "vitest";
import { Command, MemorySaver } from "@langchain/langgraph";
import { construirGrafo } from "./index";
import { depsFalsas } from "./_teste/mundo-falso";
import type { Evento } from "./eventos";
import type { ExtracaoLaudo } from "@/agentes/curador";
import type { ExtracaoNegociacao } from "@/agentes/guardiao";
import type { ExtracaoConversa } from "@/agentes/atendimento";

/**
 * R1 e R4 com os agentes de verdade nos nós. O que é substituído aqui é o
 * mundo (banco, modelo, canais), nunca o grafo.
 */

/** Confiança baixa segura o imóvel em `com_pendencia`: roda inteiro sem gate. */
const laudoSemGate: ExtracaoLaudo = {
  pendencias: [
    { descricao: "falta certidão", categoria: "documentacao", resolvida: false, obrigatoria: true },
  ],
  precoMencionado: null,
  confianca: "alta",
  resumo: "ainda falta documentação",
};

/** Desistência devolve o imóvel pra `disponivel` — nada a derrubar, nada a aprovar. */
const negociacaoSemGate: ExtracaoNegociacao = {
  etapa: "desistencia",
  valorProposto: null,
  confianca: "alta",
  resumo: "comprador desistiu",
};

const conversa = (over: Partial<ExtracaoConversa> = {}): ExtracaoConversa => ({
  resposta: "Tenho uma casa no Centro que encaixa.",
  criterios: { valorMin: null, valorMax: 400_000, tipoImovel: "casa", bairrosDesejados: [] },
  intencaoDeVisita: true,
  imovelDeInteresse: "i1",
  perguntouSobreDocumentacao: false,
  foraDoPadrao: false,
  resumo: "quer visitar a casa do Centro",
  ...over,
});

const rodar = async (evento: Evento, extracoes: unknown[]) => {
  const f = depsFalsas(extracoes);
  const app = construirGrafo(f.deps).compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: `t:${evento.idEvento}` } };
  const estado = await app.invoke({ evento }, config);

  /** O corretor responde a oferta e o grafo segue de onde parou. */
  const responder = (aprovado: boolean) =>
    app.invoke(new Command({ resume: { aprovado, por: "corretor" } }), config);

  return { estado, responder, ...f };
};

describe("grafo — R1, gatilho exclusivo", () => {
  it("laudo acorda o curador e mais ninguém", async () => {
    const { estado } = await rodar(
      { idEvento: "e1", tipo: "laudo.criado", idImovel: "i1" },
      [laudoSemGate],
    );
    expect(estado.trilha).toEqual(["curador"]);
  });

  it("transação acorda o guardião", async () => {
    const { estado } = await rodar(
      { idEvento: "e2", tipo: "transacao.criada", idImovel: "i1" },
      [negociacaoSemGate],
    );
    expect(estado.trilha).toEqual(["guardiao"]);
  });

  it("lead qualificado acorda o roteador direto, sem passar pelo Agente 4", async () => {
    const { estado, responder, notificados, pedidos } = await rodar(
      {
        idEvento: "e3",
        tipo: "lead.qualificado",
        idImovel: "i1",
        payload: { lead: { idCliente: "c1", idImovel: "i1", resumo: "quer visitar" } },
      },
      [],
    );

    // Push com aceite: o lead é OFERECIDO, não entregue. Nada é reservado e
    // ninguém é notificado antes de o corretor topar.
    expect(estado.trilha).toEqual(["roteador:pausa"]);
    expect(pedidos[0]).toMatchObject({ tipo: "aceite_corretor", idEntidade: "ana" });
    expect(notificados).toEqual([]);

    const final = await responder(true);
    expect(final.trilha).toEqual(["roteador:pausa", "gate", "roteador"]);
    expect(final.alocacao).toMatchObject({ idCorretor: "ana", via: "pontuacao" });
    expect(notificados).toEqual(["ana"]);
  });
});

describe("grafo — R4, handoff Agente 4 → Agente 3", () => {
  it("lead qualificado passa pro roteador pela aresta", async () => {
    const { estado, responder, respostas, notificados } = await rodar(
      { idEvento: "e4", tipo: "mensagem.recebida", idCliente: "c1" },
      [conversa()],
    );

    // O cliente já foi respondido na primeira passada; o roteador parou na
    // oferta. Quem espera agora é o corretor, não o cliente.
    expect(estado.trilha).toEqual(["atendimento", "roteador:pausa"]);
    expect(respostas).toHaveLength(1);
    expect(notificados).toEqual([]);

    const final = await responder(true);
    expect(final.alocacao).toMatchObject({ idCorretor: "ana" });
    expect(notificados).toEqual(["ana"]);
    // O modelo não é chamado de novo na retomada, mesmo com o nó do
    // atendimento já concluído lá atrás.
    expect(respostas).toHaveLength(1);
  });

  it("conversa sem qualificação termina no atendimento", async () => {
    const { estado, notificados } = await rodar(
      { idEvento: "e5", tipo: "mensagem.recebida", idCliente: "c1" },
      [conversa({ intencaoDeVisita: false })],
    );
    expect(estado.trilha).toEqual(["atendimento"]);
    expect(notificados).toHaveLength(0);
  });

  it("escalação N3 vai pro gate humano, não pro Agente 3", async () => {
    const { estado, pedidos, notificados } = await rodar(
      { idEvento: "e6", tipo: "mensagem.recebida", idCliente: "c1" },
      [conversa({ foraDoPadrao: true })],
    );

    // A prova do N3: parou esperando gente, e o Agente 3 nunca rodou.
    expect(estado.trilha).toEqual(["atendimento:pausa"]);
    expect(pedidos[0]).toMatchObject({ tipo: "escalacao_n3", entidade: "cliente" });
    expect(notificados).toHaveLength(0);
  });
});
