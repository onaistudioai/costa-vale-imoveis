import { NextResponse, type NextRequest } from "next/server";
import { quemE, usuarios } from "@/lib/acesso";

/**
 * A porta do painel.
 *
 * No Next 16 o antigo `middleware` se chama `proxy`, e roda no runtime Node por
 * padrão — que é o que permite usar `node:crypto` aqui dentro.
 *
 * As rotas de máquina (`/api/eventos`, `/api/varredura`) não pedem senha: elas
 * têm o próprio segredo, e cron não sabe fazer login. Mas **passam por aqui
 * mesmo assim**, porque é aqui que o `x-usuario` vindo de fora é apagado — se
 * elas ficassem fora do matcher, um cliente poderia se declarar "fabiano" por
 * cabeçalho no dia em que alguma delas precisasse saber quem chamou.
 */

const PEDIR = {
  status: 401,
  headers: { "WWW-Authenticate": 'Basic realm="Costa & Vale", charset="UTF-8"' },
};

/** As rotas que o mundo chama sem senha. O segredo delas mora na própria rota. */
const MAQUINA = ["/api/eventos", "/api/varredura"];

/**
 * O painel mostra CPF e telefone. `no-store` mantém isso fora do cache do
 * navegador e de qualquer proxy no caminho; `DENY` impede que a página seja
 * embutida em iframe de terceiro; HSTS trava o downgrade pra HTTP, que é onde
 * a credencial do Basic auth viajaria em claro.
 */
function blindar(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export function proxy(req: NextRequest) {
  // Vem do cliente e não vale nada. Apagar antes de qualquer coisa é o que faz
  // `quemEsta()` poder confiar no que sobra.
  const cabecalhos = new Headers(req.headers);
  cabecalhos.delete("x-usuario");

  if (MAQUINA.some((r) => req.nextUrl.pathname.startsWith(r))) {
    return NextResponse.next({ request: { headers: cabecalhos } });
  }

  const tabela = usuarios();

  // Fecha quando não há usuário configurado. Abrir porque ninguém configurou é
  // pior que não ter porta: parece protegido.
  if (tabela.size === 0) {
    return blindar(
      new NextResponse(
        "Painel sem usuários configurados. Rode `npm run acesso` e ponha PAINEL_USUARIOS no .env.",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
      ),
    );
  }

  const nome = quemE(req.headers.get("authorization"), tabela);
  if (!nome) return blindar(new NextResponse("Acesso restrito.", PEDIR));

  // Quem entrou segue com a requisição: é daqui que sai o "decidido por" das
  // ações do painel, em vez de um nome digitado à mão.
  cabecalhos.set("x-usuario", nome);
  return blindar(NextResponse.next({ request: { headers: cabecalhos } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
