import { pgSchema, uuid, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * O cérebro compartilhado — e o muro que o separa da empresa.
 *
 * Schema Postgres próprio, não tabela solta no meio das outras. A separação é
 * física porque a regra que a sustenta é absoluta:
 *
 *   **O cérebro não guarda o que é verdade sobre a empresa.
 *   Guarda o que a gente entendeu sobre ela.**
 *
 * Preço, contrato, matrícula, comissão: nada disso mora aqui. Se uma nota
 * disser 820 mil e o cadastro disser 846, o cliente ouve 846 — sempre. É o que
 * torna a edição humana segura: o pior que uma nota errada faz é o agente
 * responder pior. Nenhuma nota altera um contrato.
 *
 * Nada aqui referencia tabela da empresa por chave estrangeira, de propósito.
 * Apagar o schema inteiro não perde um dado de imóvel, cliente ou contrato —
 * perde só o que aprendemos, que é exatamente o que se pode reaprender.
 */
export const cerebro = pgSchema("cerebro");

export const estadoNota = cerebro.enum("estado_nota", [
  // Proposta. Aparece no painel, não influencia agente nenhum.
  "rascunho",
  // Alguém da equipe olhou e disse que procede.
  "confirmada",
  // Confirmada e protegida: nenhuma revisão automática mexe. É a ação que
  // quase todo sistema esquece — sem ela a pessoa corrige, o sistema erra
  // igual na semana seguinte, e aí ninguém corrige mais nada.
  "fixada",
  // Saiu de circulação. Continua legível, com o motivo escrito.
  "desativada",
]);

/**
 * Uma nota é uma **versão**, não um registro editável.
 *
 * Nada é rasurado, como em averbação de matrícula: corrigir insere linha nova
 * apontando pra anterior em `substitui`, e a antiga continua lá, legível, com
 * a data e o autor. Vigente é a nota que nenhuma outra substitui.
 *
 * Isso é o que permite entregar o botão de editar pra equipe sem medo: não
 * existe caminho que perca o que estava escrito antes.
 */
export const nota = cerebro.table(
  "nota",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Onde a nota vale: "geral", "bairro", "tipo_imovel", "canal", "agente".
    escopo: varchar("escopo", { length: 30 }).notNull(),
    // O valor do escopo: "campolim", "apartamento", "instagram", "1_curador".
    chave: varchar("chave", { length: 120 }).notNull().default(""),
    // A lição, escrita pra gente ler. É este texto que entra no prompt.
    texto: text("texto").notNull(),
    // De onde veio: amostra, período, taxa observada, id das leituras. Sem
    // isto, "aprendizado" é palpite com cara de conhecimento.
    evidencia: jsonb("evidencia"),
    estado: estadoNota("estado").notNull().default("rascunho"),
    autor: varchar("autor", { length: 255 }).notNull(),
    // Por que esta versão existe. Obrigatório na prática quando desativa.
    motivo: text("motivo"),
    // A nota que esta versão substitui. Nulo na primeira versão.
    substitui: uuid("substitui"),
    criadaEm: timestamp("criada_em").defaultNow().notNull(),
  },
  (t) => [
    index("nota_escopo_idx").on(t.escopo, t.chave, t.estado),
    index("nota_substitui_idx").on(t.substitui),
  ],
);

export type NotaRow = typeof nota.$inferSelect;
