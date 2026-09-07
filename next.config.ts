import type { NextConfig } from "next";

const config: NextConfig = {
  // D:\projetos tem um package-lock.json de outro app. Sem fixar a raiz aqui,
  // o Turbopack escolhe o diretório pai e o build resolve os arquivos errados.
  turbopack: { root: import.meta.dirname },

  // O grafo e o Drizzle rodam só no servidor; nada disso deve entrar no bundle.
  serverExternalPackages: ["pg", "@langchain/langgraph-checkpoint-postgres"],
};

export default config;
