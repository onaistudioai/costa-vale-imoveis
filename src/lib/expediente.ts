import { EXPEDIENTE } from "./config";

/**
 * Que horas a equipe existe.
 *
 * O sistema atende 24h — cliente manda mensagem 3h de um domingo e é
 * respondido na hora. **Alocar corretor não é 24h**, e essa é a distinção que
 * faltava: sem ela, um lead de madrugada queima os três melhores corretores em
 * quinze minutos de rodízio contra gente que está dormindo, e ainda registra
 * os três como "não respondeu".
 *
 * Este arquivo é o único lugar que sabe disso. Quem precisa de horário
 * pergunta aqui.
 */

const MIN_POR_DIA = 24 * 60;

const minutosDoDia = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Imobiliária trabalha sábado. Domingo não. ponytail: calibração, não dogma. */
export const ehDiaUtil = (d: Date) => EXPEDIENTE.diasUteis.includes(d.getDay());

export function dentroDoExpediente(d: Date): boolean {
  if (!ehDiaUtil(d)) return false;
  const m = minutosDoDia(d);
  return m >= EXPEDIENTE.inicioMin && m < EXPEDIENTE.fimMin;
}

/**
 * O próximo instante em que existe alguém pra responder.
 *
 * Devolve o próprio momento quando já está no expediente — é o caso comum, e
 * quem chama não precisa saber a diferença.
 */
export function proximaAbertura(d: Date): Date {
  if (dentroDoExpediente(d)) return d;

  const abertura = new Date(d);
  abertura.setSeconds(0, 0);

  // Ainda é hoje e o expediente não abriu: espera abrir.
  if (ehDiaUtil(d) && minutosDoDia(d) < EXPEDIENTE.inicioMin) {
    abertura.setHours(0, EXPEDIENTE.inicioMin, 0, 0);
    return abertura;
  }

  // Passou do fim, ou é domingo: procura o próximo dia que trabalha.
  do {
    abertura.setDate(abertura.getDate() + 1);
  } while (!ehDiaUtil(abertura));

  abertura.setHours(0, EXPEDIENTE.inicioMin, 0, 0);
  return abertura;
}

/**
 * Grade de horários candidatos a visita dentro de uma janela.
 *
 * Ancorada no início do expediente e andando de `passoMin` em `passoMin`; um
 * horário só entra se couber inteiro antes do fim do expediente daquele dia, e
 * dias sem expediente não entram.
 */
export function gradeDeHorarios(de: Date, ate: Date): { inicio: Date; fim: Date }[] {
  const grade: { inicio: Date; fim: Date }[] = [];
  const dia = new Date(de);
  dia.setHours(0, 0, 0, 0);

  while (dia < ate) {
    if (ehDiaUtil(dia)) {
      for (
        let m = EXPEDIENTE.inicioMin;
        m + EXPEDIENTE.duracaoMin <= EXPEDIENTE.fimMin;
        m += EXPEDIENTE.passoMin
      ) {
        const inicio = new Date(dia.getTime() + m * 60_000);
        const fim = new Date(inicio.getTime() + EXPEDIENTE.duracaoMin * 60_000);
        if (inicio > de && inicio < ate) grade.push({ inicio, fim });
      }
    }
    dia.setTime(dia.getTime() + MIN_POR_DIA * 60_000);
    dia.setHours(0, 0, 0, 0);
  }
  return grade;
}
