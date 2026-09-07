import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { enviarMensagem } from "@/lib/canal";
import { proximaAbertura } from "@/lib/expediente";
import type { Agente } from "@/tipos";
import type { Escrita, PedidoAprovacao } from "./contrato";
import type { IoDoNo } from "@/grafo/no";

/**
 * A `IoDoNo` de verdade, sobre Drizzle.
 *
 * Duas garantias que valem mais que a conveniência:
 * 1. Não existe caminho para escrever sem registrar em `log_evento` — a
 *    pergunta "por que esse anúncio caiu?" sempre tem resposta.
 * 2. A R5 já barrou em tempo de compilação o que não é do agente; aqui só
 *    resta traduzir campo lógico para coluna.
 *
 * Tudo aqui é idempotente por evento, porque a R7 faz o nó do agente
 * re-executar depois do gate.
 */

const COLUNA_IMOVEL = {
  "imovel.estadoOperacional": "estadoOperacional",
  "imovel.preco": "preco",
  "imovel.estadoAnuncio": "estadoAnuncio",
  "imovel.estadoComercial": "estadoComercial",
} as const;

async function aplicar(e: Escrita<Agente>): Promise<void> {
  const campo = e.campo as string;

  if (campo in COLUNA_IMOVEL) {
    const coluna = COLUNA_IMOVEL[campo as keyof typeof COLUNA_IMOVEL];
    await db
      .update(schema.imovel)
      .set({ [coluna]: e.valorNovo })
      .where(eq(schema.imovel.idImovel, e.idEntidade));
    return;
  }

  switch (campo) {
    case "laudo":
      await db
        .update(schema.laudo)
        .set({ extracaoEstruturada: JSON.parse(e.valorNovo ?? "null") })
        .where(eq(schema.laudo.idLaudo, e.idEntidade));
      return;
    case "anuncio":
      await db
        .update(schema.anuncio)
        .set({ status: e.valorNovo as "no_ar" | "pausado" | "removido" })
        .where(eq(schema.anuncio.idAnuncio, e.idEntidade));
      return;
    case "transacao":
      await db
        .update(schema.transacao)
        .set({ etapa: e.valorNovo ?? "" })
        .where(eq(schema.transacao.idTransacao, e.idEntidade));
      return;
    case "busca": {
      const c = JSON.parse(e.valorNovo ?? "{}");
      await db
        .update(schema.busca)
        .set({
          valorMin: c.valorMin === null || c.valorMin === undefined ? null : String(c.valorMin),
          valorMax: c.valorMax === null || c.valorMax === undefined ? null : String(c.valorMax),
          tipoImovel: c.tipoImovel ?? null,
          bairrosDesejados: c.bairrosDesejados ?? [],
          textoOriginal: c.textoOriginal ?? "",
        })
        .where(eq(schema.busca.idBusca, e.idEntidade));
      return;
    }
    // agenda e vinculo são gravados pelas portas do Agente 3, que precisam do
    // resultado (id do evento, conflito de horário). Aqui só sobra o log.
    // ponytail: `papel` fica só no log — a linha já é criada na entrada do
    // lead; vira UPSERT quando existir mais de um papel por cliente.
    case "atendimento": {
      // Só avança, nunca retrocede: `etapaMaxima` guarda o mais fundo que a
      // conversa já chegou, e é dele que sai a prioridade da fila.
      const etapa = e.valorNovo as "qualificado";
      await db
        .update(schema.atendimento)
        .set({ etapa, etapaMaxima: etapa, ultimoContatoPor: "nos", estado: "pendente" })
        .where(
          and(
            eq(schema.atendimento.idCliente, e.idEntidade),
            ne(schema.atendimento.estado, "fechado"),
            eq(schema.atendimento.etapa, "primeiro_contato"),
          ),
        );
      return;
    }
    // agenda e vinculo são gravados pelas portas do Agente 3, que precisam do
    // resultado. `identidade` é escrita na recepção, antes do grafo.
    case "agenda":
    case "vinculoLeadCorretor":
    case "cliente":
    case "papel":
    case "identidade":
      return;
    default:
      throw new Error(`campo sem mapeamento: ${campo}`);
  }
}

