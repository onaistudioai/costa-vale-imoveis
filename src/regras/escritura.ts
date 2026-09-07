import type { EtapaEscritura, ResponsavelEtapa } from "@/tipos";

/**
 * O caminho do contrato assinado até a matrícula no nome do comprador.
 *
 * A ordem legal no Brasil, que é a razão de este módulo existir como esteira e
 * não como campo de status: **escritura não transfere imóvel, registro
 * transfere.** Muita gente (inclusive comprador) acha que acabou quando saiu
 * do cartório de notas; o imóvel só é dele quando o registro entra na
 * matrícula, o que leva mais 15 a 45 dias depois disso.
 *
 * E o detalhe que quebra qualquer tentativa de tratar isso como as outras
 * filas do sistema: **metade das etapas não é nossa.** Prefeitura leva o tempo
 * que leva pra emitir a guia do ITBI; cartório leva o tempo que leva pra
 * lavrar e registrar. Um prazo estourado ali não é falha de processo interno e
 * não pode expirar nada — só significa "ligue no cartório e pergunte".
 *
 * Por isso cada etapa carrega `responsavel`, e só o que é `imobiliaria`
 * entra na fila de trabalho. O resto vira acompanhamento.
 */

export interface Etapa {
  etapa: EtapaEscritura;
  rotulo: string;
  responsavel: ResponsavelEtapa;
  /** Prazo típico em dias. É expectativa pra detectar travamento, não SLA. */
  prazoDias: number;
  /** O que precisa existir pra etapa poder ser dada como concluída. */
  exige: string[];
}

/**
 * A esteira. Prazos vindos da prática de mercado: 1 a 7 dias pra lavrar a
 * escritura depois que a documentação está completa, 15 a 45 pro registro.
 * Usamos o topo da faixa — avisar cedo demais treina a equipe a ignorar aviso.
 */
export const ESTEIRA: Etapa[] = [
  {
    etapa: "contrato_assinado",
    rotulo: "Contrato de compra e venda assinado",
    responsavel: "imobiliaria",
    prazoDias: 3,
    exige: ["contrato assinado pelas partes"],
  },
  {
    etapa: "documentacao",
    rotulo: "Reunindo certidões e documentos",
    responsavel: "comprador",
    prazoDias: 15,
    exige: [
      "matrícula atualizada do imóvel",
      "certidão negativa de débitos do imóvel (IPTU)",
      "certidões do vendedor (pessoais e fiscais)",
      "documentos de identificação das partes",
      "certidão de estado civil",
    ],
  },
  {
    etapa: "itbi_emitido",
    rotulo: "Guia do ITBI emitida pela prefeitura",
    responsavel: "prefeitura",
    prazoDias: 10,
    exige: ["guia de ITBI emitida"],
  },
  {
    etapa: "itbi_pago",
    rotulo: "ITBI pago",
    responsavel: "comprador",
    prazoDias: 7,
    exige: ["comprovante de pagamento do ITBI"],
  },
  {
    etapa: "escritura_lavrada",
    rotulo: "Escritura pública lavrada no cartório de notas",
    responsavel: "cartorio",
    prazoDias: 7,
    exige: ["escritura pública assinada por comprador, vendedor e tabelião"],
  },
  {
    etapa: "registro_protocolado",
    rotulo: "Escritura protocolada no Registro de Imóveis",
    responsavel: "imobiliaria",
    prazoDias: 3,
    exige: ["número de protocolo do registro"],
  },
  {
    etapa: "registro_concluido",
    rotulo: "Registro averbado na matrícula",
    responsavel: "cartorio",
    // O prazo mais longo e o menos controlável da esteira. Exigência de
    // documento pelo registrador reinicia a contagem na prática.
    prazoDias: 45,
    exige: ["matrícula atualizada com o novo proprietário"],
  },
  {
    etapa: "concluido",
    rotulo: "Concluído — imóvel transferido",
    responsavel: "imobiliaria",
    prazoDias: 0,
    exige: [],
  },
];

const PORETAPA = new Map(ESTEIRA.map((e) => [e.etapa, e]));

export const etapaDe = (e: EtapaEscritura): Etapa | undefined => PORETAPA.get(e);

export function proximaEtapa(atual: EtapaEscritura): EtapaEscritura | null {
  const i = ESTEIRA.findIndex((e) => e.etapa === atual);
  if (i === -1 || i >= ESTEIRA.length - 1) return null;
  return ESTEIRA[i + 1]!.etapa;
}

