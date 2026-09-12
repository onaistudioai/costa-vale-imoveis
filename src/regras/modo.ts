/**
 * Quem autoriza cada coisa que o sistema escreve.
 *
 * Os três modos, e a diferença entre eles não é grau de confiança — é quem
 * segura a decisão:
 *
 *  - **hitl** (human in the loop) — o sistema PARA e não anda sem gente. No
 *    grafo isso é literal: `interrupt()` congela e o estado vai pro Postgres.
 *  - **hotl** (human on the loop) — o sistema AGE e alguém supervisiona. Só
 *    vale chamar assim quando dá pra **ver** o que foi feito; sem isso é hootl
 *    com nome bonito.
 *  - **hootl** (human out of the loop) — o sistema age e ninguém revisa. É
 *    legítimo para o que é determinístico e reversível. O que não é legítimo é
 *    chegar aqui por esquecimento.
 *
 * Esta tabela existe porque, até ela, nenhuma das ações automáticas do sistema
 * tinha modo *decidido* — elas apenas não passavam por aprovação, que é coisa
 * diferente. O `porque` ser obrigatório é o ponto: declarar que algo roda
 * sozinho custa escrever a razão ao lado.
 *
 * O padrão não é novo aqui — `origemVinculoIdentidade` (src/lib/db/schema.ts)
 * já declara quem autorizou cada vínculo de identidade, e diz que a origem
 * probabilística "NUNCA entra sozinha". Isto é a mesma ideia, para tudo.
 *
 * Nada aqui muda comportamento. É classificação, e é o que a tela de
 * `/automatico` usa para separar o que precisa de olho do que não precisa.
 */

import { CAMPOS_EDITAVEIS } from "./alteracao";

export type Modo = "hitl" | "hotl" | "hootl";

export interface Declaracao {
  modo: Modo;
  porque: string;
}

