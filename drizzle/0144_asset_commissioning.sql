CREATE TABLE "asset_commissioning_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"lot" text,
	"build_output_id" uuid,
	"stock_event_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"asset_event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "asset_commissioning_position_key" UNIQUE("position_id"),
	CONSTRAINT "asset_commissioning_asset_key" UNIQUE("asset_id"),
	CONSTRAINT "asset_commissioning_stock_event_key" UNIQUE("stock_event_id"),
	CONSTRAINT "asset_commissioning_movement_key" UNIQUE("movement_id"),
	CONSTRAINT "asset_commissioning_asset_event_key" UNIQUE("asset_event_id"),
	CONSTRAINT "asset_commissioning_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "asset_commissioning_serial_check" CHECK (length(btrim("asset_commissioning_handoffs"."serial")) BETWEEN 1 AND 80),
	CONSTRAINT "asset_commissioning_lot_check" CHECK (length(btrim("asset_commissioning_handoffs"."lot")) BETWEEN 1 AND 80),
	CONSTRAINT "asset_commissioning_fingerprint_check" CHECK ("asset_commissioning_handoffs"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_commissioning_reason_check" CHECK (length(btrim("asset_commissioning_handoffs"."reason")) BETWEEN 1 AND 400)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_handoffs_stock_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("stock_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_handoffs_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_handoffs_asset_event_id_asset_events_id_fk" FOREIGN KEY ("asset_event_id") REFERENCES "public"."asset_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_handoffs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_build_output_fk" FOREIGN KEY ("build_output_id","item_id") REFERENCES "public"."inventory_production_outputs"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_commissioning_handoffs" ADD CONSTRAINT "asset_commissioning_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release',
        'transfer-dispatch', 'transfer-receive', 'correction', 'correction-reversal',
        'component-install', 'component-remove', 'stock-disassemble', 'production-reserve', 'production-release',
        'production-consume', 'production-output', 'production-reversal',
        'production-dispatch', 'production-return', 'asset-commission'));--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal', 'production-dispatch', 'production-return', 'production-accept', 'quality-release',
        'sales-reserve', 'sales-release', 'sales-shipment', 'customer-return', 'return-restock', 'return-scrap', 'asset-commission'));--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location" AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal',
  'production-dispatch', 'production-return', 'production-accept', 'quality-release',
  'sales-reserve', 'sales-release', 'sales-shipment', 'customer-return', 'return-restock', 'return-scrap',
  'asset-commission'
)) EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE FUNCTION "public"."asset_commissioning_guard_handoff"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Commissioning handoffs are retained';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_positions p
    JOIN public.inventory_stock_events stock_event ON stock_event.id = NEW.stock_event_id
    JOIN public.inventory_stock_event_details detail ON detail.event_id = stock_event.id
    JOIN public.inventory_movements movement ON movement.id = NEW.movement_id
    JOIN public.asset_records asset ON asset.id = NEW.asset_id
    JOIN public.asset_events history ON history.id = NEW.asset_event_id
    WHERE p.id = NEW.position_id AND p.item_id = NEW.item_id
      AND (p.site_id, p.location_id, p.serial) = (NEW.site_id, NEW.location_id, NEW.serial)
      AND p.lot IS NOT DISTINCT FROM NEW.lot AND p.build_output_id IS NOT DISTINCT FROM NEW.build_output_id
      AND p.on_hand = 0 AND p.reserved = 0 AND p.state = 'available' AND p.owner_organization_id IS NULL
      AND (stock_event.position_id, stock_event.item_id, stock_event.movement_id)
        = (NEW.position_id, NEW.item_id, NEW.movement_id)
      AND stock_event.kind = 'asset-commission' AND stock_event.on_hand_delta = -1
      AND stock_event.reserved_delta = 0 AND stock_event.incoming_delta = 0
      AND (stock_event.actor_id, stock_event.request_id) = (NEW.actor_id, NEW.request_id)
      AND (detail.site_id, detail.location_id, detail.previous_on_hand, detail.reason)
        = (NEW.site_id, NEW.location_id, 1, NEW.reason)
      AND movement.kind = 'asset-commission' AND movement.on_hand_delta = -1 AND movement.reserved_delta = 0
      AND (movement.item_id, movement.actor_id, movement.request_id) = (NEW.item_id, NEW.actor_id, NEW.request_id)
      AND (asset.site_id, asset.location_id, asset.serial) = (NEW.site_id, NEW.location_id, NEW.serial)
      AND asset.tracking = 'individual' AND asset.version = 1 AND asset.archived_at IS NULL
      AND (history.asset_id, history.site_id, history.location_id, history.actor_id, history.reason)
        = (NEW.asset_id, NEW.site_id, NEW.location_id, NEW.actor_id, NEW.reason)
      AND history.version = 1 AND history.kind = 'created'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Commissioning requires matching Inventory and Asset history';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_commissioning_guard_handoff"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."asset_commissioning_handoffs"
FOR EACH ROW EXECUTE FUNCTION "public"."asset_commissioning_guard_handoff"();
--> statement-breakpoint
CREATE FUNCTION "public"."asset_commissioning_guard_stock"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.asset_commissioning_handoffs WHERE position_id = OLD.id) THEN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Commissioned stock retains its zero-balance position';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_commissioning_guard_stock"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_positions"
FOR EACH ROW EXECUTE FUNCTION "public"."asset_commissioning_guard_stock"();
--> statement-breakpoint
CREATE FUNCTION "public"."asset_commissioning_guard_serial"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.asset_commissioning_handoffs WHERE asset_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Commissioned equipment retains its original serial';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_commissioning_guard_serial"
BEFORE UPDATE OF serial ON "public"."asset_records"
FOR EACH ROW WHEN (NEW.serial IS DISTINCT FROM OLD.serial)
EXECUTE FUNCTION "public"."asset_commissioning_guard_serial"();
--> statement-breakpoint
CREATE FUNCTION "public"."asset_commissioning_guard_movement"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF OLD.kind = 'asset-commission' OR (TG_OP = 'UPDATE' AND NEW.kind = 'asset-commission') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Commissioning debits are retained';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_commissioning_guard_movement"
BEFORE UPDATE OR DELETE ON "public"."inventory_movements"
FOR EACH ROW
EXECUTE FUNCTION "public"."asset_commissioning_guard_movement"();
--> statement-breakpoint
CREATE FUNCTION "public"."asset_commissioning_require_handoff"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'inventory_movements' THEN
    IF EXISTS (SELECT 1 FROM public.asset_commissioning_handoffs WHERE movement_id = NEW.id) THEN
      RETURN NULL;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.asset_commissioning_handoffs WHERE stock_event_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Commissioning audit entries require a handoff';
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "asset_commissioning_require_handoff"
AFTER INSERT ON "public"."inventory_movements" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.kind = 'asset-commission')
EXECUTE FUNCTION "public"."asset_commissioning_require_handoff"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "asset_commissioning_require_handoff"
AFTER INSERT ON "public"."inventory_stock_events" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.kind = 'asset-commission')
EXECUTE FUNCTION "public"."asset_commissioning_require_handoff"();
