import type { NextConfig } from "next";

const config: NextConfig = {
  // Se a pasta-mãe tiver um package-lock.json de outro projeto, o Turbopack
  // elege o diretório pai como raiz e o build resolve os arquivos errados.
  // Fixar aqui é o que impede isso.
  turbopack: { root: import.meta.dirname },

  // O grafo e o Drizzle rodam só no servidor; nada disso deve entrar no bundle.
  serverExternalPackages: ["pg", "@langchain/langgraph-checkpoint-postgres"],
};

export default config;
