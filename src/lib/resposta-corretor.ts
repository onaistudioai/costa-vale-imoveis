import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { FALA, interpretarResposta } from "@/agentes/aceite";
import type { Extrator } from "@/agentes/modelo";
import { enviarMensagem } from "@/lib/canal";
import { corretorPorTelefone, decidirOferta, ofertaAbertaDe } from "@/lib/oferta";

/**
 * A porta do corretor.
 *
 * Fica **antes do grafo**, pelo mesmo motivo da identidade do cliente: a chave
 * de organização muda. Uma mensagem de cliente é organizada por cliente; esta é
 * por corretor, e o que ela move é uma oferta, não uma conversa.
 *
 * Sem isto, a resposta de um corretor cai na porta do cliente: o sistema criaria
 * um cadastro novo com o número dele, o atendimento perguntaria que imóvel ele
 * procura, e a oferta ficaria pendente até expirar e passar pro próximo.
 */

export type Resultado =
  | { tipo: "nao_e_corretor" }
  | { tipo: "sem_oferta"; corretor: string; resposta: string }
  | { tipo: "aceita" | "recusada" | "tarde_demais" | "nao_entendi"; corretor: string; resposta: string };

export async function responderComoCorretor(
  identificador: string,
  mensagem: string,
  extrair: Extrator,
  agora = new Date(),
): Promise<Resultado> {
  const corretor = await corretorPorTelefone(identificador);
  if (!corretor) return { tipo: "nao_e_corretor" };

  const oferta = await ofertaAbertaDe(corretor.id, agora);

  const responder = async (texto: string) => {
    await enviarMensagem(identificador, texto);
    return texto;
  };

  if (!oferta) {
    return {
      tipo: "sem_oferta",
      corretor: corretor.nome,
      resposta: await responder(FALA.semOferta),
    };
  }

  const leitura = await interpretarResposta(mensagem, extrair);

  // Dúvida não vira decisão. Aceitar por engano tira o lead de quem ia
  // atender; recusar por engano manda o cliente pro segundo colocado sem
  // motivo. Perguntar custa uma mensagem.
  if (leitura.decisao === "indefinido") {
    return {
      tipo: "nao_entendi",
      corretor: corretor.nome,
      resposta: await responder(FALA.naoEntendi),
    };
  }

  const desfecho = await decidirOferta(
    oferta.id,
    leitura.decisao === "aceita",
    corretor.id,
    [leitura.motivo, leitura.indicouOutro && `indicou ${leitura.indicouOutro}`]
      .filter(Boolean)
      .join(" · ") || undefined,
  );

  if (desfecho === "tarde_demais") {
    return {
      tipo: "tarde_demais",
      corretor: corretor.nome,
      resposta: await responder(FALA.tardeDemais),
    };
  }

  if (desfecho === "recusada") {
    return {
      tipo: "recusada",
      corretor: corretor.nome,
      resposta: await responder(FALA.recusou),
    };
  }

  const [imovel] = await db
    .select({ endereco: schema.imovel.endereco, bairro: schema.imovel.bairro })
    .from(schema.imovel)
    .where(eq(schema.imovel.idImovel, String((oferta.contexto as { idImovel?: string })?.idImovel)));

  return {
    tipo: "aceita",
    corretor: corretor.nome,
    resposta: await responder(
      FALA.aceitou(imovel ? `${imovel.endereco}${imovel.bairro ? `, ${imovel.bairro}` : ""}` : "O imóvel"),
    ),
  };
}
