import type { Dependencias, Mundo } from "../mundo";
import type { IoDoNo } from "../no";
import type { Extrator } from "@/agentes/modelo";
import type { Leitura } from "@/agentes/procedencia";
import type { Escrita, PedidoAprovacao } from "@/agentes/contrato";
import type { Agente, ConfigRoteamento } from "@/tipos";

/**
 * O mundo de teste. Mesmo grafo de produção, dependências trocadas — é o que
 * permite testar R1, R4 e R7 sem Postgres, sem chave de API e sem rede.
 */

const AGORA = new Date("2026-09-06T12:00:00Z");
const slot = (h: number) => ({
  inicio: new Date(AGORA.getTime() + h * 3_600_000),
  fim: new Date(AGORA.getTime() + (h + 1) * 3_600_000),
});

export const CONFIG_TESTE: ConfigRoteamento = {
  janelaVinculoDias: 30,
  horizonteAgendaHoras: 48,
  scoreMinimo: 40,
  prazoAceiteMin: 5,
  maxOfertas: 3,
  pesos: {
    captou: 100,
    jaVisitou: 60,
    conheceRegiao: 25,
    disponibilidadeImediata: 40,
    cargaBaixa: 15,
  },
};

export function mundoFalso(over: Partial<Mundo> = {}) {
  const publicados: string[] = [];
  const respostas: string[] = [];
  const notificados: string[] = [];
  const alterados: { campo: string; valorNovo: string; por: string }[] = [];

  const mundo: Mundo = {
    async carregarCurador(e) {
      return {
        laudo: { idLaudo: "l1", idImovel: e.idImovel!, textoEstado: "tudo pronto" },
        imovel: {
          idImovel: e.idImovel!,
          estadoOperacional: "em_preparacao",
          estadoComercial: "disponivel",
        },
      };
    },

    async carregarGuardiao(e) {
      return {
        idImovel: e.idImovel!,
        idTransacao: "t1",
        estadoComercialAtual: "disponivel",
        documento: "proposta aceita",
        anuncios: [
          {
            idAnuncio: "a1",
            idImovel: e.idImovel!,
            canal: "meta",
            status: "no_ar",
            midiaPaga: true,
            custoAcumulado: 340.5,
          },
        ],
      };
    },

    async carregarRoteador(_e, lead) {
      return {
        idCliente: lead.idCliente,
        idImovel: lead.idImovel,
        corretores: [{ idCorretor: "ana", ativo: true }],
        dominios: [{ idCorretor: "ana", idImovel: lead.idImovel, nivel: "captou" }],
        agendaLivre: { ana: [slot(3)] },
        carga: { ana: 1 },
        agora: AGORA,
        resumoDaConversa: lead.resumo,
        estadoComercialMudou: false,
      };
    },

    async carregarAtendimento(e) {
      return {
        idCliente: e.idCliente!,
        idBusca: "b1",
        canal: "whatsapp",
        historico: "",
        mensagem: String(e.payload?.mensagem ?? "quero ver a casa"),
        estoque: [
          {
            idImovel: "i1",
            tipo: "casa",
            preco: 390_000,
            bairro: "Centro",
            cidade: "Sorocaba",
            estadoAnuncio: "no_ar",
            estadoComercial: "disponivel",
          },
        ],
      };
    },

    async responder(_e, texto) {
      respostas.push(texto);
    },

    portasCurador: {
      async publicar(idImovel) {
        publicados.push(idImovel);
        return ["an-1"];
      },
    },

    portasRoteador: {
      async reservarAgenda() {
        return { idEvento: "ev-1" };
      },
      async renovarVinculo() {},
      async notificarCorretor(n) {
        notificados.push(n.idCorretor);
      },
    },

    portasAlterador: {
      // Um candidato só por padrão: o caso ambíguo é montado por quem testa
      // ambiguidade, não é o normal.
      async procurar(_entidade, termo) {
        return [
          {
            id: "im-1",
            rotulo: `Apartamento — ${termo}`,
            valorAtual: "500000",
          },
        ];
      },
      async aplicar(a, por) {
        alterados.push({ campo: a.campo, valorNovo: a.valorNovo, por });
      },
    },

    ...over,
  };

  const escritas: (Escrita<Agente> & { agente: Agente })[] = [];
  const pedidos: PedidoAprovacao[] = [];
  const avisos: string[] = [];

  const io: IoDoNo = {
    async escrever(agente, _idEvento, e) {
      escritas.push({ ...e, agente });
    },
    async registrarPedido(_agente, _idEvento, _threadId, p) {
      pedidos.push(p);
    },
    async avisar(_agente, m) {
      avisos.push(m);
    },
  };

  return {
    mundo,
    io,
    publicados,
    respostas,
    notificados,
    alterados,
    escritas,
    pedidos,
    avisos,
  };
}

/** Monta as dependências completas, contando quantas vezes o modelo foi chamado. */
export function depsFalsas(
  extracoes: unknown[],
  over: Partial<Mundo> = {},
): {
  deps: Dependencias;
  chamadasDoModelo: () => number;
  /** As linhas de procedência que a passada gerou. */
  leituras: Leitura[];
} & ReturnType<typeof mundoFalso> {
  const f = mundoFalso(over);
  let chamadas = 0;
  let i = 0;

  const extrator = Object.assign(
    (async () => {
      chamadas += 1;
      return extracoes[Math.min(i++, extracoes.length - 1)];
    }) as Extrator,
    { modelo: "modelo-de-teste", tarefa: "extracao" },
  );

  const leituras: Leitura[] = [];

  return {
    ...f,
    deps: {
      mundo: f.mundo,
      io: f.io,
      extrator,
      config: CONFIG_TESTE,
      registrarLeitura: async (l) => void leituras.push(l),
    },
    chamadasDoModelo: () => chamadas,
    leituras,
  };
}
