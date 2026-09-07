import { esteiraDeEscrituras } from "@/lib/painel-ciclos";
import { ESTEIRA } from "@/regras/escritura";

export const dynamic = "force-dynamic";

const data = (d: Date) => d.toLocaleDateString("pt-BR");

/**
 * Os processos de escritura.
 *
 * A tela é dividida por **de quem é a bola**, e não por etapa. Metade do
 * caminho depende de cartório e prefeitura, que não obedecem prazo interno —
 * misturar "você precisa fazer" com "eles estão demorando" é o jeito mais
 * rápido de a equipe aprender a ignorar a lista inteira.
 */
export default async function Escrituras() {
  const { processos, nossos, acompanhar, emDia, concluidos } = await esteiraDeEscrituras();
  const ordem = ESTEIRA.map((e) => e.etapa);

  const cartao = (p: (typeof processos)[number], classe = "") => (
    <article key={p.idProcesso} className={`card ${classe}`}>
      <header>
        <strong>{p.imovel}</strong>
        {p.comprador && <span className="pill">{p.comprador}</span>}
        <span className="pill">
          passo {p.progresso.passo} de {p.progresso.total}
        </span>
      </header>

      <ul className="esteira">
        {ESTEIRA.filter((e) => e.etapa !== "concluido").map((e) => {
          const i = ordem.indexOf(e.etapa);
          const atual = ordem.indexOf(p.etapa);
          return (
            <li key={e.etapa} className={i < atual ? "feito" : i === atual ? "atual" : ""}>
              {e.rotulo}
            </li>
          );
        })}
      </ul>

      <p className="sub">Nesta etapa desde {data(p.etapaDesde)}</p>

      {p.alerta && (
        <>
          <p className={p.alerta.gravidade === "critico" ? "custo" : undefined}>
            {p.alerta.texto}
          </p>
          <p>{p.alerta.acao}</p>
        </>
      )}

      {/* O alerta já lista o que falta. Repetir a lista embaixo faz a tela
          parecer que tem duas pendências onde só existe uma. */}
      {!p.alerta && p.faltando.length > 0 && (
        <ul className="lista">
          {p.faltando.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      {p.matricula && <p className="meta">Matrícula {p.matricula}</p>}
      {p.cartorio && <p className="meta">{p.cartorio}</p>}
    </article>
  );

  return (
    <>
      <h1>Escrituras</h1>
      <p className="sub">
        Do contrato assinado até a matrícula no nome do comprador. Lembrando que a
        escritura não transfere o imóvel — quem transfere é o registro, que vem depois.
      </p>

      <div className="estados">
        <span className="pill">{processos.length} em andamento</span>
        {concluidos > 0 && <span className="pill ok">{concluidos} concluído(s)</span>}
      </div>

      <section>
        <h2>
          É com a gente <span className={nossos.length ? "pill alerta" : "pill"}>{nossos.length}</span>
        </h2>
        <p className="sub">Etapas nossas que passaram do prazo. Isso é trabalho, não aviso.</p>
        {nossos.length === 0 ? (
          <p className="vazio">Nada parado do nosso lado.</p>
        ) : (
          nossos.map((p) => cartao(p, "urgente"))
        )}
      </section>

      <section>
        <h2>
          Acompanhar <span className="pill">{acompanhar.length}</span>
        </h2>
        <p className="sub">
          Cartório, prefeitura ou uma das partes. Não há prazo interno a cobrar aqui — o
          que dá pra fazer é consultar o andamento e registrar o retorno.
        </p>
        {acompanhar.length === 0 ? (
          <p className="vazio">Nada travado do lado de fora.</p>
        ) : (
          acompanhar.map((p) => cartao(p, "acompanhar"))
        )}
      </section>

      <section>
        <h2>
          Dentro do prazo <span className="pill">{emDia.length}</span>
        </h2>
        {emDia.length === 0 ? <p className="vazio">—</p> : emDia.map((p) => cartao(p))}
      </section>

      <section>
        <h2>Os prazos típicos</h2>
        <ul className="lista">
          {ESTEIRA.filter((e) => e.prazoDias > 0).map((e) => (
            <li key={e.etapa}>
              {e.rotulo}: ~{e.prazoDias} dias ({e.responsavel})
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
