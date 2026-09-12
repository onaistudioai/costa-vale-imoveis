import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Command, MemorySaver } from "@langchain/langgraph";
import { db, pool, schema } from "@/lib/db";
import { CONFIG_ROTEAMENTO } from "@/lib/config";
import { ioDb } from "@/agentes/contexto-db";
import type { Extrator } from "@/agentes/modelo";
import { construirGrafo } from "./index";
import { mundoDb } from "./mundo-db";
import { threadDoEvento, type Evento } from "./eventos";
import { processarEvento } from "./runtime";
import { varrerPrazos } from "@/lib/varredura";
import { cifrar } from "@/lib/cripto";

/**
 * Fluxo A e Fluxo B ponta a ponta, com o grafo de produção inteiro: nós reais,
 * `ioDb`, `mundoDb`, gate por `interrupt()` e retomada pelo painel.
 *
 * Só o modelo é substituído — o que está sob teste é o caminho do evento até o
 * banco, não a qualidade da extração (essa está nos testes de cada agente).
 */

const temBanco = Boolean(process.env.DATABASE_URL);
const d = temBanco ? describe : describe.skip;

/** O grafo de produção com um extrator fixo no lugar do modelo. */
function montar(extracao: unknown) {
  const extrator: Extrator = (async () => extracao) as Extrator;
  return construirGrafo({
    mundo: mundoDb,
    io: ioDb,
    extrator,
    config: CONFIG_ROTEAMENTO,
  }).compile({ checkpointer: new MemorySaver() });
}

const cfg = (e: Evento) => ({ configurable: { thread_id: threadDoEvento(e) } });

/**
 * O que o painel faz quando alguém decide: fecha o registro e retoma a thread.
 * É a mesma sequência de `app/actions.ts`, sem o Next no meio.
 */
async function decidirNoPainel(
  app: ReturnType<typeof montar>,
  aprovado: boolean,
  por = "fabiano",
  motivo?: string,
) {
  const [pedido] = await db
    .select()
    .from(schema.aprovacao)
    .where(eq(schema.aprovacao.estado, "pendente"));
  expect(pedido, "nenhum pedido pendente na fila").toBeDefined();

  await db
    .update(schema.aprovacao)
    .set({
      estado: aprovado ? "aprovado" : "negado",
      decididoPor: por,
      decididoEm: new Date(),
      motivo: motivo ?? null,
    })
    .where(eq(schema.aprovacao.id, pedido!.id));

  return app.invoke(new Command({ resume: { aprovado, por, motivo } }), {
    configurable: { thread_id: pedido!.threadId! },
  });
}

async function limpar() {
  for (const t of [
    schema.logEvento,
    schema.aprovacao,
    schema.eventoProcessado,
    schema.agenda,
    schema.parcelaAluguel,
    schema.contratoLocacao,
    schema.processoEscritura,
    schema.atendimento,
    schema.identidade,
    schema.vinculoLeadCorretor,
    schema.dominioCorretor,
    schema.busca,
    schema.papel,
    schema.anuncio,
    schema.laudo,
    schema.transacao,
    schema.imovel,
    schema.cliente,
    schema.corretor,
  ]) {
    await db.delete(t);
  }
}

async function criarImovel(over: Partial<typeof schema.imovel.$inferInsert> = {}) {
  const [i] = await db
    .insert(schema.imovel)
    .values({ tipo: "casa", endereco: "Rua Teste 47", cidade: "Sorocaba", ...over })
    .returning();
  return i!;
}

// O pool é do arquivo inteiro: fechar dentro de um describe derruba o próximo.
afterAll(async () => {
  if (!temBanco) return;
  await limpar();
  await pool.end();
});

