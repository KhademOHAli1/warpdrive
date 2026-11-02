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
