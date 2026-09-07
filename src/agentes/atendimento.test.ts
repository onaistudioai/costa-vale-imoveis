import { describe, expect, it } from "vitest";
import { atender, type EntradaAtendimento, type ExtracaoConversa } from "./atendimento";
import { contextoFalso } from "./_teste/contexto-falso";
import type { Extrator } from "./modelo";
import type { ImovelOfertavel } from "@/regras/match";

const extracao = (over: Partial<ExtracaoConversa> = {}): ExtracaoConversa => ({
  resposta: "Tenho duas opções que encaixam.",
  criterios: { valorMin: null, valorMax: null, tipoImovel: null, bairrosDesejados: [] },
  intencaoDeVisita: false,
  imovelDeInteresse: null,
  perguntouSobreDocumentacao: false,
  foraDoPadrao: false,
  foraDoAssunto: false,
  resumo: "quer 2 quartos perto de escola até 400",
  ...over,
});

const extratorFalso = (e: ExtracaoConversa): Extrator => (async () => e) as Extrator;

const imovel = (over: Partial<ImovelOfertavel> = {}): ImovelOfertavel => ({
  idImovel: "i1",
  tipo: "casa",
  preco: 400_000,
  bairro: "Centro",
  cidade: "Sorocaba",
  estadoAnuncio: "no_ar",
  estadoComercial: "disponivel",
  ...over,
});

const entrada = (over: Partial<EntradaAtendimento> = {}): EntradaAtendimento => ({
  idCliente: "c1",
  idBusca: "b1",
  canal: "whatsapp",
  historico: "",
  mensagem: "queria algo de dois quartos perto de escola até uns 400",
  estoque: [imovel()],
  ...over,
});

describe("Agente 4 — escrita e propriedade de dado (R5)", () => {
  it("grava a busca com o texto original do cliente", async () => {
    const { ctx, escritas } = contextoFalso("4_atendimento");
    await atender(ctx, entrada(), extratorFalso(extracao()));
    const b = escritas.find((e) => e.campo === "busca");
    expect(JSON.parse(b!.valorNovo!).textoOriginal).toBe(
      "queria algo de dois quartos perto de escola até uns 400",
    );
  });

  it("escreve só em busca e papel — nunca em agenda nem imóvel", async () => {
    const { ctx, escritas } = contextoFalso("4_atendimento");
    await atender(ctx, entrada(), extratorFalso(extracao()));
    expect(escritas.map((e) => e.campo).sort()).toEqual(["busca", "papel"]);
  });
});

describe("Agente 4 — os três limites da seção 4", () => {
  it("não agenda: qualificar produz handoff, não evento de agenda", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada(),
      extratorFalso(extracao({ intencaoDeVisita: true, imovelDeInteresse: "i1" })),
    );
    expect(r.leadQualificado).toMatchObject({ idImovel: "i1" });
  });

  it("não agenda: a R5 impede em tempo de compilação, não em runtime", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    // Se esta linha um dia compilar, a propriedade de dado furou e a diretiva
    // abaixo quebra o build. É o teste mais forte que existe pra R5: o Agente
    // 4 não tem como escrever em agenda nem por engano.
    // @ts-expect-error agenda é do Agente 3
    await ctx.escrever({ campo: "agenda", idEntidade: "x", valorNovo: "y" });
  });

  it("não oferece imóvel em negociação, mesmo recebendo ele no estoque", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({
        estoque: [
          imovel({ idImovel: "vendendo", estadoComercial: "em_negociacao" }),
          imovel({ idImovel: "livre" }),
        ],
      }),
      extratorFalso(extracao()),
    );
    expect(r.candidatos).toEqual(["livre"]);
  });

  it("não qualifica sobre imóvel que saiu do ar entre a conversa e agora", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ estoque: [imovel({ idImovel: "i1", estadoAnuncio: "pausado" })] }),
      extratorFalso(extracao({ intencaoDeVisita: true, imovelDeInteresse: "i1" })),
    );
    expect(r.leadQualificado).toBeUndefined();
  });

  it("não promete documentação: a resposta ganha a ressalva", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada(),
      extratorFalso(
        extracao({
          resposta: "A matrícula está limpa, pode fechar tranquilo.",
          perguntouSobreDocumentacao: true,
        }),
      ),
    );
    expect(r.resposta).toContain("prefiro não afirmar nada");
  });
});

describe("Agente 4 — N3 versus N4, a bifurcação", () => {
  it("fora do padrão vai pro painel e NÃO pro Agente 3", async () => {
    const { ctx, pedidos } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ mensagem: "queria dar meu carro como parte do pagamento" }),
      extratorFalso(
        extracao({ foraDoPadrao: true, intencaoDeVisita: true, imovelDeInteresse: "i1" }),
      ),
    );
    // Mesmo com intenção de visita e imóvel válido, não há handoff.
    expect(r.leadQualificado).toBeUndefined();
    expect(r.escalacao).toMatchObject({ motivo: "conversa_fora_do_padrao" });
    expect(pedidos[0]).toMatchObject({ tipo: "escalacao_n3" });
  });

  it("curiosidade genérica não qualifica ninguém", async () => {
    const { ctx, pedidos } = contextoFalso("4_atendimento");
    const r = await atender(ctx, entrada(), extratorFalso(extracao()));
    expect(r.leadQualificado).toBeUndefined();
    expect(pedidos).toHaveLength(0);
  });

  it("intenção de visita sem imóvel identificado não qualifica", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada(),
      extratorFalso(extracao({ intencaoDeVisita: true, imovelDeInteresse: null })),
    );
    expect(r.leadQualificado).toBeUndefined();
  });

  it("o resumo da conversa viaja no handoff — é o contexto que o corretor recebe", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada(),
      extratorFalso(
        extracao({
          intencaoDeVisita: true,
          imovelDeInteresse: "i1",
          resumo: "quer visitar sábado de manhã",
        }),
      ),
    );
    expect(r.leadQualificado?.resumo).toBe("quer visitar sábado de manhã");
  });
});

