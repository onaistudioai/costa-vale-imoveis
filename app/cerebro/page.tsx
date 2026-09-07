import { todasAsNotas } from "@/cerebro/db";
import { historia, vigentes } from "@/cerebro/vigentes";
import { anotar, versionarNota } from "../actions";

export const dynamic = "force-dynamic";

const data = (d: Date) => d.toLocaleDateString("pt-BR");

const ROTULO: Record<string, string> = {
  rascunho: "proposta",
  confirmada: "confirmada",
  fixada: "fixada",
  desativada: "desativada",
};

/**
 * O cérebro, aberto para a equipe.
 *
 * A tela existe porque a alternativa é pior: conhecimento que só vive dentro
 * de prompt é conhecimento que ninguém da imobiliária pode ler, contestar ou
 * corrigir — e que some quando quem escreveu o prompt sai.
 *
 * Editar aqui é seguro por construção, não por cuidado: nada nesta página
 * chega perto de um preço, um contrato ou uma matrícula. O pior que uma nota
 * errada faz é o agente responder pior.
 */
export default async function Cerebro({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const todas = await todasAsNotas();
  const vivas = vigentes(todas);

  const porEstado = (e: string) => vivas.filter((n) => n.estado === e);
  const ativas = [...porEstado("fixada"), ...porEstado("confirmada")];

  const cartao = (n: (typeof vivas)[number]) => {
    const linha = historia(todas, n.id);
    const ev = n.evidencia as { amostra?: number; fonte?: string } | null;

    return (
      <article key={n.id} className={`card ${n.estado === "desativada" ? "acompanhar" : ""}`}>
        <header>
          <span className="pill">{ROTULO[n.estado]}</span>
          <span className="pill">
            {n.escopo}
            {n.chave && `: ${n.chave}`}
          </span>
        </header>

        <p style={n.estado === "desativada" ? { textDecoration: "line-through" } : undefined}>
          {n.texto}
        </p>

        {n.motivo && <p className="sub">Motivo: {n.motivo}</p>}
        {ev?.amostra !== undefined && (
          <p className="meta">
            Evidência: {ev.amostra} caso(s){ev.fonte ? ` · ${ev.fonte}` : ""}
          </p>
        )}
        <p className="meta">
          {n.autor} · {data(n.criadaEm)}
          {linha.length > 1 && ` · versão ${linha.length}`}
        </p>

        {linha.length > 1 && (
          <ul className="lista">
            {linha.slice(1).map((v) => (
              <li key={v.id}>
                {data(v.criadaEm)} — {ROTULO[v.estado]}: {v.texto}
                {v.motivo && ` (${v.motivo})`}
              </li>
            ))}
          </ul>
        )}

        {n.estado !== "desativada" && (
          <form className="acoes" action={versionarNota}>
            <input type="hidden" name="id" value={n.id} />
            <input type="text" name="texto" placeholder="corrigir o texto (opcional)" />
            <input type="text" name="motivo" placeholder="motivo" />
            {n.estado === "rascunho" && (
              <button type="submit" name="estado" value="confirmada">
                Confirmar
              </button>
            )}
            <button type="submit" name="estado" value="fixada">
              Fixar
            </button>
            <button type="submit" name="estado" value="desativada">
              Desativar
            </button>
          </form>
        )}
      </article>
    );
  };

  return (
    <>
      <h1>Cérebro</h1>
      <p className="sub">
        O que a equipe entendeu com a operação. <strong>Não é cadastro.</strong> Se uma
        nota aqui contradisser um dado do sistema, o dado do sistema vence — e a nota é
        ignorada. Por isso dá pra escrever e corrigir à vontade: nada daqui muda preço,
        contrato ou matrícula.
      </p>

      {erro && <p className="pill alerta">{erro}</p>}

      <div className="estados">
        <span className="pill ok">{ativas.length} valendo</span>
        <span className="pill">{porEstado("rascunho").length} proposta(s)</span>
        <span className="pill">{porEstado("desativada").length} desativada(s)</span>
      </div>

      <section>
        <h2>Escrever uma observação</h2>
        <p className="sub">
          Nasce como proposta e não influencia agente nenhum até alguém confirmar.
        </p>
        <form className="acoes" action={anotar}>
          <select name="escopo" defaultValue="geral">
            <option value="geral">vale pra todos</option>
            <option value="agente">um agente</option>
            <option value="bairro">um bairro</option>
            <option value="tipo_imovel">um tipo de imóvel</option>
            <option value="canal">um canal</option>
          </select>
          <input type="text" name="chave" placeholder="qual? (ex: campolim)" />
          <input
            type="text"
            name="texto"
            placeholder="o que aprendemos"
            maxLength={400}
            required
            style={{ flex: "1 1 22rem" }}
          />
          <input type="text" name="autor" placeholder="seu nome" required />
          <button type="submit">Propor</button>
        </form>
      </section>

      <section>
        <h2>
          Valendo agora <span className="pill">{ativas.length}</span>
        </h2>
        <p className="sub">
          Estas entram no prompt dos agentes, marcadas como observação da equipe. Fixada
          vem antes de confirmada.
        </p>
        {ativas.length === 0 ? <p className="vazio">Nada confirmado ainda.</p> : ativas.map(cartao)}
      </section>

      <section>
        <h2>
          Propostas <span className="pill">{porEstado("rascunho").length}</span>
        </h2>
        <p className="sub">Ainda não influenciam nada.</p>
        {porEstado("rascunho").length === 0 ? (
          <p className="vazio">—</p>
        ) : (
          porEstado("rascunho").map(cartao)
        )}
      </section>

      <section>
        <h2>
          Desativadas <span className="pill">{porEstado("desativada").length}</span>
        </h2>
        <p className="sub">
          Continuam legíveis com o motivo. Nada é apagado — corrigir escreve embaixo,
          como averbação de matrícula.
        </p>
        {porEstado("desativada").length === 0 ? (
          <p className="vazio">—</p>
        ) : (
          porEstado("desativada").map(cartao)
        )}
      </section>
    </>
  );
}
