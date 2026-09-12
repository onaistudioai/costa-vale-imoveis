import { z } from "zod";
import { derrubarAnuncio } from "@/regras/publicacao";
import type { AgenteContexto } from "./contrato";
import { classificar } from "@/regras/faixa";
import { revisarSePreciso } from "@/mesa";
import type { Extrator } from "./modelo";
import type { Anuncio, EstadoComercial } from "@/tipos";

/**
 * Agente 2 — Guardião da Negociação.
 *
 * Deliberativo, N3 (PROJECT_SPEC seção 10). É o mais sofisticado dos quatro e
 * o que mais depende de humano — dinheiro em jogo. Detecta a etapa, consulta
 * anúncios, calcula o custo e avisa a pessoa certa sobre a consequência.
 *
 * Fonte única de verdade sobre `estadoComercial`. Nenhum outro agente escreve
 * nesse campo.
 */

export const ExtracaoNegociacao = z.object({
  etapa: z
    .enum([
      "proposta_feita",
      "proposta_aceita",
      "documentacao_em_analise",
      "assinada",
      "desistencia",
    ])
    .describe("em que ponto a negociação está, segundo o documento"),
  valorProposto: z.number().nullable(),
  confianca: z.enum(["alta", "media", "baixa"]),
  resumo: z.string().describe("uma frase para a equipe, em português"),
});

export type ExtracaoNegociacao = z.infer<typeof ExtracaoNegociacao>;

const SISTEMA = `Você lê documentos de negociação imobiliária em português do Brasil (propostas, contraproposta, e-mails, anotações de corretor).

Identifique a etapa em que a negociação está. Regras:
- "proposta_feita": houve oferta, mas ninguém aceitou ainda.
- "proposta_aceita": o vendedor aceitou o valor. Aceite verbal conta.
- "documentacao_em_analise": aceite já ocorreu e agora se analisa certidão, financiamento ou contrato.
- "assinada": contrato assinado pelas partes.
- "desistencia": alguma parte desistiu ou a negociação caiu.
- Na dúvida entre duas etapas, escolha a MAIS ATRASADA e marque confiança baixa. Avançar etapa por engano derruba anúncio de imóvel que ainda está à venda.`;

/** A etapa manda no estado comercial. Determinístico, sem modelo. */
export function estadoPorEtapa(etapa: ExtracaoNegociacao["etapa"]): EstadoComercial {
  switch (etapa) {
    case "proposta_feita":
    case "proposta_aceita":
      return "em_negociacao";
    case "documentacao_em_analise":
      return "em_processo_venda";
    case "assinada":
      return "fechado";
    case "desistencia":
      return "disponivel";
  }
}

export interface SaidaGuardiao {
  extracao: ExtracaoNegociacao;
  novoEstadoComercial: EstadoComercial;
  anunciosPausados: string[];
  midiaAguardandoAprovacao: string[];
  custoEmRisco: number;
}

export async function guardar(
  ctx: AgenteContexto<"2_guardiao">,
  entrada: {
    idImovel: string;
    idTransacao: string;
    estadoComercialAtual: EstadoComercial;
    documento: string;
    anuncios: Anuncio[];
  },
  extrair: Extrator,
): Promise<SaidaGuardiao> {
  const extracao = await extrair({
    schema: ExtracaoNegociacao,
    sistema: SISTEMA,
    entrada: entrada.documento,
  });

  const novo = estadoPorEtapa(extracao.etapa);

  await ctx.escrever({
    campo: "transacao",
    idEntidade: entrada.idTransacao,
    valorNovo: extracao.etapa,
  });

  // O corte acontece AQUI, na mudança de estado — não depois da aprovação.
  // Anúncio no ar ainda gera mensagem por horas depois de pausado, então o
  // Agente 4 precisa parar de oferecer o imóvel antes de qualquer humano
  // clicar. A aprovação trava só o gasto de mídia, nunca a proteção do lead.
  if (novo !== entrada.estadoComercialAtual) {
    await ctx.escrever({
      campo: "imovel.estadoComercial",
      idEntidade: entrada.idImovel,
      valorAnterior: entrada.estadoComercialAtual,
      valorNovo: novo,
    });
  }

  const efeito = derrubarAnuncio({ estadoComercial: novo }, entrada.anuncios);

  // Gate N2: mídia paga só para com confirmação humana. Ele sinaliza, a regra
  // derruba — ele não derruba sozinho.
  if (efeito.exigemAprovacao.length > 0) {
    const contexto = {
      etapa: extracao.etapa,
      custoEmRisco: efeito.custoEmRisco,
      canais: efeito.exigemAprovacao.map((a) => a.canal),
      resumo: extracao.resumo,
    };
    // Derrubar mídia paga não desfaz: o dinheiro do dia já saiu. Por isso entra
    // como irreversível, e acima do teto de custo nem a mesa opina.
    const faixa = classificar({
      confianca: extracao.confianca,
      custoEmRisco: efeito.custoEmRisco,
      reversivel: false,
    });

    await ctx.pedirAprovacao({
      tipo: "derrubar_midia",
      entidade: "imovel",
      idEntidade: entrada.idImovel,
      contexto,
      faixa,
      proposta: await revisarSePreciso(faixa, extrair, {
        assunto: `Derrubar mídia paga do imóvel ${entrada.idImovel}`,
        fatos: [
          `Negociação foi para: ${extracao.etapa}.`,
          `Estado comercial muda de ${entrada.estadoComercialAtual} para ${novo}.`,
          `Mídia paga rodando em: ${contexto.canais.join(", ")}.`,
          `Já gastos: R$ ${efeito.custoEmRisco.toFixed(2)}.`,
          `Leitura do documento: ${extracao.resumo}`,
        ].join("\n"),
      }),
    });
  }

  // Confiança baixa numa mudança de estado comercial é escalação: o erro aqui
  // derruba anúncio de imóvel que ainda está à venda.
  if (extracao.confianca === "baixa" && novo !== entrada.estadoComercialAtual) {
    await ctx.pedirAprovacao({
      tipo: "escalacao_n3",
      entidade: "transacao",
      idEntidade: entrada.idTransacao,
      contexto: { motivo: "etapa_ambigua", etapa: extracao.etapa, resumo: extracao.resumo },
      // Confiança baixa é vermelha por definição: mandar a mesa raciocinar em
      // cima de uma leitura ruim só produz confiança falsa.
      faixa: classificar({ confianca: extracao.confianca }),
    });
  }

  await ctx.avisar(
    efeito.exigemAprovacao.length > 0
      ? `${extracao.resumo} Tem mídia paga rodando em ${efeito.exigemAprovacao
          .map((a) => a.canal)
          .join(" e ")}, R$ ${efeito.custoEmRisco.toFixed(2)} gastos. Confirma que derrubo?`
      : extracao.resumo,
  );

  return {
    extracao,
    novoEstadoComercial: novo,
    anunciosPausados: efeito.pausarAgora.map((a) => a.idAnuncio),
    midiaAguardandoAprovacao: efeito.exigemAprovacao.map((a) => a.idAnuncio),
    custoEmRisco: efeito.custoEmRisco,
  };
}
