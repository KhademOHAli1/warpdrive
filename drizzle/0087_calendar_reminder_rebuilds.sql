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
INSERT INTO reminder_rebuilds (activity_id) SELECT id FROM activities
WHERE due_at > now() AND done = false AND deleted_at IS NULL
ON CONFLICT (activity_id) DO NOTHING;
