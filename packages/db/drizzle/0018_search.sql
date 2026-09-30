-- Search reads the same text the timeline already stores, so there is no new
-- column to keep in step with it: an expression index over to_tsvector means
-- the index cannot drift from the message it indexes, and adding it does not
-- rewrite either table.
CREATE INDEX "messages_search_idx" ON "roster"."messages" USING gin (to_tsvector('english', "text"));--> statement-breakpoint
CREATE INDEX "tasks_search_idx" ON "roster"."tasks" USING gin (to_tsvector('english', "title"));
