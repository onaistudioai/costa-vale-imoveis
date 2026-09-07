import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { calcularEncargos, calcularRepasse, reajusteDevido } from "@/regras/locacao";
import { avaliarProcesso, faltando, progresso } from "@/regras/escritura";

/**
 * As consultas das telas de locação e escrituras.
 *
 * Ficam fora de `app/` pela mesma razão de `painel.ts`: dá pra testar sem
 * subir o Next. E são as duas telas que precisam de regra na leitura — o
 * número que interessa (quanto está em atraso, o processo está travado?) não
 * está guardado em coluna nenhuma, é calculado na hora contra o relógio.
 */

const num = (v: string | null) => Number(v ?? 0);

function paraContrato(c: typeof schema.contratoLocacao.$inferSelect) {
  return {
    idContrato: c.idContrato,
    valorAluguel: num(c.valorAluguel),
    valorCondominio: num(c.valorCondominio),
    valorIptu: num(c.valorIptu),
    diaVencimento: c.diaVencimento,
    inicio: c.inicio,
    fim: c.fim,
    ultimoReajuste: c.ultimoReajuste,
    taxaAdministracao: num(c.taxaAdministracao),
    multaAtraso: num(c.multaAtraso),
    jurosMes: num(c.jurosMes),
  };
}

export async function carteiraDeLocacao(agora = new Date()) {
  const contratos = await db
    .select({
      c: schema.contratoLocacao,
      imovel: schema.imovel,
      inquilino: schema.cliente.nome,
    })
    .from(schema.contratoLocacao)
    .innerJoin(schema.imovel, eq(schema.imovel.idImovel, schema.contratoLocacao.idImovel))
    .innerJoin(
      schema.cliente,
      eq(schema.cliente.idCliente, schema.contratoLocacao.idInquilino),
    )
    .where(ne(schema.contratoLocacao.estado, "encerrado"))
    .orderBy(asc(schema.contratoLocacao.fim));

  const parcelas = await db
    .select()
    .from(schema.parcelaAluguel)
    .where(
      or(
        eq(schema.parcelaAluguel.estado, "aberta"),
        eq(schema.parcelaAluguel.estado, "atrasada"),
      ),
    )
    .orderBy(asc(schema.parcelaAluguel.vencimento));

  let receitaMensal = 0;
  let emAtraso = 0;

  const linhas = contratos.map(({ c, imovel, inquilino }) => {
    const contrato = paraContrato(c);
    receitaMensal += calcularRepasse(contrato, contrato.valorAluguel).taxa;

    const minhas = parcelas
      .filter((p) => p.idContrato === c.idContrato)
      .map((p) => {
        const base = {
          competencia: p.competencia,
          vencimento: p.vencimento,
          valorBase: num(p.valorBase),
          estagioCobranca: p.estagioCobranca,
        };
        const encargos = calcularEncargos(contrato, base, agora);
        if (encargos.dias > 0) emAtraso += encargos.total;
        return { ...base, idParcela: p.idParcela, estado: p.estado, ...encargos };
      });

    return {
      idContrato: c.idContrato,
      imovel: `${imovel.tipo} — ${imovel.endereco}`,
      inquilino,
      valorAluguel: contrato.valorAluguel,
      indice: c.indice,
      fim: c.fim,
      // O índice do ano não está no banco: a tela mostra que é devido e pede o
      // número a quem tem. Inventar esse valor seria a pior mentira possível.
      reajuste: reajusteDevido(contrato, null, agora),
      parcelas: minhas,
      atrasadas: minhas.filter((p) => p.dias > 0).length,
    };
  });

  return {
    contratos: linhas,
    resumo: {
      ativos: linhas.length,
      receitaMensal: Math.round(receitaMensal * 100) / 100,
      emAtraso: Math.round(emAtraso * 100) / 100,
      reajustesDevidos: linhas.filter((l) => l.reajuste.devido).length,
    },
  };
}

export async function esteiraDeEscrituras(agora = new Date()) {
  const linhas = await db
    .select({
      p: schema.processoEscritura,
      imovel: schema.imovel,
      comprador: schema.cliente.nome,
    })
    .from(schema.processoEscritura)
    .innerJoin(schema.imovel, eq(schema.imovel.idImovel, schema.processoEscritura.idImovel))
    .leftJoin(
      schema.cliente,
      eq(schema.cliente.idCliente, schema.processoEscritura.idComprador),
    )
    .where(ne(schema.processoEscritura.etapa, "cancelado"))
    .orderBy(asc(schema.processoEscritura.etapaDesde));

  const processos = linhas.map(({ p, imovel, comprador }) => ({
    idProcesso: p.idProcesso,
    etapa: p.etapa,
    etapaDesde: p.etapaDesde,
    imovel: `${imovel.tipo} — ${imovel.endereco}`,
    comprador,
    matricula: p.matricula,
    cartorio: p.cartorioRegistro ?? p.cartorioNotas,
    progresso: progresso(p.etapa),
    faltando: faltando(p.etapa, p.documentosEntregues ?? []),
    alerta: avaliarProcesso(
      { etapa: p.etapa, etapaDesde: p.etapaDesde, documentosEntregues: p.documentosEntregues },
      agora,
    ),
  }));

  return {
    processos,
    // A separação que faz a lista ser usada em vez de ignorada: cobrar prazo
    // de cartório é ensinar a equipe a ignorar o alerta inteiro.
    nossos: processos.filter((p) => p.alerta?.acionavel),
    acompanhar: processos.filter((p) => p.alerta && !p.alerta.acionavel),
    emDia: processos.filter((p) => !p.alerta && p.etapa !== "concluido"),
    concluidos: processos.filter((p) => p.etapa === "concluido").length,
  };
}
