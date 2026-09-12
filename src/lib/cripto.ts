import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * O cofre da PII.
 *
 * CPF, telefone, e-mail e o identificador de canal são o que machuca num
 * vazamento: com um dump do banco em texto puro, quem levou tem a lista de
 * contatos da imobiliária inteira. Cifrar na aplicação — e não no banco —
 * significa que a chave nunca passa pela conexão, então nem um `SELECT *` com
 * a credencial certa entrega o dado.
 *
 * Duas chaves, de propósito:
 *
 *   * `PII_KEY` cifra. AES-256-GCM: cada gravação tem IV novo, então o mesmo
 *     telefone gera cifras diferentes — é isso que impede alguém de contar
 *     quantos clientes compartilham um número só olhando a coluna.
 *   * `PII_INDEX_KEY` indexa. HMAC determinístico, porque busca exata precisa
 *     de igualdade — e é justamente por ser determinístico que ele não pode
 *     ser a mesma chave da cifra.
 */

/** Prefixo de versão: o dia da rotação de chave precisa saber o que é velho. */
const VERSAO = "v1";

function chave(nome: "PII_KEY" | "PII_INDEX_KEY"): Buffer {
  const bruto = process.env[nome];
  if (!bruto) {
    throw new Error(
      `${nome} não definida. Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const b = Buffer.from(bruto, "hex");
  // 32 bytes não é gosto: AES-256 e HMAC-SHA256 querem exatamente isso, e uma
  // chave curta aceita em silêncio é pior que erro no boot.
  if (b.length !== 32) throw new Error(`${nome} precisa ter 32 bytes em hex (64 caracteres)`);
  return b;
}

/**
 * Cifra um valor. `null`/vazio atravessa intacto — coluna opcional vazia
 * continua vazia, e cifrar o nada só ocuparia espaço.
 */
export function cifrar(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined || texto === "") return texto ?? null;

  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave("PII_KEY"), iv);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [VERSAO, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(
    ":",
  );
}

/**
 * Decifra. Valor que não tem a cara de cifra volta como está: é o que permite
 * rodar antes e depois de `scripts/cifrar-pii.ts` sem o painel quebrar no meio
 * da migração.
 */
export function decifrar(cifra: string | null | undefined): string | null {
  if (cifra === null || cifra === undefined || cifra === "") return cifra ?? null;
  if (!cifra.startsWith(`${VERSAO}:`)) return cifra;

  const [, iv, tag, ct] = cifra.split(":");
  if (!iv || !tag || !ct) return cifra;

  const d = createDecipheriv("aes-256-gcm", chave("PII_KEY"), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  // Sem try: tag inválida é dado adulterado, e engolir isso devolvendo `null`
  // faria o painel mostrar "sem telefone" para um registro que foi mexido.
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/**
 * O índice cego: HMAC do valor normalizado, em hex.
 *
 * É o que mantém `WHERE email = ?` funcionando sobre coluna cifrada. Note que
 * ele vaza igualdade — dois clientes com o mesmo e-mail têm o mesmo índice —
 * e é exatamente esse vazamento que a busca precisa. Nada além de igualdade:
 * sem a chave, o índice não volta pro valor.
 */
export function indice(valor: string): string {
  return createHmac("sha256", chave("PII_INDEX_KEY")).update(valor.trim().toLowerCase(), "utf8").digest("hex");
}

/** Comparação de índices em tempo constante, para quem compara fora do banco. */
export function mesmoIndice(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
