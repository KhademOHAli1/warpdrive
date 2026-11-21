CREATE TABLE "internal_project_automation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_project_automation_events_kind_check" CHECK ("internal_project_automation_events"."kind" IN ('closed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "internal_project_automations" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"archive_after_months" integer DEFAULT 0 NOT NULL,
	"close_after_months" integer DEFAULT 0 NOT NULL,
	"close_state_id" uuid,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "internal_project_automations_months_check" CHECK ("internal_project_automations"."archive_after_months" BETWEEN 0 AND 12 AND "internal_project_automations"."close_after_months" BETWEEN 0 AND 12),
	CONSTRAINT "internal_project_automations_close_state_check" CHECK (("internal_project_automations"."close_after_months" = 0) = ("internal_project_automations"."close_state_id" IS NULL)),
	CONSTRAINT "internal_project_automations_revision_check" CHECK ("internal_project_automations"."revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "internal_project_estimate_points" (
	"project_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"scale_id" uuid NOT NULL,
	"value" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "internal_project_estimate_points_pk" PRIMARY KEY("project_id","id"),
	CONSTRAINT "internal_project_estimate_points_valid_check" CHECK (
    char_length(btrim("internal_project_estimate_points"."value")) BETWEEN 1 AND 20 AND
    char_length("internal_project_estimate_points"."description") <= 2000 AND "internal_project_estimate_points"."position" BETWEEN 0 AND 5
  )
);
--> statement-breakpoint
CREATE TABLE "internal_project_estimate_scales" (
	"project_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "internal_project_estimate_scales_pk" PRIMARY KEY("project_id","id"),
	CONSTRAINT "internal_project_estimate_scales_valid_check" CHECK (
    char_length(btrim("internal_project_estimate_scales"."name")) BETWEEN 1 AND 80 AND "internal_project_estimate_scales"."type" IN ('points', 'categories')
  )
);
--> statement-breakpoint
CREATE TABLE "internal_project_intake_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"create_intent_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"work_item_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_project_intake_request_intent_key" UNIQUE("project_id","requester_id","create_intent_id"),
	CONSTRAINT "internal_project_intake_request_title_check" CHECK (public.agency_project_title_valid("internal_project_intake_requests"."title")),
	CONSTRAINT "internal_project_intake_request_description_check" CHECK (char_length("internal_project_intake_requests"."description") <= 10000),
	CONSTRAINT "internal_project_intake_request_priority_check" CHECK ("internal_project_intake_requests"."priority" IN ('urgent', 'high', 'medium', 'low', 'none')),
	CONSTRAINT "internal_project_intake_request_status_check" CHECK ("internal_project_intake_requests"."status" IN ('pending', 'snoozed', 'accepted', 'declined', 'duplicate')),
	CONSTRAINT "internal_project_intake_request_revision_check" CHECK ("internal_project_intake_requests"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "internal_project_intake_request_review_check" CHECK (
    ("internal_project_intake_requests"."reviewed_by" IS NULL) = ("internal_project_intake_requests"."reviewed_at" IS NULL)
    AND ("internal_project_intake_requests"."status" = 'snoozed') = ("internal_project_intake_requests"."snoozed_until" IS NOT NULL)
    AND ("internal_project_intake_requests"."status" IN ('accepted', 'duplicate')) = ("internal_project_intake_requests"."work_item_id" IS NOT NULL)
    AND ("internal_project_intake_requests"."status" = 'pending' OR "internal_project_intake_requests"."reviewed_by" IS NOT NULL)
    AND ("internal_project_intake_requests"."withdrawn_at" IS NULL OR "internal_project_intake_requests"."status" IN ('pending', 'snoozed'))
  )
);
--> statement-breakpoint
CREATE TABLE "internal_project_item_estimates" (
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"point_id" uuid NOT NULL,
	CONSTRAINT "internal_project_item_estimates_pk" PRIMARY KEY("project_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "internal_project_item_labels" (
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"label_kind" text DEFAULT 'label' NOT NULL,
	CONSTRAINT "internal_project_item_labels_pk" PRIMARY KEY("project_id","item_id","label_id"),
	CONSTRAINT "internal_project_item_labels_label_kind_check" CHECK ("internal_project_item_labels"."label_kind" = 'label')
);
--> statement-breakpoint
CREATE TABLE "internal_project_labels" (
	"project_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"position" integer NOT NULL,
	CONSTRAINT "internal_project_labels_pk" PRIMARY KEY("project_id","id"),
	CONSTRAINT "internal_project_labels_assignment_key" UNIQUE("project_id","id","kind"),
	CONSTRAINT "internal_project_labels_kind_check" CHECK (("internal_project_labels"."kind" = 'group' AND "internal_project_labels"."parent_id" IS NULL) OR ("internal_project_labels"."kind" = 'label' AND "internal_project_labels"."parent_id" IS DISTINCT FROM "internal_project_labels"."id")),
	CONSTRAINT "internal_project_labels_content_check" CHECK (
    char_length(btrim("internal_project_labels"."name")) BETWEEN 1 AND 80 AND
    char_length("internal_project_labels"."description") <= 2000 AND
    "internal_project_labels"."color" ~ '^#[a-f0-9]{6}$' AND
    "internal_project_labels"."position" BETWEEN 0 AND 99
  )
);
--> statement-breakpoint
CREATE TABLE "internal_project_saved_view_favorites" (
	"user_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	CONSTRAINT "internal_project_saved_view_favorites_user_id_view_id_pk" PRIMARY KEY("user_id","view_id")
);
--> statement-breakpoint
CREATE TABLE "internal_project_structure_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"active_scale_id" uuid,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "internal_project_structure_settings_revision_check" CHECK ("internal_project_structure_settings"."revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_project_planning_groups" ADD COLUMN "rollover_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "internal_project_saved_views" ADD COLUMN "display" jsonb DEFAULT '{"groupBy":"state","orderBy":"manual","showEmptyGroups":false,"showAssignee":true,"showPriority":true,"showStartDate":true,"showDueDate":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_saved_views" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_settings" ADD COLUMN "intake_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_automation_events" ADD CONSTRAINT "internal_project_automation_events_item_fkey" FOREIGN KEY ("item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_automations" ADD CONSTRAINT "internal_project_automations_project_id_agency_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_automations" ADD CONSTRAINT "internal_project_automations_close_state_fkey" FOREIGN KEY ("project_id","close_state_id") REFERENCES "public"."internal_project_states"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_estimate_points" ADD CONSTRAINT "internal_project_estimate_points_scale_fk" FOREIGN KEY ("project_id","scale_id") REFERENCES "public"."internal_project_estimate_scales"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_estimate_scales" ADD CONSTRAINT "internal_project_estimate_scales_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_intake_requests" ADD CONSTRAINT "internal_project_intake_requests_project_id_agency_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_intake_requests" ADD CONSTRAINT "internal_project_intake_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_intake_requests" ADD CONSTRAINT "internal_project_intake_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_intake_requests" ADD CONSTRAINT "internal_project_intake_request_item_fk" FOREIGN KEY ("work_item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_estimates" ADD CONSTRAINT "internal_project_item_estimates_item_fk" FOREIGN KEY ("item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_estimates" ADD CONSTRAINT "internal_project_item_estimates_point_fk" FOREIGN KEY ("project_id","point_id") REFERENCES "public"."internal_project_estimate_points"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_labels" ADD CONSTRAINT "internal_project_item_labels_item_fk" FOREIGN KEY ("item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_labels" ADD CONSTRAINT "internal_project_item_labels_label_fk" FOREIGN KEY ("project_id","label_id","label_kind") REFERENCES "public"."internal_project_labels"("project_id","id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_labels" ADD CONSTRAINT "internal_project_labels_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_labels" ADD CONSTRAINT "internal_project_labels_parent_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."internal_project_labels"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_saved_view_favorites" ADD CONSTRAINT "internal_project_saved_view_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_saved_view_favorites" ADD CONSTRAINT "internal_project_saved_view_favorites_view_id_internal_project_saved_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."internal_project_saved_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_structure_settings" ADD CONSTRAINT "internal_project_structure_settings_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_structure_settings" ADD CONSTRAINT "internal_project_structure_settings_scale_fk" FOREIGN KEY ("project_id","active_scale_id") REFERENCES "public"."internal_project_estimate_scales"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_automation_events_project_idx" ON "internal_project_automation_events" USING btree ("project_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "internal_project_estimate_points_scale_idx" ON "internal_project_estimate_points" USING btree ("project_id","scale_id","position");--> statement-breakpoint
CREATE INDEX "internal_project_intake_request_queue_idx" ON "internal_project_intake_requests" USING btree ("project_id","status","created_at" DESC NULLS LAST,"id") WHERE "internal_project_intake_requests"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "internal_project_intake_request_reporter_idx" ON "internal_project_intake_requests" USING btree ("requester_id","project_id");--> statement-breakpoint
CREATE INDEX "internal_project_item_estimates_catalog_idx" ON "internal_project_item_estimates" USING btree ("project_id","point_id");--> statement-breakpoint
CREATE INDEX "internal_project_item_labels_catalog_idx" ON "internal_project_item_labels" USING btree ("project_id","label_id");--> statement-breakpoint
CREATE INDEX "internal_project_labels_parent_idx" ON "internal_project_labels" USING btree ("project_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "internal_project_saved_view_favorites_view_idx" ON "internal_project_saved_view_favorites" USING btree ("view_id");--> statement-breakpoint
-- Seed inactivity from the last committed work-item action. The historical schema
-- allowed out-of-band client rows, which do not participate in internal Projects.
UPDATE public.internal_project_items AS item
SET updated_at = greatest(
  item.created_at,
  coalesce(
    (SELECT max(event.recorded_at) FROM public.internal_project_item_events AS event WHERE event.item_id = item.id),
    item.created_at
  )
)
FROM public.agency_projects AS project
WHERE item.project_id = project.id
  AND project.kind = 'internal'
  AND item.state_id IS NOT NULL
  AND item.sequence_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "internal_project_items_active_age_idx" ON "internal_project_items" USING btree ("project_id","updated_at","id") WHERE "internal_project_items"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "internal_project_planning_groups" ADD CONSTRAINT "internal_project_planning_groups_rollover_check" CHECK ("internal_project_planning_groups"."rollover_snapshot" IS NULL OR ("internal_project_planning_groups"."kind" = 'cycles' AND jsonb_typeof("internal_project_planning_groups"."rollover_snapshot") = 'object'));--> statement-breakpoint
ALTER TABLE "internal_project_saved_views" ADD CONSTRAINT "internal_project_saved_views_display_check" CHECK (jsonb_typeof("internal_project_saved_views"."display") = 'object');