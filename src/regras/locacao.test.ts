import { describe, expect, it } from "vitest";
import {
  avisosDeVigencia,
  calcularEncargos,
  calcularRepasse,
  gerarParcela,
  proximoReajuste,
  reajusteDevido,
  reguaCobranca,
  vencimentoDe,
  type Contrato,
} from "./locacao";

const contrato = (over: Partial<Contrato> = {}): Contrato => ({
  idContrato: "ct-1",
  valorAluguel: 2500,
  valorCondominio: 450,
  valorIptu: 120,
  diaVencimento: 10,
  inicio: new Date(2025, 0, 15),
  fim: new Date(2027, 0, 14),
  ultimoReajuste: null,
  taxaAdministracao: 10,
  multaAtraso: 2,
  jurosMes: 1,
  ...over,
});

describe("o calendário do aluguel", () => {
  it("vencimento dia 31 em mês de 30 cai no último dia, não vira mês seguinte", () => {
    // O erro clássico: `new Date(2026, 3, 31)` vira 1º de maio em silêncio, e
    // o inquilino recebe cobrança de um vencimento que o contrato não tem.
    const v = vencimentoDe(contrato({ diaVencimento: 31 }), 2026, 3);
    expect(v.getMonth()).toBe(3);
    expect(v.getDate()).toBe(30);
  });

  it("soma aluguel, condomínio e IPTU numa parcela só", () => {
    const p = gerarParcela(contrato(), 2026, 8);
    expect(p?.valorBase).toBe(3070);
    expect(p?.competencia).toBe("2026-09");
  });

  it("não gera parcela fora da vigência", () => {
    // Cobrar contrato encerrado é o tipo de erro que só aparece na reclamação.
    expect(gerarParcela(contrato(), 2028, 0)).toBeNull();
    expect(gerarParcela(contrato(), 2024, 0)).toBeNull();
  });
});

describe("atraso", () => {
  const parcela = {
    competencia: "2026-09",
    vencimento: new Date(2026, 8, 10),
    valorBase: 3070,
    estagioCobranca: 0,
  };

  it("em dia não cobra nada", () => {
    const e = calcularEncargos(contrato(), parcela, new Date(2026, 8, 10));
    expect(e.total).toBe(3070);
    expect(e.multa).toBe(0);
  });

  it("multa é fixa, juros são proporcionais aos dias", () => {
    const e = calcularEncargos(contrato(), parcela, new Date(2026, 8, 25));
    expect(e.dias).toBe(15);
    expect(e.multa).toBe(61.4); // 2% de 3070
    expect(e.juros).toBe(15.35); // 1% ao mês, metade do mês
    expect(e.total).toBe(3146.75);
  });
});

describe("a régua de cobrança", () => {
  const parcela = (estagio = 0) => ({
    competencia: "2026-09",
    vencimento: new Date(2026, 8, 10),
    valorBase: 3070,
    estagioCobranca: estagio,
  });

  it("avisa 3 dias ANTES — a maior parte do atraso é esquecimento", () => {
    const p = reguaCobranca(parcela(), new Date(2026, 8, 7));
    expect(p?.tom).toBe("lembrete");
  });

  it("não repete o passo que já foi dado", () => {
    // A varredura bate de minuto em minuto. Sem isto, o inquilino receberia a
    // mesma cobrança 1440 vezes por dia e silenciaria o número.
    expect(reguaCobranca(parcela(2), new Date(2026, 8, 10))).toBeNull();
  });

  it("30 dias vira escalação, não mensagem automática", () => {
    const p = reguaCobranca(parcela(5), new Date(2026, 9, 12));
    expect(p?.tom).toBe("escalacao");
  });
});

describe("repasse ao proprietário", () => {
  it("a taxa incide só sobre o aluguel, não sobre condomínio e IPTU", () => {
    // Cobrar administração sobre IPTU é a reclamação clássica de proprietário
    // — e ele confere.
    const r = calcularRepasse(contrato(), 3070);
    expect(r.taxa).toBe(250); // 10% de 2500, não de 3070
    expect(r.aoProprietario).toBe(2820);
  });
});

describe("reajuste", () => {
  it("o aniversário conta do último reajuste, ou do início se nunca houve", () => {
    expect(proximoReajuste(contrato()).getFullYear()).toBe(2026);
    expect(
      proximoReajuste(contrato({ ultimoReajuste: new Date(2026, 0, 15) })).getFullYear(),
    ).toBe(2027);
  });

  it("sem o índice, calcula que é devido mas NÃO inventa o valor novo", () => {
    // Quanto foi o IGPM do ano não está no banco nem no modelo. Chutar esse
    // número seria a pior mentira que este sistema poderia contar.
    const r = reajusteDevido(contrato(), null, new Date(2026, 1, 1));
    expect(r.devido).toBe(true);
    expect(r.valorNovo).toBeNull();
  });

  it("com o índice na mão, calcula o valor novo", () => {
    const r = reajusteDevido(contrato(), 7.2, new Date(2026, 1, 1));
    expect(r.valorNovo).toBe(2680);
  });

  it("não reajusta contrato que acaba antes do aniversário", () => {
    const r = reajusteDevido(
      contrato({ fim: new Date(2025, 11, 31) }),
      7.2,
      new Date(2026, 1, 1),
    );
    expect(r.devido).toBe(false);
  });
});

describe("fim de vigência", () => {
  it("avisa aos 90 dias — ainda dá pra renovar sem mês vago", () => {
    const a = avisosDeVigencia(contrato(), new Date(2026, 9, 20));
    expect(a?.marco).toBe(90);
  });

  it("não avisa quando ainda falta muito", () => {
    expect(avisosDeVigencia(contrato(), new Date(2025, 5, 1))).toBeNull();
  });

  it("contrato vencido não passa despercebido", () => {
    expect(avisosDeVigencia(contrato(), new Date(2027, 5, 1))?.texto).toContain("vencido");
  });
});
