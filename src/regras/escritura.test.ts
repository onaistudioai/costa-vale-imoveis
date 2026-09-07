import { describe, expect, it } from "vitest";
import {
  ESTEIRA,
  avaliarProcesso,
  custoEstimado,
  faltando,
  progresso,
  proximaEtapa,
} from "./escritura";

const dias = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("a esteira", () => {
  it("registro vem DEPOIS da escritura — é ele que transfere o imóvel", () => {
    // O erro que quase todo comprador comete: achar que acabou ao sair do
    // cartório de notas. A ordem no código é a ordem legal.
    const ordem = ESTEIRA.map((e) => e.etapa);
    expect(ordem.indexOf("registro_concluido")).toBeGreaterThan(
      ordem.indexOf("escritura_lavrada"),
    );
    expect(proximaEtapa("escritura_lavrada")).toBe("registro_protocolado");
    expect(proximaEtapa("concluido")).toBeNull();
  });

  it("ITBI é pago antes da escritura, não depois", () => {
    const ordem = ESTEIRA.map((e) => e.etapa);
    expect(ordem.indexOf("itbi_pago")).toBeLessThan(ordem.indexOf("escritura_lavrada"));
  });

  it("sabe dizer onde o processo está, pro comprador se localizar", () => {
    expect(progresso("itbi_pago")).toMatchObject({ passo: 3, total: 7 });
  });

  it("lista o que ainda falta de documento", () => {
    const f = faltando("documentacao", ["Matrícula atualizada do imóvel"]);
    expect(f).not.toContain("matrícula atualizada do imóvel");
    expect(f.length).toBeGreaterThan(0);
  });
});

describe("prazo estourado — de quem é a bola", () => {
  it("etapa nossa vencida vira tarefa acionável", () => {
    const a = avaliarProcesso({
      etapa: "registro_protocolado",
      etapaDesde: dias(10),
      documentosEntregues: [],
    });
    expect(a?.acionavel).toBe(true);
    expect(a?.texto).toContain("essa etapa é nossa");
  });

  it("cartório atrasado NÃO vira tarefa vencida — vira ligação", () => {
    // A distinção que o user apontou: cartório é terceiro que não obedece
    // prazo interno. Cobrar prazo de quem não é nosso ensina a equipe a
    // ignorar a lista inteira.
    const a = avaliarProcesso({
      etapa: "registro_concluido",
      etapaDesde: dias(60),
      documentosEntregues: [],
    });
    expect(a?.acionavel).toBe(false);
    expect(a?.acao).toContain("Consultar o andamento");
    expect(a?.acao).not.toContain("Cobrar");
  });

  it("dentro do prazo típico não alerta nada", () => {
    expect(
      avaliarProcesso({
        etapa: "registro_concluido",
        etapaDesde: dias(20),
        documentosEntregues: [],
      }),
    ).toBeNull();
  });

  it("dobro do prazo vira crítico, mas continua não sendo nosso", () => {
    const a = avaliarProcesso({
      etapa: "itbi_emitido",
      etapaDesde: dias(25),
      documentosEntregues: [],
    });
    expect(a?.gravidade).toBe("critico");
    expect(a?.acionavel).toBe(false);
  });

  it("etapa do comprador vira cobrança dele, com a lista do que falta", () => {
    const a = avaliarProcesso({
      etapa: "documentacao",
      etapaDesde: dias(20),
      documentosEntregues: ["matrícula atualizada do imóvel"],
    });
    expect(a?.acionavel).toBe(false);
    expect(a?.acao).toContain("Cobrar o comprador");
    // Só o que ainda falta da etapa, e a matrícula já entregue não reaparece.
    expect(a?.acao).toContain("certid");
    expect(a?.acao).not.toContain("Matrícula atualizada do imóvel");
  });

  it("processo concluído ou cancelado nunca alerta", () => {
    expect(
      avaliarProcesso({ etapa: "concluido", etapaDesde: dias(500), documentosEntregues: [] }),
    ).toBeNull();
    expect(
      avaliarProcesso({ etapa: "cancelado", etapaDesde: dias(500), documentosEntregues: [] }),
    ).toBeNull();
  });
});

describe("custo da transferência", () => {
  it("estima ITBI e cartório pra dizer ao comprador antes, não depois", () => {
    const c = custoEstimado(846000);
    expect(c.itbi).toBe(16920); // 2%
    expect(c.total).toBe(33840); // ~4% do valor do imóvel
  });
});
