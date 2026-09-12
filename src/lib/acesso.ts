import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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
 * **Senha nunca em texto puro.** O ambiente guarda sal + hash `scrypt`; quem
 * tem o arquivo `.env` não consegue entrar com o que está escrito lá.
 */

/**
 * Parâmetros do `scrypt`. N=16384 é o padrão recomendado — custa alguns
 * milissegundos por login, que ninguém percebe num painel de dez pessoas, e
 * torna inviável testar bilhões de senhas com o `.env` na mão.
 */
const CUSTO = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const BYTES_HASH = 32;
const BYTES_SAL = 16;

/** Um sal novo por usuário: sem ele, dois iguais têm hash igual. */
export const gerarSal = () => randomBytes(BYTES_SAL).toString("hex");

/**
 * Deriva o hash da senha com o sal dado.
 *
 * O sal entra na derivação — é o que faz uma tabela pré-calculada não servir
 * pra nada, mesmo se alguém escolher "123456" à mão um dia.
 */
export const hashDaSenha = (senha: string, sal: string) =>
  scryptSync(senha, Buffer.from(sal, "hex"), BYTES_HASH, CUSTO).toString("hex");

/**
 * `PAINEL_USUARIOS` no formato `nome:sal:hash,nome:sal:hash`.
 *
 * Sem a variável, a tabela vem vazia — e o `proxy.ts` **fecha o painel**. Um
 * sistema que abre porque ninguém o configurou é pior que um sistema sem
 * porta, porque parece protegido.
 */
export function usuarios(
  bruto = process.env.PAINEL_USUARIOS,
): Map<string, { sal: string; hash: string }> {
  const tabela = new Map<string, { sal: string; hash: string }>();
  for (const par of (bruto ?? "").split(",")) {
    const [nome, sal, hash] = par.split(":");
    const n = nome?.trim();
    const s = sal?.trim().toLowerCase();
    const h = hash?.trim().toLowerCase();
    // Formato antigo (`nome:hash`, SHA-256 sem sal) cai fora aqui e o painel
    // fecha — o que é o certo: não há como converter um hash sem sal, e deixar
    // passar seria manter a fraqueza de pé em silêncio. Rode `npm run acesso`.
    if (n && /^[0-9a-f]{32}$/.test(s ?? "") && /^[0-9a-f]{64}$/.test(h ?? "")) {
      tabela.set(n, { sal: s!, hash: h! });
    }
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

  return igual(hashDaSenha(senha, esperado.sal), esperado.hash) ? nome : null;
}

/**
 * Quem está logado nesta requisição.
 *
 * O `proxy.ts` já conferiu a senha e carimbou o nome no cabeçalho — e apaga o
 * `x-usuario` que porventura tenha vindo de fora antes de carimbar o seu, que
 * é o que impede alguém de se declarar outra pessoa por cabeçalho.
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

/**
 * Quem está logado, ou erro.
 *
 * As server actions gravam esse nome na trilha de auditoria. Não ter ninguém
 * ali não é caso de preencher "não identificado" — é caso de não gravar: um
 * registro com autor inventado é pior que registro nenhum, porque parece
 * auditoria.
 */
export async function exigirUsuario(): Promise<string> {
  const nome = await quemEsta();
  if (!nome) throw new Error("ação do painel sem usuário autenticado");
  return nome;
}
