import { describe, expect, it } from "vitest";
import { pontuarCorretores, type EntradaRoteamento } from "./roteamento";
import type { ConfigRoteamento } from "@/tipos";

const AGORA = new Date("2026-09-06T12:00:00Z");
const emHoras = (h: number) => ({
  inicio: new Date(AGORA.getTime() + h * 3_600_000),
  fim: new Date(AGORA.getTime() + (h + 1) * 3_600_000),
});
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000);

const config: ConfigRoteamento = {
  janelaVinculoDias: 30,
  horizonteAgendaHoras: 48,
  scoreMinimo: 40,
  prazoAceiteMin: 5,
  maxOfertas: 3,
  pesos: {
    captou: 100,
    jaVisitou: 60,
    conheceRegiao: 25,
    disponibilidadeImediata: 40,
    cargaBaixa: 15,
  },
};

const base = (over: Partial<EntradaRoteamento> = {}): EntradaRoteamento => ({
  idCliente: "c1",
  idImovel: "i1",
  corretores: [
    { idCorretor: "ana", ativo: true },
    { idCorretor: "bruno", ativo: true },
  ],
  dominios: [],
  agendaLivre: { ana: [emHoras(2)], bruno: [emHoras(2)] },
  carga: { ana: 1, bruno: 1 },
  agora: AGORA,
  ...over,
});

describe("etapa 1 — vínculo com prazo", () => {
  it("vínculo dentro da janela leva o lead sem pontuar", () => {
    const r = pontuarCorretores(
      base({
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(10),
          ativo: true,
        },
        // ana tem domínio total e mesmo assim não leva
        dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
      }),
      config,
    );
    expect(r).toMatchObject({ decisao: "alocado", idCorretor: "bruno", via: "vinculo" });
  });

  it("exatamente na janela ainda é do corretor da carteira — fronteira inclusiva", () => {
    const r = pontuarCorretores(
      base({
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(30),
          ativo: true,
        },
      }),
      config,
    );
    expect(r).toMatchObject({ via: "vinculo", idCorretor: "bruno" });
  });

  it("um dia depois da janela o lead volta pra fila", () => {
    const r = pontuarCorretores(
      base({
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(31),
          ativo: true,
        },
        dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
      }),
      config,
    );
    expect(r).toMatchObject({ via: "pontuacao", idCorretor: "ana" });
  });

  it("corretor da carteira inativo não trava o lead", () => {
    const r = pontuarCorretores(
      base({
        corretores: [
          { idCorretor: "ana", ativo: true },
          { idCorretor: "bruno", ativo: false },
        ],
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(1),
          ativo: true,
        },
        dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
      }),
      config,
    );
    expect(r).toMatchObject({ idCorretor: "ana", via: "pontuacao" });
  });

  it("corretor da carteira sem agenda cai pra pontuação em vez de escalar", () => {
    const r = pontuarCorretores(
      base({
        agendaLivre: { ana: [emHoras(5)], bruno: [] },
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(2),
          ativo: true,
        },
        dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
      }),
      config,
    );
    expect(r).toMatchObject({ idCorretor: "ana", via: "pontuacao" });
  });
});

describe("etapa 2 — pontuação", () => {
  it("domínio pesa mais que disponibilidade imediata", () => {
    const r = pontuarCorretores(
      base({
        // bruno está livre já, ana só daqui a 40h — ana ganha mesmo assim
        agendaLivre: { ana: [emHoras(40)], bruno: [emHoras(0)] },
        dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }],
      }),
      config,
    );
    expect(r).toMatchObject({ idCorretor: "ana" });
  });

  it("domínio de outro imóvel não conta", () => {
    const r = pontuarCorretores(
      base({
        dominios: [{ idCorretor: "ana", idImovel: "OUTRO", nivel: "captou" }],
        carga: { ana: 5, bruno: 1 },
      }),
      config,
    );
    expect(r).toMatchObject({ idCorretor: "bruno" });
  });

  it("empate técnico resolve por id — a função é determinística", () => {
    const a = pontuarCorretores(base(), config);
    const b = pontuarCorretores(base(), config);
    expect(a).toEqual(b);
  });
});

describe("envelope — os três casos que escalam (seção 10)", () => {
  it("caso 1: ninguém acima do mínimo, com dominio_corretor vazia", () => {
    const r = pontuarCorretores(
      base({
        // sem domínio e sem agenda próxima, o score não alcança 40
        agendaLivre: { ana: [emHoras(47)], bruno: [emHoras(47)] },
        dominios: [],
      }),
      config,
    );
    expect(r).toEqual({
      decisao: "escalar",
      motivo: "nenhum_corretor_acima_do_minimo",
    });
  });

  it("caso 2: ninguém com slot no horizonte", () => {
    const r = pontuarCorretores(
      base({ agendaLivre: { ana: [], bruno: [] } }),
      config,
    );
    expect(r).toEqual({ decisao: "escalar", motivo: "sem_slot_no_horizonte" });
  });

  it("caso 3: estado comercial mudou entre qualificação e roteamento", () => {
    const r = pontuarCorretores(
      base({ dominios: [{ idCorretor: "ana", idImovel: "i1", nivel: "captou" }] }),
      config,
      true,
    );
    expect(r).toEqual({ decisao: "escalar", motivo: "estado_comercial_mudou" });
  });

  it("caso 3 tem precedência: nem tenta alocar", () => {
    const r = pontuarCorretores(
      base({
        vinculo: {
          idCliente: "c1",
          idCorretor: "bruno",
          ultimaInteracao: diasAtras(1),
          ativo: true,
        },
      }),
      config,
      true,
    );
    expect(r).toMatchObject({ decisao: "escalar" });
  });
});
