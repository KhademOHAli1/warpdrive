ALTER TABLE "workflow_steps" DROP CONSTRAINT "workflow_step_effect_unique";--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "iterator_frame" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "iteration_index" smallint DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "outcome" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD COLUMN "error_id" text;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_step_effect_unique" UNIQUE("run_id","node_id","iteration_index");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_iterator_frame_ck" CHECK ("workflow_runs"."iterator_frame" IS NULL OR ("workflow_runs"."status" IN ('running','waiting') AND "workflow_runs"."next_node_id" IS NOT NULL AND jsonb_typeof("workflow_runs"."iterator_frame") = 'object'));--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_iteration_index_ck" CHECK ("workflow_steps"."iteration_index" BETWEEN -1 AND 99);--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_outcome_ck" CHECK (("workflow_steps"."outcome" = 'succeeded' AND "workflow_steps"."error_id" IS NULL) OR
        ("workflow_steps"."outcome" = 'failed' AND "workflow_steps"."iteration_index" >= 0 AND "workflow_steps"."error_id" IS NOT NULL AND "workflow_steps"."output" = '{}'::jsonb));