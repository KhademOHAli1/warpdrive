CREATE TABLE "workflow_run_failures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "node_id" text,
  "error_id" text NOT NULL,
  "failed_at" timestamp with time zone NOT NULL,
  "origin" text DEFAULT 'recorded' NOT NULL,
  "original_resume_at" timestamp with time zone,
  "retry_request_key" uuid,
  "retried_by" uuid,
  "retried_at" timestamp with time zone,
  CONSTRAINT "workflow_run_retry_request_unique" UNIQUE("retried_by", "retry_request_key"),
  CONSTRAINT "workflow_run_failure_retry_receipt_ck" CHECK (
    ("retry_request_key" IS NULL AND "retried_by" IS NULL AND "retried_at" IS NULL)
    OR ("retry_request_key" IS NOT NULL AND "retried_by" IS NOT NULL AND "retried_at" IS NOT NULL)),
  CONSTRAINT "workflow_run_failure_deadline_ck" CHECK ("original_resume_at" IS NULL OR isfinite("original_resume_at")),
  CONSTRAINT "workflow_run_failure_origin_ck" CHECK ("origin" IN ('recorded', 'legacy_snapshot')),
  CONSTRAINT "workflow_run_failure_times_ck" CHECK (isfinite("failed_at") AND ("retried_at" IS NULL OR isfinite("retried_at")))
);
--> statement-breakpoint
ALTER TABLE "workflow_run_failures" ADD CONSTRAINT "workflow_run_failures_run_id_workflow_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_run_failures" ADD CONSTRAINT "workflow_run_failures_retried_by_users_id_fk"
  FOREIGN KEY ("retried_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_open_failure_unique" ON "workflow_run_failures" USING btree ("run_id") WHERE "retried_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "workflow_run_failures_history_idx" ON "workflow_run_failures" USING btree ("run_id", "failed_at");
--> statement-breakpoint
-- These are snapshots of the actual stored failed state, not invented attempts or
-- historical event timestamps. No run, completed effect, output or cursor changes.
-- The old implementation erased failed-wait deadlines: never reconstruct one here.
INSERT INTO "workflow_run_failures" ("run_id", "node_id", "error_id", "failed_at", "origin")
SELECT "id", "next_node_id", "error_id", "updated_at", 'legacy_snapshot'
FROM "workflow_runs"
WHERE "status" = 'failed' AND "error_id" IS NOT NULL AND isfinite("updated_at");