export const MODO = {
  // --- HITL: o sistema para e espera ---

  "imovel.estadoAnuncio": {
    modo: "hitl",
    porque:
      "Subir anúncio é gate N2. `podePublicar` exige aprovação registrada — nenhuma faixa dispensa.",
  },
  "cliente.fusao": {
    modo: "hitl",
    porque:
      "Juntar dois cadastros mistura a negociação de um cliente com a de outro. Só acontece com alguém confirmando.",
  },
  "atendimento.desfecho": {
    modo: "hitl",
    porque: "Fechar um caso exige motivo escrito por gente — é o que paga o relatório de perdas.",
  },

  // --- HOTL: age, e dá pra ver e refazer ---

  "imovel.estadoOperacional": {
    modo: "hotl",
    porque:
      "Derivado das pendências do laudo por regra determinística. Um laudo novo recalcula, e o log mostra a mudança.",
  },
  "imovel.estadoComercial": {
    modo: "hotl",
    porque:
      "Muda ANTES da aprovação de propósito: o Agente 4 precisa parar de oferecer o imóvel na hora. A aprovação trava o gasto de mídia, nunca a proteção do lead.",
  },
  "imovel.preco": {
    modo: "hotl",
    porque:
      "Vem de número extraído de laudo por modelo. É o mais arriscado desta faixa — erro de casa decimal vai pro anúncio. Reversível e logado, mas ninguém é avisado.",
  },
  transacao: {
    modo: "hotl",
    porque: "A etapa vem da leitura do documento; documento novo corrige, e o log guarda a anterior.",
  },
  anuncio: {
    modo: "hotl",
    porque: "Anúncio orgânico cai sozinho quando o imóvel sai de disponível. Mídia paga é que espera gente.",
  },
  agenda: {
    modo: "hotl",
    porque: "Reservado depois do aceite do corretor. O horário existe no cadastro e pode ser cancelado.",
  },
  vinculoLeadCorretor: {
    modo: "hotl",
    porque:
      "Trocar o dono do lead tem consequência de comissão. Acontece por rodízio determinístico, e fica no log.",
  },
  atendimento: {
    modo: "hotl",
    porque: "Avança a etapa do funil. Só avança, nunca retrocede — `etapaMaxima` guarda o mais fundo.",
  },
  "atendimento.reabertura": {
    modo: "hotl",
    porque:
      "Cliente que volta a falar reabre o caso e apaga o motivo do desfecho. O motivo vai pro log ANTES de sumir, senão o relatório de perdas perde a linha pra sempre.",
  },
  conversa: {
    modo: "hotl",
    porque:
      "Resposta ao cliente sai do modelo, mas o que é crítico (documentação, agendamento, fora do assunto) sai de código fixo. Mensagem enviada não volta.",
  },

  "atendimento.estado": {
    modo: "hotl",
    porque:
      "O ciclo de tempo reavalia o funil a cada minuto. Só a virada de estado entra no log — prioridade recalculada é ruído, e tela ruidosa não é lida.",
  },
  "parcela.atrasada": {
    modo: "hotl",
    porque:
      "Marcar alguém como inadimplente é consequência real. O valor é recalculado toda passada, então erro de configuração se corrige — mas precisa aparecer.",
  },
  "parcela.cobranca": {
    modo: "hotl",
    porque:
      "Cobrar dinheiro é o que este sistema faz de mais sério sozinho, e mensagem enviada não volta. O estágio só sobe, então cobrança errada pula a etapa certa.",
  },

  // --- HOOTL: roda sem ninguém, e está certo assim ---

  laudo: {
    modo: "hootl",
    porque: "Guardar o que o modelo extraiu ao lado do texto original. É o registro que torna o erro auditável.",
  },
  busca: {
    modo: "hootl",
    porque: "Os critérios que o cliente disse querer. Errar só faz o match sugerir imóvel fora do perfil.",
  },
  papel: {
    modo: "hootl",
    porque: "Marcar alguém como lead. Papel é acumulativo — a mesma pessoa pode ser proprietária e compradora.",
  },
  "identidade.reconhecida": {
    modo: "hootl",
    porque:
      "Exige mesmo CPF ou um canal já registrado naquele cliente. É consulta de chave, não palpite de modelo — o palpite vira pedido de fusão e sobe pra gente.",
  },
  "cliente.criado": {
    modo: "hootl",
    porque:
      "Duplicata é reversível com um clique; lead sem resposta não volta. Criar na hora e conferir depois é a troca certa.",
  },
  // Grava `expirou.<tipo do pedido>` — um campo por tipo, por isso a chave é o
  // prefixo e `declaracaoDe` resolve.
  // Grava `decisao.<tipo do pedido>` com `aprovadoPor` preenchido: é o registro
  // do clique de quem decidiu.
  decisao: {
    modo: "hitl",
    porque:
      "É a própria decisão humana na fila do painel. Existe para dizer quem decidiu e quando — não há o que o sistema faça sozinho aqui.",
  },
  // Grava `<entidade>.<campo>` para cada campo de CAMPOS_EDITAVEIS, sempre com
  // `aprovadoPor` preenchido.
  alteracao: {
    modo: "hitl",
    porque:
      "Correção de cadastro pedida em texto: o agente só traduz o pedido em \"de → para\", e nada muda até uma pessoa ler e confirmar.",
  },
  expirou: {
    modo: "hotl",
    porque:
      "Prazo de pedido esgotado vira recusa, e o fluxo segue (a oferta passa ao próximo corretor). É relógio, não julgamento — e quem ninguém aceitou sobe pra gente como escalação.",
  },
} satisfies Record<string, Declaracao>;

/**
 * Os campos que têm modo declarado.
 *
 * O `satisfies` acima preserva as chaves literais, e é isso que faz este tipo
 * valer: quem grava log pelos helpers tipados não consegue inventar um campo
 * sem passar por aqui — vira erro de compilação, não observação de revisão.
 * A varredura de fonte em `modo.test.ts` cobre o resto, onde o campo é escrito
 * direto num objeto literal.
 */
export type CampoDeLog = keyof typeof MODO;

/** O que o sistema roda sem ninguém revisando. É a lista que alguém precisa varrer. */
export const semRevisao = (campo: string): boolean => declaracaoDe(campo)?.modo === "hootl";

export const declaracaoDe = (campo: string): Declaracao | undefined =>
  (MODO as Record<string, Declaracao>)[campo] ??
  (campo.startsWith("expirou.") ? MODO.expirou : undefined) ??
  (campo.startsWith("decisao.") ? MODO.decisao : undefined) ??
  (ALTERAVEIS.has(campo) ? MODO.alteracao : undefined);

/** Os `<entidade>.<campo>` que o fluxo de alteração grava, derivados da regra. */
const ALTERAVEIS = new Set(
  Object.entries(CAMPOS_EDITAVEIS).map(([c, d]) => `${d.entidade}.${c}`),
);

export const ROTULO_MODO: Record<Modo, string> = {
  hitl: "Esperou você",
  hotl: "Fez e avisou",
  hootl: "Fez sozinho",
};
