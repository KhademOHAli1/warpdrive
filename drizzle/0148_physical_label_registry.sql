CREATE TABLE "physical_label_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"command_type" text NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "physical_label_receipts_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "physical_label_receipts_fingerprint_check" CHECK ("physical_label_receipts"."fingerprint" COLLATE "C" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "physical_label_receipts_command_check" CHECK ("physical_label_receipts"."command_type" IN ('issue', 'registerExternal', 'retire'))
);
--> statement-breakpoint
CREATE TABLE "physical_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"asset_id" uuid,
	"kit_id" uuid,
	"position_id" uuid,
	"location_id" uuid,
	"item_id" uuid,
	"release_id" uuid,
	"supplier_offer_id" uuid,
	"source" text NOT NULL,
	"format" text NOT NULL,
	"value" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_by" uuid,
	"retired_at" timestamp with time zone,
	"retired_by" uuid,
	CONSTRAINT "physical_labels_target_check" CHECK (num_nonnulls(
            "physical_labels"."asset_id", "physical_labels"."kit_id", "physical_labels"."position_id", "physical_labels"."location_id",
            "physical_labels"."item_id", "physical_labels"."release_id", "physical_labels"."supplier_offer_id"
          ) = 1 AND "physical_labels"."target_id" IS NOT DISTINCT FROM CASE "physical_labels"."target_kind"
            WHEN 'asset' THEN "physical_labels"."asset_id"
            WHEN 'kit' THEN "physical_labels"."kit_id"
            WHEN 'stock_position' THEN "physical_labels"."position_id"
            WHEN 'location' THEN "physical_labels"."location_id"
            WHEN 'part' THEN "physical_labels"."item_id"
            WHEN 'release' THEN "physical_labels"."release_id"
            WHEN 'supplier_offer' THEN "physical_labels"."supplier_offer_id"
          END),
	CONSTRAINT "physical_labels_value_check" CHECK ("physical_labels"."format" IN ('qr', 'code128', 'code39', 'ean13', 'datamatrix', 'gs1_128', 'gs1_datamatrix')
          AND octet_length("physical_labels"."value") BETWEEN 1 AND 2048
          AND "physical_labels"."key" COLLATE "C" =
            (CASE WHEN "physical_labels"."format" IN ('gs1_128', 'gs1_datamatrix') THEN 'gs1:' ELSE 'text:' END)
            || "physical_labels"."value"),
	CONSTRAINT "physical_labels_source_check" CHECK (CASE "physical_labels"."source"
            WHEN 'internal' THEN
              "physical_labels"."format" = 'qr' AND "physical_labels"."value" COLLATE "C" ~ '^wd-label:v1:[A-Za-z0-9_-]{22}$'
            WHEN 'external' THEN left("physical_labels"."value", 12) COLLATE "C" <> 'wd-label:v1:'
            ELSE false
          END),
	CONSTRAINT "physical_labels_retirement_check" CHECK (CASE WHEN "physical_labels"."retired_at" IS NULL THEN "physical_labels"."retired_by" IS NULL
          ELSE "physical_labels"."retired_at" >= "physical_labels"."created_at" END)
);
--> statement-breakpoint
ALTER TABLE "physical_label_receipts" ADD CONSTRAINT "physical_label_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_label_receipts" ADD CONSTRAINT "physical_label_receipts_label_id_physical_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."physical_labels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_asset_id_asset_records_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_kit_id_asset_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."asset_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_position_id_inventory_stock_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."inventory_stock_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_location_id_directory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."directory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_release_id_inventory_product_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."inventory_product_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_supplier_offer_id_inventory_supplier_offers_id_fk" FOREIGN KEY ("supplier_offer_id") REFERENCES "public"."inventory_supplier_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_labels" ADD CONSTRAINT "physical_labels_retired_by_users_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "physical_label_receipts_label_idx" ON "physical_label_receipts" USING btree ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "physical_labels_key_uidx" ON "physical_labels" USING btree ("key" COLLATE "C");--> statement-breakpoint
CREATE UNIQUE INDEX "physical_labels_active_internal_uidx" ON "physical_labels" USING btree ("target_kind","target_id") WHERE "physical_labels"."source" = 'internal' AND "physical_labels"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "physical_labels_subject_idx" ON "physical_labels" USING btree ("target_kind","target_id","created_at");
--> statement-breakpoint
CREATE FUNCTION public.physical_labels_guard_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL OR NEW.retired_by IS NOT NULL OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Physical labels start active with an issuer';
    END IF;
    IF NEW.release_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inventory_product_releases release
      WHERE release.id = NEW.release_id AND release.status = 'released'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Release labels require an approved revision';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Issued physical label codes are retained';
  END IF;
  IF pg_trigger_depth() > 1 THEN
    IF OLD.created_by IS NOT NULL AND NEW.created_by IS NULL
      AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
      RETURN NEW;
    END IF;
    IF OLD.retired_by IS NOT NULL AND NEW.retired_by IS NULL
      AND (to_jsonb(NEW) - 'retired_by') = (to_jsonb(OLD) - 'retired_by') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL AND NEW.retired_by IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['retired_at', 'retired_by']) =
        (to_jsonb(OLD) - ARRAY['retired_at', 'retired_by']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A physical label can only be retired once';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER physical_labels_guard_identity
BEFORE INSERT OR UPDATE OR DELETE ON public.physical_labels
FOR EACH ROW EXECUTE FUNCTION public.physical_labels_guard_identity();
--> statement-breakpoint
CREATE FUNCTION public.physical_label_receipts_guard_history() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.physical_labels label
      WHERE label.id = NEW.label_id AND CASE NEW.command_type
        WHEN 'issue' THEN label.source = 'internal'
        WHEN 'registerExternal' THEN label.source = 'external' AND label.created_by = NEW.actor_id
        WHEN 'retire' THEN label.retired_at IS NOT NULL AND label.retired_by = NEW.actor_id
        ELSE false
      END
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Physical label receipt must match its command';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Physical label receipts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER physical_label_receipts_guard_history
BEFORE INSERT OR UPDATE OR DELETE ON public.physical_label_receipts
FOR EACH ROW EXECUTE FUNCTION public.physical_label_receipts_guard_history();
