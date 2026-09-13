import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Consolidado } from "./index";

/**
 * Zod (aqui) e Pydantic (servicos/mesa) descrevem a mesma resposta. Duas
 * linguagens, dois schemas — o risco é um lado mudar e o outro não, e o erro só
 * aparecer em runtime como "revisão falhou, seguindo sem proposta", que é
 * silencioso por desenho.
 *
 * Os dois geradores escrevem JSON Schema com estilos diferentes (Pydantic usa
 * `$ref`, `title`, `anyOf` para nulo), então a comparação é pelo que importa:
 * nome do campo, tipo, valores aceitos, se aceita nulo, se é obrigatório.
 */

type Schema = Record<string, unknown>;
type Campo = { tipo: string; valores?: string[]; nulo: boolean; obrigatorio: boolean };

function resolver(s: Schema, raiz: Schema): Schema {
  const ref = s.$ref as string | undefined;
  if (!ref) return s;
  const nome = ref.split("/").pop()!;
  return ((raiz.$defs ?? raiz.definitions) as Record<string, Schema>)[nome]!;
}

function normalizar(raiz: Schema): Record<string, Campo> {
  const obrigatorios = new Set((raiz.required as string[]) ?? []);
  const saida: Record<string, Campo> = {};
  for (const [nome, bruto] of Object.entries(raiz.properties as Record<string, Schema>)) {
    let variantes = ((bruto.anyOf ?? bruto.oneOf) as Schema[] | undefined) ?? [bruto];
    // Nulo tem duas grafias: Pydantic usa `anyOf: [{type: string}, {type: null}]`,
    // Zod usa `type: ["string", "null"]`. As duas viram a mesma lista aqui.
    variantes = variantes
      .map((v) => resolver(v, raiz))
      .flatMap((v) => (Array.isArray(v.type) ? v.type.map((t) => ({ ...v, type: t })) : [v]));
    const nulo = variantes.some((v) => v.type === "null");
    const principal = variantes.find((v) => v.type !== "null")!;
    saida[nome] = {
      tipo: String(principal.type),
      ...(principal.enum ? { valores: [...(principal.enum as string[])].sort() } : {}),
      nulo,
      obrigatorio: obrigatorios.has(nome),
    };
  }
  return saida;
}

describe("contrato da mesa: Zod × Pydantic", () => {
  it("os dois lados descrevem a mesma resposta", () => {
    const pydantic = JSON.parse(
      readFileSync(join(process.cwd(), "servicos/mesa/contrato.json"), "utf8"),
    ) as Schema;
    const zod = z.toJSONSchema(Consolidado) as Schema;

    expect(
      normalizar(zod),
      "Zod e Pydantic divergiram. Mudou src/mesa/index.ts ou servicos/mesa/mesa/modelos.py? " +
        "Mude os dois e rode `uv run python gerar_contrato.py` em servicos/mesa.",
    ).toEqual(normalizar(pydantic));
  });

  it("a normalização enxerga diferença de verdade — senão o teste acima passa à toa", () => {
    const zod = normalizar(z.toJSONSchema(Consolidado) as Schema);
    const mexido = normalizar(
      z.toJSONSchema(Consolidado.extend({ ressalva: z.string() })) as Schema,
    );
    expect(mexido).not.toEqual(zod);
    expect(zod.recomendacao!.valores).toEqual(["aprovar", "negar", "precisa_humano"]);
  });
});
