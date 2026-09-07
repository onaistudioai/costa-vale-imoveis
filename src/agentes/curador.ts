import { z } from "zod";
import type { AgenteContexto } from "./contrato";
import type { Extrator } from "./modelo";
import type { EstadoComercial, EstadoOperacional } from "@/tipos";

/**
 * Agente 1 — Curador de Estoque.
 *
 * Reativo, N3 (PROJECT_SPEC seção 10). Duas ações dele são N2, sempre
 * assistidas: subir anúncio e liberar imóvel reprovado.
 *
 * O modelo entra só na extração — decidir o estado a partir das pendências é
 * regra, e está aqui embaixo em código, não no prompt. Isso é o que torna o
 * comportamento testável sem chamar API.
 */

export const Pendencia = z.object({
  descricao: z.string().describe("o que exatamente falta, nas palavras do laudo"),
  categoria: z.enum(["limpeza", "reforma", "documentacao", "outro"]),
  resolvida: z.boolean().describe("true só se o laudo afirma que foi concluído"),
  obrigatoria: z
    .boolean()
    .describe(
      "true se impede anunciar o imóvel. Documentação é sempre obrigatória; acabamento estético normalmente não.",
    ),
});

export const ExtracaoLaudo = z.object({
  pendencias: z.array(Pendencia),
  precoMencionado: z
    .number()
    .nullable()
    .describe("novo preço, só se o laudo declarar um valor explícito"),
  confianca: z
    .enum(["alta", "media", "baixa"])
    .describe("baixa quando o texto é ambíguo sobre o que ficou pronto"),
  resumo: z.string().describe("uma frase para a equipe, em português"),
});

export type ExtracaoLaudo = z.infer<typeof ExtracaoLaudo>;

const SISTEMA = `Você lê laudos de vistoria de imóveis escritos por vendedores em campo, em português do Brasil.

Extraia as pendências mencionadas. Regras:
- Uma pendência só é "resolvida" se o texto afirma que foi concluída. Promessa, previsão ou intenção NÃO é resolução.
- Frases como "só falta X" descrevem uma pendência ABERTA, mesmo quando o restante está pronto.
- Documentação é sempre obrigatória. Entulho, limpeza pesada e reforma estrutural também impedem anunciar.
- Acabamento estético e melhorias opcionais não são obrigatórios.
- Se o texto for ambíguo sobre o que ficou pronto, marque confiança baixa. Não preencha lacuna com suposição.`;

export interface Laudo {
  idLaudo: string;
  idImovel: string;
  textoEstado?: string;
  textoDocumentacao?: string;
  textoPendencias?: string;
}

export interface EstadoImovel {
  idImovel: string;
  estadoOperacional: EstadoOperacional;
  estadoComercial: EstadoComercial;
}

export interface SaidaCurador {
  extracao: ExtracaoLaudo;
  novoEstadoOperacional: EstadoOperacional;
  pediuAprovacaoParaAnunciar: boolean;
  anunciosCriados: string[];
}

export interface PortasCurador {
  /** Cria um registro em `anuncio` por canal. Sem isto o Fluxo A para no passo 6. */
  publicar(idImovel: string): Promise<string[]>;
}

/**
 * Decide o estado operacional a partir das pendências. Determinístico: mesma
 * extração, mesmo estado. O modelo não escolhe o estado — ele só lê o texto.
 */
export function decidirEstado(
  atual: EstadoOperacional,
  e: ExtracaoLaudo,
): EstadoOperacional {
  // Reprovado só sai por decisão humana (seção 3). Nenhum laudo otimista
  // reabre um imóvel que uma pessoa travou de propósito.
  if (atual === "reprovado") return "reprovado";

  // Confiança baixa nunca libera. Na dúvida o agente segura e escala.
  if (e.confianca === "baixa") return "com_pendencia";

  const abertasObrigatorias = e.pendencias.filter((p) => p.obrigatoria && !p.resolvida);
  if (abertasObrigatorias.length > 0) return "com_pendencia";

  const abertasOpcionais = e.pendencias.filter((p) => !p.resolvida);
  return abertasOpcionais.length > 0 ? "em_preparacao" : "pronto";
}

export async function curar(
  ctx: AgenteContexto<"1_curador">,
  laudo: Laudo,
  imovel: EstadoImovel,
  extrair: Extrator,
  portas: PortasCurador = { publicar: async () => [] },
): Promise<SaidaCurador> {
  const entrada = [
    laudo.textoEstado && `ESTADO DA CASA:\n${laudo.textoEstado}`,
    laudo.textoDocumentacao && `DOCUMENTAÇÃO:\n${laudo.textoDocumentacao}`,
    laudo.textoPendencias && `PENDÊNCIAS:\n${laudo.textoPendencias}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const extracao = await extrair({ schema: ExtracaoLaudo, sistema: SISTEMA, entrada });

  // O par texto original / extração fica guardado lado a lado. É o que torna o
  // erro do agente auditável e corrigível (seção 6).
  await ctx.escrever({
    campo: "laudo",
    idEntidade: laudo.idLaudo,
    valorNovo: JSON.stringify(extracao),
  });

  const novo = decidirEstado(imovel.estadoOperacional, extracao);
  if (novo !== imovel.estadoOperacional) {
    await ctx.escrever({
      campo: "imovel.estadoOperacional",
      idEntidade: imovel.idImovel,
      valorAnterior: imovel.estadoOperacional,
      valorNovo: novo,
    });
  }

  if (extracao.precoMencionado !== null) {
    await ctx.escrever({
      campo: "imovel.preco",
      idEntidade: imovel.idImovel,
      valorNovo: String(extracao.precoMencionado),
    });
  }

  // Gate N2. O limite do Agente 1: mesmo com tudo pronto, imóvel em
  // negociação não vai pro ar — o estado comercial é do Agente 2.
  const podeIrPraFila = novo === "pronto" && imovel.estadoComercial === "disponivel";
  let anunciosCriados: string[] = [];

  if (podeIrPraFila) {
    const decisao = await ctx.pedirAprovacao({
      tipo: "subir_anuncio",
      entidade: "imovel",
      idEntidade: imovel.idImovel,
      contexto: { resumo: extracao.resumo, confianca: extracao.confianca },
    });
    if (decisao.aprovado) {
      // Ordem importa: o imóvel precisa estar `no_ar` antes de existir linha em
      // `anuncio`, senão o CHECK do banco recusa a inserção.
      await ctx.escrever({
        campo: "imovel.estadoAnuncio",
        idEntidade: imovel.idImovel,
        valorAnterior: "sem_anuncio",
        valorNovo: "no_ar",
      });
      anunciosCriados = await portas.publicar(imovel.idImovel);
      for (const id of anunciosCriados) {
        await ctx.escrever({ campo: "anuncio", idEntidade: id, valorNovo: "no_ar" });
      }
    }
  }

  await ctx.avisar(extracao.resumo);

  return {
    extracao,
    novoEstadoOperacional: novo,
    pediuAprovacaoParaAnunciar: podeIrPraFila,
    anunciosCriados,
  };
}
