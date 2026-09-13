import { z } from "zod";
import { casarComEstoque, type ImovelOfertavel } from "@/regras/match";
import type { AgenteContexto } from "./contrato";
import type { Extrator } from "./modelo";
import { classificar } from "@/regras/faixa";
import { revisarSePreciso } from "@/mesa";

/**
 * Agente 4 — Atendimento 24/7 e Qualificação.
 *
 * Deliberativo, N3 (PROJECT_SPEC seção 10). Única porta de entrada, e é ele
 * quem casa o que o cliente quer com o estoque — o contexto que o match
 * precisa (o histórico inteiro, incluindo o que o cliente descartou e por quê)
 * já está na mão dele.
 *
 * Os três limites da seção 4 não são pedidos ao modelo, são código:
 *  - não agenda: nunca escreve em `agenda`; entrega ao Agente 3 pela aresta.
 *  - não fala preço de imóvel em negociação: `casarComEstoque` filtra estado
 *    antes de qualquer coisa, mesmo que o chamador passe estoque sujo.
 *  - não promete documentação: pergunta sobre documento nunca é respondida
 *    pelo modelo; vira escalação.
 *
 * N3 na prática: caso fora do padrão vai pro painel, NÃO pro Agente 3. É esta
 * bifurcação que separa N3 de N4.
 */

export const ExtracaoConversa = z.object({
  resposta: z
    .string()
    .describe("o que responder ao cliente agora, em português do Brasil, tom direto"),
  criterios: z.object({
    valorMin: z.number().nullable(),
    valorMax: z.number().nullable(),
    tipoImovel: z.string().nullable().describe("casa, apartamento, terreno, sala..."),
    bairrosDesejados: z.array(z.string()),
  }),
  intencaoDeVisita: z
    .boolean()
    .describe("true quando o cliente pede pra ver um imóvel ou falar com corretor"),
  imovelDeInteresse: z
    .string()
    .nullable()
    .describe("id do imóvel sobre o qual ele demonstrou interesse concreto"),
  perguntouSobreDocumentacao: z
    .boolean()
    .describe("true se pediu garantia sobre matrícula, certidão, escritura ou financiamento"),
  foraDoPadrao: z
    .boolean()
    .describe(
      "true para permuta, litígio, reclamação, proposta atípica ou qualquer coisa que um roteiro normal não cobre",
    ),
  foraDoAssunto: z
    .boolean()
    .describe(
      "true quando a mensagem não é sobre imóvel: outro ramo de negócio, número errado, spam, assunto pessoal",
    ),
  resumo: z.string().describe("uma frase de contexto para o corretor que receber este lead"),
});

export type ExtracaoConversa = z.infer<typeof ExtracaoConversa>;

/**
 * Exportado porque a aferição (`scripts/aferir.ts`) precisa rodar exatamente
 * este texto — aferir um prompt parecido não afere nada. É o único motivo.
 */
export const SISTEMA = `Você atende clientes de uma imobiliária por mensagem, em português do Brasil. Tom direto e humano, sem formalidade excessiva.

Você PODE: responder dúvidas sobre os imóveis da lista que recebeu, entender o que a pessoa procura, e encaminhar para um corretor.

Você NÃO PODE, em nenhuma hipótese:
- marcar visita, confirmar horário ou dizer que agendou. Quem agenda é o corretor. Você diz que vai encaminhar.
- falar de imóvel que não está na lista que você recebeu. Se perguntarem de outro, diga que vai verificar.
- afirmar qualquer coisa sobre documentação, matrícula, certidão, escritura ou financiamento. Marque perguntouSobreDocumentacao e diga que vai confirmar com a equipe.

Marque foraDoPadrao para permuta, litígio, reclamação, proposta atípica ou qualquer situação que fuja do atendimento comum.
Marque foraDoAssunto quando a mensagem não for sobre imóvel: outro ramo de negócio, número errado, spam ou assunto pessoal. Pergunta vaga ("oi", "tem algo bom?") NÃO é fora do assunto — é cliente começando a conversa. Na dúvida, deixe falso: calar um cliente de verdade é pior que responder a um engano.
Marque intencaoDeVisita só quando houver interesse concreto em ver um imóvel específico, não curiosidade genérica.`;

