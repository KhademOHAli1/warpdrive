CREATE TABLE "asset_register_discovery_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"outcomes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_register_discovery_receipts_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "asset_register_discovery_receipts_kind_check" CHECK ("asset_register_discovery_receipts"."kind" IN ('batch', 'save_view', 'remove_view')),
	CONSTRAINT "asset_register_discovery_receipts_fingerprint_check" CHECK ("asset_register_discovery_receipts"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "asset_register_discovery_receipts_outcomes_check" CHECK (CASE WHEN "asset_register_discovery_receipts"."kind" = 'batch'
        THEN (CASE WHEN jsonb_typeof("asset_register_discovery_receipts"."outcomes") = 'array'
          THEN jsonb_array_length("asset_register_discovery_receipts"."outcomes") BETWEEN 1 AND 100 ELSE false END)
        ELSE "asset_register_discovery_receipts"."outcomes" IS NULL END)
);
--> statement-breakpoint
ALTER TABLE "asset_register_discovery_receipts" ADD CONSTRAINT "asset_register_discovery_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_register_discovery_receipts" ADD CONSTRAINT "asset_register_discovery_receipts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION public.guard_asset_register_view() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  site_text text;
  scoped_site uuid;
  scoped_category text;
  scoped_location text;
  revision text;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.target_entity IS DISTINCT FROM NEW.target_entity
    AND 'asset-register-view' IN (OLD.target_entity, NEW.target_entity) THEN
    RAISE EXCEPTION 'Equipment views keep their original filter type' USING ERRCODE = '23514';
  END IF;
  IF NEW.target_entity <> 'asset-register-view' THEN
    RETURN NEW;
  END IF;

  site_text := NEW.definition #>> '{settings,filters,site}';
  scoped_category := NEW.definition #>> '{settings,filters,category}';
  scoped_location := NEW.definition #>> '{settings,filters,location}';
  revision := NEW.definition ->> 'version';
  IF NEW.is_shared OR NEW.favorite
    OR char_length(btrim(NEW.name)) NOT BETWEEN 1 AND 80
    OR octet_length(NEW.definition::text) > 4096
    OR (NEW.definition -> 'schemaVersion') IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(NEW.definition -> 'version') IS DISTINCT FROM 'number'
    OR revision !~ '^[1-9][0-9]{0,15}$'
    OR site_text IS NULL OR site_text !~ uuid_pattern
    OR scoped_category IS NULL OR (scoped_category <> '' AND scoped_category !~ uuid_pattern)
    OR scoped_location IS NULL OR (scoped_location NOT IN ('', 'unassigned') AND scoped_location !~ uuid_pattern) THEN
    RAISE EXCEPTION 'Equipment views require a private bounded site definition' USING ERRCODE = '23514';
  END IF;

  scoped_site := site_text::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.directory_sites WHERE id = scoped_site) THEN
    RAISE EXCEPTION 'Equipment view site is unavailable' USING ERRCODE = '23514';
  END IF;
  IF scoped_category <> '' AND NOT EXISTS (
    SELECT 1 FROM public.asset_categories WHERE site_id = scoped_site AND id = NULLIF(scoped_category, '')::uuid
  ) THEN
    RAISE EXCEPTION 'Equipment view category belongs to a different site' USING ERRCODE = '23514';
  END IF;
  IF scoped_location NOT IN ('', 'unassigned') AND NOT EXISTS (
    SELECT 1 FROM public.directory_locations
    WHERE site_id = scoped_site AND id = NULLIF(NULLIF(scoped_location, ''), 'unassigned')::uuid
  ) THEN
    RAISE EXCEPTION 'Equipment view location belongs to a different site' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF revision <> '1' THEN
      RAISE EXCEPTION 'Equipment views start at version one' USING ERRCODE = '23514';
    END IF;
  ELSIF (NEW.id, NEW.owner_id, NEW.created_at, site_text)
    IS DISTINCT FROM (OLD.id, OLD.owner_id, OLD.created_at, OLD.definition #>> '{settings,filters,site}')
    OR revision::numeric <> (OLD.definition ->> 'version')::numeric + 1 THEN
    RAISE EXCEPTION 'Equipment views keep their owner and site and advance one version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_register_saved_view_guard BEFORE INSERT OR UPDATE ON public.saved_filters
FOR EACH ROW EXECUTE FUNCTION public.guard_asset_register_view();
--> statement-breakpoint
CREATE FUNCTION public.guard_asset_register_discovery_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.actor_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Equipment discovery receipts are append-only during the life of the account' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_register_discovery_receipt_guard BEFORE UPDATE OR DELETE ON public.asset_register_discovery_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_asset_register_discovery_receipt();
