import type { EstadoImovel, Laudo, PortasCurador } from "@/agentes/curador";
import type { EntradaAgente3, PortasRoteador } from "@/agentes/roteador";
import type { EntradaAtendimento } from "@/agentes/atendimento";
import type { PortasAlterador } from "@/agentes/alterador";
import type { Anuncio, ConfigRoteamento, EstadoComercial } from "@/tipos";
import type { Extrator } from "@/agentes/modelo";
import type { RegistrarLeitura } from "@/agentes/procedencia";
import type { IoDoNo } from "./no";
import type { Evento } from "./eventos";

/**
 * Tudo que os nós precisam do mundo lá fora, numa interface só.
 *
 * Existe pra que o grafo de produção e o grafo de teste sejam o MESMO grafo —
 * o que muda é o que se injeta. Nenhum nó importa `db` diretamente.
 */
export interface Mundo {
  carregarCurador(e: Evento): Promise<{ laudo: Laudo; imovel: EstadoImovel }>;

  carregarGuardiao(e: Evento): Promise<{
    idImovel: string;
    idTransacao: string;
    estadoComercialAtual: EstadoComercial;
    documento: string;
    anuncios: Anuncio[];
  }>;

  carregarRoteador(
    e: Evento,
    lead: { idCliente: string; idImovel: string; resumo: string },
  ): Promise<EntradaAgente3>;

  carregarAtendimento(e: Evento): Promise<EntradaAtendimento>;

  /** Entrega a resposta do Agente 4 no canal de onde a mensagem veio. */
  responder(e: Evento, texto: string): Promise<void>;

  portasCurador: PortasCurador;
  portasRoteador: PortasRoteador;
  portasAlterador: PortasAlterador;
}

export interface Dependencias {
  mundo: Mundo;
  io: IoDoNo;
  extrator: Extrator;
  config: ConfigRoteamento;
  /**
   * Onde a procedência de cada leitura é gravada. Opcional porque auditoria não
   * é caminho crítico: os testes rodam sem ela e o grafo se comporta igual.
   */
  registrarLeitura?: RegistrarLeitura;
}
