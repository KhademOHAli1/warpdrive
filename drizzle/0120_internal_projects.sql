CREATE TABLE "internal_project_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee_id" uuid,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_project_items_title_check" CHECK (public.agency_project_title_valid("internal_project_items"."title")),
	CONSTRAINT "internal_project_items_status_check" CHECK ("internal_project_items"."status" IN ('todo', 'in-progress', 'done')),
	CONSTRAINT "internal_project_items_revision_check" CHECK ("internal_project_items"."revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "agency_projects" DROP CONSTRAINT "agency_projects_anchor_check";--> statement-breakpoint
ALTER TABLE "agency_projects" ADD COLUMN "kind" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_items_project_order_idx" ON "internal_project_items" USING btree ("project_id","created_at","id");--> statement-breakpoint
ALTER TABLE "agency_projects" ADD CONSTRAINT "agency_projects_anchor_check" CHECK (
      ("agency_projects"."kind" = 'client' AND ("agency_projects"."deal_id" IS NOT NULL OR "agency_projects"."person_id" IS NOT NULL OR "agency_projects"."org_id" IS NOT NULL))
      OR ("agency_projects"."kind" = 'internal' AND "agency_projects"."deal_id" IS NULL AND "agency_projects"."person_id" IS NULL AND "agency_projects"."org_id" IS NULL)
      );