CREATE TABLE "asset_tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"asset_id" uuid,
	"kit_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"assigned_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"owner_contact" boolean DEFAULT false NOT NULL,
	CONSTRAINT "asset_tag_assignments_scope_id_key" UNIQUE("site_id","tag_id","id"),
	CONSTRAINT "asset_tag_assignments_target_check" CHECK (num_nonnulls("asset_tag_assignments"."asset_id", "asset_tag_assignments"."kit_id") = 1
        AND "asset_tag_assignments"."target_id" IS NOT DISTINCT FROM CASE "asset_tag_assignments"."target_kind"
          WHEN 'asset' THEN "asset_tag_assignments"."asset_id"
          WHEN 'kit' THEN "asset_tag_assignments"."kit_id"
        END),
	CONSTRAINT "asset_tag_assignments_end_check" CHECK (CASE WHEN "asset_tag_assignments"."ended_at" IS NULL THEN "asset_tag_assignments"."ended_by" IS NULL
        ELSE "asset_tag_assignments"."ended_at" >= "asset_tag_assignments"."assigned_at" END)
);
--> statement-breakpoint
CREATE TABLE "asset_tag_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "asset_tag_batches_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_tag_batches_metadata_check" CHECK ("asset_tag_batches"."source" IN ('printed', 'imported') AND length(btrim("asset_tag_batches"."title")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "asset_tag_binding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"owner_contact_enabled" boolean,
	CONSTRAINT "asset_tag_binding_events_kind_check" CHECK ("asset_tag_binding_events"."kind" IN ('claim', 'unlink', 'swap', 'import', 'owner_contact')
        AND ("asset_tag_binding_events"."kind" = 'owner_contact') = ("asset_tag_binding_events"."owner_contact_enabled" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "asset_tag_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"token" text NOT NULL,
	"legacy_id" text,
	"legacy_origin" text,
	CONSTRAINT "asset_tag_codes_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_tag_codes_batch_ordinal_key" UNIQUE("batch_id","ordinal"),
	CONSTRAINT "asset_tag_codes_identity_check" CHECK ("asset_tag_codes"."ordinal" BETWEEN 1 AND 100 AND "asset_tag_codes"."token" COLLATE "C" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "asset_tag_codes_legacy_check" CHECK (CASE WHEN "asset_tag_codes"."legacy_id" IS NULL THEN "asset_tag_codes"."legacy_origin" IS NULL
        ELSE "asset_tag_codes"."legacy_id" COLLATE "C" ~ '^[a-z][a-z0-9]{6,23}$'
          AND "asset_tag_codes"."legacy_id" COLLATE "C" ~ '[0-9]'
          AND ("asset_tag_codes"."legacy_origin" IS NULL OR (
            length("asset_tag_codes"."legacy_origin") <= 240
            AND "asset_tag_codes"."legacy_origin" COLLATE "C" ~ '^https?://[^/?#@%[:space:]]+$'
            AND strpos("asset_tag_codes"."legacy_origin", chr(92)) = 0
          ))
        END)
);
--> statement-breakpoint
CREATE TABLE "asset_tag_owner_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"reply_to" text,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"read_by" uuid,
	CONSTRAINT "asset_tag_owner_messages_request_key" UNIQUE("assignment_id","request_id"),
	CONSTRAINT "asset_tag_owner_messages_text_check" CHECK (length(btrim("asset_tag_owner_messages"."message")) BETWEEN 1 AND 2000
        AND ("asset_tag_owner_messages"."reply_to" IS NULL OR length(btrim("asset_tag_owner_messages"."reply_to")) BETWEEN 1 AND 254)),
	CONSTRAINT "asset_tag_owner_messages_fingerprint_check" CHECK ("asset_tag_owner_messages"."fingerprint" COLLATE "C" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_tag_owner_messages_read_check" CHECK (CASE WHEN "asset_tag_owner_messages"."read_at" IS NULL THEN "asset_tag_owner_messages"."read_by" IS NULL ELSE "asset_tag_owner_messages"."read_at" >= "asset_tag_owner_messages"."at" END)
);
--> statement-breakpoint
CREATE TABLE "asset_tag_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"batch_id" uuid,
	"tag_id" uuid,
	"command_type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "asset_tag_receipts_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "asset_tag_receipts_command_check" CHECK (CASE WHEN "asset_tag_receipts"."command_type" IN ('createBatch', 'importLegacy')
        THEN "asset_tag_receipts"."batch_id" IS NOT NULL AND "asset_tag_receipts"."tag_id" IS NULL
        WHEN "asset_tag_receipts"."command_type" IN ('claim', 'swap', 'unlink', 'setOwnerContact', 'markMessageRead')
        THEN "asset_tag_receipts"."batch_id" IS NULL AND "asset_tag_receipts"."tag_id" IS NOT NULL
        ELSE false END),
	CONSTRAINT "asset_tag_receipts_fingerprint_check" CHECK ("asset_tag_receipts"."fingerprint" COLLATE "C" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "asset_tag_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"source" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy" double precision,
	CONSTRAINT "asset_tag_scans_source_check" CHECK ("asset_tag_scans"."source" IN ('printed_link', 'manual', 'camera')),
	CONSTRAINT "asset_tag_scans_coordinates_check" CHECK (num_nonnulls("asset_tag_scans"."latitude", "asset_tag_scans"."longitude", "asset_tag_scans"."accuracy") = 0 OR (
          num_nonnulls("asset_tag_scans"."latitude", "asset_tag_scans"."longitude", "asset_tag_scans"."accuracy") = 3
          AND "asset_tag_scans"."latitude" BETWEEN -90 AND 90 AND "asset_tag_scans"."longitude" BETWEEN -180 AND 180
          AND "asset_tag_scans"."accuracy" BETWEEN 0 AND 100000
        ))
);
--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_tag_fk" FOREIGN KEY ("site_id","tag_id") REFERENCES "public"."asset_tag_codes"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_batches" ADD CONSTRAINT "asset_tag_batches_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_batches" ADD CONSTRAINT "asset_tag_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_binding_events" ADD CONSTRAINT "asset_tag_binding_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_binding_events" ADD CONSTRAINT "asset_tag_binding_events_assignment_fk" FOREIGN KEY ("site_id","tag_id","assignment_id") REFERENCES "public"."asset_tag_assignments"("site_id","tag_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_codes" ADD CONSTRAINT "asset_tag_codes_batch_fk" FOREIGN KEY ("site_id","batch_id") REFERENCES "public"."asset_tag_batches"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_owner_messages" ADD CONSTRAINT "asset_tag_owner_messages_read_by_users_id_fk" FOREIGN KEY ("read_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_owner_messages" ADD CONSTRAINT "asset_tag_owner_messages_assignment_fk" FOREIGN KEY ("site_id","tag_id","assignment_id") REFERENCES "public"."asset_tag_assignments"("site_id","tag_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_receipts" ADD CONSTRAINT "asset_tag_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_receipts" ADD CONSTRAINT "asset_tag_receipts_batch_fk" FOREIGN KEY ("site_id","batch_id") REFERENCES "public"."asset_tag_batches"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_receipts" ADD CONSTRAINT "asset_tag_receipts_tag_fk" FOREIGN KEY ("site_id","tag_id") REFERENCES "public"."asset_tag_codes"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_scans" ADD CONSTRAINT "asset_tag_scans_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_scans" ADD CONSTRAINT "asset_tag_scans_assignment_fk" FOREIGN KEY ("site_id","tag_id","assignment_id") REFERENCES "public"."asset_tag_assignments"("site_id","tag_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_tag_assignments_tag_history_idx" ON "asset_tag_assignments" USING btree ("site_id","tag_id","assigned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_assignments_active_tag_uidx" ON "asset_tag_assignments" USING btree ("site_id","tag_id") WHERE "asset_tag_assignments"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_assignments_active_subject_uidx" ON "asset_tag_assignments" USING btree ("site_id","target_kind","target_id") WHERE "asset_tag_assignments"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_tag_batches_site_created_idx" ON "asset_tag_batches" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_tag_binding_events_site_at_idx" ON "asset_tag_binding_events" USING btree ("site_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_codes_token_uidx" ON "asset_tag_codes" USING btree ("token" COLLATE "C");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tag_codes_legacy_uidx" ON "asset_tag_codes" USING btree ("legacy_id" COLLATE "C") WHERE "asset_tag_codes"."legacy_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_tag_owner_messages_site_at_idx" ON "asset_tag_owner_messages" USING btree ("site_id","at");--> statement-breakpoint
CREATE INDEX "asset_tag_scans_site_at_idx" ON "asset_tag_scans" USING btree ("site_id","at");--> statement-breakpoint
CREATE INDEX "asset_tag_scans_dedupe_idx" ON "asset_tag_scans" USING btree ("assignment_id","actor_id","at");
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_actor_erasure(before_row jsonb, after_row jsonb, column_name text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog, public AS $$
  SELECT pg_trigger_depth() > 1
    AND (before_row ->> column_name) IS NOT NULL AND (after_row ->> column_name) IS NULL
    AND (before_row - column_name) = (after_row - column_name);
$$;
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_live_subject(site_scope uuid, asset_scope uuid, kit_scope uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.directory_sites site WHERE site.id = site_scope AND NOT site.archived)
    AND CASE WHEN asset_scope IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.asset_records asset
      WHERE (asset.site_id, asset.id) = (site_scope, asset_scope) AND asset.archived_at IS NULL
    ) WHEN kit_scope IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.asset_kits kit WHERE (kit.site_id, kit.id) = (site_scope, kit_scope)
    ) ELSE false END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_live_epoch(site_scope uuid, tag_scope uuid, epoch_id uuid, needs_contact boolean)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path TO pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.asset_tag_assignments epoch
    WHERE (epoch.site_id, epoch.tag_id, epoch.id) = (site_scope, tag_scope, epoch_id)
      AND epoch.ended_at IS NULL AND (NOT needs_contact OR epoch.owner_contact)
      AND public.asset_tag_live_subject(epoch.site_id, epoch.asset_id, epoch.kit_id)
    FOR SHARE
  );
$$;
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.directory_sites site WHERE site.id = NEW.site_id AND NOT site.archived
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tag batch requires an active site and issuer';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'created_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Tag batch identity is retained';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_batch BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_batches
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_batch();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_code() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Issued tag identifiers are retained';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.asset_tag_batches batch
    JOIN public.directory_sites site ON site.id = batch.site_id AND NOT site.archived
    WHERE (batch.site_id, batch.id) = (NEW.site_id, NEW.batch_id)
      AND (batch.source = 'imported') = (NEW.legacy_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Tag source must match its active batch';
  END IF;
  -- The tag and label registries cooperate on the same namespace fence.
  PERFORM pg_advisory_xact_lock(hashtext('warpdrive-equipment-tags'), hashtext('namespace-v1'));
  IF EXISTS (
    SELECT 1 FROM public.physical_labels label
    WHERE label.key COLLATE "C" IN ('text:wd-tag:v1:' || NEW.token, 'text:' || NEW.legacy_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'asset_tag_registry_identifier_key',
      MESSAGE = 'This printed identifier is already registered';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_code BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_codes
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_code();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_label_identifier() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NEW.source <> 'external' OR NEW.format IN ('gs1_128', 'gs1_datamatrix') THEN
    RETURN NEW;
  END IF;
  IF NEW.value COLLATE "C" ~ '^wd-tag:v1:[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'asset_tag_registry_identifier_key',
      MESSAGE = 'This printed identifier is reserved for equipment tags';
  END IF;
  IF NEW.value COLLATE "C" ~ '^[a-z][a-z0-9]{6,23}$' AND NEW.value COLLATE "C" ~ '[0-9]' THEN
    PERFORM pg_advisory_xact_lock(hashtext('warpdrive-equipment-tags'), hashtext('namespace-v1'));
    IF EXISTS (SELECT 1 FROM public.asset_tag_codes tag WHERE tag.legacy_id COLLATE "C" = NEW.value) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'asset_tag_registry_identifier_key',
        MESSAGE = 'This printed identifier is already registered';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_label_identifier BEFORE INSERT ON public.physical_labels
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_label_identifier();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_by IS NULL OR NEW.ended_at IS NOT NULL OR NEW.ended_by IS NOT NULL
      OR NEW.owner_contact OR NOT public.asset_tag_live_subject(NEW.site_id, NEW.asset_id, NEW.kit_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A new tag assignment requires a live target and private default';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'assigned_by')
      OR public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'ended_by') THEN
      RETURN NEW;
    END IF;
    IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND NEW.ended_by IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['ended_at', 'ended_by']) =
          (to_jsonb(OLD) - ARRAY['ended_at', 'ended_by']) THEN
      RETURN NEW;
    END IF;
    IF OLD.ended_at IS NULL AND NEW.ended_at IS NULL
      AND (to_jsonb(NEW) - 'owner_contact') = (to_jsonb(OLD) - 'owner_contact')
      AND public.asset_tag_live_subject(NEW.site_id, NEW.asset_id, NEW.kit_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Tag assignment identity and closing history are retained';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_assignment
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_assignment();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_binding_event() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.asset_tag_assignments epoch
      WHERE (epoch.site_id, epoch.tag_id, epoch.id) = (NEW.site_id, NEW.tag_id, NEW.assignment_id)
        AND NEW.at >= epoch.assigned_at
        AND CASE WHEN NEW.kind = 'unlink' THEN epoch.ended_at IS NOT NULL AND NEW.at >= epoch.ended_at
          WHEN NEW.kind = 'owner_contact' THEN epoch.ended_at IS NULL AND epoch.owner_contact = NEW.owner_contact_enabled
          ELSE epoch.ended_at IS NULL END
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Tag history must match its assignment';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Tag assignment history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_binding_event
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_binding_events
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_binding_event();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_scan() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_id IS NULL OR NOT public.asset_tag_live_epoch(NEW.site_id, NEW.tag_id, NEW.assignment_id, false) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A private scan requires a live assignment and scanner';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'actor_id') THEN
      RETURN NEW;
    END IF;
    IF num_nonnulls(OLD.latitude, OLD.longitude, OLD.accuracy) = 0
      AND num_nonnulls(NEW.latitude, NEW.longitude, NEW.accuracy) = 3
      AND (to_jsonb(NEW) - ARRAY['latitude', 'longitude', 'accuracy']) =
          (to_jsonb(OLD) - ARRAY['latitude', 'longitude', 'accuracy'])
      AND public.asset_tag_live_epoch(NEW.site_id, NEW.tag_id, NEW.assignment_id, false) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Tag scans only admit coordinates once';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_scan BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_scans
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_scan();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_owner_message() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.read_at IS NOT NULL OR NEW.read_by IS NOT NULL
      OR NOT public.asset_tag_live_epoch(NEW.site_id, NEW.tag_id, NEW.assignment_id, true) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Contact requires a live opted-in tag assignment';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'read_by') THEN
      RETURN NEW;
    END IF;
    IF OLD.read_at IS NULL AND NEW.read_at IS NOT NULL AND NEW.read_by IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['read_at', 'read_by']) =
          (to_jsonb(OLD) - ARRAY['read_at', 'read_by']) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Tag owner messages only admit one read mark';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_owner_message
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_owner_messages
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_owner_message();
--> statement-breakpoint
CREATE FUNCTION public.asset_tag_guard_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A tag command receipt requires an actor';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND public.asset_tag_actor_erasure(to_jsonb(OLD), to_jsonb(NEW), 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Tag command receipts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_tag_guard_receipt
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_tag_receipts
FOR EACH ROW EXECUTE FUNCTION public.asset_tag_guard_receipt();
