CREATE TABLE "inventory_subcontract_consumptions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"output_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_subcontract_consumption_qty_check" CHECK ("inventory_subcontract_consumptions"."quantity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_subcontract_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_position_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"vendor_position_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"dispatch_event_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	"returned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_subcontract_dispatch_event_key" UNIQUE("dispatch_event_id"),
	CONSTRAINT "inventory_subcontract_dispatch_source_event_key" UNIQUE("source_event_id"),
	CONSTRAINT "inventory_subcontract_dispatch_balance" CHECK ("inventory_subcontract_dispatches"."quantity" BETWEEN 1 AND 1000000000 AND "inventory_subcontract_dispatches"."returned" >= 0 AND "inventory_subcontract_dispatches"."consumed" >= 0 AND "inventory_subcontract_dispatches"."returned" + "inventory_subcontract_dispatches"."consumed" <= "inventory_subcontract_dispatches"."quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_subcontract_materials" (
	"build_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	CONSTRAINT "inventory_subcontract_material_pk" PRIMARY KEY("build_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_subcontract_receipts" (
	"output_id" uuid PRIMARY KEY NOT NULL,
	"build_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	CONSTRAINT "inventory_subcontract_receipt_purchase_key" UNIQUE("receipt_line_id"),
	CONSTRAINT "inventory_subcontract_receipt_position_key" UNIQUE("position_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_subcontract_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"source_event_id" uuid NOT NULL,
	"return_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_subcontract_return_event_key" UNIQUE("return_event_id"),
	CONSTRAINT "inventory_subcontract_return_source_key" UNIQUE("source_event_id"),
	CONSTRAINT "inventory_subcontract_return_qty_check" CHECK ("inventory_subcontract_returns"."quantity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_subcontracts" (
	"build_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"supplier_bin_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_subcontract_line_key" UNIQUE("line_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_subcontract_consumptions" ADD CONSTRAINT "inventory_subcontract_consumptions_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_consumptions" ADD CONSTRAINT "inventory_subcontract_consumptions_output_id_inventory_subcontract_receipts_output_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."inventory_subcontract_receipts"("output_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_consumptions" ADD CONSTRAINT "inventory_subcontract_consumptions_dispatch_id_inventory_subcontract_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."inventory_subcontract_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatches_source_location_id_directory_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."directory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatches_source_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatches_dispatch_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("dispatch_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatch_material_fk" FOREIGN KEY ("build_id","material_id") REFERENCES "public"."inventory_subcontract_materials"("build_id","material_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatch_part_fk" FOREIGN KEY ("material_id","item_id") REFERENCES "public"."inventory_production_materials"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatch_origin_fk" FOREIGN KEY ("source_position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_dispatches" ADD CONSTRAINT "inventory_subcontract_dispatch_vendor_fk" FOREIGN KEY ("vendor_position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_materials" ADD CONSTRAINT "inventory_subcontract_materials_build_id_inventory_subcontracts_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."inventory_subcontracts"("build_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_materials" ADD CONSTRAINT "inventory_subcontract_materials_material_id_inventory_production_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."inventory_production_materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_receipts" ADD CONSTRAINT "inventory_subcontract_receipts_output_id_inventory_production_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."inventory_production_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_receipts" ADD CONSTRAINT "inventory_subcontract_receipts_build_id_inventory_subcontracts_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."inventory_subcontracts"("build_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_receipts" ADD CONSTRAINT "inventory_subcontract_receipts_receipt_line_id_inventory_purchase_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."inventory_purchase_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_receipts" ADD CONSTRAINT "inventory_subcontract_receipts_position_id_inventory_stock_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."inventory_stock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_returns" ADD CONSTRAINT "inventory_subcontract_returns_dispatch_id_inventory_subcontract_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."inventory_subcontract_dispatches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_returns" ADD CONSTRAINT "inventory_subcontract_returns_source_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontract_returns" ADD CONSTRAINT "inventory_subcontract_returns_return_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("return_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontracts" ADD CONSTRAINT "inventory_subcontracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontracts" ADD CONSTRAINT "inventory_subcontract_build_fk" FOREIGN KEY ("build_id","site_id") REFERENCES "public"."inventory_production_builds"("id","site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontracts" ADD CONSTRAINT "inventory_subcontract_line_fk" FOREIGN KEY ("line_id","order_id") REFERENCES "public"."inventory_purchase_order_lines"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_subcontracts" ADD CONSTRAINT "inventory_subcontract_supplier_bin_fk" FOREIGN KEY ("site_id","supplier_bin_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_subcontract_consumption_output_idx" ON "inventory_subcontract_consumptions" USING btree ("output_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_consumption_dispatch_idx" ON "inventory_subcontract_consumptions" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_dispatch_vendor_idx" ON "inventory_subcontract_dispatches" USING btree ("vendor_position_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_dispatch_material_idx" ON "inventory_subcontract_dispatches" USING btree ("build_id","material_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_receipt_build_idx" ON "inventory_subcontract_receipts" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_return_dispatch_idx" ON "inventory_subcontract_returns" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_order_idx" ON "inventory_subcontracts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_subcontract_site_vendor_idx" ON "inventory_subcontracts" USING btree ("site_id","supplier_bin_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release',
        'transfer-dispatch', 'transfer-receive', 'correction', 'correction-reversal',
        'component-install', 'component-remove', 'stock-disassemble', 'production-reserve', 'production-release',
        'production-consume', 'production-output', 'production-reversal',
        'production-dispatch', 'production-return'));--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal', 'production-dispatch', 'production-return', 'production-accept'));
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location"
AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal',
  'production-dispatch', 'production-return', 'production-accept'
))
EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_events_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind IN ('production-dispatch', 'production-return', 'production-accept'))
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_movements_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_movements"
FOR EACH ROW WHEN (OLD.kind IN ('production-dispatch', 'production-return'))
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_subcontract_setup"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_production_builds build
      JOIN public.inventory_purchase_orders po ON po.id=NEW.order_id AND po.site_id=build.site_id
      JOIN public.inventory_purchase_order_lines line ON line.id=NEW.line_id AND line.order_id=po.id
      JOIN public.inventory_stock_location_policies vendor ON vendor.location_id=NEW.supplier_bin_id AND vendor.site_id=build.site_id
    WHERE build.id=NEW.build_id AND build.status='planned' AND po.status='draft' AND vendor.kind='external'
      AND line.item_id=build.item_id AND line.ordered_units=build.quantity
      AND line.stock_unit=build.stock_unit AND line.trackable=build.trackable
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract needs a matching draft line and an external location';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_setup_guard"
BEFORE INSERT ON "public"."inventory_subcontracts"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_subcontract_setup"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_subcontract_material"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_production_materials material
      JOIN public.inventory_production_builds build ON build.id=material.build_id
    WHERE material.id=NEW.material_id AND build.id=NEW.build_id AND build.status='planned' AND NOT material.consumable
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract material must belong to the planned build';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_material_guard"
BEFORE INSERT ON "public"."inventory_subcontract_materials"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_subcontract_material"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_subcontract_receipt"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_subcontracts link
      JOIN public.inventory_production_outputs output ON output.id=NEW.output_id AND output.build_id=link.build_id
      JOIN public.inventory_purchase_receipt_lines receipt ON receipt.id=NEW.receipt_line_id AND receipt.order_id=link.order_id AND receipt.line_id=link.line_id
      JOIN public.inventory_stock_positions stock ON stock.id=receipt.position_id AND stock.build_output_id=output.id
      JOIN public.inventory_stock_events event ON event.id=receipt.event_id AND event.position_id=stock.id
    WHERE link.build_id=NEW.build_id AND link.order_id=NEW.order_id AND stock.id=NEW.position_id
      AND output.status='wip' AND stock.state='hold' AND stock.on_hand=output.quantity AND stock.reserved=0
      AND stock.site_id=link.site_id AND stock.item_id=output.item_id AND stock.owner_organization_id IS NULL
      AND receipt.disposition='accepted' AND receipt.quantity=output.quantity AND event.kind='receipt'
      AND event.on_hand_delta=output.quantity AND receipt.lot=output.lot
      AND (CASE WHEN receipt.serial IS NULL THEN output.serials='[]'::jsonb ELSE output.serials=jsonb_build_array(receipt.serial) END)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract output must match its held stock and accepted purchase receipt';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_receipt_guard"
BEFORE INSERT ON "public"."inventory_subcontract_receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_subcontract_receipt"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."inventory_require_settled_position_origin"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NEW.build_output_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_production_outputs output
    WHERE output.id=NEW.build_output_id AND output.item_id=NEW.item_id
      AND output.lot IS NOT DISTINCT FROM NEW.lot
      AND (CASE WHEN NEW.serial IS NULL THEN output.serials='[]'::jsonb ELSE output.serials ? NEW.serial END)
      AND (output.status='completed' OR (
        output.status='wip' AND NEW.state='hold' AND NEW.reserved=0 AND NEW.on_hand=output.quantity AND EXISTS (
          SELECT 1 FROM public.inventory_subcontract_receipts receipt
          WHERE receipt.output_id=output.id AND receipt.position_id=NEW.id
        )
      ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Produced warehouse stock needs a completed output or an exact held subcontract receipt';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_held_subcontract_stock"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_subcontract_receipts receipt
      JOIN public.inventory_production_outputs output ON output.id=receipt.output_id
    WHERE receipt.position_id=OLD.id AND output.status='wip'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Held subcontract stock requires the production release workflow';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_hold_guard"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_positions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_held_subcontract_stock"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_subcontract_dispatch"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Subcontract dispatch history cannot be removed';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.build_id,NEW.material_id,NEW.item_id,NEW.source_position_id,NEW.source_location_id,
        NEW.vendor_position_id,NEW.source_event_id,NEW.dispatch_event_id,NEW.quantity,NEW.created_at)
      IS DISTINCT FROM
       (OLD.id,OLD.build_id,OLD.material_id,OLD.item_id,OLD.source_position_id,OLD.source_location_id,
        OLD.vendor_position_id,OLD.source_event_id,OLD.dispatch_event_id,OLD.quantity,OLD.created_at)
      OR NEW.consumed < OLD.consumed OR NEW.returned < OLD.returned THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Subcontract dispatch identities and effects are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.consumed<>0 OR NEW.returned<>0 OR NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_events source
      JOIN public.inventory_stock_event_details source_bin ON source_bin.event_id=source.id
      JOIN public.inventory_stock_events vendor ON vendor.id=NEW.dispatch_event_id
      JOIN public.inventory_stock_event_details vendor_bin ON vendor_bin.event_id=vendor.id
      JOIN public.inventory_subcontracts link ON link.build_id=NEW.build_id
    WHERE source.id=NEW.source_event_id AND source.kind='production-dispatch' AND vendor.kind='production-dispatch'
      AND source.position_id=NEW.source_position_id AND vendor.position_id=NEW.vendor_position_id
      AND source.item_id=NEW.item_id AND vendor.item_id=NEW.item_id
      AND source.on_hand_delta=-NEW.quantity AND source.reserved_delta=-NEW.quantity
      AND vendor.on_hand_delta=NEW.quantity AND vendor.reserved_delta=NEW.quantity
      AND source_bin.site_id=link.site_id AND source_bin.location_id=NEW.source_location_id
      AND vendor_bin.site_id=link.site_id AND vendor_bin.location_id=link.supplier_bin_id
      AND source.request_id=vendor.request_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract dispatch requires matching paired warehouse events';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_dispatch_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_subcontract_dispatches"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_subcontract_dispatch"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_subcontract_consumption"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_subcontract_dispatches dispatch
      JOIN public.inventory_subcontract_receipts receipt ON receipt.build_id=dispatch.build_id
      JOIN public.inventory_production_inputs input ON input.output_id=receipt.output_id
    WHERE dispatch.id=NEW.dispatch_id AND input.event_id=NEW.event_id AND input.output_id=NEW.output_id
      AND input.position_id=dispatch.vendor_position_id AND input.material_id=dispatch.material_id AND input.quantity=NEW.quantity
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract consumption must use an input from the linked dispatch';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_consumption_guard"
BEFORE INSERT ON "public"."inventory_subcontract_consumptions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_subcontract_consumption"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_subcontract_return"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_subcontract_dispatches dispatch
      JOIN public.inventory_stock_events vendor ON vendor.id=NEW.source_event_id
      JOIN public.inventory_stock_events source ON source.id=NEW.return_event_id
      JOIN public.inventory_stock_event_details location ON location.event_id=source.id
    WHERE dispatch.id=NEW.dispatch_id AND vendor.kind='production-return' AND source.kind='production-return'
      AND vendor.position_id=dispatch.vendor_position_id AND source.position_id=dispatch.source_position_id
      AND vendor.item_id=dispatch.item_id AND source.item_id=dispatch.item_id
      AND vendor.on_hand_delta=-NEW.quantity AND vendor.reserved_delta=-NEW.quantity
      AND source.on_hand_delta=NEW.quantity AND source.reserved_delta=0
      AND location.location_id=dispatch.source_location_id AND vendor.request_id=source.request_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract return requires matching paired warehouse events';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_return_guard"
BEFORE INSERT ON "public"."inventory_subcontract_returns"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_subcontract_return"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_require_subcontract_custody_balance"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE
  vendor uuid;
  balance bigint;
BEGIN
  IF TG_TABLE_NAME='inventory_stock_positions' THEN
    vendor := NEW.id;
  ELSE
    vendor := NEW.vendor_position_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_subcontract_dispatches dispatch WHERE dispatch.id=NEW.id
        AND dispatch.consumed=(SELECT coalesce(sum(entry.quantity),0) FROM public.inventory_subcontract_consumptions entry WHERE entry.dispatch_id=dispatch.id)
        AND dispatch.returned=(SELECT coalesce(sum(entry.quantity),0) FROM public.inventory_subcontract_returns entry WHERE entry.dispatch_id=dispatch.id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract dispatch counters require matching consumption and return evidence';
    END IF;
  END IF;
  SELECT sum(quantity - returned - consumed) INTO balance
  FROM public.inventory_subcontract_dispatches WHERE vendor_position_id=vendor;
  IF coalesce(balance,0)>0 AND NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_positions position
      JOIN public.inventory_subcontract_dispatches dispatch ON dispatch.vendor_position_id=position.id
      JOIN public.inventory_subcontracts link ON link.build_id=dispatch.build_id
    WHERE position.id=vendor AND dispatch.quantity>dispatch.returned+dispatch.consumed
      AND position.site_id=link.site_id AND position.location_id=link.supplier_bin_id
      AND position.on_hand=balance AND position.reserved=balance AND position.owner_organization_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Subcontract custody balances must match their exact external parcel';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "inventory_subcontract_vendor_position_balance"
AFTER UPDATE ON "public"."inventory_stock_positions" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_require_subcontract_custody_balance"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "inventory_subcontract_vendor_dispatch_balance"
AFTER INSERT OR UPDATE ON "public"."inventory_subcontract_dispatches" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_require_subcontract_custody_balance"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_links_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_subcontracts" FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_materials_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_subcontract_materials" FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_receipts_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_subcontract_receipts" FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_consumptions_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_subcontract_consumptions" FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_subcontract_returns_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_subcontract_returns" FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