describe("Agente 4 — mensagem fora do assunto", () => {
  const fora = (over: Partial<ExtracaoConversa> = {}) =>
    extracao({ foraDoAssunto: true, ...over });

  // O teste que protege o funil: sem ele, número errado e spam viram lead e
  // são ordenados em /funil junto com quem quer comprar.
  it("não grava nada — nem busca, nem papel", async () => {
    const { ctx, escritas } = contextoFalso("4_atendimento");
    await atender(
      ctx,
      entrada({ mensagem: "vocês fazem seguro de carro?" }),
      extratorFalso(fora()),
    );
    expect(escritas).toEqual([]);
  });

  it("não qualifica nem escala, mesmo com o modelo achando que há visita", async () => {
    const { ctx, pedidos } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ mensagem: "é a pizzaria?" }),
      extratorFalso(fora({ intencaoDeVisita: true, imovelDeInteresse: "i1" })),
    );
    expect(r.leadQualificado).toBeUndefined();
    expect(r.escalacao).toBeUndefined();
    // Número errado não é decisão de ninguém: enviar pro painel seria tratar
    // engano como se fosse permuta.
    expect(pedidos).toHaveLength(0);
    expect(r.candidatos).toEqual([]);
  });

  it("a resposta é a fixa, não a que o modelo escreveu", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ mensagem: "vocês vendem seguro?" }),
      extratorFalso(fora({ resposta: "Vendemos sim! Nosso seguro custa R$ 200 por mês." })),
    );
    expect(r.resposta).toContain("só consigo ajudar com imóveis");
    expect(r.resposta).not.toContain("R$ 200");
  });

  it("permuta vence fora do assunto: cliente atípico escala, não é calado", async () => {
    const { ctx, pedidos } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ mensagem: "queria dar meu carro como parte do pagamento" }),
      extratorFalso(fora({ foraDoPadrao: true })),
    );
    expect(pedidos[0]).toMatchObject({ tipo: "escalacao_n3" });
    expect(r.escalacao).toMatchObject({ motivo: "conversa_fora_do_padrao" });
  });

  it("mensagem normal continua gravando busca e papel", async () => {
    const { ctx, escritas } = contextoFalso("4_atendimento");
    await atender(ctx, entrada(), extratorFalso(extracao()));
    expect(escritas.map((e) => e.campo).sort()).toEqual(["busca", "papel"]);
  });
});

describe("Agente 4 — quer visitar, mas não dá pra saber o quê", () => {
  const gemeos = [
    imovel({ idImovel: "apto51", preco: 846000, endereco: "Rua Padre Luiz Bianchi, 120 - apto 51", bairro: "Campolim" }),
    imovel({ idImovel: "apto52", preco: 846000.5, endereco: "Rua Padre Luiz Bianchi, 120 - apto 52", bairro: "Campolim" }),
  ];

  const querVisitar = extracao({ intencaoDeVisita: true, imovelDeInteresse: null });

  // O defeito que este bloco existe pra impedir é invisível: o modelo promete
  // encaminhar, o sistema não encaminha (sem imóvel não há handoff), e nada
  // registra isso. Só sobra um cliente esperando ligação que não vem.
  it("nunca promete encaminhar quando não vai encaminhar", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ estoque: gemeos }),
      extratorFalso(
        extracao({
          ...querVisitar,
          resposta: "Vou encaminhar seu pedido ao corretor e ele entra em contato!",
        }),
      ),
    );

    expect(r.leadQualificado).toBeUndefined();
    expect(r.resposta).not.toContain("encaminhar");
    expect(r.resposta).toContain("Qual deles?");
  });

  it("dois gêmeos: a pergunta cita o endereço, que é o que os distingue", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(ctx, entrada({ estoque: gemeos }), extratorFalso(querVisitar));

    // Tipo e preço não separam nada aqui — são cinquenta centavos de diferença.
    expect(r.resposta).toContain("apto 51");
    expect(r.resposta).toContain("apto 52");
  });

  it("um candidato só: confirma antes de chamar o corretor, não adivinha", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ estoque: [gemeos[0]!] }),
      extratorFalso(querVisitar),
    );
    expect(r.resposta).toContain("confirma");
    expect(r.leadQualificado).toBeUndefined();
  });

  it("nenhum candidato: diz que não tem, em vez de prometer procurar por aí", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ estoque: [] }),
      extratorFalso(querVisitar),
    );
    expect(r.resposta).toContain("Não tenho nada com esse perfil");
  });

  it("com imóvel identificado, o caminho normal continua: qualifica e passa adiante", async () => {
    const { ctx } = contextoFalso("4_atendimento");
    const r = await atender(
      ctx,
      entrada({ estoque: gemeos }),
      extratorFalso(extracao({ intencaoDeVisita: true, imovelDeInteresse: "apto52" })),
    );
    expect(r.leadQualificado).toMatchObject({ idImovel: "apto52" });
  });
});
