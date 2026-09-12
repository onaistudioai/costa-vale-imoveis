import { defineConfig } from "vitest/config";
import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";

dotenv();

/**
 * O banco dos testes nunca é o banco do painel.
 *
 * Os testes de integração apagam tabelas inteiras no `beforeEach` — é o que
 * mantém cada um independente do anterior. Apontados para o banco de trabalho,
 * eles apagam o estoque, os corretores e os clientes; isso já aconteceu duas
 * vezes aqui e, das duas, produziu diagnóstico errado antes de alguém perceber.
 * Na máquina de um cliente, apagaria a operação da imobiliária.
 *
 * A troca é feita aqui e não dentro de cada teste, para não existir caminho
 * que escape dela. E a ausência de `TEST_DATABASE_URL` **apaga**
 * `DATABASE_URL` em vez de deixá-la passar: sem banco declarado para teste, os
 * testes de integração se marcam como pulados (`temBanco`) e nenhum `delete`
 * chega em lugar nenhum. Falhar fechado, como a senha do painel.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  // A conexão só-leitura do Agente 5 tem variável própria e precisa vir junto.
  // Deixar ela para trás faria metade da suíte escrever num banco e ler no
  // outro — que foi exatamente o que aconteceu na primeira tentativa. E ela
  // precisa continuar sendo o papel restrito, senão o teste que prova "o banco
  // recusa a escrita" passa a testar o dono do banco e não prova nada.
  if (process.env.TEST_DATABASE_URL_LEITURA) {
    process.env.DATABASE_URL_LEITURA = process.env.TEST_DATABASE_URL_LEITURA;
  } else {
    delete process.env.DATABASE_URL_LEITURA;
  }
} else {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_LEITURA;
}

/**
 * Chaves de PII fixas para a suíte.
 *
 * Não é segredo nenhum e não pode ser: o teste que prova que o telefone volta
 * inteiro precisa cifrar e decifrar com a mesma chave a cada rodada. As de
 * verdade vivem só no ambiente — e é justamente por o código exigir a variável
 * que elas não podem ter valor-padrão fora daqui.
 */
process.env.PII_KEY ??= "11".repeat(32);
process.env.PII_INDEX_KEY ??= "22".repeat(32);

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    // O `beforeEach` dos testes de integração apaga meia dúzia de tabelas num
    // Postgres que está na nuvem, e o teto de hook é 10s por padrão — separado
    // do `testTimeout`. Sem isto, a suíte falha por latência de rede e mente
    // sobre o código.
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
