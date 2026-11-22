CREATE TABLE "inventory_release_export_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"issue" jsonb,
	"seal_purge_after" timestamp with time zone,
	"seal_purged_at" timestamp with time zone,
	CONSTRAINT "inventory_release_export_attempts_job_ordinal_key" UNIQUE("job_id","ordinal"),
	CONSTRAINT "inventory_release_export_attempts_state_check" CHECK ("inventory_release_export_attempts"."ordinal" > 0 AND
        ("inventory_release_export_attempts"."finished_at" IS NULL OR "inventory_release_export_attempts"."finished_at" >= "inventory_release_export_attempts"."started_at") AND
        ("inventory_release_export_attempts"."seal_purged_at" IS NULL OR "inventory_release_export_attempts"."seal_purged_at" >= "inventory_release_export_attempts"."seal_purge_after") AND
        CASE coalesce("inventory_release_export_attempts"."outcome", 'open')
          WHEN 'open' THEN "inventory_release_export_attempts"."finished_at" IS NULL AND "inventory_release_export_attempts"."issue" IS NULL AND "inventory_release_export_attempts"."seal_purge_after" IS NULL
          WHEN 'ready' THEN "inventory_release_export_attempts"."finished_at" IS NOT NULL AND "inventory_release_export_attempts"."issue" IS NULL AND "inventory_release_export_attempts"."seal_purge_after" IS NULL
          WHEN 'failed' THEN "inventory_release_export_attempts"."finished_at" IS NOT NULL AND "inventory_release_export_attempts"."issue" IS NOT NULL AND "inventory_release_export_attempts"."seal_purge_after" IS NOT NULL
          WHEN 'cancelled' THEN "inventory_release_export_attempts"."finished_at" IS NOT NULL AND "inventory_release_export_attempts"."issue" IS NOT NULL AND "inventory_release_export_attempts"."seal_purge_after" IS NOT NULL
          ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "inventory_release_export_files" (
	"job_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"artifact_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "inventory_release_export_files_pk" PRIMARY KEY("job_id","ordinal"),
	CONSTRAINT "inventory_release_export_files_artifact_key" UNIQUE("artifact_id"),
	CONSTRAINT "inventory_release_export_files_name_key" UNIQUE("job_id","name"),
	CONSTRAINT "inventory_release_export_files_header_check" CHECK ("inventory_release_export_files"."ordinal" BETWEEN 0 AND 15 AND length("inventory_release_export_files"."name") BETWEEN 1 AND 180
        AND "inventory_release_export_files"."kind" IN ('pcbFabrication','manufacturingBom','placement','enclosure','firmware','labelArtwork','testInstructions','pcbSource')
        AND "inventory_release_export_files"."sha256" ~ '^[0-9a-f]{64}$'
        AND "inventory_release_export_files"."content_type" IN ('application/zip','text/csv','text/plain','application/octet-stream','application/pdf','image/png')
        AND "inventory_release_export_files"."size_bytes" BETWEEN 1 AND CASE WHEN "inventory_release_export_files"."kind" = 'manufacturingBom'
          THEN 65536 ELSE 26214400 END)
);
--> statement-breakpoint
CREATE TABLE "inventory_release_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"revision" text NOT NULL,
	"submitted_by" uuid,
	"manifest" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"draft_fingerprint" text NOT NULL,
	"state" text DEFAULT 'staging' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staging_expires_at" timestamp with time zone NOT NULL,
	"queued_at" timestamp with time zone,
	"retry_until" timestamp with time zone,
	"active_attempt_id" uuid,
	"lease_until" timestamp with time zone,
	"failed_attempt_id" uuid,
	"published_at" timestamp with time zone,
	"staging_purge_after" timestamp with time zone,
	"staging_purged_at" timestamp with time zone,
	CONSTRAINT "inventory_release_export_jobs_header_check" CHECK ("inventory_release_export_jobs"."sku" ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'
        AND "inventory_release_export_jobs"."revision" ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'
        AND "inventory_release_export_jobs"."fingerprint" ~ '^[0-9a-f]{64}$'
        AND "inventory_release_export_jobs"."draft_fingerprint" ~ '^[0-9a-f]{64}$'
        AND "inventory_release_export_jobs"."staging_expires_at" > "inventory_release_export_jobs"."submitted_at"
        AND coalesce("inventory_release_export_jobs"."manifest"->>'schemaVersion' = '1', false)
        AND coalesce("inventory_release_export_jobs"."manifest"->'target'->>'sku' = "inventory_release_export_jobs"."sku", false)
        AND coalesce("inventory_release_export_jobs"."manifest"->'target'->>'revision' = "inventory_release_export_jobs"."revision", false)
        AND CASE WHEN jsonb_typeof("inventory_release_export_jobs"."manifest"->'files') = 'array'
          THEN jsonb_array_length("inventory_release_export_jobs"."manifest"->'files') BETWEEN 1 AND 16 ELSE false END),
	CONSTRAINT "inventory_release_export_jobs_state_check" CHECK (("inventory_release_export_jobs"."queued_at" IS NULL) = ("inventory_release_export_jobs"."retry_until" IS NULL)
        AND ("inventory_release_export_jobs"."retry_until" IS NULL OR "inventory_release_export_jobs"."retry_until" > "inventory_release_export_jobs"."queued_at")
        AND ("inventory_release_export_jobs"."active_attempt_id" IS NOT NULL) = ("inventory_release_export_jobs"."state" = 'working')
        AND ("inventory_release_export_jobs"."lease_until" IS NOT NULL) = ("inventory_release_export_jobs"."state" = 'working')
        AND ("inventory_release_export_jobs"."published_at" IS NOT NULL) = ("inventory_release_export_jobs"."state" = 'ready')
        AND ("inventory_release_export_jobs"."failed_attempt_id" IS NULL OR "inventory_release_export_jobs"."state" = 'failed')
        AND ("inventory_release_export_jobs"."staging_purged_at" IS NULL OR "inventory_release_export_jobs"."staging_purged_at" >= "inventory_release_export_jobs"."staging_purge_after")
        AND CASE "inventory_release_export_jobs"."state"
          WHEN 'staging' THEN "inventory_release_export_jobs"."queued_at" IS NULL AND "inventory_release_export_jobs"."staging_purge_after" IS NULL
          WHEN 'queued' THEN "inventory_release_export_jobs"."queued_at" IS NOT NULL AND "inventory_release_export_jobs"."staging_purge_after" IS NULL
          WHEN 'working' THEN "inventory_release_export_jobs"."queued_at" IS NOT NULL AND "inventory_release_export_jobs"."staging_purge_after" IS NULL
          WHEN 'ready' THEN "inventory_release_export_jobs"."queued_at" IS NOT NULL AND "inventory_release_export_jobs"."staging_purge_after" IS NOT NULL
          WHEN 'failed' THEN "inventory_release_export_jobs"."queued_at" IS NOT NULL AND
            ("inventory_release_export_jobs"."staging_purge_after" IS NULL) = ("inventory_release_export_jobs"."failed_attempt_id" IS NOT NULL)
          WHEN 'cancelled' THEN "inventory_release_export_jobs"."staging_purge_after" IS NOT NULL
          ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "inventory_release_export_requests" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"job_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_release_export_requests_pk" PRIMARY KEY("actor_id","request_id","kind"),
	CONSTRAINT "inventory_release_export_requests_header_check" CHECK ("inventory_release_export_requests"."kind" IN ('prepare','queue','retry') AND "inventory_release_export_requests"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_release_artifacts" DROP CONSTRAINT "inventory_release_artifacts_kind_check";--> statement-breakpoint
ALTER TABLE "inventory_release_export_attempts" ADD CONSTRAINT "inventory_release_export_attempts_job_id_inventory_release_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."inventory_release_export_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_export_files" ADD CONSTRAINT "inventory_release_export_files_job_id_inventory_release_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."inventory_release_export_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_export_jobs" ADD CONSTRAINT "inventory_release_export_jobs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_export_jobs" ADD CONSTRAINT "inventory_release_export_jobs_release_fk" FOREIGN KEY ("release_id","item_id") REFERENCES "public"."inventory_product_releases"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_export_requests" ADD CONSTRAINT "inventory_release_export_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_release_export_requests" ADD CONSTRAINT "inventory_release_export_requests_job_id_inventory_release_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."inventory_release_export_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_release_export_attempts_open_key" ON "inventory_release_export_attempts" USING btree ("job_id") WHERE "inventory_release_export_attempts"."outcome" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_release_export_attempts_ready_key" ON "inventory_release_export_attempts" USING btree ("job_id") WHERE "inventory_release_export_attempts"."outcome" = 'ready';--> statement-breakpoint
CREATE INDEX "inventory_release_export_attempts_purge_idx" ON "inventory_release_export_attempts" USING btree ("seal_purge_after","id") WHERE "inventory_release_export_attempts"."seal_purge_after" IS NOT NULL AND "inventory_release_export_attempts"."seal_purged_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_release_export_files_bom_key" ON "inventory_release_export_files" USING btree ("job_id") WHERE "inventory_release_export_files"."kind" = 'manufacturingBom';--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_release_export_jobs_live_fingerprint_key" ON "inventory_release_export_jobs" USING btree ("release_id","fingerprint") WHERE "inventory_release_export_jobs"."state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "inventory_release_export_jobs_history_idx" ON "inventory_release_export_jobs" USING btree ("release_id","submitted_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "inventory_release_export_jobs_queue_idx" ON "inventory_release_export_jobs" USING btree ("queued_at","id") WHERE "inventory_release_export_jobs"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "inventory_release_export_jobs_lease_idx" ON "inventory_release_export_jobs" USING btree ("lease_until","id") WHERE "inventory_release_export_jobs"."state" = 'working';--> statement-breakpoint
CREATE INDEX "inventory_release_export_jobs_staging_idx" ON "inventory_release_export_jobs" USING btree ("staging_expires_at","id") WHERE "inventory_release_export_jobs"."state" = 'staging';--> statement-breakpoint
CREATE INDEX "inventory_release_export_jobs_retry_idx" ON "inventory_release_export_jobs" USING btree ("retry_until","id") WHERE "inventory_release_export_jobs"."state" = 'failed' AND "inventory_release_export_jobs"."failed_attempt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_release_export_jobs_purge_idx" ON "inventory_release_export_jobs" USING btree ("staging_purge_after","id") WHERE "inventory_release_export_jobs"."staging_purge_after" IS NOT NULL AND "inventory_release_export_jobs"."staging_purged_at" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_release_artifacts" ADD CONSTRAINT "inventory_release_artifacts_kind_check" CHECK ("inventory_release_artifacts"."kind" IN ('pcbFabrication', 'manufacturingBom', 'placement', 'enclosure', 'firmware', 'labelArtwork', 'testInstructions', 'pcbSource')
        AND ("inventory_release_artifacts"."kind" <> 'pcbSource' OR "inventory_release_artifacts"."state" = 'ready'));
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_release_export_file() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE expected jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Engineering export file identities are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT j.manifest->'files'->NEW.ordinal INTO expected
    FROM public.inventory_release_export_jobs j
    WHERE j.id = NEW.job_id AND j.state = 'staging' FOR SHARE;
  IF expected IS DISTINCT FROM jsonb_build_object('name', NEW.name, 'kind', NEW.kind,
       'sizeBytes', NEW.size_bytes, 'sha256', NEW.sha256)
     OR strpos(NEW.name, '/') <> 0 OR strpos(NEW.name, chr(92)) <> 0 THEN
    RAISE EXCEPTION 'Engineering export file does not match the staged manifest' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_release_export_file_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory_release_export_files FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_release_export_file();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_release_export_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE parent public.inventory_release_export_jobs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Engineering export attempts cannot be removed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.job_id, NEW.ordinal, NEW.started_at) IS DISTINCT FROM
    (OLD.id, OLD.job_id, OLD.ordinal, OLD.started_at) THEN
    RAISE EXCEPTION 'Engineering export attempt identities are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT NULL THEN
    IF OLD.seal_purged_at IS NULL AND OLD.outcome <> 'ready' AND NEW.seal_purged_at IS NOT NULL
       AND NEW.seal_purged_at >= OLD.seal_purge_after
       AND (NEW.outcome, NEW.finished_at, NEW.issue, NEW.seal_purge_after) IS NOT DISTINCT FROM
         (OLD.outcome, OLD.finished_at, OLD.issue, OLD.seal_purge_after) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Settled engineering export attempts are immutable' USING ERRCODE = '23514';
  END IF;

  SELECT j.* INTO parent FROM public.inventory_release_export_jobs j WHERE j.id = NEW.job_id FOR SHARE;
  IF TG_OP = 'INSERT' THEN
    IF parent.state IS DISTINCT FROM 'queued' OR NEW.outcome IS NOT NULL OR NEW.seal_purged_at IS NOT NULL
       OR NEW.ordinal <> (SELECT coalesce(max(a.ordinal), 0) + 1
           FROM public.inventory_release_export_attempts a WHERE a.job_id = NEW.job_id) THEN
      RAISE EXCEPTION 'Engineering export attempt is outside its queued job' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF parent.state IS DISTINCT FROM 'working' OR parent.active_attempt_id IS DISTINCT FROM NEW.id
    OR NEW.outcome IS NULL OR NEW.seal_purged_at IS NOT NULL
    OR (NEW.outcome = 'ready' AND parent.lease_until <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Engineering export attempt may only settle while active' USING ERRCODE = '23514';
  END IF;
  IF NEW.issue IS NOT NULL AND (
       jsonb_typeof(NEW.issue) <> 'object'
       OR coalesce(NEW.issue->>'code', '') NOT IN ('manifest','wrongTarget','missingFile','extraFile',
         'duplicateFile','fileSize','fileType','hashMismatch','draftChanged','conflict','unavailable','temporary')
       OR NEW.issue - 'code' - 'file' <> '{}'::jsonb
       OR (NEW.issue ? 'file' AND NOT EXISTS (
         SELECT 1 FROM public.inventory_release_export_files f
         WHERE f.job_id = NEW.job_id AND to_jsonb(f.name) = NEW.issue->'file'
       ))
     ) THEN
    RAISE EXCEPTION 'Engineering export attempt issue is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_release_export_attempt_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory_release_export_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_release_export_attempt();
--> statement-breakpoint
CREATE FUNCTION public.require_inventory_release_export_lease() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE open_attempt uuid;
DECLARE actual_attempt uuid;
BEGIN
  SELECT a.id INTO open_attempt FROM public.inventory_release_export_attempts a
    WHERE a.job_id = NEW.job_id AND a.outcome IS NULL;
  SELECT j.active_attempt_id INTO actual_attempt FROM public.inventory_release_export_jobs j
    WHERE j.id = NEW.job_id;
  IF open_attempt IS DISTINCT FROM actual_attempt THEN
    RAISE EXCEPTION 'Engineering export open attempt requires its durable lease' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_release_export_attempt_lease_check AFTER INSERT OR UPDATE
ON public.inventory_release_export_attempts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_inventory_release_export_lease();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_release_export_job() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE latest public.inventory_release_export_attempts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Engineering export jobs are retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'staging' OR NEW.submitted_by IS NULL OR NEW.staging_purged_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.inventory_product_releases r
        JOIN public.inventory_items i ON i.id = r.item_id
        WHERE r.id = NEW.release_id AND r.item_id = NEW.item_id AND r.revision = NEW.revision
          AND r.status = 'draft' AND i.kind = 'product' AND i.sku = NEW.sku
      ) THEN
      RAISE EXCEPTION 'Engineering export must start against its exact draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.id, NEW.item_id, NEW.release_id, NEW.sku, NEW.revision, NEW.manifest, NEW.fingerprint,
      NEW.draft_fingerprint, NEW.submitted_at, NEW.staging_expires_at) IS DISTINCT FROM
     (OLD.id, OLD.item_id, OLD.release_id, OLD.sku, OLD.revision, OLD.manifest, OLD.fingerprint,
      OLD.draft_fingerprint, OLD.submitted_at, OLD.staging_expires_at)
     OR (NEW.submitted_by IS DISTINCT FROM OLD.submitted_by AND (NEW.submitted_by IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.submitted_by))) THEN
    RAISE EXCEPTION 'Engineering export identity and provenance are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = OLD.state THEN
    IF (NEW.queued_at, NEW.retry_until, NEW.active_attempt_id, NEW.lease_until, NEW.failed_attempt_id,
        NEW.published_at, NEW.staging_purge_after) IS DISTINCT FROM
       (OLD.queued_at, OLD.retry_until, OLD.active_attempt_id, OLD.lease_until, OLD.failed_attempt_id,
        OLD.published_at, OLD.staging_purge_after)
       OR (NEW.staging_purged_at IS DISTINCT FROM OLD.staging_purged_at AND
          (OLD.staging_purged_at IS NOT NULL OR NEW.staging_purged_at IS NULL
           OR OLD.staging_purge_after IS NULL OR NEW.staging_purged_at < OLD.staging_purge_after)) THEN
      RAISE EXCEPTION 'Engineering export progress requires a legal transition' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.staging_purged_at IS DISTINCT FROM OLD.staging_purged_at OR
     (OLD.state <> 'staging' AND (NEW.queued_at, NEW.retry_until) IS DISTINCT FROM (OLD.queued_at, OLD.retry_until)) OR
     NOT (CASE OLD.state
       WHEN 'staging' THEN NEW.state IN ('queued','cancelled')
       WHEN 'queued' THEN NEW.state IN ('working','cancelled')
       WHEN 'working' THEN NEW.state IN ('ready','failed','cancelled')
       WHEN 'failed' THEN OLD.failed_attempt_id IS NOT NULL AND NEW.state IN ('queued','cancelled')
       ELSE false END) THEN
    RAISE EXCEPTION 'Illegal engineering export state transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'staging' AND NEW.state = 'queued' AND (
      (NEW.queued_at IS NULL OR NEW.queued_at > OLD.staging_expires_at) OR NOT EXISTS (
        SELECT 1 FROM public.inventory_release_export_files f WHERE f.job_id = NEW.id
        HAVING count(*) = jsonb_array_length(NEW.manifest->'files') AND sum(f.size_bytes) <= 104857600
      )) THEN
    RAISE EXCEPTION 'Engineering export queue requires the complete registered bundle' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'failed' AND NEW.state = 'queued' AND clock_timestamp() >= OLD.retry_until THEN
    RAISE EXCEPTION 'Engineering export retry window has expired' USING ERRCODE = '23514';
  END IF;
  IF NEW.staging_purge_after IS NOT NULL AND NEW.staging_purge_after < OLD.staging_expires_at THEN
    RAISE EXCEPTION 'Engineering export purge precedes upload expiry' USING ERRCODE = '23514';
  END IF;

  SELECT a.* INTO latest FROM public.inventory_release_export_attempts a
    WHERE a.job_id = NEW.id ORDER BY a.ordinal DESC LIMIT 1;
  IF NEW.state = 'working' AND (latest.id IS DISTINCT FROM NEW.active_attempt_id
       OR latest.outcome IS NOT NULL OR NEW.lease_until <= latest.started_at) THEN
    RAISE EXCEPTION 'Engineering export lease must name the current open attempt' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'working' AND (latest.id IS DISTINCT FROM OLD.active_attempt_id
       OR latest.outcome IS DISTINCT FROM NEW.state) THEN
    RAISE EXCEPTION 'Engineering export job requires the exact settled attempt' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'failed' AND NEW.failed_attempt_id IS DISTINCT FROM
    (CASE WHEN latest.issue->>'code' = 'temporary' THEN latest.id ELSE NULL END) THEN
    RAISE EXCEPTION 'Engineering export may retry temporary failures only' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'ready' AND EXISTS (
    SELECT 1 FROM public.inventory_release_export_files f
    LEFT JOIN public.inventory_release_artifacts a ON a.id = f.artifact_id AND a.release_id = NEW.release_id
      AND a.state = 'ready' AND a.name = f.name AND a.kind = f.kind AND a.size_bytes = f.size_bytes
      AND a.content_type = f.content_type AND a.sha256 = f.sha256 AND a.created_by = NEW.submitted_by
      AND a.object_key = 'confirmed/inventory-release-artifacts/' || NEW.release_id::text || '/'
        || f.artifact_id::text || '/export-' || latest.id::text
    WHERE f.job_id = NEW.id AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Engineering export publication is missing exact ready artifacts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_release_export_job_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.inventory_release_export_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_release_export_job();
--> statement-breakpoint
CREATE FUNCTION public.guard_inventory_release_export_request() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.actor_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Engineering export request receipts are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_release_export_request_guard BEFORE UPDATE OR DELETE
ON public.inventory_release_export_requests FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_release_export_request();
