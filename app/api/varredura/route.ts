import { NextResponse } from "next/server";
import { varrerPrazos } from "@/lib/varredura";
import { segredoConfere } from "@/lib/segredo";

/**
 * Endpoint da varredura de prazo. Quem chama é o cron do VPS, no minuto:
 *
 *   * * * * * curl -s -H "x-webhook-secret: $WEBHOOK_SECRET" \
 *             http://localhost:3000/api/varredura
 *
 * Mesmo segredo do webhook de eventos: é a mesma superfície de máquina, e ter
 * dois segredos pra proteger a mesma coisa só multiplica lugar pra vazar.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!segredoConfere(req)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  return NextResponse.json(await varrerPrazos());
}

/** GET faz o mesmo: é assim que o Vercel Cron chama, e um `curl` também. */
export const GET = POST;
