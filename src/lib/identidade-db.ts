import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { normalizar, nucleos, resolverIdentidade, type Veredito } from "@/regras/identidade";
import type { CanalIdentidade, Identidade, SinaisContato } from "@/tipos";
import { cifrar, decifrar, indice } from "@/lib/cripto";

/**
 * Reconhecer quem chegou, sem telefone.
 *
 * O caminho é sempre o mesmo e a ordem importa:
 *
 * 1. Achar o identificador exato do canal. Se existir, acabou — é ele.
 * 2. Senão, levantar um punhado de candidatos plausíveis (não a base inteira).
 * 3. Pontuar cada um pelas regras puras e decidir: vincular, sugerir ou criar.
 *
 * O passo 2 é o que mantém isso barato: comparar contra todo mundo seria
 * varredura de tabela a cada mensagem recebida, e o sistema recebe mensagem a
 * noite toda. Os candidatos saem de três buscas — mesmo e-mail, apelido
 * parecido, e quem falou do mesmo imóvel nos últimos dias.
 *
 * O `identificador` fica cifrado no banco (`src/lib/cripto.ts`), o que muda
 * duas coisas aqui: a busca exata passa pelo índice cego, e a busca difusa
 * sobre ele deixou de ser `ILIKE` no Postgres — vira comparação em memória,
 * porque `%jumendes%` não casa com ciphertext. O apelido continua em claro e
 * continua no `ILIKE`: é nome de exibição, não identificador de canal.
 */

/** Quantos candidatos vale a pena comparar. Acima disso o sinal já é ruído. */
const TETO_CANDIDATOS = 25;

/**
 * Teto da varredura decifrada. Existe porque a busca difusa sobre o
 * identificador cifrado não tem índice — e uma consulta sem teto é a que
 * derruba o sistema no dia em que a base cresce sem ninguém olhar.
 */
const TETO_VARREDURA = 5_000;

export async function identidadesDe(idCliente: string): Promise<Identidade[]> {
  const linhas = await db
    .select()
    .from(schema.identidade)
    .where(eq(schema.identidade.idCliente, idCliente));
  return linhas.map((l) => ({
    canal: l.canal,
    identificador: decifrar(l.identificador) ?? "",
    apelido: l.apelido,
  }));
}

/**
 * Passo 1: a âncora determinística. Uma consulta, um índice único.
 *
 * Pelo índice cego, não pela cifra: duas gravações do mesmo `@` produzem
 * cifras diferentes de propósito, então `WHERE identificador = ?` nunca
 * acharia nada.
 */
export async function clientePorIdentidade(
  canal: CanalIdentidade,
  identificador: string,
): Promise<string | null> {
  const [linha] = await db
    .select({ idCliente: schema.identidade.idCliente })
    .from(schema.identidade)
    .where(
      and(
        eq(schema.identidade.canal, canal),
        eq(schema.identidade.identificadorIndice, indice(normalizar(identificador))),
      ),
    )
    .limit(1);
  return linha?.idCliente ?? null;
}

/**
 * Passo 2: quem vale a pena comparar.
 *
 * Nenhuma dessas buscas usa telefone. A do apelido é a que substitui ele na
 * prática: `ILIKE '%jumendes%'` sobre o miolo do handle acha `ju.mendes.sp`,
 * `ju_mendes` e `Ju Mendes` — as três formas em que a mesma pessoa aparece em
 * canais diferentes.
 */
