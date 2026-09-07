import Link from "next/link";
import { decidir, responderOferta } from "./actions";
import { AGENTE, ROTULO, filaPendente, ofertasAbertas } from "@/lib/painel";

// Fila viva: nunca renderizar isso em build.
export const dynamic = "force-dynamic";

const dinheiro = (v: unknown) =>
  typeof v === "number" ? `R$ ${v.toFixed(2).replace(".", ",")}` : null;

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);

function Contexto({ tipo, ctx }: { tipo: string; ctx: Record<string, unknown> }) {
  const custo = dinheiro(ctx.custoEmRisco);
  const canais = Array.isArray(ctx.canais) ? ctx.canais.join(", ") : null;

  return (
    <p className="corpo">
      {typeof ctx.resumo === "string" && <>{ctx.resumo} </>}
      {tipo === "derrubar_midia" && custo && (
        <>
          <span className="custo">{custo}</span> já gastos
          {canais && <> em {canais}</>}, e o gasto continua enquanto isso espera.
        </>
      )}
      {tipo === "escalacao_n3" && typeof ctx.motivo === "string" && (
        <>Motivo: {ctx.motivo.replace(/_/g, " ")}.</>
      )}
      {tipo === "fundir_identidade" && (
        <>
          Parece ser <strong>{String(ctx.nomeCandidato ?? "")}</strong>, que já está no
          cadastro. Por quê:{" "}
          {Array.isArray(ctx.motivos) ? ctx.motivos.join("; ") : "sinais parecidos"} (
          {String(ctx.pontos ?? 0)} pontos).
          {Number(ctx.concorrentes ?? 0) > 1 && (
            <>
              {" "}
              <span className="custo">
                Atenção: {String(ctx.concorrentes)} cadastros empataram — confira antes,
                porque juntar errado mostra a negociação de um cliente para outro.
              </span>
            </>
          )}{" "}
          Aprovar une os dois; recusar deixa como está e a conversa segue igual.
        </>
      )}
      {tipo === "aplicar_alteracao" && (
        <>
          <strong>{String(ctx.registro ?? "")}</strong> — {String(ctx.mudanca ?? "")}.{" "}
          {ctx.risco === "alto" && <span className="custo">{String(ctx.observacao ?? "")}</span>}
          {ctx.leituraIncerta === true && (
            <> Li o pedido com dúvida: confira o registro e o valor antes de confirmar.</>
          )}
        </>
      )}
    </p>
  );
}

/** Quanto falta pro lead passar pro próximo colocado. */
function restante(expiraEm: Date | null): string {
  if (!expiraEm) return "sem prazo";
  const min = Math.round((expiraEm.getTime() - Date.now()) / 60_000);
  if (min < 0) return "prazo vencido — passa na próxima varredura";
  return min <= 1 ? "menos de 1 min" : `${min} min`;
}

/**
 * As ofertas em aberto. Painel de visibilidade, não fila de trabalho: quem
 * decide é o corretor, no canal dele, e o prazo decide quando ele não responde.
 * Os botões existem pra demonstrar o fluxo sem depender do WhatsApp.
 */
async function Ofertas() {
  const ofertas = await ofertasAbertas();
  if (ofertas.length === 0) return null;

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <h2>Leads oferecidos</h2>
      <p className="sub">
        Esperando o corretor aceitar. Ninguém precisa clicar aqui — se o prazo
        vencer, o lead passa sozinho pro próximo colocado.
      </p>

      {ofertas.map((o) => {
        const ctx = (o.contexto ?? {}) as Record<string, unknown>;
        return (
          <article key={o.id} className="card">
            <div className="topo">
              <span className="tipo">{o.corretor ?? "corretor"}</span>
              <span className="meta">
                tentativa {String(ctx.tentativa ?? 1)} · {restante(o.expiraEm)}
              </span>
            </div>
            <p className="corpo">{String(ctx.resumo ?? "")}</p>
            <form className="acoes" action={responderOferta}>
              <input type="hidden" name="id" value={o.id} />
              <button className="primario" name="resposta" value="aceitar" type="submit">
                Aceitar
              </button>
              <button name="resposta" value="passar" type="submit">
                Passar a vez
              </button>
            </form>
          </article>
        );
      })}
    </section>
  );
}

export default async function Fila() {
  const pendentes = await filaPendente();

  return (
    <>
      <h1>Fila de decisões</h1>
      <p className="sub">
        Os três gates que exigem humano, mais as escalações dos agentes. Mais antigo
        primeiro — o custo de não decidir cresce com o tempo.
      </p>

      {pendentes.length === 0 && (
        <p className="vazio">Nada esperando decisão.</p>
      )}

      {pendentes.map((p) => {
        const ctx = (p.contexto ?? {}) as Record<string, unknown>;
        const urgente = p.tipo === "derrubar_midia";

        return (
          <article key={p.id} className={urgente ? "card urgente" : "card"}>
            <div className="topo">
              <span className="tipo">{ROTULO[p.tipo] ?? p.tipo}</span>
              <span className="meta">
                {AGENTE[p.solicitadoPorAgente] ?? p.solicitadoPorAgente} ·{" "}
                {quando(p.criadoEm)}
              </span>
            </div>

            <Contexto tipo={p.tipo} ctx={ctx} />

            <form className="acoes" action={decidir}>
              <input type="hidden" name="id" value={p.id} />

              <input type="text" name="motivo" placeholder="motivo (opcional)" />
              <button className="primario" name="decisao" value="aprovar" type="submit">
                Aprovar
              </button>
              <button name="decisao" value="negar" type="submit">
                Negar
              </button>
            </form>

            {p.entidade === "imovel" && (
              <p className="meta" style={{ marginTop: "0.7rem" }}>
                <Link href={`/imovel/${p.idEntidade}`}>Ver histórico do imóvel →</Link>
              </p>
            )}
          </article>
        );
      })}

      <Ofertas />
    </>
  );
}
