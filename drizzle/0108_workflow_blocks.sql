ALTER TYPE "public"."notification_type" ADD VALUE 'workflow_message';--> statement-breakpoint
CREATE TABLE "workflow_v2_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"effect_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"request" jsonb NOT NULL,
	"output" jsonb,
	"error_id" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_v2_effect_execution_unique" UNIQUE("execution_id"),
	CONSTRAINT "workflow_v2_effect_key_unique" UNIQUE("effect_key"),
	CONSTRAINT "workflow_v2_effect_status" CHECK ("workflow_v2_effects"."status" IN ('prepared','claimed','applied','failed','unknown'))
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"visit_key" text NOT NULL,
	"frame_path" jsonb NOT NULL,
	"status" text NOT NULL,
	"output" jsonb,
	"error_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_v2_execution_visit_unique" UNIQUE("run_id","visit_key"),
	CONSTRAINT "workflow_v2_execution_status" CHECK ("workflow_v2_executions"."status" IN ('running','waiting','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_logic_functions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source_code" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_v2_function_positive_revision" CHECK ("workflow_v2_logic_functions"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_record_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_fields" jsonb NOT NULL,
	"origin_run_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"error_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "workflow_v2_record_event_status" CHECK ("workflow_v2_record_events"."status" IN ('pending','claimed','delivered','failed')),
	CONSTRAINT "workflow_v2_record_event_entity" CHECK ("workflow_v2_record_events"."entity" IN ('deal','lead','person','organization','activity'))
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"state" jsonb NOT NULL,
	"trigger" jsonb NOT NULL,
	"error_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_v2_run_request_unique" UNIQUE("workflow_id","actor_id","request_key"),
	CONSTRAINT "workflow_v2_run_status" CHECK ("workflow_v2_runs"."status" IN ('queued','running','waiting','succeeded','failed','cancelled')),
	CONSTRAINT "workflow_v2_run_mode" CHECK ("workflow_v2_runs"."mode" IN ('test','live'))
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_runtime_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"ai_base_url" text,
	"ai_api_key" "bytea",
	"ai_default_model" text,
	"ai_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_endpoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_v2_runtime_singleton" CHECK ("workflow_v2_runtime_settings"."id"=true)
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_trigger_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_v2_trigger_event_unique" UNIQUE("workflow_id","event_key")
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_v2_version_number_unique" UNIQUE("workflow_id","number"),
	CONSTRAINT "workflow_v2_version_identity_unique" UNIQUE("id","workflow_id"),
	CONSTRAINT "workflow_v2_version_positive" CHECK ("workflow_v2_versions"."number">0)
);
--> statement-breakpoint
CREATE TABLE "workflow_v2_waits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"responder_id" uuid,
	"wake_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"config" jsonb NOT NULL,
	"output" jsonb,
	"receipt_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resumed_at" timestamp with time zone,
	CONSTRAINT "workflow_v2_wait_execution_unique" UNIQUE("execution_id"),
	CONSTRAINT "workflow_v2_wait_kind" CHECK ("workflow_v2_waits"."kind" IN ('delay','form','event','chat')),
	CONSTRAINT "workflow_v2_wait_status" CHECK ("workflow_v2_waits"."status" IN ('open','resumed','expired','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflows_v2" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"draft" jsonb NOT NULL,
	"runtime_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_number" integer,
	"active" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_v2_revision_positive" CHECK ("workflows_v2"."revision">0),
	CONSTRAINT "workflows_v2_active_published" CHECK (NOT "workflows_v2"."active" OR ("workflows_v2"."published_number" IS NOT NULL AND "workflows_v2"."archived_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "workflow_v2_effects" ADD CONSTRAINT "workflow_v2_effects_run_id_workflow_v2_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_v2_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_effects" ADD CONSTRAINT "workflow_v2_effects_execution_id_workflow_v2_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_v2_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_executions" ADD CONSTRAINT "workflow_v2_executions_run_id_workflow_v2_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_v2_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_logic_functions" ADD CONSTRAINT "workflow_v2_logic_functions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_runs" ADD CONSTRAINT "workflow_v2_runs_workflow_id_workflows_v2_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows_v2"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_runs" ADD CONSTRAINT "workflow_v2_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_runs" ADD CONSTRAINT "workflow_v2_run_pinned_version" FOREIGN KEY ("version_id","workflow_id") REFERENCES "public"."workflow_v2_versions"("id","workflow_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_runtime_settings" ADD CONSTRAINT "workflow_v2_runtime_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_trigger_receipts" ADD CONSTRAINT "workflow_v2_trigger_receipts_workflow_id_workflows_v2_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows_v2"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_trigger_receipts" ADD CONSTRAINT "workflow_v2_trigger_receipts_version_id_workflow_v2_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_v2_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_trigger_receipts" ADD CONSTRAINT "workflow_v2_trigger_receipts_run_id_workflow_v2_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_v2_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_versions" ADD CONSTRAINT "workflow_v2_versions_workflow_id_workflows_v2_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows_v2"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_versions" ADD CONSTRAINT "workflow_v2_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_waits" ADD CONSTRAINT "workflow_v2_waits_run_id_workflow_v2_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_v2_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_waits" ADD CONSTRAINT "workflow_v2_waits_execution_id_workflow_v2_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_v2_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_v2_waits" ADD CONSTRAINT "workflow_v2_waits_responder_id_users_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_v2" ADD CONSTRAINT "workflows_v2_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_v2_function_revision_idx" ON "workflow_v2_logic_functions" USING btree ("family_id","revision");--> statement-breakpoint
CREATE INDEX "workflow_v2_record_event_pending_idx" ON "workflow_v2_record_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_v2_run_status_idx" ON "workflow_v2_runs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_v2_wait_due_idx" ON "workflow_v2_waits" USING btree ("status","wake_at","expires_at");--> statement-breakpoint
CREATE INDEX "workflows_v2_owner_idx" ON "workflows_v2" USING btree ("owner_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workflow_v2_capture_record_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entity_name text := TG_ARGV[0];
  action_name text;
  before_row jsonb;
  after_row jsonb;
  changed_fields jsonb;
  record_id uuid;
  origin_run uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    after_row := to_jsonb(NEW); record_id := NEW.id; action_name := 'created';
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NOT NULL THEN RETURN OLD; END IF;
    before_row := to_jsonb(OLD); record_id := OLD.id; action_name := 'deleted';
  ELSE
    before_row := to_jsonb(OLD); after_row := to_jsonb(NEW); record_id := NEW.id;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN action_name := 'deleted'; ELSE action_name := 'updated'; END IF;
    IF before_row = after_row THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflows_v2 w JOIN workflow_v2_versions v
      ON v.workflow_id = w.id AND v.number = w.published_number
    WHERE w.active AND w.archived_at IS NULL
      AND v.definition->'trigger'->'config'->>'objectName' = entity_name
      AND (v.definition->'trigger'->>'type' = 'record.' || action_name
        OR (action_name IN ('created','updated') AND v.definition->'trigger'->>'type' = 'record.created_or_updated'))
  ) AND NOT EXISTS (
    SELECT 1 FROM workflow_v2_waits q JOIN workflow_v2_runs r ON r.id=q.run_id
      JOIN workflows_v2 w ON w.id=r.workflow_id
    WHERE q.kind='event' AND q.status='open' AND r.status='waiting'
      AND w.active AND w.archived_at IS NULL
      AND q.config->>'eventName'=entity_name || '.' || action_name
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(key), '[]'::jsonb) INTO changed_fields
    FROM (SELECT key FROM jsonb_object_keys(coalesce(after_row,before_row)) AS key
      WHERE coalesce(before_row,'{}'::jsonb)->key IS DISTINCT FROM coalesce(after_row,'{}'::jsonb)->key) fields;
  BEGIN origin_run := nullif(current_setting('warpdrive.workflow_v2_run_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN origin_run := NULL; END;
  INSERT INTO workflow_v2_record_events(entity,record_id,event_name,before,after,changed_fields,origin_run_id,created_at)
    VALUES(entity_name,record_id,entity_name || '.' || action_name,before_row,after_row,changed_fields,origin_run,clock_timestamp());
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_v2_deal_events AFTER INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('deal');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_lead_events AFTER INSERT OR UPDATE OR DELETE ON leads FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('lead');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_person_events AFTER INSERT OR UPDATE OR DELETE ON persons FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('person');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_organization_events AFTER INSERT OR UPDATE OR DELETE ON organizations FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('organization');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_activity_events AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('activity');
--> statement-breakpoint
CREATE FUNCTION workflow_v2_reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published workflow and logic function revisions are immutable' USING ERRCODE = '23000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_v2_version_immutable BEFORE UPDATE OR DELETE ON workflow_v2_versions FOR EACH ROW EXECUTE FUNCTION workflow_v2_reject_revision_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_v2_function_immutable BEFORE UPDATE OR DELETE ON workflow_v2_logic_functions FOR EACH ROW EXECUTE FUNCTION workflow_v2_reject_revision_mutation();
