import { describe, expect, it } from "vitest";
import { Despachante, CONCORRENCIA_PADRAO } from "./despachante";
import { chaveDeLock, donoDoEvento, type Evento } from "./eventos";

const laudo = (idImovel: string, idEvento: string = crypto.randomUUID()): Evento => ({
  idEvento,
  tipo: "laudo.criado",
  idImovel,
});

const mensagem = (idCliente: string): Evento => ({
  idEvento: crypto.randomUUID(),
  tipo: "mensagem.recebida",
  idCliente,
});

/** Tarefa que registra quando entrou e saiu, pra provar sobreposição. */
function tarefa(log: string[], nome: string, ms = 20) {
  return async () => {
    log.push(`inicio:${nome}`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`fim:${nome}`);
    return nome;
  };
}

describe("R1 — gatilho exclusivo", () => {
  it("cada evento tem exatamente um dono", () => {
    expect(donoDoEvento(laudo("i1"))).toBe("1_curador");
    expect(donoDoEvento({ idEvento: "e", tipo: "transacao.criada", idImovel: "i1" })).toBe(
      "2_guardiao",
    );
    expect(donoDoEvento({ idEvento: "e", tipo: "lead.qualificado", idImovel: "i1" })).toBe(
      "3_roteador",
    );
    expect(donoDoEvento(mensagem("c1"))).toBe("4_atendimento");
  });

  it("aprovacao.decidida volta pro agente que abriu", () => {
    expect(
      donoDoEvento({
        idEvento: "e",
        tipo: "aprovacao.decidida",
        agenteDestino: "2_guardiao",
      }),
    ).toBe("2_guardiao");
  });

  it("aprovacao.decidida sem destino é erro, não chute", () => {
    expect(() => donoDoEvento({ idEvento: "e", tipo: "aprovacao.decidida" })).toThrow();
  });
});

describe("R2 — escopo do lock", () => {
  it("chaveia por imóvel", () => {
    expect(chaveDeLock(laudo("i1"))).toBe("imovel:i1");
  });

  it("o Agente 4 chaveia por cliente — mensagem de lead novo não tem imóvel", () => {
    expect(chaveDeLock(mensagem("c9"))).toBe("cliente:c9");
  });

  it("evento sem chave nenhuma é erro explícito", () => {
    expect(() => chaveDeLock({ idEvento: "e", tipo: "laudo.criado" })).toThrow();
  });

  it("dois eventos no MESMO imóvel serializam", async () => {
    const log: string[] = [];
    const d = new Despachante();
    await Promise.all([
      d.despachar(laudo("i1"), tarefa(log, "A")),
      d.despachar(laudo("i1"), tarefa(log, "B")),
    ]);
    // Sem sobreposição: o segundo só começa depois do primeiro terminar.
    expect(log).toEqual(["inicio:A", "fim:A", "inicio:B", "fim:B"]);
  });

  it("dois eventos em imóveis DIFERENTES correm juntos", async () => {
    const log: string[] = [];
    const d = new Despachante();
    await Promise.all([
      d.despachar(laudo("i1"), tarefa(log, "A")),
      d.despachar(laudo("i2"), tarefa(log, "B")),
    ]);
    // Ambos entram antes de qualquer um sair — é o paralelismo que o lock
    // por imóvel existe pra preservar.
    expect(log.slice(0, 2).sort()).toEqual(["inicio:A", "inicio:B"]);
  });
});

describe("R3 — teto de concorrência", () => {
  it("respeita o teto por agente", async () => {
    const teto = 2;
    const d = new Despachante({
      porAgente: { ...CONCORRENCIA_PADRAO.porAgente, "1_curador": teto },
      prioridade: CONCORRENCIA_PADRAO.prioridade,
    });
    let pico = 0;
    const trabalhos = Array.from({ length: 6 }, (_, i) =>
      d.despachar(laudo(`i${i}`), async () => {
        pico = Math.max(pico, d.emExecucao.porAgente["1_curador"]);
        await new Promise((r) => setTimeout(r, 10));
      }),
    );
    await Promise.all(trabalhos);
    expect(pico).toBeLessThanOrEqual(teto);
  });

  it("libera a vaga quando o trabalho falha, senão a fila trava", async () => {
    const d = new Despachante();
    await expect(
      d.despachar(laudo("i1"), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(d.emExecucao.chaves).toHaveLength(0);
    expect(d.emExecucao.porAgente["1_curador"]).toBe(0);
    // E o imóvel volta a aceitar trabalho.
    await expect(d.despachar(laudo("i1"), async () => "ok")).resolves.toBe("ok");
  });
});

describe("R6 — idempotência", () => {
  it("evento já processado não roda de novo", async () => {
    const vistos = new Set<string>();
    const d = new Despachante(
      CONCORRENCIA_PADRAO,
      async (id) => vistos.has(id),
      async (e) => void vistos.add(e.idEvento),
    );
    const e = laudo("i1", "evento-fixo");
    let execucoes = 0;
    const run = () =>
      d.despachar(e, async () => {
        execucoes += 1;
        return "ok";
      });

    expect(await run()).toBe("ok");
    expect(await run()).toBe("duplicado");
    expect(execucoes).toBe(1);
  });
});
