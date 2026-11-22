CREATE TABLE "asset_booking_events" (
	"booking_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"site_id" uuid NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "asset_booking_events_booking_id_version_pk" PRIMARY KEY("booking_id","version"),
	CONSTRAINT "asset_booking_events_version_check" CHECK ("asset_booking_events"."version" > 0),
	CONSTRAINT "asset_booking_events_kind_check" CHECK ("asset_booking_events"."kind" IN ('created', 'edited', 'duplicated', 'submitted', 'approved', 'sent_back',
        'declined', 'cancelled', 'archived', 'restored', 'approval_disabled')),
	CONSTRAINT "asset_booking_events_reason_check" CHECK (length(btrim("asset_booking_events"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "asset_booking_events_snapshot_check" CHECK (CASE WHEN jsonb_typeof("asset_booking_events"."snapshot") = 'object'
        AND jsonb_typeof("asset_booking_events"."snapshot"->'title') = 'string'
        AND jsonb_typeof("asset_booking_events"."snapshot"->'status') = 'string'
        AND jsonb_typeof("asset_booking_events"."snapshot"->'archived') = 'boolean'
        AND jsonb_typeof("asset_booking_events"."snapshot"->'window'->'startAt') = 'string'
        AND jsonb_typeof("asset_booking_events"."snapshot"->'window'->'endAt') = 'string'
        AND jsonb_typeof("asset_booking_events"."snapshot"->'lines') = 'array'
        THEN jsonb_array_length("asset_booking_events"."snapshot"->'lines') <= 60 ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "asset_booking_feeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"secret_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "asset_booking_feeds_digest_key" UNIQUE("secret_digest"),
	CONSTRAINT "asset_booking_feeds_scope_check" CHECK ("asset_booking_feeds"."scope" IN ('self', 'site')),
	CONSTRAINT "asset_booking_feeds_digest_check" CHECK ("asset_booking_feeds"."secret_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_booking_feeds_revoked_check" CHECK ("asset_booking_feeds"."revoked_at" >= "asset_booking_feeds"."created_at")
);
--> statement-breakpoint
CREATE TABLE "asset_booking_lines" (
	"booking_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid,
	"model_id" uuid,
	"kit_id" uuid,
	"location_id" uuid,
	"quantity" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"bin" text,
	"serial" text,
	"contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kit_definition_version" integer,
	CONSTRAINT "asset_booking_lines_booking_id_position_pk" PRIMARY KEY("booking_id","position"),
	CONSTRAINT "asset_booking_lines_resource_check" CHECK (("asset_booking_lines"."kind" IN ('asset', 'returnable_pool', 'consumable_pool')
          AND "asset_booking_lines"."asset_id" IS NOT NULL AND "asset_booking_lines"."model_id" IS NULL AND "asset_booking_lines"."kit_id" IS NULL)
        OR ("asset_booking_lines"."kind" = 'model'
          AND "asset_booking_lines"."model_id" IS NOT NULL AND "asset_booking_lines"."asset_id" IS NULL AND "asset_booking_lines"."kit_id" IS NULL)
        OR ("asset_booking_lines"."kind" = 'kit'
          AND "asset_booking_lines"."kit_id" IS NOT NULL AND "asset_booking_lines"."asset_id" IS NULL AND "asset_booking_lines"."model_id" IS NULL)),
	CONSTRAINT "asset_booking_lines_quantity_check" CHECK ("asset_booking_lines"."quantity" BETWEEN 1 AND 1000000
        AND ("asset_booking_lines"."kind" NOT IN ('asset', 'kit') OR "asset_booking_lines"."quantity" = 1)
        AND ("asset_booking_lines"."kind" NOT IN ('returnable_pool', 'consumable_pool') OR "asset_booking_lines"."location_id" IS NOT NULL)),
	CONSTRAINT "asset_booking_lines_position_check" CHECK ("asset_booking_lines"."position" BETWEEN 0 AND 59),
	CONSTRAINT "asset_booking_lines_kit_definition_check" CHECK (("asset_booking_lines"."kind" = 'kit') = ("asset_booking_lines"."kit_definition_version" IS NOT NULL)
        AND ("asset_booking_lines"."kit_definition_version" IS NULL OR "asset_booking_lines"."kit_definition_version" > 0)),
	CONSTRAINT "asset_booking_lines_snapshot_check" CHECK (length(btrim("asset_booking_lines"."name")) BETWEEN 1 AND 120
        AND length(btrim("asset_booking_lines"."code")) BETWEEN 1 AND 80
        AND ("asset_booking_lines"."bin" IS NULL OR length(btrim("asset_booking_lines"."bin")) > 0)
        AND ("asset_booking_lines"."serial" IS NULL OR ("asset_booking_lines"."kind" = 'asset' AND length(btrim("asset_booking_lines"."serial")) BETWEEN 1 AND 80))),
	CONSTRAINT "asset_booking_lines_contents_check" CHECK (CASE WHEN jsonb_typeof("asset_booking_lines"."contents") = 'array' THEN jsonb_array_length("asset_booking_lines"."contents") <= 60
        AND ("asset_booking_lines"."kind" = 'kit' OR jsonb_array_length("asset_booking_lines"."contents") = 0) ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "asset_booking_maintenance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"asset_id" uuid,
	"model_id" uuid,
	"kit_id" uuid,
	"location_id" uuid,
	"quantity" integer NOT NULL,
	CONSTRAINT "asset_booking_maintenance_resource_check" CHECK (("asset_booking_maintenance"."kind" IN ('asset', 'returnable_pool', 'consumable_pool')
          AND "asset_booking_maintenance"."asset_id" IS NOT NULL AND "asset_booking_maintenance"."model_id" IS NULL AND "asset_booking_maintenance"."kit_id" IS NULL)
        OR ("asset_booking_maintenance"."kind" = 'model'
          AND "asset_booking_maintenance"."model_id" IS NOT NULL AND "asset_booking_maintenance"."asset_id" IS NULL AND "asset_booking_maintenance"."kit_id" IS NULL)
        OR ("asset_booking_maintenance"."kind" = 'kit'
          AND "asset_booking_maintenance"."kit_id" IS NOT NULL AND "asset_booking_maintenance"."asset_id" IS NULL AND "asset_booking_maintenance"."model_id" IS NULL)),
	CONSTRAINT "asset_booking_maintenance_quantity_check" CHECK ("asset_booking_maintenance"."quantity" BETWEEN 1 AND 1000000
        AND ("asset_booking_maintenance"."kind" NOT IN ('asset', 'kit') OR "asset_booking_maintenance"."quantity" = 1)
        AND ("asset_booking_maintenance"."kind" NOT IN ('returnable_pool', 'consumable_pool') OR "asset_booking_maintenance"."location_id" IS NOT NULL)),
	CONSTRAINT "asset_booking_maintenance_title_check" CHECK (length(btrim("asset_booking_maintenance"."title")) BETWEEN 1 AND 120),
	CONSTRAINT "asset_booking_maintenance_window_check" CHECK ("asset_booking_maintenance"."start_at" < "asset_booking_maintenance"."end_at"),
	CONSTRAINT "asset_booking_maintenance_version_check" CHECK ("asset_booking_maintenance"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_booking_memberships" (
	"site_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "asset_booking_memberships_site_id_user_id_pk" PRIMARY KEY("site_id","user_id"),
	CONSTRAINT "asset_booking_memberships_role_check" CHECK ("asset_booking_memberships"."role" IN ('base', 'self_service'))
);
--> statement-breakpoint
CREATE TABLE "asset_booking_policies" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	CONSTRAINT "asset_booking_policies_version_check" CHECK ("asset_booking_policies"."version" > 0),
	CONSTRAINT "asset_booking_policies_shape_check" CHECK (CASE WHEN jsonb_typeof("asset_booking_policies"."policy") = 'object'
        AND jsonb_typeof("asset_booking_policies"."policy"->'workingHours'->'weekly') = 'array'
        AND jsonb_typeof("asset_booking_policies"."policy"->'workingHours'->'overrides') = 'array'
        THEN jsonb_array_length("asset_booking_policies"."policy"->'workingHours'->'weekly') = 7
          AND jsonb_array_length("asset_booking_policies"."policy"->'workingHours'->'overrides') <= 366
        ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "asset_booking_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"booking_id" uuid,
	"fingerprint" text NOT NULL,
	CONSTRAINT "asset_booking_receipts_actor_id_request_id_pk" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "asset_booking_receipts_fingerprint_check" CHECK ("asset_booking_receipts"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "asset_bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"requester_id" uuid,
	"requester_name" text NOT NULL,
	"requester_role" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_bookings_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_bookings_window_check" CHECK ("asset_bookings"."start_at" < "asset_bookings"."end_at"),
	CONSTRAINT "asset_bookings_version_check" CHECK ("asset_bookings"."version" > 0),
	CONSTRAINT "asset_bookings_status_check" CHECK ("asset_bookings"."status" IN ('draft', 'pending', 'confirmed', 'cancelled')),
	CONSTRAINT "asset_bookings_requester_role_check" CHECK ("asset_bookings"."requester_role" IN ('base', 'self_service', 'manager')),
	CONSTRAINT "asset_bookings_title_check" CHECK (length(btrim("asset_bookings"."title")) BETWEEN 1 AND 120 AND length(btrim("asset_bookings"."requester_name")) > 0),
	CONSTRAINT "asset_bookings_description_check" CHECK (length(btrim("asset_bookings"."description")) BETWEEN 1 AND 1500)
);
--> statement-breakpoint
ALTER TABLE "asset_booking_events" ADD CONSTRAINT "asset_booking_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_events" ADD CONSTRAINT "asset_booking_events_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_bookings"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_feeds" ADD CONSTRAINT "asset_booking_feeds_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_feeds" ADD CONSTRAINT "asset_booking_feeds_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_lines" ADD CONSTRAINT "asset_booking_lines_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_bookings"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_lines" ADD CONSTRAINT "asset_booking_lines_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_lines" ADD CONSTRAINT "asset_booking_lines_model_fk" FOREIGN KEY ("site_id","model_id") REFERENCES "public"."asset_models"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_lines" ADD CONSTRAINT "asset_booking_lines_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_lines" ADD CONSTRAINT "asset_booking_lines_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_lines" ADD CONSTRAINT "asset_booking_lines_kit_definition_fk" FOREIGN KEY ("site_id","kit_id","kit_definition_version") REFERENCES "public"."asset_kit_definitions"("site_id","kit_id","definition_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_maintenance" ADD CONSTRAINT "asset_booking_maintenance_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_maintenance" ADD CONSTRAINT "asset_booking_maintenance_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_maintenance" ADD CONSTRAINT "asset_booking_maintenance_model_fk" FOREIGN KEY ("site_id","model_id") REFERENCES "public"."asset_models"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_maintenance" ADD CONSTRAINT "asset_booking_maintenance_kit_fk" FOREIGN KEY ("site_id","kit_id") REFERENCES "public"."asset_kits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_maintenance" ADD CONSTRAINT "asset_booking_maintenance_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_memberships" ADD CONSTRAINT "asset_booking_memberships_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_memberships" ADD CONSTRAINT "asset_booking_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_policies" ADD CONSTRAINT "asset_booking_policies_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_receipts" ADD CONSTRAINT "asset_booking_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_receipts" ADD CONSTRAINT "asset_booking_receipts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_receipts" ADD CONSTRAINT "asset_booking_receipts_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_bookings"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_bookings" ADD CONSTRAINT "asset_bookings_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_bookings" ADD CONSTRAINT "asset_bookings_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_booking_feeds_actor_site_idx" ON "asset_booking_feeds" USING btree ("actor_id","site_id");--> statement-breakpoint
CREATE INDEX "asset_booking_lines_site_kit_idx" ON "asset_booking_lines" USING btree ("site_id","kit_id") WHERE "asset_booking_lines"."kit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_booking_lines_site_location_idx" ON "asset_booking_lines" USING btree ("site_id","location_id") WHERE "asset_booking_lines"."location_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_booking_maintenance_window_idx" ON "asset_booking_maintenance" USING btree ("site_id","end_at","start_at") WHERE NOT "asset_booking_maintenance"."cancelled";--> statement-breakpoint
CREATE INDEX "asset_booking_memberships_user_idx" ON "asset_booking_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_bookings_site_updated_idx" ON "asset_bookings" USING btree ("site_id","updated_at");--> statement-breakpoint
CREATE INDEX "asset_bookings_site_window_idx" ON "asset_bookings" USING btree ("site_id","end_at","start_at") WHERE NOT "asset_bookings"."archived" AND "asset_bookings"."status" IN ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "asset_bookings_requester_site_idx" ON "asset_bookings" USING btree ("requester_id","site_id");
--> statement-breakpoint
CREATE FUNCTION public.asset_booking_guard_booking() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'draft' OR NEW.archived OR NEW.requester_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New bookings start as a named draft';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Bookings are retained';
  END IF;
  IF pg_trigger_depth() > 1 AND OLD.requester_id IS NOT NULL AND NEW.requester_id IS NULL
    AND (to_jsonb(NEW) - 'requester_id') = (to_jsonb(OLD) - 'requester_id') THEN
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.site_id) IS DISTINCT FROM (OLD.id, OLD.site_id)
    OR NEW.version <> OLD.version + 1
    OR (OLD.status <> 'draft' AND NEW.requester_id IS DISTINCT FROM OLD.requester_id)
    OR (OLD.status = 'cancelled' AND NEW.status <> 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bookings advance one version at a time';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_guard_booking
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_bookings
FOR EACH ROW EXECUTE FUNCTION public.asset_booking_guard_booking();
--> statement-breakpoint
CREATE FUNCTION public.asset_booking_guard_event() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.asset_bookings booking
    WHERE (booking.site_id, booking.id, booking.version) = (NEW.site_id, NEW.booking_id, NEW.version)
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Booking activity is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_guard_event
BEFORE INSERT OR UPDATE OR DELETE ON public.asset_booking_events
FOR EACH ROW EXECUTE FUNCTION public.asset_booking_guard_event();
--> statement-breakpoint
CREATE FUNCTION public.asset_booking_guard_resource() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NEW.asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.asset_records asset
    WHERE (asset.site_id, asset.id) = (NEW.site_id, NEW.asset_id)
      AND asset.tracking = CASE WHEN NEW.kind = 'asset' THEN 'individual' ELSE NEW.kind END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking resource kind must match its equipment';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_guard_line_resource
BEFORE INSERT OR UPDATE OF asset_id,site_id,kind ON public.asset_booking_lines
FOR EACH ROW EXECUTE FUNCTION public.asset_booking_guard_resource();
--> statement-breakpoint
CREATE TRIGGER asset_booking_guard_maintenance_resource
BEFORE INSERT OR UPDATE OF asset_id,site_id,kind ON public.asset_booking_maintenance
FOR EACH ROW EXECUTE FUNCTION public.asset_booking_guard_resource();
--> statement-breakpoint
CREATE FUNCTION public.asset_booking_guard_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users staff
    JOIN public.directory_sites site ON site.id = NEW.site_id AND NOT site.archived
    WHERE staff.id = NEW.user_id AND staff.is_active AND NOT staff.is_admin
      AND NOT staff.projects_guest_only AND staff.invited_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Booking membership requires an active site and eligible staff';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_guard_membership
BEFORE INSERT OR UPDATE ON public.asset_booking_memberships
FOR EACH ROW EXECUTE FUNCTION public.asset_booking_guard_membership();
