DROP INDEX "items_owner_id_id_idx";--> statement-breakpoint
DROP INDEX "sessions_user_id_id_idx";--> statement-breakpoint
CREATE INDEX "items_owner_id_id_idx" ON "items" USING btree ("owner_id","id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "sessions_user_id_id_idx" ON "sessions" USING btree ("user_id","id" DESC NULLS FIRST);