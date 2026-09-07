import { perguntar } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Onde a equipe pergunta. Uma caixa de texto e a resposta — a mesma coisa que
 * a pessoa faria no WhatsApp, sem depender do WhatsApp estar ligado.
 */
export default async function Consulta({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const r = q ? await perguntar(q) : null;

  const exemplos = [
    "quanto estou gastando em mídia paga agora?",
    "o que está pronto e não foi anunciado?",
    "quais corretores deixaram lead vencer nos últimos 30 dias?",
    "como está o funil de leads deste mês?",
  ];

  return (
    <>
      <h1>Perguntar</h1>
      <p className="sub">
        Relatório de estoque, campanha, vendas, leads, equipe ou de um imóvel. Os números
        saem do banco; o texto é escrito em cima deles.
      </p>

      <form className="acoes" action="/consulta" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="o que você quer saber?"
          required
          style={{ flex: "1 1 22rem" }}
        />
        <button className="primario" type="submit">
          Perguntar
        </button>
      </form>

      {!q && (
        <ul className="meta" style={{ marginTop: "1.2rem", lineHeight: 2 }}>
          {exemplos.map((e) => (
            <li key={e}>
              <a href={`/consulta?q=${encodeURIComponent(e)}`}>{e}</a>
            </li>
          ))}
        </ul>
      )}

      {r && (
        <article className="card" style={{ marginTop: "1.5rem" }}>
          <div className="topo">
            <span className="tipo">{r.relatorio}</span>
            <span className="meta">somente leitura</span>
          </div>
          <p className="corpo">{r.texto}</p>
          {r.alerta && (
            <p className="corpo">
              <span className="custo">Atenção:</span> {r.alerta}
            </p>
          )}
          <details style={{ marginTop: "0.8rem" }}>
            <summary className="meta">Ver os dados que geraram esta resposta</summary>
            <pre
              style={{
                overflowX: "auto",
                fontSize: "0.75rem",
                marginTop: "0.6rem",
                maxHeight: "26rem",
              }}
            >
              {JSON.stringify(r.dados, null, 2)}
            </pre>
          </details>
        </article>
      )}
    </>
  );
}
