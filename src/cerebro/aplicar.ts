import type { Extrator } from "@/agentes/modelo";
import type { NotaRow } from "./schema";

/**
 * Como o cérebro chega no agente — e, principalmente, como ele **não** chega.
 *
 * O que sai daqui é texto anexado ao prompt, sempre marcado como observação da
 * equipe. Nunca um valor de campo, nunca um número que o sistema repita como
 * fato. Uma nota pode fazer o agente perguntar melhor; não pode fazer o
 * sistema dizer que o apartamento custa outra coisa.
 *
 * O aviso no cabeçalho não é decoração: ele é a regra escrita onde o modelo
 * lê. Sem essa frase, uma nota mal escrita ("o Campolim tá em 820 mil") vira
 * um número na boca do agente.
 */

const CABECALHO = `
OBSERVAÇÕES DA EQUIPE (não são dados do sistema)
Isto é o que a equipe entendeu com a operação, não é cadastro. Serve para
orientar o seu jeito de ler e de perguntar. Se qualquer observação abaixo
contradisser um dado que veio do sistema, o dado do sistema vence e a
observação é ignorada. Nunca repita um número daqui como se fosse cadastro.`;

/**
 * Teto de quanto o cérebro pode falar dentro de um prompt.
 *
 * Sem teto, o acúmulo de notas vira a maior parte da instrução e o prompt
 * original — que é o que está aferido — passa a ser minoria. Notas fixadas
 * entram primeiro; o corte cai sobre as confirmadas mais novas.
 */
export const TETO_CARACTERES = 1200;

export function dicasDe(notas: NotaRow[]): string[] {
  const ordenadas = [...notas].sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "fixada" ? -1 : 1;
    return a.criadaEm.getTime() - b.criadaEm.getTime();
  });

  const saida: string[] = [];
  let usado = 0;
  for (const n of ordenadas) {
    const linha = n.texto.trim();
    if (!linha) continue;
    if (usado + linha.length > TETO_CARACTERES) break;
    usado += linha.length;
    saida.push(linha);
  }
  return saida;
}

/** O prompt com as observações anexadas. Sem notas, devolve o original intacto. */
export function comDicas(sistema: string, notas: NotaRow[]): string {
  const dicas = dicasDe(notas);
  if (dicas.length === 0) return sistema;
  return `${sistema}\n${CABECALHO}\n${dicas.map((d) => `- ${d}`).join("\n")}`;
}

/**
 * O envelope do cérebro, irmão do de procedência.
 *
 * A ordem de montagem importa e é o motivo de os dois serem separados: o
 * cérebro fica **por fora** da procedência, para que o hash registrado seja o
 * do prompt que o modelo realmente recebeu — com as notas dentro. Assim, ligar
 * ou desligar uma nota aparece como versão nova de prompt na aferição, que é
 * exatamente a pergunta que se quer responder: a nota ajudou?
 */
export function comCerebro(base: Extrator, notas: NotaRow[]): Extrator {
  if (notas.length === 0) return base;
  return ((args: Parameters<Extrator>[0]) =>
    base({ ...args, sistema: comDicas(args.sistema, notas) })) as Extrator;
}
