import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CampoDeLog } from "@/regras/modo";
import { enviarMensagem } from "@/lib/canal";
import { avaliar, type Atendimento } from "@/regras/funil";
import {
  avisosDeVigencia,
  calcularEncargos,
  competenciaDe,
  gerarParcela,
  reajusteDevido,
  reguaCobranca,
  type Contrato,
} from "@/regras/locacao";
import { avaliarProcesso } from "@/regras/escritura";
import { decifrar } from "@/lib/cripto";
import { createHash } from "node:crypto";
import { alertar } from "@/agentes/contexto-db";
import type { PedidoAprovacao } from "@/agentes/contrato";

/**
 * Os ciclos que não têm gatilho externo.
 *
 * Os quatro agentes reativos acordam quando alguém faz alguma coisa. Estes três
 * acordam porque o **tempo passou** — e tempo passando é a metade do trabalho
 * de uma imobiliária que ninguém dispara: o lead que parou de responder, o
 * aluguel que venceu, o cartório que está sentado no processo há 50 dias.
 *
 * Todos rodam pela varredura e todos são idempotentes: a varredura bate de
 * minuto em minuto e nenhum deles pode cobrar duas vezes.
 */

// ---------------------------------------------------------------------------
// Funil de atendimento
// ---------------------------------------------------------------------------

/**
 * Recalcula prioridade e estado de todo atendimento em aberto.
 *
 * O que ela **não** faz: fechar caso sozinha. Um lead que não responde há 40
 * dias sobe pro topo marcado como "precisa de desfecho" e fica lá até alguém
 * escrever o motivo. Fechar por silêncio seria transformar "não sei" em "não
 * quis", e é assim que a lista de perdidos deixa de servir pra decidir
 * qualquer coisa.
 */
export async function reavaliarAtendimentos(agora = new Date()) {
  const abertos = await db
    .select()
    .from(schema.atendimento)
    .where(ne(schema.atendimento.estado, "fechado"));

  let mudados = 0;
  let pedindoDesfecho = 0;

  for (const a of abertos) {
    const situacao = avaliar(
      {
        etapa: a.etapa,
        etapaMaxima: a.etapaMaxima,
        estado: a.estado,
        ultimaInteracao: a.ultimaInteracao,
        ultimoContatoPor: a.ultimoContatoPor as Atendimento["ultimoContatoPor"],
      },
      agora,
    );

    if (
      situacao.estado === a.estado &&
      situacao.prioridade === a.prioridade &&
      situacao.precisaDesfecho === a.precisaDesfecho
    ) {
      continue;
    }

    await db
      .update(schema.atendimento)
      .set({
        estado: situacao.estado,
        prioridade: situacao.prioridade,
        precisaDesfecho: situacao.precisaDesfecho,
      })
      .where(eq(schema.atendimento.idAtendimento, a.idAtendimento));

    // Só mudança de ESTADO vira linha. A prioridade é recalculada a cada
    // minuto sobre todo atendimento aberto — logá-la afogaria a tabela e a tela
    // em ruído, e tela ruidosa não é lida. É o mesmo erro que a faixa evitou no
    // canal de aviso.
    if (situacao.estado !== a.estado) {
      await registrarAutomatico(
        "atendimento",
        a.idAtendimento,
        "atendimento.estado",
        a.estado,
        situacao.estado,
      );
    }

    mudados++;
    if (situacao.precisaDesfecho && !a.precisaDesfecho) pedindoDesfecho++;
  }

  return { avaliados: abertos.length, mudados, pedindoDesfecho };
}

// ---------------------------------------------------------------------------
// Locação
// ---------------------------------------------------------------------------

function paraContrato(c: typeof schema.contratoLocacao.$inferSelect): Contrato {
  return {
    idContrato: c.idContrato,
    valorAluguel: Number(c.valorAluguel),
    valorCondominio: Number(c.valorCondominio),
    valorIptu: Number(c.valorIptu),
    diaVencimento: c.diaVencimento,
    inicio: c.inicio,
    fim: c.fim,
    ultimoReajuste: c.ultimoReajuste,
    taxaAdministracao: Number(c.taxaAdministracao),
    multaAtraso: Number(c.multaAtraso),
    jurosMes: Number(c.jurosMes),
  };
}

