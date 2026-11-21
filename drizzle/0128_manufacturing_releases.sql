CREATE TABLE "inventory_build_releases" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"template_steps" jsonb NOT NULL,
	CONSTRAINT "inventory_build_releases_template_steps_check" CHECK (CASE WHEN jsonb_typeof("inventory_build_releases"."template_steps") = 'array' THEN jsonb_array_length("inventory_build_releases"."template_steps") BETWEEN 1 AND 10 ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "inventory_product_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"revision" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"bom" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "inventory_product_releases_item_revision_key" UNIQUE("item_id","revision"),
	CONSTRAINT "inventory_product_releases_id_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_product_releases_revision_check" CHECK ("inventory_product_releases"."revision" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'),
	CONSTRAINT "inventory_product_releases_status_check" CHECK (CASE "inventory_product_releases"."status"
        WHEN 'draft' THEN "inventory_product_releases"."approved_by" IS NULL AND "inventory_product_releases"."approved_at" IS NULL AND "inventory_product_releases"."bom" = '[]'::jsonb
        WHEN 'released' THEN "inventory_product_releases"."approved_by" IS NOT NULL AND "inventory_product_releases"."approved_at" IS NOT NULL AND
          CASE WHEN jsonb_typeof("inventory_product_releases"."bom") = 'array' THEN jsonb_array_length("inventory_product_releases"."bom") BETWEEN 1 AND 30 ELSE false END
        ELSE false
      END)
);
--> statement-breakpoint
CREATE TABLE "inventory_release_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"object_key" text NOT NULL,
	"etag" text,
	"sha256" text,
	"bom_entries" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "inventory_release_artifacts_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "inventory_release_artifacts_kind_check" CHECK ("inventory_release_artifacts"."kind" IN ('pcbFabrication', 'manufacturingBom', 'placement', 'enclosure', 'firmware', 'labelArtwork', 'testInstructions')),
	CONSTRAINT "inventory_release_artifacts_name_check" CHECK (length(btrim("inventory_release_artifacts"."name")) BETWEEN 1 AND 180),
	CONSTRAINT "inventory_release_artifacts_size_check" CHECK ("inventory_release_artifacts"."size_bytes" BETWEEN 1 AND 26214400),
	CONSTRAINT "inventory_release_artifacts_state_check" CHECK (CASE "inventory_release_artifacts"."state"
        WHEN 'pending' THEN "inventory_release_artifacts"."etag" IS NULL AND "inventory_release_artifacts"."sha256" IS NULL AND "inventory_release_artifacts"."bom_entries" IS NULL
        WHEN 'ready' THEN "inventory_release_artifacts"."etag" IS NOT NULL AND length("inventory_release_artifacts"."etag") > 0 AND
          "inventory_release_artifacts"."sha256" IS NOT NULL AND "inventory_release_artifacts"."sha256" ~ '^[0-9a-f]{64}$' AND
          CASE WHEN "inventory_release_artifacts"."kind" = 'manufacturingBom'
            THEN CASE WHEN jsonb_typeof("inventory_release_artifacts"."bom_entries") = 'array'
              THEN jsonb_array_length("inventory_release_artifacts"."bom_entries") BETWEEN 1 AND 30 ELSE false END
            ELSE "inventory_release_artifacts"."bom_entries" IS NULL
          END
        ELSE false
      END)
);
--> statement-breakpoint
CREATE TABLE "inventory_release_grants" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "inventory_release_grants_pkey" PRIMARY KEY("item_id","user_id"),
	CONSTRAINT "inventory_release_grants_role_check" CHECK ("inventory_release_grants"."role" IN ('editor', 'approver'))
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "release_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_orders" ADD CONSTRAINT "inventory_orders_id_item_key" UNIQUE("id","item_id");--> statement-breakpoint
ALTER TABLE "inventory_build_releases" ADD CONSTRAINT "inventory_build_releases_order_item_fk" FOREIGN KEY ("order_id","item_id") REFERENCES "public"."inventory_orders"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_build_releases" ADD CONSTRAINT "inventory_build_releases_release_item_fk" FOREIGN KEY ("release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_product_releases" ADD CONSTRAINT "inventory_product_releases_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_product_releases" ADD CONSTRAINT "inventory_product_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_product_releases" ADD CONSTRAINT "inventory_product_releases_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_artifacts" ADD CONSTRAINT "inventory_release_artifacts_release_fk" FOREIGN KEY ("release_id") REFERENCES "public"."inventory_product_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_artifacts" ADD CONSTRAINT "inventory_release_artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_grants" ADD CONSTRAINT "inventory_release_grants_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_grants" ADD CONSTRAINT "inventory_release_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_build_releases_release_idx" ON "inventory_build_releases" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "inventory_product_releases_active_idx" ON "inventory_product_releases" USING btree ("item_id","approved_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "inventory_product_releases"."status" = 'released';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_release_artifacts_ready_bom_key" ON "inventory_release_artifacts" USING btree ("release_id") WHERE "inventory_release_artifacts"."state" = 'ready' AND "inventory_release_artifacts"."kind" = 'manufacturingBom';--> statement-breakpoint
CREATE INDEX "inventory_release_artifacts_release_idx" ON "inventory_release_artifacts" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "inventory_release_grants_user_idx" ON "inventory_release_grants" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_release_required_check" CHECK (NOT "inventory_items"."release_required" OR "inventory_items"."kind" = 'product');
--> statement-breakpoint
CREATE FUNCTION "public"."inventory_guard_product_release"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Manufacturing releases must start as drafts' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION 'Approved manufacturing releases are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (OLD.id, OLD.item_id, OLD.revision, OLD.created_by, OLD.created_at)
    IS DISTINCT FROM (NEW.id, NEW.item_id, NEW.revision, NEW.created_by, NEW.created_at) THEN
    RAISE EXCEPTION 'Manufacturing release identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'released' AND (
    NOT EXISTS (
      SELECT 1 FROM "public"."inventory_release_artifacts"
      WHERE release_id = NEW.id AND state = 'ready' AND kind = 'pcbFabrication'
    ) OR NOT EXISTS (
      SELECT 1 FROM "public"."inventory_release_artifacts"
      WHERE release_id = NEW.id AND state = 'ready' AND kind = 'manufacturingBom'
    )
  ) THEN
    RAISE EXCEPTION 'Approval requires confirmed PCB fabrication and BOM files' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "inventory_product_releases_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_product_releases"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_product_release"();--> statement-breakpoint

CREATE FUNCTION "public"."inventory_guard_release_artifact"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_id uuid;
  parent_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.release_id IS DISTINCT FROM NEW.release_id THEN
    RAISE EXCEPTION 'Manufacturing release files cannot change package' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.state = 'pending' THEN RETURN OLD; END IF;
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.release_id ELSE NEW.release_id END;
  SELECT status INTO parent_status
    FROM "public"."inventory_product_releases" WHERE id = parent_id FOR SHARE;
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Approved manufacturing release files are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "inventory_release_artifacts_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_release_artifacts"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_release_artifact"();--> statement-breakpoint

CREATE FUNCTION "public"."inventory_guard_build_release"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Manufacturing release pins are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "public"."inventory_product_releases"
    WHERE id = NEW.release_id AND item_id = NEW.item_id AND status = 'released'
  ) OR NOT EXISTS (
    SELECT 1 FROM "public"."inventory_orders"
    WHERE id = NEW.order_id AND item_id = NEW.item_id AND build_quantity > 0
  ) THEN
    RAISE EXCEPTION 'A build pin requires an approved release for the same product' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "inventory_build_releases_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."inventory_build_releases"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_guard_build_release"();
