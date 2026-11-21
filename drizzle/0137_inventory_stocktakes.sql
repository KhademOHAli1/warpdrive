CREATE TABLE "inventory_stocktake_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"revision" text NOT NULL,
	"lot" text,
	"serial" text,
	"expiry_date" date,
	"owner_organization_id" uuid,
	"state" text NOT NULL,
	"expected_on_hand" integer NOT NULL,
	"reserved" integer NOT NULL,
	"event_sequence" bigint NOT NULL,
	"counted_quantity" integer,
	"reason" text,
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"correction_event_id" uuid,
	CONSTRAINT "inventory_stocktake_lines_position_key" UNIQUE("stocktake_id","position_id"),
	CONSTRAINT "inventory_stocktake_lines_correction_key" UNIQUE("correction_event_id"),
	CONSTRAINT "inventory_stocktake_lines_capture_check" CHECK ("inventory_stocktake_lines"."expected_on_hand" BETWEEN 1 AND 1000000000
        AND "inventory_stocktake_lines"."reserved" BETWEEN 0 AND "inventory_stocktake_lines"."expected_on_hand"
        AND "inventory_stocktake_lines"."event_sequence" >= 0
        AND "inventory_stocktake_lines"."state" IN ('available', 'quarantine', 'hold')
        AND ("inventory_stocktake_lines"."serial" IS NULL OR "inventory_stocktake_lines"."expected_on_hand" = 1)),
	CONSTRAINT "inventory_stocktake_lines_observation_check" CHECK (("inventory_stocktake_lines"."counted_quantity" IS NULL AND "inventory_stocktake_lines"."counted_by" IS NULL AND "inventory_stocktake_lines"."counted_at" IS NULL
          AND "inventory_stocktake_lines"."reason" IS NULL AND "inventory_stocktake_lines"."correction_event_id" IS NULL)
        OR ("inventory_stocktake_lines"."counted_quantity" IS NOT NULL AND "inventory_stocktake_lines"."counted_by" IS NOT NULL AND "inventory_stocktake_lines"."counted_at" IS NOT NULL
          AND "inventory_stocktake_lines"."counted_quantity" BETWEEN 0 AND 1000000000
          AND ("inventory_stocktake_lines"."serial" IS NULL OR "inventory_stocktake_lines"."counted_quantity" <= 1)
          AND ("inventory_stocktake_lines"."reason" IS NULL OR length(btrim("inventory_stocktake_lines"."reason")) BETWEEN 1 AND 500)
          AND ("inventory_stocktake_lines"."counted_quantity" <> "inventory_stocktake_lines"."expected_on_hand" OR "inventory_stocktake_lines"."correction_event_id" IS NULL)
          AND ("inventory_stocktake_lines"."counted_quantity" = "inventory_stocktake_lines"."expected_on_hand" OR "inventory_stocktake_lines"."reason" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "inventory_stocktakes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"location_name" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"bin_event_sequence" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "inventory_stocktakes_version_check" CHECK ("inventory_stocktakes"."version" > 0),
	CONSTRAINT "inventory_stocktakes_sequence_check" CHECK ("inventory_stocktakes"."bin_event_sequence" >= 0),
	CONSTRAINT "inventory_stocktakes_note_check" CHECK (length("inventory_stocktakes"."note") <= 500),
	CONSTRAINT "inventory_stocktakes_state_check" CHECK (("inventory_stocktakes"."status" = 'draft' AND "inventory_stocktakes"."closed_by" IS NULL AND "inventory_stocktakes"."closed_at" IS NULL
        AND "inventory_stocktakes"."cancellation_reason" IS NULL)
        OR ("inventory_stocktakes"."status" = 'reconciled' AND "inventory_stocktakes"."closed_by" IS NOT NULL AND "inventory_stocktakes"."closed_at" IS NOT NULL
          AND "inventory_stocktakes"."cancellation_reason" IS NULL)
        OR ("inventory_stocktakes"."status" = 'cancelled' AND "inventory_stocktakes"."closed_by" IS NOT NULL AND "inventory_stocktakes"."closed_at" IS NOT NULL
          AND "inventory_stocktakes"."cancellation_reason" IS NOT NULL
          AND length(btrim("inventory_stocktakes"."cancellation_reason")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE TABLE "inventory_valuation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"location_name" text NOT NULL,
	"part_code" text NOT NULL,
	"part_name" text NOT NULL,
	"revision" text NOT NULL,
	"stock_unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"reserved" integer NOT NULL,
	"stock_state" text NOT NULL,
	"lot" text,
	"serial" text,
	"source" text NOT NULL,
	"basis_amount" numeric(18, 4),
	"basis_pack_quantity" integer,
	"receipt_line_id" uuid,
	"value" numeric(38, 4),
	CONSTRAINT "inventory_valuation_lines_position_key" UNIQUE("snapshot_id","position_id"),
	CONSTRAINT "inventory_valuation_lines_quantity_check" CHECK ("inventory_valuation_lines"."quantity" BETWEEN 1 AND 1000000000
        AND "inventory_valuation_lines"."reserved" BETWEEN 0 AND "inventory_valuation_lines"."quantity"
        AND ("inventory_valuation_lines"."serial" IS NULL OR "inventory_valuation_lines"."quantity" = 1)),
	CONSTRAINT "inventory_valuation_lines_stock_state_check" CHECK ("inventory_valuation_lines"."stock_state" IN ('available', 'quarantine', 'hold')),
	CONSTRAINT "inventory_valuation_lines_basis_check" CHECK (("inventory_valuation_lines"."source" = 'unvalued' AND "inventory_valuation_lines"."basis_amount" IS NULL
          AND "inventory_valuation_lines"."basis_pack_quantity" IS NULL AND "inventory_valuation_lines"."receipt_line_id" IS NULL AND "inventory_valuation_lines"."value" IS NULL)
        OR ("inventory_valuation_lines"."source" IN ('override', 'purchase_receipt') AND "inventory_valuation_lines"."basis_amount" IS NOT NULL
          AND "inventory_valuation_lines"."basis_amount" BETWEEN 0 AND 99999999999999.9999
          AND "inventory_valuation_lines"."basis_pack_quantity" IS NOT NULL AND "inventory_valuation_lines"."basis_pack_quantity" BETWEEN 1 AND 1000000000
          AND "inventory_valuation_lines"."value" IS NOT NULL AND "inventory_valuation_lines"."value" >= 0
          AND (("inventory_valuation_lines"."source" = 'override' AND "inventory_valuation_lines"."receipt_line_id" IS NULL AND "inventory_valuation_lines"."basis_pack_quantity" = 1)
            OR ("inventory_valuation_lines"."source" = 'purchase_receipt' AND "inventory_valuation_lines"."receipt_line_id" IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE "inventory_valuation_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"label" text NOT NULL,
	"currency" text NOT NULL,
	"captured_by" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "inventory_valuation_snapshots_id_site_key" UNIQUE("id","site_id"),
	CONSTRAINT "inventory_valuation_snapshots_label_check" CHECK ("inventory_valuation_snapshots"."label" = btrim("inventory_valuation_snapshots"."label") AND length("inventory_valuation_snapshots"."label") BETWEEN 1 AND 120),
	CONSTRAINT "inventory_valuation_snapshots_currency_check" CHECK ("inventory_valuation_snapshots"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_stocktake_lines" ADD CONSTRAINT "inventory_stocktake_lines_stocktake_id_inventory_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."inventory_stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktake_lines" ADD CONSTRAINT "inventory_stocktake_lines_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktake_lines" ADD CONSTRAINT "inventory_stocktake_lines_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktake_lines" ADD CONSTRAINT "inventory_stocktake_lines_correction_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("correction_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktake_lines" ADD CONSTRAINT "inventory_stocktake_lines_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktakes" ADD CONSTRAINT "inventory_stocktakes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktakes" ADD CONSTRAINT "inventory_stocktakes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stocktakes" ADD CONSTRAINT "inventory_stocktakes_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_valuation_lines" ADD CONSTRAINT "inventory_valuation_lines_receipt_line_id_inventory_purchase_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."inventory_purchase_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_valuation_lines" ADD CONSTRAINT "inventory_valuation_lines_snapshot_fk" FOREIGN KEY ("snapshot_id","site_id") REFERENCES "public"."inventory_valuation_snapshots"("id","site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_valuation_lines" ADD CONSTRAINT "inventory_valuation_lines_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_valuation_lines" ADD CONSTRAINT "inventory_valuation_lines_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_valuation_snapshots" ADD CONSTRAINT "inventory_valuation_snapshots_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_valuation_snapshots" ADD CONSTRAINT "inventory_valuation_snapshots_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_stocktakes_site_history_idx" ON "inventory_stocktakes" USING btree ("site_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inventory_valuation_snapshots_site_time_idx" ON "inventory_valuation_snapshots" USING btree ("site_id","captured_at","id");--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_stocktake_header"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Stocktake history is retained';
  END IF;
  IF OLD.status <> 'draft' OR NEW.version <> OLD.version + 1 OR
    (to_jsonb(NEW) - ARRAY['version', 'status', 'closed_by', 'closed_at', 'cancellation_reason'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['version', 'status', 'closed_by', 'closed_at', 'cancellation_reason'])
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Stocktake capture and closed history are immutable';
  END IF;
  IF NEW.status = 'reconciled' AND EXISTS (
    SELECT 1 FROM "public"."inventory_stocktake_lines" AS line
    WHERE line.stocktake_id = NEW.id AND (
      line.counted_quantity IS NULL
      OR ((line.counted_quantity <> line.expected_on_hand) <> (line.correction_event_id IS NOT NULL))
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Every reconciled count must retain its observation and any correction';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_stocktake_header_guard"
BEFORE UPDATE OR DELETE ON "public"."inventory_stocktakes"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_stocktake_header"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_stocktake_line"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Stocktake line history is retained';
  END IF;
  SELECT header.status INTO parent_status
  FROM "public"."inventory_stocktakes" AS header WHERE header.id = NEW.stocktake_id FOR SHARE;
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Closed stocktake lines are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.correction_event_id IS NOT NULL OR
    (to_jsonb(NEW) - ARRAY['counted_quantity', 'reason', 'counted_by', 'counted_at', 'correction_event_id'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['counted_quantity', 'reason', 'counted_by', 'counted_at', 'correction_event_id'])
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Captured stocktake positions and correction links are immutable';
  END IF;
  IF NEW.correction_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."inventory_stock_events" AS event
    WHERE event.id = NEW.correction_event_id AND event.position_id = NEW.position_id
      AND event.item_id = NEW.item_id AND event.kind = 'correction'
      AND event.on_hand_delta = NEW.counted_quantity - NEW.expected_on_hand
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Stocktake correction must match the counted position and quantity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_stocktake_line_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_stocktake_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_stocktake_line"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_valuation_header"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT OLD.sealed AND NEW.sealed AND
    (to_jsonb(NEW) - 'sealed') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'sealed')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Valuation snapshots are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_valuation_header_guard"
BEFORE UPDATE OR DELETE ON "public"."inventory_valuation_snapshots"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_valuation_header"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_valuation_line"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  parent_sealed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT header.sealed INTO parent_sealed
    FROM "public"."inventory_valuation_snapshots" AS header WHERE header.id = NEW.snapshot_id FOR SHARE;
    IF parent_sealed = false THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Captured valuation lines are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_valuation_line_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_valuation_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_valuation_line"();
