import { describe, expect, it } from "vitest";
import {
  compararIdentidade,
  nucleos,
  miolo,
  normalizar,
  perguntaDeConfirmacao,
  resolverIdentidade,
  LIMITE_SUGESTAO,
} from "./identidade";
import type { Identidade, SinaisContato } from "@/tipos";

/**
 * O que está sob teste não é "casar duas linhas". É a assimetria de custo:
 * duplicar é chato, fundir errado é vazamento. Todo caso aqui existe pra
 * garantir que o palpite nunca vire escrita sozinho.
 */

const ju = (over: Partial<SinaisContato> = {}): SinaisContato => ({
  canal: "whatsapp",
  identificador: "5515999990000",
  apelido: "Ju 💛",
  ...over,
});

const candidato = (
  over: Partial<SinaisContato & { idCliente: string; identidades: Identidade[] }> = {},
) => ({
  idCliente: "c1",
  canal: "instagram" as const,
  identificador: "ju.mendes.sp",
  nome: "Juliana Mendes",
  identidades: [{ canal: "instagram" as const, identificador: "ju.mendes.sp" }],
  ...over,
});

describe("normalização", () => {
  it("tira acento, caixa e arroba", () => {
    expect(normalizar("@José.Antônio")).toBe("jose.antonio");
  });

  it("reduz o handle ao miolo, ignorando pontuação e sufixo de estado", () => {
    expect(miolo("ju.mendes.sp")).toBe("jumendes");
    expect(miolo("ju_mendes")).toBe("jumendes");
    expect(miolo("@JuMendes2024")).toBe("jumendes");
  });
});

describe("o que conta como apelido", () => {
  it("nome composto identifica; primeiro nome sozinho não", () => {
    // Sem esta regra o sistema sugere fundir dois "Roberto" que nunca se
    // viram — o erro mais caro que ele pode cometer, porque mostra a
    // negociação de um pra outro.
    expect(nucleos({ apelido: "Ju Mendes" })).toContain("jumendes");
    expect(nucleos({ apelido: "Roberto" })).toEqual([]);
    expect(nucleos({ nome: "Ana" })).toEqual([]);
  });

  it("o identificador do canal sempre conta — é único na plataforma", () => {
    expect(nucleos({ identificador: "@ju.mendes.sp" })).toContain("jumendes");
  });
});

describe("certeza — casa sozinho", () => {
  it("mesmo CPF fecha a questão", () => {
    const p = compararIdentidade(
      ju({ cpf: "123.456.789-00" }),
      candidato({ cpf: "12345678900" }),
    );
    expect(p.confianca).toBe("certa");
  });

  it("identificador já visto no mesmo canal é a própria pessoa", () => {
    const p = compararIdentidade(
      ju({ canal: "instagram", identificador: "@Ju.Mendes.SP" }),
      candidato(),
    );
    expect(p.confianca).toBe("certa");
  });
});

describe("palpite — nunca casa sozinho", () => {
  it("o mesmo apelido em canais diferentes é o sinal que substitui o telefone", () => {
    // Ela chega no WhatsApp com o mesmo @ que usa no Instagram. Nenhum dos
    // dois carrega telefone comparável, e é exatamente esse o caso do user.
    const p = compararIdentidade(ju({ identificador: "jumendes" }), candidato());
    expect(p.confianca).toBe("provavel");
    expect(p.motivos.join(" ")).toContain("instagram");
  });

  it("nome igual sozinho não é indício suficiente", () => {
    // Três "Ana Silva" existem em qualquer base. Se isso bastasse, o sistema
    // fundiria estranhos.
    const p = compararIdentidade(
      ju({ identificador: "5511888887777", apelido: "Ana Silva" }),
      candidato({ nome: "Ana Silva", identificador: "outra.pessoa", identidades: [
        { canal: "instagram", identificador: "outra.pessoa" },
      ] }),
    );
    expect(p.pontos).toBeLessThan(LIMITE_SUGESTAO);
    expect(p.confianca).toBe("fraca");
  });

  it("mesmo imóvel na mesma semana também não basta sozinho", () => {
    // Dois interessados no mesmo anúncio é o normal de um anúncio bom.
    const p = compararIdentidade(
      ju({ identificador: "5511777776666", idImovelCitado: "im-1" }),
      candidato({
        identificador: "zzzz",
        identidades: [{ canal: "site", identificador: "zzzz" }],
        idImovelCitado: "im-1",
        ultimaAtividade: new Date(),
      }),
    );
    expect(p.confianca).toBe("fraca");
  });

  it("apelido igual + mesma busca já vale a pergunta", () => {
    const p = compararIdentidade(
      ju({
        identificador: "jumendes",
        busca: { tipo: "apartamento", bairros: ["Campolim"], min: 700000, max: 900000 },
      }),
      candidato({
        busca: { tipo: "apartamento", bairros: ["campolim"], min: 750000, max: 950000 },
      }),
    );
    expect(p.pontos).toBeGreaterThanOrEqual(LIMITE_SUGESTAO);
  });
});

describe("veredito", () => {
  it("sem candidato plausível, cria cliente novo — duplicar é reversível", () => {
    const v = resolverIdentidade(ju({ identificador: "5511000001111" }), [
      candidato({
        identificador: "nada.a.ver",
        nome: "Outra Pessoa",
        identidades: [{ canal: "instagram", identificador: "nada.a.ver" }],
      }),
    ]);
    expect(v.acao).toBe("criar_cliente");
  });

  it("palpite forte vira pedido de fusão, não escrita", () => {
    const v = resolverIdentidade(ju({ identificador: "jumendes" }), [candidato()]);
    expect(v.acao).toBe("sugerir_fusao");
  });

  it("dois candidatos igualmente prováveis vão os dois pro humano", () => {
    // Empate significa que os sinais não distinguem ninguém. Pegar o primeiro
    // da lista seria sorteio com cara de decisão.
    const v = resolverIdentidade(ju({ identificador: "jumendes" }), [
      candidato({ idCliente: "c1" }),
      candidato({ idCliente: "c2" }),
    ]);
    expect(v.acao).toBe("sugerir_fusao");
    if (v.acao === "sugerir_fusao") expect(v.concorrentes).toBe(2);
  });

  it("chave determinística vincula direto", () => {
    const v = resolverIdentidade(ju({ cpf: "11122233344" }), [
      candidato({ cpf: "111.222.333-44" }),
    ]);
    expect(v).toMatchObject({ acao: "vincular", idCliente: "c1" });
  });
});

describe("a pergunta que resolve o que o sinal não resolve", () => {
  it("usa só o primeiro nome e não entrega dado de ninguém", () => {
    const q = perguntaDeConfirmacao({ nome: "Juliana Mendes Ferreira" }, "instagram");
    expect(q).toContain("Juliana");
    // Sobrenome, imóvel, valor ou corretor na pergunta seria entregar o
    // cadastro de outra pessoa pra quem talvez nem seja ela.
    expect(q).not.toContain("Mendes");
    expect(q).not.toContain("Ferreira");
  });
});
