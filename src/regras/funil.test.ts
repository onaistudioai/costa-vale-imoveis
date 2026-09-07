import { describe, expect, it } from "vitest";
import { avaliar, fechar, podeAvancar, type Atendimento } from "./funil";

const dias = (n: number) => new Date(Date.now() - n * 86_400_000);
const agora = new Date();

const caso = (over: Partial<Atendimento> = {}): Atendimento => ({
  etapa: "primeiro_contato",
  etapaMaxima: "primeiro_contato",
  estado: "aberto",
  ultimaInteracao: agora,
  ultimoContatoPor: "nos",
  ...over,
});

describe("de quem é a bola", () => {
  it("cliente falou por último: é nossa, e é urgente", () => {
    const s = avaliar(caso({ ultimoContatoPor: "cliente" }), agora);
    expect(s.estado).toBe("aberto");
    // Cliente esperando resposta ganha de qualquer caso frio, sempre.
    expect(s.prioridade).toBeGreaterThan(100);
  });

  it("nós falamos por último e o prazo não estourou: é dele", () => {
    const s = avaliar(caso({ ultimaInteracao: dias(2) }), agora);
    expect(s.estado).toBe("pendente");
    expect(s.precisaDesfecho).toBe(false);
  });
});

describe("quem chegou mais longe vale mais", () => {
  it("dois casos parados o mesmo tempo, quem fez proposta sobe mais", () => {
    const raso = avaliar(caso({ ultimaInteracao: dias(3) }), agora);
    const fundo = avaliar(
      caso({ etapa: "proposta", etapaMaxima: "proposta", ultimaInteracao: dias(3) }),
      agora,
    );
    expect(fundo.prioridade).toBeGreaterThan(raso.prioridade);
  });

  it("quem chegou na proposta e voltou pra negociação mantém o peso alcançado", () => {
    // É o ponto do `etapaMaxima`: a etapa atual sozinha esqueceria que essa
    // pessoa já esteve a um passo de fechar.
    const s = avaliar(
      caso({ etapa: "negociacao", etapaMaxima: "proposta", ultimaInteracao: dias(1) }),
      agora,
    );
    const nunca = avaliar(
      caso({ etapa: "negociacao", etapaMaxima: "negociacao", ultimaInteracao: dias(1) }),
      agora,
    );
    expect(s.prioridade).toBeLessThan(nunca.prioridade);
  });

  it("o teto de silêncio é mais curto quanto mais fundo o caso está", () => {
    // Proposta parada há 6 dias já estourou (teto 5). Primeiro contato há 6
    // dias é normal (teto 30). O relógio anda em velocidades diferentes.
    expect(
      avaliar(caso({ etapa: "proposta", etapaMaxima: "proposta", ultimaInteracao: dias(6) }))
        .precisaDesfecho,
    ).toBe(true);
    expect(avaliar(caso({ ultimaInteracao: dias(6) })).precisaDesfecho).toBe(false);
  });
});

describe("o ponto final é de gente", () => {
  it("estourado volta pra aberto pedindo desfecho — não fecha sozinho", () => {
    const s = avaliar(caso({ ultimaInteracao: dias(40) }), agora);
    expect(s.estado).toBe("aberto");
    expect(s.precisaDesfecho).toBe(true);
    // O que NÃO acontece é o que importa: nada aqui devolve "fechado".
    // Fechar por silêncio seria transformar "não sei" em "não quis".
    expect(s.estado).not.toBe("fechado");
  });

  it("fechado exige motivo e sai da fila", () => {
    const s = avaliar(caso({ estado: "fechado", ultimaInteracao: dias(90) }), agora);
    expect(s.prioridade).toBe(0);
  });

  it("comprou conosco vira ganho; o resto vira perdido com motivo", () => {
    expect(fechar(caso(), "comprou_conosco").etapa).toBe("ganho");
    expect(fechar(caso(), "preco_acima_do_orcamento")).toMatchObject({
      etapa: "perdido",
      estado: "fechado",
      motivoDesfecho: "preco_acima_do_orcamento",
    });
  });
});

describe("a escada", () => {
  it("avança um degrau, volta quantos quiser, mas não pula", () => {
    expect(podeAvancar("qualificado", "visita_agendada")).toBe(true);
    expect(podeAvancar("proposta", "negociacao")).toBe(true);
    // Pular do primeiro contato pra proposta esconderia que a visita nunca
    // aconteceu — e o relatório de conversão passaria a mentir.
    expect(podeAvancar("primeiro_contato", "proposta")).toBe(false);
    expect(podeAvancar("proposta", "qualificado")).toBe(true);
    expect(podeAvancar("primeiro_contato", "perdido")).toBe(true);
  });
});
