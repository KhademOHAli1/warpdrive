CREATE TABLE "inventory_return_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"note" text,
	"charges" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_at" timestamp with time zone,
	CONSTRAINT "inventory_return_reference_key" UNIQUE("site_id","reference"),
	CONSTRAINT "inventory_return_case_source_key" UNIQUE("id","shipment_id","order_id"),
	CONSTRAINT "inventory_return_case_status_check" CHECK ("inventory_return_cases"."status" IN ('draft','issued','onHold','completed','cancelled') AND "inventory_return_cases"."version">0 AND
    (CASE "inventory_return_cases"."status" WHEN 'draft' THEN "inventory_return_cases"."issued_at" IS NULL WHEN 'cancelled' THEN true ELSE "inventory_return_cases"."issued_at" IS NOT NULL END)),
	CONSTRAINT "inventory_return_case_reference_check" CHECK (length("inventory_return_cases"."reference") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "inventory_return_commercial" (
	"receipt_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(18, 4),
	"reference" text,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_return_commercial_check" CHECK ("inventory_return_commercial"."kind" IN ('refund','replacement','none') AND length("inventory_return_commercial"."reason") BETWEEN 1 AND 400 AND
   (CASE WHEN "inventory_return_commercial"."kind"='refund' THEN "inventory_return_commercial"."amount" IS NOT NULL AND "inventory_return_commercial"."amount">0 ELSE "inventory_return_commercial"."amount" IS NULL END))
);
--> statement-breakpoint
CREATE TABLE "inventory_return_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"event_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_return_disposition_kind_key" UNIQUE("receipt_id","kind"),
	CONSTRAINT "inventory_return_disposition_event_key" UNIQUE("event_id"),
	CONSTRAINT "inventory_return_disposition_check" CHECK ("inventory_return_dispositions"."kind" IN ('restock','repair','scrap') AND ("inventory_return_dispositions"."kind"='repair')=("inventory_return_dispositions"."event_id" IS NULL) AND length("inventory_return_dispositions"."reason") BETWEEN 1 AND 400)
);
--> statement-breakpoint
CREATE TABLE "inventory_return_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"shipment_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "inventory_return_line_source_key" UNIQUE("case_id","shipment_line_id"),
	CONSTRAINT "inventory_return_line_receipt_key" UNIQUE("id","case_id","shipment_line_id","item_id"),
	CONSTRAINT "inventory_return_line_values_check" CHECK ("inventory_return_lines"."quantity" BETWEEN 1 AND 1000000 AND length("inventory_return_lines"."reason") BETWEEN 1 AND 400)
);
--> statement-breakpoint
CREATE TABLE "inventory_return_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"shipment_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"condition" text NOT NULL,
	"note" text,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"physical" text DEFAULT 'quarantine' NOT NULL,
	CONSTRAINT "inventory_return_receipt_event_key" UNIQUE("event_id"),
	CONSTRAINT "inventory_return_receipt_values_check" CHECK ("inventory_return_receipts"."quantity" BETWEEN 1 AND 1000000 AND "inventory_return_receipts"."condition" IN ('unopened','used','damaged','unknown') AND "inventory_return_receipts"."physical" IN ('quarantine','repair','restocked','scrapped'))
);
--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_return_cases" ADD CONSTRAINT "inventory_return_cases_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_cases" ADD CONSTRAINT "inventory_return_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_cases" ADD CONSTRAINT "inventory_return_case_source_fk" FOREIGN KEY ("shipment_id","order_id") REFERENCES "public"."inventory_sales_shipments"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_commercial" ADD CONSTRAINT "inventory_return_commercial_receipt_id_inventory_return_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_return_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_commercial" ADD CONSTRAINT "inventory_return_commercial_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_dispositions" ADD CONSTRAINT "inventory_return_dispositions_receipt_id_inventory_return_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_return_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_dispositions" ADD CONSTRAINT "inventory_return_dispositions_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_dispositions" ADD CONSTRAINT "inventory_return_dispositions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_history" ADD CONSTRAINT "inventory_return_history_case_id_inventory_return_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."inventory_return_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_history" ADD CONSTRAINT "inventory_return_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_lines" ADD CONSTRAINT "inventory_return_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_lines" ADD CONSTRAINT "inventory_return_line_case_fk" FOREIGN KEY ("case_id","shipment_id","order_id") REFERENCES "public"."inventory_return_cases"("id","shipment_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_lines" ADD CONSTRAINT "inventory_return_line_shipment_fk" FOREIGN KEY ("shipment_line_id","shipment_id","order_id") REFERENCES "public"."inventory_sales_shipment_lines"("id","shipment_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_receipts" ADD CONSTRAINT "inventory_return_receipts_location_id_directory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."directory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_receipts" ADD CONSTRAINT "inventory_return_receipts_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_receipts" ADD CONSTRAINT "inventory_return_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_receipts" ADD CONSTRAINT "inventory_return_receipt_line_fk" FOREIGN KEY ("line_id","case_id","shipment_line_id","item_id") REFERENCES "public"."inventory_return_lines"("id","case_id","shipment_line_id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_return_receipts" ADD CONSTRAINT "inventory_return_receipt_stock_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_return_case_ship_idx" ON "inventory_return_cases" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "inventory_return_case_site_idx" ON "inventory_return_cases" USING btree ("site_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_return_history_case_idx" ON "inventory_return_history" USING btree ("case_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_return_line_ship_idx" ON "inventory_return_lines" USING btree ("shipment_line_id","case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_return_open_position_key" ON "inventory_return_receipts" USING btree ("position_id") WHERE "inventory_return_receipts"."physical" IN ('quarantine','repair');--> statement-breakpoint
CREATE INDEX "inventory_return_receipt_position_idx" ON "inventory_return_receipts" USING btree ("position_id","physical");--> statement-breakpoint
CREATE INDEX "inventory_return_receipt_line_idx" ON "inventory_return_receipts" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "inventory_return_receipt_ship_idx" ON "inventory_return_receipts" USING btree ("shipment_line_id");--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal', 'production-dispatch', 'production-return', 'production-accept', 'quality-release',
        'sales-reserve', 'sales-release', 'sales-shipment', 'customer-return', 'return-restock', 'return-scrap'));
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location" AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal',
  'production-dispatch', 'production-return', 'production-accept', 'quality-release',
  'sales-reserve', 'sales-release', 'sales-shipment', 'customer-return', 'return-restock', 'return-scrap'
)) EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_return_case"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' OR NOT EXISTS (SELECT 1 FROM public.inventory_sales_shipments s WHERE s.id=NEW.shipment_id AND s.status='shipped') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A return must start as a draft for a posted shipment';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Return cases are retained';
  END IF;
  IF (NEW.id,NEW.shipment_id,NEW.order_id,NEW.created_at,NEW.created_by)
     IS DISTINCT FROM (OLD.id,OLD.shipment_id,OLD.order_id,OLD.created_at,OLD.created_by)
     OR (OLD.status<>'draft' AND (NEW.site_id,NEW.reference,NEW.note,NEW.charges,NEW.issued_at)
         IS DISTINCT FROM (OLD.site_id,OLD.reference,OLD.note,OLD.charges,OLD.issued_at))
     OR (OLD.status='draft' AND NEW.status NOT IN ('draft','issued','cancelled'))
     OR (OLD.status IN ('issued','onHold') AND NEW.status NOT IN ('issued','onHold','completed','cancelled'))
     OR (OLD.status IN ('cancelled','completed') AND NEW.status<>OLD.status) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='An issued return retains its identity and terms';
  END IF;
  IF OLD.status='draft' AND NEW.status='issued' THEN
    PERFORM 1 FROM public.inventory_sales_shipments WHERE id=NEW.shipment_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_return_lines WHERE case_id=NEW.id) OR EXISTS (
      SELECT 1 FROM public.inventory_return_lines wanted
      JOIN public.inventory_sales_shipment_lines packed ON packed.id=wanted.shipment_line_id
      WHERE wanted.case_id=NEW.id AND wanted.quantity+COALESCE((
        SELECT sum(CASE WHEN c.status IN ('issued','onHold') THEN l.quantity ELSE COALESCE((
          SELECT sum(r.quantity) FROM public.inventory_return_receipts r WHERE r.line_id=l.id),0) END)
        FROM public.inventory_return_lines l JOIN public.inventory_return_cases c ON c.id=l.case_id
        WHERE l.shipment_line_id=packed.id AND c.id<>NEW.id
      ),0)>packed.quantity
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Issuing a return requires unclaimed shipped quantity';
    END IF;
  END IF;
  IF NEW.status IN ('cancelled','completed') AND NEW.status<>OLD.status THEN
    IF EXISTS (SELECT 1 FROM public.inventory_return_receipts r WHERE r.case_id=NEW.id AND r.physical IN ('quarantine','repair')) OR
       (NEW.status='completed' AND EXISTS (
        SELECT 1 FROM public.inventory_return_lines l WHERE l.case_id=NEW.id AND l.quantity<>COALESCE((
          SELECT sum(r.quantity) FROM public.inventory_return_receipts r WHERE r.line_id=l.id),0)
       )) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Closing a return requires settled receipts';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_return_case_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_return_cases"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_return_case"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_return_line"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.inventory_return_cases c WHERE c.id=OLD.case_id AND c.status='draft') THEN RETURN OLD; END IF;
  ELSIF TG_OP='INSERT' AND EXISTS (
    SELECT 1 FROM public.inventory_return_cases c JOIN public.inventory_sales_shipment_lines l ON l.shipment_id=c.shipment_id
    WHERE c.id=NEW.case_id AND c.status='draft' AND l.id=NEW.shipment_line_id AND l.item_id=NEW.item_id
      AND l.checked AND l.event_id IS NOT NULL AND l.quantity>=NEW.quantity
  ) THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Only a draft return can change its original shipped lines';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_return_line_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_return_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_return_line"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_return_receipt"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE shipment_key uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Return receipts are retained';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.physical IN ('restocked','scrapped') OR NEW.physical='quarantine'
       OR (to_jsonb(NEW)-'physical') IS DISTINCT FROM (to_jsonb(OLD)-'physical')
       OR NOT EXISTS (SELECT 1 FROM public.inventory_return_dispositions d WHERE d.receipt_id=NEW.id AND
         d.kind=CASE NEW.physical WHEN 'restocked' THEN 'restock' WHEN 'scrapped' THEN 'scrap' ELSE 'repair' END) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='A return receipt only changes through its disposition';
    END IF;
    RETURN NEW;
  END IF;
  SELECT shipment_id INTO shipment_key FROM public.inventory_return_cases WHERE id=NEW.case_id;
  PERFORM 1 FROM public.inventory_sales_shipments WHERE id=shipment_key AND status='shipped' FOR UPDATE;
  IF NEW.physical<>'quarantine' OR NOT EXISTS (
    SELECT 1 FROM public.inventory_return_lines l
    JOIN public.inventory_return_cases c ON c.id=l.case_id
    JOIN public.inventory_sales_shipment_lines packed ON packed.id=l.shipment_line_id
    JOIN public.inventory_stock_events e ON e.id=NEW.event_id
    JOIN public.inventory_stock_event_details details ON details.event_id=e.id
    JOIN public.inventory_stock_positions p ON p.id=e.position_id
    WHERE l.id=NEW.line_id AND l.case_id=NEW.case_id AND c.status='issued' AND packed.checked AND packed.event_id IS NOT NULL
      AND packed.id=NEW.shipment_line_id AND packed.item_id=NEW.item_id AND p.id=NEW.position_id AND p.item_id=NEW.item_id
      AND p.site_id=c.site_id AND p.location_id=NEW.location_id AND p.state='quarantine' AND p.owner_organization_id IS NULL
      AND p.on_hand=NEW.quantity AND p.reserved=0 AND (p.lot,p.serial,p.build_output_id) IS NOT DISTINCT FROM (packed.lot,packed.serial,packed.build_output_id)
      AND (packed.serial IS NULL OR (p.id=packed.position_id AND NEW.quantity=1))
      AND e.kind='customer-return' AND e.actor_id=NEW.actor_id AND e.on_hand_delta=NEW.quantity AND e.reserved_delta=0
      AND e.state='quarantine' AND details.site_id=c.site_id AND details.location_id=NEW.location_id
      AND l.quantity>=NEW.quantity+COALESCE((SELECT sum(r.quantity) FROM public.inventory_return_receipts r WHERE r.line_id=l.id),0)
      AND packed.quantity>=NEW.quantity+COALESCE((SELECT sum(r.quantity) FROM public.inventory_return_receipts r WHERE r.shipment_line_id=packed.id),0)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Return receipt must match a shipped unit and its quarantined stock credit';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_return_receipt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_return_receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_return_receipt"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_return_disposition"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_return_receipts r JOIN public.inventory_return_cases c ON c.id=r.case_id
    LEFT JOIN public.inventory_stock_events e ON e.id=NEW.event_id
    WHERE r.id=NEW.receipt_id AND c.status IN ('issued','onHold') AND r.physical IN ('quarantine','repair')
      AND ((NEW.kind='repair' AND NEW.event_id IS NULL AND r.physical='quarantine') OR (
        e.item_id=r.item_id AND e.position_id=r.position_id AND e.actor_id=NEW.actor_id AND e.reserved_delta=0
        AND ((NEW.kind='restock' AND e.kind='return-restock' AND e.on_hand_delta=0 AND e.state='available')
          OR (NEW.kind='scrap' AND e.kind='return-scrap' AND e.on_hand_delta=-r.quantity))
      ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Return disposition must match a quarantined receipt and its stock event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_return_disposition_guard" BEFORE INSERT ON "public"."inventory_return_dispositions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_return_disposition"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_protect_return_quarantine"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory_return_receipts r WHERE r.position_id=OLD.id AND r.physical IN ('quarantine','repair')) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Quarantined return stock requires the return disposition workflow';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_return_quarantine_guard" BEFORE UPDATE OR DELETE ON "public"."inventory_stock_positions"
FOR EACH ROW WHEN (OLD.state='quarantine') EXECUTE FUNCTION "public"."inventory_protect_return_quarantine"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_return_commercial"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_return_receipts r
    JOIN public.inventory_sales_shipment_lines packed ON packed.id=r.shipment_line_id
    JOIN public.inventory_sales_order_lines l ON l.id=packed.line_id
    JOIN public.inventory_sales_orders o ON o.id=l.order_id
    WHERE r.id=NEW.receipt_id AND NEW.currency=o.currency AND (NEW.kind<>'refund' OR NEW.amount<=l.unit_price*r.quantity)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Commercial return must match its original sale and quantity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_return_commercial_guard" BEFORE INSERT ON "public"."inventory_return_commercial"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_return_commercial"();
--> statement-breakpoint
CREATE TRIGGER "inventory_return_disposition_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_return_dispositions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_return_commercial_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_return_commercial"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_return_history_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_return_history"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_return_stock_append_only" BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind IN ('customer-return','return-restock','return-scrap')) EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
