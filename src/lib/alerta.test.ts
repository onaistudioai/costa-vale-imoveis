import { afterEach, describe, expect, it } from "vitest";
import { montarAlerta, urlDoPedido } from "./alerta";
import type { PedidoAprovacao } from "@/agentes/contrato";
import type { Consolidado } from "@/mesa";

const pedido = (over: Partial<PedidoAprovacao> = {}): PedidoAprovacao => ({
  tipo: "derrubar_midia",
  entidade: "imovel",
  idEntidade: "193933d0-3cf8-497e-94cc-2c5d5c908c11",
  contexto: {},
  ...over,
});

const proposta: Consolidado = {
  recomendacao: "aprovar",
  justificativa: "a negociação está assinada, a mídia não tem mais retorno",
  convergiu: true,
  ressalva: null,
};

describe("qual canal dispara", () => {
  it("vermelha chama e guarda — os dois canais", () => {
    const a = montarAlerta("2_guardiao", pedido({ faixa: "vermelha" }));
    expect(a.whatsapp).toBeDefined();
    expect(a.email).toBeDefined();
  });

  it("amarela só guarda — não interrompe ninguém", () => {
    const a = montarAlerta("4_atendimento", pedido({ faixa: "amarela" }));
    expect(a.whatsapp).toBeUndefined();
    expect(a.email).toBeDefined();
  });

  it("verde não sai do painel", () => {
    const a = montarAlerta("3_roteador", pedido({ faixa: "verde" }));
    expect(a).toEqual({});
  });

  it("sem faixa vale verde — o comportamento de antes da faixa existir", () => {
    expect(montarAlerta("1_curador", pedido())).toEqual({});
  });

  it("pedido com destinatário não sai por aqui, nem sendo vermelho", () => {
    const a = montarAlerta(
      "3_roteador",
      pedido({ faixa: "vermelha", tipo: "aceite_corretor", destinatario: "corretor-1" }),
    );
    expect(a).toEqual({});
  });
});

describe("o que NÃO pode sair do sistema", () => {
  // O teste que justifica este arquivo ser puro: prova de vazamento sem banco.
  const sujo = pedido({
    faixa: "vermelha",
    contexto: {
      motivo: "conversa_fora_do_padrao",
      mensagem: "aqui é a Joana, meu telefone é 15 99999-8888",
      resumo: "Joana quer permutar o apartamento dela pelo do Campolim",
      pedidoOriginal: "muda o telefone da Joana pra 15999998888",
      nomeCandidato: "Joana Ribeiro",
    },
    proposta,
  });

  const a = montarAlerta("4_atendimento", sujo);
  const tudo = `${a.whatsapp ?? ""}\n${a.email?.assunto ?? ""}\n${a.email?.corpo ?? ""}`;

  it.each([
    ["a fala do cliente", "Joana"],
    ["o telefone", "99999"],
    ["o pedido como foi escrito", "muda o telefone"],
    ["o resumo da conversa", "permutar"],
  ])("não vaza %s", (_nome, trecho) => {
    expect(tudo).not.toContain(trecho);
  });

  it("campo que ninguém liberou fica de fora por omissão", () => {
    const a = montarAlerta(
      "1_curador",
      pedido({ faixa: "vermelha", contexto: { campoNovoQueAlguemAdicionou: "segredo" } }),
    );
    expect(a.email!.corpo).not.toContain("segredo");
  });
});

describe("o que o e-mail precisa carregar", () => {
  const a = montarAlerta(
    "2_guardiao",
    pedido({
      faixa: "vermelha",
      contexto: {
        etapa: "assinada",
        custoEmRisco: 4200,
        canais: ["zap", "olx"],
        motivo: "venda_fechada",
      },
      proposta,
    }),
    "https://painel.exemplo.com",
  );

  it("o assunto serve de busca meses depois", () => {
    expect(a.email!.assunto).toContain("[Urgente]");
    expect(a.email!.assunto).toContain("Derrubar mídia paga");
  });

  it("o dinheiro aparece em reais, não como número cru", () => {
    expect(a.email!.corpo).toContain("R$ 4200,00");
  });

  it("os canais viram lista legível", () => {
    expect(a.email!.corpo).toContain("zap, olx");
  });

  it("carrega o que a mesa achou — o texto que só existia no painel", () => {
    expect(a.email!.corpo).toContain("a negociação está assinada");
    expect(a.email!.corpo).toContain("sugestão de máquina");
  });

  it("leva o link direto quando o painel tem endereço", () => {
    expect(a.email!.corpo).toContain("https://painel.exemplo.com");
  });

  it("sem endereço configurado, manda abrir o painel mesmo assim", () => {
    const b = montarAlerta("2_guardiao", pedido({ faixa: "vermelha" }));
    expect(b.email!.corpo).toContain("Abra o painel");
  });

  it("a ressalva da mesa aparece quando ficou algo em aberto", () => {
    const b = montarAlerta(
      "2_guardiao",
      pedido({
        faixa: "amarela",
        proposta: { ...proposta, convergiu: false, ressalva: "o laudo não cita a garagem" },
      }),
    );
    expect(b.email!.corpo).toContain("o laudo não cita a garagem");
  });
});

