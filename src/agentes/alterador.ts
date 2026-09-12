import { z } from "zod";
import type { AgenteContexto } from "./contrato";
import type { Extrator } from "./modelo";
import { classificar } from "@/regras/faixa";
import {
  avaliarAlteracao,
  descreverAlteracao,
  CAMPOS_EDITAVEIS,
  type Alteracao,
  type CampoEditavel,
} from "@/regras/alteracao";

/**
 * Agente 6 — Alterador de Cadastro.
 *
 * O que ele resolve: hoje mudar um preço, corrigir um endereço que a extração
 * leu errado ou trocar o telefone de um cliente exige alguém que saiba mexer
 * no banco. Isso trava a operação num gargalo técnico pra tarefas que são de
 * secretaria.
 *
 * O que o torna diferente dos outros quatro: **ele não é dono de nenhum
 * campo.** Na tabela de propriedade da R5 a linha dele é `never` — não existe
 * escrita que ele consiga construir. Ele interpreta o pedido, encontra o
 * registro, mostra o "de → para" e a escrita sai com a assinatura de quem
 * confirmou.
 *
 * Não é burocracia por precaução. É que as duas coisas que ele faz — entender
 * texto ambíguo e escolher entre registros parecidos — são exatamente onde um
 * modelo erra com confiança. Confirmar o "de → para" custa um clique e é a
 * única coisa que impede "muda o preço do Campolim" de mudar o apartamento
 * errado.
 */

export const PedidoAlteracao = z.object({
  entidade: z
    .enum(["imovel", "cliente"])
    .describe("o que a pessoa quer alterar: um imóvel ou um cliente"),
  descricaoAlvo: z
    .string()
    .describe(
      "como a pessoa se referiu ao registro, com as palavras dela: 'apartamento do Campolim', 'a Ana do Jardim América'",
    ),
  campo: z
    .string()
    .describe(
      `o campo a alterar. Um destes, exatamente: ${Object.keys(CAMPOS_EDITAVEIS).join(", ")}`,
    ),
  valorNovo: z
    .string()
    .describe(
      "o valor novo, já normalizado. Para preço, só dígitos em reais: 'oitocentos e vinte mil' vira '820000'",
    ),
  confianca: z
    .enum(["alta", "baixa"])
    .describe("baixa quando o pedido é ambíguo sobre o registro, o campo ou o valor"),
});

export type PedidoAlteracao = z.infer<typeof PedidoAlteracao>;

const SISTEMA = `Você lê pedidos de alteração de cadastro de uma imobiliária, escritos em português do Brasil por gente da equipe, em linguagem informal.

Sua tarefa é APENAS traduzir o pedido em campos estruturados. Você não decide se a alteração deve acontecer.

Regras:
- "muda", "corrige", "atualiza", "põe", "troca" são todos pedidos de alteração.
- Preço em português vira número puro em reais: "820 mil" = "820000", "1,2 milhão" = "1200000", "R$ 415.000" = "415000".
- Quando a pessoa disser só "820" falando de preço de imóvel, entenda como 820000 e marque confiança baixa.
- Se o pedido não disser claramente QUAL registro, marque confiança baixa. Não escolha por conta própria.
- Se o campo pedido não estiver na lista permitida, devolva o nome que a pessoa usou mesmo assim — quem recusa é a regra, não você.
- Nunca invente um valor que o texto não trouxe.`;

/** Um candidato a ser o registro que a pessoa quis dizer. */
export interface Candidato {
  id: string;
  /** Como mostrar pra pessoa escolher: "Apto — Av. Gisele Constantino, 780, Campolim". */
  rotulo: string;
  valorAtual: string | null;
  anuncioNoAr?: boolean;
  emNegociacao?: boolean;
}