async function levantarCandidatos(novo: SinaisContato): Promise<string[]> {
  const ids = new Set<string>();
  // Todos os apelidos que este contato carrega, não só o identificador: no
  // WhatsApp o identificador é um número e quem carrega o nome é o perfil.
  const meus = nucleos(novo);

  if (novo.email) {
    const porEmail = await db
      .select({ id: schema.cliente.idCliente })
      .from(schema.cliente)
      .where(eq(schema.cliente.emailIndice, indice(novo.email)))
      .limit(5);
    porEmail.forEach((c) => ids.add(c.id));
  }

  if (meus.length > 0) {
    // O apelido continua no banco: está em claro e o índice funciona.
    const porApelido = await db
      .select({ id: schema.identidade.idCliente })
      .from(schema.identidade)
      .where(
        or(
          ...meus.map(
            (nucleo) =>
              sql`replace(replace(lower(coalesce(${schema.identidade.apelido}, '')), '.', ''), ' ', '') ILIKE ${`%${nucleo}%`}`,
          ),
        ),
      )
      .limit(TETO_CANDIDATOS);
    porApelido.forEach((c) => ids.add(c.id));

    // O identificador não: cifrado, `%jumendes%` não casa com nada. A mesma
    // comparação acontece aqui, depois de decifrar — é o que mantém
    // `ju.mendes.sp`, `ju_mendes` e `jumendes` caindo na mesma pessoa.
    //
    // ponytail: varredura da tabela; trocar por pg_trgm sobre um índice cego
    // de n-gramas se `identidade` passar de ~50k linhas.
    const todas = await db
      .select({ id: schema.identidade.idCliente, cifra: schema.identidade.identificador })
      .from(schema.identidade)
      .limit(TETO_VARREDURA);

    for (const linha of todas) {
      const alvo = (decifrar(linha.cifra) ?? "").replace(/[._]/g, "").toLowerCase();
      if (alvo && meus.some((nucleo) => alvo.includes(nucleo))) ids.add(linha.id);
    }
  }

  if (novo.idImovelCitado) {
    const porImovel = await db
      .select({ id: schema.atendimento.idCliente })
      .from(schema.atendimento)
      .where(
        and(
          eq(schema.atendimento.idImovel, novo.idImovelCitado),
          eq(schema.atendimento.estado, "aberto"),
        ),
      )
      .orderBy(desc(schema.atendimento.ultimaInteracao))
      .limit(10);
    porImovel.forEach((c) => ids.add(c.id));
  }

  return [...ids].slice(0, TETO_CANDIDATOS);
}

/** Passo 3: monta os sinais de cada candidato pra regra pura comparar. */
async function sinaisDe(
  ids: string[],
): Promise<(SinaisContato & { idCliente: string; identidades: Identidade[] })[]> {
  if (ids.length === 0) return [];

  const clientes = await db
    .select()
    .from(schema.cliente)
    .where(inArray(schema.cliente.idCliente, ids));

  const identidades = await db
    .select()
    .from(schema.identidade)
    .where(inArray(schema.identidade.idCliente, ids));

  const buscas = await db
    .select()
    .from(schema.busca)
    .where(inArray(schema.busca.idCliente, ids));

  const atendimentos = await db
    .select()
    .from(schema.atendimento)
    .where(inArray(schema.atendimento.idCliente, ids));

  return clientes.map((c) => {
    const b = buscas.find((x) => x.idCliente === c.idCliente);
    const a = atendimentos.find((x) => x.idCliente === c.idCliente);
    const minhas = identidades.filter((i) => i.idCliente === c.idCliente);
    return {
      idCliente: c.idCliente,
      // O primeiro canal conhecido serve de rótulo; a comparação real olha a
      // lista inteira em `identidades`.
      canal: (minhas[0]?.canal ?? "site") as CanalIdentidade,
      identificador: decifrar(minhas[0]?.identificador) ?? "",
      nome: c.nome,
      // A regra pura compara valores em claro; decifrar é aqui, na borda.
      email: decifrar(c.email),
      cpf: decifrar(c.cpfCnpj),
      idImovelCitado: a?.idImovel ?? null,
      ultimaAtividade: a?.ultimaInteracao ?? c.dataEntrada,
      busca: b
        ? {
            tipo: b.tipoImovel,
            bairros: b.bairrosDesejados,
            min: b.valorMin === null ? null : Number(b.valorMin),
            max: b.valorMax === null ? null : Number(b.valorMax),
          }
        : null,
      identidades: minhas.map((i) => ({
        canal: i.canal,
        identificador: decifrar(i.identificador) ?? "",
        apelido: i.apelido,
      })),
    };
  });
}

/**
 * A pergunta inteira: quem é essa pessoa?
 *
 * Devolve o veredito da regra sem escrever nada. Quem grava é o chamador —
 * separar isso é o que permite testar a decisão sem tocar no banco e, mais
 * importante, permite que o caminho "sugerir fusão" passe pela aprovação em
 * vez de virar escrita.
 */
