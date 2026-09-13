import type { PedidoAlteracao } from "@/agentes/alterador";
import { estadoPorEtapa, type ExtracaoNegociacao } from "@/agentes/guardiao";
import type { CasoAlteracao } from "./alteracao";
import type { Caso } from "./casos";
import type { CasoNegociacao } from "./negociacao";

/**
 * Leitura negada no painel → rascunho de caso de referência.
 *
 * Rascunho, não caso: a negativa diz que o imóvel não podia subir, não diz o
 * estado certo. O palpite é `com_pendencia` — o único que trava o anúncio sem
 * precisar de reprovação — e quem cola em `casos.ts` confere antes.
 */
export interface LeituraNegada {
  idLeitura: string;
  entrada: string;
  saida: unknown;
  motivo: string | null;
}

const CABECALHOS = {
  "ESTADO DA CASA:": "textoEstado",
  "DOCUMENTAÇÃO:": "textoDocumentacao",
  "PENDÊNCIAS:": "textoPendencias",
} as const;

/** O inverso da montagem de `entrada` em `curar()`. */
export function laudoDaEntrada(entrada: string): Caso["laudo"] {
  const laudo: Caso["laudo"] = {};
  for (const bloco of entrada.split("\n\n")) {
    const [cabecalho, ...resto] = bloco.split("\n");
    const campo = CABECALHOS[cabecalho as keyof typeof CABECALHOS];
    // ponytail: parágrafo em branco dentro de um campo emenda no anterior
    if (campo) laudo[campo] = resto.join("\n");
    else {
      const ultimo = Object.keys(laudo).pop() as keyof Caso["laudo"] | undefined;
      if (ultimo) laudo[ultimo] += `\n\n${bloco}`;
    }
  }
  return laudo;
}

/**
 * Guardião: o documento é a entrada inteira. A negativa não diz o estado certo,
 * então o rascunho copia o que o modelo leu e o `porque` pede conferência —
 * quem cola sem ler cola o erro.
 */
export function proporNegociacao(
  l: LeituraNegada,
  existentes: CasoNegociacao[],
): CasoNegociacao | null {
  if (existentes.some((c) => c.documento === l.entrada)) return null;
  const etapa = (l.saida as { etapa?: ExtracaoNegociacao["etapa"] } | null)?.etapa;
  return {
    id: `painel-${l.idLeitura.slice(0, 8)}`,
    porque: `CONFIRA o estado — o modelo leu "${etapa ?? "?"}" e foi negado: ${l.motivo ?? "(sem motivo)"}`,
    documento: l.entrada,
    esperado: { estado: etapa ? estadoPorEtapa(etapa) : "disponivel" },
  };
}

/** Alterador: o pedido é a entrada inteira. Mesmo aviso: o esperado é o lido. */
export function proporAlteracao(
  l: LeituraNegada,
  existentes: CasoAlteracao[],
): CasoAlteracao | null {
  if (existentes.some((c) => c.texto === l.entrada)) return null;
  const s = (l.saida ?? {}) as Partial<PedidoAlteracao>;
  return {
    id: `painel-${l.idLeitura.slice(0, 8)}`,
    porque: `CONFIRA campo e valor — foi negado: ${l.motivo ?? "(sem motivo)"}`,
    texto: l.entrada,
    esperado: {
      entidade: s.entidade ?? "imovel",
      campo: s.campo ?? "",
      valorNovo: s.valorNovo ?? "",
    },
  };
}

export function propor(l: LeituraNegada, existentes: Caso[]): Caso | null {
  const laudo = laudoDaEntrada(l.entrada);
  const mesmo = (c: Caso) =>
    c.laudo.textoEstado === laudo.textoEstado &&
    c.laudo.textoDocumentacao === laudo.textoDocumentacao &&
    c.laudo.textoPendencias === laudo.textoPendencias;
  if (existentes.some(mesmo)) return null;

  const preco = (l.saida as { precoMencionado?: number | null } | null)?.precoMencionado ?? null;
  return {
    id: `painel-${l.idLeitura.slice(0, 8)}`,
    porque: `negado no painel: ${l.motivo ?? "(sem motivo)"}`,
    laudo,
    esperado: { estado: "com_pendencia", preco },
  };
}
