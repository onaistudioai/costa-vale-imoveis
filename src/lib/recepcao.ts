import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reconhecer, vincular } from "@/lib/identidade-db";
import { normalizar, perguntaDeConfirmacao } from "@/regras/identidade";
import type { CanalIdentidade, SinaisContato } from "@/tipos";

/**
 * A porta por onde uma pessoa entra.
 *
 * Existe porque a pergunta "quem é essa pessoa?" precisa estar respondida
 * **antes** do grafo rodar: a chave de lock do Agente 4 é o cliente, então não
 * dá pra descobrir isso lá dentro. É aqui que a identidade multicanal deixa de
 * ser regra testada e passa a valer na prática.
 *
 * A decisão de desenho que importa é o que acontece no caso do meio, quando o
 * sistema *acha* que já conhece a pessoa mas não tem certeza:
 *
 * > **O atendimento não espera a fusão.** Cria o cadastro, responde na hora, e
 * > manda o pedido de fusão pro painel em paralelo.
 *
 * O contrário — segurar a conversa até alguém confirmar — significaria deixar
 * um cliente de 3h da manhã sem resposta até as 7h30 por causa de uma dúvida
 * interna de cadastro. Duplicata é reversível com um clique; lead sem resposta
 * não volta.
 */

export interface Contato {
  canal: CanalIdentidade;
  /** O que o canal entrega: @handle, wa_id, id do perfil, e-mail. */
  identificador: string;
  /** Como o perfil se apresenta — nome do WhatsApp, nome da conta do Insta. */
  apelido?: string | null;
  mensagem: string;
  idImovelCitado?: string | null;
}

export interface Recepcao {
  idCliente: string;
  /** `true` quando o cadastro nasceu agora. */
  novo: boolean;
  /**
   * Preenchido quando o sistema suspeita que esta pessoa já existe. A conversa
   * segue normalmente; isto só vira linha na fila do painel.
   */
  fusaoSugerida?: {
    idCandidato: string;
    nomeCandidato: string;
    pontos: number;
    motivos: string[];
    concorrentes: number;
    /** A pergunta que o atendimento pode fazer pra resolver sem humano nenhum. */
    pergunta: string;
  };
  idAtendimento: string;
}

/** Nome de exibição decente a partir do que o canal entregou. */
const rotular = (c: Contato) =>
  (c.apelido?.trim() || c.identificador.replace(/^@/, "")).slice(0, 255);

export async function receber(c: Contato, agora = new Date()): Promise<Recepcao> {
  const sinais: SinaisContato = {
    canal: c.canal,
    identificador: c.identificador,
    apelido: c.apelido,
    idImovelCitado: c.idImovelCitado,
  };

  const veredito = await reconhecer(sinais, agora);

  let idCliente: string;
  let novo = false;
  let fusaoSugerida: Recepcao["fusaoSugerida"];

  if (veredito.acao === "vincular") {
    idCliente = veredito.idCliente;

    // HOOTL declarado: reconhecer alguém por CPF igual ou por um canal já
    // registrado nele é consulta de chave, não palpite — roda sozinho de
    // propósito. Mas o que roda sozinho tem que aparecer em algum lugar, senão
    // não há como conferir que reconheceu certo.
    await db.insert(schema.logEvento).values({
      agenteOrigem: "regra",
      entidade: "cliente",
      idEntidade: idCliente,
      campo: "identidade.reconhecida",
      valorAnterior: c.canal,
      valorNovo: veredito.motivo,
    });
  } else {
    // Tanto o palpite quanto o desconhecido criam cadastro. A diferença é que
    // o palpite também abre o pedido de fusão — a conversa não fica esperando.
    const [criado] = await db
      .insert(schema.cliente)
      .values({ nome: rotular(c), origemCanal: c.canal })
      .returning({ id: schema.cliente.idCliente });

    idCliente = criado!.id;
    novo = true;

    // Criar cadastro sozinho é decisão consciente e está certa: duplicata é
    // reversível com um clique, lead sem resposta não volta. O que faltava era
    // o rastro — sem ele, a única prova de que o sistema criou alguém é a
    // `dataEntrada` da linha.
    await db.insert(schema.logEvento).values({
      agenteOrigem: "regra",
      entidade: "cliente",
      idEntidade: idCliente,
      campo: "cliente.criado",
      valorAnterior: c.canal,
      valorNovo: veredito.acao === "sugerir_fusao" ? "com palpite de fusão" : "sem palpite",
    });

    if (veredito.acao === "sugerir_fusao") {
      const [cand] = await db
        .select({ nome: schema.cliente.nome })
        .from(schema.cliente)
        .where(eq(schema.cliente.idCliente, veredito.palpite.idCliente));

      fusaoSugerida = {
        idCandidato: veredito.palpite.idCliente,
        nomeCandidato: cand?.nome ?? "(sem nome)",
        pontos: veredito.palpite.pontos,
        motivos: veredito.palpite.motivos,
        concorrentes: veredito.concorrentes,
        pergunta: perguntaDeConfirmacao(
          { nome: cand?.nome ?? "" },
          // O canal em que a outra ponta foi vista, pra pergunta fazer sentido
          // pra quem lê ("você já falou pelo instagram?").
          veredito.palpite.motivos.join(" ").includes("instagram") ? "instagram" : c.canal,
        ),
      };
    }
  }

  await vincular(idCliente, sinais);

  return {
    idCliente,
    novo,
    fusaoSugerida,
    idAtendimento: await tocarAtendimento(idCliente, c.idImovelCitado ?? null, agora),
  };
}

