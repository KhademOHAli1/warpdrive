CREATE TABLE "asset_audit_assignments" (
	"audit_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "asset_audit_assignments_audit_id_participant_id_pk" PRIMARY KEY("audit_id","participant_id"),
	CONSTRAINT "asset_audit_assignments_order_key" UNIQUE("audit_id","position"),
	CONSTRAINT "asset_audit_assignments_value_check" CHECK ("asset_audit_assignments"."position" BETWEEN 0 AND 19 AND length(btrim("asset_audit_assignments"."name")) > 0
        AND ("asset_audit_assignments"."user_id" IS NULL OR "asset_audit_assignments"."user_id" = "asset_audit_assignments"."participant_id"))
);
--> statement-breakpoint
CREATE TABLE "asset_audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"row_id" uuid,
	"actor_id" uuid,
	"version" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "asset_audit_events_batch_key" UNIQUE("audit_id","version","ordinal"),
	CONSTRAINT "asset_audit_events_value_check" CHECK ("asset_audit_events"."version" > 0 AND "asset_audit_events"."ordinal" >= 0 AND jsonb_typeof("asset_audit_events"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "asset_audit_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"row_id" uuid,
	"actor_id" uuid,
	"actor" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_audit_evidence_object_key" UNIQUE("object_key"),
	CONSTRAINT "asset_audit_evidence_value_check" CHECK ("asset_audit_evidence"."source" IN ('camera','file') AND "asset_audit_evidence"."content_type" IN ('image/png','image/jpeg')
        AND "asset_audit_evidence"."size_bytes" BETWEEN 1 AND 10485760 AND "asset_audit_evidence"."sha256" ~ '^[0-9a-f]{64}$'
        AND length("asset_audit_evidence"."name") BETWEEN 1 AND 180)
);
--> statement-breakpoint
CREATE TABLE "asset_audit_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"site_id" uuid NOT NULL,
	"source_audit_id" uuid,
	"audit_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_audit_receipts_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "asset_audit_receipts_fingerprint_check" CHECK ("asset_audit_receipts"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "asset_audit_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"expected" integer,
	"counted" integer,
	"opaque_key" text,
	"identity" jsonb NOT NULL,
	CONSTRAINT "asset_audit_rows_scope_key" UNIQUE("site_id","audit_id","id"),
	CONSTRAINT "asset_audit_rows_position_key" UNIQUE("audit_id","position"),
	CONSTRAINT "asset_audit_rows_value_check" CHECK ("asset_audit_rows"."position" >= 0 AND ("asset_audit_rows"."expected" IS NULL OR "asset_audit_rows"."expected" > 0)
        AND ("asset_audit_rows"."counted" IS NULL OR "asset_audit_rows"."counted" BETWEEN 0 AND 1000000)
        AND ("asset_audit_rows"."opaque_key" IS NULL OR ("asset_audit_rows"."expected" IS NULL AND "asset_audit_rows"."opaque_key" ~ '^[0-9a-f]{64}$'))
        AND jsonb_typeof("asset_audit_rows"."identity") = 'object')
);
--> statement-breakpoint
CREATE TABLE "asset_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"scope" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "asset_audits_site_identity_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_audits_state_check" CHECK (
      "asset_audits"."version" > 0 AND length(btrim("asset_audits"."title")) BETWEEN 1 AND 120
      AND "asset_audits"."status" IN ('draft','active','completed','cancelled')
      AND ("asset_audits"."status" NOT IN ('active','completed') OR "asset_audits"."started_at" IS NOT NULL)
      AND ("asset_audits"."status" = 'completed') = ("asset_audits"."completed_at" IS NOT NULL)
      AND ("asset_audits"."reviewed_at" IS NULL OR "asset_audits"."status" = 'completed')
      AND (NOT "asset_audits"."archived" OR "asset_audits"."status" IN ('completed','cancelled'))
      AND jsonb_typeof("asset_audits"."scope") = 'object')
);
--> statement-breakpoint
ALTER TABLE "asset_audit_assignments" ADD CONSTRAINT "asset_audit_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_assignments" ADD CONSTRAINT "asset_audit_assignments_audit_fk" FOREIGN KEY ("site_id","audit_id") REFERENCES "public"."asset_audits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_events" ADD CONSTRAINT "asset_audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_events" ADD CONSTRAINT "asset_audit_events_audit_fk" FOREIGN KEY ("site_id","audit_id") REFERENCES "public"."asset_audits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_events" ADD CONSTRAINT "asset_audit_events_row_fk" FOREIGN KEY ("site_id","audit_id","row_id") REFERENCES "public"."asset_audit_rows"("site_id","audit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_evidence" ADD CONSTRAINT "asset_audit_evidence_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_evidence" ADD CONSTRAINT "asset_audit_evidence_audit_fk" FOREIGN KEY ("site_id","audit_id") REFERENCES "public"."asset_audits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_evidence" ADD CONSTRAINT "asset_audit_evidence_row_fk" FOREIGN KEY ("site_id","audit_id","row_id") REFERENCES "public"."asset_audit_rows"("site_id","audit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_receipts" ADD CONSTRAINT "asset_audit_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_receipts" ADD CONSTRAINT "asset_audit_receipts_result_fk" FOREIGN KEY ("site_id","audit_id") REFERENCES "public"."asset_audits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_receipts" ADD CONSTRAINT "asset_audit_receipts_source_fk" FOREIGN KEY ("site_id","source_audit_id") REFERENCES "public"."asset_audits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_rows" ADD CONSTRAINT "asset_audit_rows_audit_fk" FOREIGN KEY ("site_id","audit_id") REFERENCES "public"."asset_audits"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audits" ADD CONSTRAINT "asset_audits_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_audit_assignments_user_idx" ON "asset_audit_assignments" USING btree ("user_id","site_id","audit_id");--> statement-breakpoint
CREATE INDEX "asset_audit_evidence_audit_idx" ON "asset_audit_evidence" USING btree ("audit_id","at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_audit_rows_opaque_key" ON "asset_audit_rows" USING btree ("audit_id","opaque_key") WHERE "asset_audit_rows"."opaque_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_audits_site_created_idx" ON "asset_audits" USING btree ("site_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION guard_asset_audit_record() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'equipment audit history cannot be removed' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'draft' OR NEW.archived OR NEW.started_at IS NOT NULL THEN
      RAISE EXCEPTION 'equipment audits start as drafts' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version <> OLD.version + 1
      OR (NEW.id, NEW.site_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.site_id, OLD.created_at)
    THEN
      RAISE EXCEPTION 'equipment audit changes require the next version' USING ERRCODE = '23514';
    END IF;
    IF (OLD.status = 'draft' AND NEW.status NOT IN ('draft','active','cancelled'))
      OR (OLD.status = 'active' AND NEW.status NOT IN ('active','completed','cancelled'))
      OR (OLD.status IN ('completed','cancelled') AND NEW.status <> OLD.status)
    THEN
      RAISE EXCEPTION 'equipment audit phase cannot be reopened' USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'draft'
      AND (NEW.scope, NEW.title, NEW.due_at, NEW.started_at)
        IS DISTINCT FROM (OLD.scope, OLD.title, OLD.due_at, OLD.started_at)
    THEN
      RAISE EXCEPTION 'equipment audit scope is frozen at start' USING ERRCODE = '23514';
    END IF;
    IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR OLD.reviewed_at IS NOT NULL AND NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    THEN
      RAISE EXCEPTION 'equipment audit closure and review are final' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_audit_record_guard BEFORE INSERT OR UPDATE OR DELETE ON asset_audits
FOR EACH ROW EXECUTE FUNCTION guard_asset_audit_record();
--> statement-breakpoint
CREATE FUNCTION guard_asset_audit_finding() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'equipment audit findings cannot be removed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM asset_audits a WHERE a.site_id = NEW.site_id AND a.id = NEW.audit_id
      AND a.status = 'active' AND NOT a.archived
  ) THEN
    RAISE EXCEPTION 'equipment audit count requires an open audit' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'counted') IS DISTINCT FROM (to_jsonb(OLD) - 'counted')
  THEN
    RAISE EXCEPTION 'equipment audit expected identity and quantity are frozen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_audit_finding_guard BEFORE INSERT OR UPDATE OR DELETE ON asset_audit_rows
FOR EACH ROW EXECUTE FUNCTION guard_asset_audit_finding();
--> statement-breakpoint
CREATE FUNCTION guard_asset_audit_attribution() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'equipment audit evidence and activity are append-only' USING ERRCODE = '23514';
END
$$;
--> statement-breakpoint
CREATE TRIGGER asset_audit_event_guard BEFORE UPDATE OR DELETE ON asset_audit_events
FOR EACH ROW EXECUTE FUNCTION guard_asset_audit_attribution();
--> statement-breakpoint
CREATE TRIGGER asset_audit_receipt_guard BEFORE UPDATE OR DELETE ON asset_audit_receipts
FOR EACH ROW EXECUTE FUNCTION guard_asset_audit_attribution();
--> statement-breakpoint
CREATE TRIGGER asset_audit_evidence_guard BEFORE UPDATE OR DELETE ON asset_audit_evidence
FOR EACH ROW EXECUTE FUNCTION guard_asset_audit_attribution();
