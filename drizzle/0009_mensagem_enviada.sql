CREATE TABLE "mensagem_enviada" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destino" varchar(40),
	"texto" text NOT NULL,
	"estado" varchar(20) NOT NULL,
	"motivo" text,
	"criado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mensagem_criado_idx" ON "mensagem_enviada" USING btree ("criado_em");