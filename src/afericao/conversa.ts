import type { ExtracaoConversa } from "@/agentes/atendimento";

/**
 * O conjunto de referência do Agente 4, e o único que mede o agente que fala
 * com gente de fora.
 *
 * Aqui a medida não é "acertou o assunto" — é **qual dos dois erros ele
 * cometeu**, porque eles custam coisas diferentes:
 *
 * - marcar fora do assunto uma mensagem que era de cliente **cala um cliente**.
 *   A pessoa recebe "só ajudo com imóveis" depois de perguntar sobre imóvel, e
 *   vai embora. Não há segunda chance e não fica registro de que houve lead.
 * - deixar passar uma mensagem que não era do assunto custa uma resposta boba e
 *   um cadastro a mais no funil. Chato, reversível, visível.
 *
 * Por isso o conjunto tem os dois lados: metade fora do assunto, metade dentro.
 * Um conjunto só com caso positivo não mede nada — mede se o modelo aprendeu a
 * dizer sim.
 */

export interface CasoConversa {
  id: string;
  /** O que este caso testa. Aparece no relatório quando ele falha. */
  porque: string;
  mensagem: string;
  esperado: {
    foraDoAssunto: boolean;
    /** `true` quando a mensagem é de cliente real mas atípica: tem que escalar. */
    escala?: boolean;
  };
}

export const CASOS_CONVERSA: CasoConversa[] = [
  {
    id: "seguro-de-carro",
    porque: "outro ramo de negócio",
    mensagem: "boa tarde, vocês fazem seguro de carro?",
    esperado: { foraDoAssunto: true },
  },
  {
    id: "iptu-do-carro",
    porque: "usa palavra do nosso mundo (IPTU) num assunto que não é nosso",
    mensagem: "preciso pagar o ipva e o iptu do meu carro, vocês resolvem isso?",
    esperado: { foraDoAssunto: true },
  },
  {
    id: "numero-errado",
    porque: "engano — o caso mais comum de todos num número de WhatsApp",
    mensagem: "é a pizzaria? queria uma calabresa grande",
    esperado: { foraDoAssunto: true },
  },
  {
    id: "spam-emprestimo",
    porque: "spam ativo, que costuma imitar tom comercial",
    mensagem:
      "OPORTUNIDADE! Empréstimo consignado com a menor taxa do mercado, responda SIM para simular",
    esperado: { foraDoAssunto: true },
  },
  {
    id: "aluga",
    porque: "locação é do nosso assunto — marcar aqui seria calar um cliente",
    mensagem: "vocês trabalham com aluguel também ou só venda?",
    esperado: { foraDoAssunto: false },
  },
  {
    id: "iptu-do-apartamento",
    porque: "mesma palavra do caso do carro, e aqui é pergunta legítima de comprador",
    mensagem: "quanto fica o iptu desse apartamento por ano?",
    esperado: { foraDoAssunto: false },
  },
  {
    id: "oi-vago",
    porque: "cliente começando a conversa não é fora do assunto, é conversa começando",
    mensagem: "oi, tudo bem? tem alguma coisa boa aí?",
    esperado: { foraDoAssunto: false },
  },
  {
    id: "permuta",
    porque: "atípico mas real: tem que escalar, não ser calado",
    mensagem: "queria dar meu carro como parte do pagamento, dá pra negociar assim?",
    esperado: { foraDoAssunto: false, escala: true },
  },
];

export interface ConferenciaConversa {
  id: string;
  porque: string;
  ok: boolean;
  foraDoAssunto: boolean;
  foraDoPadrao: boolean;
  /** Calou um cliente de verdade. O erro caro. */
  calouCliente: boolean;
  /** Deixou passar o que não era do assunto. Custa uma resposta boba. */
  deixouPassar: boolean;
  /** Era caso de escalar e não escalou. */
  naoEscalou: boolean;
}

export function conferirConversa(
  caso: CasoConversa,
  e: ExtracaoConversa,
): ConferenciaConversa {
  // A mesma precedência do agente: `foraDoPadrao` vence, então marcar os dois
  // numa permuta não é erro — o cliente escala e não é calado.
  const calou = e.foraDoAssunto && !e.foraDoPadrao && !caso.esperado.foraDoAssunto;
  const passou = !e.foraDoAssunto && caso.esperado.foraDoAssunto;
  const naoEscalou = Boolean(caso.esperado.escala) && !e.foraDoPadrao;

  return {
    id: caso.id,
    porque: caso.porque,
    ok: !calou && !passou && !naoEscalou,
    foraDoAssunto: e.foraDoAssunto,
    foraDoPadrao: e.foraDoPadrao,
    calouCliente: calou,
    deixouPassar: passou,
    naoEscalou,
  };
}

export const resumirConversa = (cs: ConferenciaConversa[]) => ({
  total: cs.length,
  ok: cs.filter((c) => c.ok).length,
  calouCliente: cs.filter((c) => c.calouCliente).map((c) => c.id),
  deixouPassar: cs.filter((c) => c.deixouPassar).map((c) => c.id),
  naoEscalou: cs.filter((c) => c.naoEscalou).map((c) => c.id),
});
