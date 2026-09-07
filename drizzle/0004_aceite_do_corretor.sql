ALTER TYPE "public"."estado_aprovacao" ADD VALUE 'expirado';--> statement-breakpoint
ALTER TYPE "public"."tipo_aprovacao" ADD VALUE 'aceite_corretor';--> statement-breakpoint
ALTER TABLE "aprovacao" ADD COLUMN "destinatario" uuid;--> statement-breakpoint
ALTER TABLE "aprovacao" ADD COLUMN "expira_em" timestamp;--> statement-breakpoint
CREATE INDEX "aprovacao_expira_idx" ON "aprovacao" USING btree ("estado","expira_em");