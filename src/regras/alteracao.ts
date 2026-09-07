/**
 * O que pode ser alterado por pedido em texto livre, e o que isso custa.
 *
 * O Agente 6 traduz "muda o preço do apartamento do Campolim pra 820" numa
 * mudança concreta. Duas coisas podem dar errado nesse caminho, e as duas
 * são caras:
 *
 * 1. **Entidade errada.** Existem dois apartamentos no Campolim. Escolher um
 *    sozinho é errar metade das vezes com total confiança.
 * 2. **Campo que não é dado, é máquina de estado.** `estadoOperacional` e
 *    `estadoComercial` não são preenchidos por opinião: são conclusão de
 *    laudo e de documento de negociação. Deixar alguém escrever "põe como
 *    pronto" por mensagem desmonta o Agente 1 e o Agente 2 de uma vez.
 *
 * A resposta pras duas é a mesma: este agente **não escreve por conta
 * própria**. Ele interpreta, mostra o "de → para", e a escrita acontece com a
 * assinatura de quem confirmou. É por isso que ele não tem campo nenhum na
 * tabela de propriedade da R5 — ele não é dono de nada.
 */

/** Campos que aceitam edição por pedido. Lista fechada, e curta de propósito. */
export const CAMPOS_EDITAVEIS = {
  preco: { rotulo: "Preço", tipo: "numero", entidade: "imovel" },
  endereco: { rotulo: "Endereço", tipo: "texto", entidade: "imovel" },
  bairro: { rotulo: "Bairro", tipo: "texto", entidade: "imovel" },
  tipo: { rotulo: "Tipo do imóvel", tipo: "texto", entidade: "imovel" },
  pontosReferencia: { rotulo: "Pontos de referência", tipo: "texto", entidade: "imovel" },
  telefone: { rotulo: "Telefone", tipo: "texto", entidade: "cliente" },
  email: { rotulo: "E-mail", tipo: "texto", entidade: "cliente" },
  nome: { rotulo: "Nome", tipo: "texto", entidade: "cliente" },
} as const;

export type CampoEditavel = keyof typeof CAMPOS_EDITAVEIS;

/**
 * Os campos que o pedido em texto NUNCA move, com a razão em cada um. A
 * mensagem existe porque "não pode" sem explicação vira insistência.
 */
export const CAMPOS_BLOQUEADOS: Record<string, string> = {
  estadoOperacional:
    "O estado operacional é conclusão do laudo, não escolha. Registre um laudo novo e o Curador reavalia.",
  estadoComercial:
    "O estado comercial vem do documento da negociação, lido pelo Guardião. Envie o documento.",
  estadoAnuncio:
    "O anúncio sobe e desce por regra (imóvel pronto e disponível) com aprovação da equipe no painel.",
  comissaoPercentual: "Comissão é contrato, não cadastro. Isso é alteração para a gestão fazer.",
  cpfCnpj: "CPF/CNPJ não muda por mensagem — é o que identifica a pessoa.",
};

export type Risco = "baixo" | "alto";

export interface Alteracao {
  entidade: "imovel" | "cliente";
  idEntidade: string;
  campo: CampoEditavel;
  valorAnterior: string | null;
  valorNovo: string;
}

export type Veredito =
  | { ok: true; risco: Risco; motivo: string }
  | { ok: false; motivo: string };

/**
 * Vale a pena alterar, e quanto isso pesa?
 *
 * `risco: alto` não bloqueia — muda o texto do pedido de confirmação, que
 * passa a mostrar a consequência ("o anúncio está no ar e o preço aparece
 * pros interessados"). O que bloqueia é campo fora da lista ou valor que não
 * faz sentido.
 */
export function avaliarAlteracao(
  a: Alteracao,
  contexto: { anuncioNoAr?: boolean; emNegociacao?: boolean } = {},
): Veredito {
  if (a.campo in CAMPOS_BLOQUEADOS) {
    return { ok: false, motivo: CAMPOS_BLOQUEADOS[a.campo]! };
  }
  if (!(a.campo in CAMPOS_EDITAVEIS)) {
    return { ok: false, motivo: `Não sei alterar "${a.campo}".` };
  }

  const def = CAMPOS_EDITAVEIS[a.campo];
  if (def.entidade !== a.entidade) {
    return { ok: false, motivo: `"${def.rotulo}" não é campo de ${a.entidade}.` };
  }

  if (!a.valorNovo.trim()) {
    return { ok: false, motivo: "O valor novo veio vazio." };
  }

  if (a.valorAnterior !== null && a.valorAnterior.trim() === a.valorNovo.trim()) {
    return { ok: false, motivo: "O valor novo é igual ao atual — nada a fazer." };
  }

  if (def.tipo === "numero") {
    const n = Number(a.valorNovo);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, motivo: `"${a.valorNovo}" não é um valor válido.` };
    }
    const antes = Number(a.valorAnterior ?? 0);
    // Salto grande costuma ser erro de unidade — "820" quando se quis dizer
    // "820.000". Não recusa (às vezes é correção mesmo), mas sobe o risco pra
    // pessoa ver o número por extenso antes de confirmar.
    if (antes > 0 && (n > antes * 3 || n < antes / 3)) {
      return {
        ok: true,
        risco: "alto",
        motivo: `Mudança grande de valor (${fmt(antes)} → ${fmt(n)}). Confira se a unidade está certa.`,
      };
    }
  }

  if (a.campo === "preco" && contexto.anuncioNoAr) {
    return {
      ok: true,
      risco: "alto",
      motivo: "O anúncio está no ar: o preço muda para quem está vendo agora.",
    };
  }
  if (contexto.emNegociacao) {
    return {
      ok: true,
      risco: "alto",
      motivo: "O imóvel está em negociação — mudar o cadastro agora afeta uma conversa em andamento.",
    };
  }

  return { ok: true, risco: "baixo", motivo: "Alteração simples de cadastro." };
}

/** Frase do "de → para" que aparece na confirmação. Sem nome de coluna. */
export function descreverAlteracao(a: Alteracao): string {
  const def = CAMPOS_EDITAVEIS[a.campo];
  const antes = a.valorAnterior?.trim() || "vazio";
  const depois = a.valorNovo.trim();
  if (def?.tipo === "numero") {
    return `${def.rotulo}: ${fmt(Number(antes) || 0)} → ${fmt(Number(depois))}`;
  }
  return `${def?.rotulo ?? a.campo}: "${antes}" → "${depois}"`;
}

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
