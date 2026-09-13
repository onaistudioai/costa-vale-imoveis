import { negadasRecentes } from "../src/lib/afericao-db";
import { CASOS } from "../src/afericao/casos";
import { CASOS_NEGOCIACAO } from "../src/afericao/negociacao";
import { CASOS_ALTERACAO } from "../src/afericao/alteracao";
import { propor, proporAlteracao, proporNegociacao } from "../src/afericao/proposta";
import { pool } from "../src/lib/db";

/**
 * Imprime rascunhos de caso a partir das leituras negadas no painel. Não
 * escreve em arquivo nenhum: o esperado é palpite até alguém conferir e colar.
 */
const limite = Number(process.argv[2] ?? 50);
const todas = await negadasRecentes(limite);

const grupos = [
  { agente: "1_curador", arquivo: "casos.ts", fazer: (n: (typeof todas)[number]) => propor(n, CASOS) },
  { agente: "2_guardiao", arquivo: "negociacao.ts", fazer: (n: (typeof todas)[number]) => proporNegociacao(n, CASOS_NEGOCIACAO) },
  { agente: "6_alterador", arquivo: "alteracao.ts", fazer: (n: (typeof todas)[number]) => proporAlteracao(n, CASOS_ALTERACAO) },
];

let cobertas = 0;
for (const g of grupos) {
  const negadas = todas.filter((n) => n.agente === g.agente);
  cobertas += negadas.length;
  const propostas = negadas.map(g.fazer).filter((c) => c !== null);
  if (propostas.length === 0) continue;
  console.log(`\n// ${g.agente}: ${propostas.length} rascunho(s) — confira e cole em src/afericao/${g.arquivo}\n`);
  for (const c of propostas) console.log(`  ${JSON.stringify(c, null, 2).replace(/\n/g, "\n  ")},`);
}

if (cobertas === 0) console.log("\nNenhuma leitura negada de Curador, Guardião ou Alterador.");
if (todas.length > cobertas)
  console.log(`\n(${todas.length - cobertas} negada(s) de outros agentes ficaram de fora)`);

await pool.end();
