CREATE TABLE "asset_booking_handover_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid,
	"kit_id" uuid,
	"checkout_id" uuid,
	"holding_id" uuid,
	"custody_event_id" uuid,
	"source_location_id" uuid,
	"issued" integer NOT NULL,
	"outstanding" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "asset_booking_handover_allocations_scope_key" UNIQUE("site_id","booking_id","id"),
	CONSTRAINT "asset_booking_handover_allocations_holding_key" UNIQUE("holding_id"),
	CONSTRAINT "asset_booking_handover_allocations_checkout_key" UNIQUE("checkout_id"),
	CONSTRAINT "asset_booking_handover_allocations_quantity_check" CHECK ("asset_booking_handover_allocations"."issued" BETWEEN 1 AND 1000000 AND "asset_booking_handover_allocations"."outstanding" BETWEEN 0 AND "asset_booking_handover_allocations"."issued"
        AND ("asset_booking_handover_allocations"."kind" NOT IN ('asset','kit') OR "asset_booking_handover_allocations"."issued" = 1)),
	CONSTRAINT "asset_booking_handover_allocations_type_check" CHECK (
      ("asset_booking_handover_allocations"."kind" = 'kit' AND "asset_booking_handover_allocations"."kit_id" IS NOT NULL AND "asset_booking_handover_allocations"."checkout_id" IS NOT NULL
         AND "asset_booking_handover_allocations"."asset_id" IS NULL AND "asset_booking_handover_allocations"."holding_id" IS NULL AND "asset_booking_handover_allocations"."custody_event_id" IS NULL)
      OR ("asset_booking_handover_allocations"."kind" IN ('asset', 'returnable_pool') AND "asset_booking_handover_allocations"."asset_id" IS NOT NULL
         AND "asset_booking_handover_allocations"."holding_id" IS NOT NULL AND "asset_booking_handover_allocations"."custody_event_id" IS NOT NULL
         AND "asset_booking_handover_allocations"."kit_id" IS NULL AND "asset_booking_handover_allocations"."checkout_id" IS NULL)
      OR ("asset_booking_handover_allocations"."kind" = 'consumable_pool' AND "asset_booking_handover_allocations"."asset_id" IS NOT NULL AND "asset_booking_handover_allocations"."outstanding" = 0
         AND "asset_booking_handover_allocations"."holding_id" IS NULL AND "asset_booking_handover_allocations"."custody_event_id" IS NULL AND "asset_booking_handover_allocations"."kit_id" IS NULL AND "asset_booking_handover_allocations"."checkout_id" IS NULL)),
	CONSTRAINT "asset_booking_handover_allocations_snapshot_check" CHECK (jsonb_typeof("asset_booking_handover_allocations"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "asset_booking_handover_inspections" (
	"receipt_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"condition" text NOT NULL,
	CONSTRAINT "asset_booking_handover_inspections_receipt_id_allocation_id_pk" PRIMARY KEY("receipt_id","allocation_id"),
	CONSTRAINT "asset_booking_handover_inspections_value_check" CHECK ("asset_booking_handover_inspections"."quantity" BETWEEN 1 AND 1000000 AND "asset_booking_handover_inspections"."condition" IN ('damaged','needs_inspection'))
);
--> statement-breakpoint
CREATE TABLE "asset_booking_handover_notice_epoch" (
	"id" boolean PRIMARY KEY NOT NULL,
	"active_at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_booking_handover_notice_epoch_singleton" CHECK ("asset_booking_handover_notice_epoch"."id")
);
--> statement-breakpoint
CREATE TABLE "asset_booking_handover_notices" (
	"booking_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_booking_handover_notices_booking_id_due_at_kind_pk" PRIMARY KEY("booking_id","due_at","kind"),
	CONSTRAINT "asset_booking_handover_notices_value_check" CHECK ("asset_booking_handover_notices"."kind" IN ('overdue','expired') AND "asset_booking_handover_notices"."at" >= "asset_booking_handover_notices"."due_at")
);
--> statement-breakpoint
CREATE TABLE "asset_booking_handover_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"actor_id" uuid,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "asset_booking_handover_receipts_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "asset_booking_handover_receipts_booking_version_key" UNIQUE("booking_id","version"),
	CONSTRAINT "asset_booking_handover_receipts_booking_scope_key" UNIQUE("site_id","booking_id","id"),
	CONSTRAINT "asset_booking_handover_receipts_snapshot_check" CHECK ("asset_booking_handover_receipts"."version" > 0 AND "asset_booking_handover_receipts"."fingerprint" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("asset_booking_handover_receipts"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "asset_booking_handovers" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"approved_version" integer NOT NULL,
	"version" integer NOT NULL,
	"pickup_closed" boolean NOT NULL,
	"custodian_id" uuid,
	"custodian_name" text,
	CONSTRAINT "asset_booking_handovers_site_booking_key" UNIQUE("site_id","booking_id"),
	CONSTRAINT "asset_booking_handovers_versions_check" CHECK ("asset_booking_handovers"."version" > 0 AND "asset_booking_handovers"."approved_version" > 0),
	CONSTRAINT "asset_booking_handovers_custodian_check" CHECK (("asset_booking_handovers"."custodian_id" IS NULL) = ("asset_booking_handovers"."custodian_name" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "asset_booking_handover_allocations" ADD CONSTRAINT "asset_booking_handover_allocations_custody_event_id_asset_custody_history_id_fk" FOREIGN KEY ("custody_event_id") REFERENCES "public"."asset_custody_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_allocations" ADD CONSTRAINT "asset_booking_handover_allocations_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_booking_handovers"("site_id","booking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_allocations" ADD CONSTRAINT "asset_booking_handover_allocations_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_allocations" ADD CONSTRAINT "asset_booking_handover_allocations_kit_checkout_fk" FOREIGN KEY ("site_id","kit_id","checkout_id") REFERENCES "public"."asset_kit_checkouts"("site_id","kit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_allocations" ADD CONSTRAINT "asset_booking_handover_allocations_location_fk" FOREIGN KEY ("site_id","source_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_inspections" ADD CONSTRAINT "asset_booking_handover_inspections_allocation_fk" FOREIGN KEY ("site_id","booking_id","allocation_id") REFERENCES "public"."asset_booking_handover_allocations"("site_id","booking_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_inspections" ADD CONSTRAINT "asset_booking_handover_inspections_receipt_fk" FOREIGN KEY ("site_id","booking_id","receipt_id") REFERENCES "public"."asset_booking_handover_receipts"("site_id","booking_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_inspections" ADD CONSTRAINT "asset_booking_handover_inspections_asset_fk" FOREIGN KEY ("site_id","target_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_inspections" ADD CONSTRAINT "asset_booking_handover_inspections_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_notices" ADD CONSTRAINT "asset_booking_handover_notices_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_bookings"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_receipts" ADD CONSTRAINT "asset_booking_handover_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handover_receipts" ADD CONSTRAINT "asset_booking_handover_receipts_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_booking_handovers"("site_id","booking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handovers" ADD CONSTRAINT "asset_booking_handovers_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_bookings"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handovers" ADD CONSTRAINT "asset_booking_handovers_approval_fk" FOREIGN KEY ("booking_id","approved_version") REFERENCES "public"."asset_booking_events"("booking_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_handovers" ADD CONSTRAINT "asset_booking_handovers_custodian_fk" FOREIGN KEY ("site_id","custodian_id") REFERENCES "public"."asset_custodians"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_booking_handover_allocations_serial_key" ON "asset_booking_handover_allocations" USING btree ("booking_id","asset_id") WHERE "asset_booking_handover_allocations"."kind" = 'asset';--> statement-breakpoint
CREATE UNIQUE INDEX "asset_booking_handover_allocations_kit_key" ON "asset_booking_handover_allocations" USING btree ("booking_id","kit_id") WHERE "asset_booking_handover_allocations"."kind" = 'kit';--> statement-breakpoint
CREATE INDEX "asset_booking_handover_allocations_site_held_idx" ON "asset_booking_handover_allocations" USING btree ("site_id") WHERE "asset_booking_handover_allocations"."outstanding" > 0;--> statement-breakpoint
CREATE INDEX "asset_booking_handover_inspections_site_idx" ON "asset_booking_handover_inspections" USING btree ("site_id","target_id","location_id");--> statement-breakpoint
CREATE INDEX "asset_booking_handover_notices_site_idx" ON "asset_booking_handover_notices" USING btree ("site_id","at");--> statement-breakpoint
CREATE INDEX "asset_bookings_confirmed_due_idx" ON "asset_bookings" USING btree ("end_at","id") WHERE NOT "asset_bookings"."archived" AND "asset_bookings"."status" = 'confirmed';
--> statement-breakpoint
INSERT INTO "asset_booking_handover_notice_epoch" ("id", "active_at")
VALUES (true, clock_timestamp());
--> statement-breakpoint
CREATE FUNCTION protect_asset_booking_handover_head() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'booking handover history cannot be removed' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NOT EXISTS (
      SELECT 1 FROM asset_booking_events e JOIN asset_bookings b ON b.id = e.booking_id
      WHERE e.booking_id = NEW.booking_id AND e.site_id = NEW.site_id
        AND e.version = NEW.approved_version AND b.version = e.version
        AND b.status = 'confirmed' AND e.snapshot->>'status' = 'confirmed'
    ) THEN
      RAISE EXCEPTION 'booking handover requires an approved booking version' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.version <> OLD.version + 1
     OR (NEW.site_id, NEW.booking_id, NEW.approved_version)
        IS DISTINCT FROM (OLD.site_id, OLD.booking_id, OLD.approved_version)
     OR (OLD.pickup_closed AND NOT NEW.pickup_closed)
     OR (OLD.custodian_id IS NOT NULL AND
         (NEW.custodian_id, NEW.custodian_name) IS DISTINCT FROM (OLD.custodian_id, OLD.custodian_name))
  THEN
    RAISE EXCEPTION 'booking handover identity and approval are fixed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_handover_head_guard
BEFORE INSERT OR UPDATE OR DELETE ON asset_booking_handovers
FOR EACH ROW EXECUTE FUNCTION protect_asset_booking_handover_head();
--> statement-breakpoint
CREATE FUNCTION protect_asset_booking_handover_allocation() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'booking equipment history cannot be removed' USING ERRCODE = '23514';
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'outstanding' - 'snapshot') IS DISTINCT FROM
       (to_jsonb(OLD) - 'outstanding' - 'snapshot')
       OR (NEW.snapshot - 'members') IS DISTINCT FROM (OLD.snapshot - 'members')
       OR NEW.outstanding > OLD.outstanding THEN
      RAISE EXCEPTION 'booking equipment provenance is fixed' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.custody_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM asset_custody_history e JOIN asset_booking_handovers h ON h.booking_id = NEW.booking_id
    WHERE e.id = NEW.custody_event_id AND e.action = 'assign' AND e.holding_id = NEW.holding_id
      AND e.asset_id = NEW.asset_id AND e.site_id = NEW.site_id AND e.quantity = NEW.issued
      AND e.to_custodian_id = h.custodian_id
      AND e.source_location_id IS NOT DISTINCT FROM NEW.source_location_id
  ) THEN
    RAISE EXCEPTION 'booking equipment requires its original custody event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_handover_allocation_guard
BEFORE INSERT OR UPDATE OR DELETE ON asset_booking_handover_allocations
FOR EACH ROW EXECUTE FUNCTION protect_asset_booking_handover_allocation();
--> statement-breakpoint
CREATE FUNCTION verify_asset_booking_allocation_custody() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE
  allocation asset_booking_handover_allocations%ROWTYPE;
  active_quantity integer;
  kit_open boolean;
BEGIN
  IF TG_TABLE_NAME = 'asset_booking_handover_allocations' THEN
    SELECT * INTO allocation FROM asset_booking_handover_allocations WHERE id = NEW.id;
  ELSIF TG_TABLE_NAME = 'asset_custody_holdings' THEN
    SELECT * INTO allocation FROM asset_booking_handover_allocations WHERE holding_id = OLD.id;
  ELSE
    SELECT * INTO allocation FROM asset_booking_handover_allocations WHERE checkout_id = OLD.id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF allocation.holding_id IS NOT NULL THEN
    SELECT l.quantity INTO active_quantity
    FROM asset_custody_holdings l
    JOIN asset_booking_handovers h ON h.booking_id = allocation.booking_id
    WHERE l.id = allocation.holding_id AND l.site_id = allocation.site_id
      AND l.asset_id = allocation.asset_id AND l.custodian_id = h.custodian_id
      AND l.source_location_id IS NOT DISTINCT FROM allocation.source_location_id;
    IF COALESCE(active_quantity, 0) <> allocation.outstanding
       OR (allocation.outstanding = 0 AND EXISTS (
         SELECT 1 FROM asset_custody_holdings WHERE id = allocation.holding_id
       )) THEN
      RAISE EXCEPTION 'booking custody must settle through its handover' USING ERRCODE = '23514';
    END IF;
  ELSIF allocation.checkout_id IS NOT NULL THEN
    SELECT c.closed_at IS NULL INTO kit_open FROM asset_kit_checkouts c
    WHERE c.id = allocation.checkout_id;
    IF kit_open IS DISTINCT FROM (allocation.outstanding > 0) THEN
      RAISE EXCEPTION 'booking kit must settle through its handover' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asset_booking_handover_allocation_settlement_guard
AFTER INSERT OR UPDATE ON asset_booking_handover_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_asset_booking_allocation_custody();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asset_booking_handover_custody_settlement_guard
AFTER UPDATE OR DELETE ON asset_custody_holdings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_asset_booking_allocation_custody();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asset_booking_handover_kit_settlement_guard
AFTER UPDATE OR DELETE ON asset_kit_checkouts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_asset_booking_allocation_custody();
--> statement-breakpoint
CREATE FUNCTION protect_asset_booking_handover_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
       AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'booking handover receipts are fixed' USING ERRCODE = '23514';
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_handover_receipt_guard
BEFORE UPDATE OR DELETE ON asset_booking_handover_receipts
FOR EACH ROW EXECUTE FUNCTION protect_asset_booking_handover_receipt();
