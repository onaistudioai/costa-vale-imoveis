// Tipos compartilhados entre regras, agentes e grafo.
// As regras (src/regras/) importam só daqui — nunca do banco. É o que as torna
// testáveis sem Postgres e sem modelo de linguagem.

export type EstadoOperacional =
  | "captado"
  | "em_preparacao"
  | "pronto"
  | "com_pendencia"
  | "reprovado";

export type EstadoComercial =
  | "disponivel"
  | "em_negociacao"
  | "em_processo_venda"
  | "fechado"
  | "arquivado";

export type EstadoAnuncio = "sem_anuncio" | "no_ar" | "pausado" | "removido";

export type NivelDominio = "captou" | "ja_visitou" | "conhece_regiao";

export type Agente =
  | "1_curador"
  | "2_guardiao"
  | "3_roteador"
  | "4_atendimento"
  // O 5 é o de consulta, que não é reativo e não entra no grafo: ninguém o
  // aciona por evento, ele responde quando perguntam.
  | "6_alterador";

export type TipoAprovacao =
  | "subir_anuncio"
  | "derrubar_midia"
  | "liberar_reprovado"
  | "escalacao_n3"
  | "aceite_corretor"
  | "fundir_identidade"
  | "aplicar_alteracao"
  | "reajuste_aluguel";

export interface Imovel {
  idImovel: string;
  estadoOperacional: EstadoOperacional;
  estadoComercial: EstadoComercial;
  estadoAnuncio: EstadoAnuncio;
}

export interface Anuncio {
  idAnuncio: string;
  idImovel: string;
  canal: string;
  status: EstadoAnuncio;
  midiaPaga: boolean;
  custoAcumulado: number;
}

export interface Corretor {
  idCorretor: string;
  ativo: boolean;
}

export interface Dominio {
  idCorretor: string;
  idImovel: string;
  nivel: NivelDominio;
}

export interface Slot {
  inicio: Date;
  fim: Date;
}

export interface Vinculo {
  idCliente: string;
  idCorretor: string;
  ultimaInteracao: Date;
  ativo: boolean;
}

export interface ConfigRoteamento {
  janelaVinculoDias: number;
  horizonteAgendaHoras: number;
  scoreMinimo: number;
  /** Minutos que o corretor tem pra aceitar antes do lead passar adiante. */
  prazoAceiteMin: number;
  /** Quantos corretores são acionados antes de o lead virar problema de humano. */
  maxOfertas: number;
  pesos: {
    captou: number;
    jaVisitou: number;
    conheceRegiao: number;
    disponibilidadeImediata: number;
    cargaBaixa: number;
  };
}

/** Motivo pelo qual uma decisão saiu do envelope e precisa de humano. */
export type MotivoEscalacao =
  | "nenhum_corretor_acima_do_minimo"
  | "sem_slot_no_horizonte"
  | "estado_comercial_mudou"
  | "ninguem_aceitou";

// --- Wave 8 ---

export type CanalIdentidade =
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "site"
  | "email"
  | "telefone"
  | "portal";

export interface Identidade {
  canal: CanalIdentidade;
  /** Já normalizado: minúsculo, sem @, sem acento. */
  identificador: string;
  apelido?: string | null;
}

/**
 * Tudo que se sabe de um contato no momento em que ele chega, e que pode
 * servir pra reconhecê-lo. Cada campo é opcional porque cada canal entrega um
 * subconjunto diferente — é justamente essa assimetria que torna o problema
 * difícil.
 */
export interface SinaisContato {
  canal: CanalIdentidade;
  identificador: string;
  apelido?: string | null;
  nome?: string | null;
  email?: string | null;
  cpf?: string | null;
  /** Imóvel que a pessoa citou nesta conversa. */
  idImovelCitado?: string | null;
  ultimaAtividade?: Date | null;
  busca?: {
    tipo?: string | null;
    bairros?: string[] | null;
    min?: number | null;
    max?: number | null;
  } | null;
}

export type EtapaAtendimento =
  | "primeiro_contato"
  | "qualificado"
  | "visita_agendada"
  | "visita_feita"
  | "proposta"
  | "negociacao"
  | "ganho"
  | "perdido";

export type EstadoAtendimento = "aberto" | "pendente" | "fechado";

export type EtapaEscritura =
  | "contrato_assinado"
  | "documentacao"
  | "itbi_emitido"
  | "itbi_pago"
  | "escritura_lavrada"
  | "registro_protocolado"
  | "registro_concluido"
  | "concluido"
  | "cancelado";

export type ResponsavelEtapa =
  | "imobiliaria"
  | "comprador"
  | "vendedor"
  | "cartorio"
  | "prefeitura"
  | "banco";
