ALTER TYPE "public"."file_entity_type" ADD VALUE 'inventory_item';--> statement-breakpoint
CREATE TABLE "inventory_catalog_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"focus_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_catalog_receipts_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "inventory_catalog_receipts_fingerprint_check" CHECK ("inventory_catalog_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_part_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"default_unit" text,
	"parameters" jsonb NOT NULL,
	CONSTRAINT "inventory_part_categories_code_key" UNIQUE("code"),
	CONSTRAINT "inventory_part_categories_code_check" CHECK ("inventory_part_categories"."code" ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
	CONSTRAINT "inventory_part_categories_name_check" CHECK (length(btrim("inventory_part_categories"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "inventory_part_categories_no_self_parent" CHECK ("inventory_part_categories"."parent_id" <> "inventory_part_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "inventory_part_families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "inventory_part_families_code_key" UNIQUE("code"),
	CONSTRAINT "inventory_part_families_code_check" CHECK ("inventory_part_families"."code" ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_part_profiles" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"revision_key" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"category_id" uuid,
	"state_id" uuid,
	"template_item_id" uuid,
	"supersedes_item_id" uuid,
	"related_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"stock_mode" text DEFAULT 'stocked' NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"flags" jsonb NOT NULL,
	"parameter_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "inventory_part_family_revision_key" UNIQUE("family_id","revision_key"),
	CONSTRAINT "inventory_part_profiles_version_check" CHECK ("inventory_part_profiles"."version" >= 0),
	CONSTRAINT "inventory_part_profiles_template_self_check" CHECK ("inventory_part_profiles"."template_item_id" <> "inventory_part_profiles"."item_id"),
	CONSTRAINT "inventory_part_profiles_supersedes_self_check" CHECK ("inventory_part_profiles"."supersedes_item_id" <> "inventory_part_profiles"."item_id"),
	CONSTRAINT "inventory_part_profiles_stock_mode_check" CHECK ("inventory_part_profiles"."stock_mode" IN ('stocked', 'virtual', 'consumable')),
	CONSTRAINT "inventory_part_profiles_visibility_check" CHECK ("inventory_part_profiles"."visibility" IN ('staff', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "inventory_part_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"locked" boolean NOT NULL,
	CONSTRAINT "inventory_part_states_code_key" UNIQUE("code"),
	CONSTRAINT "inventory_part_states_code_check" CHECK ("inventory_part_states"."code" ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
	CONSTRAINT "inventory_part_states_name_check" CHECK (length(btrim("inventory_part_states"."name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "inventory_catalog_receipts" ADD CONSTRAINT "inventory_catalog_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_categories" ADD CONSTRAINT "inventory_part_category_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."inventory_part_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_profiles" ADD CONSTRAINT "inventory_part_profiles_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_profiles" ADD CONSTRAINT "inventory_part_profiles_family_id_inventory_part_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."inventory_part_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_profiles" ADD CONSTRAINT "inventory_part_profiles_category_id_inventory_part_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_part_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_profiles" ADD CONSTRAINT "inventory_part_profiles_state_id_inventory_part_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."inventory_part_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_profiles" ADD CONSTRAINT "inventory_part_profiles_template_item_id_inventory_items_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_part_profiles" ADD CONSTRAINT "inventory_part_profiles_supersedes_item_id_inventory_items_id_fk" FOREIGN KEY ("supersedes_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_part_categories_parent_idx" ON "inventory_part_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "inventory_part_profiles_category_idx" ON "inventory_part_profiles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "inventory_part_profiles_state_idx" ON "inventory_part_profiles" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "inventory_part_profiles_template_idx" ON "inventory_part_profiles" USING btree ("template_item_id");--> statement-breakpoint
CREATE INDEX "inventory_part_profiles_supersedes_idx" ON "inventory_part_profiles" USING btree ("supersedes_item_id");--> statement-breakpoint
INSERT INTO "inventory_part_families" ("id", "code")
SELECT "id", "sku" FROM "inventory_items";
--> statement-breakpoint
INSERT INTO "inventory_part_profiles" ("item_id", "family_id", "revision_key", "flags")
SELECT "id", "id", upper(btrim("revision")), jsonb_build_object(
  'assembly', "kind" = 'product',
  'component', "kind" = 'component',
  'purchasable', "kind" = 'component',
  'salable', "kind" = 'product',
  'testable', false,
  'trackable', false
) FROM "inventory_items";