/**
 * Abre ou reativa o caso no funil.
 *
 * Mensagem que chega **sempre** devolve a bola pra nós: `ultimoContatoPor` vira
 * `cliente` e o caso volta pra `aberto`, inclusive quando estava marcado como
 * precisando de desfecho. Alguém que reaparece depois de 40 dias de silêncio
 * não é um caso pendurado, é um caso vivo — e o `etapaMaxima` guarda que ele já
 * esteve mais fundo, então ele reaparece no topo, não no fim.
 */
async function tocarAtendimento(
  idCliente: string,
  idImovel: string | null,
  agora: Date,
): Promise<string> {
  const [existente] = await db
    .select()
    .from(schema.atendimento)
    .where(
      and(
        eq(schema.atendimento.idCliente, idCliente),
        idImovel === null
          ? isNull(schema.atendimento.idImovel)
          : eq(schema.atendimento.idImovel, idImovel),
      ),
    )
    .limit(1);

  if (existente) {
    const reabrindo = existente.estado === "fechado";

    // O motivo do desfecho é apagado logo abaixo, e ele foi escrito por gente.
    // Sem esta linha, o relatório de "por que perdemos" perde um caso toda vez
    // que um cliente encerrado manda um "oi" — silenciosamente, e sem jeito de
    // recuperar. `funil.ts` diz que fechar exige motivo porque é a pergunta que
    // paga o relatório; então o motivo não pode sumir quando o caso reabre.
    if (reabrindo && existente.motivoDesfecho) {
      await db.insert(schema.logEvento).values({
        agenteOrigem: "regra",
        entidade: "atendimento",
        idEntidade: existente.idAtendimento,
        campo: "atendimento.reabertura",
        valorAnterior: existente.motivoDesfecho,
        valorNovo: "reaberto pelo cliente",
      });
    }

    await db
      .update(schema.atendimento)
      .set({
        estado: "aberto",
        ultimaInteracao: agora,
        ultimoContatoPor: "cliente",
        // Reabre o que estava esperando desfecho: quem voltou a falar não
        // precisa de ponto final, precisa de resposta.
        precisaDesfecho: false,
        ...(reabrindo
          ? { etapa: "primeiro_contato" as const, motivoDesfecho: null }
          : {}),
      })
      .where(eq(schema.atendimento.idAtendimento, existente.idAtendimento));
    return existente.idAtendimento;
  }

  const [criado] = await db
    .insert(schema.atendimento)
    .values({
      idCliente,
      idImovel,
      ultimaInteracao: agora,
      ultimoContatoPor: "cliente",
    })
    .returning({ id: schema.atendimento.idAtendimento });

  return criado!.id;
}

/**
 * Registra o pedido de fusão na fila do painel.
 *
 * Fora do grafo de propósito: nenhuma thread está parada esperando isto, e não
 * deve estar. É um pedido assíncrono que alguém resolve quando puder — o
 * atendimento já seguiu sem ele.
 */
export async function pedirFusao(
  idEvento: string,
  r: Recepcao & { fusaoSugerida: NonNullable<Recepcao["fusaoSugerida"]> },
): Promise<void> {
  await db
    .insert(schema.aprovacao)
    .values({
      tipo: "fundir_identidade",
      entidade: "cliente",
      idEntidade: r.idCliente,
      solicitadoPorAgente: "4_atendimento",
      idEvento,
      // O candidato viaja no destinatário: é o outro lado da fusão, e é ele
      // que sobrevive se alguém aprovar.
      destinatario: r.fusaoSugerida.idCandidato,
      contexto: {
        novo: r.idCliente,
        candidato: r.fusaoSugerida.idCandidato,
        nomeCandidato: r.fusaoSugerida.nomeCandidato,
        pontos: r.fusaoSugerida.pontos,
        motivos: r.fusaoSugerida.motivos,
        concorrentes: r.fusaoSugerida.concorrentes,
        pergunta: r.fusaoSugerida.pergunta,
      },
    })
    .onConflictDoNothing({
      target: [schema.aprovacao.idEvento, schema.aprovacao.tipo, schema.aprovacao.idEntidade],
    });
}

export { normalizar };