d("Fluxo A — imóvel entra no estoque e vira anúncio", () => {
  beforeEach(limpar);

  it("laudo limpo para no gate; a aprovação no painel é que põe no ar", async () => {
    const imovel = await criarImovel({ estadoOperacional: "em_preparacao" });
    const [laudo] = await db
      .insert(schema.laudo)
      .values({
        idImovel: imovel.idImovel,
        tipo: "vistoria",
        textoEstado: "casa em ordem",
        textoDocumentacao: "matrícula saiu hoje",
        textoPendencias: "nenhuma",
      })
      .returning();

    const app = montar({
      pendencias: [],
      precoMencionado: 415000,
      confianca: "alta",
      resumo: "Imóvel 47 liberado. Faltava documentação, subiu hoje.",
    });
    const evento: Evento = {
      idEvento: crypto.randomUUID(),
      tipo: "laudo.criado",
      idImovel: imovel.idImovel,
      payload: { idLaudo: laudo!.idLaudo },
    };

    const parcial = await app.invoke({ evento }, cfg(evento));

    // Antes do humano: estado já mudou, mas nada foi ao ar.
    expect(parcial.trilha).toEqual(["curador:pausa"]);
    const [meio] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, imovel.idImovel));
    expect(meio!.estadoOperacional).toBe("pronto");
    expect(meio!.preco).toBe("415000.00");
    expect(meio!.estadoAnuncio).toBe("sem_anuncio");
    expect(await db.select().from(schema.anuncio)).toHaveLength(0);

    const [pendente] = await db.select().from(schema.aprovacao);
    expect(pendente).toMatchObject({ tipo: "subir_anuncio", estado: "pendente" });
    expect(pendente!.threadId).toBe(threadDoEvento(evento));

    const final = await decidirNoPainel(app, true);
    expect(final.trilha).toEqual(["curador:pausa", "gate", "curador"]);

    const [depois] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, imovel.idImovel));
    expect(depois!.estadoAnuncio).toBe("no_ar");
    expect(await db.select().from(schema.anuncio)).toHaveLength(2);

    // A extração ficou guardada ao lado do texto original.
    const [lidoDeVolta] = await db
      .select()
      .from(schema.laudo)
      .where(eq(schema.laudo.idLaudo, laudo!.idLaudo));
    expect(lidoDeVolta!.textoEstado).toBe("casa em ordem");
    expect(lidoDeVolta!.extracaoEstruturada).toMatchObject({ confianca: "alta" });

    const log = await db.select().from(schema.logEvento);
    expect(log.map((l) => l.campo)).toContain("imovel.estadoAnuncio");

    // R7 fechada no banco: o nó re-executou, mas a fila e o histórico não
    // duplicaram — um pedido, e uma linha por campo escrito.
    expect(await db.select().from(schema.aprovacao)).toHaveLength(1);
    const operacional = log.filter((l) => l.campo === "imovel.estadoOperacional");
    expect(operacional).toHaveLength(1);
  });

  it("humano nega e nada sobe", async () => {
    const imovel = await criarImovel({ estadoOperacional: "em_preparacao" });
    await db
      .insert(schema.laudo)
      .values({ idImovel: imovel.idImovel, tipo: "vistoria", textoEstado: "ok" });

    const app = montar({
      pendencias: [],
      precoMencionado: null,
      confianca: "alta",
      resumo: "pronto",
    });
    const evento: Evento = {
      idEvento: crypto.randomUUID(),
      tipo: "laudo.criado",
      idImovel: imovel.idImovel,
    };

    await app.invoke({ evento }, cfg(evento));
    await decidirNoPainel(app, false, "fabiano", "quero ver as fotos antes");

    const [depois] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, imovel.idImovel));
    expect(depois!.estadoOperacional).toBe("pronto");
    expect(depois!.estadoAnuncio).toBe("sem_anuncio");
    expect(await db.select().from(schema.anuncio)).toHaveLength(0);

    const [ap] = await db.select().from(schema.aprovacao);
    expect(ap).toMatchObject({ estado: "negado", motivo: "quero ver as fotos antes" });
  });
});

d("Fluxo B — venda avança e o anúncio precisa cair", () => {
  beforeEach(limpar);

  it("orgânico cai sozinho, mídia paga espera humano, estado muda antes dos dois", async () => {
    const imovel = await criarImovel({ estadoOperacional: "pronto", estadoAnuncio: "no_ar" });
    await db.insert(schema.anuncio).values([
      { idImovel: imovel.idImovel, canal: "zap" },
      {
        idImovel: imovel.idImovel,
        canal: "meta",
        midiaPaga: true,
        custoAcumulado: "340.50",
      },
    ]);
    const [transacao] = await db
      .insert(schema.transacao)
      .values({ idImovel: imovel.idImovel, tipo: "venda", etapa: "proposta_feita" })
      .returning();

    const app = montar({
      etapa: "proposta_aceita",
      valorProposto: 400000,
      confianca: "alta",
      resumo: "Imóvel 47 entrou em negociação com a Ana.",
    });
    const evento: Evento = {
      idEvento: crypto.randomUUID(),
      tipo: "transacao.atualizada",
      idImovel: imovel.idImovel,
      payload: {
        idTransacao: transacao!.idTransacao,
        documento: "vendedor aceitou 400 mil",
      },
    };

    await app.invoke({ evento }, cfg(evento));

    const [depois] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, imovel.idImovel));
    expect(depois!.estadoComercial).toBe("em_negociacao");

    const [t] = await db.select().from(schema.transacao);
    expect(t!.etapa).toBe("proposta_aceita");

    const [ap] = await db.select().from(schema.aprovacao);
    expect(ap).toMatchObject({ tipo: "derrubar_midia", estado: "pendente" });
    expect(ap!.contexto).toMatchObject({ custoEmRisco: 340.5 });

    // A queda automática (trigger, migration 0001): a vitrine cai sozinha e o
    // anúncio orgânico junto. A mídia paga fica de pé esperando o humano —
    // é o que separa "proteger o lead" de "parar o gasto".
    expect(depois!.estadoAnuncio).toBe("pausado");
    const porCanal = Object.fromEntries(
      (await db.select().from(schema.anuncio)).map((a) => [a.canal, a.status]),
    );
    expect(porCanal).toEqual({ zap: "pausado", meta: "no_ar" });
  });

  it("o estado comercial muda mesmo quando o humano nega a derrubada de mídia", async () => {
    // O ponto fino do Fluxo B: a proteção do lead não pode esperar clique.
    const imovel = await criarImovel({ estadoOperacional: "pronto", estadoAnuncio: "no_ar" });
    await db.insert(schema.anuncio).values({
      idImovel: imovel.idImovel,
      canal: "meta",
      midiaPaga: true,
      custoAcumulado: "900",
    });
    const [transacao] = await db
      .insert(schema.transacao)
      .values({ idImovel: imovel.idImovel, tipo: "venda", etapa: "proposta_feita" })
      .returning();

    const app = montar({
      etapa: "documentacao_em_analise",
      valorProposto: null,
      confianca: "alta",
      resumo: "documentação em análise",
    });
    const evento: Evento = {
      idEvento: crypto.randomUUID(),
      tipo: "transacao.atualizada",
      idImovel: imovel.idImovel,
      payload: { idTransacao: transacao!.idTransacao, documento: "assinaram" },
    };

    await app.invoke({ evento }, cfg(evento));

    const [meio] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, imovel.idImovel));
    expect(meio!.estadoComercial).toBe("em_processo_venda");

    await decidirNoPainel(app, false);

    const [ap] = await db.select().from(schema.aprovacao);
    expect(ap).toMatchObject({ estado: "negado" });
    const [anuncio] = await db.select().from(schema.anuncio);
    expect(anuncio!.status).toBe("no_ar");
  });
});


