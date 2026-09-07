import type {
  ConfigRoteamento,
  Corretor,
  Dominio,
  MotivoEscalacao,
  NivelDominio,
  Slot,
  Vinculo,
} from "@/tipos";

export interface EntradaRoteamento {
  idCliente: string;
  idImovel: string;
  corretores: Corretor[];
  dominios: Dominio[];
  /** Slots livres por corretor, já filtrados pelo horizonte. */
  agendaLivre: Record<string, Slot[]>;
  /** Nº de leads ativos por corretor — desempate por carga. */
  carga: Record<string, number>;
  vinculo?: Vinculo;
  agora: Date;
  /**
   * Quem já recusou ou deixou o prazo passar neste mesmo lead. Sai da disputa
   * — inclusive do atalho por vínculo, senão a carteira devolveria o lead pra
   * quem acabou de não responder.
   */
  excluidos?: string[];
}

export type ResultadoRoteamento =
  | {
      decisao: "alocado";
      idCorretor: string;
      slot: Slot;
      via: "vinculo" | "pontuacao";
      score?: number;
    }
  | { decisao: "escalar"; motivo: MotivoEscalacao };

const PESO_POR_NIVEL = (
  nivel: NivelDominio,
  p: ConfigRoteamento["pesos"],
): number =>
  nivel === "captou" ? p.captou : nivel === "ja_visitou" ? p.jaVisitou : p.conheceRegiao;

function primeiroSlot(entrada: EntradaRoteamento, id: string): Slot | undefined {
  const slots = entrada.agendaLivre[id];
  if (!slots || slots.length === 0) return undefined;
  return [...slots].sort((a, b) => a.inicio.getTime() - b.inicio.getTime())[0];
}

/**
 * As duas etapas do Agente 3, na ordem (PROJECT_SPEC seção 4).
 *
 * Determinística de ponta a ponta: mesma entrada, mesma saída, sem LLM. O
 * Agente 3 é "reativo, quase gatilho" justamente porque toda a decisão dele
 * cabe aqui.
 *
 * Etapa 1 — vínculo com prazo. Dentro da janela de inatividade o corretor da
 * carteira leva o lead e a pontuação nem roda. Só é ignorado se ele estiver
 * inativo ou sem slot no horizonte.
 *
 * Etapa 2 — pontuação. Domínio pesa mais que disponibilidade: corretor que
 * conhece a casa converte melhor.
 *
 * Envelope (seção 10): fora dos três casos abaixo ele não improvisa, escala.
 */
export function pontuarCorretores(
  entrada: EntradaRoteamento,
  config: ConfigRoteamento,
  estadoComercialMudou = false,
): ResultadoRoteamento {
  // Envelope, caso 3: o imóvel mudou de mão entre a qualificação e o
  // roteamento. Alocar agora seria mandar o corretor pra uma visita morta.
  if (estadoComercialMudou) {
    return { decisao: "escalar", motivo: "estado_comercial_mudou" };
  }

  const fora = new Set(entrada.excluidos ?? []);
  const ativos = new Map(
    entrada.corretores
      .filter((c) => c.ativo && !fora.has(c.idCorretor))
      .map((c) => [c.idCorretor, c]),
  );

  // A lista acabou porque todo mundo já passou a vez — não porque a agenda
  // está cheia. O motivo precisa dizer isso, senão o painel manda calibrar
  // horizonte de agenda quando o problema é equipe sem responder.
  if (ativos.size === 0 && (entrada.excluidos?.length ?? 0) > 0) {
    return { decisao: "escalar", motivo: "ninguem_aceitou" };
  }

  // --- Etapa 1: vínculo com prazo ---
  const v = entrada.vinculo;
  if (v && v.ativo && ativos.has(v.idCorretor)) {
    const diasParado =
      (entrada.agora.getTime() - v.ultimaInteracao.getTime()) / 86_400_000;
    if (diasParado <= config.janelaVinculoDias) {
      const slot = primeiroSlot(entrada, v.idCorretor);
      // Vínculo sem agenda não trava o lead: cai pra pontuação.
      if (slot) {
        return {
          decisao: "alocado",
          idCorretor: v.idCorretor,
          slot,
          via: "vinculo",
        };
      }
    }
  }

  // --- Etapa 2: pontuação ---
  const dominioDoImovel = new Map(
    entrada.dominios
      .filter((d) => d.idImovel === entrada.idImovel)
      .map((d) => [d.idCorretor, d.nivel]),
  );

  const cargaMax = Math.max(1, ...Object.values(entrada.carga));

  const candidatos = [...ativos.keys()]
    .map((id) => {
      const slot = primeiroSlot(entrada, id);
      if (!slot) return null;
      const nivel = dominioDoImovel.get(id);
      const score =
        (nivel ? PESO_POR_NIVEL(nivel, config.pesos) : 0) +
        config.pesos.disponibilidadeImediata *
          (1 - horasAte(entrada.agora, slot.inicio) / config.horizonteAgendaHoras) +
        config.pesos.cargaBaixa * (1 - (entrada.carga[id] ?? 0) / cargaMax);
      return { id, slot, score };
    })
    .filter((c): c is { id: string; slot: Slot; score: number } => c !== null);

  // Envelope, caso 2: ninguém tem agenda dentro do horizonte.
  if (candidatos.length === 0) {
    return { decisao: "escalar", motivo: "sem_slot_no_horizonte" };
  }

  // Empate resolvido por id pra manter a função determinística.
  candidatos.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const vencedor = candidatos[0]!;

  // Envelope, caso 1: ninguém passa do mínimo. É o que impede o roteamento de
  // degradar em silêncio quando `dominio_corretor` está vazia.
  if (vencedor.score < config.scoreMinimo) {
    return { decisao: "escalar", motivo: "nenhum_corretor_acima_do_minimo" };
  }

  return {
    decisao: "alocado",
    idCorretor: vencedor.id,
    slot: vencedor.slot,
    via: "pontuacao",
    score: vencedor.score,
  };
}

const horasAte = (de: Date, ate: Date) =>
  Math.max(0, (ate.getTime() - de.getTime()) / 3_600_000);
