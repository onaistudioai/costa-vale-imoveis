import Link from "next/link";
import { contarPorModo, feitoSozinho } from "@/lib/automatico";
import { AGENTE, descrever } from "@/lib/painel";
import { ROTULO_MODO } from "@/regras/modo";

export const dynamic = "force-dynamic";

const quando = (d: Date) =>
  d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * O que o sistema fez sem ninguém mandar.
 *
 * Antes desta tela, a resposta para "o que rodou sozinho hoje?" não existia. A
 * fila mostra o que o sistema *quer* fazer; o histórico do imóvel mostra o que
 * aconteceu, mas só se você já souber qual imóvel procurar. O que o cron fez de
 * madrugada — cobrar um inquilino, marcar uma inadimplência, reordenar o funil
 * — não aparecia em lugar nenhum.
 *
 * "Fez sozinho" é a lista curta que importa: são as ações que rodam sem
 * revisão, por decisão declarada em `src/regras/modo.ts`. Cada uma diz por que
 * pode rodar assim. Se alguma razão parecer fraca lendo aqui, é sinal de que a
 * decisão precisa mudar — e é exatamente para isso que a tela existe.
 */
export default async function Automatico() {
  const linhas = await feitoSozinho();
  const conta = contarPorModo(linhas);
  const semRevisao = linhas.filter((l) => l.modo === "hootl");

  return (
    <>
      <h1>Feito pelo sistema</h1>
      <p className="sub">
        Tudo que aconteceu sem ninguém aprovar. &quot;Fez sozinho&quot; é o que roda sem
        revisão — é a lista para varrer de vez em quando.
      </p>

      <div className="estados">
        <span className="pill">{conta.hotl ?? 0} fez e avisou</span>
        <span className={semRevisao.length > 0 ? "pill alerta" : "pill"}>
          {conta.hootl ?? 0} fez sozinho
        </span>
        {(conta.indefinido ?? 0) > 0 && (
          <span className="pill alerta">{conta.indefinido} sem modo declarado</span>
        )}
      </div>

      {linhas.length === 0 && (
        <p className="vazio">O sistema não fez nada por conta própria ainda.</p>
      )}

      {linhas.map((l) => (
        <article key={l.id} className={l.modo === "hootl" ? "card faixa-amarela" : "card"}>
          <div className="topo">
            <span className="tipo">
              {descrever({
                campo: l.campo,
                valorAnterior: l.valorAnterior,
                valorNovo: l.valorNovo,
              })}
            </span>
            <span className="meta">
              {AGENTE[l.agenteOrigem] ?? l.agenteOrigem} · {quando(l.timestamp)}
            </span>
          </div>

          <p className="faixa-tag">
            {l.modo ? ROTULO_MODO[l.modo] : "Sem modo declarado"}
            {/* A razão fica visível de propósito: autonomia que não se explica
                em uma frase não devia estar rodando. */}
            {l.porque && <> — {l.porque}</>}
          </p>

          {l.entidade === "imovel" && (
            <p className="meta">
              <Link href={`/imovel/${l.idEntidade}`}>Ver histórico do imóvel →</Link>
            </p>
          )}
        </article>
      ))}
    </>
  );
}
