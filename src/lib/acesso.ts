import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Quem pode abrir o painel.
 *
 * O painel decide anúncio, funde cadastro e fecha atendimento. Sem porta, quem
 * tem o endereço faz tudo isso — e o campo "decidido por" vira teatro, porque
 * a pessoa digita o nome que quiser.
 *
 * Autenticação HTTP básica, de propósito: o painel tem um punhado de usuários
 * dentro da imobiliária, e a alternativa (tabela de sessão, tela de login,
 * recuperação de senha) é mais código pra manter do que o problema pede. O
 * navegador já sabe fazer isso desde sempre.
 *
 * **Senha nunca em texto puro.** O ambiente guarda o hash; quem tem o arquivo
 * `.env` não consegue entrar com o que está escrito lá.
 */

export const hashDaSenha = (senha: string) =>
  createHash("sha256").update(senha, "utf8").digest("hex");

/**
 * `PAINEL_USUARIOS` no formato `nome:hash,nome:hash`.
 *
 * Sem a variável, a tabela vem vazia — e o `proxy.ts` **fecha o painel**. Um
 * sistema que abre porque ninguém o configurou é pior que um sistema sem
 * porta, porque parece protegido.
 */
export function usuarios(bruto = process.env.PAINEL_USUARIOS): Map<string, string> {
  const tabela = new Map<string, string>();
  for (const par of (bruto ?? "").split(",")) {
    const [nome, hash] = par.split(":");
    const n = nome?.trim();
    const h = hash?.trim().toLowerCase();
    if (n && h && /^[0-9a-f]{64}$/.test(h)) tabela.set(n, h);
  }
  return tabela;
}

/** Comparação de tempo constante: senha errada não pode demorar diferente. */
function igual(a: string, b: string) {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Confere o cabeçalho `Authorization` e devolve **o nome de quem entrou** —
 * que é o ponto: sem isso o painel sabe que alguém decidiu, não quem.
 */
export function quemE(
  autorizacao: string | null | undefined,
  tabela = usuarios(),
): string | null {
  if (!autorizacao?.startsWith("Basic ")) return null;

  let cru: string;
  try {
    cru = Buffer.from(autorizacao.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }

  const corte = cru.indexOf(":");
  if (corte < 1) return null;

  const nome = cru.slice(0, corte);
  const senha = cru.slice(corte + 1);
  const esperado = tabela.get(nome);
  if (!esperado) return null;

  return igual(hashDaSenha(senha), esperado) ? nome : null;
}

/**
 * Quem está logado nesta requisição.
 *
 * O `proxy.ts` já conferiu a senha e carimbou o nome no cabeçalho. Server
 * action lendo daqui é o que faz o "decidido por" parar de ser um campo de
 * texto que a pessoa preenche com o nome que quiser.
 */
export async function quemEsta(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("x-usuario") ?? quemE(h.get("authorization"));
  } catch {
    // Fora de uma requisição (teste, script) não existe ninguém logado. Devolver
    // `null` é a resposta honesta; quem chama decide o que fazer com ela.
    return null;
  }
}
