import { solicitarAlteracao } from "../actions";

export const dynamic = "force-dynamic";

/**
 * A porta do Agente 6.
 *
 * O que esta tela substitui: até agora, mudar um preço ou corrigir um endereço
 * que a extração leu errado exigia alguém que soubesse mexer no banco. Era o
 * gargalo técnico em cima de tarefa de secretaria.
 *
 * O que ela **não** faz é o mais importante: nada é salvo daqui. O pedido vira
 * uma confirmação na fila com o "de → para" escrito — porque as duas coisas
 * que o agente faz (entender texto ambíguo e escolher entre registros
 * parecidos) são exatamente onde um modelo erra com confiança.
 */
export default async function Alterar({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { ok, erro } = await searchParams;

  async function enviar(formData: FormData) {
    "use server";
    const { redirect } = await import("next/navigation");
    try {
      const r = await solicitarAlteracao(formData);
      const alt = (r as { alteracao?: { desfecho: string; motivo?: string } })?.alteracao;

      const destino =
        !alt || alt.desfecho === "aplicada"
          ? "?ok=Pedido registrado. Confirme na fila."
          : alt.desfecho === "ambigua"
            ? "?erro=Achei mais de um registro. Diga o endereço ou o bairro exato."
            : alt.desfecho === "nao_encontrado"
              ? "?erro=Não encontrei esse registro."
              : `?erro=${alt.motivo ?? "Não deu pra fazer."}`;

      const [chave, valor] = destino.slice(1).split(/=(.*)/);
      redirect(`/alterar?${chave}=${encodeURIComponent(valor ?? "")}`);
    } catch (e) {
      // `redirect` funciona lançando — deixa passar, senão o sucesso vira erro.
      if (e && typeof e === "object" && "digest" in e) throw e;
      redirect(`/alterar?erro=${encodeURIComponent(String(e))}`);
    }
  }

  const exemplos = [
    "muda o preço do apartamento da Av. Gisele Constantino pra 820 mil",
    "corrige o endereço do imóvel do Éden: é Rua das Palmeiras, 45",
    "atualiza o telefone da Juliana Mendes pra (15) 99999-0000",
  ];

  return (
    <>
      <h1>Alterar cadastro</h1>
      <p className="sub">
        Escreva o que precisa mudar, do jeito que você falaria. Nada é salvo agora: o
        pedido vira uma confirmação na fila mostrando o valor antigo e o novo.
      </p>

      {ok && <p className="pill ok">{ok}</p>}
      {erro && <p className="pill alerta">{erro}</p>}

      <form className="acoes" action={enviar}>
        <input
          type="text"
          name="texto"
          placeholder="o que mudar?"
          maxLength={1000}
          required
          style={{ flex: "1 1 24rem" }}
        />
        <button type="submit">Pedir alteração</button>
      </form>

      <section>
        <h2>Exemplos</h2>
        <ul className="lista">
          {exemplos.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>O que não muda por aqui</h2>
        <ul className="lista">
          <li>
            <strong>Estado do imóvel</strong> (pronto, com pendência) — é conclusão do
            laudo. Registre um laudo novo e o Curador reavalia.
          </li>
          <li>
            <strong>Estado da negociação</strong> — vem do documento, lido pelo Guardião.
          </li>
          <li>
            <strong>Anúncio no ar</strong> — sobe e desce por regra, com aprovação na fila.
          </li>
        </ul>
      </section>
    </>
  );
}
