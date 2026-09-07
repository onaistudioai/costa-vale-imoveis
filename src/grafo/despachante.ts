import type { Agente } from "@/tipos";
import { chaveDeLock, donoDoEvento, type Evento } from "./eventos";

export interface ConfigConcorrencia {
  porAgente: Record<Agente, number>;
  /** Ordem de atendimento da fila. O Agente 4 vem primeiro: é o único com gente esperando. */
  prioridade: Agente[];
}

export const CONCORRENCIA_PADRAO: ConfigConcorrencia = {
  porAgente: {
    "1_curador": 3,
    "2_guardiao": 3,
    "3_roteador": 6,
    "4_atendimento": 10,
    // Alteração é pedido de gente da equipe esperando na tela. Teto baixo
    // porque cada uma custa uma chamada de modelo e ninguém pede vinte de uma
    // vez; prioridade alta pelo mesmo motivo do Agente 4 — tem alguém olhando.
    "6_alterador": 4,
  },
  prioridade: ["4_atendimento", "6_alterador", "3_roteador", "2_guardiao", "1_curador"],
};

type Trabalho<T> = {
  evento: Evento;
  agente: Agente;
  chave: string;
  exec: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

/**
 * Aplica R2, R3 e R6 antes de qualquer agente rodar.
 *
 * - R2: no máximo um trabalho por chave de lock. Chaves diferentes correm juntas.
 * - R3: teto de execuções simultâneas por agente, com prioridade na fila.
 * - R6: evento já processado não roda de novo.
 *
 * O ponto do R2 é preservar paralelismo, não matá-lo: dois eventos em imóveis
 * diferentes têm que sair ao mesmo tempo. Dois agentes em velocidade plena
 * valem mais que um entregue e um processando em cima do outro.
 */
export class Despachante {
  private fila: Trabalho<unknown>[] = [];
  private ocupadas = new Set<string>();
  private rodando: Record<Agente, number> = {
    "1_curador": 0,
    "2_guardiao": 0,
    "3_roteador": 0,
    "4_atendimento": 0,
    "6_alterador": 0,
  };

  constructor(
    private readonly config: ConfigConcorrencia = CONCORRENCIA_PADRAO,
    /** R6 — consulta de idempotência. Em produção, a tabela evento_processado. */
    private readonly jaProcessado: (idEvento: string) => Promise<boolean> = async () => false,
    private readonly marcarProcessado: (e: Evento) => Promise<void> = async () => {},
  ) {}

  async despachar<T>(evento: Evento, exec: () => Promise<T>): Promise<T | "duplicado"> {
    if (await this.jaProcessado(evento.idEvento)) return "duplicado";

    const agente = donoDoEvento(evento);
    const chave = chaveDeLock(evento);

    const promessa = new Promise<T>((resolve, reject) => {
      // O tipo do resultado é apagado aqui de propósito: a fila é heterogênea,
      // e a promessa devolvida ao chamador preserva o T dele.
      this.fila.push({
        evento,
        agente,
        chave,
        exec: exec as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    });

    this.bombear();
    return promessa;
  }

  /** Sondagem pra teste: o que está em execução agora. */
  get emExecucao(): { chaves: string[]; porAgente: Record<Agente, number> } {
    return { chaves: [...this.ocupadas], porAgente: { ...this.rodando } };
  }

  private bombear(): void {
    for (const agente of this.config.prioridade) {
      while (this.rodando[agente] < this.config.porAgente[agente]) {
        const i = this.fila.findIndex(
          (t) => t.agente === agente && !this.ocupadas.has(t.chave),
        );
        if (i === -1) break;
        const [t] = this.fila.splice(i, 1);
        this.executar(t!);
      }
    }
  }

  private executar(t: Trabalho<unknown>): void {
    this.ocupadas.add(t.chave);
    this.rodando[t.agente] += 1;

    t.exec()
      .then(async (v) => {
        await this.marcarProcessado(t.evento);
        t.resolve(v);
      })
      .catch(t.reject)
      .finally(() => {
        this.ocupadas.delete(t.chave);
        this.rodando[t.agente] -= 1;
        this.bombear();
      });
  }
}
