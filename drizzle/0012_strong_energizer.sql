CREATE TYPE "public"."faixa_aprovacao" AS ENUM('verde', 'amarela', 'vermelha');--> statement-breakpoint
ALTER TABLE "aprovacao" ADD COLUMN "faixa" "faixa_aprovacao" DEFAULT 'verde' NOT NULL;--> statement-breakpoint
ALTER TABLE "aprovacao" ADD COLUMN "proposta" jsonb;--> statement-breakpoint
CREATE INDEX "aprovacao_faixa_idx" ON "aprovacao" USING btree ("estado","faixa","criado_em");