/**
 * Resposta de mensagem fora do assunto. Fixa em código pelo mesmo motivo do
 * aviso de documentação: o que a imobiliária faz e não faz não é coisa que o
 * modelo decide na hora — é o jeito mais fácil de ele prometer um serviço que
 * a empresa não presta.
 */
const FORA_DO_ASSUNTO =
  "Aqui eu só consigo ajudar com imóveis — compra, aluguel e visita. Se for sobre isso, me conta o que você procura que eu ajudo.";

/** Como um imóvel é citado numa pergunta ao cliente: o que o distingue. */
const citar = (i: ImovelOfertavel) =>
  [i.endereco, i.bairro, i.preco !== null ? `R$ ${i.preco.toLocaleString("pt-BR")}` : null]
    .filter(Boolean)
    .join(" · ");

/**
 * A pergunta que substitui a promessa.
 *
 * O Agente 6 já resolve ambiguidade assim há tempo — "encontrei 2 registros,
 * qual deles?" — e não havia motivo pro 4 fazer diferente com o cliente.
 */
function perguntarQual(candidatos: ImovelOfertavel[]): string {
  if (candidatos.length === 0) {
    return "Não tenho nada com esse perfil disponível agora. Me diz o que é essencial pra você (bairro, valor, quantos quartos) que eu procuro e te aviso.";
  }
  if (candidatos.length === 1) {
    return `Antes de eu chamar o corretor, confirma pra mim: é o ${citar(candidatos[0]!)}?`;
  }
  const lista = candidatos.slice(0, 4).map((c) => `- ${citar(c)}`).join("\n");
  return `Tenho ${candidatos.length} que batem com o que você falou:\n${lista}\n\nQual deles?`;
}

const AVISO_DOCUMENTACAO =
  "Sobre a documentação eu prefiro não afirmar nada por mensagem — vou confirmar com a equipe e te retorno.";

export interface EntradaAtendimento {
  idCliente: string;
  idBusca: string;
  canal: string;
  historico: string;
  mensagem: string;
  /** Estoque bruto. `casarComEstoque` filtra o que não pode ser oferecido. */
  estoque: ImovelOfertavel[];
}

export type SaidaAtendimento = {
  resposta: string;
  candidatos: string[];
  /** Preenchido só quando qualifica: é o payload do handoff pro Agente 3 (R4). */
  leadQualificado?: { idCliente: string; idImovel: string; resumo: string };
  escalacao?: { motivo: string };
};

