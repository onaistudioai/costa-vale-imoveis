import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O guarda contra o vazamento mais fácil de cometer.
 *
 * Tudo que se chama `NEXT_PUBLIC_*` no Next entra no bundle que vai pro
 * navegador. Hoje o projeto não tem nenhuma — e é justamente por isso que este
 * teste existe: o dia em que alguém escrever `NEXT_PUBLIC_DATABASE_URL` pra
 * resolver um problema de import, a suíte precisa dizer não antes do deploy.
 */

const PERIGOSO = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD|SENHA|DATABASE|_URL)/;

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next" || nome === ".git") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

describe("variáveis de ambiente", () => {
  it("nenhuma NEXT_PUBLIC_ com cara de segredo no código", () => {
    const raiz = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const culpados: string[] = [];

    for (const f of [...arquivos(join(raiz, "src")), ...arquivos(join(raiz, "app"))]) {
      // Este próprio arquivo contém o padrão, por definição.
      if (f.endsWith("ambiente.test.ts")) continue;
      const linha = readFileSync(f, "utf8").split("\n").find((l) => PERIGOSO.test(l));
      if (linha) culpados.push(`${f}: ${linha.trim()}`);
    }

    expect(culpados).toEqual([]);
  });

  it("nem no .env.example, que é o que as pessoas copiam", () => {
    const raiz = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const exemplo = readFileSync(join(raiz, ".env.example"), "utf8");
    expect(exemplo).not.toMatch(PERIGOSO);
  });
});
