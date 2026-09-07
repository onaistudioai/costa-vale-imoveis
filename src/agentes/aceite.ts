import { z } from "zod";
import type { Extrator } from "./modelo";

/**
 * O que o corretor quis dizer.
 *
 * A oferta que ele recebe pede "responde aqui se puder pegar" — e gente não
 * responde com palavra-chave. Responde "pego", "tô indo", "hoje não dá", "tô em
 * outra visita", "passa pro Bruno". Exigir que ele escreva SIM é exigir que ele
 * decore um comando, e ninguém decora comando no meio do trânsito.
 *
 * A regra que segura tudo: **dúvida não vira decisão.** Aceitar por engano tira
 * o lead de quem ia atender de verdade; recusar por engano manda o cliente pro
 * segundo colocado sem motivo. Nos dois casos o certo é perguntar.
 */

export const RespostaDoCorretor = z.object({
  decisao: z
    .enum(["aceita", "recusa", "indefinido"])
    .describe("indefinido quando a frase não resolve claramente entre pegar e não pegar"),
  motivo: z
    .string()
    .nullable()
    .describe("o que ele deu como razão, nas palavras dele, quando recusa"),
  /** Quando ele indica outra pessoa: vira observação pro painel, nunca alocação. */
  indicouOutro: z
    .string()
    .nullable()
    .describe("nome de outro corretor que ele sugeriu, se sugeriu algum"),
});

export type RespostaDoCorretor = z.infer<typeof RespostaDoCorretor>;

export const SISTEMA_ACEITE = `Você lê a resposta de um corretor de imóveis a uma oferta de atendimento que acabou de receber por mensagem, em português do Brasil.

A pergunta que ele respondeu foi, em essência: "quer pegar este lead?"

Marque "aceita" quando ele assume o atendimento: "pego", "pode mandar", "tô indo", "esse é meu", "deixa comigo", "já ligo pra ele".
Marque "recusa" quando ele não vai pegar: "hoje não consigo", "tô em outra visita", "passa pro próximo", "não é minha região", "tô de folga".
Marque "indefinido" para qualquer coisa que não resolva entre as duas: pergunta sobre o imóvel, pedido de mais informação, frase ambígua, mensagem sobre outro assunto.

Na dúvida, "indefinido". Nunca chute entre aceitar e recusar — as duas decisões tiram o lead de alguém.`;

/** Uma leitura, sem efeito nenhum. Quem decide o que fazer é quem chama. */
export const interpretarResposta = (texto: string, extrair: Extrator) =>
  extrair({ schema: RespostaDoCorretor, sistema: SISTEMA_ACEITE, entrada: texto });

/** As respostas que o sistema devolve ao corretor, fixas em código. */
export const FALA = {
  aceitou: (imovel: string) =>
    `Fechado, o atendimento é seu. ${imovel} — os dados do cliente estão no painel.`,
  recusou: "Beleza, passo pro próximo. Obrigado por avisar rápido.",
  tardeDemais: "Esse já foi pra outro corretor — respondeu primeiro. Te aviso no próximo.",
  semOferta: "Não tem nenhum lead esperando você agora. Quando chegar, eu te chamo aqui.",
  naoEntendi:
    "Não consegui entender se você vai pegar ou não. Me responde com pego ou não dá, que eu registro.",
} as const;
