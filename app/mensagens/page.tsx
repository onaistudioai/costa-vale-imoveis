import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROTULO: Record<string, string> = {
  entregue: "entregue",
  sem_canal: "não saiu",
  falha: "falhou",
};

const quando = (d: Date) =>
  d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Tudo que o sistema falou — ou teria falado.
 *
 * Antes desta tela, a mensagem de uma oferta sumia num log de servidor e o
 * sistema marcava "enviado" mesmo com o canal desligado. Ninguém tinha como
 * conferir o que a imobiliária disse a um cliente, nem provar que um corretor
 * foi avisado.
 *
 * "Não saiu" é estado próprio, e não erro: com o canal desligado é o esperado,
 * e é exatamente o que se quer ver antes de ligar o WhatsApp de verdade.
 */
export default async function Mensagens() {
  const linhas = await db
    .select()
    .from(schema.mensagemEnviada)
    .orderBy(desc(schema.mensagemEnviada.criadoEm))
    .limit(100);

  const conta = (e: string) => linhas.filter((l) => l.estado === e).length;

  return (
    <>
      <h1>Mensagens</h1>
      <p className="sub">
        O que o sistema falou com clientes e corretores. Com o canal desligado, nada sai
        de verdade — mas o texto exato fica aqui, com hora e destinatário.
      </p>

      <div className="estados">
        <span className="pill ok">{conta("entregue")} entregue(s)</span>
        <span className="pill">{conta("sem_canal")} não saiu</span>
        {conta("falha") > 0 && <span className="pill alerta">{conta("falha")} falhou</span>}
      </div>

      {linhas.length === 0 ? (
        <p className="vazio">Nada foi enviado ainda.</p>
      ) : (
        linhas.map((l) => (
          <article key={l.id} className={`card ${l.estado === "falha" ? "urgente" : ""}`}>
            <header>
              <span className="pill">{ROTULO[l.estado] ?? l.estado}</span>
              <strong>{l.destino ?? "sem destinatário"}</strong>
              <span className="pill">{quando(l.criadoEm)}</span>
            </header>
            <p>{l.texto}</p>
            {l.motivo && <p className="meta">{l.motivo}</p>}
          </article>
        ))
      )}
    </>
  );
}