/**
 * O mês da locação: gera a parcela, atualiza encargos de quem atrasou, anda a
 * régua de cobrança e avisa reajuste e fim de contrato.
 *
 * A geração olha o mês atual e o próximo: sem o próximo, o lembrete de "vence
 * em 3 dias" de um aluguel que vence dia 2 nunca sairia, porque a parcela só
 * nasceria no dia 1.
 */
export async function varrerLocacao(agora = new Date()) {
  const contratos = await db
    .select()
    .from(schema.contratoLocacao)
    .where(eq(schema.contratoLocacao.estado, "ativo"));

  const avisos: string[] = [];
  let geradas = 0;
  let cobrancas = 0;

  for (const linha of contratos) {
    const c = paraContrato(linha);

    for (const mesesAFrente of [0, 1]) {
      const alvo = new Date(agora.getFullYear(), agora.getMonth() + mesesAFrente, 1);
      const nova = gerarParcela(c, alvo.getFullYear(), alvo.getMonth());
      if (!nova) continue;

      const criada = await db
        .insert(schema.parcelaAluguel)
        .values({
          idContrato: c.idContrato,
          competencia: nova.competencia,
          vencimento: nova.vencimento,
          valorBase: String(nova.valorBase),
        })
        // A trava que torna a varredura de minuto em minuto segura: uma
        // parcela por competência, sempre.
        .onConflictDoNothing({
          target: [schema.parcelaAluguel.idContrato, schema.parcelaAluguel.competencia],
        })
        .returning({ id: schema.parcelaAluguel.idParcela });

      if (criada.length) geradas++;
    }

    const abertas = await db
      .select()
      .from(schema.parcelaAluguel)
      .where(
        and(
          eq(schema.parcelaAluguel.idContrato, c.idContrato),
          or(
            eq(schema.parcelaAluguel.estado, "aberta"),
            eq(schema.parcelaAluguel.estado, "atrasada"),
          ),
        ),
      );

    for (const p of abertas) {
      const parcela = {
        competencia: p.competencia,
        vencimento: p.vencimento,
        valorBase: Number(p.valorBase),
        estagioCobranca: p.estagioCobranca,
      };
      const encargos = calcularEncargos(c, parcela, agora);
      const passo = reguaCobranca(parcela, agora);

      if (encargos.dias > 0 || passo) {
        await db
          .update(schema.parcelaAluguel)
          .set({
            estado: encargos.dias > 0 ? "atrasada" : "aberta",
            valorEncargos: String(encargos.multa + encargos.juros),
            estagioCobranca: passo?.estagio ?? p.estagioCobranca,
          })
          .where(eq(schema.parcelaAluguel.idParcela, p.idParcela));

        // Marcar alguém como inadimplente é consequência real, e até aqui
        // acontecia sem deixar rastro nenhum. Só na virada: repetir a cada
        // minuto enquanto o atraso durasse encheria o log de nada.
        if (encargos.dias > 0 && p.estado !== "atrasada") {
          await registrarAutomatico(
            "parcela",
            p.idParcela,
            "parcela.atrasada",
            p.estado,
            `${encargos.dias} dia(s), encargos ${moeda(encargos.multa + encargos.juros)}`,
          );
        }
      }

      if (!passo) continue;
      cobrancas++;

      if (passo.tom === "escalacao") {
        // 30 dias não é mensagem automática: é decisão de gente sobre um
        // contrato. Vai pro painel, não pro WhatsApp do inquilino.
        avisos.push(
          `Inadimplência de 30 dias no contrato ${c.idContrato} (competência ${p.competencia}) — ${passo.texto}.`,
        );
        await abrirPedidoDoCiclo(
          {
            tipo: "escalacao_n3",
            entidade: "parcela",
            idEntidade: p.idParcela,
            contexto: {
              motivo: "inadimplencia_30_dias",
              etapa: p.competencia,
              custoEmRisco: encargos.total,
            },
            // Dinheiro parado e o relógio correndo: o prazo de um despejo não
            // espera alguém lembrar de abrir o painel.
            faixa: "vermelha",
          },
          `inadimplencia:${c.idContrato}:${p.competencia}`,
        );
        continue;
      }

      const [inquilino] = await db
        .select({ telefone: schema.cliente.telefone, nome: schema.cliente.nome })
        .from(schema.cliente)
        .where(eq(schema.cliente.idCliente, linha.idInquilino));

      // O texto do passo descreve o marco, não o dia de hoje: um passo de
      // "vence hoje" cobre também o dia seguinte, e mandar "vence hoje" pra
      // quem venceu ontem faz o inquilino desconfiar do valor junto.
      const situacao =
        encargos.dias > 0 ? `está ${encargos.dias} dia(s) em atraso` : passo.texto;

      await enviarMensagem(
        decifrar(inquilino?.telefone),
        `Olá${inquilino?.nome ? `, ${inquilino.nome.split(" ")[0]}` : ""}! Seu aluguel de ${p.competencia} ${situacao}. Valor: ${moeda(encargos.total)}.`,
      );

      // Cobrar dinheiro de alguém é a coisa de maior consequência que este
      // sistema faz sozinho, e era a menos auditada: o texto ficava em
      // `mensagem_enviada`, mas sem o porquê, sem a parcela e sem o estágio.
      // Uma multa mal configurada cobraria errado de todo mundo, todo mês, e
      // só se descobriria pela reclamação do inquilino.
      await registrarAutomatico(
        "parcela",
        p.idParcela,
        "parcela.cobranca",
        `estágio ${p.estagioCobranca}`,
        `estágio ${passo.estagio} (${passo.tom}) — ${moeda(encargos.total)}`,
      );
    }

    // O reajuste vem sem valor de índice de propósito: quanto foi o IGPM do
    // ano não está no banco nem no modelo, e chutar isso seria a pior mentira
    // que este sistema poderia contar. O aviso pede o número a quem tem.
    const reajuste = reajusteDevido(c, null, agora);
    if (reajuste.devido) {
      avisos.push(
        `Reajuste devido no contrato ${c.idContrato} desde ${reajuste.em.toLocaleDateString("pt-BR")} (aluguel atual ${moeda(c.valorAluguel)}, índice ${linha.indice.toUpperCase()}).`,
      );
      await abrirPedidoDoCiclo(
        {
          tipo: "reajuste_aluguel",
          entidade: "contrato",
          idEntidade: c.idContrato,
          contexto: {
            motivo: "reajuste_devido",
            // O índice não vai no valor de propósito: quanto foi o IGPM do ano
            // não está no banco, e chutar seria a pior mentira possível aqui.
            observacao: `Índice ${linha.indice.toUpperCase()}, aluguel atual ${moeda(c.valorAluguel)}, devido desde ${reajuste.em.toLocaleDateString("pt-BR")}.`,
          },
          faixa: "vermelha",
        },
        `reajuste:${c.idContrato}:${reajuste.em.toISOString().slice(0, 7)}`,
      );
    }

    const vigencia = avisosDeVigencia(c, agora);
    if (vigencia) {
      avisos.push(`Contrato ${c.idContrato}: ${vigencia.texto}.`);
      await abrirPedidoDoCiclo(
        {
          tipo: "escalacao_n3",
          entidade: "contrato",
          idEntidade: c.idContrato,
          contexto: { motivo: "fim_de_vigencia", observacao: vigencia.texto },
          // Amarela: tem prazo, mas tem folga. Não vale tocar o telefone de
          // ninguém — chega por e-mail e espera no painel.
          faixa: "amarela",
        },
        `vigencia:${c.idContrato}:${vigencia.texto}`,
      );
    }
  }

  return { contratos: contratos.length, geradas, cobrancas, avisos };
}

