CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_version_number_unique" UNIQUE("workflow_id","number"),
	CONSTRAINT "workflow_version_number_positive" CHECK ("workflow_versions"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"draft" jsonb NOT NULL,
	"published_number" integer,
	"active" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_revision_positive" CHECK ("workflows"."revision" > 0),
	CONSTRAINT "workflows_active_published" CHECK (NOT "workflows"."active" OR ("workflows"."published_number" IS NOT NULL AND "workflows"."archived_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_owner_idx" ON "workflows" USING btree ("owner_id");
--> statement-breakpoint
ALTER TABLE public.workflows ADD CONSTRAINT workflows_published_version_fk
FOREIGN KEY (id, published_number) REFERENCES public.workflow_versions (workflow_id, number);
--> statement-breakpoint
CREATE FUNCTION public.workflow_version_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Published workflow versions are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_versions_immutable
BEFORE UPDATE OR DELETE ON public.workflow_versions
FOR EACH ROW EXECUTE FUNCTION public.workflow_version_immutable();
