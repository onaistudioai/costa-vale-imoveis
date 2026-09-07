import { describe, expect, it } from "vitest";
import { dentroDoExpediente, gradeDeHorarios, proximaAbertura } from "./expediente";

/**
 * O conserto das 3h da manhã.
 *
 * O sistema atende 24h; a equipe não existe 24h. Sem esta distinção, um lead
 * de madrugada oferece pro melhor corretor às 3h00, expira às 3h05, oferece pro
 * segundo, expira, oferece pro terceiro — e às 3h15 o lead está numa fila que
 * ninguém vai abrir antes das 8h, com três corretores marcados como quem não
 * respondeu.
 */

// 2026-09-06 é um domingo. 07 segunda, 12 sábado.
const em = (dia: number, hora: number, min = 0) =>
  new Date(2026, 8, dia, hora, min, 0, 0);

describe("expediente — quando existe alguém pra responder", () => {
  it("7h29 de segunda ainda é cedo; 7h30 já vale", () => {
    expect(dentroDoExpediente(em(7, 7, 29))).toBe(false);
    expect(dentroDoExpediente(em(7, 7, 30))).toBe(true);
  });

  it("18h59 ainda vale; 19h em ponto acabou", () => {
    expect(dentroDoExpediente(em(7, 18, 59))).toBe(true);
    expect(dentroDoExpediente(em(7, 19, 0))).toBe(false);
  });

  it("sábado trabalha, domingo não", () => {
    expect(dentroDoExpediente(em(12, 10))).toBe(true);
    expect(dentroDoExpediente(em(6, 10))).toBe(false);
  });
});

describe("proximaAbertura — o relógio do prazo só começa aí", () => {
  it("dentro do expediente devolve o próprio instante", () => {
    const agora = em(7, 14, 12);
    expect(proximaAbertura(agora)).toEqual(agora);
  });

  it("3h da manhã de segunda espera as 7h30 do MESMO dia", () => {
    expect(proximaAbertura(em(7, 3))).toEqual(em(7, 7, 30));
  });

  it("22h de segunda cai pra terça de manhã", () => {
    expect(proximaAbertura(em(7, 22))).toEqual(em(8, 7, 30));
  });

  it("o caso que motivou tudo: 22h de domingo abre 7h30 de segunda", () => {
    expect(proximaAbertura(em(6, 22))).toEqual(em(7, 7, 30));
  });

  it("sábado à noite pula o domingo inteiro e abre na segunda", () => {
    expect(proximaAbertura(em(12, 20))).toEqual(em(14, 7, 30));
  });
});

describe("gradeDeHorarios — onde a visita pode ser marcada", () => {
  it("começa 7h30 e o último horário termina às 19h em ponto", () => {
    const grade = gradeDeHorarios(em(7, 0), em(8, 0));
    expect(grade[0]!.inicio).toEqual(em(7, 7, 30));
    expect(grade.at(-1)!.fim).toEqual(em(7, 19, 0));
  });

  it("não oferece horário no passado", () => {
    const grade = gradeDeHorarios(em(7, 15, 10), em(8, 0));
    expect(grade[0]!.inicio).toEqual(em(7, 15, 30));
  });

  it("pula domingo", () => {
    const grade = gradeDeHorarios(em(12, 16), em(14, 12));
    const dias = [...new Set(grade.map((h) => h.inicio.getDate()))];
    expect(dias).toEqual([12, 14]);
  });

  it("sábado depois das 18h já não cabe visita de uma hora", () => {
    // 18h30 + 1h estoura o fim do expediente. O horário some em vez de vazar.
    expect(gradeDeHorarios(em(12, 18), em(12, 23))).toHaveLength(0);
  });
});
