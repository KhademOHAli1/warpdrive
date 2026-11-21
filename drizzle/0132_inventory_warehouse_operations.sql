CREATE TABLE "inventory_stock_event_details" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"site_id" uuid,
	"location_id" uuid,
	"transfer_id" uuid,
	"transfer_line_id" uuid,
	"reason" text,
	"reverses_event_id" uuid,
	"previous_on_hand" integer,
	CONSTRAINT "inventory_stock_event_detail_sequence_key" UNIQUE("sequence"),
	CONSTRAINT "inventory_stock_event_detail_location_pair_check" CHECK (("inventory_stock_event_details"."site_id" IS NULL) = ("inventory_stock_event_details"."location_id" IS NULL)),
	CONSTRAINT "inventory_stock_event_detail_transfer_pair_check" CHECK (("inventory_stock_event_details"."transfer_id" IS NULL) = ("inventory_stock_event_details"."transfer_line_id" IS NULL)),
	CONSTRAINT "inventory_stock_event_detail_reason_check" CHECK (length(btrim("inventory_stock_event_details"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "inventory_stock_event_detail_reversal_check" CHECK ("inventory_stock_event_details"."reverses_event_id" <> "inventory_stock_event_details"."event_id"),
	CONSTRAINT "inventory_stock_event_detail_count_check" CHECK ("inventory_stock_event_details"."previous_on_hand" BETWEEN 0 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_position_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"lot" text,
	"serial" text,
	"expiry_date" date,
	"state" text NOT NULL,
	"owner_organization_id" uuid,
	CONSTRAINT "inventory_stock_transfer_line_parent_key" UNIQUE("transfer_id","id"),
	CONSTRAINT "inventory_stock_transfer_line_position_key" UNIQUE("transfer_id","source_position_id"),
	CONSTRAINT "inventory_stock_transfer_line_count_check" CHECK ("inventory_stock_transfer_lines"."quantity" BETWEEN 1 AND 1000000 AND "inventory_stock_transfer_lines"."received" BETWEEN 0 AND "inventory_stock_transfer_lines"."quantity"),
	CONSTRAINT "inventory_stock_transfer_line_serial_check" CHECK ("inventory_stock_transfer_lines"."serial" IS NULL OR "inventory_stock_transfer_lines"."quantity" = 1),
	CONSTRAINT "inventory_stock_transfer_line_state_check" CHECK ("inventory_stock_transfer_lines"."state" IN ('available', 'quarantine', 'hold'))
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"destination_site_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_stock_transfer_locations_check" CHECK ("inventory_stock_transfers"."source_location_id" <> "inventory_stock_transfers"."destination_location_id"),
	CONSTRAINT "inventory_stock_transfer_status_check" CHECK ("inventory_stock_transfers"."status" IN ('draft', 'in_transit', 'received', 'cancelled')),
	CONSTRAINT "inventory_stock_transfer_version_check" CHECK ("inventory_stock_transfers"."version" > 0),
	CONSTRAINT "inventory_stock_transfer_reason_check" CHECK (length(btrim("inventory_stock_transfers"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_event_details" ADD CONSTRAINT "inventory_stock_event_details_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_event_details" ADD CONSTRAINT "inventory_stock_event_details_reverses_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("reverses_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_event_details" ADD CONSTRAINT "inventory_stock_event_detail_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_event_details" ADD CONSTRAINT "inventory_stock_event_detail_transfer_fk" FOREIGN KEY ("transfer_id","transfer_line_id") REFERENCES "public"."inventory_stock_transfer_lines"("transfer_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_transfer_lines" ADD CONSTRAINT "inventory_stock_transfer_lines_transfer_id_inventory_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inventory_stock_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_transfer_lines" ADD CONSTRAINT "inventory_stock_transfer_lines_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_transfer_lines" ADD CONSTRAINT "inventory_stock_transfer_line_position_fk" FOREIGN KEY ("source_position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_transfers" ADD CONSTRAINT "inventory_stock_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_transfers" ADD CONSTRAINT "inventory_stock_transfer_source_fk" FOREIGN KEY ("source_site_id","source_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_transfers" ADD CONSTRAINT "inventory_stock_transfer_destination_fk" FOREIGN KEY ("destination_site_id","destination_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_event_detail_reversal_key" ON "inventory_stock_event_details" USING btree ("reverses_event_id") WHERE "inventory_stock_event_details"."reverses_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_stock_event_detail_site_sequence_idx" ON "inventory_stock_event_details" USING btree ("site_id","sequence");--> statement-breakpoint
CREATE INDEX "inventory_stock_transfer_line_position_idx" ON "inventory_stock_transfer_lines" USING btree ("source_position_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_transfer_source_idx" ON "inventory_stock_transfers" USING btree ("source_site_id","source_location_id","status");--> statement-breakpoint
CREATE INDEX "inventory_stock_transfer_destination_idx" ON "inventory_stock_transfers" USING btree ("destination_site_id","destination_location_id","status");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release',
        'transfer-dispatch', 'transfer-receive', 'correction', 'correction-reversal'));--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal'));--> statement-breakpoint
-- All stock positions stayed at their original location through migration 0131.
INSERT INTO "public"."inventory_stock_event_details" ("event_id", "site_id", "location_id")
SELECT event.id,
  COALESCE(position.site_id, source_position.site_id, incoming.site_id),
  COALESCE(position.location_id, source_position.location_id, incoming.location_id)
FROM "public"."inventory_stock_events" AS event
LEFT JOIN "public"."inventory_stock_positions" AS position ON position.id = event.position_id
LEFT JOIN "public"."inventory_stock_positions" AS source_position ON source_position.id = event.source_position_id
LEFT JOIN "public"."inventory_stock_incoming" AS incoming ON incoming.id = event.incoming_id
ORDER BY event.created_at, event.id;
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_capture_stock_event_location"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  INSERT INTO "public"."inventory_stock_event_details" ("event_id", "site_id", "location_id")
  SELECT NEW.id,
    COALESCE(position.site_id, source_position.site_id, incoming.site_id),
    COALESCE(position.location_id, source_position.location_id, incoming.location_id)
  FROM (VALUES (NEW.position_id, NEW.source_position_id, NEW.incoming_id)) AS event(position_id, source_position_id, incoming_id)
  LEFT JOIN "public"."inventory_stock_positions" AS position ON position.id = event.position_id
  LEFT JOIN "public"."inventory_stock_positions" AS source_position ON source_position.id = event.source_position_id
  LEFT JOIN "public"."inventory_stock_incoming" AS incoming ON incoming.id = event.incoming_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location"
AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal'
))
EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_reject_stock_operation_rewrite"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Warehouse operation history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_stock_operations_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal'
))
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_stock_operation_details_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_event_details"
FOR EACH ROW WHEN (OLD.reason IS NOT NULL)
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
