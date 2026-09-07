import { NextResponse, type NextRequest } from "next/server";
import { quemE, usuarios } from "@/lib/acesso";

/**
 * A porta do painel.
 *
 * No Next 16 o antigo `middleware` se chama `proxy`, e roda no runtime Node por
 * padrão — que é o que permite usar `node:crypto` aqui dentro.
 *
 * As rotas de máquina (`/api/eventos`, `/api/varredura`) ficam de fora: elas
 * têm o próprio segredo, e cron não sabe fazer login. Tudo que uma pessoa abre
 * passa por aqui.
 */

const PEDIR = {
  status: 401,
  headers: { "WWW-Authenticate": 'Basic realm="Costa & Vale", charset="UTF-8"' },
};

export function proxy(req: NextRequest) {
  const tabela = usuarios();

  // Fecha quando não há usuário configurado. Abrir porque ninguém configurou é
  // pior que não ter porta: parece protegido.
  if (tabela.size === 0) {
    return new NextResponse(
      "Painel sem usuários configurados. Rode `npm run acesso` e ponha PAINEL_USUARIOS no .env.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const nome = quemE(req.headers.get("authorization"), tabela);
  if (!nome) return new NextResponse("Acesso restrito.", PEDIR);

  // Quem entrou segue com a requisição: é daqui que sai o "decidido por" das
  // ações do painel, em vez de um nome digitado à mão.
  const cabecalhos = new Headers(req.headers);
  cabecalhos.set("x-usuario", nome);
  return NextResponse.next({ request: { headers: cabecalhos } });
}

export const config = {
  matcher: ["/((?!api/eventos|api/varredura|_next/static|_next/image|favicon.ico).*)"],
};