export async function atender(
  ctx: AgenteContexto<"4_atendimento">,
  entrada: EntradaAtendimento,
  extrair: Extrator,
): Promise<SaidaAtendimento> {
  const ofertavel = entrada.estoque.filter(
    (i) => i.estadoAnuncio === "no_ar" && i.estadoComercial === "disponivel",
  );

  const catalogo = ofertavel
    .map(
      (i) =>
        `- ${i.idImovel} | ${i.tipo} | ${i.bairro ?? "sem bairro"} | ${
          i.preco !== null ? `R$ ${i.preco}` : "preço a confirmar"
        }`,
    )
    .join("\n");

  const extracao = await extrair({
    schema: ExtracaoConversa,
    sistema: SISTEMA,
    entrada: `IMÓVEIS DISPONÍVEIS (só estes existem para você):\n${
      catalogo || "(nenhum no momento)"
    }\n\nCONVERSA ATÉ AGORA:\n${entrada.historico}\n\nMENSAGEM NOVA:\n${entrada.mensagem}`,
  });

  // Mensagem fora do assunto sai aqui, ANTES de qualquer escrita: número
  // errado, spam e pergunta de outro ramo não podem virar `busca` vazia nem
  // `papel: lead`. Sem este desvio, o funil enche de gente que nunca quis
  // comprar nada — e aí a fila ordenada por urgência perde o sentido.
  //
  // A precedência é deliberada: `foraDoPadrao` vence quando os dois vêm
  // marcados. Proposta atípica de cliente real vale mais que o silêncio, e
  // escalar demais custa menos que calar alguém.
  if (extracao.foraDoAssunto && !extracao.foraDoPadrao) {
    return { resposta: FORA_DO_ASSUNTO, candidatos: [] };
  }

  const candidatos = casarComEstoque(extracao.criterios, entrada.estoque);

  await ctx.escrever({
    campo: "busca",
    idEntidade: entrada.idBusca,
    valorNovo: JSON.stringify({ ...extracao.criterios, textoOriginal: entrada.mensagem }),
  });

  await ctx.escrever({
    campo: "papel",
    idEntidade: entrada.idCliente,
    valorNovo: "lead",
  });

  let resposta = extracao.resposta;

  // Limite 3, em código: promessa sobre documentação nunca sai do modelo.
  if (extracao.perguntouSobreDocumentacao) {
    resposta = `${resposta}\n\n${AVISO_DOCUMENTACAO}`;
  }

  // Comportamento N3: fora do padrão fala com humano diretamente, EM VEZ DE
  // acionar outro agente. Nada de handoff pro Agente 3 aqui.
  if (extracao.foraDoPadrao) {
    // Amarela, e este é o caso que mais justifica a mesa existir: permuta,
    // litígio ou proposta atípica não são leitura ruim — o modelo entendeu
    // bem, só não sabe o que fazer. Nada foi escrito, nada custa dinheiro, e
    // ainda assim precisa de julgamento. É exatamente o meio-termo que antes
    // caía na fila sem ninguém ter pensado no caso.
    const faixa = classificar({ confianca: "media" });

    await ctx.pedirAprovacao({
      tipo: "escalacao_n3",
      entidade: "cliente",
      idEntidade: entrada.idCliente,
      contexto: {
        motivo: "conversa_fora_do_padrao",
        canal: entrada.canal,
        resumo: extracao.resumo,
        mensagem: entrada.mensagem,
      },
      faixa,
      proposta: await revisarSePreciso(faixa, {
        assunto: "Conversa de cliente fora do padrão de atendimento",
        fatos: [
          `Canal: ${entrada.canal}.`,
          `O que o cliente escreveu: "${entrada.mensagem}"`,
          `Leitura do atendimento: ${extracao.resumo}`,
        ].join("\n"),
      }),
    });
    return { resposta, candidatos: candidatos.map((c) => c.idImovel), escalacao: { motivo: "conversa_fora_do_padrao" } };
  }

  // Qualificação: interesse concreto num imóvel que de fato pode ser oferecido.
  const alvo =
    extracao.imovelDeInteresse &&
    candidatos.some((c) => c.idImovel === extracao.imovelDeInteresse)
      ? extracao.imovelDeInteresse
      : null;

  // Quer visitar, mas não dá pra saber o quê.
  //
  // É aqui que nasce o pior defeito que este agente pode ter, e ele é
  // invisível: o modelo escreve "vou encaminhar ao corretor", o sistema não
  // encaminha nada (sem imóvel identificado não há handoff), e ninguém fica
  // sabendo — não gera linha na fila, não gera erro, não gera alerta. Só gera
  // um cliente esperando uma ligação que não vem.
  //
  // A defesa é a mesma dos outros limites: **a resposta sai de código.** Se o
  // sistema não vai agir, o modelo não pode dizer que agiu.
  if (extracao.intencaoDeVisita && !alvo) {
    return { resposta: perguntarQual(candidatos), candidatos: candidatos.map((c) => c.idImovel) };
  }

  if (extracao.intencaoDeVisita && alvo) {
    // O funil sobe aqui, e não na recepção: qualificar é o que aconteceu de
    // fato nesta conversa. `etapaMaxima` guarda isso pra sempre — se a pessoa
    // sumir depois, ela reaparece na fila como quem já quis visitar, não como
    // quem só perguntou o preço.
    await ctx.escrever({
      campo: "atendimento",
      idEntidade: entrada.idCliente,
      valorAnterior: "primeiro_contato",
      valorNovo: "qualificado",
    });

    return {
      resposta,
      candidatos: candidatos.map((c) => c.idImovel),
      leadQualificado: {
        idCliente: entrada.idCliente,
        idImovel: alvo,
        resumo: extracao.resumo,
      },
    };
  }

  return { resposta, candidatos: candidatos.map((c) => c.idImovel) };
}
