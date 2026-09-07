import { randomUUID } from "node:crypto";
import { processarEvento } from "../src/grafo/runtime";
import { pool } from "../src/lib/db";

const idImovel = process.argv[2];
if (!idImovel) throw new Error("uso: npm run smoke -- <id_imovel>");

const r = await processarEvento({
  idEvento: randomUUID(),
  tipo: "laudo.criado",
  idImovel,
});

console.log(JSON.stringify(r, null, 2));
await pool.end();
