import { consultar } from "../src/consulta";
import { extratorGroq } from "../src/agentes/modelo";
import { comProcedencia } from "../src/agentes/procedencia";
import { registrarLeitura } from "../src/lib/leitura-db";
import { poolLeitura } from "../src/lib/db/leitura";
import { pool } from "../src/lib/db";

const pergunta = process.argv.slice(2).join(" ");
// A pergunta continua sendo respondida pela conexão que só tem SELECT. Quem
// grava a procedência é outra conexão e outra tabela — auditoria não é
// consulta, e nenhuma linha daqui toca dado da empresa.
const r = await consultar(
  pergunta,
  comProcedencia(extratorGroq("classificacao"), { agente: "5_consulta" }, registrarLeitura),
);

console.log(`\n[${r.relatorio}] ${r.texto}`);
if (r.alerta) console.log(`ALERTA: ${r.alerta}`);
await poolLeitura.end();
await pool.end();
