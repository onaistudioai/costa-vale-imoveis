"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { processarEvento, retomar } from "@/grafo/runtime";
import { fechar, MOTIVOS_DESFECHO, type MotivoDesfecho } from "@/regras/funil";
import { fundir } from "@/lib/identidade-db";
import { consultar } from "@/consulta";
import { extratorGroq } from "@/agentes/modelo";
import { comProcedencia } from "@/agentes/procedencia";
import { registrarLeitura } from "@/lib/leitura-db";
import { escrever, versionar } from "@/cerebro/db";
import { quemEsta } from "@/lib/acesso";

/**
 * Decidir um item da fila.
 *
 * O que esta ação faz é fechar o registro em `aprovacao` e retomar a thread do
 * grafo. Ela NÃO reexecuta fluxo: o `interrupt()` já deixou a execução parada
 * no ponto exato, e é de lá que ela continua (ver src/grafo/interrupt.test.ts).
 */
export async function decidir(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const aprovado = formData.get("decisao") === "aprovar";
  // Quem decidiu é quem entrou no painel, não o que a pessoa digitou: campo de
  // auditoria preenchido à mão é teatro de auditoria. O `proxy.ts` garante que
  // ninguém chega aqui sem login, então o campo do formulário só é alcançável
  // de fora de uma requisição — teste e script.
  const por =
    (await quemEsta()) ?? (String(formData.get("por") ?? "").trim() || "não identificado");
  const motivo = String(formData.get("motivo") ?? "").trim() || null;

  if (!id) throw new Error("pedido sem id");

  const [pedido] = await db
    .select()
    .from(schema.aprovacao)
    .where(eq(schema.aprovacao.id, id));

  if (!pedido) throw new Error("pedido não encontrado");

  // Decidir duas vezes o mesmo pedido não é erro do usuário — é dois
  // navegadores abertos. A primeira decisão vale.
  if (pedido.estado !== "pendente") {
    revalidatePath("/");
    return;
  }

  await db
    .update(schema.aprovacao)
    .set({
      estado: aprovado ? "aprovado" : "negado",
      decididoPor: por,
      decididoEm: new Date(),
      motivo,
    })
    .where(eq(schema.aprovacao.id, id));

  await db.insert(schema.logEvento).values({
    agenteOrigem: "humano",
    entidade: "aprovacao",
    idEntidade: id,
    campo: `decisao.${pedido.tipo}`,
    valorAnterior: "pendente",
    valorNovo: aprovado ? "aprovado" : "negado",
    aprovadoPor: por,
    idEvento: pedido.idEvento,
  });

  // A fusão de identidade é o único pedido que não para thread nenhuma: ele
  // nasce fora do grafo, na recepção, enquanto a conversa segue. Aprovar aqui
  // é o que de fato une os dois cadastros.
  if (pedido.tipo === "fundir_identidade" && aprovado && pedido.destinatario) {
    // O candidato antigo é quem sobrevive: ele carrega o histórico mais longo,
    // e é o cadastro que a equipe já conhece.
    await fundir(pedido.destinatario, pedido.idEntidade, por);
  }

  // A decisão fica gravada ANTES da retomada: se o grafo falhar ao voltar, o
  // registro auditável não se perde e a retomada pode ser repetida — o
  // caminho contrário perderia a decisão da pessoa.
  if (pedido.threadId) {
    await retomar(pedido.threadId, { aprovado, por, motivo: motivo ?? undefined });
  }

  revalidatePath("/");
  if (pedido.entidade === "imovel") revalidatePath(`/imovel/${pedido.idEntidade}`);
}

/**
 * A resposta do corretor à oferta de lead.
 *
 * Mesmo caminho do `decidir` — fecha o registro e retoma a thread — mas é
 * outro ator: quem responde é o corretor, e a recusa não é "negar um pedido",
 * é passar a vez. O Agente 3 continua sozinho a partir daí, oferecendo pro
 * próximo colocado.
 *
 * No VPS, quem chama isto é o webhook do canal ao ler a resposta do corretor.
 * O botão no painel existe pra demonstrar o fluxo sem depender do WhatsApp.
 */
export async function responderOferta(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const aceito = formData.get("resposta") === "aceitar";
  if (!id) throw new Error("oferta sem id");

  const [oferta] = await db
    .select()
    .from(schema.aprovacao)
    .where(eq(schema.aprovacao.id, id));

  if (!oferta) throw new Error("oferta não encontrada");

  // Já expirou ou já foi respondida: a primeira resposta vale. Chegar tarde é
  // o caso normal aqui, não erro.
  if (oferta.estado !== "pendente") {
    revalidatePath("/");
    return;
  }

  await db
    .update(schema.aprovacao)
    .set({
      estado: aceito ? "aprovado" : "negado",
      decididoPor: oferta.destinatario ?? "corretor",
      decididoEm: new Date(),
      motivo: aceito ? null : "passou a vez",
    })
    .where(eq(schema.aprovacao.id, id));

  if (oferta.threadId) {
    await retomar(oferta.threadId, {
      aprovado: aceito,
      por: oferta.destinatario ?? "corretor",
      motivo: aceito ? undefined : "recusou",
    });
  }

  revalidatePath("/");
}

