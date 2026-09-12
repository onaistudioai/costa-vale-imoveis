import { registrar } from "@/lib/canal";

/**
 * A saída de e-mail — o canal que guarda.
 *
 * Irmão do `enviarMensagem` em `src/lib/canal.ts`, e de propósito igual a ele:
 * uma chamada `fetch`, atrás de uma função só, gravando toda tentativa na mesma
 * tabela. Trocar o Resend por SMTP ou SES é trocar este arquivo, e nada além.
 *
 * Sem SDK porque um `POST` com JSON não precisa de um: dependência nova custa
 * atualização, auditoria e superfície, e aqui não compraria nada.
 *
 * **Sem `RESEND_API_KEY` ou sem `EMAIL_EQUIPE`, nada sai** — o e-mail vai pro
 * log e a função devolve `false`, com a tentativa registrada. É o modo em que
 * o projeto roda hoje, e é assim que dá pra conferir o texto de um alerta antes
 * de existir domínio verificado.
 */

const REMETENTE_PADRAO = "alertas@localhost";

export async function enviarEmail(assunto: string, corpo: string): Promise<boolean> {
  const chave = process.env.RESEND_API_KEY;
  const para = (process.env.EMAIL_EQUIPE ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const de = process.env.EMAIL_REMETENTE || REMETENTE_PADRAO;
  const destino = para.join(", ");

  if (!chave || para.length === 0) {
    await registrar(
      destino || null,
      corpo,
      "sem_canal",
      chave ? "sem destinatário" : "canal de e-mail desligado",
      "email",
      assunto,
    );
    return false;
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${chave}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: de, to: para, subject: assunto, text: corpo }),
      // Mesma razão do bridge: se o provedor travar, o agente não trava junto.
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`resend respondeu ${r.status}`);
    await registrar(destino, corpo, "entregue", null, "email", assunto);
    return true;
  } catch (e) {
    // Provedor fora do ar não derruba o fluxo: o pedido já está na fila do
    // painel, que continua sendo a fonte da verdade. Some o aviso, não o
    // trabalho.
    await registrar(destino, corpo, "falha", (e as Error).message, "email", assunto);
    return false;
  }
}
