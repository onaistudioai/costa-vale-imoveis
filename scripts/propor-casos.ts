import { negadasRecentes } from "../src/lib/afericao-db";
import { CASOS } from "../src/afericao/casos";
import { propor } from "../src/afericao/proposta";
import { pool } from "../src/lib/db";

/**
 * Imprime rascunhos de caso a partir das leituras do Curador negadas no
 * painel. Não escreve em `casos.ts`: o estado esperado é palpite até alguém
 * conferir e colar.
 */
const limite = Number(process.argv[2] ?? 50);
const todas = await negadasRecentes(limite);
const negadas = todas.filter((n) => n.agente === "1_curador");

const propostas = negadas.map((n) => propor(n, CASOS)).filter((c) => c !== null);
const outras = todas.length - negadas.length;

if (propostas.length === 0) {
  console.log("\nNenhuma leitura do Curador negada que já não esteja nos casos.");
} else {
  console.log(`\n// ${propostas.length} rascunho(s) — confira o estado e cole em src/afericao/casos.ts\n`);
  for (const c of propostas) console.log(`  ${JSON.stringify(c, null, 2).replace(/\n/g, "\n  ")},`);
}
if (outras > 0) console.log(`\n(${outras} negada(s) de outros agentes ficaram de fora: não têm formato de caso ainda)`);

await pool.end();
