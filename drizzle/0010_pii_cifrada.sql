DROP INDEX "identidade_canal_idx";--> statement-breakpoint
ALTER TABLE "cliente" ALTER COLUMN "cpf_cnpj" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cliente" ALTER COLUMN "telefone" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cliente" ALTER COLUMN "email" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corretor" ALTER COLUMN "telefone" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "identidade" ALTER COLUMN "identificador" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "cliente" ADD COLUMN "email_indice" varchar(64);--> statement-breakpoint
-- Nasce anulavel de proposito: o indice cego e um HMAC calculado com a chave
-- da aplicacao, e o Postgres nao tem essa chave. Quem preenche e o
-- `scripts/cifrar-pii.ts`, e e ele que poe o NOT NULL no fim.
ALTER TABLE "identidade" ADD COLUMN "identificador_indice" varchar(64);--> statement-breakpoint
CREATE INDEX "cliente_email_indice_idx" ON "cliente" USING btree ("email_indice");--> statement-breakpoint
CREATE UNIQUE INDEX "identidade_canal_idx" ON "identidade" USING btree ("canal","identificador_indice");