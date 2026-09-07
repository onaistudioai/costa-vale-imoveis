import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/lib/db";
import { poolLeitura } from "@/lib/db/leitura";
import { consultar, type Intencao, type Resposta } from "./index";
import * as r from "./relatorios";
import type { Extrator } from "@/agentes/modelo";

/**
 * O agente de consulta contra o banco de verdade.
 *
 * O que está sob teste: que os números saem do banco, e que este agente
 * **não consegue** escrever nem se quiser.
 *
 * O arquivo monta o próprio estoque em vez de depender do `npm run seed` — um
 * teste que precisa de dado que alguém rodou antes falha sozinho no dia em que
 * outro teste limpar a tabela.
 */

const temBanco = Boolean(process.env.DATABASE_URL);
const d = temBanco ? describe : describe.skip;

beforeAll(async () => {
  if (!temBanco) return;

  for (const t of [
    schema.logEvento,
    schema.parcelaAluguel,
    schema.contratoLocacao,
    schema.processoEscritura,
    schema.atendimento,
    schema.identidade,
    schema.aprovacao,
    schema.anuncio,
    schema.imovel,
    schema.corretor,
  ]) {
    await db.delete(t);
  }

  const corretores = await db
    .insert(schema.corretor)
    .values([
      { nome: "Ana Beatriz Moraes" },
      { nome: "Bruno Tavares Lima" },
      { nome: "Carla Nunes Ferrari" },
      { nome: "Diego Ramalho Pinto" },
      { nome: "Elaine Barros Cruz" },
    ])
    .returning();

  const imoveis = await db
    .insert(schema.imovel)
    .values([
      // Dois no Campolim: é o caso ambíguo que o agente não pode resolver sozinho.
      { tipo: "apartamento", endereco: "Av. Gisele Constantino, 780", bairro: "Campolim", cidade: "Sorocaba", preco: "846000", estadoOperacional: "pronto", estadoAnuncio: "no_ar" },
      { tipo: "apartamento", endereco: "Rua Antônio Carlos Comitre, 210", bairro: "Campolim", cidade: "Sorocaba", preco: "1178000", estadoOperacional: "pronto" },
      { tipo: "casa", endereco: "Rua Rui Barbosa, 1122", bairro: "Jardim América", cidade: "Sorocaba", preco: "1281000", estadoOperacional: "em_preparacao" },
    ])
    .returning();

  await db.insert(schema.anuncio).values([
    { idImovel: imoveis[0]!.idImovel, canal: "site" },
    { idImovel: imoveis[0]!.idImovel, canal: "meta", midiaPaga: true, custoAcumulado: "412.90" },
  ]);

  await db.insert(schema.dominioCorretor).values({
    idImovel: imoveis[0]!.idImovel,
    idCorretor: corretores[0]!.idCorretor,
    nivel: "captou",
  });
});

afterAll(async () => {
  if (!temBanco) return;
  await poolLeitura.end();
  await pool.end();
});

d("consulta — a garantia de só leitura", () => {
  it("a conexão do relatório NÃO consegue escrever", async () => {
    // A prova de que "somente leitura" não é promessa, é permissão: quem
    // recusa é o Postgres, não uma regra nossa que alguém pode esquecer.
    // 42501 é o código do "permissão insuficiente" do Postgres.
    const erro = await poolLeitura
      .query("INSERT INTO corretor (nome) VALUES ('invasor')")
      .then(() => null)
      .catch((e: { code?: string }) => e);

    expect(erro, "o papel de leitura conseguiu escrever").not.toBeNull();
    expect(erro!.code).toBe("42501");
  });

  it("nem apagar", async () => {
    const erro = await poolLeitura
      .query("DELETE FROM aprovacao")
      .then(() => null)
      .catch((e: { code?: string }) => e);

    expect(erro!.code).toBe("42501");
  });

  it("mas lê tudo que precisa", async () => {
    expect((await r.estoque()).total).toBe(3);
  });
});

d("consulta — os relatórios", () => {
  it("estoque separa o que está pronto e fora do ar", async () => {
    const e = await r.estoque();
    expect(e.total).toBe(3);
    // O apartamento pronto sem anúncio é dinheiro parado na prateleira, e
    // aparecer nessa lista é o ponto do relatório.
    expect(e.prontosForaDoAr).toHaveLength(1);
    expect(e.prontosForaDoAr[0]!.bairro).toBe("Campolim");
    // O que ainda está em preparação não é "parado", é trabalho em andamento.
    expect(e.travados.map((t) => t.estado)).toEqual(["em_preparacao"]);
  });

  it("campanhas somam o gasto e separam o que queima em negociação", async () => {
    const c = await r.campanhas();
    expect(c.gastoTotal).toBe(412.9);
    expect(c.gastoNoAr).toBe(412.9);
    // O imóvel está disponível: a campanha é gasto normal, não desperdício.
    expect(c.queimandoEmNegociacao).toEqual([]);
  });

  it("equipe conta oferta por corretor sem esquecer quem não recebeu nenhuma", async () => {
    const eq = await r.equipe();
    expect(eq.corretores).toHaveLength(5);
    // Corretor sem oferta aparece zerado em vez de sumir do relatório — some
    // do relatório é como um corretor parado vira invisível.
    expect(eq.corretores.every((c) => typeof c.aceitas === "number")).toBe(true);
  });

  it("imóvel inexistente devolve nada em vez de explodir", async () => {
    expect(await r.acharImovel("rua que não existe em lugar nenhum")).toEqual([]);
  });
});

d("consulta — o modelo escolhe o relatório, nunca o número", () => {
  /** Extrator falso: primeira chamada classifica, segunda redige. */
  const extratorFalso = (intencao: Intencao): { extrair: Extrator; vistos: string[] } => {
    const vistos: string[] = [];
    let n = 0;
    const extrair = (async (args: { entrada: string }) => {
      vistos.push(args.entrada);
      if (n++ === 0) return intencao;
      return { texto: "resposta redigida", alerta: null } satisfies Resposta;
    }) as Extrator;
    return { extrair, vistos };
  };

  it("os dados chegam ao redator já prontos, vindos do banco", async () => {
    const { extrair, vistos } = extratorFalso({
      relatorio: "campanhas",
      dias: null,
      termoDoImovel: null,
    });

    const saida = await consultar("quanto estou gastando em mídia?", extrair);

    expect(saida.relatorio).toBe("campanhas");
    expect(saida.texto).toBe("resposta redigida");
    // A segunda chamada ao modelo recebe os dados reais junto da pergunta: é
    // isso que impede o texto de ser um chute bem redigido.
    expect(vistos[1]).toContain("gastoTotal");
    expect(saida.dados).toHaveProperty("gastoTotal");
  });

  it("imóvel citado por bairro com vários resultados devolve a lista, não escolhe", async () => {
    const { extrair } = extratorFalso({
      relatorio: "imovel",
      dias: null,
      termoDoImovel: "Campolim",
    });

    const saida = await consultar("como está o imóvel do Campolim?", extrair);
    // São dois no Campolim. Escolher um por conta própria seria responder com
    // confiança sobre o imóvel errado.
    expect(saida.dados).toHaveProperty("ambiguo");
  });
});
