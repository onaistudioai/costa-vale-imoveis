ALTER TABLE "aprovacao" ADD COLUMN "id_evento" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "aprovacao_por_evento_idx" ON "aprovacao" USING btree ("id_evento","tipo","id_entidade");