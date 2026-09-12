import type { PedidoAprovacao } from "@/agentes/contrato";
import type { Agente } from "@/tipos";
import { avisaNoCanal, passaPelaMesa, type Faixa } from "@/regras/faixa";
import { frase } from "@/mesa";
import { AGENTE, ROTULO } from "@/lib/painel";

/**
 * O que sai por fora do painel, e para onde.
 *
 * Dois canais com papéis diferentes, e não um canal com fallback:
 *  - **WhatsApp chama.** Uma frase, só no urgente. É raro de propósito — é por
 *    ser raro que ele é lido.
 *  - **E-mail guarda.** O caso trabalhado, com o que a mesa achou e o link.
 *    Fica pesquisável na caixa, em vez de virar garimpo no histórico do grupo.
 *
 * Este arquivo é a decisão, e é puro: sem banco, sem rede, sem relógio. Quem
 * dispara é `src/agentes/contexto-db.ts`. A separação não é arrumação — é o
 * que permite provar num teste de três linhas que a fala de um cliente não
 * vaza pro e-mail, sem precisar de banco nem de servidor de SMTP.
 */

/**
 * Quem abriu o pedido. Os cinco agentes, mais `regra` — os ciclos de tempo
 * também abrem pedido, e a inadimplência de 30 dias precisa chamar alguém do
 * mesmo jeito que um gate de agente precisa.
 */
export type Origem = Agente | "regra";

export interface Alerta {
  whatsapp?: string;
  email?: { assunto: string; corpo: string };
}

/**
 * Os campos do contexto que podem sair do sistema — **lista de permissão**.
 *
 * A direção importa e é o ponto todo. Numa lista de bloqueio, o dia em que um
 * agente ganhar um campo novo no contexto, ele vaza por omissão: ninguém
 * decidiu incluí-lo, ele só não estava na lista. Aqui, campo novo fica de fora
 * até alguém escrevê-lo aqui de propósito.
 *
 * Ficam de fora, e nenhum por esquecimento: `mensagem` e `pedidoOriginal` são
 * a fala de gente; `nomeCandidato` é nome; `resumo` é a frase que o modelo
 * escreveu sobre a conversa de um cliente — o campo mais útil da lista e o de
 * maior chance de carregar um nome junto. Quem precisa dele abre o painel, que
 * é onde existe login.
 */
const PERMITIDOS: Record<string, string> = {
  motivo: "Motivo",
  etapa: "Etapa da negociação",
  custoEmRisco: "Custo em risco",
  canais: "Canais com mídia paga",
  risco: "Risco apontado pela regra",
  observacao: "Observação da regra",
  registro: "Registro alvo",
  mudanca: "Mudança pedida",
  confianca: "Confiança da leitura",
  concorrentes: "Cadastros empatados",
  canal: "Canal de origem",
};

const dinheiro = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/** Uma linha do e-mail, já formatada. Devolve null quando o campo não veio. */
function linha(chave: string, valor: unknown): string | null {
  const rotulo = PERMITIDOS[chave];
  if (!rotulo || valor === null || valor === undefined || valor === "") return null;

  if (chave === "custoEmRisco") {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? `${rotulo}: ${dinheiro(n)}` : null;
  }
  if (chave === "motivo") {
    const m = nomeDoMotivo(valor);
    return m ? `${rotulo}: ${m}` : null;
  }
  if (Array.isArray(valor)) {
    return valor.length > 0 ? `${rotulo}: ${valor.join(", ")}` : null;
  }
  if (typeof valor === "object") return null;

  return `${rotulo}: ${String(valor).replace(/_/g, " ")}`;
}

/**
 * Os sete motivos de escalação, com nome de gente.
 *
 * Existe porque `escalacao_n3` é um rótulo só para sete situações diferentes, e
 * "Escalação" não se procura: daqui a três meses ninguém acha o caso de permuta
 * buscando por uma palavra que serve para todos. O motivo é o que distingue, e
 * é ele que vira assunto.
 */
const MOTIVO: Record<string, string> = {
  conversa_fora_do_padrao: "Conversa fora do padrão",
  etapa_ambigua: "Etapa da negociação ambígua",
  conflito_de_agenda: "Conflito de agenda",
  ninguem_aceitou: "Ninguém aceitou o lead",
  estado_comercial_mudou: "Imóvel saiu de disponível",
  sem_slot_no_horizonte: "Sem horário disponível",
  nenhum_corretor_acima_do_minimo: "Nenhum corretor com perfil",
};

/** Como o motivo aparece no texto: nomeado quando conhecido, legível quando não. */
function nomeDoMotivo(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  return MOTIVO[v] ?? v.replace(/_/g, " ");
}

/**
 * O nome do pedido. Para escalação usa o motivo, que é o que diferencia uma da
 * outra; para o resto, o rótulo do tipo já é específico.
 */
function nomeDoTipo(p: PedidoAprovacao): string {
  if (p.tipo === "escalacao_n3") {
    const m = nomeDoMotivo(p.contexto?.motivo);
    if (m) return m;
  }
  return ROTULO[p.tipo] ?? p.tipo;
}

