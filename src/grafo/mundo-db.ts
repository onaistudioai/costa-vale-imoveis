import { and, asc, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CONFIG_ROTEAMENTO } from "@/lib/config";
import { gradeDeHorarios } from "@/lib/expediente";
import { enviarMensagem } from "@/lib/canal";
import type { Slot } from "@/tipos";
import { portasAlteradorDb } from "@/lib/alteracao-db";
import type { Mundo } from "./mundo";
import type { Evento } from "./eventos";
import { decifrar } from "@/lib/cripto";

/**
 * O `Mundo` sobre Drizzle. Só leitura de contexto e as portas que precisam do
 * resultado da escrita (id do evento de agenda, conflito de horário) — todo o
 * resto passa por `ioDb`, que registra log.
 */

const num = (v: string | null) => (v === null ? null : Number(v));

/** Canais em que um imóvel aprovado entra. ponytail: fixo até existir integração real. */
const CANAIS = [
  { canal: "site", midiaPaga: false },
  { canal: "portal", midiaPaga: false },
];

/**
 * Slots livres do corretor: a grade do expediente menos o que já está
 * reservado. A grade em si mora em `@/lib/expediente` — é a mesma que decide
 * quando faz sentido oferecer um lead.
 */
function slotsLivres(agora: Date, ocupados: { inicio: Date; fim: Date }[]): Slot[] {
  const limite = new Date(
    agora.getTime() + CONFIG_ROTEAMENTO.horizonteAgendaHoras * 3_600_000,
  );
  return gradeDeHorarios(agora, limite).filter(
    (h) => !ocupados.some((o) => o.inicio < h.fim && h.inicio < o.fim),
  );
}

