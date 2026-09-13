import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * A operação semana a semana, das tabelas que já guardam data.
 *
 * Uma consulta só, com `generate_series` para as semanas vazias aparecerem
 * como zero: semana sem lead é informação, e some de um `GROUP BY` puro.
 * Mediana e não média no tempo de decisão: um pedido esquecido num feriado
 * puxaria a média para cima e esconderia a semana normal.
 */
export interface Semana {
  semana: Date;
  leads: number;
  decididos: number;
  negados: number;
  expirados: number;
  horasAteDecidir: number | null;
  leituras: number;
  falhasModelo: number;
}

export async function porSemana(semanas = 12): Promise<Semana[]> {
  const r = await db.execute(sql`
    with s as (
      select generate_series(
        date_trunc('week', now()) - make_interval(weeks => ${semanas - 1}),
        date_trunc('week', now()),
        interval '1 week'
      ) as semana
    )
    select
      s.semana,
      (select count(*) from atendimento a
        where date_trunc('week', a.criado_em) = s.semana)::int as leads,
      (select count(*) from aprovacao p
        where p.estado in ('aprovado','negado') and date_trunc('week', p.decidido_em) = s.semana)::int as decididos,
      (select count(*) from aprovacao p
        where p.estado = 'negado' and date_trunc('week', p.decidido_em) = s.semana)::int as negados,
      (select count(*) from aprovacao p
        where p.estado = 'expirado' and date_trunc('week', p.expira_em) = s.semana)::int as expirados,
      (select round((percentile_cont(0.5) within group (
          order by extract(epoch from p.decidido_em - p.criado_em)) / 3600)::numeric, 1)
        from aprovacao p
        where p.decidido_em is not null and date_trunc('week', p.decidido_em) = s.semana)::float as "horasAteDecidir",
      (select count(*) from leitura_modelo l
        where date_trunc('week', l.criado_em) = s.semana)::int as leituras,
      (select count(*) from leitura_modelo l
        where l.erro is not null and date_trunc('week', l.criado_em) = s.semana)::int as "falhasModelo"
    from s
    order by s.semana desc
  `);
  // ponytail: subconsulta por semana × métrica; com volume de produção, troca por um join agregado
  return r.rows as unknown as Semana[];
}
