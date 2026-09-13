import type { Caso } from "./casos";

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
