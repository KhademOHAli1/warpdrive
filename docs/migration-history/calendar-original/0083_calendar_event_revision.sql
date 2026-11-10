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
