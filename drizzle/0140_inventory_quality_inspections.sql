CREATE TABLE "inventory_quality_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"step_key" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"staging_key" text NOT NULL,
	"object_key" text,
	"sha256" text,
	"etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_quality_evidence_target_step_key" UNIQUE("id","target_id","step_key"),
	CONSTRAINT "inventory_quality_evidence_staging_key" UNIQUE("staging_key"),
	CONSTRAINT "inventory_quality_evidence_object_key" UNIQUE("object_key"),
	CONSTRAINT "inventory_quality_evidence_size_check" CHECK ("inventory_quality_evidence"."size_bytes" BETWEEN 1 AND 5242880),
	CONSTRAINT "inventory_quality_evidence_sealed_check" CHECK (CASE WHEN "inventory_quality_evidence"."object_key" IS NULL THEN "inventory_quality_evidence"."sha256" IS NULL AND "inventory_quality_evidence"."etag" IS NULL
        ELSE "inventory_quality_evidence"."sha256" IS NOT NULL AND "inventory_quality_evidence"."sha256" ~ '^[0-9a-f]{64}$' AND "inventory_quality_evidence"."etag" IS NOT NULL END)
);
--> statement-breakpoint
CREATE TABLE "inventory_quality_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"steps" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_quality_plan_item_version_key" UNIQUE("item_id","version"),
	CONSTRAINT "inventory_quality_plan_id_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_quality_plan_request_key" UNIQUE("created_by","request_id"),
	CONSTRAINT "inventory_quality_plan_version_check" CHECK ("inventory_quality_plan_versions"."version" > 0 AND length("inventory_quality_plan_versions"."name") BETWEEN 1 AND 100 AND
        CASE WHEN jsonb_typeof("inventory_quality_plan_versions"."steps") = 'array' THEN jsonb_array_length("inventory_quality_plan_versions"."steps") BETWEEN 1 AND 32 ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "inventory_quality_run_evidence" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"step_key" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_quality_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"station" text NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"results" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_quality_run_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "inventory_quality_run_target_key" UNIQUE("id","target_id"),
	CONSTRAINT "inventory_quality_run_station_check" CHECK (length("inventory_quality_runs"."station") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "inventory_quality_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"serial" text NOT NULL,
	"lot" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_quality_target_position_key" UNIQUE("position_id"),
	CONSTRAINT "inventory_quality_target_status_check" CHECK ("inventory_quality_targets"."status" IN ('pending','failed','passed'))
);
--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";--> statement-breakpoint
ALTER TABLE "operations_access_receipts" DROP CONSTRAINT "operations_access_receipts_role_check";--> statement-breakpoint
ALTER TABLE "operations_site_grants" DROP CONSTRAINT "operations_site_grants_role_check";--> statement-breakpoint
ALTER TABLE "inventory_product_releases" ADD COLUMN "quality_plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_quality_evidence" ADD CONSTRAINT "inventory_quality_evidence_target_id_inventory_quality_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."inventory_quality_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_evidence" ADD CONSTRAINT "inventory_quality_evidence_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_plan_versions" ADD CONSTRAINT "inventory_quality_plan_versions_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_plan_versions" ADD CONSTRAINT "inventory_quality_plan_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_run_evidence" ADD CONSTRAINT "inventory_quality_run_evidence_run_fk" FOREIGN KEY ("run_id","target_id") REFERENCES "public"."inventory_quality_runs"("id","target_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_run_evidence" ADD CONSTRAINT "inventory_quality_run_evidence_identity_fk" FOREIGN KEY ("evidence_id","target_id","step_key") REFERENCES "public"."inventory_quality_evidence"("id","target_id","step_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_runs" ADD CONSTRAINT "inventory_quality_runs_target_id_inventory_quality_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."inventory_quality_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_runs" ADD CONSTRAINT "inventory_quality_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_targets" ADD CONSTRAINT "inventory_quality_target_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_targets" ADD CONSTRAINT "inventory_quality_target_build_site_fk" FOREIGN KEY ("build_id","site_id") REFERENCES "public"."inventory_production_builds"("id","site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_targets" ADD CONSTRAINT "inventory_quality_target_build_release_fk" FOREIGN KEY ("build_id","item_id","release_id") REFERENCES "public"."inventory_production_builds"("id","item_id","release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_targets" ADD CONSTRAINT "inventory_quality_target_output_fk" FOREIGN KEY ("output_id","item_id") REFERENCES "public"."inventory_production_outputs"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_targets" ADD CONSTRAINT "inventory_quality_target_release_fk" FOREIGN KEY ("release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_quality_targets" ADD CONSTRAINT "inventory_quality_target_plan_fk" FOREIGN KEY ("plan_version_id","item_id") REFERENCES "public"."inventory_quality_plan_versions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_quality_run_evidence_run_idx" ON "inventory_quality_run_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "inventory_quality_runs_history_idx" ON "inventory_quality_runs" USING btree ("target_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "inventory_quality_targets_site_idx" ON "inventory_quality_targets" USING btree ("site_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "inventory_quality_targets_build_idx" ON "inventory_quality_targets" USING btree ("build_id");--> statement-breakpoint
ALTER TABLE "inventory_product_releases" ADD CONSTRAINT "inventory_product_releases_quality_plan_fk" FOREIGN KEY ("quality_plan_version_id","item_id") REFERENCES "public"."inventory_quality_plan_versions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_quality_release_position_key" ON "inventory_stock_events" USING btree ("position_id") WHERE "inventory_stock_events"."kind" = 'quality-release';--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal', 'production-dispatch', 'production-return', 'production-accept', 'quality-release'));--> statement-breakpoint
ALTER TABLE "operations_access_receipts" ADD CONSTRAINT "operations_access_receipts_role_check" CHECK ("operations_access_receipts"."role" IN ('warehouse_viewer', 'warehouse_manager', 'asset_viewer', 'asset_manager', 'buyer', 'cost_viewer', 'quality_operator'));--> statement-breakpoint
ALTER TABLE "operations_site_grants" ADD CONSTRAINT "operations_site_grants_role_check" CHECK ("operations_site_grants"."role" IN ('warehouse_viewer', 'warehouse_manager', 'asset_viewer', 'asset_manager', 'buyer', 'cost_viewer', 'quality_operator'));
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_reject_quality_history_change"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Quality inspection history is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_plan_immutable" BEFORE UPDATE OR DELETE ON "public"."inventory_quality_plan_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_quality_history_change"();
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_runs_immutable" BEFORE UPDATE OR DELETE ON "public"."inventory_quality_runs"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_quality_history_change"();
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_evidence_links_immutable" BEFORE UPDATE OR DELETE ON "public"."inventory_quality_run_evidence"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_quality_history_change"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_quality_evidence_seal"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.object_key IS NOT NULL OR NEW.object_key IS NULL OR
     (to_jsonb(NEW) - ARRAY['object_key','sha256','etag']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['object_key','sha256','etag']) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Quality evidence has a single immutable seal';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_evidence_seal_guard" BEFORE UPDATE OR DELETE ON "public"."inventory_quality_evidence"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_quality_evidence_seal"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_quality_target"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE last_outcome boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'pending' OR NOT EXISTS (
      SELECT 1 FROM public.inventory_stock_positions stock
      JOIN public.inventory_production_outputs output ON output.id=stock.build_output_id
      JOIN public.inventory_product_releases release ON release.id=output.release_id
      WHERE stock.id=NEW.position_id AND stock.site_id=NEW.site_id
        AND stock.serial=NEW.serial AND stock.lot IS NOT DISTINCT FROM NEW.lot
        AND stock.state='hold' AND stock.on_hand=1 AND stock.reserved=0
        AND output.id=NEW.output_id AND output.build_id=NEW.build_id AND output.status='completed'
        AND release.id=NEW.release_id AND release.quality_plan_version_id=NEW.plan_version_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inspection must match a held serial and the approved release test plan';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR OLD.status='passed' OR NEW.status='pending' OR
     (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Inspection identity and released outcomes are immutable';
  END IF;
  SELECT passed INTO last_outcome FROM public.inventory_quality_runs
  WHERE target_id=NEW.id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF last_outcome IS DISTINCT FROM (NEW.status='passed') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inspection status requires its recorded test outcome';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_target_guard" BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_quality_targets"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_quality_target"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_protect_pending_quality_position"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF OLD.build_output_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.inventory_quality_targets target
    WHERE target.position_id=OLD.id AND target.status <> 'passed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Held production stock requires the quality inspection workflow';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_hold_guard" BEFORE UPDATE OR DELETE ON "public"."inventory_stock_positions"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_protect_pending_quality_position"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_require_gated_position_inspection"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_stock_positions stock
    JOIN public.inventory_production_outputs output ON output.id=stock.build_output_id
    JOIN public.inventory_product_releases release ON release.id=output.release_id
    WHERE stock.id=NEW.id AND release.quality_plan_version_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_quality_targets target
        WHERE target.position_id=stock.id AND target.output_id=output.id
          AND (target.status='passed' OR stock.state='hold')
      )
      AND NOT (output.status='wip' AND stock.state='hold' AND EXISTS (
        SELECT 1 FROM public.inventory_subcontract_receipts receipt
        WHERE receipt.output_id=output.id AND receipt.position_id=stock.id
      ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Gated production stock needs an exact inspection';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "inventory_require_quality_target" AFTER INSERT OR UPDATE ON "public"."inventory_stock_positions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.build_output_id IS NOT NULL)
EXECUTE FUNCTION "public"."inventory_require_gated_position_inspection"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_legacy_quality_pin"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_product_releases release
    WHERE release.id=NEW.release_id AND release.quality_plan_version_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A gated release requires serialized production';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_legacy_quality_pin_guard" BEFORE INSERT ON "public"."inventory_build_releases"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_legacy_quality_pin"();
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location"
AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal',
  'production-dispatch', 'production-return', 'production-accept', 'quality-release'
)) EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_quality_release_event"() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NEW.on_hand_delta <> 0 OR NEW.reserved_delta <> 0 OR NEW.incoming_delta <> 0 OR
     NEW.state IS DISTINCT FROM 'available' OR NEW.previous_state IS DISTINCT FROM 'hold' OR NOT EXISTS (
    SELECT 1 FROM public.inventory_quality_targets target
    JOIN public.inventory_quality_runs run ON run.target_id=target.id
    WHERE target.position_id=NEW.position_id AND target.item_id=NEW.item_id
      AND target.status='passed' AND run.passed AND run.actor_id=NEW.actor_id AND run.request_id=NEW.request_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Quality release events require a matching passed inspection without a stock credit';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_release_event_guard" BEFORE INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind='quality-release') EXECUTE FUNCTION "public"."inventory_guard_quality_release_event"();
--> statement-breakpoint
CREATE TRIGGER "inventory_quality_release_event_immutable" BEFORE UPDATE OR DELETE ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (OLD.kind='quality-release') EXECUTE FUNCTION "public"."inventory_reject_quality_history_change"();
