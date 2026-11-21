ALTER TYPE "public"."file_entity_type" ADD VALUE 'inventory_purchase_receipt';--> statement-breakpoint
CREATE TABLE "inventory_purchase_order_line_costs" (
	"line_id" uuid PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"min_packs" integer NOT NULL,
	CONSTRAINT "inventory_purchase_line_costs_amount_check" CHECK ("inventory_purchase_order_line_costs"."currency" ~ '^[A-Z]{3}$' AND "inventory_purchase_order_line_costs"."amount" BETWEEN 0 AND 99999999999999.9999
        AND "inventory_purchase_order_line_costs"."min_packs" BETWEEN 1 AND 1000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"offer_version" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"part_code" text NOT NULL,
	"part_name" text NOT NULL,
	"revision" text NOT NULL,
	"part_number" text NOT NULL,
	"stock_unit" text NOT NULL,
	"trackable" boolean NOT NULL,
	"pack_quantity" integer NOT NULL,
	"packs" integer NOT NULL,
	"ordered_units" integer NOT NULL,
	"incoming_id" uuid,
	CONSTRAINT "inventory_purchase_lines_id_order_key" UNIQUE("id","order_id"),
	CONSTRAINT "inventory_purchase_lines_offer_key" UNIQUE("order_id","offer_id"),
	CONSTRAINT "inventory_purchase_lines_incoming_key" UNIQUE("incoming_id"),
	CONSTRAINT "inventory_purchase_lines_quantity_check" CHECK ("inventory_purchase_order_lines"."offer_version" >= 1 AND "inventory_purchase_order_lines"."pack_quantity" BETWEEN 1 AND 1000000000
        AND "inventory_purchase_order_lines"."packs" BETWEEN 1 AND 1000000 AND "inventory_purchase_order_lines"."ordered_units" BETWEEN 1 AND 1000000000
        AND "inventory_purchase_order_lines"."ordered_units" = "inventory_purchase_order_lines"."pack_quantity"::bigint * "inventory_purchase_order_lines"."packs")
);
--> statement-breakpoint
CREATE TABLE "inventory_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"supplier_organization_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"expected_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "inventory_purchase_orders_id_site_key" UNIQUE("id","site_id"),
	CONSTRAINT "inventory_purchase_orders_reference_check" CHECK (length("inventory_purchase_orders"."reference") BETWEEN 1 AND 120 AND "inventory_purchase_orders"."reference" = btrim("inventory_purchase_orders"."reference")),
	CONSTRAINT "inventory_purchase_orders_version_check" CHECK ("inventory_purchase_orders"."version" >= 1),
	CONSTRAINT "inventory_purchase_orders_status_check" CHECK (("inventory_purchase_orders"."status" = 'draft' AND "inventory_purchase_orders"."issued_at" IS NULL AND "inventory_purchase_orders"."cancellation_reason" IS NULL)
        OR ("inventory_purchase_orders"."status" IN ('open', 'partial', 'received') AND "inventory_purchase_orders"."issued_at" IS NOT NULL AND "inventory_purchase_orders"."cancellation_reason" IS NULL)
        OR ("inventory_purchase_orders"."status" = 'cancelled' AND "inventory_purchase_orders"."cancellation_reason" IS NOT NULL
          AND length(btrim("inventory_purchase_orders"."cancellation_reason")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "inventory_purchase_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"lot" text,
	"serial" text,
	"expiry_date" date,
	"disposition" text NOT NULL,
	"reason" text,
	"position_id" uuid,
	"event_id" uuid,
	CONSTRAINT "inventory_purchase_receipt_lines_event_key" UNIQUE("event_id"),
	CONSTRAINT "inventory_purchase_receipt_lines_quantity_check" CHECK ("inventory_purchase_receipt_lines"."quantity" BETWEEN 1 AND 1000000000 AND ("inventory_purchase_receipt_lines"."serial" IS NULL OR "inventory_purchase_receipt_lines"."quantity" = 1)),
	CONSTRAINT "inventory_purchase_receipt_lines_disposition_check" CHECK (("inventory_purchase_receipt_lines"."disposition" = 'accepted' AND "inventory_purchase_receipt_lines"."position_id" IS NOT NULL AND "inventory_purchase_receipt_lines"."event_id" IS NOT NULL)
        OR ("inventory_purchase_receipt_lines"."disposition" = 'rejected' AND "inventory_purchase_receipt_lines"."position_id" IS NULL AND "inventory_purchase_receipt_lines"."event_id" IS NULL
          AND "inventory_purchase_receipt_lines"."reason" IS NOT NULL AND length(btrim("inventory_purchase_receipt_lines"."reason")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "inventory_purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_slip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_purchase_receipts_id_order_key" UNIQUE("id","order_id"),
	CONSTRAINT "inventory_purchase_receipts_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "inventory_purchase_receipts_slip_check" CHECK (length("inventory_purchase_receipts"."supplier_slip") BETWEEN 1 AND 120 AND "inventory_purchase_receipts"."supplier_slip" = btrim("inventory_purchase_receipts"."supplier_slip"))
);
--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_line_costs" ADD CONSTRAINT "inventory_purchase_order_line_costs_line_id_inventory_purchase_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inventory_purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_lines_order_fk" FOREIGN KEY ("order_id","site_id") REFERENCES "public"."inventory_purchase_orders"("id","site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_lines_offer_fk" FOREIGN KEY ("site_id","item_id","offer_id") REFERENCES "public"."inventory_supplier_offers"("site_id","item_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_lines_incoming_fk" FOREIGN KEY ("incoming_id","item_id") REFERENCES "public"."inventory_stock_incoming"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_supplier_organization_id_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_receipt_lines" ADD CONSTRAINT "inventory_purchase_receipt_lines_position_id_inventory_stock_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."inventory_stock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_receipt_lines" ADD CONSTRAINT "inventory_purchase_receipt_lines_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_receipt_lines" ADD CONSTRAINT "inventory_purchase_receipt_lines_batch_fk" FOREIGN KEY ("receipt_id","order_id") REFERENCES "public"."inventory_purchase_receipts"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_receipt_lines" ADD CONSTRAINT "inventory_purchase_receipt_lines_order_line_fk" FOREIGN KEY ("line_id","order_id") REFERENCES "public"."inventory_purchase_order_lines"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_receipts" ADD CONSTRAINT "inventory_purchase_receipts_order_id_inventory_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_receipts" ADD CONSTRAINT "inventory_purchase_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_purchase_orders_site_reference_key" ON "inventory_purchase_orders" USING btree ("site_id",lower("reference"));--> statement-breakpoint
CREATE INDEX "inventory_purchase_orders_site_status_idx" ON "inventory_purchase_orders" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "inventory_purchase_receipt_lines_receipt_idx" ON "inventory_purchase_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "inventory_purchase_receipts_order_idx" ON "inventory_purchase_receipts" USING btree ("order_id","created_at");
--> statement-breakpoint
CREATE TRIGGER "inventory_purchase_receipts_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_purchase_receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_purchase_receipt_lines_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_purchase_receipt_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_purchase_order_line_costs_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_purchase_order_line_costs"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
