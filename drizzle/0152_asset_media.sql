CREATE TABLE "asset_media_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"file_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"kind" text,
	"name" text,
	"mime" text,
	"size_bytes" integer,
	"sha256" text,
	"object_key" text,
	"actor_id" uuid,
	CONSTRAINT "asset_media_events_scope_key" UNIQUE("site_id","target_id","id"),
	CONSTRAINT "asset_media_events_version_key" UNIQUE("target_id","version"),
	CONSTRAINT "asset_media_events_object_key" UNIQUE("object_key"),
	CONSTRAINT "asset_media_events_version_check" CHECK ("asset_media_events"."version" > 0),
	CONSTRAINT "asset_media_events_payload_check" CHECK (
      ("asset_media_events"."type" = 'uploaded' AND "asset_media_events"."file_id" IS NOT NULL AND "asset_media_events"."file_id" = "asset_media_events"."id"
        AND "asset_media_events"."name" IS NOT NULL AND length(btrim("asset_media_events"."name")) BETWEEN 1 AND 180
        AND "asset_media_events"."sha256" IS NOT NULL AND "asset_media_events"."sha256" ~ '^[0-9a-f]{64}$'
        AND "asset_media_events"."object_key" IS NOT NULL AND length("asset_media_events"."object_key") BETWEEN 1 AND 350
        AND "asset_media_events"."kind" IS NOT NULL AND "asset_media_events"."mime" IS NOT NULL AND "asset_media_events"."size_bytes" IS NOT NULL
        AND (
          ("asset_media_events"."kind" = 'photo' AND "asset_media_events"."mime" IN ('image/jpeg','image/png')
            AND "asset_media_events"."size_bytes" BETWEEN 1 AND 5242880)
          OR ("asset_media_events"."kind" = 'document' AND "asset_media_events"."mime" = 'application/pdf'
            AND "asset_media_events"."size_bytes" BETWEEN 1 AND 10485760)
        ))
      OR ("asset_media_events"."type" = 'cover_changed' AND "asset_media_events"."name" IS NULL AND "asset_media_events"."sha256" IS NULL
        AND "asset_media_events"."object_key" IS NULL AND "asset_media_events"."kind" IS NULL AND "asset_media_events"."mime" IS NULL
        AND "asset_media_events"."size_bytes" IS NULL)
    )
);
--> statement-breakpoint
CREATE TABLE "asset_media_receipts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_id" uuid,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "asset_media_receipts_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "asset_media_receipts_fingerprint_check" CHECK ("asset_media_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "asset_media_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"asset_id" uuid,
	"model_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "asset_media_targets_site_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_media_targets_asset_key" UNIQUE("site_id","asset_id"),
	CONSTRAINT "asset_media_targets_model_key" UNIQUE("site_id","model_id"),
	CONSTRAINT "asset_media_targets_value_check" CHECK ("asset_media_targets"."version" >= 0 AND (
      ("asset_media_targets"."target_type" = 'asset' AND "asset_media_targets"."asset_id" IS NOT NULL AND "asset_media_targets"."model_id" IS NULL)
      OR ("asset_media_targets"."target_type" = 'model' AND "asset_media_targets"."model_id" IS NOT NULL AND "asset_media_targets"."asset_id" IS NULL)
    ))
);
--> statement-breakpoint
ALTER TABLE "asset_media_events" ADD CONSTRAINT "asset_media_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_events" ADD CONSTRAINT "asset_media_events_target_fk" FOREIGN KEY ("site_id","target_id") REFERENCES "public"."asset_media_targets"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_events" ADD CONSTRAINT "asset_media_events_file_fk" FOREIGN KEY ("site_id","target_id","file_id") REFERENCES "public"."asset_media_events"("site_id","target_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_receipts" ADD CONSTRAINT "asset_media_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_receipts" ADD CONSTRAINT "asset_media_receipts_event_fk" FOREIGN KEY ("site_id","target_id","event_id") REFERENCES "public"."asset_media_events"("site_id","target_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_targets" ADD CONSTRAINT "asset_media_targets_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_targets" ADD CONSTRAINT "asset_media_targets_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_media_targets" ADD CONSTRAINT "asset_media_targets_model_fk" FOREIGN KEY ("site_id","model_id") REFERENCES "public"."asset_models"("site_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION public.guard_asset_media_target() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Equipment media history is retained' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.version <> 0 THEN
      RAISE EXCEPTION 'An equipment media register starts at revision zero' USING ERRCODE = '23514';
    END IF;
  ELSIF (NEW.id, NEW.site_id, NEW.target_type, NEW.asset_id, NEW.model_id)
      IS DISTINCT FROM (OLD.id, OLD.site_id, OLD.target_type, OLD.asset_id, OLD.model_id)
      OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Equipment media requires an immutable target and consecutive revisions' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.directory_sites site WHERE site.id = NEW.site_id AND NOT site.archived)
    OR (NEW.target_type = 'asset' AND NOT EXISTS (
      SELECT 1 FROM public.asset_records asset
      WHERE (asset.site_id, asset.id) = (NEW.site_id, NEW.asset_id) AND asset.archived_at IS NULL
    ))
  THEN
    RAISE EXCEPTION 'Equipment media writes require active equipment and site' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_media_target_guard BEFORE INSERT OR UPDATE OR DELETE ON public.asset_media_targets
