CREATE TABLE "leitura_modelo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agente" varchar(20) NOT NULL,
	"tarefa" varchar(20) NOT NULL,
	"modelo" varchar(120) NOT NULL,
	"prompt_hash" varchar(16) NOT NULL,
	"entrada" text NOT NULL,
	"entrada_hash" varchar(16) NOT NULL,
	"saida" jsonb,
	"ms" integer NOT NULL,
	"erro" text,
	"id_evento" uuid,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "leitura_prompt_idx" ON "leitura_modelo" USING btree ("agente","prompt_hash","criado_em");--> statement-breakpoint
CREATE INDEX "leitura_evento_idx" ON "leitura_modelo" USING btree ("id_evento");