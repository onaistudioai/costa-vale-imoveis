import { describe, expect, it } from "vitest";
import type { ExtracaoLaudo } from "@/agentes/curador";
import { CASOS, type Caso } from "./casos";
import { conferir, resumir } from "./conferir";

const extracao = (over: Partial<ExtracaoLaudo> = {}): ExtracaoLaudo => ({
  pendencias: [],
  precoMencionado: null,
  confianca: "alta",
  resumo: "",
  ...over,
});

const caso = (over: Partial<Caso> = {}): Caso => ({
  id: "x",
  porque: "",
  laudo: { textoEstado: "" },
  esperado: { estado: "pronto", preco: null },
  ...over,
});

const pendencia = (over = {}) => ({
  descricao: "entulho",
  categoria: "outro" as const,
  resolvida: false,
  obrigatoria: true,
  ...over,
});

describe("conferir", () => {
  it("mede a decisão, não a redação: resumo diferente com mesmo estado é acerto", () => {
    const a = conferir(caso(), extracao({ resumo: "casa pronta" }));
    const b = conferir(caso(), extracao({ resumo: "imóvel sem pendências, liberado" }));
    expect(a.estadoOk && b.estadoOk).toBe(true);
  });

  it("separa liberar indevidamente de travar sem motivo", () => {
    const liberou = conferir(
      caso({ esperado: { estado: "com_pendencia", preco: null } }),
      extracao(),
    );
    expect(liberou).toMatchObject({ liberouIndevidamente: true, travouSemMotivo: false });

    const travou = conferir(
      caso({ esperado: { estado: "pronto", preco: null } }),
      extracao({ pendencias: [pendencia()] }),
    );
    expect(travou).toMatchObject({ liberouIndevidamente: false, travouSemMotivo: true });
  });

  // O par modelo + regra é o que existe em produção: uma extração pode estar
  // "errada" no papel e ainda produzir a decisão certa, e é a decisão que
  // chega no cliente.
  it("confiança baixa conta como travar, porque a regra segura", () => {
    const c = conferir(
      caso({ esperado: { estado: "pronto", preco: null } }),
      extracao({ confianca: "baixa" }),
    );
    expect(c.estadoObtido).toBe("com_pendencia");
    expect(c.travouSemMotivo).toBe(true);
  });

  it("preço inventado é erro mesmo com o estado certo", () => {
    const c = conferir(caso(), extracao({ precoMencionado: 620000 }));
    expect(c.estadoOk).toBe(true);
    expect(c.precoOk).toBe(false);
  });
});

describe("resumir", () => {
  it("não devolve nota geral — os dois tipos de erro vêm separados", () => {
    const r = resumir([
      conferir(caso({ id: "a", esperado: { estado: "com_pendencia", preco: null } }), extracao()),
      conferir(
        caso({ id: "b" }),
        extracao({ pendencias: [pendencia()] }),
      ),
      conferir(caso({ id: "c" }), extracao()),
    ]);

    expect(r).toMatchObject({
      total: 3,
      estado: 1,
      liberouIndevidamente: ["a"],
      travouSemMotivo: ["b"],
    });
    expect(r).not.toHaveProperty("nota");
  });
});

describe("os casos de referência", () => {
  it("têm id único — o relatório é por id", () => {
    expect(new Set(CASOS.map((c) => c.id)).size).toBe(CASOS.length);
  });

  it("cobrem os dois lados: casos que liberam e casos que travam", () => {
    const libera = CASOS.filter((c) => c.esperado.estado === "pronto");
    expect(libera.length).toBeGreaterThan(0);
    expect(CASOS.length - libera.length).toBeGreaterThan(0);
  });

  it("todo caso diz o que testa, porque é isso que aparece quando ele falha", () => {
    expect(CASOS.every((c) => c.porque.length > 10)).toBe(true);
  });
});
