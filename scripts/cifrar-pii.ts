import { isNull, or, sql } from "drizzle-orm";
import { db, schema, pool } from "../src/lib/db";
import { cifrar, indice } from "../src/lib/cripto";

/**
 * Cifra a PII que já está no banco.
 *
 *   npm run cifrar-pii            # mostra o que faria
 *   npm run cifrar-pii -- aplicar # grava
 *
 * Roda **uma vez**, depois da migração `0010_pii_cifrada`. É ele que preenche
 * os índices cegos, porque o HMAC depende da chave da aplicação e o Postgres
 * não a tem — não havia como fazer isso em SQL.
 *
 * É idempotente: valor que já tem o prefixo `v1:` passa batido. Rodar duas
 * vezes não cifra em cima da cifra, o que seria irreversível.
 */

const APLICAR = process.argv.includes("aplicar");
const jaCifrado = (v: string | null) => v === null || v === "" || v.startsWith("v1:");

async function main() {
  if (!APLICAR) {
    console.log("Modo seco. Nada será gravado. Rode com `-- aplicar` para valer.\n");
  }

  // Uma transação só: cifrar metade da base e falhar deixaria o painel com
  // registros que ninguém sabe se são cifra ou telefone.
  await db.transaction(async (tx) => {
    const clientes = await tx.select().from(schema.cliente);
    let n = 0;
    for (const c of clientes) {
      // Cliente sem e-mail tem índice nulo por definição — exigir o índice aqui
      // colocava esses na conta e mandava um UPDATE que não muda nada. O número
      // que este script imprime é o que a pessoa confere antes do passo sem
      // volta; ele precisa contar só o que de fato falta.
      const indiceOk = !c.email || Boolean(c.emailIndice);
      if (jaCifrado(c.cpfCnpj) && jaCifrado(c.telefone) && jaCifrado(c.email) && indiceOk) {
        continue;
      }
      n++;
      if (!APLICAR) continue;
      await tx
        .update(schema.cliente)
        .set({
          cpfCnpj: jaCifrado(c.cpfCnpj) ? c.cpfCnpj : cifrar(c.cpfCnpj),
          telefone: jaCifrado(c.telefone) ? c.telefone : cifrar(c.telefone),
          email: jaCifrado(c.email) ? c.email : cifrar(c.email),
          // O índice sai do valor em claro — por isso ele é calculado antes de
          // a coluna virar cifra, e só nesta passagem.
          emailIndice: c.email && !jaCifrado(c.email) ? indice(c.email) : c.emailIndice,
        })
        .where(sql`${schema.cliente.idCliente} = ${c.idCliente}`);
    }
    console.log(`cliente: ${n} de ${clientes.length} a cifrar`);

    const corretores = await tx.select().from(schema.corretor);
    let m = 0;
    for (const c of corretores) {
      if (jaCifrado(c.telefone)) continue;
      m++;
      if (!APLICAR) continue;
      await tx
        .update(schema.corretor)
        .set({ telefone: cifrar(c.telefone) })
        .where(sql`${schema.corretor.idCorretor} = ${c.idCorretor}`);
    }
    console.log(`corretor: ${m} de ${corretores.length} a cifrar`);

    const identidades = await tx.select().from(schema.identidade);
    let k = 0;
    for (const i of identidades) {
      if (jaCifrado(i.identificador) && i.identificadorIndice) continue;
      k++;
      if (!APLICAR) continue;
      // O identificador já está normalizado no banco desde que foi gravado —
      // `vincular()` normaliza antes de inserir. O índice sai dele como está.
      await tx
        .update(schema.identidade)
        .set({
          identificador: cifrar(i.identificador)!,
          identificadorIndice: indice(i.identificador),
        })
        .where(sql`${schema.identidade.id} = ${i.id}`);
    }
    console.log(`identidade: ${k} de ${identidades.length} a cifrar`);

    if (!APLICAR) return;

    // O NOT NULL entra agora, e não na migração: antes disso a coluna estaria
    // vazia e o `ALTER` falharia em qualquer banco com dados.
    const faltando = await tx
      .select({ id: schema.identidade.id })
      .from(schema.identidade)
      .where(or(isNull(schema.identidade.identificadorIndice)));

    if (faltando.length > 0) {
      throw new Error(`${faltando.length} identidades sem índice — abortando antes do NOT NULL`);
    }
    await tx.execute(
      sql`ALTER TABLE identidade ALTER COLUMN identificador_indice SET NOT NULL`,
    );
    console.log("\nidentificador_indice agora é NOT NULL.");
  });

  if (APLICAR) console.log("\nPronto. A PII está cifrada. Guarde PII_KEY: sem ela, os dados somem.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