export const mundoDb: Mundo = {
  async carregarCurador(e: Evento) {
    const idImovel = e.idImovel!;
    const idLaudo = e.payload?.idLaudo as string | undefined;

    const [linha] = idLaudo
      ? await db.select().from(schema.laudo).where(eq(schema.laudo.idLaudo, idLaudo))
      : await db
          .select()
          .from(schema.laudo)
          .where(eq(schema.laudo.idImovel, idImovel))
          .orderBy(desc(schema.laudo.data))
          .limit(1);

    if (!linha) throw new Error(`sem laudo para o imóvel ${idImovel}`);

    const [imovel] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, idImovel));
    if (!imovel) throw new Error(`imóvel ${idImovel} não encontrado`);

    return {
      laudo: {
        idLaudo: linha.idLaudo,
        idImovel: linha.idImovel,
        textoEstado: linha.textoEstado ?? undefined,
        textoDocumentacao: linha.textoDocumentacao ?? undefined,
        textoPendencias: linha.textoPendencias ?? undefined,
      },
      imovel: {
        idImovel: imovel.idImovel,
        estadoOperacional: imovel.estadoOperacional,
        estadoComercial: imovel.estadoComercial,
      },
    };
  },

  async carregarGuardiao(e: Evento) {
    const idImovel = e.idImovel!;
    const idTransacao = e.payload?.idTransacao as string | undefined;

    const [transacao] = idTransacao
      ? await db
          .select()
          .from(schema.transacao)
          .where(eq(schema.transacao.idTransacao, idTransacao))
      : await db
          .select()
          .from(schema.transacao)
          .where(eq(schema.transacao.idImovel, idImovel))
          .limit(1);
    if (!transacao) throw new Error(`sem transação para o imóvel ${idImovel}`);

    const [imovel] = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, idImovel));
    if (!imovel) throw new Error(`imóvel ${idImovel} não encontrado`);

    const anuncios = await db
      .select()
      .from(schema.anuncio)
      .where(eq(schema.anuncio.idImovel, idImovel));

    return {
      idImovel,
      idTransacao: transacao.idTransacao,
      estadoComercialAtual: imovel.estadoComercial,
      documento: String(e.payload?.documento ?? ""),
      anuncios: anuncios.map((a) => ({
        idAnuncio: a.idAnuncio,
        idImovel: a.idImovel,
        canal: a.canal,
        status: a.status,
        midiaPaga: a.midiaPaga,
        custoAcumulado: Number(a.custoAcumulado),
      })),
    };
  },

  async carregarRoteador(e, lead) {
    const agora = new Date();
    const horizonte = new Date(
      agora.getTime() + CONFIG_ROTEAMENTO.horizonteAgendaHoras * 3_600_000,
    );

    const corretores = await db
      .select()
      .from(schema.corretor)
      .where(eq(schema.corretor.ativo, true));
    const ids = corretores.map((c) => c.idCorretor);

    const dominios = await db
      .select()
      .from(schema.dominioCorretor)
      .where(eq(schema.dominioCorretor.idImovel, lead.idImovel));

    const compromissos = ids.length
      ? await db
          .select()
          .from(schema.agenda)
          .where(
            and(
              inArray(schema.agenda.idCorretor, ids),
              gte(schema.agenda.inicio, agora),
              lt(schema.agenda.inicio, horizonte),
              ne(schema.agenda.status, "cancelado"),
            ),
          )
      : [];

    const [vinculo] = await db
      .select()
      .from(schema.vinculoLeadCorretor)
      .where(
        and(
          eq(schema.vinculoLeadCorretor.idCliente, lead.idCliente),
          eq(schema.vinculoLeadCorretor.ativo, true),
        ),
      )
      .orderBy(desc(schema.vinculoLeadCorretor.ultimaInteracao))
      .limit(1);

    const agendaLivre: Record<string, Slot[]> = {};
    const carga: Record<string, number> = {};
    for (const c of corretores) {
      const meus = compromissos.filter((a) => a.idCorretor === c.idCorretor);
      agendaLivre[c.idCorretor] = slotsLivres(agora, meus);
      carga[c.idCorretor] = meus.length;
    }

    const [imovel] = await db
      .select({ estadoComercial: schema.imovel.estadoComercial })
      .from(schema.imovel)
      .where(eq(schema.imovel.idImovel, lead.idImovel));

    return {
      idCliente: lead.idCliente,
      idImovel: lead.idImovel,
      corretores: corretores.map((c) => ({ idCorretor: c.idCorretor, ativo: c.ativo })),
      dominios: dominios.map((d) => ({
        idCorretor: d.idCorretor,
        idImovel: d.idImovel,
        nivel: d.nivel,
      })),
      agendaLivre,
      carga,
      agora,
      vinculo: vinculo
        ? {
            idCliente: vinculo.idCliente,
            idCorretor: vinculo.idCorretor,
            ultimaInteracao: vinculo.ultimaInteracao,
            ativo: vinculo.ativo,
          }
        : undefined,
      resumoDaConversa: lead.resumo,
      // Envelope, caso 3: o imóvel saiu de `disponivel` entre a qualificação e
      // o roteamento. Mandar corretor agora seria visita morta.
      estadoComercialMudou: imovel?.estadoComercial !== "disponivel",
    };
  },

  async carregarAtendimento(e: Evento) {
    const idCliente = e.idCliente!;

    // A busca é o registro vivo do que o cliente procura — uma por conversa.
    const [existente] = await db
      .select()
      .from(schema.busca)
      .where(eq(schema.busca.idCliente, idCliente))
      .orderBy(desc(schema.busca.criadoEm))
      .limit(1);

    const idBusca =
      existente?.idBusca ??
      (
        await db
          .insert(schema.busca)
          .values({ idCliente, textoOriginal: String(e.payload?.mensagem ?? "") })
          .returning({ idBusca: schema.busca.idBusca })
      )[0]!.idBusca;

    const estoque = await db
      .select()
      .from(schema.imovel)
      .where(eq(schema.imovel.estadoAnuncio, "no_ar"));

    const historico = await db
      .select()
      .from(schema.logEvento)
      .where(
        and(
          eq(schema.logEvento.idEntidade, idCliente),
          eq(schema.logEvento.campo, "conversa"),
        ),
      )
      .orderBy(asc(schema.logEvento.timestamp))
      .limit(50);

    return {
      idCliente,
      idBusca,
      canal: String(e.payload?.canal ?? "desconhecido"),
      historico: historico.map((h) => h.valorNovo ?? "").join("\n"),
      mensagem: String(e.payload?.mensagem ?? ""),
      estoque: estoque.map((i) => ({
        idImovel: i.idImovel,
        tipo: i.tipo,
        preco: num(i.preco),
        bairro: i.bairro,
        cidade: i.cidade,
        endereco: i.endereco,
        estadoAnuncio: i.estadoAnuncio,
        estadoComercial: i.estadoComercial,
      })),
    };
  },

  async responder(e, texto) {
    const [c] = await db
      .select({ telefone: schema.cliente.telefone })
      .from(schema.cliente)
      .where(eq(schema.cliente.idCliente, e.idCliente!));

    await enviarMensagem(decifrar(c?.telefone), texto);

    // O log fica independente do envio: é ele que alimenta o `historico` que o
    // Agente 4 lê no próximo turno. Canal fora do ar não apaga a conversa.
    await db.insert(schema.logEvento).values({
      agenteOrigem: "4_atendimento",
      entidade: "cliente",
      idEntidade: e.idCliente!,
      campo: "conversa",
      valorNovo: `agente: ${texto}`,
      idEvento: e.idEvento,
    });
  },

  portasCurador: {
    async publicar(idImovel) {
      const criados = await db
        .insert(schema.anuncio)
        .values(CANAIS.map((c) => ({ idImovel, canal: c.canal, midiaPaga: c.midiaPaga })))
        .returning({ idAnuncio: schema.anuncio.idAnuncio });
      return criados.map((a) => a.idAnuncio);
    },
  },

  portasRoteador: {
    async reservarAgenda({ idCorretor, idImovel, idCliente, slot }) {
      // O slot pode ter sumido entre a pontuação e a reserva. Quem diz é o
      // banco, não uma checagem otimista feita antes.
      const conflito = await db
        .select({ id: schema.agenda.idEvento })
        .from(schema.agenda)
        .where(
          and(
            eq(schema.agenda.idCorretor, idCorretor),
            lt(schema.agenda.inicio, slot.fim),
            gte(schema.agenda.fim, slot.inicio),
            ne(schema.agenda.status, "cancelado"),
          ),
        )
        .limit(1);
      if (conflito.length > 0) return { conflito: true as const };

      const [linha] = await db
        .insert(schema.agenda)
        .values({ idCorretor, idImovel, idCliente, inicio: slot.inicio, fim: slot.fim })
        .returning({ idEvento: schema.agenda.idEvento });
      return { idEvento: linha!.idEvento };
    },

    async renovarVinculo({ idCliente, idCorretor, agora }) {
      const [existente] = await db
        .select({ id: schema.vinculoLeadCorretor.id })
        .from(schema.vinculoLeadCorretor)
        .where(
          and(
            eq(schema.vinculoLeadCorretor.idCliente, idCliente),
            eq(schema.vinculoLeadCorretor.idCorretor, idCorretor),
          ),
        )
        .limit(1);

      if (existente) {
        await db
          .update(schema.vinculoLeadCorretor)
          .set({ ultimaInteracao: agora, ativo: true })
          .where(eq(schema.vinculoLeadCorretor.id, existente.id));
        return;
      }

      // Carteira híbrida: vínculo novo desativa o antigo. Com dois donos, a
      // janela de 30 dias perde o sentido.
      await db
        .update(schema.vinculoLeadCorretor)
        .set({ ativo: false })
        .where(eq(schema.vinculoLeadCorretor.idCliente, idCliente));

      await db
        .insert(schema.vinculoLeadCorretor)
        .values({ idCliente, idCorretor, ultimaInteracao: agora });
    },

    async notificarCorretor(n) {
      // Confirmação pós-aceite. A oferta em si sai em `ioDb.registrarPedido`,
      // que é onde a idempotência da R7 está garantida.
      const [c] = await db
        .select({ telefone: schema.corretor.telefone })
        .from(schema.corretor)
        .where(eq(schema.corretor.idCorretor, n.idCorretor));

      await enviarMensagem(
        decifrar(c?.telefone),
        `Fechado, o lead é seu: ${n.resumo} A visita já está reservada na sua agenda.`,
      );
    },
  },

  portasAlterador: portasAlteradorDb,
};
