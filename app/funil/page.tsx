import { filaDoFunil } from "@/lib/painel";
import { avaliar, MOTIVOS_DESFECHO, ROTULO_MOTIVO, PESO_ETAPA } from "@/regras/funil";
import { darDesfecho } from "../actions";

export const dynamic = "force-dynamic";

const ROTULO_ETAPA: Record<string, string> = {
  primeiro_contato: "Primeiro contato",
  qualificado: "Qualificado",
  visita_agendada: "Visita agendada",
  visita_feita: "Visita feita",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
};

/**
 * A fila do atendimento.
 *
 * Ordenada por prioridade, não por data — e essa é a tela inteira em uma
 * frase. Uma lista por data trata "fez proposta e sumiu há uma semana" igual a
 * "perguntou o preço ontem"; esta trata o primeiro como o que ele é.
 *
 * Os casos marcados em vermelho não estão pedindo mais uma tentativa: estão
 * pedindo um **ponto final**. O sistema não fecha sozinho porque fechar por
 * silêncio é escrever "não quis" onde a verdade é "não sei".
 */
export default async function Funil() {
  const fila = await filaDoFunil();
  const agora = new Date();

  const pedindoDesfecho = fila.filter((a) => a.precisaDesfecho);
  const bolaNossa = fila.filter((a) => !a.precisaDesfecho && a.ultimoContatoPor === "cliente");
  const esperando = fila.filter((a) => !a.precisaDesfecho && a.ultimoContatoPor !== "cliente");

  const linha = (a: (typeof fila)[number]) => {
    const s = avaliar(
      {
        etapa: a.etapa,
        etapaMaxima: a.etapaMaxima,
        estado: a.estado,
        ultimaInteracao: a.ultimaInteracao,
        ultimoContatoPor: a.ultimoContatoPor as "cliente" | "nos",
      },
      agora,
    );

    return (
      <article key={a.idAtendimento} className="card">
        <header>
          <strong>{a.cliente}</strong>
          <span className="pill">{ROTULO_ETAPA[a.etapa] ?? a.etapa}</span>
          {a.etapaMaxima !== a.etapa && (
            <span className="pill" title="Etapa mais funda já alcançada">
              já chegou em {ROTULO_ETAPA[a.etapaMaxima]}
            </span>
          )}
          <span className="pill">prioridade {a.prioridade}</span>
        </header>

        <p>{s.rotulo}</p>
        {a.corretor && <p className="sub">Com {a.corretor}</p>}

        {a.precisaDesfecho && (
          <form className="acoes" action={darDesfecho}>
            <input type="hidden" name="id" value={a.idAtendimento} />
            <select name="motivo" required>
              <option value="">Qual foi o desfecho?</option>
              {MOTIVOS_DESFECHO.map((m) => (
                <option key={m} value={m}>
                  {ROTULO_MOTIVO[m]}
                </option>
              ))}
            </select>
            {/* Sem campo de nome: quem encerra é quem está logado. Pedir o
                nome à mão era pedir pra ser preenchido errado — e o campo era
                alcançável por quem montasse o POST fora do painel. */}
            <button type="submit">Encerrar</button>
          </form>
        )}
      </article>
    );
  };

  return (
    <>
      <h1>Atendimentos</h1>
      <p className="sub">
        Ordenado por urgência, não por data. Quem chegou mais longe e parou de responder
        sobe mais rápido que quem só perguntou o preço.
      </p>

      <section>
        <h2>
          Precisam de um ponto final <span className="pill alerta">{pedindoDesfecho.length}</span>
        </h2>
        <p className="sub">
          Passaram do tempo de silêncio da etapa. O sistema não fecha sozinho — dizer que
          o cliente desistiu é decisão de gente, e o motivo é o que faz o relatório de
          perdas valer alguma coisa.
        </p>
        {pedindoDesfecho.length === 0 ? (
          <p className="vazio">Nenhum caso pendurado.</p>
        ) : (
          pedindoDesfecho.map(linha)
        )}
      </section>

      <section>
        <h2>
          Esperando resposta nossa <span className="pill">{bolaNossa.length}</span>
        </h2>
        <p className="sub">O cliente falou por último. A bola é nossa.</p>
        {bolaNossa.length === 0 ? <p className="vazio">Ninguém esperando.</p> : bolaNossa.map(linha)}
      </section>

      <section>
        <h2>
          Aguardando o cliente <span className="pill">{esperando.length}</span>
        </h2>
        {esperando.length === 0 ? <p className="vazio">Nada em espera.</p> : esperando.map(linha)}
      </section>

      <section>
        <h2>Como a prioridade é calculada</h2>
        <p className="sub">
          Peso da etapa mais funda já alcançada, mais a pressão do silêncio — e a pressão é
          proporcional ao teto da etapa. Proposta parada há 5 dias empata com primeiro
          contato parado há 30: os dois acabaram de estourar. Passado o teto, quem estava
          mais fundo sobe mais rápido.
        </p>
        <ul className="lista">
          {Object.entries(PESO_ETAPA)
            .filter(([, v]) => v > 0)
            .map(([e, v]) => (
              <li key={e}>
                {ROTULO_ETAPA[e]}: peso {v}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
