CREATE TABLE "workflow_external_effects" (
	"attempt_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"iteration_index" smallint NOT NULL,
	"kind" text NOT NULL,
	"request_digest" text NOT NULL,
	"state" text DEFAULT 'started' NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"dispatch_authorized_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"output" jsonb,
	"error_id" text,
	CONSTRAINT "workflow_external_effect_identity_uq" UNIQUE("run_id","node_id","iteration_index","kind"),
	CONSTRAINT "workflow_external_effect_identity_ck" CHECK (
      "workflow_external_effects"."node_id" ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' AND "workflow_external_effects"."iteration_index" BETWEEN -1 AND 99
      AND length("workflow_external_effects"."kind") <= 64 AND "workflow_external_effects"."kind" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      AND "workflow_external_effects"."request_digest" ~ '^[0-9a-f]{64}$'
    ),
	CONSTRAINT "workflow_external_effect_state_ck" CHECK (
      ("workflow_external_effects"."state" = 'started' AND "workflow_external_effects"."finished_at" IS NULL AND "workflow_external_effects"."output" IS NULL AND "workflow_external_effects"."error_id" IS NULL)
      OR ("workflow_external_effects"."state" = 'complete' AND "workflow_external_effects"."finished_at" IS NOT NULL AND "workflow_external_effects"."dispatch_authorized_at" IS NOT NULL
        AND (("workflow_external_effects"."output" IS NOT NULL AND "workflow_external_effects"."error_id" IS NULL) OR ("workflow_external_effects"."output" IS NULL AND "workflow_external_effects"."error_id" IS NOT NULL)))
      OR ("workflow_external_effects"."state" = 'not_sent' AND "workflow_external_effects"."finished_at" IS NOT NULL AND "workflow_external_effects"."output" IS NULL AND "workflow_external_effects"."error_id" IS NOT NULL)
      OR ("workflow_external_effects"."state" = 'unknown' AND "workflow_external_effects"."finished_at" IS NOT NULL AND "workflow_external_effects"."dispatch_authorized_at" IS NOT NULL
        AND "workflow_external_effects"."output" IS NULL AND "workflow_external_effects"."error_id" IS NOT NULL)
    ),
	CONSTRAINT "workflow_external_effect_times_ck" CHECK (
      isfinite("workflow_external_effects"."started_at")
      AND ("workflow_external_effects"."dispatch_authorized_at" IS NULL OR (isfinite("workflow_external_effects"."dispatch_authorized_at") AND "workflow_external_effects"."dispatch_authorized_at" >= "workflow_external_effects"."started_at"))
      AND ("workflow_external_effects"."finished_at" IS NULL OR (isfinite("workflow_external_effects"."finished_at") AND "workflow_external_effects"."finished_at" >= coalesce("workflow_external_effects"."dispatch_authorized_at", "workflow_external_effects"."started_at")))
    ),
	CONSTRAINT "workflow_external_effect_output_ck" CHECK (
      ("workflow_external_effects"."error_id" IS NULL OR "workflow_external_effects"."error_id" ~ '^E_[A-Z0-9_]+$')
      AND ("workflow_external_effects"."output" IS NULL OR (jsonb_typeof("workflow_external_effects"."output") = 'object'
        AND octet_length("workflow_external_effects"."output"::text) <= 131072))
    )
);
--> statement-breakpoint
ALTER TABLE "workflow_steps" DROP CONSTRAINT "workflow_step_effect_unique";--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "iterator_frame" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "iteration_index" smallint DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "outcome" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "error_id" text;--> statement-breakpoint
ALTER TABLE "workflow_external_effects" ADD CONSTRAINT "workflow_external_effects_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_external_effect_started_idx" ON "workflow_external_effects" USING btree ("started_at","run_id") WHERE "workflow_external_effects"."state" = 'started';--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_step_effect_unique" UNIQUE("run_id","node_id","iteration_index");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_iterator_frame_ck" CHECK ("workflow_runs"."iterator_frame" IS NULL OR ("workflow_runs"."status" IN ('running','waiting') AND "workflow_runs"."next_node_id" IS NOT NULL AND jsonb_typeof("workflow_runs"."iterator_frame") = 'object'));--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_iteration_index_ck" CHECK ("workflow_steps"."iteration_index" BETWEEN -1 AND 99);--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_outcome_ck" CHECK (("workflow_steps"."outcome" = 'succeeded' AND "workflow_steps"."error_id" IS NULL) OR
        ("workflow_steps"."outcome" = 'failed' AND "workflow_steps"."iteration_index" >= 0 AND "workflow_steps"."error_id" IS NOT NULL AND "workflow_steps"."output" = '{}'::jsonb));