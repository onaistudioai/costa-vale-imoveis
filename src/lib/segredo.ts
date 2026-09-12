import { timingSafeEqual } from "node:crypto";

/**
 * A porta das rotas de máquina.
 *
 * `/api/eventos` e `/api/varredura` ficam fora do Basic auth: canal, CRM e cron
 * não sabem fazer login. O que as protege é um segredo compartilhado — e as
 * duas usam o mesmo, de propósito: é a mesma superfície, e dois segredos pra
 * proteger a mesma coisa só multiplica lugar pra vazar.
 *
 * Duas formas de apresentar o segredo, porque são dois chamadores diferentes:
 *
 *   * `x-webhook-secret: <WEBHOOK_SECRET>` — o bridge do canal e o CRM.
 *   * `Authorization: Bearer <CRON_SECRET>` — o Vercel Cron, que só sabe mandar
 *     `GET` com esse cabeçalho. Sem isso, o segredo teria que ir na URL, e URL
 *     de cron cai em log de acesso.
 */

/** Comparação de tempo constante: `!==` diz quantos caracteres batem. */
function igual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Autoriza a requisição de máquina.
 *
 * Falha **fechada**: sem nenhum segredo configurado no ambiente, nada entra.
 * Uma rota que abre porque ninguém a configurou é a pior das duas falhas.
 */
export function segredoConfere(req: Request): boolean {
  const webhook = process.env.WEBHOOK_SECRET;
  const cron = process.env.CRON_SECRET;
  if (!webhook && !cron) return false;

  if (webhook && igual(req.headers.get("x-webhook-secret"), webhook)) return true;

  const auth = req.headers.get("authorization");
  if (cron && auth?.startsWith("Bearer ") && igual(auth.slice(7), cron)) return true;

  return false;
}
