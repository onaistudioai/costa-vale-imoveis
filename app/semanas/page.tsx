import { porSemana } from "@/lib/metricas";

export const dynamic = "force-dynamic";

const dia = (d: Date) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * A operação no tempo. As outras telas mostram o agora; esta mostra se o agora
 * é normal. O histórico de preço de cada imóvel já está em `/imovel/[id]`.
 */
export default async function Semanas() {
  const linhas = await porSemana();

  return (
    <>
      <h1>Semana a semana</h1>
      <p className="sub">
        As últimas 12 semanas. Tempo até decidir é a mediana entre o pedido chegar e alguém
        aprovar ou negar; expirado é pedido que ninguém respondeu no prazo.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Semana de</th>
              <th>Leads</th>
              <th>Decididos</th>
              <th>Negados</th>
              <th>Expirados</th>
              <th>Horas até decidir</th>
              <th>Leituras do modelo</th>
              <th>Falhas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={String(l.semana)}>
                <td>{dia(l.semana)}</td>
                <td>{l.leads}</td>
                <td>{l.decididos}</td>
                <td>{l.negados}</td>
                <td>{l.expirados}</td>
                <td>{l.horasAteDecidir ?? "—"}</td>
                <td>{l.leituras}</td>
                <td>{l.falhasModelo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
