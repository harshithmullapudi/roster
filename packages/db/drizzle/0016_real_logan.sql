CREATE TABLE "roster"."channel_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster"."channel_reads" ADD CONSTRAINT "channel_reads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "auth"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster"."channel_reads" ADD CONSTRAINT "channel_reads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "roster"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_reads_member_project_idx" ON "roster"."channel_reads" USING btree ("member_id","project_id");--> statement-breakpoint
CREATE INDEX "channel_reads_member_idx" ON "roster"."channel_reads" USING btree ("member_id");