/** Registra o pagamento e calcula o repasse. Chamado pela tela, não pela varredura. */
export async function registrarPagamento(
  idParcela: string,
  valorPago: number,
  agora = new Date(),
) {
  const [p] = await db
    .select()
    .from(schema.parcelaAluguel)
    .where(eq(schema.parcelaAluguel.idParcela, idParcela));
  if (!p) throw new Error("parcela não encontrada");
  if (p.estado === "paga" || p.estado === "repassada") return { jaPago: true };

  await db
    .update(schema.parcelaAluguel)
    .set({ estado: "paga", valorPago: String(valorPago), pagoEm: agora })
    .where(eq(schema.parcelaAluguel.idParcela, idParcela));

  return { jaPago: false };
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/**
 * Processos parados além do prazo típico da etapa.
 *
 * A saída vem separada em duas listas porque são dois tipos de trabalho: o que
 * é nosso vira tarefa, o que é de cartório vira ligação. Misturar as duas faz
 * a equipe aprender a ignorar a lista inteira — nada ensina mais rápido a
 * ignorar um alerta do que ele cobrar algo que não dá pra fazer.
 */
export async function varrerEscrituras(agora = new Date()) {
  const processos = await db
    .select()
    .from(schema.processoEscritura)
    .where(
      and(
        ne(schema.processoEscritura.etapa, "concluido"),
        ne(schema.processoEscritura.etapa, "cancelado"),
      ),
    );

  const nossos: { idProcesso: string; texto: string; acao: string }[] = [];
  const acompanhar: { idProcesso: string; texto: string; acao: string }[] = [];

  for (const p of processos) {
    const alerta = avaliarProcesso(
      {
        etapa: p.etapa,
        etapaDesde: p.etapaDesde,
        documentosEntregues: p.documentosEntregues,
      },
      agora,
    );
    if (!alerta) continue;

    const item = { idProcesso: p.idProcesso, texto: alerta.texto, acao: alerta.acao };
    (alerta.acionavel ? nossos : acompanhar).push(item);

    if (!p.alertadoEm) {
      await db
        .update(schema.processoEscritura)
        .set({ alertadoEm: agora })
        .where(eq(schema.processoEscritura.idProcesso, p.idProcesso));
    }
  }

  return { processos: processos.length, nossos, acompanhar };
}

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export { competenciaDe };

/**
 * O rastro do que o cron faz sozinho.
 *
 * `agenteOrigem: "regra"` e `aprovadoPor` vazio é o que marca a linha como
 * "ninguém aprovou isto" — é por esse par que a tela de `/automatico` encontra
 * o que precisa de olho. O padrão vem de `src/lib/varredura.ts`, que até aqui
 * era o único ponto do cron a registrar qualquer coisa.
 *
 * Falha de gravação não derruba o ciclo: perder a linha do log é ruim, parar a
 * cobrança de todo mundo por causa dela é pior.
 */
async function registrarAutomatico(
  entidade: string,
  idEntidade: string,
  campo: CampoDeLog,
  valorAnterior: string | null,
  valorNovo: string,
): Promise<void> {
  try {
    await db.insert(schema.logEvento).values({
      agenteOrigem: "regra",
      entidade,
      idEntidade,
      campo,
      valorAnterior,
      valorNovo,
    });
  } catch (e) {
    console.warn("[ciclos] log não registrado:", (e as Error).message);
  }
}

/**
 * Um id de evento derivado do assunto, não sorteado.
 *
 * A unique de `aprovacao` é (idEvento, tipo, idEntidade), e no Postgres dois
 * NULL não colidem — um `idEvento` nulo faria o cron criar uma linha por
 * minuto, para sempre. Derivar o id do que o pedido É (contrato + competência)
 * transforma a chave existente na trava de idempotência, sem tabela nem coluna
 * nova.
 */
function idDeterministico(assunto: string): string {
  const h = createHash("sha1").update(assunto).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join(
    "-",
  );
}

/**
 * O que o ciclo de tempo precisa que uma pessoa decida.
 *
 * Até aqui estes casos viravam string num array que morria na resposta HTTP do
 * cron — inclusive a inadimplência de 30 dias, que o comentário do código dizia
 * ir "pro painel". Agora vira linha em `aprovacao`, que é a fila que já existe
 * e já ordena por peso.
 *
 * Sem `threadId`: nenhum grafo está parado esperando isto. O painel já trata
 * esse caso — é o mesmo caminho da fusão de identidade.
 */
async function abrirPedidoDoCiclo(
  p: PedidoAprovacao,
  assunto: string,
): Promise<void> {
  const criados = await db
    .insert(schema.aprovacao)
    .values({
      tipo: p.tipo,
      entidade: p.entidade,
      idEntidade: p.idEntidade,
      solicitadoPorAgente: "regra",
      contexto: p.contexto,
      idEvento: idDeterministico(assunto),
      faixa: p.faixa ?? "verde",
    })
    .onConflictDoNothing({
      target: [schema.aprovacao.idEvento, schema.aprovacao.tipo, schema.aprovacao.idEntidade],
    })
    .returning({ id: schema.aprovacao.id });

  // Só na criação: o cron passa de minuto em minuto, e avisar a cada passada
  // é o jeito mais rápido de fazer a equipe ignorar o canal.
  if (criados.length > 0) await alertar("regra", p, criados[0]!.id);
}
