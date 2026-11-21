CREATE TABLE "directory_command_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_command_receipts_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "directory_command_receipts_fingerprint_check" CHECK ("directory_command_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "directory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "directory_locations_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "directory_locations_site_code_key" UNIQUE("site_id","code"),
	CONSTRAINT "directory_locations_name_check" CHECK (length(btrim("directory_locations"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "directory_locations_code_check" CHECK ("directory_locations"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$'),
	CONSTRAINT "directory_locations_no_self_parent" CHECK ("directory_locations"."parent_id" <> "directory_locations"."id")
);
--> statement-breakpoint
CREATE TABLE "directory_site_grants" (
	"site_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "directory_site_grants_pkey" PRIMARY KEY("site_id","user_id"),
	CONSTRAINT "directory_site_grants_role_check" CHECK ("directory_site_grants"."role" IN ('viewer', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "directory_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "directory_sites_code_key" UNIQUE("code"),
	CONSTRAINT "directory_sites_name_check" CHECK (length(btrim("directory_sites"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "directory_sites_code_check" CHECK ("directory_sites"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,23}$')
);
--> statement-breakpoint
ALTER TABLE "directory_command_receipts" ADD CONSTRAINT "directory_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_command_receipts" ADD CONSTRAINT "directory_command_receipts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_command_receipts" ADD CONSTRAINT "directory_command_receipts_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_locations" ADD CONSTRAINT "directory_locations_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_locations" ADD CONSTRAINT "directory_locations_parent_site_fk" FOREIGN KEY ("site_id","parent_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_site_grants" ADD CONSTRAINT "directory_site_grants_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_site_grants" ADD CONSTRAINT "directory_site_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directory_locations_site_parent_idx" ON "directory_locations" USING btree ("site_id","parent_id");--> statement-breakpoint
CREATE INDEX "directory_site_grants_user_idx" ON "directory_site_grants" USING btree ("user_id");