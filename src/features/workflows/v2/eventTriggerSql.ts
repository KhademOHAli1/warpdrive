// Root migration generation appends this SQL after the additive v2 tables. Kept
// as an exported source string so native regression fixtures use the exact trigger.
export const workflowV2RecordEventSql = `
CREATE OR REPLACE FUNCTION workflow_v2_capture_record_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entity_name text := TG_ARGV[0];
  action_name text;
  before_row jsonb;
  after_row jsonb;
  changed_fields jsonb;
  record_id uuid;
  origin_run uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    after_row := to_jsonb(NEW); record_id := NEW.id; action_name := 'created';
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NOT NULL THEN RETURN OLD; END IF;
    before_row := to_jsonb(OLD); record_id := OLD.id; action_name := 'deleted';
  ELSE
    before_row := to_jsonb(OLD); after_row := to_jsonb(NEW); record_id := NEW.id;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN action_name := 'deleted'; ELSE action_name := 'updated'; END IF;
    IF before_row = after_row THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflows_v2 w JOIN workflow_v2_versions v
      ON v.workflow_id = w.id AND v.number = w.published_number
    WHERE w.active AND w.archived_at IS NULL
      AND v.definition->'trigger'->'config'->>'objectName' = entity_name
      AND (v.definition->'trigger'->>'type' = 'record.' || action_name
        OR (action_name IN ('created','updated') AND v.definition->'trigger'->>'type' = 'record.created_or_updated'))
  ) AND NOT EXISTS (
    SELECT 1 FROM workflow_v2_waits q JOIN workflow_v2_runs r ON r.id=q.run_id
      JOIN workflows_v2 w ON w.id=r.workflow_id
    WHERE q.kind='event' AND q.status='open' AND r.status='waiting'
      AND w.active AND w.archived_at IS NULL
      AND q.config->>'eventName'=entity_name || '.' || action_name
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(key), '[]'::jsonb) INTO changed_fields
    FROM (SELECT key FROM jsonb_object_keys(coalesce(after_row,before_row)) AS key
      WHERE coalesce(before_row,'{}'::jsonb)->key IS DISTINCT FROM coalesce(after_row,'{}'::jsonb)->key) fields;
  BEGIN origin_run := nullif(current_setting('warpdrive.workflow_v2_run_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN origin_run := NULL; END;
  INSERT INTO workflow_v2_record_events(entity,record_id,event_name,before,after,changed_fields,origin_run_id,created_at)
    VALUES(entity_name,record_id,entity_name || '.' || action_name,before_row,after_row,changed_fields,origin_run,clock_timestamp());
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_v2_deal_events AFTER INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('deal');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_lead_events AFTER INSERT OR UPDATE OR DELETE ON leads FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('lead');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_person_events AFTER INSERT OR UPDATE OR DELETE ON persons FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('person');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_organization_events AFTER INSERT OR UPDATE OR DELETE ON organizations FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('organization');
--> statement-breakpoint
CREATE TRIGGER workflow_v2_activity_events AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION workflow_v2_capture_record_event('activity');
`;
