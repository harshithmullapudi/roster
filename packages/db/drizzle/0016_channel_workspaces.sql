-- A channel created from the sidebar keeps a dedicated Superset workspace,
-- and several channels may point at the same Superset project, so the
-- one-channel-per-project uniqueness becomes a plain lookup index.
ALTER TABLE "roster"."projects" ADD COLUMN "superset_workspace_id" text;--> statement-breakpoint
DROP INDEX IF EXISTS "roster"."projects_org_superset_id_idx";--> statement-breakpoint
CREATE INDEX "projects_org_superset_id_idx" ON "roster"."projects" USING btree ("organization_id","superset_project_id");
