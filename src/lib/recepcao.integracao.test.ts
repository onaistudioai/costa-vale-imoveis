import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "@/lib/db";
import { pedirFusao, receber } from "./recepcao";
import { fundir } from "./identidade-db";

/**
 * A costura que faltava: identidade valendo na entrada de verdade.
 *
 * O roteiro é o do user, do começo ao fim. A mesma pessoa manda DM no
 * Instagram, some, e três dias depois chama no WhatsApp com outro perfil e
 * nenhum campo em comum. O que este arquivo prova:
 *
 * 1. a segunda mensagem do mesmo canal cai no mesmo cadastro;
 * 2. a chegada pelo outro canal **é atendida na hora** e o pedido de fusão vai
 *    pro painel em paralelo — a conversa não espera decisão de ninguém;
 * 3. aprovada a fusão, o histórico dos dois vira um só;
 * 4. quem some e volta reabre o caso em vez de continuar pendurado.
 */

const temBanco = Boolean(process.env.DATABASE_URL);
const d = temBanco ? describe : describe.skip;

const agora = new Date();
const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000);

beforeAll(async () => {
  if (!temBanco) return;
  for (const t of [schema.aprovacao, schema.identidade, schema.atendimento, schema.busca]) {
    await db.delete(t);
  }
});

afterAll(async () => {
  if (temBanco) await pool.end();
});

d("a pessoa chegando", () => {
  let doInsta = "";

  it("primeira DM do Instagram abre cadastro e caso no funil", async () => {
    const r = await receber({
      canal: "instagram",
      identificador: "@ju.mendes.sp",
      apelido: "Ju Mendes | Sorocaba",
      mensagem: "oi! vi o apê de vcs, tem algo no Campolim?",
    });

    expect(r.novo).toBe(true);
    expect(r.fusaoSugerida).toBeUndefined();
    doInsta = r.idCliente;

    const [caso] = await db
      .select()
      .from(schema.atendimento)
      .where(eq(schema.atendimento.idCliente, doInsta));
    // A bola é nossa: ela falou por último.
    expect(caso?.ultimoContatoPor).toBe("cliente");
    expect(caso?.estado).toBe("aberto");
  });

  it("a segunda mensagem dela no mesmo canal NÃO abre cadastro novo", async () => {
    const r = await receber({
      canal: "instagram",
      identificador: "ju.mendes.sp",
      mensagem: "ainda tá disponível?",
    });
    expect(r.idCliente).toBe(doInsta);
    expect(r.novo).toBe(false);
  });

  it("ela no WhatsApp é atendida NA HORA, e a fusão vai pro painel em paralelo", async () => {
    // O ponto do desenho inteiro: nada aqui espera humano. Segurar a conversa
    // até alguém confirmar deixaria um cliente de madrugada sem resposta até
    // as 7h30 por causa de dúvida interna de cadastro.
    const r = await receber({
      canal: "whatsapp",
      identificador: "5515993110022",
      apelido: "Ju Mendes",
      mensagem: "boa noite, procuro apartamento no campolim",
    });

    expect(r.idCliente).toBeTruthy();
    expect(r.idAtendimento).toBeTruthy();
    expect(r.fusaoSugerida?.idCandidato).toBe(doInsta);
    expect(r.fusaoSugerida?.motivos.join(" ")).toContain("apelido");

    // E a pergunta que resolveria sozinho, sem passar por ninguém do painel.
    expect(r.fusaoSugerida?.pergunta).toContain("Ju");

    await pedirFusao("11111111-1111-1111-1111-111111111111", r as never);

    const [pedido] = await db
      .select()
      .from(schema.aprovacao)
      .where(eq(schema.aprovacao.tipo, "fundir_identidade"));

    expect(pedido?.destinatario).toBe(doInsta);
    // Nenhuma thread parada: este pedido nasce fora do grafo e não bloqueia nada.
    expect(pedido?.threadId).toBeNull();
  });

  it("aprovada a fusão, os dois canais viram um cadastro só", async () => {
    const [pedido] = await db
      .select()
      .from(schema.aprovacao)
      .where(eq(schema.aprovacao.tipo, "fundir_identidade"));

    await fundir(pedido!.destinatario!, pedido!.idEntidade, "ana");

    const canais = await db
      .select()
      .from(schema.identidade)
      .where(eq(schema.identidade.idCliente, doInsta));
    expect(canais.map((c) => c.canal).sort()).toEqual(["instagram", "whatsapp"]);

    // E daí em diante o WhatsApp dela é chave, não palpite.
    const r = await receber({
      canal: "whatsapp",
      identificador: "5515993110022",
      mensagem: "consegui ver o apê?",
    });
    expect(r.idCliente).toBe(doInsta);
    expect(r.fusaoSugerida).toBeUndefined();
  });
});

d("quem some e volta", () => {
  it("mensagem nova reabre o caso pendurado em vez de deixá-lo pedindo desfecho", async () => {
    const [c] = await db
      .insert(schema.cliente)
      .values({ nome: "Sumido Voltou", origemCanal: "whatsapp" })
      .returning();

    await db.insert(schema.identidade).values({
      idCliente: c!.idCliente,
      canal: "whatsapp",
      identificador: "5511900000001",
    });

    await db.insert(schema.atendimento).values({
      idCliente: c!.idCliente,
      etapa: "proposta",
      etapaMaxima: "proposta",
      estado: "pendente",
      precisaDesfecho: true,
      ultimaInteracao: diasAtras(40),
      ultimoContatoPor: "nos",
    });

    await receber({
      canal: "whatsapp",
      identificador: "5511900000001",
      mensagem: "oi, desculpa a demora — ainda dá pra conversar?",
    });

    const [caso] = await db
      .select()
      .from(schema.atendimento)
      .where(eq(schema.atendimento.idCliente, c!.idCliente));

    // Quem voltou a falar não precisa de ponto final, precisa de resposta.
    expect(caso?.precisaDesfecho).toBe(false);
    expect(caso?.estado).toBe("aberto");
    // E não perde o que já tinha alcançado: volta ao topo como quem fez
    // proposta, não como curioso novo.
    expect(caso?.etapaMaxima).toBe("proposta");
  });
});
