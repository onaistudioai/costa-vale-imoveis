import { createHash } from "node:crypto";
import type { Extrator } from "./modelo";

/**
 * Procedência: quem leu, com qual modelo e com qual prompt.
 *
 * O sistema já registra toda decisão (`log_evento`). O que ele não registrava
 * é **de onde veio a leitura** que antecedeu a decisão — e sem isso "o modelo
 * melhorou" é opinião, não medida. Trocar `gpt-oss-120b` por outro modelo ou
 * mexer numa linha de prompt hoje é uma mudança invisível no histórico.
 *
 * Este arquivo é um envelope em volta do `Extrator`, e de propósito não sabe o
 * que é um banco: quem grava entra por injeção, igual ao extrator dos testes.
 */

export interface Leitura {
  agente: string;
  tarefa: string;
  modelo: string;
  /** Versão do prompt — ver `versaoDoPrompt`. */
  promptHash: string;
  entrada: string;
  entradaHash: string;
  saida: unknown;
  ms: number;
  erro: string | null;
  idEvento: string | null;
}

export type RegistrarLeitura = (l: Leitura) => Promise<void>;

/**
 * A versão do prompt é o hash do próprio prompt.
 *
 * A alternativa seria um campo `v3` mantido à mão, e campo de versão mantido à
 * mão é campo de versão desatualizado: alguém melhora uma frase do prompt, não
 * sobe o número, e a aferição passa a comparar duas coisas diferentes achando
 * que são a mesma. Aqui, mudou o texto, mudou a versão — sem disciplina.
 */
export const versaoDoPrompt = (sistema: string) =>
  createHash("sha256").update(sistema.trim()).digest("hex").slice(0, 12);

const hashEntrada = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 12);

/**
 * Embrulha um extrator pra que cada chamada deixe rastro.
 *
 * Duas coisas que ele **não** faz, e são o ponto:
 *
 * - **não interfere no resultado** — devolve exatamente o que o modelo deu;
 * - **não derruba o atendimento se a gravação falhar.** Auditoria não é caminho
 *   crítico: um Postgres indisponível não pode ser o motivo de um cliente de 3h
 *   da manhã ficar sem resposta.
 *
 * Erro do modelo é gravado e re-lançado — é a linha mais valiosa da tabela,
 * porque é a única que conta o que deu errado antes de alguém reclamar.
 */
export function comProcedencia(
  base: Extrator,
  quem: { agente: string; idEvento?: string | null },
  registrar: RegistrarLeitura,
): Extrator {
  const modelo = (base as Extrator & { modelo?: string }).modelo ?? "desconhecido";
  const tarefa = (base as Extrator & { tarefa?: string }).tarefa ?? "extracao";

  return (async (args: Parameters<Extrator>[0]) => {
    const inicio = Date.now();
    const comum = {
      agente: quem.agente,
      tarefa,
      modelo,
      promptHash: versaoDoPrompt(args.sistema),
      entrada: args.entrada,
      entradaHash: hashEntrada(args.entrada),
      idEvento: quem.idEvento ?? null,
    };

    const gravar = async (l: Leitura) => {
      try {
        await registrar(l);
      } catch (e) {
        console.warn("[procedencia] leitura não registrada:", e);
      }
    };

    try {
      const saida = await base(args);
      await gravar({ ...comum, saida, ms: Date.now() - inicio, erro: null });
      return saida;
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await gravar({ ...comum, saida: null, ms: Date.now() - inicio, erro });
      throw e;
    }
  }) as Extrator;
}
