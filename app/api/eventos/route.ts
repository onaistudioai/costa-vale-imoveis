import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { processarEvento } from "@/grafo/runtime";
import { chaveDeLock, GATILHOS, threadDoEvento } from "@/grafo/eventos";
import { pedirFusao, receber } from "@/lib/recepcao";

/**
 * A entrada do mundo no sistema.
 *
 * Canal, CRM e formulário de laudo batem todos aqui. O que chega é evento —
 * quem decide qual agente acorda é a R1, e quem decide se pode rodar agora é o
 * despachante (R2/R3/R6). Nenhum cliente externo escolhe agente.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const CANAIS = [
  "whatsapp",
  "instagram",
  "facebook",
  "site",
  "email",
  "telefone",
  "portal",
] as const;

const Entrada = z.object({
  idEvento: z.string().uuid().optional(),
  tipo: z.enum(Object.keys(GATILHOS) as [keyof typeof GATILHOS]),
  idImovel: z.string().uuid().optional(),
  idCliente: z.string().uuid().optional(),
  /**
   * Quem mandou, quando o canal não sabe quem é o cliente — que é o caso de
   * todo canal de verdade. O Instagram entrega um @, o WhatsApp um wa_id, e
   * nenhum dos dois sabe o id do nosso banco. Sem isto, o webhook exigiria que
   * o mundo lá fora já tivesse resolvido a identidade por nós.
   */
  contato: z
    .object({
      canal: z.enum(CANAIS),
      identificador: z.string().min(1).max(255),
      apelido: z.string().max(255).optional(),
    })
    .optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** Teto de tamanho da mensagem. Sem isso, alguém cola 40 páginas e torra o contexto. */
const LIMITE_MENSAGEM = 4000;

export async function POST(req: Request) {
  const segredo = process.env.WEBHOOK_SECRET;
  if (!segredo || req.headers.get("x-webhook-secret") !== segredo) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const corpo = Entrada.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return NextResponse.json(
      { erro: "evento inválido", detalhe: corpo.error.issues },
      { status: 400 },
    );
  }

  // Sem id do emissor, um retry vira evento novo — a R6 só protege quem manda
  // o mesmo id de volta.
  const idEvento = corpo.data.idEvento ?? randomUUID();
  const { contato, ...resto } = corpo.data;

  const mensagem = String(resto.payload?.mensagem ?? "").slice(0, LIMITE_MENSAGEM);

  // Identidade ANTES do grafo: a chave de lock do Agente 4 é o cliente, então
  // "quem é essa pessoa?" precisa estar respondida aqui e não lá dentro.
  let recepcao: Awaited<ReturnType<typeof receber>> | null = null;
  if (contato) {
    recepcao = await receber({
      canal: contato.canal,
      identificador: contato.identificador,
      apelido: contato.apelido ?? null,
      mensagem,
      idImovelCitado: resto.idImovel ?? null,
    });

    // O pedido de fusão sai em paralelo. A conversa NÃO espera por ele: manter
    // um cliente de madrugada sem resposta por dúvida de cadastro seria pior
    // que a duplicata, que se desfaz com um clique.
    if (recepcao.fusaoSugerida) {
      await pedirFusao(idEvento, recepcao as Parameters<typeof pedirFusao>[1]);
    }
  }

  const evento = {
    ...resto,
    idEvento,
    idCliente: recepcao?.idCliente ?? resto.idCliente,
    payload: resto.payload
      ? { ...resto.payload, ...(mensagem ? { mensagem } : {}), canal: contato?.canal ?? resto.payload.canal }
      : resto.payload,
  };

  try {
    chaveDeLock(evento); // recusa aqui o que travaria dentro do despachante
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 400 });
  }

  const r = await processarEvento(evento);

  if (r === "duplicado") {
    return NextResponse.json({ idEvento: evento.idEvento, estado: "duplicado" });
  }

  return NextResponse.json({
    idEvento: evento.idEvento,
    threadId: threadDoEvento(evento),
    // Preenchido quando o grafo parou num gate: o pedido já está na fila do
    // painel e a thread espera decisão.
    estado: r.pausa ? "aguardando_decisao" : "concluido",
    pedido: r.pausa?.pedido ?? null,
    resposta: r.resposta ?? null,
    // O desfecho do Agente 6. Sem isto, "achei dois imóveis com esse nome, qual
    // deles?" chegava pela API como `concluido` sem pedido e sem resposta —
    // idêntico a "deu tudo certo, nada a fazer". O painel via o motivo; quem
    // integra, não.
    alteracao: r.alteracao ?? null,
    trilha: r.trilha,
    cliente: recepcao
      ? {
          idCliente: recepcao.idCliente,
          novo: recepcao.novo,
          // Quando existe, é a pergunta que o atendimento pode fazer pra
          // resolver a dúvida sem depender de ninguém do painel.
          confirmarIdentidade: recepcao.fusaoSugerida?.pergunta ?? null,
        }
      : null,
  });
}
