CREATE TABLE "activity_reminder_intents" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"generation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"managed" boolean DEFAULT false NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"event_time_zone" text,
	"reminder_time_zone" text,
	"selection" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL,
	"fire_at" timestamp with time zone,
	"status" text DEFAULT 'cancelled' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"attempt_version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_id" text,
	"outcome_reason" text,
	"outcome_at" timestamp with time zone,
	"notification_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "activity_reminder_intents_generation_key" UNIQUE("generation_id"),
	CONSTRAINT "activity_reminder_intents_version_ck" CHECK ("activity_reminder_intents"."version" = 1),
	CONSTRAINT "activity_reminder_intents_channel_ck" CHECK ("activity_reminder_intents"."channel" = 'in_app'),
	CONSTRAINT "activity_reminder_intents_status_ck" CHECK ("activity_reminder_intents"."status" IN ('pending', 'failed', 'delivered', 'suppressed', 'cancelled')),
	CONSTRAINT "activity_reminder_intents_attempt_count_ck" CHECK ("activity_reminder_intents"."attempt_count" >= 0),
	CONSTRAINT "activity_reminder_intents_selection_ck" CHECK (jsonb_typeof("activity_reminder_intents"."selection") = 'object'),
	CONSTRAINT "activity_reminder_intents_reason_ck" CHECK ("activity_reminder_intents"."outcome_reason" IS NULL OR "activity_reminder_intents"."outcome_reason" IN ('disabled', 'event_cancelled', 'event_finished', 'not_available', 'invalid_schedule', 'unsupported_parent')),
	CONSTRAINT "activity_reminder_intents_managed_ck" CHECK ("activity_reminder_intents"."managed" OR ("activity_reminder_intents"."status" = 'cancelled' AND "activity_reminder_intents"."fire_at" IS NULL)),
	CONSTRAINT "activity_reminder_intents_fire_ck" CHECK ("activity_reminder_intents"."status" NOT IN ('pending', 'failed', 'delivered') OR ("activity_reminder_intents"."fire_at" IS NOT NULL AND "activity_reminder_intents"."reminder_time_zone" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_reminder_intents_due_idx" ON "activity_reminder_intents" USING btree ("fire_at","next_attempt_at") WHERE "activity_reminder_intents"."managed" AND "activity_reminder_intents"."status" IN ('pending', 'failed');