FOR EACH ROW EXECUTE FUNCTION public.guard_asset_media_target();
--> statement-breakpoint
CREATE FUNCTION public.require_asset_media_event() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.asset_media_events e
    WHERE (e.site_id, e.target_id, e.version) = (NEW.site_id, NEW.id, NEW.version)
  ) THEN
    RAISE EXCEPTION 'An equipment media revision requires a history event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asset_media_target_requires_event AFTER UPDATE ON public.asset_media_targets
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_asset_media_event();
--> statement-breakpoint
CREATE FUNCTION public.guard_asset_media_event() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.asset_media_targets target
      WHERE (target.site_id, target.id, target.version) = (NEW.site_id, NEW.target_id, NEW.version)
        AND (target.target_type = 'asset' OR NEW.kind IS DISTINCT FROM 'document')
    ) THEN
      RAISE EXCEPTION 'Equipment media must match its target revision and supported kind' USING ERRCODE = '23514';
    END IF;

    IF NEW.type = 'cover_changed' AND NEW.file_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.asset_media_events photo
      WHERE (photo.site_id, photo.target_id, photo.id) = (NEW.site_id, NEW.target_id, NEW.file_id)
        AND photo.type = 'uploaded' AND photo.kind = 'photo' AND photo.version < NEW.version
    ) THEN
      RAISE EXCEPTION 'A cover must select a previously uploaded photo on the same equipment target' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL
    AND NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Equipment media events are append-only' USING ERRCODE = '23514';
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_media_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.asset_media_events
FOR EACH ROW EXECUTE FUNCTION public.guard_asset_media_event();
--> statement-breakpoint
CREATE FUNCTION public.guard_asset_media_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.asset_media_events e
    WHERE (e.site_id, e.target_id, e.id, e.actor_id) = (NEW.site_id, NEW.target_id, NEW.event_id, NEW.actor_id)
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL
    AND NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Equipment media receipts are append-only and require their original event' USING ERRCODE = '23514';
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_media_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON public.asset_media_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_asset_media_receipt();
--> statement-breakpoint
CREATE FUNCTION public.require_asset_media_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.asset_media_receipts receipt
    WHERE (receipt.site_id, receipt.target_id, receipt.event_id) = (NEW.site_id, NEW.target_id, NEW.id)
  ) THEN
    RAISE EXCEPTION 'An equipment media event requires a command receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER asset_media_event_requires_receipt AFTER INSERT ON public.asset_media_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_asset_media_receipt();
