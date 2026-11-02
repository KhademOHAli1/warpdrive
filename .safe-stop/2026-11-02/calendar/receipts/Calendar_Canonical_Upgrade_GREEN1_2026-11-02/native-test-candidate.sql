ALTER TABLE "activities" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "event_time_zone" text;
--> statement-breakpoint
CREATE FUNCTION advance_activity_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_revision_before_update BEFORE UPDATE ON activities
FOR EACH ROW EXECUTE FUNCTION advance_activity_revision();

--> statement-breakpoint
CREATE TABLE "calendar_members" (
	"calendar_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "calendar_members_calendar_id_user_id_pk" PRIMARY KEY("calendar_id","user_id"),
	CONSTRAINT "calendar_member_role" CHECK ("calendar_members"."role" in ('freeBusy','reader','editor'))
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "event_visibility" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "availability" text DEFAULT 'busy' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_primary_owner" ON "calendars" USING btree ("owner_id") WHERE "calendars"."is_primary" = true;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_calendar_idx" ON "activities" USING btree ("calendar_id","due_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activity_event_visibility" CHECK ("activities"."event_visibility" in ('default','private'));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activity_availability" CHECK ("activities"."availability" in ('busy','free'));
--> statement-breakpoint
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

CREATE TABLE "activity_reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'assignment' NOT NULL,
	"use_default" boolean DEFAULT true NOT NULL,
	"rules" jsonb DEFAULT '{"timed":[{"method":"notification","minutesBefore":10},{"method":"email","minutesBefore":10}],"allDay":[{"method":"notification","daysBefore":0,"time":"09:00"},{"method":"email","daysBefore":0,"time":"09:00"}]}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"time_zone" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_reminder_source" CHECK ("activity_reminder_settings"."source" in ('assignment','personal'))
);
--> statement-breakpoint

CREATE TABLE "calendar_reminder_defaults" (
	"calendar_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rules" jsonb DEFAULT '{"timed":[{"method":"notification","minutesBefore":10},{"method":"email","minutesBefore":10}],"allDay":[{"method":"notification","daysBefore":0,"time":"09:00"},{"method":"email","daysBefore":0,"time":"09:00"}]}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_reminder_defaults_calendar_id_user_id_pk" PRIMARY KEY("calendar_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reminder_rebuilds" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"touched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "reminder_automation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "settings_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "settings_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "defaults_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "event_signature" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_settings" ADD CONSTRAINT "activity_reminder_settings_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reminder_settings" ADD CONSTRAINT "activity_reminder_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "calendar_reminder_defaults" ADD CONSTRAINT "calendar_reminder_defaults_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminder_defaults" ADD CONSTRAINT "calendar_reminder_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rebuilds" ADD CONSTRAINT "reminder_rebuilds_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_reminder_settings_user_idx" ON "activity_reminder_settings" USING btree ("activity_id","user_id");--> statement-breakpoint

ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_settings_id_activity_reminder_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."activity_reminder_settings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION calendar_queue_activity_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO reminder_rebuilds (activity_id, touched_at) VALUES (NEW.id, clock_timestamp())
  ON CONFLICT (activity_id) DO UPDATE SET touched_at = EXCLUDED.touched_at;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activities_reminder_rebuild_insert AFTER INSERT ON activities
FOR EACH ROW EXECUTE FUNCTION calendar_queue_activity_reminders();
--> statement-breakpoint
CREATE TRIGGER activities_reminder_rebuild_update AFTER UPDATE OF due_at, due_date, all_day,
  event_time_zone, calendar_id, assignee_id, done, deleted_at, reminder_automation_enabled ON activities
FOR EACH ROW WHEN (ROW(OLD.due_at, OLD.due_date, OLD.all_day, OLD.event_time_zone, OLD.calendar_id,
  OLD.assignee_id, OLD.done, OLD.deleted_at, OLD.reminder_automation_enabled) IS DISTINCT FROM
  ROW(NEW.due_at, NEW.due_date, NEW.all_day, NEW.event_time_zone, NEW.calendar_id,
  NEW.assignee_id, NEW.done, NEW.deleted_at, NEW.reminder_automation_enabled))
EXECUTE FUNCTION calendar_queue_activity_reminders();
--> statement-breakpoint
CREATE FUNCTION calendar_queue_personal_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.activity_id ELSE NEW.activity_id END;
  IF EXISTS (SELECT 1 FROM activities WHERE id = target_id) THEN
    INSERT INTO reminder_rebuilds (activity_id, touched_at) VALUES (target_id, clock_timestamp())
    ON CONFLICT (activity_id) DO UPDATE SET touched_at = EXCLUDED.touched_at;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER personal_reminders_rebuild AFTER INSERT OR UPDATE OR DELETE ON activity_reminder_settings
FOR EACH ROW EXECUTE FUNCTION calendar_queue_personal_reminders();
--> statement-breakpoint
CREATE FUNCTION calendar_queue_default_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_calendar uuid; target_user uuid;
BEGIN
  target_calendar := CASE WHEN TG_OP = 'DELETE' THEN OLD.calendar_id ELSE NEW.calendar_id END;
  target_user := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  INSERT INTO reminder_rebuilds (activity_id, touched_at)
  SELECT a.id, clock_timestamp() FROM activities a JOIN activity_reminder_settings s ON s.activity_id = a.id
  WHERE a.calendar_id = target_calendar AND s.user_id = target_user AND s.use_default = true
    AND a.done = false AND a.deleted_at IS NULL
  ON CONFLICT (activity_id) DO UPDATE SET touched_at = EXCLUDED.touched_at;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER calendar_defaults_rebuild AFTER INSERT OR UPDATE OR DELETE ON calendar_reminder_defaults
FOR EACH ROW EXECUTE FUNCTION calendar_queue_default_reminders();
--> statement-breakpoint

CREATE FUNCTION calendar_enqueue_acl_reminders(target_calendar uuid, target_user uuid)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO reminder_rebuilds (activity_id, touched_at)
  SELECT a.id, clock_timestamp() FROM activities a
  WHERE a.calendar_id = target_calendar
    AND (target_user IS NULL OR a.assignee_id = target_user OR EXISTS (
      SELECT 1 FROM activity_reminder_settings s
      WHERE s.activity_id = a.id AND s.user_id = target_user
    ))
  ORDER BY a.id
  ON CONFLICT (activity_id) DO UPDATE SET touched_at = EXCLUDED.touched_at;
$$;
--> statement-breakpoint
CREATE FUNCTION calendar_queue_membership_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.calendar_id, OLD.user_id, OLD.role)
      IS NOT DISTINCT FROM ROW(NEW.calendar_id, NEW.user_id, NEW.role) THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM calendar_enqueue_acl_reminders(OLD.calendar_id, OLD.user_id);
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND
      ROW(OLD.calendar_id, OLD.user_id) IS DISTINCT FROM ROW(NEW.calendar_id, NEW.user_id)) THEN
    PERFORM calendar_enqueue_acl_reminders(NEW.calendar_id, NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER calendar_members_reminders_rebuild AFTER INSERT OR UPDATE OR DELETE ON calendar_members
FOR EACH ROW EXECUTE FUNCTION calendar_queue_membership_reminders();
--> statement-breakpoint
CREATE FUNCTION calendar_queue_lifecycle_reminders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM calendar_enqueue_acl_reminders(NEW.id, NULL);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER calendars_reminders_rebuild AFTER UPDATE OF owner_id, time_zone, deleted_at ON calendars
FOR EACH ROW WHEN (ROW(OLD.owner_id, OLD.time_zone, OLD.deleted_at)
  IS DISTINCT FROM ROW(NEW.owner_id, NEW.time_zone, NEW.deleted_at))
EXECUTE FUNCTION calendar_queue_lifecycle_reminders();
--> statement-breakpoint
INSERT INTO reminder_rebuilds (activity_id)
SELECT id FROM activities WHERE calendar_id IS NOT NULL AND due_at > now()
  AND done = false AND deleted_at IS NULL
ON CONFLICT (activity_id) DO NOTHING;

--> statement-breakpoint
CREATE INDEX "activity_reminder_notification_idx" ON "activity_reminder_intents" USING btree ("notification_id");
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "reminder_authored_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_reminder_defaults" ADD COLUMN "rule_activations" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- ALTER holds the table lock through this migration transaction. Backfilling internal
-- reminder authorship must preserve the shared event's optimistic-edit revision.
ALTER TABLE activities DISABLE TRIGGER activity_revision_before_update;
--> statement-breakpoint
UPDATE activities SET reminder_authored_at = created_at;
--> statement-breakpoint
ALTER TABLE activities ENABLE TRIGGER activity_revision_before_update;
--> statement-breakpoint
CREATE FUNCTION calendar_stamp_reminder_authorship() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR ROW(OLD.due_at, OLD.due_date, OLD.all_day, OLD.event_time_zone,
      OLD.calendar_id, OLD.assignee_id, OLD.done, OLD.reminder_automation_enabled) IS DISTINCT FROM
      ROW(NEW.due_at, NEW.due_date, NEW.all_day, NEW.event_time_zone,
      NEW.calendar_id, NEW.assignee_id, NEW.done, NEW.reminder_automation_enabled) THEN
    NEW.reminder_authored_at := clock_timestamp();
  ELSE
    NEW.reminder_authored_at := OLD.reminder_authored_at;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER activity_reminder_authorship BEFORE INSERT OR UPDATE ON activities
FOR EACH ROW EXECUTE FUNCTION calendar_stamp_reminder_authorship();

--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "source" text DEFAULT 'native' NOT NULL;--> statement-breakpoint

ALTER TABLE "calendars" ADD CONSTRAINT "calendar_source" CHECK ("calendars"."source" in ('native','provider'));--> statement-breakpoint

ALTER TABLE activities ADD COLUMN reminder_engine text
NOT NULL DEFAULT 'legacy' CHECK (reminder_engine IN ('legacy','intent'));