/** A frase do WhatsApp. Curta por definição: ela chama, não explica. */
function textoCurto(agente: Origem, p: PedidoAprovacao): string {
  const custo = Number(p.contexto?.custoEmRisco ?? 0);
  const dinheiroEmRisco = custo > 0 ? ` (${dinheiro(custo)} em risco)` : "";
  // Em escalação o motivo já É o nome do pedido; repeti-lo seria dizer a mesma
  // coisa duas vezes numa frase que precisa caber numa notificação.
  const motivo =
    p.tipo !== "escalacao_n3" && nomeDoMotivo(p.contexto?.motivo)
      ? ` — ${nomeDoMotivo(p.contexto?.motivo)}`
      : "";

  return `[${AGENTE[agente] ?? agente}] Pedido urgente: ${nomeDoTipo(
    p,
  )}${motivo}${dinheiroEmRisco}. Abra o painel para decidir.`;
}

/**
 * O corpo do e-mail. É aqui que o caso fica trabalhado — e é este texto que
 * substitui o "rolar a conversa do grupo até achar".
 */
function textoLongo(agente: Origem, p: PedidoAprovacao, url?: string): string {
  const partes: string[] = [
    `${nomeDoTipo(p)} — pedido aberto pelo ${AGENTE[agente] ?? agente}.`,
    "",
  ];

  const detalhes = Object.keys(PERMITIDOS)
    // Em escalação o motivo já é o título; repetido logo abaixo, gasta a
    // primeira linha do caso dizendo o que a pessoa acabou de ler.
    .filter((c) => !(c === "motivo" && p.tipo === "escalacao_n3"))
    .map((c) => linha(c, p.contexto?.[c]))
    .filter((l): l is string => l !== null);

  if (detalhes.length > 0) partes.push("O CASO", ...detalhes.map((d) => `  ${d}`), "");

  // O maior ganho do e-mail: hoje este texto só existe dentro do painel, e
  // some junto com o pedido quando alguém decide.
  if (p.proposta) {
    partes.push(
      "O QUE A REVISÃO ACHOU",
      `  ${frase(p.proposta)}`,
      `  ${p.proposta.justificativa}`,
    );
    if (p.proposta.ressalva) partes.push(`  Ficou em aberto: ${p.proposta.ressalva}`);
    partes.push("  (sugestão de máquina — quem decide é você)", "");
  }

  partes.push(
    url ? `Decidir: ${url}` : "Abra o painel para decidir.",
    "",
    "O nome do cliente, o telefone e o que ele escreveu ficam no painel, não",
    "neste e-mail.",
  );

  return partes.join("\n");
}

/**
 * O assunto. Começa pelo peso e termina pela entidade, porque é assim que ele
 * serve de busca meses depois: "urgente mídia paga" acha o caso.
 */
function assuntoDe(p: PedidoAprovacao, faixa: Faixa): string {
  const marca = faixa === "vermelha" ? "[Urgente]" : "[Revisado]";
  return `${marca} ${nomeDoTipo(p)} — ${p.entidade} ${p.idEntidade.slice(0, 8)}`;
}

/**
 * Decide o que sai por qual canal.
 *
 * Vermelha chama e guarda; amarela só guarda; verde não sai do painel. E
 * pedido com destinatário nunca passa por aqui — oferta de lead é do corretor,
 * tem canal e prazo próprios, e misturar as duas filas faria a equipe achar
 * que precisa clicar em algo que não é dela.
 */
export function montarAlerta(
  agente: Origem,
  p: PedidoAprovacao,
  url?: string,
): Alerta {
  if (p.destinatario) return {};

  const faixa: Faixa = p.faixa ?? "verde";
  const alerta: Alerta = {};

  if (avisaNoCanal(faixa)) alerta.whatsapp = textoCurto(agente, p);

  // Amarela entra no e-mail justamente porque não entra no WhatsApp: é o caso
  // que a mesa trabalhou e que, sem isso, só seria visto por quem abrisse o
  // painel por conta própria.
  if (avisaNoCanal(faixa) || passaPelaMesa(faixa)) {
    alerta.email = {
      assunto: assuntoDe(p, faixa),
      corpo: textoLongo(agente, p, url),
    };
  }

  return alerta;
}

/**
 * O link do pedido — âncora, não rota.
 *
 * A fila é a home do painel e não tem página por pedido; criar uma só para o
 * e-mail seria rota nova, consulta nova e tela nova para mostrar o que a fila
 * já mostra. A âncora leva a pessoa até o card certo com um `id` no HTML, e é
 * tudo que o e-mail precisa. O `id` correspondente está em `app/page.tsx`.
 */
export function urlDoPedido(idAprovacao?: string): string | undefined {
  const base = process.env.PAINEL_URL;
  if (!base) return undefined;
  const limpo = base.replace(/\/$/, "");
  return idAprovacao ? `${limpo}/#pedido-${idAprovacao}` : limpo;
}
