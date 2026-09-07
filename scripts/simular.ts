import { MEDIDO, PESQUISADO, SUPOSTO, porOrigem } from "../src/simulacao/parametros";
import { custoPerdido, simular, type Cenario, type Resultado } from "../src/simulacao/motor";

/**
 * A simulação do roteamento, com a rotina real do corretor.
 *
 * Roda offline: sem banco, sem modelo, sem rede. A escolha do corretor é a
 * regra de produção importada, não uma cópia.
 */

const DIAS = 90;

const CENARIOS: Cenario[] = [
  { nome: "A · hoje", notificacaoChega: false, respostaInterpretada: false },
  {
    nome: "B · avisa, aceite só no painel",
    notificacaoChega: true,
    respostaInterpretada: false,
    abrePainelSozinho: 0.25,
  },
  { nome: "C · avisa e entende a resposta", notificacaoChega: true, respostaInterpretada: true },
  {
    nome: "D · C, prazo de 10 min",
    notificacaoChega: true,
    respostaInterpretada: true,
    prazoAceiteMin: 10,
  },
  {
    nome: "E · C, 5 tentativas",
    notificacaoChega: true,
    respostaInterpretada: true,
    maxOfertas: 5,
  },
];

const pct = (x: number | null) => (x === null ? "   —" : `${(x * 100).toFixed(0)}%`.padStart(4));
const min = (x: number | null) => (x === null ? "    —" : `${x.toFixed(1)}m`.padStart(5));
const brl = (x: number) =>
  x.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

console.log(`\n=== SIMULAÇÃO · ${DIAS} dias · ${SUPOSTO.leadsPorDia.valor} leads/dia · ${MEDIDO.corretoresAtivos.valor} corretores ===\n`);
console.log("cenário                          detecção  aceite  até dono   sem dono");
console.log("─".repeat(76));

const resultados: Resultado[] = [];

for (const c of CENARIOS) {
  const r = simular(c, DIAS);
  resultados.push(r);
  console.log(
    `${r.cenario.padEnd(32)}${pct(r.taxaDeteccao)}     ${min(r.medianaAceiteMin)}  ${min(
      r.medianaAteDonoMin,
    )}   ${pct(r.percentualSemDono)} (${r.semDono})`,
  );
}

console.log("\n=== POR QUE O LEAD FICOU SEM DONO ===\n");
for (const r of resultados) {
  console.log(
    `${r.cenario.padEnd(32)}silêncio ${String(r.semDonoPorSilencio).padStart(4)}   ninguém pontuou ${String(
      r.semDonoPorEscalacao,
    ).padStart(3)}`,
  );
}

console.log(`\n=== DINHEIRO, EM ${DIAS} DIAS (faixa, nunca número único) ===\n`);
for (const r of resultados) {
  const c = custoPerdido(r, DIAS);
  console.log(
    `${r.cenario.padEnd(32)}${brl(c.porMes[0]).padStart(14)}  a ${brl(c.porMes[1]).padStart(14)}`,
  );
}

const hoje = custoPerdido(resultados[0]!, DIAS);
const alvo = custoPerdido(resultados[2]!, DIAS);
console.log(
  `\ndiferença entre hoje e o cenário C: ${brl(hoje.porMes[0] - alvo.porMes[0])} a ${brl(
    hoje.porMes[1] - alvo.porMes[1],
  )} em ${DIAS} dias`,
);

// --- sensibilidade -------------------------------------------------------
//
// O número que importa mais que os de cima: quanto o resultado depende dos
// parâmetros que ninguém mediu. Se um deles move muito, a conclusão honesta é
// "meça isto antes de prometer número a um cliente".

console.log("\n=== SENSIBILIDADE — quanto cada suposto move a detecção do cenário C ===\n");

const baseC = simular(CENARIOS[2]!, DIAS).taxaDeteccao!;
const variacoes: { nome: string; aplicar: (f: number) => void; restaurar: () => void }[] = [];

const original = {
  fracaoDirigindo: SUPOSTO.fracaoDirigindo.valor,
  visitasPorDia: SUPOSTO.visitasPorDia.valor,
  atraso: [...SUPOSTO.atrasoAoFicarLivreMin.valor] as [number, number],
  ignoraLivre: SUPOSTO.ignoraLivre.valor,
};

variacoes.push(
  {
    nome: "fração do dia dirigindo",
    aplicar: (f) => (SUPOSTO.fracaoDirigindo.valor = original.fracaoDirigindo * f),
    restaurar: () => (SUPOSTO.fracaoDirigindo.valor = original.fracaoDirigindo),
  },
  {
    nome: "visitas por dia",
    aplicar: (f) => (SUPOSTO.visitasPorDia.valor = Math.max(1, Math.round(original.visitasPorDia * f))),
    restaurar: () => (SUPOSTO.visitasPorDia.valor = original.visitasPorDia),
  },
  {
    nome: "demora pra olhar o celular",
    aplicar: (f) =>
      (SUPOSTO.atrasoAoFicarLivreMin.valor = [original.atraso[0] * f, original.atraso[1] * f]),
    restaurar: () => (SUPOSTO.atrasoAoFicarLivreMin.valor = original.atraso),
  },
  {
    nome: "chance de ignorar em hora livre",
    aplicar: (f) => (SUPOSTO.ignoraLivre.valor = Math.min(0.9, original.ignoraLivre * f)),
    restaurar: () => (SUPOSTO.ignoraLivre.valor = original.ignoraLivre),
  },
);

for (const v of variacoes) {
  v.aplicar(0.5);
  const menos = simular(CENARIOS[2]!, DIAS).taxaDeteccao!;
  v.aplicar(2);
  const mais = simular(CENARIOS[2]!, DIAS).taxaDeteccao!;
  v.restaurar();
  const amplitude = Math.abs(mais - menos);
  console.log(
    `${v.nome.padEnd(32)}metade ${pct(menos)}   dobro ${pct(mais)}   amplitude ${pct(amplitude)}`,
  );
}

console.log(`\n(base do cenário C: ${pct(baseC)})`);

// --- procedência dos números ---------------------------------------------

console.log("\n=== DE ONDE VEM CADA NÚMERO ===\n");
for (const origem of ["medido", "pesquisado", "suposto"] as const) {
  const itens = porOrigem(origem);
  console.log(`${origem.toUpperCase()} (${itens.length})`);
  for (const [nome, v] of itens) console.log(`  ${nome.padEnd(28)} ${v.fonte}`);
  console.log("");
}

console.log(
  `Taxa de abertura usada: ${PESQUISADO.aberturaWhatsApp.valor * 100}% — a de 98% que circula no mercado não tem fonte primária.`,
);
