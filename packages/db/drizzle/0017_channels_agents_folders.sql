CREATE TABLE "roster"."folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"superset_project_id" text NOT NULL,
	"superset_host_id" text NOT NULL,
	"superset_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"repo_owner" text,
	"repo_name" text,
	"repo_url" text,
	"repo_path" text,
	"owner_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster"."folders" ADD CONSTRAINT "folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster"."folders" ADD CONSTRAINT "folders_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "auth"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_organization_id_idx" ON "roster"."folders" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_org_superset_id_idx" ON "roster"."folders" USING btree ("organization_id","superset_project_id");--> statement-breakpoint

-- Every channel has been a folder in disguise. Each one's Superset half moves
-- into a folder row of its own; the member who added the channel owns it, so
-- sessions keep running on the key that has always reached that machine.
INSERT INTO "roster"."folders"
  ("organization_id", "superset_project_id", "superset_host_id", "superset_org_id",
   "name", "repo_owner", "repo_name", "repo_url", "repo_path", "owner_member_id", "created_at")
SELECT
  p."organization_id", p."superset_project_id", p."superset_host_id", p."superset_org_id",
  p."name", p."repo_owner", p."repo_name", p."repo_url", p."repo_path", p."added_by_member_id", p."created_at"
FROM "roster"."projects" p;--> statement-breakpoint

-- Agents borrowed their folder through the channel. Now they hold it directly.
ALTER TABLE "auth"."members" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
UPDATE "auth"."members" m
   SET "folder_id" = f."id"
  FROM "roster"."projects" p
  JOIN "roster"."folders" f
    ON f."organization_id" = p."organization_id"
   AND f."superset_project_id" = p."superset_project_id"
 WHERE m."project_id" = p."id"
   AND m."type" = 'agent';--> statement-breakpoint
ALTER TABLE "auth"."members" ADD CONSTRAINT "members_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "roster"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_folder_idx" ON "auth"."members" USING btree ("folder_id");--> statement-breakpoint

-- A channel that somehow has no agent gets one before default_agent_id turns
-- NOT NULL, mirroring what 0012 did at the birth of agents-as-members.
INSERT INTO "auth"."members"
  ("organization_id", "user_id", "role", "type", "agent_name", "project_id", "folder_id", "created_at")
SELECT
  p."organization_id",
  NULL,
  'member',
  'agent',
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "auth"."members" taken
       WHERE taken."organization_id" = p."organization_id"
         AND lower(taken."agent_name") = p."slug"
    )
    THEN p."slug" || '-' || left(replace(p."id"::text, '-', ''), 4)
    ELSE p."slug"
  END,
  p."id",
  f."id",
  now()
FROM "roster"."projects" p
JOIN "roster"."folders" f
  ON f."organization_id" = p."organization_id"
 AND f."superset_project_id" = p."superset_project_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "auth"."members" a
   WHERE a."project_id" = p."id" AND a."type" = 'agent'
);--> statement-breakpoint

-- The main agent was always the channel's oldest. That accident of creation
-- order becomes an explicit column.
ALTER TABLE "roster"."projects" ADD COLUMN "default_agent_id" uuid;--> statement-breakpoint
UPDATE "roster"."projects" p
   SET "default_agent_id" = (
    SELECT a."id"
      FROM "auth"."members" a
     WHERE a."project_id" = p."id"
       AND a."type" = 'agent'
     ORDER BY (a."archived_at" IS NOT NULL) ASC, a."created_at" ASC
     LIMIT 1
  );--> statement-breakpoint
ALTER TABLE "roster"."projects" ALTER COLUMN "default_agent_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roster"."projects" ADD CONSTRAINT "projects_default_agent_id_members_id_fk" FOREIGN KEY ("default_agent_id") REFERENCES "auth"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_default_agent_idx" ON "roster"."projects" USING btree ("default_agent_id");--> statement-breakpoint

ALTER TABLE "auth"."members" DROP CONSTRAINT IF EXISTS "members_project_id_projects_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "auth"."members_project_idx";--> statement-breakpoint
ALTER TABLE "auth"."members" DROP COLUMN "project_id";--> statement-breakpoint

ALTER TABLE "roster"."projects" DROP COLUMN "superset_project_id";--> statement-breakpoint
ALTER TABLE "roster"."projects" DROP COLUMN "superset_host_id";--> statement-breakpoint
ALTER TABLE "roster"."projects" DROP COLUMN "superset_org_id";--> statement-breakpoint
ALTER TABLE "roster"."projects" DROP COLUMN "repo_owner";--> statement-breakpoint
ALTER TABLE "roster"."projects" DROP COLUMN "repo_name";--> statement-breakpoint
ALTER TABLE "roster"."projects" DROP COLUMN "repo_url";--> statement-breakpoint
ALTER TABLE "roster"."projects" DROP COLUMN "repo_path";
