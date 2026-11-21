CREATE TABLE "asset_custodian_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"custodian_id" uuid NOT NULL,
	"actor_id" uuid,
	"note" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_custodian_notes_text_check" CHECK (length(btrim("asset_custodian_notes"."note")) BETWEEN 1 AND 400)
);
--> statement-breakpoint
CREATE TABLE "asset_custodians" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"staff_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "asset_custodians_site_identity_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_custodians_site_staff_key" UNIQUE("site_id","staff_id"),
	CONSTRAINT "asset_custodians_name_check" CHECK (length(btrim("asset_custodians"."name")) > 0 AND ("asset_custodians"."kind" = 'staff' OR length(btrim("asset_custodians"."name")) <= 120)),
	CONSTRAINT "asset_custodians_kind_check" CHECK ("asset_custodians"."kind" = 'staff' OR ("asset_custodians"."kind" = 'non_login' AND "asset_custodians"."staff_id" IS NULL)),
	CONSTRAINT "asset_custodians_version_check" CHECK ("asset_custodians"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_custody_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"holding_id" uuid NOT NULL,
	"destination_holding_id" uuid,
	"from_custodian_id" uuid,
	"from_custodian_name" text,
	"to_custodian_id" uuid,
	"to_custodian_name" text,
	"quantity" integer NOT NULL,
	"source_location_id" uuid,
	"location_id" uuid,
	"condition" text NOT NULL,
	"note" text,
	CONSTRAINT "asset_custody_history_version_key" UNIQUE("asset_id","version"),
	CONSTRAINT "asset_custody_history_version_check" CHECK ("asset_custody_history"."version" > 1),
	CONSTRAINT "asset_custody_history_quantity_check" CHECK ("asset_custody_history"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "asset_custody_history_condition_check" CHECK ("asset_custody_history"."condition" IN ('good','worn','damaged','needs_inspection')),
	CONSTRAINT "asset_custody_history_note_check" CHECK (length(btrim("asset_custody_history"."note")) BETWEEN 1 AND 400),
	CONSTRAINT "asset_custody_history_transition_check" CHECK (
    (("asset_custody_history"."from_custodian_id" IS NULL) = ("asset_custody_history"."from_custodian_name" IS NULL)) AND
    (("asset_custody_history"."to_custodian_id" IS NULL) = ("asset_custody_history"."to_custodian_name" IS NULL)) AND (
      ("asset_custody_history"."action" = 'assign' AND "asset_custody_history"."from_custodian_id" IS NULL AND "asset_custody_history"."to_custodian_id" IS NOT NULL
        AND "asset_custody_history"."destination_holding_id" IS NULL) OR
      ("asset_custody_history"."action" = 'transfer' AND "asset_custody_history"."from_custodian_id" IS NOT NULL AND "asset_custody_history"."to_custodian_id" IS NOT NULL
        AND "asset_custody_history"."from_custodian_id" <> "asset_custody_history"."to_custodian_id" AND "asset_custody_history"."destination_holding_id" IS NOT NULL
        AND "asset_custody_history"."destination_holding_id" <> "asset_custody_history"."holding_id") OR
      ("asset_custody_history"."action" = 'return' AND "asset_custody_history"."from_custodian_id" IS NOT NULL AND "asset_custody_history"."to_custodian_id" IS NULL
        AND "asset_custody_history"."destination_holding_id" IS NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "asset_custody_holdings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"tracking" text NOT NULL,
	"custodian_id" uuid NOT NULL,
	"custodian_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"source_location_id" uuid,
	"location_id" uuid,
	"condition" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_custody_holdings_quantity_check" CHECK (("asset_custody_holdings"."tracking" = 'individual' AND "asset_custody_holdings"."quantity" = 1) OR ("asset_custody_holdings"."tracking" = 'returnable_pool' AND "asset_custody_holdings"."quantity" BETWEEN 1 AND 1000000 AND "asset_custody_holdings"."source_location_id" IS NOT NULL)),
	CONSTRAINT "asset_custody_holdings_condition_check" CHECK ("asset_custody_holdings"."condition" IN ('good','worn','damaged','needs_inspection'))
);
--> statement-breakpoint
CREATE TABLE "asset_custody_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"outcomes" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_custody_receipts_actor_id_request_id_pk" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "asset_custody_receipts_fingerprint_check" CHECK ("asset_custody_receipts"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_custody_receipts_outcomes_check" CHECK (CASE WHEN jsonb_typeof("asset_custody_receipts"."outcomes") = 'array' THEN jsonb_array_length("asset_custody_receipts"."outcomes") <= 100 ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "asset_custodian_notes" ADD CONSTRAINT "asset_custodian_notes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custodian_notes" ADD CONSTRAINT "asset_custodian_notes_holder_fk" FOREIGN KEY ("site_id","custodian_id") REFERENCES "public"."asset_custodians"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custodians" ADD CONSTRAINT "asset_custodians_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custodians" ADD CONSTRAINT "asset_custodians_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_history" ADD CONSTRAINT "asset_custody_history_id_asset_events_id_fk" FOREIGN KEY ("id") REFERENCES "public"."asset_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_history" ADD CONSTRAINT "asset_custody_history_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_history" ADD CONSTRAINT "asset_custody_history_from_fk" FOREIGN KEY ("site_id","from_custodian_id") REFERENCES "public"."asset_custodians"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_history" ADD CONSTRAINT "asset_custody_history_to_fk" FOREIGN KEY ("site_id","to_custodian_id") REFERENCES "public"."asset_custodians"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_history" ADD CONSTRAINT "asset_custody_history_source_fk" FOREIGN KEY ("site_id","source_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_history" ADD CONSTRAINT "asset_custody_history_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_holdings" ADD CONSTRAINT "asset_custody_holdings_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_holdings" ADD CONSTRAINT "asset_custody_holdings_custodian_fk" FOREIGN KEY ("site_id","custodian_id") REFERENCES "public"."asset_custodians"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_holdings" ADD CONSTRAINT "asset_custody_holdings_source_fk" FOREIGN KEY ("site_id","source_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_holdings" ADD CONSTRAINT "asset_custody_holdings_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_receipts" ADD CONSTRAINT "asset_custody_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_custody_receipts" ADD CONSTRAINT "asset_custody_receipts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_custodian_notes_site_holder_idx" ON "asset_custodian_notes" USING btree ("site_id","custodian_id");--> statement-breakpoint
CREATE INDEX "asset_custody_history_site_asset_idx" ON "asset_custody_history" USING btree ("site_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_custody_holdings_site_asset_idx" ON "asset_custody_holdings" USING btree ("site_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_custody_holdings_site_holder_idx" ON "asset_custody_holdings" USING btree ("site_id","custodian_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_custody_individual_key" ON "asset_custody_holdings" USING btree ("asset_id") WHERE "asset_custody_holdings"."tracking" = 'individual';--> statement-breakpoint
CREATE FUNCTION public.asset_custody_guard_custodian() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR (NEW.kind = 'staff' AND NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = NEW.staff_id AND is_active AND NOT projects_guest_only AND invited_at IS NULL
    )) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Custodians require an eligible staff link or a named non-login record';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Custodian records are retained';
  END IF;
  IF pg_trigger_depth() > 1 AND OLD.staff_id IS NOT NULL AND NEW.staff_id IS NULL
    AND (to_jsonb(NEW) - 'staff_id') = (to_jsonb(OLD) - 'staff_id') THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.site_id, NEW.kind, NEW.staff_id) IS DISTINCT FROM (OLD.id, OLD.site_id, OLD.kind, OLD.staff_id)
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Custodian linkage is fixed and each edit advances the version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_custody_guard_custodian
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_custodians
FOR EACH ROW EXECUTE FUNCTION public.asset_custody_guard_custodian();
--> statement-breakpoint
CREATE FUNCTION public.asset_custody_guard_holding() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'quantity') IS DISTINCT FROM (to_jsonb(OLD) - 'quantity') OR NEW.quantity >= OLD.quantity THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a custody release can reduce an existing holding';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.asset_records asset
    JOIN public.directory_sites site ON site.id = asset.site_id
    JOIN public.asset_custodians person ON person.id = NEW.custodian_id AND person.site_id = asset.site_id
    WHERE asset.id = NEW.asset_id AND asset.site_id = NEW.site_id AND asset.tracking = NEW.tracking
      AND asset.archived_at IS NULL AND NOT site.archived AND person.active
      AND (person.kind = 'non_login' OR EXISTS (
        SELECT 1 FROM public.users staff WHERE staff.id = person.staff_id
          AND staff.is_active AND NOT staff.projects_guest_only AND staff.invited_at IS NULL
      ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Custody requires eligible equipment and an active custodian at its site';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_custody_guard_holding
BEFORE INSERT OR UPDATE ON public.asset_custody_holdings
FOR EACH ROW EXECUTE FUNCTION public.asset_custody_guard_holding();
--> statement-breakpoint
CREATE FUNCTION public.asset_custody_guard_asset() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.asset_custody_holdings WHERE asset_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Equipment in custody must be returned before moving or archiving it';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_custody_guard_asset
BEFORE UPDATE OF location_id, archived_at ON public.asset_records
FOR EACH ROW WHEN (
  NEW.location_id IS DISTINCT FROM OLD.location_id
  OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
) EXECUTE FUNCTION public.asset_custody_guard_asset();
--> statement-breakpoint
CREATE FUNCTION public.asset_custody_guard_history() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Equipment custody history is retained';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.asset_events event
    WHERE event.id = NEW.id AND (event.site_id, event.asset_id, event.version) = (NEW.site_id, NEW.asset_id, NEW.version)
      AND event.kind = 'updated' AND event.quantity = NEW.quantity
      AND event.location_id IS NOT DISTINCT FROM NEW.location_id AND event.reason IS NOT DISTINCT FROM NEW.note
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A custody handover requires its matching equipment event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_custody_guard_history
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_custody_history
FOR EACH ROW EXECUTE FUNCTION public.asset_custody_guard_history();
--> statement-breakpoint
CREATE FUNCTION public.asset_custody_guard_note() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Custodian notes are retained';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_custody_guard_note
BEFORE UPDATE OR DELETE ON public.asset_custodian_notes
FOR EACH ROW EXECUTE FUNCTION public.asset_custody_guard_note();
