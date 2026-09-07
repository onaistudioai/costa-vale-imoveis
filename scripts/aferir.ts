import { ExtracaoLaudo, SISTEMA } from "../src/agentes/curador";
import { extratorGroq } from "../src/agentes/modelo";
import { comProcedencia, versaoDoPrompt } from "../src/agentes/procedencia";
import { registrarLeitura } from "../src/lib/leitura-db";
import { concordanciaDoPainel } from "../src/lib/afericao-db";
import { CASOS } from "../src/afericao/casos";
import { conferir, resumir, type Conferencia } from "../src/afericao/conferir";
import { pool } from "../src/lib/db";

/**
 * Roda o conjunto de referência contra o modelo de verdade.
 *
 * Custa chamadas de API de propósito: aferir extração com extrator falso é
 * aferir o extrator falso. As leituras entram em `leitura_modelo` como
 * qualquer outra — a aferição não é um caminho especial, é uso normal com
 * gabarito.
 */

const extrair = comProcedencia(
  extratorGroq("extracao"),
  { agente: "1_curador" },
  registrarLeitura,
);

const entradaDe = (l: (typeof CASOS)[number]["laudo"]) =>
  [
    l.textoEstado && `ESTADO DA CASA:\n${l.textoEstado}`,
    l.textoDocumentacao && `DOCUMENTAÇÃO:\n${l.textoDocumentacao}`,
    l.textoPendencias && `PENDÊNCIAS:\n${l.textoPendencias}`,
  ]
    .filter(Boolean)
    .join("\n\n");

// O mesmo prompt que roda em produção, e o hash prova isso no relatório.
console.log(`\nprompt ${versaoDoPrompt(SISTEMA)} · ${CASOS.length} casos\n`);

const resultados: Conferencia[] = [];

for (const caso of CASOS) {
  const e = (await extrair({
    schema: ExtracaoLaudo,
    sistema: SISTEMA,
    entrada: entradaDe(caso.laudo),
  })) as ExtracaoLaudo;

  const c = conferir(caso, e);
  resultados.push(c);

  const marca = c.estadoOk && c.precoOk ? "ok" : c.liberouIndevidamente ? "GRAVE" : "erro";
  console.log(
    `${marca.padEnd(6)}${c.id.padEnd(22)}${c.estadoObtido.padEnd(16)}(esperado ${c.estadoEsperado})`,
  );
  if (!c.estadoOk) console.log(`       ${c.porque}`);
  if (!c.precoOk) console.log(`       preço: leu ${c.precoObtido}, esperado ${c.precoEsperado}`);
}

const r = resumir(resultados);
console.log(`\nestado: ${r.estado}/${r.total}   preço: ${r.preco}/${r.total}`);
if (r.liberouIndevidamente.length)
  console.log(`LIBEROU INDEVIDAMENTE: ${r.liberouIndevidamente.join(", ")}`);
if (r.travouSemMotivo.length) console.log(`travou sem motivo: ${r.travouSemMotivo.join(", ")}`);

// O outro lado da aferição: o rótulo que a equipe já escreveu no painel.
const painel = await concordanciaDoPainel();
if (painel.length) {
  console.log("\nconcordância do painel (decisões humanas sobre leituras registradas)");
  for (const p of painel) {
    console.log(`  ${p.agente} ${p.promptHash} ${p.tipo}: ${p.aprovados}/${p.decididos} aprovados`);
  }
}

await pool.end();
