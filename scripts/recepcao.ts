/**
 * Demonstra a identidade multicanal contra o banco de verdade.
 *
 * `npm run recepcao` — a mesma pessoa chegando por dois canais que não
 * compartilham nenhum campo: sem telefone no Instagram, sem @ no WhatsApp.
 * Mostra que o segundo contato é atendido na hora e que o pedido de fusão vai
 * pro painel em paralelo, sem segurar ninguém.
 */
import { receber, pedirFusao } from "@/lib/recepcao";
import { db, schema, pool } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

async function main() {
  console.log("--- 1) DM no Instagram, pessoa nova ---");
  const a = await receber({
    canal: "instagram",
    identificador: "@carol.andrade.sp",
    apelido: "Carol Andrade | Sorocaba",
    mensagem: "oi, vi o apê do Campolim no perfil de vcs",
  });
  console.log("cliente:", a.idCliente.slice(0, 8), "| novo:", a.novo, "| fusao:", !!a.fusaoSugerida);

  console.log("\n--- 2) tres dias depois, WhatsApp com outro perfil ---");
  const b = await receber({
    canal: "whatsapp",
    identificador: "5515994445566",
    apelido: "Carol Andrade",
    mensagem: "boa noite! ainda tem o apartamento do campolim?",
  });
  console.log("cliente:", b.idCliente.slice(0, 8), "| novo:", b.novo);
  console.log("palpite:", b.fusaoSugerida?.pontos, "pontos ->", b.fusaoSugerida?.motivos.join("; "));
  console.log("pergunta ao cliente:", b.fusaoSugerida?.pergunta);

  const idEvento = randomUUID();
  if (b.fusaoSugerida) await pedirFusao(idEvento, b as never);

  const fila = await db
    .select()
    .from(schema.aprovacao)
    .where(eq(schema.aprovacao.tipo, "fundir_identidade"));
  console.log("\nna fila do painel:", fila.length, "pedido(s) de fusao | thread parada:", fila[0]?.threadId);

  const casos = await db.select().from(schema.atendimento);
  console.log("casos no funil:", casos.length);

  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
