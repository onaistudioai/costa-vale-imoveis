import { consultar } from "../src/consulta";
import { extratorGroq } from "../src/agentes/modelo";
import { poolLeitura } from "../src/lib/db/leitura";

const pergunta = process.argv.slice(2).join(" ");
const r = await consultar(pergunta, extratorGroq("classificacao"));

console.log(`\n[${r.relatorio}] ${r.texto}`);
if (r.alerta) console.log(`ALERTA: ${r.alerta}`);
await poolLeitura.end();
