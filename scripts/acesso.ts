import { randomBytes } from "node:crypto";
import { gerarSal, hashDaSenha } from "../src/lib/acesso";

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

const gerados = nomes.map((nome) => {
  // Sal por pessoa, gerado junto: é o que impede que duas senhas iguais
  // apareçam como o mesmo hash na linha do `.env`.
  const sal = gerarSal();
  const s = senha();
  return { nome, senha: s, sal, hash: hashDaSenha(s, sal) };
});

console.log("\nEntregue cada senha à sua pessoa. Elas não ficam guardadas em lugar nenhum.\n");
for (const g of gerados) console.log(`  ${g.nome.padEnd(14)} ${g.senha}`);

console.log("\nNo .env (uma linha só):\n");
console.log(
  `PAINEL_USUARIOS=${gerados.map((g) => `${g.nome}:${g.sal}:${g.hash}`).join(",")}`,
);
console.log(
  "\nPara acrescentar gente depois, some as trincas nome:sal:hash na mesma linha, separadas por vírgula.\n",
);
