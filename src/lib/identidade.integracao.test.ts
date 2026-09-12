import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, schema } from "@/lib/db";
import { fundir, reconhecer, vincular } from "./identidade-db";
import { cifrar, indice } from "@/lib/cripto";

/**
 * O caso do user, contra o banco de verdade.
 *
 * A mesma pessoa chega pelo Instagram como `@ju.mendes.sp` e depois pelo
 * WhatsApp como "Ju 💛". Nenhum campo é igual: não tem telefone no Instagram,
 * o nome do perfil não é o nome civil, e não há e-mail em lugar nenhum.
 *
 * O que este arquivo prova é o comportamento inteiro:
 * - a segunda mensagem do MESMO canal cai no mesmo cadastro (barato, exato);
 * - o palpite entre canais **não** funde nada, vira pergunta;
 * - quando alguém confirma, a fusão junta tudo sem perder histórico.
 */

const temBanco = Boolean(process.env.DATABASE_URL);
const d = temBanco ? describe : describe.skip;

let insta = "";
let zap = "";
let estranho = "";

beforeAll(async () => {
  if (!temBanco) return;

  // Só o que este teste usa. `cliente` NÃO é apagado: `imovel` aponta pra ela
  // e limpar a base inteira aqui derrubaria o estoque do seed junto.
  for (const t of [schema.identidade, schema.atendimento, schema.busca]) {
    await db.delete(t);
  }

  const criados = await db
    .insert(schema.cliente)
    .values([
      { nome: "ju.mendes.sp", origemCanal: "instagram" },
      { nome: "Ju", telefone: cifrar("15993110022"), origemCanal: "whatsapp" },
      {
        nome: "Roberto Almeida Pinto",
        email: cifrar("roberto@exemplo.com.br"),
        emailIndice: indice("roberto@exemplo.com.br"),
      },
    ])
    .returning();

  insta = criados[0]!.idCliente;
  zap = criados[1]!.idCliente;
  estranho = criados[2]!.idCliente;

  await db.insert(schema.identidade).values([
    {
      idCliente: insta,
      canal: "instagram",
      identificador: cifrar("ju.mendes.sp")!,
      identificadorIndice: indice("ju.mendes.sp"),
      apelido: "Ju Mendes | Sorocaba",
    },
    {
      idCliente: estranho,
      canal: "site",
      identificador: cifrar("roberto@exemplo.com.br")!,
      identificadorIndice: indice("roberto@exemplo.com.br"),
      apelido: "Roberto",
    },
  ]);

  await db.insert(schema.busca).values({
    idCliente: insta,
    tipoImovel: "apartamento",
    bairrosDesejados: ["Campolim"],
    valorMin: "700000",
    valorMax: "900000",
    textoOriginal: "algo no Campolim ate uns 900",
  });
});

afterAll(async () => {
  if (temBanco) await pool.end();
});

d("reconhecer sem telefone", () => {
  it("o mesmo @ no mesmo canal cai no mesmo cadastro, sem palpite nenhum", async () => {
    const v = await reconhecer({ canal: "instagram", identificador: "@Ju.Mendes.SP" });
    expect(v).toMatchObject({ acao: "vincular", idCliente: insta });
  });

  it("o mesmo apelido em OUTRO canal vira pergunta, não fusão", async () => {
    // O caso do user na íntegra: ela chega no WhatsApp com um identificador que
    // nunca foi visto, e o único elo é o apelido.
    const v = await reconhecer({
      canal: "whatsapp",
      identificador: "5515993110022",
      // Como o WhatsApp entrega de verdade: nome de perfil, não handle.
      apelido: "Ju Mendes",
      busca: { tipo: "apartamento", bairros: ["Campolim"], min: 750000, max: 950000 },
    });

    expect(v.acao).toBe("sugerir_fusao");
    if (v.acao === "sugerir_fusao") {
      expect(v.palpite.idCliente).toBe(insta);
      expect(v.palpite.motivos.join(" ")).toContain("apelido");
    }
  });

  it("desconhecido de verdade vira cadastro novo — duplicar é reversível", async () => {
    const v = await reconhecer({
      canal: "whatsapp",
      identificador: "5511987654321",
      apelido: "Paulo",
    });
    expect(v.acao).toBe("criar_cliente");
  });

  it("não confunde com quem só compartilha o primeiro nome", async () => {
    const v = await reconhecer({
      canal: "instagram",
      identificador: "roberto.silva.oficial",
      apelido: "Roberto",
    });
    // "Roberto" bate com "Roberto Almeida Pinto" no nome, mas nome sozinho não
    // é indício — senão o sistema fundiria estranhos homônimos.
    expect(v.acao).toBe("criar_cliente");
  });
});

d("vincular e fundir", () => {
  it("vincular é idempotente — a mesma mensagem chegando duas vezes não duplica", async () => {
    const sinais = { canal: "whatsapp" as const, identificador: "5515993110022", apelido: "Ju" };
    await vincular(zap, sinais);
    await vincular(zap, sinais);

    const linhas = await db
      .select()
      .from(schema.identidade)
      .where(eq(schema.identidade.idCliente, zap));
    expect(linhas).toHaveLength(1);
  });

  it("a fusão junta os canais e deixa rastro de que houve fusão", async () => {
    await fundir(insta, zap, "ana");

    const canais = await db
      .select()
      .from(schema.identidade)
      .where(eq(schema.identidade.idCliente, insta));
    expect(canais.map((c) => c.canal).sort()).toEqual(["instagram", "whatsapp"]);

    // O perdedor não some: apagar destruiria o histórico de quem falou o quê,
    // que é justamente o que torna a fusão auditável se ela estiver errada.
    const [antigo] = await db
      .select()
      .from(schema.cliente)
      .where(eq(schema.cliente.idCliente, zap));
    expect(antigo?.origemCanal).toBe(`fundido:${insta}`);

    const log = await db
      .select()
      .from(schema.logEvento)
      .where(eq(schema.logEvento.campo, "cliente.fusao"));
    expect(log[0]?.aprovadoPor).toBe("ana");
  });

  it("depois de fundido, o WhatsApp dela cai direto no cadastro certo", async () => {
    const v = await reconhecer({ canal: "whatsapp", identificador: "5515993110022" });
    // Agora é determinístico: o palpite de ontem virou chave de hoje. É assim
    // que o sistema aprende essa pessoa em vez de perguntar toda vez.
    expect(v).toMatchObject({ acao: "vincular", idCliente: insta });
  });
});
