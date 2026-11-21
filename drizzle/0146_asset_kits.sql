CREATE TABLE "asset_kit_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"note" text,
	"from_location_id" uuid,
	"location_id" uuid NOT NULL,
	CONSTRAINT "asset_kit_activity_version_key" UNIQUE("kit_id","version"),
	CONSTRAINT "asset_kit_activity_kind_check" CHECK ("asset_kit_activity"."kind" IN ('created', 'edited', 'moved', 'checked_out', 'returned')),
	CONSTRAINT "asset_kit_activity_version_check" CHECK ("asset_kit_activity"."version" > 0),
	CONSTRAINT "asset_kit_activity_note_check" CHECK (length(btrim("asset_kit_activity"."note")) BETWEEN 1 AND 400)
);
--> statement-breakpoint
CREATE TABLE "asset_kit_checkout_lines" (
	"id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"requested_asset_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_code" text NOT NULL,
	"asset_name" text NOT NULL,
	"serial" text,
	"model_id" uuid,
	"source_location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"returned" integer DEFAULT 0 NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_kit_checkout_lines_checkout_id_id_pk" PRIMARY KEY("checkout_id","id"),
	CONSTRAINT "asset_kit_checkout_lines_mode_check" CHECK (("asset_kit_checkout_lines"."mode" = 'individual' AND "asset_kit_checkout_lines"."model_id" IS NULL AND "asset_kit_checkout_lines"."quantity" = 1)
        OR ("asset_kit_checkout_lines"."mode" = 'model' AND "asset_kit_checkout_lines"."model_id" IS NOT NULL AND "asset_kit_checkout_lines"."quantity" = 1)
        OR ("asset_kit_checkout_lines"."mode" IN ('returnable_pool', 'consumable_pool') AND "asset_kit_checkout_lines"."model_id" IS NULL
          AND "asset_kit_checkout_lines"."serial" IS NULL)),
	CONSTRAINT "asset_kit_checkout_lines_substitution_check" CHECK ("asset_kit_checkout_lines"."mode" = 'model' OR "asset_kit_checkout_lines"."requested_asset_id" = "asset_kit_checkout_lines"."asset_id"),
	CONSTRAINT "asset_kit_checkout_lines_qty_check" CHECK ("asset_kit_checkout_lines"."quantity" BETWEEN 1 AND 1000000 AND "asset_kit_checkout_lines"."returned" >= 0 AND "asset_kit_checkout_lines"."consumed" >= 0
        AND "asset_kit_checkout_lines"."returned"::bigint + "asset_kit_checkout_lines"."consumed" <= "asset_kit_checkout_lines"."quantity"
        AND ("asset_kit_checkout_lines"."mode" = 'consumable_pool' OR "asset_kit_checkout_lines"."consumed" = 0)),
	CONSTRAINT "asset_kit_checkout_lines_snapshot_check" CHECK (length(btrim("asset_kit_checkout_lines"."asset_code")) BETWEEN 1 AND 80
        AND length(btrim("asset_kit_checkout_lines"."asset_name")) BETWEEN 1 AND 120
        AND ("asset_kit_checkout_lines"."serial" IS NULL OR length(btrim("asset_kit_checkout_lines"."serial")) BETWEEN 1 AND 80))
);
--> statement-breakpoint
CREATE TABLE "asset_kit_checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"kit_code" text NOT NULL,
	"kit_name" text NOT NULL,
	"definition_version" integer NOT NULL,
	"location_id" uuid NOT NULL,
	"custodian_id" uuid NOT NULL,
	"custodian_name" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "asset_kit_checkouts_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_kit_checkouts_site_kit_id_key" UNIQUE("site_id","kit_id","id"),
	CONSTRAINT "asset_kit_checkouts_snapshot_check" CHECK (length(btrim("asset_kit_checkouts"."kit_code")) BETWEEN 1 AND 80
        AND length(btrim("asset_kit_checkouts"."kit_name")) BETWEEN 1 AND 120 AND length(btrim("asset_kit_checkouts"."custodian_name")) > 0),
	CONSTRAINT "asset_kit_checkouts_closed_check" CHECK ("asset_kit_checkouts"."closed_at" >= "asset_kit_checkouts"."at"),
	CONSTRAINT "asset_kit_checkouts_note_check" CHECK (length(btrim("asset_kit_checkouts"."note")) BETWEEN 1 AND 400)
);
--> statement-breakpoint
CREATE TABLE "asset_kit_definitions" (
	"kit_id" uuid NOT NULL,
	"definition_version" integer NOT NULL,
	"site_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "asset_kit_definitions_kit_id_definition_version_pk" PRIMARY KEY("kit_id","definition_version"),
	CONSTRAINT "asset_kit_definitions_scope_key" UNIQUE("site_id","kit_id","definition_version"),
	CONSTRAINT "asset_kit_definitions_version_check" CHECK ("asset_kit_definitions"."definition_version" > 0),
	CONSTRAINT "asset_kit_definitions_snapshot_check" CHECK (CASE WHEN jsonb_typeof("asset_kit_definitions"."snapshot") = 'object'
        AND jsonb_typeof("asset_kit_definitions"."snapshot"->'code') = 'string'
        AND jsonb_typeof("asset_kit_definitions"."snapshot"->'name') = 'string'
        AND jsonb_typeof("asset_kit_definitions"."snapshot"->'locationId') = 'string'
        AND jsonb_typeof("asset_kit_definitions"."snapshot"->'lines') = 'array'
        THEN jsonb_array_length("asset_kit_definitions"."snapshot"->'lines') <= 60 ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "asset_kit_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"model_id" uuid,
	"quantity" integer NOT NULL,
	"source_location_id" uuid,
	"packed_quantity" integer NOT NULL,
	CONSTRAINT "asset_kit_members_mode_check" CHECK (("asset_kit_members"."mode" = 'individual' AND "asset_kit_members"."model_id" IS NULL AND "asset_kit_members"."quantity" = 1)
        OR ("asset_kit_members"."mode" = 'model' AND "asset_kit_members"."model_id" IS NOT NULL AND "asset_kit_members"."quantity" = 1)
        OR ("asset_kit_members"."mode" IN ('returnable_pool', 'consumable_pool') AND "asset_kit_members"."model_id" IS NULL
          AND "asset_kit_members"."source_location_id" IS NOT NULL)),
	CONSTRAINT "asset_kit_members_quantity_check" CHECK ("asset_kit_members"."quantity" BETWEEN 1 AND 1000000 AND "asset_kit_members"."packed_quantity" BETWEEN 0 AND "asset_kit_members"."quantity")
);
--> statement-breakpoint
CREATE TABLE "asset_kit_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "asset_kit_receipts_actor_id_request_id_pk" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "asset_kit_receipts_fingerprint_check" CHECK ("asset_kit_receipts"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "asset_kit_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"kit_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"condition" text NOT NULL,
	"note" text,
	"lines" jsonb NOT NULL,
	CONSTRAINT "asset_kit_returns_condition_check" CHECK ("asset_kit_returns"."condition" IN ('good', 'worn', 'damaged', 'needs_inspection')),
	CONSTRAINT "asset_kit_returns_note_check" CHECK (length(btrim("asset_kit_returns"."note")) BETWEEN 1 AND 400),
	CONSTRAINT "asset_kit_returns_lines_check" CHECK (CASE WHEN jsonb_typeof("asset_kit_returns"."lines") = 'array'
        THEN jsonb_array_length("asset_kit_returns"."lines") BETWEEN 1 AND 60 ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "asset_kits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"code_key" text NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition_version" integer NOT NULL,
	CONSTRAINT "asset_kits_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_kits_site_code_key" UNIQUE("site_id","code_key"),
	CONSTRAINT "asset_kits_identity_check" CHECK (length(btrim("asset_kits"."code")) BETWEEN 1 AND 80 AND length(btrim("asset_kits"."code_key")) > 0
        AND length(btrim("asset_kits"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "asset_kits_version_check" CHECK ("asset_kits"."definition_version" > 0 AND "asset_kits"."version" >= "asset_kits"."definition_version")
);
--> statement-breakpoint
ALTER TABLE "asset_kit_activity" ADD CONSTRAINT "asset_kit_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_activity" ADD CONSTRAINT "asset_kit_activity_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_activity" ADD CONSTRAINT "asset_kit_activity_previous_location_fk" FOREIGN KEY ("site_id","from_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_activity" ADD CONSTRAINT "asset_kit_activity_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkout_lines" ADD CONSTRAINT "asset_kit_checkout_lines_checkout_fk" FOREIGN KEY ("site_id","checkout_id") REFERENCES "public"."asset_kit_checkouts"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkout_lines" ADD CONSTRAINT "asset_kit_checkout_lines_requested_asset_fk" FOREIGN KEY ("site_id","requested_asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkout_lines" ADD CONSTRAINT "asset_kit_checkout_lines_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkout_lines" ADD CONSTRAINT "asset_kit_checkout_lines_model_fk" FOREIGN KEY ("site_id","model_id") REFERENCES "public"."asset_models"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkout_lines" ADD CONSTRAINT "asset_kit_checkout_lines_source_fk" FOREIGN KEY ("site_id","source_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkouts" ADD CONSTRAINT "asset_kit_checkouts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkouts" ADD CONSTRAINT "asset_kit_checkouts_definition_fk" FOREIGN KEY ("site_id","kit_id","definition_version") REFERENCES "public"."asset_kit_definitions"("site_id","kit_id","definition_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkouts" ADD CONSTRAINT "asset_kit_checkouts_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_checkouts" ADD CONSTRAINT "asset_kit_checkouts_custodian_fk" FOREIGN KEY ("site_id","custodian_id") REFERENCES "public"."asset_custodians"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_definitions" ADD CONSTRAINT "asset_kit_definitions_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_members" ADD CONSTRAINT "asset_kit_members_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_members" ADD CONSTRAINT "asset_kit_members_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_members" ADD CONSTRAINT "asset_kit_members_model_fk" FOREIGN KEY ("site_id","model_id") REFERENCES "public"."asset_models"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_members" ADD CONSTRAINT "asset_kit_members_source_fk" FOREIGN KEY ("site_id","source_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_receipts" ADD CONSTRAINT "asset_kit_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_receipts" ADD CONSTRAINT "asset_kit_receipts_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_returns" ADD CONSTRAINT "asset_kit_returns_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kit_returns" ADD CONSTRAINT "asset_kit_returns_checkout_fk" FOREIGN KEY ("site_id","kit_id","checkout_id") REFERENCES "public"."asset_kit_checkouts"("site_id","kit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kits" ADD CONSTRAINT "asset_kits_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_kits" ADD CONSTRAINT "asset_kits_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_kit_activity_site_kit_idx" ON "asset_kit_activity" USING btree ("site_id","kit_id");--> statement-breakpoint
CREATE INDEX "asset_kit_checkout_lines_site_asset_idx" ON "asset_kit_checkout_lines" USING btree ("site_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_kit_checkouts_open_key" ON "asset_kit_checkouts" USING btree ("kit_id") WHERE "asset_kit_checkouts"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_kit_members_individual_key" ON "asset_kit_members" USING btree ("asset_id") WHERE "asset_kit_members"."mode" IN ('individual', 'model');--> statement-breakpoint
CREATE INDEX "asset_kit_members_site_kit_idx" ON "asset_kit_members" USING btree ("site_id","kit_id");--> statement-breakpoint
CREATE INDEX "asset_kit_members_site_asset_idx" ON "asset_kit_members" USING btree ("site_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_kit_members_site_source_idx" ON "asset_kit_members" USING btree ("site_id","source_location_id");--> statement-breakpoint
CREATE INDEX "asset_kit_returns_site_checkout_idx" ON "asset_kit_returns" USING btree ("site_id","checkout_id");--> statement-breakpoint
CREATE INDEX "asset_kits_site_location_idx" ON "asset_kits" USING btree ("site_id","location_id");
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_guard_member() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.asset_records asset
    JOIN public.asset_kits kit ON kit.id = NEW.kit_id AND kit.site_id = asset.site_id
    JOIN public.directory_locations bin ON bin.id = kit.location_id AND bin.site_id = asset.site_id
    JOIN public.directory_sites site ON site.id = asset.site_id
    WHERE asset.id = NEW.asset_id AND asset.site_id = NEW.site_id AND NOT site.archived AND NOT bin.archived
      AND (NEW.packed_quantity = 0 OR asset.archived_at IS NULL)
      AND (
        (NEW.mode IN ('returnable_pool', 'consumable_pool') AND asset.tracking = NEW.mode)
        OR (NEW.mode IN ('individual', 'model') AND asset.tracking = 'individual'
          AND (NEW.mode = 'individual' OR asset.model_id = NEW.model_id)
          AND asset.location_id = kit.location_id
          AND NOT EXISTS (SELECT 1 FROM public.asset_custody_holdings WHERE asset_id = asset.id))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Packed kit contents require eligible equipment at the kit site';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_member
BEFORE INSERT OR UPDATE ON public.asset_kit_members
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_member();
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_asset_claimed(asset_id_arg uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asset_kit_members
    WHERE asset_id = asset_id_arg AND packed_quantity > 0
  ) OR EXISTS (
    SELECT 1 FROM public.asset_kit_checkout_lines line
    JOIN public.asset_kit_checkouts checkout ON checkout.id = line.checkout_id
    WHERE line.asset_id = asset_id_arg AND checkout.closed_at IS NULL
      AND line.returned + line.consumed < line.quantity
  );
$$;
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_guard_asset() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF public.asset_kit_asset_claimed(OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Kit equipment must be released before changing its placement or identity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_asset
BEFORE UPDATE OF location_id, archived_at, model_id, serial ON public.asset_records
FOR EACH ROW WHEN (
  NEW.location_id IS DISTINCT FROM OLD.location_id
  OR NEW.model_id IS DISTINCT FROM OLD.model_id
  OR NEW.serial IS DISTINCT FROM OLD.serial
  OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
) EXECUTE FUNCTION public.asset_kit_guard_asset();
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_guard_direct_custody() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NEW.tracking = 'individual' AND public.asset_kit_asset_claimed(NEW.asset_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Kit equipment is checked out through its kit';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_direct_custody
BEFORE INSERT ON public.asset_custody_holdings
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_direct_custody();
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_guard_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'asset_kit_definitions'
    AND pg_trigger_depth() > 1 AND to_jsonb(OLD)->>'actor_id' IS NOT NULL
    AND to_jsonb(NEW)->>'actor_id' IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Kit definitions, returns and activity are retained';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_definition
BEFORE UPDATE OR DELETE ON public.asset_kit_definitions
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_snapshot();
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_return
BEFORE UPDATE OR DELETE ON public.asset_kit_returns
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_snapshot();
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_activity
BEFORE UPDATE OR DELETE ON public.asset_kit_activity
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_snapshot();
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_guard_checkout() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.closed_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.asset_custodians person
      WHERE person.id = NEW.custodian_id AND person.site_id = NEW.site_id AND person.active
        AND (person.kind = 'non_login' OR EXISTS (
          SELECT 1 FROM public.users staff WHERE staff.id = person.staff_id
            AND staff.is_active AND NOT staff.projects_guest_only AND staff.invited_at IS NULL
        ))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Kit checkout requires an active custodian';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
      AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
      RETURN NEW;
    END IF;
    IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
      AND (to_jsonb(NEW) - 'closed_at') = (to_jsonb(OLD) - 'closed_at')
      AND NOT EXISTS (
        SELECT 1 FROM public.asset_kit_checkout_lines
        WHERE checkout_id = OLD.id AND returned + consumed < quantity
      ) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A kit checkout can only be closed after every line is settled';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_checkout
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_kit_checkouts
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_checkout();
--> statement-breakpoint
CREATE FUNCTION public.asset_kit_guard_checkout_line() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.returned = 0 AND NEW.consumed = 0 AND EXISTS (
    SELECT 1 FROM public.asset_kit_checkouts checkout
    JOIN public.asset_kit_members member ON member.kit_id = checkout.kit_id AND member.id = NEW.id
    WHERE checkout.id = NEW.checkout_id AND checkout.closed_at IS NULL
      AND (member.site_id, member.mode, member.asset_id, member.quantity) =
          (NEW.site_id, NEW.mode, NEW.asset_id, NEW.quantity)
      AND member.packed_quantity = 0
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.returned >= OLD.returned AND NEW.consumed >= OLD.consumed
    AND (to_jsonb(NEW) - '{returned,consumed}'::text[]) = (to_jsonb(OLD) - '{returned,consumed}'::text[])
    AND EXISTS (
      SELECT 1 FROM public.asset_kit_checkouts WHERE id = OLD.checkout_id AND closed_at IS NULL
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Only outstanding quantities on an open kit checkout can be settled';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_kit_guard_checkout_line
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_kit_checkout_lines
FOR EACH ROW EXECUTE FUNCTION public.asset_kit_guard_checkout_line();
