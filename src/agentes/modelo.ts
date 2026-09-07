import { ChatGroq } from "@langchain/groq";
import type { z } from "zod";

/**
 * A única porta de saída pra modelo de linguagem.
 *
 * Injetável de propósito: os testes passam um extrator falso e rodam sem chave
 * de API, sem rede e sem custo. Só os Agentes 1, 2 e 4 recebem um destes — o
 * Agente 3 é determinístico e nem importa este arquivo.
 *
 * Provedor: **Groq**. Trocar de provedor é trocar este arquivo, e nada além
 * dele — nenhum agente sabe qual modelo responde.
 */
export type Extrator = <T>(args: {
  schema: z.ZodType<T>;
  sistema: string;
  entrada: string;
}) => Promise<T>;

export type Tarefa = "extracao" | "classificacao";

/**
 * `GROQ_MODEL` manda quando existe — é o mesmo arquivo de credencial que a
 * stack Exodus usa, e o modelo de lá já foi trocado uma vez por descontinuação.
 * Os defaults abaixo são o fallback.
 */
const MODELOS: Record<Tarefa, string> = {
  // Texto livre de humano em campo, onde errar custa caro.
  extracao: "openai/gpt-oss-120b",
  // Classificação simples e de alto volume.
  classificacao: "llama-3.1-8b-instant",
};

export function extratorGroq(
  tarefa: Tarefa = "extracao",
): Extrator & { modelo: string; tarefa: Tarefa } {
  const nome = process.env.GROQ_MODEL || MODELOS[tarefa];
  const modelo = new ChatGroq({ model: nome, temperature: 0 });

  const extrair: Extrator = async ({ schema, sistema, entrada }) => {
    const estruturado = modelo.withStructuredOutput(schema);
    return (await estruturado.invoke([
      { role: "system", content: sistema },
      { role: "user", content: entrada },
    ])) as never;
  };

  // O nome do modelo fica pendurado na função porque quem registra procedência
  // (src/agentes/procedencia.ts) precisa saber quem respondeu — e nenhum agente
  // pode saber. Ninguém além do envelope de procedência lê estes dois campos.
  return Object.assign(extrair, { modelo: nome, tarefa });
}
