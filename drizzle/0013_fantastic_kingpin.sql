ALTER TABLE "mensagem_enviada" ALTER COLUMN "destino" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "mensagem_enviada" ADD COLUMN "canal" varchar(20) DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "mensagem_enviada" ADD COLUMN "assunto" text;