CREATE SCHEMA "cerebro";
--> statement-breakpoint
CREATE TYPE "cerebro"."estado_nota" AS ENUM('rascunho', 'confirmada', 'fixada', 'desativada');--> statement-breakpoint
CREATE TABLE "cerebro"."nota" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escopo" varchar(30) NOT NULL,
	"chave" varchar(120) DEFAULT '' NOT NULL,
	"texto" text NOT NULL,
	"evidencia" jsonb,
	"estado" "cerebro"."estado_nota" DEFAULT 'rascunho' NOT NULL,
	"autor" varchar(255) NOT NULL,
	"motivo" text,
	"substitui" uuid,
	"criada_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "nota_escopo_idx" ON "cerebro"."nota" USING btree ("escopo","chave","estado");--> statement-breakpoint
CREATE INDEX "nota_substitui_idx" ON "cerebro"."nota" USING btree ("substitui");