export async function reconhecer(
  novo: SinaisContato,
  agora = new Date(),
): Promise<Veredito> {
  const direto = await clientePorIdentidade(novo.canal, novo.identificador);
  if (direto) {
    return { acao: "vincular", idCliente: direto, motivo: `já conhecido no ${novo.canal}` };
  }

  const candidatos = await sinaisDe(await levantarCandidatos(novo));
  return resolverIdentidade(novo, candidatos, agora);
}

/** Grava a identidade nova no cliente. Idempotente pelo índice único. */
export async function vincular(
  idCliente: string,
  novo: SinaisContato,
  origem: "deterministica" | "declarada" | "humana" = "deterministica",
): Promise<void> {
  await db
    .insert(schema.identidade)
    .values({
      idCliente,
      canal: novo.canal,
      // Normaliza primeiro, cifra depois: normalizar ciphertext é impossível,
      // e é a forma normalizada que precisa bater entre canais.
      identificador: cifrar(normalizar(novo.identificador))!,
      identificadorIndice: indice(normalizar(novo.identificador)),
      apelido: novo.apelido ?? novo.nome ?? null,
      origem,
    })
    .onConflictDoNothing({
      target: [schema.identidade.canal, schema.identidade.identificadorIndice],
    });
}

/**
 * Funde dois cadastros: tudo do perdedor passa pro vencedor.
 *
 * A ordem existe por causa dos índices únicos — identidade duplicada e
 * atendimento duplicado do mesmo par cliente/imóvel precisam ser resolvidos
 * antes do resto se mover, senão a fusão bate na própria trava que impede
 * duplicata.
 *
 * O perdedor não é apagado: vira um cadastro fechado apontando pro vencedor.
 * Apagar destruiria o histórico de quem falou o quê, que é justamente o que
 * torna a fusão auditável se ela tiver sido errada.
 */
export async function fundir(
  idVencedor: string,
  idPerdedor: string,
  por: string,
): Promise<void> {
  if (idVencedor === idPerdedor) return;

  await db
    .update(schema.identidade)
    .set({ idCliente: idVencedor, origem: "humana" })
    .where(eq(schema.identidade.idCliente, idPerdedor));

  // Atendimento do mesmo imóvel nos dois cadastros: fecha o do perdedor como
  // duplicado em vez de mover, senão colide com o índice único do par.
  const doVencedor = await db
    .select({ idImovel: schema.atendimento.idImovel })
    .from(schema.atendimento)
    .where(eq(schema.atendimento.idCliente, idVencedor));
  const ocupados = new Set(doVencedor.map((a) => a.idImovel));

  const doPerdedor = await db
    .select()
    .from(schema.atendimento)
    .where(eq(schema.atendimento.idCliente, idPerdedor));

  for (const a of doPerdedor) {
    if (ocupados.has(a.idImovel)) {
      await db
        .update(schema.atendimento)
        .set({
          estado: "fechado",
          etapa: "perdido",
          motivoDesfecho: "duplicado",
          precisaDesfecho: false,
        })
        .where(eq(schema.atendimento.idAtendimento, a.idAtendimento));
    } else {
      await db
        .update(schema.atendimento)
        .set({ idCliente: idVencedor })
        .where(eq(schema.atendimento.idAtendimento, a.idAtendimento));
    }
  }

  for (const t of [schema.busca, schema.papel, schema.vinculoLeadCorretor] as const) {
    await db.update(t).set({ idCliente: idVencedor }).where(eq(t.idCliente, idPerdedor));
  }

  await db
    .update(schema.cliente)
    .set({ origemCanal: `fundido:${idVencedor}` })
    .where(eq(schema.cliente.idCliente, idPerdedor));

  await db.insert(schema.logEvento).values({
    agenteOrigem: "humano",
    entidade: "cliente",
    idEntidade: idVencedor,
    campo: "cliente.fusao",
    valorAnterior: idPerdedor,
    valorNovo: idVencedor,
    aprovadoPor: por,
  });
}
