CREATE TABLE "operations_access_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean NOT NULL,
	"changed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_access_receipts_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "operations_access_receipts_role_check" CHECK ("operations_access_receipts"."role" IN ('warehouse_viewer', 'warehouse_manager', 'asset_viewer', 'asset_manager', 'buyer', 'cost_viewer'))
);
--> statement-breakpoint
CREATE TABLE "operations_site_grants" (
	"site_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "operations_site_grants_pkey" PRIMARY KEY("site_id","user_id","role"),
	CONSTRAINT "operations_site_grants_role_check" CHECK ("operations_site_grants"."role" IN ('warehouse_viewer', 'warehouse_manager', 'asset_viewer', 'asset_manager', 'buyer', 'cost_viewer'))
);
--> statement-breakpoint
ALTER TABLE "operations_site_grants" ADD CONSTRAINT "operations_site_grants_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_site_grants" ADD CONSTRAINT "operations_site_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_access_receipts_subject_idx" ON "operations_access_receipts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "operations_site_grants_user_idx" ON "operations_site_grants" USING btree ("user_id");
--> statement-breakpoint
CREATE FUNCTION "public"."operations_reject_access_receipt_rewrite"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Operations access history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "operations_access_receipt_append_only"
BEFORE UPDATE OR DELETE ON "public"."operations_access_receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."operations_reject_access_receipt_rewrite"();
