ALTER TABLE "workflow_runs" ADD COLUMN "resume_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "workflow_runs"
  DROP CONSTRAINT "workflow_runs_status_ck",
  ADD CONSTRAINT "workflow_runs_status_ck"
    CHECK ("status" IN ('queued','running','waiting','succeeded','failed','cancelled')),
  ADD CONSTRAINT "workflow_runs_wait_state_ck"
    CHECK (
      ("status" = 'waiting' AND "resume_at" IS NOT NULL AND isfinite("resume_at") AND "next_node_id" IS NOT NULL)
      OR ("status" <> 'waiting' AND "resume_at" IS NULL)
    );
--> statement-breakpoint
CREATE INDEX "workflow_runs_wait_due_idx" ON "workflow_runs" USING btree ("resume_at","id") WHERE "status" = 'waiting';
