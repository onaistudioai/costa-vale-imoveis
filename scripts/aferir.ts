import { ExtracaoLaudo, SISTEMA } from "../src/agentes/curador";
import { ExtracaoConversa, SISTEMA as SISTEMA_CONVERSA } from "../src/agentes/atendimento";
import { extratorGroq } from "../src/agentes/modelo";
import { comProcedencia, versaoDoPrompt } from "../src/agentes/procedencia";
import { registrarLeitura } from "../src/lib/leitura-db";
import { concordanciaDoPainel } from "../src/lib/afericao-db";
import { CASOS } from "../src/afericao/casos";
import { conferir, resumir, type Conferencia } from "../src/afericao/conferir";
import {
  CASOS_CONVERSA,
  conferirConversa,
  resumirConversa,
  type ConferenciaConversa,
} from "../src/afericao/conversa";
import { pool } from "../src/lib/db";

/**
 * Roda os conjuntos de referência contra o modelo de verdade.
 *
 * Custa chamadas de API de propósito: aferir extração com extrator falso é
 * aferir o extrator falso. As leituras entram em `leitura_modelo` como
 * qualquer outra — a aferição não é um caminho especial, é uso normal com
 * gabarito.
 */

/**
 * A conta Groq no plano gratuito tem teto de 8000 tokens por minuto, e cada
 * leitura destas custa ~1900 — ou seja, **quatro por minuto**. Rodar os 18
 * casos em sequência estoura o teto no nono.
 *
 * Isso não é problema da aferição, é um dado de capacidade: com esta conta, o
 * sistema inteiro processa ~4 leituras por minuto, muito abaixo do teto de
 * concorrência do despachante. Aqui a gente espera e continua; em produção,
 * esse 429 vira erro registrado em `leitura_modelo` — o que é o certo, porque
 * a fila da operação não pode ficar dormindo em silêncio.
 */
async function comEspera<T>(fn: () => Promise<T>, tentativas = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i >= tentativas || !msg.includes("rate_limit")) throw e;
      const pedido = /try again in ([\d.]+)s/.exec(msg);
      const espera = pedido ? Number(pedido[1]) * 1000 + 500 : 20_000;
      console.log(`       (teto de tokens do minuto — esperando ${Math.round(espera / 1000)}s)`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

// --- Agente 1: o laudo de vistoria ---

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
console.log(`\n--- Agente 1 · prompt ${versaoDoPrompt(SISTEMA)} · ${CASOS.length} casos ---\n`);

const resultados: Conferencia[] = [];

for (const caso of CASOS) {
  const e = (await comEspera(() =>
    extrair({ schema: ExtracaoLaudo, sistema: SISTEMA, entrada: entradaDe(caso.laudo) }),
  )) as ExtracaoLaudo;

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

// --- Agente 4: a mensagem que não é sobre imóvel ---
//
// O único agente que fala com gente de fora, e o único em que o erro tem lado:
// calar um cliente não custa o mesmo que responder bobagem a um engano.

const extrairConversa = comProcedencia(
  extratorGroq("extracao"),
  { agente: "4_atendimento" },
  registrarLeitura,
);

// Catálogo mínimo, porque o prompt de produção sempre chega com um: sem imóvel
// nenhum na lista, "vocês alugam?" vira pergunta sem contexto e o caso deixa de
// parecer com o que acontece de verdade.
const CATALOGO = ["- i1 | apartamento | Campolim | R$ 846000", "- i2 | casa | Éden | R$ 520000"].join(
  "\n",
);

console.log(
  `\n--- Agente 4 · prompt ${versaoDoPrompt(SISTEMA_CONVERSA)} · ${CASOS_CONVERSA.length} casos ---\n`,
);

const conversas: ConferenciaConversa[] = [];

for (const caso of CASOS_CONVERSA) {
  const e = (await comEspera(() =>
    extrairConversa({
      schema: ExtracaoConversa,
      sistema: SISTEMA_CONVERSA,
      entrada: `IMÓVEIS DISPONÍVEIS (só estes existem para você):\n${CATALOGO}\n\nCONVERSA ATÉ AGORA:\n\n\nMENSAGEM NOVA:\n${caso.mensagem}`,
    }),
  )) as ExtracaoConversa;

  const c = conferirConversa(caso, e);
  conversas.push(c);

  const marca = c.ok ? "ok" : c.calouCliente ? "CALOU" : "erro";
  console.log(
    `${marca.padEnd(6)}${c.id.padEnd(22)}fora do assunto: ${String(c.foraDoAssunto).padEnd(6)}atípico: ${c.foraDoPadrao}`,
  );
  if (!c.ok) console.log(`       ${c.porque}`);
}

const rc = resumirConversa(conversas);
console.log(`\nconversa: ${rc.ok}/${rc.total}`);
if (rc.calouCliente.length) console.log(`CALOU CLIENTE: ${rc.calouCliente.join(", ")}`);
if (rc.deixouPassar.length) console.log(`deixou passar: ${rc.deixouPassar.join(", ")}`);
if (rc.naoEscalou.length) console.log(`não escalou: ${rc.naoEscalou.join(", ")}`);

// O outro lado da aferição: o rótulo que a equipe já escreveu no painel.
const painel = await concordanciaDoPainel();
if (painel.length) {
  console.log("\nconcordância do painel (decisões humanas sobre leituras registradas)");
  for (const p of painel) {
    console.log(`  ${p.agente} ${p.promptHash} ${p.tipo}: ${p.aprovados}/${p.decididos} aprovados`);
  }
}

await pool.end();
