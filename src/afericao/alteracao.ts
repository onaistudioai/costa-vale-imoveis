import type { PedidoAlteracao } from "@/agentes/alterador";

/**
 * O conjunto de referência do Agente 6.
 *
 * Aqui não há regra depois do modelo que decida estado: o que ele lê vira o
 * "de → para" que a pessoa confirma. Então o rótulo é a própria leitura —
 * campo e valor.
 *
 * O erro caro é **errar o valor com confiança alta**: é o que passa batido na
 * confirmação, porque nada na tela avisa que a leitura foi incerta. Errar com
 * confiança baixa chega marcado, e a pessoa corrige.
 */

export interface CasoAlteracao {
  id: string;
  porque: string;
  texto: string;
  esperado: Pick<PedidoAlteracao, "entidade" | "campo" | "valorNovo">;
}

export const CASOS_ALTERACAO: CasoAlteracao[] = [
  {
    id: "preco-por-extenso",
    porque: "preço por extenso vira número em reais",
    texto: "muda o preço do apartamento do Campolim pra oitocentos e vinte mil",
    esperado: { entidade: "imovel", campo: "preco", valorNovo: "820000" },
  },
  {
    id: "milhao-com-virgula",
    porque: "vírgula decimal em milhão é a armadilha clássica",
    texto: "a casa do Éden agora é 1,2 milhão",
    esperado: { entidade: "imovel", campo: "preco", valorNovo: "1200000" },
  },
  {
    id: "telefone-cliente",
    porque: "o alvo é cliente, não imóvel",
    texto: "atualiza o telefone da Ana do Jardim América: 15 99812-4455",
    esperado: { entidade: "cliente", campo: "telefone", valorNovo: "15 99812-4455" },
  },
  {
    id: "bairro",
    porque: "correção de endereço lido errado vai no campo certo",
    texto: "o sobrado da rua das Flores não é no Trujillo, é no Vergueiro, corrige o bairro",
    esperado: { entidade: "imovel", campo: "bairro", valorNovo: "Vergueiro" },
  },
];

export interface ConferenciaAlteracao {
  id: string;
  porque: string;
  ok: boolean;
  lido: string;
  esperado: string;
  /** Errou e disse que tinha certeza. Passa batido na confirmação. */
  erradoComCerteza: boolean;
}

/** Só dígitos no preço; o resto compara sem caixa e sem espaço nas pontas. */
const normal = (campo: string, v: string) =>
  campo === "preco" ? v.replace(/\D/g, "") : v.trim().toLowerCase();

export function conferirAlteracao(caso: CasoAlteracao, p: PedidoAlteracao): ConferenciaAlteracao {
  const e = caso.esperado;
  const ok =
    p.entidade === e.entidade &&
    p.campo === e.campo &&
    normal(e.campo, p.valorNovo) === normal(e.campo, e.valorNovo);
  return {
    id: caso.id,
    porque: caso.porque,
    ok,
    lido: `${p.entidade}.${p.campo} = ${p.valorNovo}`,
    esperado: `${e.entidade}.${e.campo} = ${e.valorNovo}`,
    erradoComCerteza: !ok && p.confianca === "alta",
  };
}
