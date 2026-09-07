import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "@/lib/db";
import { CONFIG_ROTEAMENTO } from "@/lib/config";
import { extratorGroq } from "@/agentes/modelo";
import { ioDb, jaProcessado, marcarProcessado } from "@/agentes/contexto-db";
import { registrarLeitura } from "@/lib/leitura-db";
import { construirGrafo } from "./index";
import { mundoDb } from "./mundo-db";
import { Despachante } from "./despachante";
import { donoDoEvento, threadDoEvento, type Evento } from "./eventos";
import type { Decisao } from "./no";

/**
 * O grafo em produção: agentes de verdade, banco de verdade, checkpoint de
 * verdade.
 *
 * É o único lugar do sistema que junta as três coisas. Tudo abaixo dele
 * (agentes, regras, grafo) continua rodando com dependências injetadas, sem
 * chave de API e sem Postgres — é o que mantém os testes offline.
 */

let iniciando: Promise<ReturnType<typeof compilar>> | undefined;

function compilar(checkpointer: PostgresSaver) {
  return construirGrafo({
    mundo: mundoDb,
    io: ioDb,
    extrator: extratorGroq(),
    config: CONFIG_ROTEAMENTO,
    registrarLeitura,
  }).compile({ checkpointer });
}

/** Uma instância por processo. `setup()` é idempotente e roda uma vez só. */
export function grafo() {
  iniciando ??= (async () => {
    const checkpointer = new PostgresSaver(pool);
    await checkpointer.setup();
    return compilar(checkpointer);
  })();
  return iniciando;
}

// R2, R3 e R6 antes de qualquer agente rodar. O mesmo despachante para todo o
// processo — teto de concorrência que existe por instância não é teto.
const despachante = new Despachante(undefined, jaProcessado, (e) =>
  marcarProcessado({ idEvento: e.idEvento, tipo: e.tipo, agente: donoDoEvento(e) }),
);

/**
 * A porta de entrada de todo evento externo.
 *
 * Devolve `duplicado` quando a R6 barra, e o estado do grafo quando roda —
 * inclusive quando ele parou num gate, caso em que `pausa` vem preenchida e a
 * linha correspondente já está na fila do painel.
 */
export async function processarEvento(evento: Evento) {
  return despachante.despachar(evento, async () => {
    const app = await grafo();
    return app.invoke(
      { evento },
      { configurable: { thread_id: threadDoEvento(evento) } },
    );
  });
}

/**
 * Retoma a thread parada num gate. Chamado pelo painel depois que a pessoa
 * decide — não reexecuta fluxo nenhum, o `interrupt()` já deixou a execução
 * exatamente no ponto.
 */
export async function retomar(threadId: string, decisao: Decisao) {
  const app = await grafo();
  return app.invoke(new Command({ resume: decisao }), {
    configurable: { thread_id: threadId },
  });
}
