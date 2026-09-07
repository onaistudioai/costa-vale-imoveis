import { carteiraDeLocacao } from "@/lib/painel-ciclos";
import { REGUA_COBRANCA } from "@/regras/locacao";

export const dynamic = "force-dynamic";

const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (d: Date) => d.toLocaleDateString("pt-BR");

/**
 * A carteira de locação.
 *
 * A diferença de tudo que existe no resto do sistema: aqui nada "acontece" —
 * o tempo passa. Um contrato ativo não gera evento nenhum e mesmo assim gera
 * trabalho todo mês. Por isso esta tela é sobre datas, não sobre fila.
 */
export default async function Locacao() {
  const { contratos, resumo } = await carteiraDeLocacao();

  return (
    <>
      <h1>Locação</h1>
      <p className="sub">
        Contratos ativos, o que vence, o que atrasou e o que precisa de reajuste.
      </p>

      <div className="estados">
        <span className="pill">{resumo.ativos} contratos</span>
        <span className="pill">{moeda(resumo.receitaMensal)}/mês de administração</span>
        {resumo.emAtraso > 0 && (
          <span className="pill alerta">{moeda(resumo.emAtraso)} em atraso</span>
        )}
        {resumo.reajustesDevidos > 0 && (
          <span className="pill alerta">{resumo.reajustesDevidos} reajuste(s) devido(s)</span>
        )}
      </div>

      {contratos.length === 0 && <p className="vazio">Nenhum contrato de locação.</p>}

      {contratos.map((c) => (
        <article key={c.idContrato} className={`card${c.atrasadas ? " urgente" : ""}`}>
          <header>
            <strong>{c.imovel}</strong>
            <span className="pill">{moeda(c.valorAluguel)}/mês</span>
            <span className="pill">até {data(c.fim)}</span>
          </header>

          <p>Inquilino: {c.inquilino}</p>

          {c.reajuste.devido && (
            <p className="custo">
              Reajuste devido desde {data(c.reajuste.em)} pelo {c.indice.toUpperCase()}. O
              sistema não aplica sozinho: o índice do ano vem de fora e o valor se negocia.
            </p>
          )}

          {c.parcelas.length > 0 && (
            <ul className="lista">
              {c.parcelas.map((p) => (
                <li key={p.idParcela}>
                  {p.competencia} — vence {data(p.vencimento)} —{" "}
                  {p.dias > 0 ? (
                    <span className="custo">
                      {p.dias} dia(s) em atraso · {moeda(p.total)} (multa {moeda(p.multa)} +
                      juros {moeda(p.juros)})
                    </span>
                  ) : (
                    <>em aberto · {moeda(p.valorBase)}</>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}

      <section>
        <h2>A régua de cobrança</h2>
        <p className="sub">
          Escalonada e com etapa registrada, para não mandar a mesma mensagem quatro vezes —
          o jeito mais rápido de fazer alguém silenciar o número da imobiliária. O primeiro
          passo é <em>antes</em> do vencimento: a maior parte do atraso é esquecimento, e
          cobrar depois já custou o relacionamento.
        </p>
        <ul className="lista">
          {REGUA_COBRANCA.map((r) => (
            <li key={r.estagio}>
              {r.dias < 0 ? `${Math.abs(r.dias)} dias antes` : r.dias === 0 ? "No dia" : `+${r.dias} dias`}
              : {r.texto}
              {r.tom === "escalacao" && " — vai pro painel, não pro WhatsApp do inquilino"}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
