import { defineConfig } from "vitest/config";
import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";

dotenv();

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
