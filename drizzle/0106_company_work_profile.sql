CREATE TABLE "company_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"slot" text NOT NULL,
	"fingerprint" text NOT NULL,
	"object_key" text NOT NULL,
	"digest" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size" integer NOT NULL,
	"ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_assets_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "company_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "company_assets_slot" CHECK ("company_assets"."slot" IN ('icon','logo')),
	CONSTRAINT "company_assets_size" CHECK ("company_assets"."size" > 0 AND "company_assets"."size" <= 2097152)
);
--> statement-breakpoint
CREATE TABLE "company_legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"data_ciphertext" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"parent_entity_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_legal_entity_revision" CHECK ("company_legal_entities"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "company_operations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"response_ciphertext" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"workspace_scope" uuid DEFAULT gen_random_uuid() NOT NULL,
	"details_ciphertext" text,
	"details_revision" integer DEFAULT 0 NOT NULL,
	"branding" jsonb DEFAULT '{"iconAssetId":null,"logoAssetId":null,"accentColor":null,"fit":"contain"}'::jsonb NOT NULL,
	"branding_revision" integer DEFAULT 0 NOT NULL,
	"payer_ciphertext" text,
	"payer_revision" integer DEFAULT 0 NOT NULL,
	"details_provenance" jsonb,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profiles_singleton" CHECK ("company_profiles"."id" = true),
	CONSTRAINT "company_profiles_revisions" CHECK ("company_profiles"."details_revision" >= 0 AND "company_profiles"."branding_revision" >= 0 AND "company_profiles"."payer_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"preset_id" text NOT NULL,
	"preset_version" integer NOT NULL,
	"resources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "work_installations_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" uuid NOT NULL,
	"organization_id" uuid,
	"person_id" uuid,
	"deal_id" uuid,
	"due_date" text,
	"visibility" "visibility_level" DEFAULT 'owner' NOT NULL,
	"visibility_group_id" uuid,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_visibility_group" CHECK (("work_items"."visibility" = 'group') = ("work_items"."visibility_group_id" IS NOT NULL)),
	CONSTRAINT "work_items_revision" CHECK ("work_items"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "work_operations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"bucket" text NOT NULL,
	"order" integer NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "work_stages_type_key" UNIQUE("type_id","key"),
	CONSTRAINT "work_stages_id_type" UNIQUE("id","type_id"),
	CONSTRAINT "work_stages_bucket" CHECK ("work_stages"."bucket" IN ('open','complete','canceled'))
);
--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_types_key_unique" UNIQUE("key"),
	CONSTRAINT "work_types_kind" CHECK ("work_types"."kind" IN ('vehicle_repair','design','it_consulting','custom')),
	CONSTRAINT "work_types_revision" CHECK ("work_types"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_work_profiles" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"preferences" jsonb DEFAULT '{"workTypes":[],"primaryWorkType":null,"modules":[],"primaryGoal":"","deliveryModels":[],"customerTypes":[]}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_work_profiles_singleton" CHECK ("workspace_work_profiles"."id" = true),
	CONSTRAINT "workspace_work_profiles_revision" CHECK ("workspace_work_profiles"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_installations" ADD CONSTRAINT "work_installations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_type_id_work_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_visibility_group_id_visibility_groups_id_fk" FOREIGN KEY ("visibility_group_id") REFERENCES "public"."visibility_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_stage_type" FOREIGN KEY ("stage_id","type_id") REFERENCES "public"."work_stages"("id","type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_operations" ADD CONSTRAINT "work_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_stages" ADD CONSTRAINT "work_stages_type_id_work_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_items_type_stage" ON "work_items" USING btree ("type_id","stage_id");--> statement-breakpoint
CREATE INDEX "work_items_owner" ON "work_items" USING btree ("owner_id");