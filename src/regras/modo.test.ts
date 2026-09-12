import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODO, ROTULO_MODO, declaracaoDe, semRevisao } from "./modo";
import { CAMPOS_EDITAVEIS } from "./alteracao";

/**
 * Os campos que o código realmente escreve em `log_evento`, lidos do fonte.
 *
 * Varrer o fonte em vez de manter uma segunda lista é o que faz este teste
 * valer alguma coisa: uma lista escrita à mão envelhece junto com a que ela
 * deveria vigiar.
 */
function camposEscritosNoCodigo(): string[] {
  const achados = new Set<string>();

  const varrer = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        if (nome === "node_modules" || nome === ".next") continue;
        varrer(caminho);
        continue;
      }
      // Teste inventa campo pra exercitar caminho de erro; não é decisão de
      // autonomia e não precisa de modo declarado.
      if (!/\.tsx?$/.test(nome) || /\.test\.tsx?$/.test(nome)) continue;

      const fonte = readFileSync(caminho, "utf8");
      for (const m of fonte.matchAll(/campo:\s*"([^"]+)"/g)) achados.add(m[1]!);
      // Campo montado em template (`expirou.${tipo}`): vale a parte fixa, com
      // um tipo qualquer no lugar — é o que `declaracaoDe` precisa resolver.
      for (const m of fonte.matchAll(/campo:\s*`([^`$]*)\$\{/g)) {
        // Sem parte fixa (`${entidade}.${campo}`) não há o que resolver pelo
        // nome: esse caso é o da alteração, coberto pelo teste abaixo.
        if (m[1]) achados.add(`${m[1]}qualquer`);
      }
    }
  };

  varrer(join(process.cwd(), "src"));
  varrer(join(process.cwd(), "app"));
  return [...achados].sort();
}

describe("nenhuma autonomia por omissão", () => {
  // O teste que dá sentido ao arquivo: campo novo sem modo declarado quebra a
  // suíte. É o que transforma "ninguém decidiu" em "alguém precisa decidir".
  it("todo campo escrito no código tem modo declarado", () => {
    const semDeclaracao = camposEscritosNoCodigo().filter((c) => !declaracaoDe(c));

    expect(
      semDeclaracao,
      `Campo escrito em log_evento sem modo declarado em src/regras/modo.ts.\n` +
        `Decida: o sistema PARA e espera (hitl), AGE e alguém confere (hotl),\n` +
        `ou AGE e ninguém revisa (hootl) — e escreva o porquê.\n` +
        `Faltando: ${semDeclaracao.join(", ")}`,
    ).toEqual([]);
  });

  it("a varredura acha os campos de verdade — senão o teste acima passa à toa", () => {
    const campos = camposEscritosNoCodigo();
    expect(campos).toContain("imovel.estadoComercial");
    expect(campos).toContain("atendimento.reabertura");
    expect(campos).toContain("expirou.qualquer");
    expect(campos.length).toBeGreaterThan(10);
  });

  it("todo campo que a alteração grava tem modo, e é hitl", () => {
    for (const [c, d] of Object.entries(CAMPOS_EDITAVEIS)) {
      expect(declaracaoDe(`${d.entidade}.${c}`)?.modo, `${d.entidade}.${c}`).toBeDefined();
    }
    expect(declaracaoDe("cliente.telefone")!.modo).toBe("hitl");
  });

  it("nenhuma declaração fica sem motivo escrito", () => {
    for (const [campo, d] of Object.entries(MODO)) {
      expect(d.porque.length, `${campo} declarado sem explicar por quê`).toBeGreaterThan(30);
    }
  });

  it("todo modo declarado é um dos três", () => {
    for (const [campo, d] of Object.entries(MODO)) {
      expect(Object.keys(ROTULO_MODO), `${campo} tem modo inválido`).toContain(d.modo);
    }
  });
});

describe("o que roda sem ninguém", () => {
  it("reconhecer por chave determinística é hootl, e de propósito", () => {
    expect(semRevisao("identidade.reconhecida")).toBe(true);
    expect(declaracaoDe("identidade.reconhecida")!.porque).toContain("CPF");
  });

  it("fundir cadastro nunca é hootl — mistura negociação de dois clientes", () => {
    expect(MODO["cliente.fusao"]!.modo).toBe("hitl");
  });

  it("subir anúncio nunca é automático — podePublicar exige aprovação", () => {
    expect(MODO["imovel.estadoAnuncio"]!.modo).toBe("hitl");
  });

  it("o corte do estado comercial é hotl, e a razão está escrita", () => {
    const d = MODO["imovel.estadoComercial"]!;
    expect(d.modo).toBe("hotl");
    expect(d.porque).toContain("ANTES");
  });

  it("campo desconhecido não é tratado como sem revisão por acidente", () => {
    expect(semRevisao("campo.que.nao.existe")).toBe(false);
    expect(declaracaoDe("campo.que.nao.existe")).toBeUndefined();
  });
});
