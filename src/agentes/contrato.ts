import type { Agente, TipoAprovacao } from "@/tipos";
import type { Faixa } from "@/regras/faixa";
import type { Consolidado } from "@/mesa";

/**
 * R5 — escrita só no que é seu.
 *
 * A tabela de propriedade de dado da seção 5 do PROJECT_SPEC, em tipos. Cada
 * agente recebe um contexto que só aceita os campos dele; escrever fora do
 * próprio domínio não compila. Violação vira erro de tipo, não observação de
 * code review.
 */
export interface CamposDe {
  "1_curador":
    | "imovel.estadoOperacional"
    | "imovel.preco"
    | "imovel.estadoAnuncio"
    | "anuncio"
    | "laudo";
  "2_guardiao": "imovel.estadoComercial" | "transacao";
  "3_roteador": "agenda" | "vinculoLeadCorretor";
  "4_atendimento": "cliente" | "busca" | "papel" | "atendimento" | "identidade";
  /**
   * O Agente 6 não é dono de campo nenhum, e `never` é essa frase em tipo:
   * `Escrita<"6_alterador">` não tem valor possível, então ele literalmente
   * não consegue chamar `escrever`. Ele propõe; quem escreve é o humano que
   * confirmou, pela porta `aplicar`.
   */
  "6_alterador": never;
}

export interface Escrita<A extends Agente> {
  campo: CamposDe[A];
  idEntidade: string;
  valorAnterior?: string | null;
  valorNovo: string | null;
}

export interface PedidoAprovacao {
  tipo: TipoAprovacao;
  entidade: string;
  idEntidade: string;
  /** O que a equipe precisa saber pra decidir — custo em risco, motivo, resumo. */
  contexto: Record<string, unknown>;
  /**
   * Quanto o pedido pesa (ver `src/regras/faixa.ts`). Decide a ordem na fila,
   * se a mesa opina antes, e se alguém é avisado fora do painel — nunca se
   * existe humano. Ausente vale verde, que é o comportamento de antes.
   */
  faixa?: Faixa;
  /**
   * O que a mesa levantou, quando a faixa amarela a acionou. É leitura pro
   * humano — o painel mostra como sugestão, e nada no sistema a aplica sozinho.
   */
  proposta?: Consolidado;
  /**
   * Para quem o pedido é endereçado, quando não é a equipe. Hoje só a oferta
   * de lead usa: o corretor da vez. Nos gates N2 fica vazio.
   */
  destinatario?: string;
  /** Minutos até o pedido expirar sozinho. Sem isso, espera pra sempre. */
  prazoMin?: number;
  /** Mensagem a disparar no canal do destinatário quando o pedido é criado. */
  mensagem?: string;
}

/**
 * A única superfície que um agente tem contra o mundo. Ele lê à vontade,
 * escreve só no que é dele, e o que não é dele ele pede.
 */
export interface AgenteContexto<A extends Agente> {
  readonly agente: A;
  /** Id do evento que acordou este agente — carrega a idempotência da R6. */
  readonly idEvento: string;

  /** Escreve e registra em log_evento na mesma operação. Não há como escrever sem log. */
  escrever(e: Escrita<A>): Promise<void>;

  /**
   * Pausa o grafo e devolve a decisão humana quando ela chegar.
   * Usado tanto pelos gates N2 quanto pela escalação N3 — a diferença está no
   * `tipo` do pedido, não no mecanismo.
   */
  pedirAprovacao(p: PedidoAprovacao): Promise<{ aprovado: boolean; por: string; motivo?: string }>;

  /** Aviso à equipe que não bloqueia o fluxo. */
  avisar(mensagem: string): Promise<void>;
}
