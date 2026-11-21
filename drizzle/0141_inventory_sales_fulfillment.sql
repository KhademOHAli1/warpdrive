CREATE TABLE "inventory_sales_allocation_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"item_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_sales_allocation_line_position_key" UNIQUE("line_id","position_id"),
	CONSTRAINT "inventory_sales_allocation_qty_check" CHECK ("inventory_sales_allocations"."quantity" BETWEEN 1 AND 1000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"shipped" integer DEFAULT 0 NOT NULL,
	"part_code" text NOT NULL,
	"part_name" text NOT NULL,
	"part_revision" text NOT NULL,
	"stock_unit" text NOT NULL,
	"note" text,
	"unit_price" numeric(18, 4) NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "inventory_sales_line_identity_key" UNIQUE("id","order_id","item_id"),
	CONSTRAINT "inventory_sales_line_sequence_key" UNIQUE("order_id","ordinal"),
	CONSTRAINT "inventory_sales_line_quantity_check" CHECK ("inventory_sales_order_lines"."quantity" BETWEEN 1 AND 1000000 AND "inventory_sales_order_lines"."shipped" BETWEEN 0 AND "inventory_sales_order_lines"."quantity" AND "inventory_sales_order_lines"."ordinal" >= 0 AND "inventory_sales_order_lines"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"site_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"due_date" date,
	"deal_name" text NOT NULL,
	"customer_name" text,
	"recipient" text NOT NULL,
	"address" text NOT NULL,
	"currency" text NOT NULL,
	"charges" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	CONSTRAINT "inventory_sales_site_reference_key" UNIQUE("site_id","reference"),
	CONSTRAINT "inventory_sales_order_status_check" CHECK ("inventory_sales_orders"."status" IN ('draft','issued','shipped','cancelled') AND "inventory_sales_orders"."version">0 AND
    ("inventory_sales_orders"."issued_at" IS NULL) = ("inventory_sales_orders"."issued_by" IS NULL) AND
    ("inventory_sales_orders"."status" NOT IN ('issued','shipped') OR "inventory_sales_orders"."issued_at" IS NOT NULL) AND
    ("inventory_sales_orders"."status" <> 'draft' OR "inventory_sales_orders"."issued_at" IS NULL) AND
    (CASE WHEN "inventory_sales_orders"."status"='cancelled' THEN "inventory_sales_orders"."cancelled_by" IS NOT NULL AND "inventory_sales_orders"."cancelled_at" IS NOT NULL AND "inventory_sales_orders"."cancellation_reason" IS NOT NULL
          ELSE "inventory_sales_orders"."cancelled_by" IS NULL AND "inventory_sales_orders"."cancelled_at" IS NULL AND "inventory_sales_orders"."cancellation_reason" IS NULL END)),
	CONSTRAINT "inventory_sales_delivery_check" CHECK (length("inventory_sales_orders"."reference") BETWEEN 1 AND 80 AND length("inventory_sales_orders"."recipient") BETWEEN 1 AND 180 AND length("inventory_sales_orders"."address") BETWEEN 1 AND 1000 AND "inventory_sales_orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_packing_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"shipment_line_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"checked" boolean NOT NULL,
	"scan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_sales_packing_scan_check" CHECK ("inventory_sales_packing_checks"."scan" IS NULL OR ("inventory_sales_packing_checks"."checked" AND length("inventory_sales_packing_checks"."scan") BETWEEN 1 AND 120))
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"allocation_id" uuid,
	"quantity" integer NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"lot" text,
	"serial" text,
	"location_id" uuid NOT NULL,
	"build_output_id" uuid,
	"event_id" uuid,
	CONSTRAINT "inventory_sales_packing_line_identity_key" UNIQUE("id","shipment_id","order_id"),
	CONSTRAINT "inventory_sales_packing_event_key" UNIQUE("event_id"),
	CONSTRAINT "inventory_sales_packing_allocation_key" UNIQUE("shipment_id","allocation_id"),
	CONSTRAINT "inventory_sales_packing_qty_check" CHECK ("inventory_sales_shipment_lines"."quantity" BETWEEN 1 AND 1000000 AND ("inventory_sales_shipment_lines"."serial" IS NULL OR "inventory_sales_shipment_lines"."quantity"=1) AND ("inventory_sales_shipment_lines"."event_id" IS NULL OR "inventory_sales_shipment_lines"."checked"))
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"carrier" text,
	"tracking" text,
	"shipped_on" date,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "inventory_sales_shipment_order_key" UNIQUE("id","order_id"),
	CONSTRAINT "inventory_sales_shipment_reference_key" UNIQUE("order_id","reference"),
	CONSTRAINT "inventory_sales_shipment_status_check" CHECK ("inventory_sales_shipments"."status" IN ('draft','shipped','cancelled') AND
    (CASE WHEN "inventory_sales_shipments"."status"='shipped' THEN "inventory_sales_shipments"."posted_at" IS NOT NULL AND "inventory_sales_shipments"."posted_by" IS NOT NULL AND "inventory_sales_shipments"."shipped_on" IS NOT NULL AND "inventory_sales_shipments"."carrier" IS NOT NULL
      ELSE "inventory_sales_shipments"."posted_at" IS NULL AND "inventory_sales_shipments"."posted_by" IS NULL AND "inventory_sales_shipments"."shipped_on" IS NULL AND "inventory_sales_shipments"."carrier" IS NULL AND "inventory_sales_shipments"."tracking" IS NULL END))
);
--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_sales_allocation_events" ADD CONSTRAINT "inventory_sales_allocation_events_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_allocation_events" ADD CONSTRAINT "inventory_sales_alloc_event_line_fk" FOREIGN KEY ("line_id","order_id","item_id") REFERENCES "public"."inventory_sales_order_lines"("id","order_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_allocation_events" ADD CONSTRAINT "inventory_sales_alloc_event_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_allocations" ADD CONSTRAINT "inventory_sales_allocation_line_fk" FOREIGN KEY ("line_id","order_id","item_id") REFERENCES "public"."inventory_sales_order_lines"("id","order_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_allocations" ADD CONSTRAINT "inventory_sales_allocation_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_order_lines" ADD CONSTRAINT "inventory_sales_order_lines_order_id_inventory_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_order_lines" ADD CONSTRAINT "inventory_sales_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_orders" ADD CONSTRAINT "inventory_sales_orders_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_orders" ADD CONSTRAINT "inventory_sales_orders_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_orders" ADD CONSTRAINT "inventory_sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_orders" ADD CONSTRAINT "inventory_sales_orders_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_orders" ADD CONSTRAINT "inventory_sales_orders_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_packing_checks" ADD CONSTRAINT "inventory_sales_packing_checks_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_packing_checks" ADD CONSTRAINT "inventory_sales_packing_check_line_fk" FOREIGN KEY ("shipment_line_id","shipment_id","order_id") REFERENCES "public"."inventory_sales_shipment_lines"("id","shipment_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipment_lines" ADD CONSTRAINT "inventory_sales_shipment_lines_location_id_directory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."directory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipment_lines" ADD CONSTRAINT "inventory_sales_shipment_lines_build_output_id_inventory_production_outputs_id_fk" FOREIGN KEY ("build_output_id") REFERENCES "public"."inventory_production_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipment_lines" ADD CONSTRAINT "inventory_sales_shipment_lines_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipment_lines" ADD CONSTRAINT "inventory_sales_packing_order_fk" FOREIGN KEY ("shipment_id","order_id") REFERENCES "public"."inventory_sales_shipments"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipment_lines" ADD CONSTRAINT "inventory_sales_packing_line_fk" FOREIGN KEY ("line_id","order_id","item_id") REFERENCES "public"."inventory_sales_order_lines"("id","order_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipment_lines" ADD CONSTRAINT "inventory_sales_packing_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipments" ADD CONSTRAINT "inventory_sales_shipments_order_id_inventory_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipments" ADD CONSTRAINT "inventory_sales_shipments_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_sales_shipments" ADD CONSTRAINT "inventory_sales_shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_sales_allocation_events_order_idx" ON "inventory_sales_allocation_events" USING btree ("order_id","line_id");--> statement-breakpoint
CREATE INDEX "inventory_sales_allocation_order_idx" ON "inventory_sales_allocations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_sales_allocation_position_idx" ON "inventory_sales_allocations" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "inventory_sales_line_item_idx" ON "inventory_sales_order_lines" USING btree ("item_id","order_id");--> statement-breakpoint
CREATE INDEX "inventory_sales_deal_idx" ON "inventory_sales_orders" USING btree ("deal_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_sales_site_due_idx" ON "inventory_sales_orders" USING btree ("site_id","due_date","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_sales_packing_checks_line_idx" ON "inventory_sales_packing_checks" USING btree ("shipment_line_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_sales_packing_serial_idx" ON "inventory_sales_shipment_lines" USING btree ("item_id","serial");--> statement-breakpoint
CREATE INDEX "inventory_sales_packing_line_idx" ON "inventory_sales_shipment_lines" USING btree ("line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_sales_one_open_shipment" ON "inventory_sales_shipments" USING btree ("order_id") WHERE "inventory_sales_shipments"."status"='draft';--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal', 'production-dispatch', 'production-return', 'production-accept', 'quality-release',
        'sales-reserve', 'sales-release', 'sales-shipment'));
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location" AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal',
  'production-dispatch', 'production-return', 'production-accept', 'quality-release',
  'sales-reserve', 'sales-release', 'sales-shipment'
)) EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_sales_order"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.deal_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Sales orders begin as drafts linked to CRM';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Sales order history is retained';
  END IF;
  IF (OLD.id,OLD.created_by,OLD.created_at) IS DISTINCT FROM (NEW.id,NEW.created_by,NEW.created_at)
    OR (NEW.deal_id IS NOT NULL AND NEW.deal_id IS DISTINCT FROM OLD.deal_id)
    OR (OLD.status='draft' AND NEW.status NOT IN ('draft','issued','cancelled'))
    OR (OLD.status='issued' AND NEW.status NOT IN ('issued','shipped','cancelled'))
    OR (OLD.status IN ('shipped','cancelled') AND
      (to_jsonb(NEW)-ARRAY['deal_id','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deal_id','version']))
    OR (OLD.status <> 'draft' AND
      (NEW.site_id,NEW.reference,NEW.deal_name,NEW.customer_name,NEW.recipient,NEW.address,NEW.currency,NEW.charges,NEW.issued_at,NEW.issued_by)
      IS DISTINCT FROM (OLD.site_id,OLD.reference,OLD.deal_name,OLD.customer_name,OLD.recipient,OLD.address,OLD.currency,OLD.charges,OLD.issued_at,OLD.issued_by)) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Issued sales order identity and terms are retained';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_order_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_sales_orders"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_sales_order"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_sales_line"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM public.inventory_sales_orders WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF TG_OP='DELETE' THEN
    IF parent_status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Issued sales lines are retained'; END IF;
    RETURN OLD;
  END IF;
  IF (TG_OP='INSERT' AND (parent_status <> 'draft' OR NEW.shipped <> 0))
    OR (TG_OP='UPDATE' AND (parent_status <> 'issued' OR NEW.shipped < OLD.shipped OR
      (to_jsonb(NEW)-'shipped') IS DISTINCT FROM (to_jsonb(OLD)-'shipped'))) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Issued sales lines only change through shipping';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_line_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_sales_order_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_sales_line"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_sales_shipment"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'draft' OR NOT EXISTS (SELECT 1 FROM public.inventory_sales_orders o WHERE o.id=NEW.order_id AND o.status='issued') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Shipment drafts require an issued sales order';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR OLD.status <> 'draft' OR (NEW.id,NEW.order_id,NEW.reference,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.reference,OLD.created_at,OLD.created_by) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Sales shipment history is retained';
  END IF;
  IF NEW.status='shipped' AND (NOT EXISTS (SELECT 1 FROM public.inventory_sales_shipment_lines WHERE shipment_id=NEW.id) OR
       EXISTS (SELECT 1 FROM public.inventory_sales_shipment_lines WHERE shipment_id=NEW.id AND (NOT checked OR event_id IS NULL))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Shipping requires a complete checked packing list and stock events';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_shipment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_sales_shipments"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_sales_shipment"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_sales_packing_line"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='DELETE' OR NOT EXISTS (SELECT 1 FROM public.inventory_sales_shipments WHERE id=NEW.shipment_id AND status='draft') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Packing lines are retained after the shipment is settled';
  END IF;
  IF TG_OP='INSERT' AND (NEW.checked OR NEW.event_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM public.inventory_sales_allocations a JOIN public.inventory_stock_positions p ON p.id=a.position_id
    WHERE a.id=NEW.allocation_id AND a.line_id=NEW.line_id AND a.position_id=NEW.position_id AND a.quantity>=NEW.quantity
      AND (p.lot,p.serial,p.location_id,p.build_output_id) IS NOT DISTINCT FROM (NEW.lot,NEW.serial,NEW.location_id,NEW.build_output_id)
  )) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Packing lines must match an active reservation and stock identity';
  END IF;
  IF TG_OP='UPDATE' AND (OLD.event_id IS NOT NULL OR
       (to_jsonb(NEW)-ARRAY['checked','event_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['checked','event_id'])) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='The packed stock identity is immutable';
  END IF;
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_events e JOIN public.inventory_sales_allocation_events a ON a.event_id=e.id
    WHERE e.id=NEW.event_id AND e.kind='sales-shipment' AND e.position_id=NEW.position_id
      AND e.on_hand_delta=-NEW.quantity AND e.reserved_delta=-NEW.quantity AND a.order_id=NEW.order_id
      AND a.line_id=NEW.line_id AND a.allocation_id=NEW.allocation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Packing line must link to its exact stock issue';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_packing_line_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_sales_shipment_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_sales_packing_line"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_sales_allocation"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'quantity') IS DISTINCT FROM (to_jsonb(OLD)-'quantity') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Sales allocation identity is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_sales_orders o JOIN public.inventory_stock_positions p ON p.site_id=o.site_id
    WHERE o.id=NEW.order_id AND o.status='issued' AND p.id=NEW.position_id AND p.owner_organization_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Allocation requires the issued order and its fulfillment site';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_allocation_guard" BEFORE INSERT OR UPDATE ON "public"."inventory_sales_allocations"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_sales_allocation"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_verify_sales_line_totals"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE target_line uuid;
BEGIN
  IF TG_TABLE_NAME='inventory_sales_order_lines' THEN
    target_line := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_line := CASE WHEN TG_OP='DELETE' THEN OLD.line_id ELSE NEW.line_id END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_sales_order_lines l
    JOIN public.inventory_sales_orders o ON o.id=l.order_id
    WHERE l.id=target_line AND (
      l.shipped+COALESCE((SELECT sum(a.quantity) FROM public.inventory_sales_allocations a WHERE a.line_id=l.id),0)>l.quantity
      OR (o.status='shipped' AND l.shipped<>l.quantity)
      OR (o.status IN ('shipped','cancelled') AND EXISTS (SELECT 1 FROM public.inventory_sales_allocations a WHERE a.line_id=l.id))
      OR l.shipped<>COALESCE((SELECT sum(p.quantity) FROM public.inventory_sales_shipment_lines p
        JOIN public.inventory_sales_shipments s ON s.id=p.shipment_id WHERE p.line_id=l.id AND s.status='shipped'),0)
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Sales line stock reservations and shipped quantities must reconcile';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "inventory_sales_allocation_totals" AFTER INSERT OR UPDATE OR DELETE ON "public"."inventory_sales_allocations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."inventory_verify_sales_line_totals"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "inventory_sales_line_totals" AFTER INSERT OR UPDATE ON "public"."inventory_sales_order_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."inventory_verify_sales_line_totals"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_sales_event_origin"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_events e
    JOIN public.inventory_sales_orders o ON o.id=NEW.order_id
    JOIN public.inventory_stock_positions p ON p.id=e.position_id AND p.site_id=o.site_id
    JOIN public.inventory_movements m ON m.id=e.movement_id
    WHERE e.id=NEW.event_id AND e.position_id=NEW.position_id AND e.item_id=NEW.item_id AND e.order_id IS NULL
      AND e.on_hand_delta=m.on_hand_delta AND e.reserved_delta=m.reserved_delta
      AND ((e.kind='sales-reserve' AND e.on_hand_delta=0 AND e.reserved_delta>0 AND m.kind='order-reserve')
        OR (e.kind='sales-release' AND e.on_hand_delta=0 AND e.reserved_delta<0 AND m.kind='cancel-release')
        OR (e.kind='sales-shipment' AND e.on_hand_delta=e.reserved_delta AND e.on_hand_delta<0 AND m.kind='shipment'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Sales stock event must match the position and movement ledger';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_stock_event_origin_guard" BEFORE INSERT ON "public"."inventory_sales_allocation_events"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_sales_event_origin"();
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_stock_event_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind IN ('sales-reserve','sales-release','sales-shipment')) EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_allocation_event_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_sales_allocation_events"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_sales_packing_check_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_sales_packing_checks"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
