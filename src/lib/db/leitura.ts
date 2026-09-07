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
 * Sem `DATABASE_URL_LEITURA` ele cai na conexão comum e avisa. Funciona, mas
 * perde a garantia — por isso o aviso é barulhento.
 */

const url = process.env.DATABASE_URL_LEITURA;

if (!url && process.env.NODE_ENV !== "test") {
  console.warn(
    "[consulta] DATABASE_URL_LEITURA não definida: caindo na conexão com poder de escrita.",
  );
}

export const poolLeitura = new Pool({
  connectionString: url || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Relatório não é caminho quente: poucas conexões, e nenhuma parada de pé.
  max: 3,
  idleTimeoutMillis: 10_000,
});

export const dbLeitura = drizzle(poolLeitura, { schema });