describe("escalação vira o motivo, não o rótulo genérico", () => {
  // Sete situações compartilham o tipo `escalacao_n3`. "Escalação" não se
  // procura na caixa de entrada três meses depois; o motivo, sim.
  const escalar = (motivo: string, faixa: "vermelha" | "amarela" = "amarela") =>
    montarAlerta(
      "4_atendimento",
      pedido({ tipo: "escalacao_n3", entidade: "cliente", faixa, contexto: { motivo } }),
    );

  it.each([
    ["conversa_fora_do_padrao", "Conversa fora do padrão"],
    ["etapa_ambigua", "Etapa da negociação ambígua"],
    ["conflito_de_agenda", "Conflito de agenda"],
    ["ninguem_aceitou", "Ninguém aceitou o lead"],
    ["estado_comercial_mudou", "Imóvel saiu de disponível"],
    ["sem_slot_no_horizonte", "Sem horário disponível"],
    ["nenhum_corretor_acima_do_minimo", "Nenhum corretor com perfil"],
  ])("%s vira '%s' no assunto", (motivo, esperado) => {
    expect(escalar(motivo).email!.assunto).toContain(esperado);
  });

  it("nenhum assunto de escalação diz só 'Escalação'", () => {
    expect(escalar("conflito_de_agenda").email!.assunto).not.toContain("Escalação");
  });

  it("motivo desconhecido não quebra — vira legível mesmo assim", () => {
    expect(escalar("algum_motivo_novo").email!.assunto).toContain("algum motivo novo");
  });

  it("o motivo não aparece duas vezes no WhatsApp", () => {
    const w = escalar("ninguem_aceitou", "vermelha").whatsapp!;
    expect(w.match(/Ninguém aceitou o lead/g)).toHaveLength(1);
  });

  it("tipo que não é escalação mantém o rótulo e ganha o motivo", () => {
    const a = montarAlerta(
      "2_guardiao",
      pedido({ faixa: "vermelha", contexto: { motivo: "estado_comercial_mudou" } }),
    );
    expect(a.email!.assunto).toContain("Derrubar mídia paga");
    expect(a.whatsapp).toContain("Imóvel saiu de disponível");
  });
});

describe("o link leva ao card certo", () => {
  it("com id, aponta pra âncora do pedido no painel", () => {
    const a = montarAlerta(
      "2_guardiao",
      pedido({ faixa: "vermelha" }),
      "https://painel.exemplo.com/#pedido-abc-123",
    );
    expect(a.email!.corpo).toContain("https://painel.exemplo.com/#pedido-abc-123");
  });
});

describe("o WhatsApp continua sendo uma frase", () => {
  const a = montarAlerta(
    "2_guardiao",
    pedido({ faixa: "vermelha", contexto: { custoEmRisco: 4200, motivo: "venda_fechada" } }),
  );

  it("diz o tipo, o motivo e o dinheiro, e manda pro painel", () => {
    expect(a.whatsapp).toContain("Derrubar mídia paga");
    expect(a.whatsapp).toContain("venda fechada");
    expect(a.whatsapp).toContain("R$ 4200,00");
    expect(a.whatsapp).toContain("painel");
  });

  it("cabe em uma linha — se crescer, deixa de ser lido", () => {
    expect(a.whatsapp!.length).toBeLessThan(200);
    expect(a.whatsapp).not.toContain("\n");
  });

  it("custo zero não vira 'R$ 0,00 em risco'", () => {
    const b = montarAlerta("1_curador", pedido({ faixa: "vermelha", contexto: {} }));
    expect(b.whatsapp).not.toContain("R$");
  });
});

describe("urlDoPedido", () => {
  const ANTES = process.env.PAINEL_URL;
  afterEach(() => {
    if (ANTES === undefined) delete process.env.PAINEL_URL;
    else process.env.PAINEL_URL = ANTES;
  });

  it("monta a âncora do pedido", () => {
    process.env.PAINEL_URL = "https://painel.exemplo.com";
    expect(urlDoPedido("abc-123")).toBe("https://painel.exemplo.com/#pedido-abc-123");
  });

  it("barra sobrando no fim não vira barra dupla", () => {
    process.env.PAINEL_URL = "https://painel.exemplo.com/";
    expect(urlDoPedido("abc")).toBe("https://painel.exemplo.com/#pedido-abc");
  });

  it("sem endereço configurado, não inventa link", () => {
    delete process.env.PAINEL_URL;
    expect(urlDoPedido("abc")).toBeUndefined();
  });
});

describe("nada é dito duas vezes", () => {
  it("o motivo da escalação não repete título e corpo", () => {
    const a = montarAlerta(
      "4_atendimento",
      pedido({
        tipo: "escalacao_n3",
        entidade: "cliente",
        faixa: "amarela",
        contexto: { motivo: "conversa_fora_do_padrao", canal: "whatsapp" },
      }),
    );
    expect(a.email!.corpo.match(/Conversa fora do padrão/g)).toHaveLength(1);
  });

  it("mas em pedido que não é escalação o motivo continua no corpo", () => {
    const a = montarAlerta(
      "2_guardiao",
      pedido({ faixa: "vermelha", contexto: { motivo: "estado_comercial_mudou" } }),
    );
    expect(a.email!.corpo).toContain("Motivo: Imóvel saiu de disponível");
  });
});
