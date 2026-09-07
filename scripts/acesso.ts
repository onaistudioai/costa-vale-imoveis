import { randomBytes } from "node:crypto";
import { hashDaSenha } from "../src/lib/acesso";

/**
 * Gera acesso ao painel.
 *
 *   npm run acesso -- fabiano ana joao
 *
 * A senha aparece **uma vez**, aqui. O que vai pro `.env` é o hash — quem tem o
 * arquivo não entra com o que está escrito nele. Perdeu a senha, gera outra: é
 * mais barato que guardar senha em lugar nenhum.
 */

const nomes = process.argv.slice(2).filter((n) => /^[a-z0-9._-]{2,30}$/i.test(n));

if (nomes.length === 0) {
  console.error("uso: npm run acesso -- <nome> [outro-nome ...]");
  console.error("nome: letras, números, ponto, hífen ou sublinhado");
  process.exit(1);
}

// Alfabeto sem os pares que se confundem à mão (0/O, 1/l/I): a senha vai ser
// digitada por gente, e uma senha ambígua vira chamado de suporte.
const ALFABETO = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const senha = (n = 16) =>
  Array.from(randomBytes(n), (b) => ALFABETO[b % ALFABETO.length]).join("");

const gerados = nomes.map((nome) => ({ nome, senha: senha() }));

console.log("\nEntregue cada senha à sua pessoa. Elas não ficam guardadas em lugar nenhum.\n");
for (const g of gerados) console.log(`  ${g.nome.padEnd(14)} ${g.senha}`);

console.log("\nNo .env (uma linha só):\n");
console.log(
  `PAINEL_USUARIOS=${gerados.map((g) => `${g.nome}:${hashDaSenha(g.senha)}`).join(",")}`,
);
console.log(
  "\nPara acrescentar gente depois, some as duplas nome:hash na mesma linha, separadas por vírgula.\n",
);
