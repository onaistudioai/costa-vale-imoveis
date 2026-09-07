/**
 * A saída de mensagem do sistema — cliente e corretor.
 *
 * Fica atrás de uma função só de propósito: hoje aponta para o bridge local do
 * `whatsapp-mcp` (`POST /api/send`, o mesmo contrato do WAHA e da Cloud API
 * depois de um adaptador), e trocar de provedor é trocar este arquivo.
 *
 * **Sem `WHATSAPP_BRIDGE_URL` definida, nada sai** — a mensagem vai pro log e a
 * função devolve `false`. É o modo em que o projeto roda hoje: o fluxo inteiro
 * é exercitado ponta a ponta sem disparar mensagem pra número de ninguém.
 */
export async function enviarMensagem(
  telefone: string | null | undefined,
  texto: string,
): Promise<boolean> {
  const base = process.env.WHATSAPP_BRIDGE_URL;

  if (!base || !telefone) {
    console.log(`[canal:log] ${telefone ?? "sem telefone"} <- ${texto}`);
    return false;
  }

  try {
    const r = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: normalizar(telefone), message: texto }),
      // O bridge é local; se ele travar, o agente não pode travar junto.
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`bridge respondeu ${r.status}`);
    return true;
  } catch (e) {
    // Canal fora do ar não derruba o fluxo: a decisão já está no banco e o
    // pedido já está na fila do painel. Some a mensagem, não o trabalho.
    console.error(`[canal:falha] ${telefone}: ${(e as Error).message}`);
    return false;
  }
}

/** Formato do whatsmeow: só dígitos, com DDI. Assume Brasil quando falta. */
export function normalizar(telefone: string): string {
  const d = telefone.replace(/\D/g, "");
  return d.length <= 11 ? `55${d}` : d;
}