export interface PortasAlterador {
  /** Busca determinística pelo texto da pessoa. Pode devolver 0, 1 ou N. */
  procurar(
    entidade: "imovel" | "cliente",
    termo: string,
    campo: string,
  ): Promise<Candidato[]>;
  /**
   * Aplica a alteração. Assinada por quem confirmou — o log sai como escrita
   * de humano, não de agente, porque foi decisão de gente.
   */
  aplicar(a: Alteracao, por: string, idEvento: string): Promise<void>;
}

export type Resultado =
  | { desfecho: "aplicada"; descricao: string; idEntidade: string }
  | { desfecho: "recusada"; motivo: string }
  | { desfecho: "ambigua"; candidatos: Candidato[]; pergunta: string }
  | { desfecho: "nao_encontrado"; termo: string };

export async function alterar(
  ctx: AgenteContexto<"6_alterador">,
  texto: string,
  extrair: Extrator,
  portas: PortasAlterador,
): Promise<Resultado> {
  const pedido = await extrair({
    schema: PedidoAlteracao,
    sistema: SISTEMA,
    entrada: texto,
  });

  const candidatos = await portas.procurar(
    pedido.entidade,
    pedido.descricaoAlvo,
    pedido.campo,
  );

  if (candidatos.length === 0) {
    return { desfecho: "nao_encontrado", termo: pedido.descricaoAlvo };
  }

  // Dois imóveis no Campolim é o caso normal, não a exceção. Escolher o
  // primeiro seria alterar o registro errado com toda a confiança do mundo.
  if (candidatos.length > 1) {
    return {
      desfecho: "ambigua",
      candidatos,
      pergunta: `Encontrei ${candidatos.length} registros que batem com "${pedido.descricaoAlvo}". Qual deles?`,
    };
  }

  const alvo = candidatos[0]!;
  const alteracao: Alteracao = {
    entidade: pedido.entidade,
    idEntidade: alvo.id,
    campo: pedido.campo as CampoEditavel,
    valorAnterior: alvo.valorAtual,
    valorNovo: pedido.valorNovo,
  };

  const veredito = avaliarAlteracao(alteracao, {
    anuncioNoAr: alvo.anuncioNoAr,
    emNegociacao: alvo.emNegociacao,
  });

  if (!veredito.ok) return { desfecho: "recusada", motivo: veredito.motivo };

  const descricao = descreverAlteracao(alteracao);

  // Confiança baixa do modelo não recusa nem aplica: entra na confirmação
  // como aviso. Quem lê o "de → para" resolve em dois segundos o que o modelo
  // não conseguiu resolver com o texto que recebeu.
  //
  // `avaliarAlteracao` já classificou o risco (preço de anúncio no ar, salto de
  // unidade, imóvel em negociação). A faixa herda esse trabalho em vez de
  // refazê-lo com outro critério.
  //
  // Este agente não passa pela mesa, e não por esquecimento: a confiança dele
  // só tem "alta" e "baixa", e o risco só "baixo" e "alto" — nenhuma combinação
  // cai em amarela. Faz sentido que seja assim. O que decide aqui é ler o
  // "de → para", e isso um olho humano resolve mais rápido e melhor do que três
  // chamadas de modelo deliberando.
  const faixa = classificar({
    confianca: pedido.confianca,
    risco: veredito.risco,
  });

  const decisao = await ctx.pedirAprovacao({
    tipo: "aplicar_alteracao",
    entidade: pedido.entidade,
    idEntidade: alvo.id,
    contexto: {
      registro: alvo.rotulo,
      mudanca: descricao,
      risco: veredito.risco,
      observacao: veredito.motivo,
      pedidoOriginal: texto,
      leituraIncerta: pedido.confianca === "baixa",
    },
    faixa,
  });

  if (!decisao.aprovado) {
    return { desfecho: "recusada", motivo: decisao.motivo ?? "não confirmado" };
  }

  await portas.aplicar(alteracao, decisao.por, ctx.idEvento);
  return { desfecho: "aplicada", descricao, idEntidade: alvo.id };
}
