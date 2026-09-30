DROP INDEX IF EXISTS "roster"."delegations_one_open_per_parent_idx";--> statement-breakpoint

-- A thread may now wait on several agents at once, one open ask per agent.
CREATE UNIQUE INDEX "delegations_one_open_per_target_idx" ON "roster"."delegations" USING btree ("parent_thread_id","target_member_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delegations_parent_thread_idx" ON "roster"."delegations" USING btree ("parent_thread_id");--> statement-breakpoint

-- An answer is reported once the thread has nothing left to wait on, so the
-- asker is resumed with every reply together. Answers that already went back
-- count as reported.
ALTER TABLE "roster"."delegations" ADD COLUMN "reply" text;--> statement-breakpoint
ALTER TABLE "roster"."delegations" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
UPDATE "roster"."delegations"
   SET "reported_at" = COALESCE("answered_at", now())
 WHERE "status" <> 'open';
