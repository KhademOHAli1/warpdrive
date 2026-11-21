CREATE TABLE "inventory_stock_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_position_id" uuid NOT NULL,
	"component_position_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"installed_event_id" uuid NOT NULL,
	"removed_event_id" uuid,
	"recovered_position_id" uuid,
	CONSTRAINT "inventory_stock_installation_installed_event_key" UNIQUE("installed_event_id"),
	CONSTRAINT "inventory_stock_installation_removed_event_key" UNIQUE("removed_event_id"),
	CONSTRAINT "inventory_stock_installation_positions_check" CHECK ("inventory_stock_installations"."assembly_position_id" <> "inventory_stock_installations"."component_position_id"),
	CONSTRAINT "inventory_stock_installation_quantity_check" CHECK ("inventory_stock_installations"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "inventory_stock_installation_recovery_check" CHECK (("inventory_stock_installations"."removed_event_id" IS NULL) = ("inventory_stock_installations"."recovered_position_id" IS NULL)
        AND "inventory_stock_installations"."installed_event_id" <> "inventory_stock_installations"."removed_event_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_installations" ADD CONSTRAINT "inventory_stock_installations_assembly_position_id_inventory_stock_positions_id_fk" FOREIGN KEY ("assembly_position_id") REFERENCES "public"."inventory_stock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_installations" ADD CONSTRAINT "inventory_stock_installations_component_position_id_inventory_stock_positions_id_fk" FOREIGN KEY ("component_position_id") REFERENCES "public"."inventory_stock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_installations" ADD CONSTRAINT "inventory_stock_installations_installed_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("installed_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_installations" ADD CONSTRAINT "inventory_stock_installations_removed_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("removed_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_installations" ADD CONSTRAINT "inventory_stock_installations_recovered_position_id_inventory_stock_positions_id_fk" FOREIGN KEY ("recovered_position_id") REFERENCES "public"."inventory_stock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_stock_installation_assembly_idx" ON "inventory_stock_installations" USING btree ("assembly_position_id") WHERE "inventory_stock_installations"."removed_event_id" IS NULL;--> statement-breakpoint
CREATE INDEX "inventory_stock_installation_component_idx" ON "inventory_stock_installations" USING btree ("component_position_id") WHERE "inventory_stock_installations"."removed_event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release',
        'transfer-dispatch', 'transfer-receive', 'correction', 'correction-reversal',
        'component-install', 'component-remove', 'stock-disassemble'));
--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble'));
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location"
AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble'
))
EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
DROP TRIGGER "inventory_stock_operations_append_only" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_stock_operations_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble'
))
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_stock_installation"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Installed stock history cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.removed_event_id IS NOT NULL OR NEW.removed_event_id IS NULL
      OR (NEW.id, NEW.assembly_position_id, NEW.component_position_id, NEW.quantity, NEW.installed_event_id)
        IS DISTINCT FROM (OLD.id, OLD.assembly_position_id, OLD.component_position_id, OLD.quantity, OLD.installed_event_id)
    THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'An installation can only be closed once';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "public"."inventory_stock_events" AS event
      INNER JOIN "public"."inventory_stock_positions" AS origin ON origin.id = NEW.component_position_id
      INNER JOIN "public"."inventory_stock_positions" AS recovered ON recovered.id = NEW.recovered_position_id
      WHERE event.id = NEW.removed_event_id AND event.position_id = recovered.id
        AND event.kind IN ('component-remove', 'stock-disassemble') AND event.on_hand_delta = NEW.quantity
        AND recovered.item_id = origin.item_id
        AND (recovered.lot, recovered.serial, recovered.expiry_date, recovered.owner_organization_id)
          IS NOT DISTINCT FROM (origin.lot, origin.serial, origin.expiry_date, origin.owner_organization_id)
        AND (origin.serial IS NULL OR recovered.id = origin.id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Stock recovery must match the installed component';
    END IF;
  ELSIF NEW.removed_event_id IS NOT NULL OR NOT EXISTS (
    SELECT 1
    FROM "public"."inventory_stock_events" AS event
    WHERE event.id = NEW.installed_event_id AND event.position_id = NEW.component_position_id
      AND event.kind = 'component-install' AND event.on_hand_delta = -NEW.quantity
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Installation must reference its stock event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_stock_installation_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_stock_installations"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_stock_installation"();
