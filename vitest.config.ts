import { defineConfig } from "vitest/config";
import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";

dotenv();

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { include: ["src/**/*.test.ts"], testTimeout: 30000, fileParallelism: false },
});
