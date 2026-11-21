CREATE TABLE "internal_project_cover_assets" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"version" uuid NOT NULL,
	"image" "bytea" NOT NULL,
	CONSTRAINT "internal_project_cover_assets_size_check" CHECK (octet_length("internal_project_cover_assets"."image") BETWEEN 1 AND 786432)
);
--> statement-breakpoint
CREATE TABLE "internal_project_publications" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"anchor" uuid,
	"revision" bigint DEFAULT 0 NOT NULL,
	"list_enabled" boolean DEFAULT true NOT NULL,
	"board_enabled" boolean DEFAULT true NOT NULL,
	"show_work_items" boolean DEFAULT false NOT NULL,
	"show_branding" boolean DEFAULT false NOT NULL,
	"allow_intake" boolean DEFAULT false NOT NULL,
	CONSTRAINT "internal_project_publications_anchor_key" UNIQUE("anchor"),
	CONSTRAINT "internal_project_publications_revision_check" CHECK ("internal_project_publications"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_publications_layout_check" CHECK ("internal_project_publications"."anchor" IS NULL OR "internal_project_publications"."list_enabled" OR "internal_project_publications"."board_enabled")
);
--> statement-breakpoint
CREATE TABLE "project_integrator_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_slug" text NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"hint" text NOT NULL,
	"access" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "project_integrator_keys_workspace_token_key" UNIQUE("workspace_slug","token_hash"),
	CONSTRAINT "project_integrator_keys_workspace_check" CHECK ("project_integrator_keys"."workspace_slug" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "project_integrator_keys_name_check" CHECK (char_length("project_integrator_keys"."name") BETWEEN 1 AND 100),
	CONSTRAINT "project_integrator_keys_hash_check" CHECK ("project_integrator_keys"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "project_integrator_keys_hint_check" CHECK ("project_integrator_keys"."hint" ~ '^[A-Za-z0-9_-]{4}$'),
	CONSTRAINT "project_integrator_keys_access_check" CHECK ("project_integrator_keys"."access" IN ('read', 'write'))
);
--> statement-breakpoint
ALTER TABLE "agency_project_members" ADD COLUMN "project_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_intake_requests" ADD COLUMN "from_publication" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD COLUMN "logo" jsonb;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD COLUMN "cover" jsonb;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD COLUMN "guest_view_all_features" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "projects_guest_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_cover_assets" ADD CONSTRAINT "internal_project_cover_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."internal_project_settings"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_publications" ADD CONSTRAINT "internal_project_publications_project_id_agency_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integrator_keys" ADD CONSTRAINT "project_integrator_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_integrator_keys_user_workspace_idx" ON "project_integrator_keys" USING btree ("user_id","workspace_slug","created_at");--> statement-breakpoint
ALTER TABLE "agency_project_members" ADD CONSTRAINT "agency_project_members_guest_grants_check" CHECK (NOT "agency_project_members"."project_guest" OR (NOT "agency_project_members"."project_edit" AND NOT "agency_project_members"."assignment_coordinate"));--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD CONSTRAINT "internal_project_settings_visibility_check" CHECK ("internal_project_settings"."visibility" IN ('private', 'workspace'));--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD CONSTRAINT "internal_project_settings_time_zone_check" CHECK ("internal_project_settings"."time_zone" ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,99}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_projects_guest_scope_check" CHECK (NOT "users"."projects_guest_only" OR (NOT "users"."is_admin" AND "users"."permission_set_id" IS NULL AND "users"."primary_visibility_group_id" IS NULL));