CREATE TABLE "inventory_engineering_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"base_release_id" uuid NOT NULL,
	"candidate_release_id" uuid NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"review" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "inventory_eng_changes_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_eng_changes_base_key" UNIQUE("id","item_id","base_release_id"),
	CONSTRAINT "inventory_eng_changes_distinct_release_check" CHECK ("inventory_engineering_changes"."base_release_id" <> "inventory_engineering_changes"."candidate_release_id"),
	CONSTRAINT "inventory_eng_changes_snapshot_check" CHECK (
      "inventory_engineering_changes"."fingerprint" ~ '^[0-9a-f]{64}$' AND coalesce("inventory_engineering_changes"."review"->>'fingerprint' = "inventory_engineering_changes"."fingerprint", false)
      AND coalesce("inventory_engineering_changes"."review"->'base'->>'id' = "inventory_engineering_changes"."base_release_id"::text, false)
      AND coalesce("inventory_engineering_changes"."review"->'candidate'->>'id' = "inventory_engineering_changes"."candidate_release_id"::text, false)
      AND coalesce("inventory_engineering_changes"."review"->'ready' = 'true'::jsonb, false)
      AND length(btrim("inventory_engineering_changes"."reason")) BETWEEN 1 AND 300
      AND "inventory_engineering_changes"."version" > 0 AND "inventory_engineering_changes"."updated_at" >= "inventory_engineering_changes"."created_at"),
	CONSTRAINT "inventory_eng_changes_status_check" CHECK (
      "inventory_engineering_changes"."status" IN ('review','returned','approved','withdrawn')
      AND ("inventory_engineering_changes"."approved_by" IS NOT NULL) = ("inventory_engineering_changes"."status" = 'approved')
      AND ("inventory_engineering_changes"."approved_at" IS NOT NULL) = ("inventory_engineering_changes"."status" = 'approved')
      AND ("inventory_engineering_changes"."approved_at" IS NULL OR "inventory_engineering_changes"."approved_at" < "inventory_engineering_changes"."effective_at"))
);
--> statement-breakpoint
CREATE TABLE "inventory_engineering_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review" jsonb,
	CONSTRAINT "inventory_eng_events_change_version_key" UNIQUE("change_id","version"),
	CONSTRAINT "inventory_eng_events_shape_check" CHECK (
      "inventory_engineering_events"."version" > 0 AND "inventory_engineering_events"."type" IN ('submitted','returned','approved','withdrawn')
      AND length(btrim("inventory_engineering_events"."actor_name")) BETWEEN 1 AND 180
      AND ("inventory_engineering_events"."note" IS NULL OR length(btrim("inventory_engineering_events"."note")) BETWEEN 1 AND 300)
      AND ("inventory_engineering_events"."type" <> 'returned' OR "inventory_engineering_events"."note" IS NOT NULL)
      AND ("inventory_engineering_events"."type" <> 'submitted' OR "inventory_engineering_events"."review" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_engineering_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"base_release_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"build_output_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"hold_event_id" uuid NOT NULL,
	"release_event_id" uuid,
	CONSTRAINT "inventory_eng_holds_hold_event_key" UNIQUE("hold_event_id"),
	CONSTRAINT "inventory_eng_holds_release_event_key" UNIQUE("release_event_id"),
	CONSTRAINT "inventory_eng_holds_distinct_events_check" CHECK ("inventory_engineering_holds"."hold_event_id" <> "inventory_engineering_holds"."release_event_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_engineering_requests" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_eng_requests_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "inventory_eng_requests_fingerprint_check" CHECK ("inventory_engineering_requests"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_engineering_changes" ADD CONSTRAINT "inventory_engineering_changes_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_changes" ADD CONSTRAINT "inventory_engineering_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_changes" ADD CONSTRAINT "inventory_engineering_changes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_changes" ADD CONSTRAINT "inventory_eng_changes_base_fk" FOREIGN KEY ("base_release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_changes" ADD CONSTRAINT "inventory_eng_changes_candidate_fk" FOREIGN KEY ("candidate_release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_events" ADD CONSTRAINT "inventory_engineering_events_change_id_inventory_engineering_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."inventory_engineering_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_events" ADD CONSTRAINT "inventory_engineering_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_holds" ADD CONSTRAINT "inventory_engineering_holds_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_holds" ADD CONSTRAINT "inventory_engineering_holds_hold_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("hold_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_holds" ADD CONSTRAINT "inventory_engineering_holds_release_event_id_inventory_stock_events_id_fk" FOREIGN KEY ("release_event_id") REFERENCES "public"."inventory_stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_holds" ADD CONSTRAINT "inventory_eng_holds_change_fk" FOREIGN KEY ("change_id","item_id","base_release_id") REFERENCES "public"."inventory_engineering_changes"("id","item_id","base_release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_holds" ADD CONSTRAINT "inventory_eng_holds_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_holds" ADD CONSTRAINT "inventory_eng_holds_output_fk" FOREIGN KEY ("build_output_id","item_id") REFERENCES "public"."inventory_production_outputs"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_requests" ADD CONSTRAINT "inventory_engineering_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_engineering_requests" ADD CONSTRAINT "inventory_eng_requests_change_fk" FOREIGN KEY ("change_id","item_id") REFERENCES "public"."inventory_engineering_changes"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_eng_changes_active_item_key" ON "inventory_engineering_changes" USING btree ("item_id") WHERE "inventory_engineering_changes"."status" IN ('review','returned');--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_eng_changes_candidate_key" ON "inventory_engineering_changes" USING btree ("candidate_release_id") WHERE "inventory_engineering_changes"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "inventory_eng_changes_effectivity_idx" ON "inventory_engineering_changes" USING btree ("item_id","effective_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "inventory_engineering_changes"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "inventory_eng_changes_baseline_idx" ON "inventory_engineering_changes" USING btree ("item_id","created_at","id") WHERE "inventory_engineering_changes"."status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "inventory_eng_changes_recent_idx" ON "inventory_engineering_changes" USING btree ("item_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_eng_holds_active_position_key" ON "inventory_engineering_holds" USING btree ("position_id") WHERE "inventory_engineering_holds"."release_event_id" IS NULL;--> statement-breakpoint
CREATE INDEX "inventory_eng_holds_change_position_idx" ON "inventory_engineering_holds" USING btree ("change_id","position_id");--> statement-breakpoint
CREATE INDEX "inventory_eng_requests_change_idx" ON "inventory_engineering_requests" USING btree ("change_id");
--> statement-breakpoint
ALTER TABLE "inventory_stock_events" DROP CONSTRAINT "inventory_stock_event_kind_check";
--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release',
        'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
        'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
        'production-reserve', 'production-release', 'production-consume', 'production-output',
        'production-reversal', 'production-dispatch', 'production-return', 'production-accept', 'quality-release',
        'sales-reserve', 'sales-release', 'sales-shipment', 'customer-return', 'return-restock', 'return-scrap', 'asset-commission', 'engineering-disposition'));
--> statement-breakpoint
DROP TRIGGER "inventory_capture_stock_event_location" ON "public"."inventory_stock_events";
--> statement-breakpoint
CREATE TRIGGER "inventory_capture_stock_event_location" AFTER INSERT ON "public"."inventory_stock_events"
FOR EACH ROW WHEN (NEW.kind NOT IN (
  'transfer-draft', 'transfer-dispatch', 'transfer-receive', 'transfer-cancel', 'correction', 'correction-reversal',
  'stock-split', 'stock-merge', 'component-install', 'component-remove', 'stock-disassemble',
  'production-reserve', 'production-release', 'production-consume', 'production-output', 'production-reversal',
  'production-dispatch', 'production-return', 'production-accept', 'quality-release',
  'sales-reserve', 'sales-release', 'sales-shipment', 'customer-return', 'return-restock', 'return-scrap',
  'asset-commission', 'engineering-disposition'
)) EXECUTE FUNCTION "public"."inventory_capture_stock_event_location"();
--> statement-breakpoint
CREATE TRIGGER inventory_eng_stock_event_append_only BEFORE UPDATE OR DELETE
ON public.inventory_stock_events FOR EACH ROW WHEN (OLD.kind = 'engineering-disposition')
EXECUTE FUNCTION public.inventory_reject_stock_operation_rewrite();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_engineering_change() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE base public.inventory_product_releases%ROWTYPE;
DECLARE candidate public.inventory_product_releases%ROWTYPE;
DECLARE observed_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Engineering reviews are retained' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'review' THEN
      RAISE EXCEPTION 'Engineering review must start at a submitted version' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW.id, NEW.item_id, NEW.base_release_id, NEW.candidate_release_id, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.item_id, OLD.base_release_id, OLD.candidate_release_id, OLD.created_by, OLD.created_at)
        OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'Engineering review versions preserve exact identities' USING ERRCODE = '23514';
    END IF;
    IF NOT (CASE OLD.status
      WHEN 'review' THEN NEW.status IN ('returned','approved','withdrawn')
      WHEN 'returned' THEN NEW.status IN ('review','withdrawn')
      ELSE false END) THEN
      RAISE EXCEPTION 'Illegal engineering review transition' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'review' AND (NEW.reason, NEW.effective_at, NEW.review, NEW.fingerprint)
        IS DISTINCT FROM (OLD.reason, OLD.effective_at, OLD.review, OLD.fingerprint) THEN
      RAISE EXCEPTION 'An engineering decision preserves the reviewed snapshot' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Match the product lock already held by native approval, proposal and build callers.
  PERFORM 1 FROM public.inventory_items i WHERE i.id = NEW.item_id AND i.kind = 'product' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engineering review requires an exact product' USING ERRCODE = '23514';
  END IF;
  SELECT r.* INTO base FROM public.inventory_product_releases r WHERE r.id = NEW.base_release_id AND r.item_id = NEW.item_id;
  SELECT r.* INTO candidate FROM public.inventory_product_releases r WHERE r.id = NEW.candidate_release_id AND r.item_id = NEW.item_id;
  IF base.status IS DISTINCT FROM 'released'
    OR NEW.review->'base'->>'revision' IS DISTINCT FROM base.revision
    OR NEW.review->'base'->>'status' IS DISTINCT FROM 'released'
    OR NEW.review->'candidate'->>'revision' IS DISTINCT FROM candidate.revision
    OR NEW.review->'candidate'->>'status' IS DISTINCT FROM 'draft'
    OR (NEW.status = 'review' AND candidate.status IS DISTINCT FROM 'draft')
    OR (NEW.status = 'approved' AND (candidate.status IS DISTINCT FROM 'released' OR candidate.approved_by IS DISTINCT FROM NEW.approved_by)) THEN
    RAISE EXCEPTION 'Engineering review requires its exact released baseline and candidate' USING ERRCODE = '23514';
  END IF;

  observed_at := clock_timestamp();
  IF NEW.status IN ('review','approved') AND (NEW.effective_at <= observed_at OR EXISTS (
    SELECT 1 FROM public.inventory_engineering_changes c
    WHERE c.item_id = NEW.item_id AND c.id <> NEW.id AND c.status = 'approved' AND c.effective_at > observed_at
  )) THEN
    RAISE EXCEPTION 'Engineering change requires a future date and no competing scheduled cutover' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_eng_change_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory_engineering_changes FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_engineering_change();
--> statement-breakpoint
CREATE FUNCTION public.require_inventory_engineering_event() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE exact_event public.inventory_engineering_events%ROWTYPE;
BEGIN
  SELECT e.* INTO exact_event FROM public.inventory_engineering_events e
    WHERE e.change_id = NEW.id AND e.version = NEW.version;
  IF exact_event.id IS NULL OR exact_event.type IS DISTINCT FROM
    (CASE NEW.status WHEN 'review' THEN 'submitted' ELSE NEW.status END)
    OR (NEW.status = 'review' AND exact_event.review IS DISTINCT FROM NEW.review)
    OR (NEW.status = 'approved' AND exact_event.actor_id IS DISTINCT FROM NEW.approved_by)
    OR (NEW.version = 1 AND exact_event.actor_id IS DISTINCT FROM NEW.created_by) THEN
    RAISE EXCEPTION 'Engineering review version requires its matching history event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_eng_change_event_check AFTER INSERT OR UPDATE
ON public.inventory_engineering_changes DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_inventory_engineering_event();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_engineering_event() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.inventory_engineering_changes c WHERE c.id = NEW.change_id AND c.version = NEW.version
      AND NEW.type = (CASE c.status WHEN 'review' THEN 'submitted' ELSE c.status END)
      AND (NEW.review IS NULL OR NEW.review = c.review)
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (NEW.id, NEW.change_id, NEW.version, NEW.type, NEW.actor_name, NEW.note, NEW.created_at, NEW.review)
      IS NOT DISTINCT FROM (OLD.id, OLD.change_id, OLD.version, OLD.type, OLD.actor_name, OLD.note, OLD.created_at, OLD.review)
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.actor_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Engineering history is append-only for the exact current version' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_eng_event_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory_engineering_events FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_engineering_event();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_engineering_request() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.actor_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Engineering request receipts are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_eng_request_guard BEFORE UPDATE OR DELETE
ON public.inventory_engineering_requests FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_engineering_request();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_engineering_hold() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE selected_event uuid;
DECLARE source_state text;
DECLARE target_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Engineering disposition history is retained' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.release_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Engineering hold must start open' USING ERRCODE = '23514';
    END IF;
    selected_event := NEW.hold_event_id;
    source_state := 'available';
    target_state := 'hold';
  ELSE
    IF (NEW.id, NEW.change_id, NEW.item_id, NEW.base_release_id, NEW.position_id, NEW.build_output_id,
      NEW.site_id, NEW.hold_event_id) IS DISTINCT FROM
      (OLD.id, OLD.change_id, OLD.item_id, OLD.base_release_id, OLD.position_id, OLD.build_output_id,
      OLD.site_id, OLD.hold_event_id) OR OLD.release_event_id IS NOT NULL OR NEW.release_event_id IS NULL THEN
      RAISE EXCEPTION 'Engineering hold identity is immutable and can close once' USING ERRCODE = '23514';
    END IF;
    selected_event := NEW.release_event_id;
    source_state := 'hold';
    target_state := 'available';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_positions p
    JOIN public.inventory_production_outputs o ON o.id = p.build_output_id AND o.item_id = p.item_id
    JOIN public.inventory_engineering_changes c ON c.id = NEW.change_id AND c.item_id = p.item_id
    JOIN public.inventory_stock_events e ON e.id = selected_event AND e.position_id = p.id AND e.item_id = p.item_id
    JOIN public.inventory_stock_event_details d ON d.event_id = e.id
    JOIN public.inventory_stock_event_details h ON h.event_id = NEW.hold_event_id
    WHERE p.id = NEW.position_id AND p.item_id = NEW.item_id AND p.build_output_id = NEW.build_output_id
      AND p.site_id = NEW.site_id AND p.state = 'hold' AND p.on_hand > 0 AND p.reserved = 0
      AND p.owner_organization_id IS NULL AND o.status = 'completed' AND o.release_id = NEW.base_release_id
      AND c.status = 'approved' AND c.effective_at <= clock_timestamp() AND c.base_release_id = o.release_id
      AND e.kind = 'engineering-disposition' AND e.previous_state = source_state AND e.state = target_state AND e.source_position_id IS NULL
      AND e.on_hand_delta = 0 AND e.reserved_delta = 0 AND e.incoming_delta = 0 AND e.movement_id IS NULL
      AND d.site_id = p.site_id AND d.location_id = p.location_id AND d.previous_on_hand = p.on_hand
      AND d.reason IS NOT NULL
      AND (NEW.release_event_id IS NULL OR d.sequence > h.sequence)
  ) THEN
    RAISE EXCEPTION 'Engineering disposition requires exact confirmed stock and ledger proof' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_eng_hold_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory_engineering_holds FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_engineering_hold();
--> statement-breakpoint
CREATE FUNCTION public.require_inventory_engineering_position_state() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_engineering_holds h
    JOIN public.inventory_stock_positions p ON p.id = h.position_id AND p.item_id = h.item_id
    JOIN public.inventory_stock_events e ON e.id = coalesce(h.release_event_id, h.hold_event_id)
    JOIN public.inventory_stock_event_details d ON d.event_id = e.id
    JOIN public.inventory_engineering_requests r ON r.actor_id = e.actor_id AND r.request_id = e.request_id
      AND r.change_id = h.change_id AND r.item_id = h.item_id
    WHERE h.id = NEW.id AND p.site_id = h.site_id AND p.site_id = d.site_id AND p.location_id = d.location_id
      AND p.build_output_id = h.build_output_id AND p.on_hand = d.previous_on_hand AND p.reserved = 0
      AND p.owner_organization_id IS NULL
      AND p.state = (CASE WHEN h.release_event_id IS NULL THEN 'hold' ELSE 'available' END)
  ) THEN
    RAISE EXCEPTION 'Engineering disposition did not preserve the exact position quantities and state' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_eng_hold_position_check AFTER INSERT OR UPDATE
ON public.inventory_engineering_holds DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_inventory_engineering_position_state();
--> statement-breakpoint
CREATE FUNCTION public.protect_inventory_engineering_position() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_engineering_holds h WHERE h.position_id = OLD.id AND h.release_event_id IS NULL) THEN
    RAISE EXCEPTION 'Engineering hold owns this stock position until explicit release' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_eng_position_guard BEFORE UPDATE OR DELETE
ON public.inventory_stock_positions FOR EACH ROW EXECUTE FUNCTION public.protect_inventory_engineering_position();
