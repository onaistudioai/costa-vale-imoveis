import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Conexão somente-leitura, usada só pelo agente de consulta.
 *
 * O papel `consulta` no Postgres tem `SELECT` e nada mais — nem `CREATE` no
 * schema. É a diferença entre "prometemos que o relatório não escreve" e "o
 * banco recusa se ele tentar": um agente que responde pergunta de gente é o
 * mais exposto a texto vindo de fora, e é o que menos precisa de caneta.
 *
 * Sem `DATABASE_URL_LEITURA`, **não sobe**. Antes ele caía na conexão com
 * poder de escrita e deixava um `console.warn` — que é a forma de uma garantia
 * desaparecer sem ninguém notar: o agente continuava respondendo, agora com
 * caneta na mão. Uma promessa que só vale quando a variável está certa precisa
 * falhar alto quando não está.
 */

const url = process.env.DATABASE_URL_LEITURA;

if (!url && process.env.NODE_ENV !== "test") {
  throw new Error(
    "DATABASE_URL_LEITURA não definida. O agente de consulta não roda com conexão de escrita.",
  );
}

export const poolLeitura = new Pool({
  connectionString: url || process.env.DATABASE_URL,
  // Mesmo motivo do pool de escrita: cifrar sem autenticar o servidor não
  // protege de quem está no caminho.
  ssl: { rejectUnauthorized: true },
  // Relatório não é caminho quente: poucas conexões, e nenhuma parada de pé.
  max: 3,
  idleTimeoutMillis: 10_000,
});

export const dbLeitura = drizzle(poolLeitura, { schema });
