import { MEDIDO, PESQUISADO, SUPOSTO } from "./parametros";

/**
 * O dia de um corretor, que é a variável que o sistema ignora.
 *
 * O roteamento hoje pergunta uma coisa só — "tem horário livre na agenda?" — e
 * decide como se estar livre na agenda fosse o mesmo que estar disponível pra
 * responder. Não é. Entre duas visitas o corretor está dirigindo; dentro de
 * uma visita ele está com um cliente na frente. Nos dois casos a agenda diz
 * "livre" e o celular diz outra coisa.
 *
 * Cinco estados, e o que muda entre eles é só a chance de responder em 5
 * minutos.
 */

export type Estado = "dormindo" | "fora_do_expediente" | "livre" | "dirigindo" | "em_visita";

/** Sorteio com semente: mesma semente, mesmo resultado, sempre. */
export function sorteio(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hora = (d: Date) => d.getHours() + d.getMinutes() / 60;

/**
 * O dia de um corretor, montado uma vez por dia e por pessoa.
 *
 * As visitas caem dentro do bloco de tarde que as rotinas publicadas do setor
 * descrevem (12h–16h30), e cada visita arrasta um deslocamento antes dela — é
 * daí que sai o tempo dirigindo, em vez de um percentual solto no ar.
 */
export interface Bloco {
  de: number;
  ate: number;
  estado: Estado;
}

export function diaDoCorretor(data: Date, aleatorio: () => number): Bloco[] {
  const diaDaSemana = data.getDay();
  const abre = MEDIDO.expedienteInicio.valor;
  const fecha = MEDIDO.expedienteFim.valor;

  if (!MEDIDO.diasUteis.valor.includes(diaDaSemana)) {
    return [
      { de: 0, ate: 24, estado: "fora_do_expediente" },
    ];
  }

  const blocos: Bloco[] = [
    { de: 0, ate: 6, estado: "dormindo" },
    { de: 6, ate: abre, estado: "fora_do_expediente" },
  ];

  const [inicioVisitas, fimVisitas] = PESQUISADO.blocoDeVisitas.valor;
  const duracao = SUPOSTO.duracaoVisitaMin.valor / 60;
  // O deslocamento é derivado, não chutado direto: a fração de direção do dia
  // dividida pelas visitas dá quanto tempo de carro cada visita arrasta.
  const horasUteis = fecha - abre;
  const desloc =
    (horasUteis * SUPOSTO.fracaoDirigindo.valor) / Math.max(1, SUPOSTO.visitasPorDia.valor);

  let cursor = abre;
  const janela = fimVisitas - inicioVisitas;

  const compromissos = Array.from({ length: SUPOSTO.visitasPorDia.valor }, (_, i) => {
    const fatia = janela / SUPOSTO.visitasPorDia.valor;
    return inicioVisitas + i * fatia + aleatorio() * Math.max(0, fatia - duracao - desloc);
  }).sort((a, b) => a - b);

  for (const inicio of compromissos) {
    const saida = Math.max(cursor, inicio - desloc);
    if (saida > cursor) blocos.push({ de: cursor, ate: saida, estado: "livre" });
    blocos.push({ de: saida, ate: inicio, estado: "dirigindo" });
    blocos.push({ de: inicio, ate: inicio + duracao, estado: "em_visita" });
    // A volta conta como direção: o corretor não teleporta da visita pro escritório.
    blocos.push({ de: inicio + duracao, ate: inicio + duracao + desloc, estado: "dirigindo" });
    cursor = inicio + duracao + desloc;
  }

  if (cursor < fecha) blocos.push({ de: cursor, ate: fecha, estado: "livre" });
  blocos.push({ de: fecha, ate: 22, estado: "fora_do_expediente" });
  blocos.push({ de: 22, ate: 24, estado: "dormindo" });

  return blocos.filter((b) => b.ate > b.de);
}

export function estadoEm(blocos: Bloco[], momento: Date): Estado {
  const h = hora(momento);
  return blocos.find((b) => h >= b.de && h < b.ate)?.estado ?? "fora_do_expediente";
}

/** Quando ele volta a ficar livre depois deste instante, em minutos. */
export function minutosAteFicarLivre(blocos: Bloco[], momento: Date): number | null {
  const h = hora(momento);
  const proximo = blocos.find((b) => b.de > h && b.estado === "livre");
  return proximo ? (proximo.de - h) * 60 : null;
}

/**
 * Quanto tempo até este corretor responder — ou nunca.
 *
 * As três coisas que decidem, nesta ordem: ele abriu a mensagem (68%), ele
 * estava em condição de responder, e quanto tempo levou pra olhar o celular.
 * Devolver `null` significa que a resposta não vem dentro do prazo — que é
 * exatamente o caso que a operação de hoje trata como "recusou".
 */
export function latenciaDaResposta(
  estado: Estado,
  blocos: Bloco[],
  momento: Date,
  aleatorio: () => number,
): number | null {
  if (aleatorio() > PESQUISADO.aberturaWhatsApp.valor) return null;

  const [minSeg, maxSeg] = PESQUISADO.respostaWhatsAppSeg.valor;
  const respostaImediataMin = (minSeg + aleatorio() * (maxSeg - minSeg)) / 60;
  const [atrasoMin, atrasoMax] = SUPOSTO.atrasoAoFicarLivreMin.valor;
  const olharCelular = atrasoMin + aleatorio() * (atrasoMax - atrasoMin);

  switch (estado) {
    case "dormindo":
      return null;

    case "livre":
      if (aleatorio() < SUPOSTO.ignoraLivre.valor) return null;
      return respostaImediataMin;

    case "dirigindo":
      if (aleatorio() < SUPOSTO.respondeDirigindo.valor) return respostaImediataMin;
      break;

    case "em_visita":
      if (aleatorio() < SUPOSTO.respondeEmVisita.valor) return respostaImediataMin;
      break;

    case "fora_do_expediente":
      // Fora do horário ele até olha, mas sem pressa e sem obrigação.
      if (aleatorio() < 0.4) return olharCelular + respostaImediataMin;
      return null;
  }

  // Ocupado: responde quando ficar livre, mais o tempo de olhar o celular.
  const espera = minutosAteFicarLivre(blocos, momento);
  if (espera === null) return null;
  return espera + olharCelular + respostaImediataMin;
}
