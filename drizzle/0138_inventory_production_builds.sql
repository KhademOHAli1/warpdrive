CREATE TABLE "inventory_production_allocations" (
	"material_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_production_allocation_pkey" PRIMARY KEY("material_id","position_id"),
	CONSTRAINT "inventory_production_allocation_qty_check" CHECK ("inventory_production_allocations"."quantity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_production_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"parent_id" uuid,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"scrapped" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"priority" text NOT NULL,
	"due_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"stock_unit" text NOT NULL,
	"trackable" boolean NOT NULL,
	"project_id" uuid,
	"template_revision" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_production_build_origin_key" UNIQUE("id","item_id","release_id"),
	CONSTRAINT "inventory_production_build_site_key" UNIQUE("id","site_id"),
	CONSTRAINT "inventory_production_build_project_key" UNIQUE("id","project_id"),
	CONSTRAINT "inventory_production_build_qty_check" CHECK ("inventory_production_builds"."quantity" BETWEEN 1 AND 1000000 AND "inventory_production_builds"."completed" >= 0 AND "inventory_production_builds"."scrapped" >= 0 AND "inventory_production_builds"."completed" + "inventory_production_builds"."scrapped" <= "inventory_production_builds"."quantity"),
	CONSTRAINT "inventory_production_build_status_check" CHECK ("inventory_production_builds"."status" IN ('planned','issued','on_hold','closed','cancelled') AND ("inventory_production_builds"."status" <> 'closed' OR "inventory_production_builds"."completed" + "inventory_production_builds"."scrapped" = "inventory_production_builds"."quantity")),
	CONSTRAINT "inventory_production_build_priority_check" CHECK ("inventory_production_builds"."priority" IN ('low','normal','high','urgent')),
	CONSTRAINT "inventory_production_build_parent_check" CHECK ("inventory_production_builds"."parent_id" <> "inventory_production_builds"."id"),
	CONSTRAINT "inventory_production_build_template_check" CHECK (("inventory_production_builds"."project_id" IS NULL) = ("inventory_production_builds"."template_revision" IS NULL) AND coalesce("inventory_production_builds"."template_revision", 1) > 0),
	CONSTRAINT "inventory_production_build_version_check" CHECK ("inventory_production_builds"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_production_inputs" (
	"output_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_production_input_pkey" PRIMARY KEY("output_id","material_id","position_id"),
	CONSTRAINT "inventory_production_input_event_key" UNIQUE("event_id"),
	CONSTRAINT "inventory_production_input_qty_check" CHECK ("inventory_production_inputs"."quantity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_production_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"required_release_id" uuid,
	"per_unit" integer NOT NULL,
	"stock_unit" text NOT NULL,
	"consumable" boolean NOT NULL,
	CONSTRAINT "inventory_production_material_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_production_material_requirement_key" UNIQUE NULLS NOT DISTINCT("build_id","item_id","required_release_id","consumable"),
	CONSTRAINT "inventory_production_material_qty_check" CHECK ("inventory_production_materials"."per_unit" BETWEEN 1 AND 1000000000),
	CONSTRAINT "inventory_production_material_consume_check" CHECK (NOT "inventory_production_materials"."consumable" OR "inventory_production_materials"."required_release_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "inventory_production_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'wip' NOT NULL,
	"lot" text,
	"serials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_by" uuid,
	"settled_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "inventory_production_output_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_production_output_qty_check" CHECK ("inventory_production_outputs"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "inventory_production_output_state_check" CHECK ("inventory_production_outputs"."status" IN ('wip','completed','scrapped','cancelled','reversed') AND
      (("inventory_production_outputs"."status" = 'wip') = ("inventory_production_outputs"."settled_at" IS NULL)) AND
      (("inventory_production_outputs"."settled_at" IS NULL) = ("inventory_production_outputs"."settled_by" IS NULL)) AND
      (("inventory_production_outputs"."status" = 'reversed') = ("inventory_production_outputs"."reversed_at" IS NOT NULL)) AND
      (("inventory_production_outputs"."reversed_at" IS NULL) = ("inventory_production_outputs"."reversed_by" IS NULL))),
	CONSTRAINT "inventory_production_output_detail_check" CHECK (CASE WHEN jsonb_typeof("inventory_production_outputs"."serials") = 'array' THEN jsonb_array_length("inventory_production_outputs"."serials") <= 500 ELSE false END
      AND ("inventory_production_outputs"."status" <> 'completed' OR "inventory_production_outputs"."lot" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_production_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"build_id" uuid NOT NULL,
	"command" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_production_receipt_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "inventory_production_receipt_fingerprint_check" CHECK ("inventory_production_receipts"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "inventory_production_receipt_reason_check" CHECK (length(btrim("inventory_production_receipts"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "inventory_production_tasks" (
	"build_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "inventory_production_task_pkey" PRIMARY KEY("build_id","position"),
	CONSTRAINT "inventory_production_task_item_key" UNIQUE("project_id","item_id"),
	CONSTRAINT "inventory_production_task_position_check" CHECK ("inventory_production_tasks"."position" BETWEEN 0 AND 9)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_stock_positions" ADD COLUMN "build_output_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_production_allocations" ADD CONSTRAINT "inventory_production_allocation_material_fk" FOREIGN KEY ("material_id","item_id") REFERENCES "public"."inventory_production_materials"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_allocations" ADD CONSTRAINT "inventory_production_allocation_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_builds" ADD CONSTRAINT "inventory_production_builds_project_id_internal_project_settings_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."internal_project_settings"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_builds" ADD CONSTRAINT "inventory_production_builds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_builds" ADD CONSTRAINT "inventory_production_build_release_fk" FOREIGN KEY ("release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_builds" ADD CONSTRAINT "inventory_production_build_bin_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_builds" ADD CONSTRAINT "inventory_production_build_parent_fk" FOREIGN KEY ("parent_id","site_id") REFERENCES "public"."inventory_production_builds"("id","site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_inputs" ADD CONSTRAINT "inventory_production_inputs_output_id_inventory_production_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."inventory_production_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_inputs" ADD CONSTRAINT "inventory_production_inputs_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_inputs" ADD CONSTRAINT "inventory_production_input_material_fk" FOREIGN KEY ("material_id","item_id") REFERENCES "public"."inventory_production_materials"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_inputs" ADD CONSTRAINT "inventory_production_input_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_materials" ADD CONSTRAINT "inventory_production_materials_build_id_inventory_production_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."inventory_production_builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_materials" ADD CONSTRAINT "inventory_production_materials_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_materials" ADD CONSTRAINT "inventory_production_material_release_fk" FOREIGN KEY ("required_release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_outputs" ADD CONSTRAINT "inventory_production_outputs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_outputs" ADD CONSTRAINT "inventory_production_outputs_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_outputs" ADD CONSTRAINT "inventory_production_outputs_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_outputs" ADD CONSTRAINT "inventory_production_output_build_fk" FOREIGN KEY ("build_id","item_id","release_id") REFERENCES "public"."inventory_production_builds"("id","item_id","release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_receipts" ADD CONSTRAINT "inventory_production_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_receipts" ADD CONSTRAINT "inventory_production_receipts_build_id_inventory_production_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."inventory_production_builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_tasks" ADD CONSTRAINT "inventory_production_task_build_fk" FOREIGN KEY ("build_id","project_id") REFERENCES "public"."inventory_production_builds"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_production_tasks" ADD CONSTRAINT "inventory_production_task_item_fk" FOREIGN KEY ("item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_production_allocation_position_idx" ON "inventory_production_allocations" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "inventory_production_build_site_idx" ON "inventory_production_builds" USING btree ("site_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_production_build_parent_idx" ON "inventory_production_builds" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "inventory_production_output_build_idx" ON "inventory_production_outputs" USING btree ("build_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_production_receipt_build_time_idx" ON "inventory_production_receipts" USING btree ("build_id","created_at");--> statement-breakpoint
ALTER TABLE "inventory_stock_positions" ADD CONSTRAINT "inventory_stock_position_build_output_fk" FOREIGN KEY ("build_output_id","item_id") REFERENCES "public"."inventory_production_outputs"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_stock_positions_build_output_idx" ON "inventory_stock_positions" USING btree ("build_output_id") WHERE "inventory_stock_positions"."build_output_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release',
        'transfer-dispatch', 'transfer-receive', 'correction', 'correction-reversal',
        'component-install', 'component-remove', 'stock-disassemble', 'production-reserve', 'production-release',
        'production-consume', 'production-output', 'production-reversal'));--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal'));
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location"
AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal'
))
EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
DROP TRIGGER "inventory_stock_operations_append_only" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_stock_operations_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal'
))
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_production_movements_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_movements"
FOR EACH ROW WHEN (OLD.kind IN (
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal'
))
EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_stock_position_build_output"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.build_output_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Produced stock lineage cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.build_output_id IS DISTINCT FROM OLD.build_output_id OR (
    OLD.build_output_id IS NOT NULL AND
    (NEW.id, NEW.item_id, NEW.lot, NEW.serial, NEW.expiry_date, NEW.owner_organization_id)
      IS DISTINCT FROM
    (OLD.id, OLD.item_id, OLD.lot, OLD.serial, OLD.expiry_date, OLD.owner_organization_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Produced stock lineage is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_stock_position_build_output_guard"
BEFORE UPDATE OF id, item_id, build_output_id, lot, serial, expiry_date, owner_organization_id OR DELETE
ON "public"."inventory_stock_positions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_stock_position_build_output"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_production_build"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Production build history cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.item_id, NEW.release_id, NEW.parent_id, NEW.site_id, NEW.location_id,
        NEW.quantity, NEW.stock_unit, NEW.trackable, NEW.project_id, NEW.template_revision,
        NEW.created_by, NEW.created_at)
      IS DISTINCT FROM
       (OLD.id, OLD.item_id, OLD.release_id, OLD.parent_id, OLD.site_id, OLD.location_id,
        OLD.quantity, OLD.stock_unit, OLD.trackable, OLD.project_id, OLD.template_revision,
        OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Production build identity is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'planned' OR NOT EXISTS (
    SELECT 1 FROM public.inventory_product_releases
    WHERE id = NEW.release_id AND item_id = NEW.item_id AND status = 'released'
  ) OR (
    NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inventory_production_materials
      WHERE build_id = NEW.parent_id AND item_id = NEW.item_id AND required_release_id = NEW.release_id
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A production build requires an approved release and admitted parent requirement';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_production_build_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_production_builds"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_production_build"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_production_output"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Production output history cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'wip' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Production outputs must start in progress';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.build_id, NEW.item_id, NEW.release_id, NEW.quantity, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM
      (OLD.id, OLD.build_id, OLD.item_id, OLD.release_id, OLD.quantity, OLD.created_by, OLD.created_at) OR NOT (
       (OLD.status = 'wip' AND NEW.status IN ('completed', 'scrapped', 'cancelled')) OR
       (OLD.status IN ('completed', 'scrapped') AND NEW.status = 'reversed' AND
         (NEW.lot, NEW.serials, NEW.reason, NEW.settled_by, NEW.settled_at)
           IS NOT DISTINCT FROM (OLD.lot, OLD.serials, OLD.reason, OLD.settled_by, OLD.settled_at))
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Production output evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_production_output_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_production_outputs"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_production_output"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_production_input"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_production_outputs AS output
      JOIN public.inventory_production_materials AS material ON material.build_id = output.build_id
      JOIN public.inventory_stock_events AS event ON event.id = NEW.event_id
    WHERE output.id = NEW.output_id AND output.status = 'wip'
      AND material.id = NEW.material_id AND material.item_id = NEW.item_id AND NOT material.consumable
      AND event.item_id = NEW.item_id AND event.position_id = NEW.position_id
      AND event.kind = 'production-consume'
      AND event.on_hand_delta = -NEW.quantity AND event.reserved_delta = -NEW.quantity
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Production inputs must match a recorded stock consumption for the same build';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_production_input_evidence"
BEFORE INSERT ON "public"."inventory_production_inputs"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_production_input"();
--> statement-breakpoint
CREATE TRIGGER "inventory_production_inputs_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_production_inputs"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_production_materials_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_production_materials"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE TRIGGER "inventory_production_receipts_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_production_receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_stock_operation_rewrite"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_require_settled_position_origin"() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.build_output_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_production_outputs
    WHERE id = NEW.build_output_id AND item_id = NEW.item_id AND status = 'completed'
      AND lot IS NOT DISTINCT FROM NEW.lot
      AND (CASE WHEN NEW.serial IS NULL THEN serials = '[]'::jsonb ELSE serials ? NEW.serial END)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Produced warehouse stock requires a completed output';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "inventory_stock_position_settled_origin"
AFTER INSERT ON "public"."inventory_stock_positions" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_require_settled_position_origin"();