/**
 * O pedido de alteração de cadastro, em texto livre.
 *
 * É a porta do Agente 6 e a resposta ao gargalo que existia: até agora, mudar
 * um preço ou corrigir um endereço lido errado exigia alguém que soubesse
 * mexer no banco. Nada é escrito aqui — o que volta é um pedido de
 * confirmação na fila do painel, ou um desfecho explicando por que não deu.
 */
export async function solicitarAlteracao(formData: FormData) {
  const texto = String(formData.get("texto") ?? "").trim();
  // O mesmo limite da consulta. Texto sem teto é a porta aberta pra alguém
  // colar quarenta páginas e torrar o contexto do modelo.
  if (!texto) throw new Error("pedido vazio");

  const r = await processarEvento({
    idEvento: crypto.randomUUID(),
    tipo: "alteracao.solicitada",
    payload: { texto: texto.slice(0, 1000) },
  });

  revalidatePath("/");
  return r;
}

/**
 * O ponto final de um atendimento.
 *
 * Exige motivo de propósito: sem ele, "quantos perdemos por preço?" não tem
 * resposta, e é essa pergunta que muda a operação. A lista de motivos é
 * fechada pelo mesmo motivo — texto livre vira algo que ninguém consegue
 * contar depois.
 */
export async function darDesfecho(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const motivo = String(formData.get("motivo") ?? "") as MotivoDesfecho;
  const por = String(formData.get("por") ?? "").trim() || "não identificado";

  if (!id) throw new Error("atendimento sem id");
  if (!MOTIVOS_DESFECHO.includes(motivo)) throw new Error(`motivo inválido: ${motivo}`);

  const [a] = await db
    .select()
    .from(schema.atendimento)
    .where(eq(schema.atendimento.idAtendimento, id));
  if (!a) throw new Error("atendimento não encontrado");

  const novo = fechar(
    {
      etapa: a.etapa,
      etapaMaxima: a.etapaMaxima,
      estado: a.estado,
      ultimaInteracao: a.ultimaInteracao,
      ultimoContatoPor: a.ultimoContatoPor as "cliente" | "nos",
    },
    motivo,
  );

  await db
    .update(schema.atendimento)
    .set({ ...novo, precisaDesfecho: false, prioridade: 0 })
    .where(eq(schema.atendimento.idAtendimento, id));

  await db.insert(schema.logEvento).values({
    agenteOrigem: "humano",
    entidade: "atendimento",
    idEntidade: id,
    campo: "atendimento.desfecho",
    valorAnterior: a.etapa,
    valorNovo: motivo,
    aprovadoPor: por,
  });

  revalidatePath("/funil");
}

/** Confirma que dois cadastros são a mesma pessoa e unifica. */
export async function confirmarFusao(formData: FormData) {
  const vencedor = String(formData.get("vencedor") ?? "");
  const perdedor = String(formData.get("perdedor") ?? "");
  const por = String(formData.get("por") ?? "").trim() || "não identificado";
  if (!vencedor || !perdedor) throw new Error("fusão sem os dois cadastros");

  await fundir(vencedor, perdedor, por);
  revalidatePath("/");
}

/**
 * A pergunta da equipe. Só lê — nenhuma escrita, nenhum evento, nenhum agente
 * acionado. A conexão que ela usa nem tem permissão de escrever.
 */
export async function perguntar(pergunta: string) {
  // O 5 não entra no grafo, então a procedência dele se liga aqui — e ele é o
  // único que chama o modelo duas vezes por pergunta (classificar e redigir),
  // o que faz cada pergunta virar duas linhas de auditoria.
  const extrair = comProcedencia(
    extratorGroq("classificacao"),
    { agente: "5_consulta" },
    registrarLeitura,
  );
  return consultar(pergunta.slice(0, 500), extrair);
}

/**
 * Escrever no cérebro. Nasce proposta: não influencia agente nenhum até que
 * alguém da equipe confirme.
 */
export async function anotar(formData: FormData) {
  const texto = String(formData.get("texto") ?? "").trim();
  const autor = (await quemEsta()) ?? String(formData.get("autor") ?? "").trim();
  if (!texto || !autor) return;

  await escrever({
    escopo: String(formData.get("escopo") ?? "geral"),
    chave: String(formData.get("chave") ?? "").trim(),
    texto: texto.slice(0, 400),
    autor,
    evidencia: { fonte: "escrita à mão no painel" },
  });
  revalidatePath("/cerebro");
}

/**
 * As quatro ações humanas sobre uma nota — confirmar, corrigir, fixar e
 * desativar — são todas a mesma escrita: uma versão nova. Nada é apagado.
 */
export async function versionarNota(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const estado = String(formData.get("estado") ?? "") as
    | "rascunho"
    | "confirmada"
    | "fixada"
    | "desativada";
  const texto = String(formData.get("texto") ?? "").trim();
  const motivo = String(formData.get("motivo") ?? "").trim();

  try {
    await versionar(id, {
      estado,
      texto: texto || undefined,
      motivo: motivo || undefined,
      autor: (await quemEsta()) ?? "não identificado",
    });
  } catch (e) {
    const { redirect } = await import("next/navigation");
    redirect(`/cerebro?erro=${encodeURIComponent(String(e))}`);
  }
  revalidatePath("/cerebro");
}
