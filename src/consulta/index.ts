import { z } from "zod";
import type { Extrator } from "@/agentes/modelo";
import * as r from "./relatorios";

/**
 * O agente de consulta — o quinto, e o único que a equipe aciona de propósito.
 *
 * Os outros quatro são **reativos**: acordam quando um fato acontece (chegou
 * laudo, mudou negociação, chegou mensagem). Este é **puxado**: alguém
 * pergunta. Foi a categoria inteira que faltava — relatório, análise de
 * campanha, de vendas, de estoque, resumo de imóvel — e que não tinha por onde
 * entrar.
 *
 * Ele é o mais seguro dos cinco por construção:
 *  - conexão **somente leitura** (papel `consulta` no Postgres, só SELECT);
 *  - **não escreve, não decide, não dispara nada** — nenhum evento sai daqui;
 *  - **o número nunca vem do modelo**: a consulta é determinística, e o modelo
 *    só escolhe qual rodar e depois redige o texto em cima das linhas reais.
 *
 * O risco que sobra é o modelo redigir mal, não o sistema fazer besteira.
 */

export const Intencao = z.object({
  relatorio: z
    .enum(["estoque", "campanhas", "vendas", "leads", "equipe", "imovel"])
    .describe("qual relatório responde a pergunta"),
  dias: z
    .number()
    .nullable()
    .describe("janela em dias, quando a pergunta citar período. Padrão do relatório se null"),
  termoDoImovel: z
    .string()
    .nullable()
    .describe("endereço ou bairro citado, só quando o relatório for 'imovel'"),
});

export type Intencao = z.infer<typeof Intencao>;

const SISTEMA_CLASSIFICAR = `Você recebe uma pergunta da equipe de uma imobiliária e escolhe qual relatório responde.

- estoque: quantos imóveis existem, em que situação, o que está parado, o que está pronto e não anunciado.
- campanhas: anúncios, mídia paga, quanto está sendo gasto, o que está no ar.
- vendas: negociações, propostas, fechamentos, valores, comissão.
- leads: quantos clientes entraram, por qual canal, quantas visitas saíram, onde o funil vaza.
- equipe: desempenho dos corretores — quem aceita lead, quem deixa o prazo vencer.
- imovel: perguntas sobre UM imóvel específico, citado por endereço ou bairro.

Se a pergunta citar um período ("neste mês", "últimos 15 dias"), converta para dias.
Se citar um imóvel por endereço ou bairro, coloque o texto em termoDoImovel.`;

const SISTEMA_REDIGIR = `Você escreve a resposta para a equipe de uma imobiliária, em português do Brasil.

Regras:
- Use SOMENTE os números que estão nos dados recebidos. Nunca estime, nunca arredonde para "cerca de", nunca invente um número que não está lá.
- Se os dados não respondem a pergunta, diga isso em uma frase. Não preencha o buraco.
- Comece pela resposta, não por preâmbulo. Sem "com base nos dados fornecidos".
- Valores em reais no formato R$ 1.234,56. Seja direto e curto: 2 a 5 frases, ou uma lista curta.
- Se algum dado indicar dinheiro sendo queimado ou imóvel parado, diga isso mesmo que não tenha sido perguntado.`;

export const Resposta = z.object({
  texto: z.string().describe("a resposta para a equipe"),
  alerta: z
    .string()
    .nullable()
    .describe("um problema que os dados revelam e ninguém perguntou. null se não houver"),
});

export type Resposta = z.infer<typeof Resposta>;

export interface SaidaConsulta {
  relatorio: r.Relatorio;
  intencao: Intencao;
  /** As linhas cruas que geraram o texto. Ficam junto pra resposta ser conferível. */
  dados: unknown;
  texto: string;
  alerta: string | null;
}

async function rodar(i: Intencao): Promise<unknown> {
  switch (i.relatorio) {
    case "estoque":
      return r.estoque();
    case "campanhas":
      return r.campanhas();
    case "vendas":
      return r.vendas(i.dias ?? 90);
    case "leads":
      return r.leads(i.dias ?? 30);
    case "equipe":
      return r.equipe(i.dias ?? 30);
    case "imovel": {
      if (!i.termoDoImovel) return { erro: "nenhum imóvel citado na pergunta" };
      const achados = await r.acharImovel(i.termoDoImovel);
      if (achados.length === 0) return { erro: `nenhum imóvel bate com "${i.termoDoImovel}"` };
      // Mais de um bate: devolve a lista em vez de escolher por conta própria.
      if (achados.length > 1) return { ambiguo: achados };
      return r.imovel(achados[0]!.idImovel);
    }
  }
}

export async function consultar(
  pergunta: string,
  extrair: Extrator,
): Promise<SaidaConsulta> {
  const intencao = await extrair({
    schema: Intencao,
    sistema: SISTEMA_CLASSIFICAR,
    entrada: pergunta,
  });

  const dados = await rodar(intencao);

  const resposta = await extrair({
    schema: Resposta,
    sistema: SISTEMA_REDIGIR,
    entrada: `PERGUNTA:\n${pergunta}\n\nDADOS (relatório "${intencao.relatorio}"):\n${JSON.stringify(
      dados,
      null,
      1,
    )}`,
  });

  return {
    relatorio: intencao.relatorio,
    intencao,
    dados,
    texto: resposta.texto,
    alerta: resposta.alerta,
  };
}
