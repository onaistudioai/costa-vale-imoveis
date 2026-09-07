import { leiturasPorVersao } from "../src/lib/leitura-db";
import { pool } from "../src/lib/db";

/**
 * O que cada versão de prompt andou fazendo.
 *
 * Ainda não diz se acertou — acerto exige rótulo, e rótulo vem da correção
 * humana no painel (Onda 2). Diz quem rodou, quanto custou em tempo e quantas
 * falharam, que é o mínimo pra "melhorou" deixar de ser opinião.
 */
const linhas = await leiturasPorVersao();

if (linhas.length === 0) {
  console.log("\nNenhuma leitura registrada ainda.");
} else {
  console.log("\nagente          prompt        modelo                    n   falhas  mediana");
  for (const l of linhas) {
    console.log(
      [
        l.agente.padEnd(15),
        l.promptHash.padEnd(13),
        l.modelo.slice(0, 24).padEnd(25),
        String(l.chamadas).padStart(3),
        String(l.falhas).padStart(7),
        `${l.msMediano} ms`.padStart(9),
      ].join(""),
    );
  }
}

await pool.end();
