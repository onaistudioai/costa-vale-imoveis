import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * A conexão de escrita.
 *
 * `rejectUnauthorized: true` é o que separa "o tráfego vai cifrado" de "o
 * servidor do outro lado é mesmo o Neon". Sem isso, qualquer um no caminho
 * apresenta um certificado próprio e lê a conexão inteira — inclusive as
 * chaves de PII em uso naquele momento. O Neon usa CA pública, então o trust
 * store do Node basta: nenhum certificado precisa morar no repositório.
 *
 * A URL deve trazer `?sslmode=verify-full&channel_binding=require`.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  // Na Vercel a instância é reaproveitada entre requisições (Fluid Compute),
  // então o pool sobrevive — mas cada instância abre o seu. Poucas conexões
  // por instância é o que impede estourar o limite do Neon em pico.
  max: 3,
  idleTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });
export { schema };
