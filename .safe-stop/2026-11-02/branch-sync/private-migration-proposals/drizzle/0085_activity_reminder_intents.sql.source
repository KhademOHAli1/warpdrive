CREATE TABLE "activity_reminder_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"notification_id" uuid,
	"email_enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_reminder_dispatch_idx" ON "activity_reminder_intents" USING btree ("state","fire_at");--> statement-breakpoint
CREATE INDEX "activity_reminder_activity_idx" ON "activity_reminder_intents" USING btree ("activity_id");
--> statement-breakpoint
INSERT INTO activity_reminder_intents (activity_id, assignee_id, due_at, fire_at)
SELECT id, assignee_id, due_at, due_at - interval '10 minutes'
FROM activities WHERE done = false AND deleted_at IS NULL AND due_at > now();