/** Quanto do caminho já andou, pro comprador conseguir se localizar. */
export function progresso(atual: EtapaEscritura): { passo: number; total: number } {
  const total = ESTEIRA.length - 1;
  const i = ESTEIRA.findIndex((e) => e.etapa === atual);
  return { passo: i === -1 ? 0 : i, total };
}

/** Documentos da etapa que ainda não foram entregues. */
export function faltando(atual: EtapaEscritura, entregues: string[]): string[] {
  const etapa = PORETAPA.get(atual);
  if (!etapa) return [];
  const jaTem = entregues.map((d) => d.toLowerCase().trim());
  return etapa.exige.filter((d) => !jaTem.includes(d.toLowerCase().trim()));
}

export interface Alerta {
  gravidade: "atencao" | "critico";
  /** `true` só quando a bola é nossa — é o que separa fila de acompanhamento. */
  acionavel: boolean;
  texto: string;
  /** O que fazer, escrito pra quem vai fazer. */
  acao: string;
}

/**
 * O processo está parado demais?
 *
 * Repare no que esta função **não** faz: avançar etapa, cancelar processo ou
 * cobrar prazo de terceiro como se fosse nosso. Cartório atrasado não gera
 * tarefa vencida, gera um "liga lá e pergunta o protocolo" — e essa distinção
 * é a diferença entre um sistema que a equipe usa e um que ela silencia.
 */
export function avaliarProcesso(
  p: { etapa: EtapaEscritura; etapaDesde: Date; documentosEntregues: string[] | null },
  agora = new Date(),
): Alerta | null {
  const etapa = PORETAPA.get(p.etapa);
  if (!etapa || p.etapa === "concluido" || p.etapa === "cancelado") return null;

  const dias = Math.floor((agora.getTime() - p.etapaDesde.getTime()) / 86_400_000);
  if (dias <= etapa.prazoDias) return null;

  const nosso = etapa.responsavel === "imobiliaria";
  const dobro = dias > etapa.prazoDias * 2;
  const pendentes = faltando(p.etapa, p.documentosEntregues ?? []);

  if (nosso) {
    return {
      gravidade: dobro ? "critico" : "atencao",
      acionavel: true,
      texto: `Parado há ${dias} dias em "${etapa.rotulo}" — e essa etapa é nossa.`,
      acao: pendentes.length
        ? `Falta: ${pendentes.join("; ")}.`
        : "Concluir a etapa e avançar o processo.",
    };
  }

  // Duas formas do mesmo nome porque as duas frases pedem contração diferente:
  // "Cobrar **o** comprador" e "Depende **do** comprador".
  const deQuem: Record<ResponsavelEtapa, { artigo: string; de: string }> = {
    imobiliaria: { artigo: "nós", de: "de nós" },
    comprador: { artigo: "o comprador", de: "do comprador" },
    vendedor: { artigo: "o vendedor", de: "do vendedor" },
    cartorio: { artigo: "o cartório", de: "do cartório" },
    prefeitura: { artigo: "a prefeitura", de: "da prefeitura" },
    banco: { artigo: "o banco", de: "do banco" },
  };

  return {
    gravidade: dobro ? "critico" : "atencao",
    acionavel: false,
    texto: `Há ${dias} dias em "${etapa.rotulo}" (prazo típico: ${etapa.prazoDias}). Depende ${deQuem[etapa.responsavel].de}.`,
    acao:
      etapa.responsavel === "cartorio" || etapa.responsavel === "prefeitura"
        ? "Consultar o andamento e registrar o retorno — não há prazo interno a cobrar."
        : `Cobrar ${deQuem[etapa.responsavel].artigo}: ${pendentes.join("; ") || etapa.exige.join("; ")}.`,
  };
}

/**
 * Custo estimado da transferência, pra dizer ao comprador antes e não depois.
 * ITBI fica entre 2% e 3% conforme o município (Sorocaba: 2%), e o total com
 * emolumentos e registro chega a 4–5% do valor do imóvel.
 */
export function custoEstimado(valorImovel: number, aliquotaItbi = 2) {
  const itbi = Math.round(valorImovel * (aliquotaItbi / 100) * 100) / 100;
  const cartorio = Math.round(valorImovel * 0.02 * 100) / 100;
  return { itbi, cartorio, total: Math.round((itbi + cartorio) * 100) / 100 };
}
