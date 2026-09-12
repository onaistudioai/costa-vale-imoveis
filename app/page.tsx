import Link from "next/link";
import { decidir, responderOferta } from "./actions";
import { AGENTE, FAIXA, ROTULO, filaPendente, ofertasAbertas } from "@/lib/painel";

// Fila viva: nunca renderizar isso em build.
export const dynamic = "force-dynamic";

const dinheiro = (v: unknown) =>
  typeof v === "number" ? `R$ ${v.toFixed(2).replace(".", ",")}` : null;

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);

/**
 * O que a mesa levantou, quando houve mesa. Só aparece na faixa amarela.
 *
 * É apresentado como sugestão e nada mais: os botões continuam os mesmos, e
 * nenhum campo vem pré-marcado. Quem lê precisa enxergar a diferença entre "o
 * sistema acha" e "o sistema fez".
 */
function Proposta({ proposta }: { proposta: unknown }) {
  if (!proposta || typeof proposta !== "object") return null;
  const p = proposta as { recomendacao?: unknown; justificativa?: unknown };
  if (typeof p.recomendacao !== "string") return null;

  return (
    <p className="proposta">
      <strong>Sugestão da revisão:</strong> {p.recomendacao}
      {typeof p.justificativa === "string" && <> — {p.justificativa}</>}
      <br />
      <span className="meta">
        Sugestão de máquina, não decisão. Confira antes de aprovar.
      </span>
    </p>
  );
}

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
        Os três gates que exigem humano, mais as escalações dos agentes. O que pesa
        mais aparece primeiro; dentro da mesma faixa, mais antigo na frente.
      </p>

      {pendentes.length === 0 && (
        <p className="vazio">Nada esperando decisão.</p>
      )}

      {pendentes.map((p) => {
        const ctx = (p.contexto ?? {}) as Record<string, unknown>;
        const faixa = FAIXA[p.faixa] ?? FAIXA.verde!;

        return (
          <article
            key={p.id}
            // O alvo do link que sai no e-mail (ver urlDoPedido em src/lib/alerta.ts).
            id={`pedido-${p.id}`}
            className={`card faixa-${p.faixa}`}
          >
            <div className="topo">
              <span className="tipo">{ROTULO[p.tipo] ?? p.tipo}</span>
              <span className="meta">
                {AGENTE[p.solicitadoPorAgente] ?? p.solicitadoPorAgente} ·{" "}
                {quando(p.criadoEm)}
              </span>
            </div>

            <p className={`faixa-tag faixa-${p.faixa}`} title={faixa.explicacao}>
              {faixa.rotulo} — {faixa.explicacao}
            </p>

            <Contexto tipo={p.tipo} ctx={ctx} />
            <Proposta proposta={p.proposta} />

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
