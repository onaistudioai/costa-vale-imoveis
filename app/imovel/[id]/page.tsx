import { notFound } from "next/navigation";
import { AGENTE, descrever, historicoDoImovel } from "@/lib/painel";

export const dynamic = "force-dynamic";

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(d);

/**
 * A resposta para "por que esse anúncio caiu?".
 *
 * Cada linha diz o que mudou, quando, e quem mudou — incluindo quando quem
 * mudou foi a regra e não um agente. É o que separa um protótipo de um sistema
 * auditável (PROJECT_SPEC seção 6).
 */
export default async function Historico({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { imovel, eventos, anuncios } = await historicoDoImovel(id);

  if (!imovel) notFound();

  return (
    <>
      <h1>{imovel.endereco}</h1>
      <p className="sub">
        {imovel.tipo} · {imovel.bairro ?? "sem bairro"} · {imovel.cidade}
      </p>

      <div className="estados">
        <span className="pill">operacional: {imovel.estadoOperacional}</span>
        <span className="pill">comercial: {imovel.estadoComercial}</span>
        <span className="pill">anúncio: {imovel.estadoAnuncio}</span>
        {imovel.preco && <span className="pill">R$ {imovel.preco}</span>}
      </div>

      {anuncios.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem" }}>Anúncios</h2>
          <table style={{ marginBottom: "2rem" }}>
            <thead>
              <tr>
                <th>Canal</th>
                <th>Status</th>
                <th>Mídia paga</th>
                <th>Custo</th>
              </tr>
            </thead>
            <tbody>
              {anuncios.map((a) => (
                <tr key={a.idAnuncio}>
                  <td>{a.canal}</td>
                  <td>{a.status}</td>
                  <td>{a.midiaPaga ? "sim" : "não"}</td>
                  <td>R$ {a.custoAcumulado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 style={{ fontSize: "1rem" }}>O que aconteceu</h2>
      {eventos.length === 0 ? (
        <p className="vazio">Nenhuma mudança registrada ainda.</p>
      ) : (
        <ul className="linha-tempo">
          {eventos.map((e) => (
            <li key={e.id}>
              <span className="quando">{quando(e.timestamp)}</span>
              <span style={{ flex: 1 }}>{descrever(e)}</span>
              <span className="quem">
                {AGENTE[e.agenteOrigem] ?? e.agenteOrigem}
                {e.aprovadoPor && ` · ${e.aprovadoPor}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
