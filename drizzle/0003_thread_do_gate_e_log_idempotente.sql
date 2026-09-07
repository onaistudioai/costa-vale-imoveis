ALTER TABLE "aprovacao" ADD COLUMN "thread_id" varchar(120);--> statement-breakpoint
CREATE UNIQUE INDEX "log_por_evento_idx" ON "log_evento" USING btree ("id_evento","campo","id_entidade");