d("Fluxo C — push com aceite e prazo", () => {
  beforeEach(limpar);

  it("prazo vencido passa o lead pro próximo colocado, sem ninguém clicar", async () => {
    const imovel = await criarImovel({ estadoOperacional: "pronto", estadoAnuncio: "no_ar" });
    const [cliente] = await db
      .insert(schema.cliente)
      .values({ nome: "Helena Prado Vasques", telefone: cifrar("15992000001") })
      .returning();
    const corretores = await db
      .insert(schema.corretor)
      .values([
        { nome: "Ana Beatriz Moraes", telefone: cifrar("15991000001") },
        { nome: "Bruno Tavares Lima", telefone: cifrar("15991000002") },
      ])
      .returning();

    // Ana captou: ganha a primeira oferta com folga.
    await db.insert(schema.dominioCorretor).values([
      { idImovel: imovel.idImovel, idCorretor: corretores[0]!.idCorretor, nivel: "captou" },
      { idImovel: imovel.idImovel, idCorretor: corretores[1]!.idCorretor, nivel: "ja_visitou" },
    ]);

    const evento: Evento = {
      idEvento: crypto.randomUUID(),
      tipo: "lead.qualificado",
      idImovel: imovel.idImovel,
      payload: {
        lead: {
          idCliente: cliente!.idCliente,
          idImovel: imovel.idImovel,
          resumo: "quer visitar a casa ainda esta semana",
        },
      },
    };

    // O grafo de produção inteiro: PostgresSaver, ioDb, mundoDb.
    const parcial = await processarEvento(evento);
    expect((parcial as { trilha: string[] }).trilha).toEqual(["roteador:pausa"]);

    const [oferta] = await db.select().from(schema.aprovacao);
    expect(oferta).toMatchObject({ tipo: "aceite_corretor", estado: "pendente" });
    expect(oferta!.destinatario).toBe(corretores[0]!.idCorretor);
    expect(oferta!.expiraEm).toBeInstanceOf(Date);
    // Nada reservado antes do aceite: a agenda de quem não respondeu fica livre.
    expect(await db.select().from(schema.agenda)).toHaveLength(0);

    // O relógio anda: a Ana não respondeu.
    await db
      .update(schema.aprovacao)
      .set({ expiraEm: new Date(Date.now() - 60_000) })
      .where(eq(schema.aprovacao.id, oferta!.id));

    const r = await varrerPrazos();
    expect(r.expirados).toBe(1);

    // A oferta expirada vira registro; a próxima já está com o Bruno.
    const ofertas = await db.select().from(schema.aprovacao);
    const porCorretor = Object.fromEntries(
      ofertas.map((o) => [o.destinatario, o.estado]),
    );
    expect(porCorretor[corretores[0]!.idCorretor]).toBe("expirado");
    expect(porCorretor[corretores[1]!.idCorretor]).toBe("pendente");

    // E o motivo ficou auditável — "expirou" não é a mesma coisa que "recusou".
    const log = await db.select().from(schema.logEvento);
    expect(log.map((l) => l.campo)).toContain("expirou.aceite_corretor");
  });
});