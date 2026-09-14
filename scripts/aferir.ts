import { ExtracaoLaudo, SISTEMA } from "../src/agentes/curador";
import { ExtracaoConversa, SISTEMA as SISTEMA_CONVERSA } from "../src/agentes/atendimento";
import { comEspera, extratorGroq } from "../src/agentes/modelo";
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
import { ExtracaoNegociacao, SISTEMA as SISTEMA_NEGOCIACAO } from "../src/agentes/guardiao";
import { PedidoAlteracao, SISTEMA as SISTEMA_ALTERADOR } from "../src/agentes/alterador";
import { CASOS_NEGOCIACAO, conferirNegociacao, type ConferenciaNegociacao } from "../src/afericao/negociacao";
import { CASOS_ALTERACAO, conferirAlteracao, type ConferenciaAlteracao } from "../src/afericao/alteracao";
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
// A aferição pode esperar o minuto inteiro; a operação não (ver comEspera).
const esperarMinuto = <T>(fn: () => Promise<T>) => comEspera(fn, { tentativas: 4, esperaMax: 65_000 });

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
  const e = (await esperarMinuto(() =>
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
  const e = (await esperarMinuto(() =>
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

// --- Agente 2: o documento da negociação ---

const extrairNegociacao = comProcedencia(extratorGroq("extracao"), { agente: "2_guardiao" }, registrarLeitura);

console.log(`\n--- Agente 2 · prompt ${versaoDoPrompt(SISTEMA_NEGOCIACAO)} · ${CASOS_NEGOCIACAO.length} casos ---\n`);

const negociacoes: ConferenciaNegociacao[] = [];
for (const caso of CASOS_NEGOCIACAO) {
  const e = (await esperarMinuto(() =>
    extrairNegociacao({ schema: ExtracaoNegociacao, sistema: SISTEMA_NEGOCIACAO, entrada: caso.documento }),
  )) as ExtracaoNegociacao;
  const c = conferirNegociacao(caso, e);
  negociacoes.push(c);
  const marca = c.ok ? "ok" : c.tirouDoMercado ? "GRAVE" : "erro";
  console.log(`${marca.padEnd(6)}${c.id.padEnd(22)}${c.estadoObtido.padEnd(20)}(esperado ${c.estadoEsperado})`);
  if (!c.ok) console.log(`       ${c.porque}`);
}
console.log(`\nnegociação: ${negociacoes.filter((c) => c.ok).length}/${negociacoes.length}`);
const tirou = negociacoes.filter((c) => c.tirouDoMercado).map((c) => c.id);
if (tirou.length) console.log(`TIROU DO MERCADO: ${tirou.join(", ")}`);

// --- Agente 6: o pedido de alteração ---

const extrairAlteracao = comProcedencia(extratorGroq("extracao"), { agente: "6_alterador" }, registrarLeitura);

console.log(`\n--- Agente 6 · prompt ${versaoDoPrompt(SISTEMA_ALTERADOR)} · ${CASOS_ALTERACAO.length} casos ---\n`);

const alteracoes: ConferenciaAlteracao[] = [];
for (const caso of CASOS_ALTERACAO) {
  const p = (await esperarMinuto(() =>
    extrairAlteracao({ schema: PedidoAlteracao, sistema: SISTEMA_ALTERADOR, entrada: caso.texto }),
  )) as PedidoAlteracao;
  const c = conferirAlteracao(caso, p);
  alteracoes.push(c);
  const marca = c.ok ? "ok" : c.erradoComCerteza ? "GRAVE" : "erro";
  console.log(`${marca.padEnd(6)}${c.id.padEnd(22)}${c.lido}`);
  if (!c.ok) console.log(`       esperado ${c.esperado} — ${c.porque}`);
}
console.log(`\nalteração: ${alteracoes.filter((c) => c.ok).length}/${alteracoes.length}`);
const comCerteza = alteracoes.filter((c) => c.erradoComCerteza).map((c) => c.id);
if (comCerteza.length) console.log(`ERRADO COM CERTEZA: ${comCerteza.join(", ")}`);

// O outro lado da aferição: o rótulo que a equipe já escreveu no painel.
const painel = await concordanciaDoPainel();
if (painel.length) {
  console.log("\nconcordância do painel (decisões humanas sobre leituras registradas)");
  for (const p of painel) {
    console.log(`  ${p.agente} ${p.promptHash} ${p.tipo}: ${p.aprovados}/${p.decididos} aprovados`);
  }
}

await pool.end();