export const ioDb: IoDoNo = {
  async escrever(agente, idEvento, e) {
    await aplicar(e);
    await db
      .insert(schema.logEvento)
      .values({
        agenteOrigem: agente,
        entidade: (e.campo as string).split(".")[0]!,
        idEntidade: e.idEntidade,
        campo: e.campo as string,
        valorAnterior: e.valorAnterior ?? null,
        valorNovo: e.valorNovo,
        idEvento,
      })
      // R7: a re-execução do nó repete a escrita. O UPDATE acima é idempotente
      // por natureza; o log só é por causa desta chave.
      .onConflictDoNothing({
        target: [schema.logEvento.idEvento, schema.logEvento.campo, schema.logEvento.idEntidade],
      });
  },

  async registrarPedido(agente, idEvento, threadId, p: PedidoAprovacao) {
    const agora = new Date();

    // O relógio do prazo só começa a correr quando existe alguém pra
    // responder. Lead que chega 3h de domingo é registrado na hora e entregue
    // 7h30 de segunda — sem isso o rodízio queima os melhores corretores
    // contra gente dormindo, e ainda os registra como quem não respondeu.
    const abertura = p.prazoMin ? proximaAbertura(agora) : null;

    const criados = await db
      .insert(schema.aprovacao)
      .values({
        tipo: p.tipo,
        entidade: p.entidade,
        idEntidade: p.idEntidade,
        solicitadoPorAgente: agente,
        // A mensagem viaja no contexto: se a entrega for adiada, é a varredura
        // que vai mandar, e ela precisa do texto.
        contexto: p.mensagem ? { ...p.contexto, mensagem: p.mensagem } : p.contexto,
        idEvento,
        threadId,
        destinatario: p.destinatario ?? null,
        enviarEm: abertura,
        expiraEm: abertura ? new Date(abertura.getTime() + p.prazoMin! * 60_000) : null,
      })
      .onConflictDoNothing({
        target: [schema.aprovacao.idEvento, schema.aprovacao.tipo, schema.aprovacao.idEntidade],
      })
      .returning({ id: schema.aprovacao.id });

    // A mensagem sai UMA vez, e quem garante isso é o banco: se a linha já
    // existia, este é o nó re-executando depois do gate (R7) e o corretor já
    // recebeu o aviso. Sem esta amarra, cada retomada mandaria WhatsApp de novo.
    const naHora = !abertura || abertura <= agora;
    if (criados.length > 0 && p.mensagem && p.destinatario && naHora) {
      await entregar(criados[0]!.id, p.destinatario, p.mensagem);
    }
  },

  async avisar(agente, mensagem) {
    // ponytail: aviso vai pro log até existir canal de equipe (Slack/WhatsApp).
    console.log(`[${agente}] ${mensagem}`);
  },
};

/** Manda a mensagem da oferta e marca a linha como entregue. */
export async function entregar(
  idAprovacao: string,
  idCorretor: string,
  mensagem: string,
): Promise<void> {
  const [c] = await db
    .select({ telefone: schema.corretor.telefone })
    .from(schema.corretor)
    .where(eq(schema.corretor.idCorretor, idCorretor));

  await enviarMensagem(c?.telefone, mensagem);

  // Marca mesmo se o canal falhou: o registro diz que a tentativa foi feita, e
  // repetir a cada minuto até o canal voltar seria pior que perder uma.
  await db
    .update(schema.aprovacao)
    .set({ enviadoEm: new Date() })
    .where(eq(schema.aprovacao.id, idAprovacao));
}

/** Marca de idempotência da R6, consultada pelo despachante. */
export async function jaProcessado(idEvento: string): Promise<boolean> {
  const [linha] = await db
    .select({ id: schema.eventoProcessado.idEvento })
    .from(schema.eventoProcessado)
    .where(eq(schema.eventoProcessado.idEvento, idEvento))
    .limit(1);
  return Boolean(linha);
}

export async function marcarProcessado(e: {
  idEvento: string;
  tipo: string;
  agente: Agente;
}): Promise<void> {
  await db
    .insert(schema.eventoProcessado)
    .values({ idEvento: e.idEvento, tipo: e.tipo, agente: e.agente })
    .onConflictDoNothing();
}

/** Pedido pendente de uma thread — o painel usa pra saber o que retomar. */
export async function pedidoDaThread(threadId: string) {
  const [linha] = await db
    .select()
    .from(schema.aprovacao)
    .where(
      and(eq(schema.aprovacao.threadId, threadId), eq(schema.aprovacao.estado, "pendente")),
    )
    .limit(1);
  return linha;
}
