CREATE TABLE "asset_balances" (
	"asset_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "asset_balances_pkey" PRIMARY KEY("asset_id","location_id"),
	CONSTRAINT "asset_balances_quantity_check" CHECK ("asset_balances"."quantity" BETWEEN 1 AND 1000000)
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "asset_categories_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_categories_site_name_key" UNIQUE("site_id","name_key"),
	CONSTRAINT "asset_categories_name_check" CHECK (length(btrim("asset_categories"."name")) BETWEEN 1 AND 120 AND length(btrim("asset_categories"."name_key")) > 0),
	CONSTRAINT "asset_categories_fields_check" CHECK (CASE WHEN jsonb_typeof("asset_categories"."fields") = 'array' THEN jsonb_array_length("asset_categories"."fields") <= 32 ELSE false END),
	CONSTRAINT "asset_categories_version_check" CHECK ("asset_categories"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_command_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"focus_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_command_receipts_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "asset_command_receipts_fingerprint_check" CHECK ("asset_command_receipts"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "asset_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"from_location_id" uuid,
	"location_id" uuid,
	"quantity" integer,
	CONSTRAINT "asset_events_version_key" UNIQUE("asset_id","version"),
	CONSTRAINT "asset_events_version_check" CHECK ("asset_events"."version" > 0),
	CONSTRAINT "asset_events_kind_check" CHECK ("asset_events"."kind" IN ('created', 'updated', 'moved', 'restocked', 'consumed', 'adjusted', 'archived', 'reinstated', 'note')),
	CONSTRAINT "asset_events_reason_check" CHECK (length(btrim("asset_events"."reason")) BETWEEN 1 AND 400),
	CONSTRAINT "asset_events_quantity_check" CHECK ("asset_events"."quantity" BETWEEN -1000000 AND 1000000)
);
--> statement-breakpoint
CREATE TABLE "asset_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"code_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "asset_models_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_models_site_code_key" UNIQUE("site_id","code_key"),
	CONSTRAINT "asset_models_metadata_check" CHECK (length(btrim("asset_models"."code")) BETWEEN 1 AND 80 AND length(btrim("asset_models"."code_key")) > 0
        AND length(btrim("asset_models"."name")) BETWEEN 1 AND 120
        AND length(btrim("asset_models"."description")) BETWEEN 1 AND 1000),
	CONSTRAINT "asset_models_values_check" CHECK (jsonb_typeof("asset_models"."tags") = 'array' AND jsonb_typeof("asset_models"."field_values") = 'object'),
	CONSTRAINT "asset_models_version_check" CHECK ("asset_models"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"code_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tracking" text NOT NULL,
	"serial" text,
	"serial_key" text,
	"model_id" uuid,
	"location_id" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "asset_records_site_id_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_records_site_code_key" UNIQUE("site_id","code_key"),
	CONSTRAINT "asset_records_site_serial_key" UNIQUE("site_id","serial_key"),
	CONSTRAINT "asset_records_metadata_check" CHECK (length(btrim("asset_records"."code")) BETWEEN 1 AND 80 AND length(btrim("asset_records"."code_key")) > 0
        AND length(btrim("asset_records"."name")) BETWEEN 1 AND 120
        AND length(btrim("asset_records"."description")) BETWEEN 1 AND 1000),
	CONSTRAINT "asset_records_values_check" CHECK (jsonb_typeof("asset_records"."tags") = 'array' AND jsonb_typeof("asset_records"."field_values") = 'object'),
	CONSTRAINT "asset_records_tracking_check" CHECK ("asset_records"."tracking" = 'individual' OR ("asset_records"."tracking" IN ('returnable_pool', 'consumable_pool')
        AND "asset_records"."serial" IS NULL AND "asset_records"."model_id" IS NULL AND "asset_records"."location_id" IS NULL)),
	CONSTRAINT "asset_records_serial_check" CHECK (("asset_records"."serial" IS NULL) = ("asset_records"."serial_key" IS NULL)
        AND ("asset_records"."serial" IS NULL OR (
          length(btrim("asset_records"."serial")) BETWEEN 1 AND 80 AND length(btrim("asset_records"."serial_key")) > 0
        ))),
	CONSTRAINT "asset_records_version_check" CHECK ("asset_records"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "asset_balances" ADD CONSTRAINT "asset_balances_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_balances" ADD CONSTRAINT "asset_balances_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_command_receipts" ADD CONSTRAINT "asset_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_command_receipts" ADD CONSTRAINT "asset_command_receipts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_command_receipts" ADD CONSTRAINT "asset_command_receipts_focus_fk" FOREIGN KEY ("site_id","focus_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_fk" FOREIGN KEY ("site_id","asset_id") REFERENCES "public"."asset_records"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_source_location_fk" FOREIGN KEY ("site_id","from_location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_category_fk" FOREIGN KEY ("site_id","category_id") REFERENCES "public"."asset_categories"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_records" ADD CONSTRAINT "asset_records_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_records" ADD CONSTRAINT "asset_records_category_fk" FOREIGN KEY ("site_id","category_id") REFERENCES "public"."asset_categories"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_records" ADD CONSTRAINT "asset_records_model_fk" FOREIGN KEY ("site_id","model_id") REFERENCES "public"."asset_models"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_records" ADD CONSTRAINT "asset_records_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_balances_location_idx" ON "asset_balances" USING btree ("site_id","location_id");--> statement-breakpoint
CREATE INDEX "asset_events_site_asset_idx" ON "asset_events" USING btree ("site_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_models_category_idx" ON "asset_models" USING btree ("site_id","category_id");--> statement-breakpoint
CREATE INDEX "asset_records_category_idx" ON "asset_records" USING btree ("site_id","category_id");--> statement-breakpoint
CREATE INDEX "asset_records_model_idx" ON "asset_records" USING btree ("site_id","model_id");--> statement-breakpoint
CREATE INDEX "asset_records_active_location_idx" ON "asset_records" USING btree ("site_id","location_id") WHERE "asset_records"."archived_at" IS NULL;--> statement-breakpoint
CREATE FUNCTION "asset_records_guard_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.site_id, NEW.tracking) IS DISTINCT FROM (OLD.id, OLD.site_id, OLD.tracking)
      OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Asset identity and tracking are fixed and each edit advances the version'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.version <> 1 THEN
    RAISE EXCEPTION 'Asset records start at version one' USING ERRCODE = '23514';
  END IF;
  IF NEW.archived_at IS NULL AND (
    NOT EXISTS (SELECT 1 FROM directory_sites WHERE id = NEW.site_id AND NOT archived)
    OR (NEW.location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM directory_locations WHERE site_id = NEW.site_id
        AND id = NEW.location_id AND NOT archived
    ))
  ) THEN
    RAISE EXCEPTION 'Active equipment requires an active site and placement' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.archived_at IS NULL AND OLD.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM asset_balances balance
    JOIN directory_locations location ON (location.site_id, location.id) = (balance.site_id, balance.location_id)
    WHERE balance.asset_id = NEW.id AND location.archived
  ) THEN
    RAISE EXCEPTION 'A quantity pool cannot be reinstated in an archived bin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_records_guard_identity"
BEFORE INSERT OR UPDATE ON "asset_records"
FOR EACH ROW EXECUTE FUNCTION "asset_records_guard_identity"();
--> statement-breakpoint
CREATE FUNCTION "asset_balances_guard_pool"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM asset_records record
    JOIN directory_locations location ON (location.site_id, location.id) = (NEW.site_id, NEW.location_id)
    WHERE (record.site_id, record.id) = (NEW.site_id, NEW.asset_id)
      AND record.tracking IN ('returnable_pool', 'consumable_pool')
      AND record.archived_at IS NULL AND NOT location.archived
  ) THEN
    RAISE EXCEPTION 'Equipment balances require an active quantity pool and bin'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_balances_guard_pool"
BEFORE INSERT OR UPDATE ON "asset_balances"
FOR EACH ROW EXECUTE FUNCTION "asset_balances_guard_pool"();
--> statement-breakpoint
CREATE FUNCTION "asset_events_guard_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM asset_records
      WHERE id = NEW.asset_id AND site_id = NEW.site_id AND version = NEW.version
        AND ((NEW.version = 1) = (NEW.kind = 'created'))
    ) THEN
      RAISE EXCEPTION 'Asset events must describe the current version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL
    AND NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Asset event history is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "asset_events_guard_history"
BEFORE INSERT OR UPDATE OR DELETE ON "asset_events"
FOR EACH ROW EXECUTE FUNCTION "asset_events_guard_history"();
--> statement-breakpoint
CREATE FUNCTION "asset_records_require_event"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM asset_events WHERE asset_id = NEW.id AND version = NEW.version
  ) THEN
    RAISE EXCEPTION 'An asset version requires a history event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "asset_records_require_event"
AFTER INSERT OR UPDATE ON "asset_records" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "asset_records_require_event"();
