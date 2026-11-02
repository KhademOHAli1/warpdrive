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
