import type { VercelConfig } from "@vercel/config/v1";

/**
 * A configuração do projeto na Vercel.
 *
 * **Sem bloco `crons` de propósito.** A varredura de prazo precisa rodar a cada
 * minuto — é ela que faz a oferta expirar e passar o lead pro próximo colocado
 * — e o plano Hobby só permite cron uma vez por dia. Um cron diário aqui não
 * seria "menos frequente": seria o repasse automático de lead desligado, com
 * aparência de ligado.
 *
 * Então quem chama é um cron externo, no minuto:
 *
 *   * * * * * curl -s -X POST -H "x-webhook-secret: $WEBHOOK_SECRET" \
 *             https://costa-vale-imoveis.vercel.app/api/varredura
 *
 * No dia em que o time virar Pro, acrescente:
 *
 *   crons: [{ path: "/api/varredura", schedule: "* * * * *" }]
 *
 * e desligue o cron externo — `src/lib/segredo.ts` já aceita as duas formas de
 * autenticação (o cabeçalho próprio e o `Bearer $CRON_SECRET` da Vercel).
 */
export const config: VercelConfig = {
  framework: "nextjs",
};
