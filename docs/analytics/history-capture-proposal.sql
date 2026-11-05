-- PRIVATE UNNUMBERED PROPOSAL. Not a canonical migration or an installation claim.
-- Execute only as one transaction in a disposable qualified fixture. At canonical
-- admission the migration framework must own this same transaction boundary.
-- No historical migration/journal/snapshot or domain row is modified here.
BEGIN;

DO $$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'analytics capture installation requires fresh read committed source visibility'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Take all source locks before reading any baseline. Held through capture/guard commit.
LOCK TABLE public.pipelines, public.stages, public.deals IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.analytics_history_coverage (
  id boolean PRIMARY KEY DEFAULT true,
  activation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 2,
  activated_at timestamptz NOT NULL,
  activation_transaction_id text NOT NULL,
  baseline_snapshot pg_catalog.pg_snapshot NOT NULL,
  baseline_deal_count bigint NOT NULL,
  baseline_stage_count bigint NOT NULL,
  baseline_pipeline_count bigint NOT NULL,
  capture_semantics text NOT NULL DEFAULT 'database-row-observation-v1',
  CONSTRAINT analytics_history_coverage_singleton_ck CHECK (id),
  CONSTRAINT analytics_history_coverage_version_ck CHECK (schema_version = 2),
  CONSTRAINT analytics_history_coverage_transaction_ck CHECK (activation_transaction_id ~ '^[0-9]{1,20}$'),
  CONSTRAINT analytics_history_coverage_counts_ck CHECK (baseline_deal_count >= 0 AND baseline_stage_count >= 0 AND baseline_pipeline_count >= 0),
  CONSTRAINT analytics_history_coverage_semantics_ck CHECK (capture_semantics = 'database-row-observation-v1')
);
CREATE UNIQUE INDEX analytics_history_coverage_activation_uq ON public.analytics_history_coverage (activation_id);

CREATE TABLE public.analytics_history_events (
  ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  activation_id uuid NOT NULL,
  entity_kind text NOT NULL,
  entity_id uuid NOT NULL,
  incarnation_id uuid NOT NULL,
  event_kind text NOT NULL,
  schema_version smallint NOT NULL DEFAULT 2,
  transaction_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  observation_snapshot pg_catalog.pg_snapshot NOT NULL,
  before_state jsonb,
  after_state jsonb,
  before_write_version uuid,
  after_write_version uuid,
  actor_id uuid,
  command_id text,
  CONSTRAINT analytics_history_events_activation_fk FOREIGN KEY (activation_id) REFERENCES public.analytics_history_coverage (activation_id) ON DELETE RESTRICT,
  CONSTRAINT analytics_history_events_ordinal_ck CHECK (ordinal > 0),
  CONSTRAINT analytics_history_events_entity_ck CHECK (entity_kind IN ('deal','stage','pipeline')),
  CONSTRAINT analytics_history_events_kind_ck CHECK (event_kind IN ('baseline','insert','update','delete')),
  CONSTRAINT analytics_history_events_version_ck CHECK (schema_version = 2),
  CONSTRAINT analytics_history_events_transaction_ck CHECK (transaction_id ~ '^[0-9]{1,20}$'),
  CONSTRAINT analytics_history_events_projection_ck CHECK (
    (before_state IS NULL OR jsonb_typeof(before_state) = 'object') AND
    (after_state IS NULL OR jsonb_typeof(after_state) = 'object')
  ),
  CONSTRAINT analytics_history_events_shape_ck CHECK (
    (event_kind IN ('baseline','insert') AND before_state IS NULL AND after_state IS NOT NULL) OR
    (event_kind = 'update' AND before_state IS NOT NULL AND after_state IS NOT NULL AND before_state IS DISTINCT FROM after_state) OR
    (event_kind = 'delete' AND before_state IS NOT NULL AND after_state IS NULL)
  )
);
CREATE UNIQUE INDEX analytics_history_events_event_uq ON public.analytics_history_events (event_id);
CREATE INDEX analytics_history_events_entity_idx ON public.analytics_history_events (entity_kind, entity_id, incarnation_id, ordinal);
CREATE INDEX analytics_history_events_transaction_idx ON public.analytics_history_events (transaction_id, ordinal);
CREATE INDEX analytics_history_events_observed_idx ON public.analytics_history_events (activation_id, observed_at, ordinal);

CREATE TABLE public.analytics_history_heads (
  entity_kind text NOT NULL,
  entity_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  incarnation_id uuid NOT NULL,
  active boolean NOT NULL,
  last_event_ordinal bigint NOT NULL,
  last_write_version uuid,
  incarnation_started_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  CONSTRAINT analytics_history_heads_pkey PRIMARY KEY (entity_kind, entity_id),
  CONSTRAINT analytics_history_heads_activation_fk FOREIGN KEY (activation_id) REFERENCES public.analytics_history_coverage (activation_id) ON DELETE RESTRICT,
  CONSTRAINT analytics_history_heads_entity_ck CHECK (entity_kind IN ('deal','stage','pipeline')),
  CONSTRAINT analytics_history_heads_ordinal_ck CHECK (last_event_ordinal > 0)
);
CREATE UNIQUE INDEX analytics_history_heads_incarnation_uq ON public.analytics_history_heads (incarnation_id);

-- Snapshot INSERT requires a matching database observation. Deployment must restrict
-- INSERT to a trusted writer that establishes the fresh cut and validates the facts.
CREATE TABLE public.analytics_report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_id uuid NOT NULL,
  kind text NOT NULL,
  definition_version integer NOT NULL,
  report_definition jsonb NOT NULL,
  model_version text,
  model_definition jsonb,
  scope jsonb NOT NULL,
  currency text NOT NULL,
  time_zone text NOT NULL,
  calendar text NOT NULL,
  cutoff_observed_at timestamptz NOT NULL,
  transaction_snapshot pg_catalog.pg_snapshot NOT NULL,
  event_high_water_ordinal bigint,
  target_from date,
  target_to_exclusive date,
  records jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT analytics_report_snapshots_activation_fk FOREIGN KEY (activation_id) REFERENCES public.analytics_history_coverage (activation_id) ON DELETE RESTRICT,
  CONSTRAINT analytics_report_snapshots_kind_ck CHECK (kind IN ('pipeline-inventory','forecast')),
  CONSTRAINT analytics_report_snapshots_definition_ck CHECK (definition_version > 0),
  CONSTRAINT analytics_report_snapshots_currency_ck CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT analytics_report_snapshots_zone_ck CHECK (length(time_zone) BETWEEN 1 AND 100),
  CONSTRAINT analytics_report_snapshots_calendar_ck CHECK (calendar IN ('gregory','persian')),
  CONSTRAINT analytics_report_snapshots_json_ck CHECK (
    jsonb_typeof(report_definition) = 'object' AND jsonb_typeof(scope) = 'object' AND
    (model_definition IS NULL OR jsonb_typeof(model_definition) = 'object') AND jsonb_typeof(records) = 'array'
  ),
  CONSTRAINT analytics_report_snapshots_period_ck CHECK (
    (target_from IS NULL AND target_to_exclusive IS NULL) OR
    (target_from IS NOT NULL AND target_to_exclusive IS NOT NULL AND target_to_exclusive > target_from)
  ),
  CONSTRAINT analytics_report_snapshots_forecast_ck CHECK (
    kind <> 'forecast' OR (model_version IS NOT NULL AND length(model_version) > 0 AND
      model_definition IS NOT NULL AND target_from IS NOT NULL AND target_to_exclusive IS NOT NULL)
  ),
  CONSTRAINT analytics_report_snapshots_watermark_ck CHECK (event_high_water_ordinal IS NULL OR event_high_water_ordinal > 0)
);
CREATE INDEX analytics_report_snapshots_creator_idx ON public.analytics_report_snapshots (created_by, created_at, id);

CREATE FUNCTION public.analytics_history_utc(p_value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog AS $$
  SELECT pg_catalog.to_char(p_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

-- Version 2 records the fields required for observed sales history and current
-- authority. Deal labels, contact pointers and source/loss text stay in their own stores.
CREATE FUNCTION public.analytics_project_deal(p_row public.deals) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status', (p_row).status::text, 'value', (p_row).value::text, 'currency', (p_row).currency,
    'ownerId', (p_row).owner_id, 'pipelineId', (p_row).pipeline_id, 'stageId', (p_row).stage_id,
    'wonTime', public.analytics_history_utc((p_row).won_time),
    'lostTime', public.analytics_history_utc((p_row).lost_time),
    'expectedCloseDate', pg_catalog.to_char((p_row).expected_close_date, 'YYYY-MM-DD'),
    'archivedAt', public.analytics_history_utc((p_row).archived_at),
    'deletedAt', public.analytics_history_utc((p_row).deleted_at),
    'visibilityLevel', (p_row).visibility_level::text,
    'visibilityGroupId', (p_row).visibility_group_id, 'visibleToUserIds', (p_row).visible_to_user_ids
  )
$$;

CREATE FUNCTION public.analytics_project_stage(p_row public.stages) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog AS $$
  SELECT pg_catalog.jsonb_build_object('name', (p_row).name, 'order', (p_row)."order",
    'pipelineId', (p_row).pipeline_id, 'rottingDays', (p_row).rotting_days)
$$;

CREATE FUNCTION public.analytics_project_pipeline(p_row public.pipelines) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog AS $$
  SELECT pg_catalog.jsonb_build_object(
    'visibilityGroupId', (p_row).visibility_group_id, 'isArchived', (p_row).is_archived
  )
$$;

CREATE FUNCTION public.analytics_capture_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  entity_kind_value text;
  entity_id_value uuid;
  before_projection jsonb;
  after_projection jsonb;
  before_version uuid;
  after_version uuid;
  coverage public.analytics_history_coverage%ROWTYPE;
  head public.analytics_history_heads%ROWTYPE;
  head_exists boolean;
  incarnation uuid;
  started_at timestamptz;
  observation_at timestamptz;
  event_ordinal bigint;
BEGIN
  IF TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' OR TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION 'analytics capture requires its registered source row trigger' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'deals' THEN
    entity_kind_value := 'deal';
    IF TG_OP <> 'INSERT' THEN
      before_projection := public.analytics_project_deal(OLD);
      before_version := OLD.write_version;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      after_projection := public.analytics_project_deal(NEW);
      after_version := NEW.write_version;
    END IF;
  ELSIF TG_TABLE_NAME = 'stages' THEN
    entity_kind_value := 'stage';
    IF TG_OP <> 'INSERT' THEN before_projection := public.analytics_project_stage(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN after_projection := public.analytics_project_stage(NEW); END IF;
  ELSIF TG_TABLE_NAME = 'pipelines' THEN
    entity_kind_value := 'pipeline';
    IF TG_OP <> 'INSERT' THEN before_projection := public.analytics_project_pipeline(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN after_projection := public.analytics_project_pipeline(NEW); END IF;
  ELSE
    RAISE EXCEPTION 'analytics capture source is unsupported' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'analytics record identity change requires explicit delete and insert' USING ERRCODE = '55000';
    END IF;
    IF before_projection IS NOT DISTINCT FROM after_projection THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN entity_id_value := OLD.id; ELSE entity_id_value := NEW.id; END IF;

  SELECT * INTO coverage FROM public.analytics_history_coverage WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analytics history activation is missing' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO head FROM public.analytics_history_heads
    WHERE entity_kind = entity_kind_value AND entity_id = entity_id_value FOR UPDATE;
  head_exists := FOUND;

  IF TG_OP = 'INSERT' THEN
    IF head_exists THEN
      IF head.active THEN
        RAISE EXCEPTION 'analytics insertion has an active record incarnation' USING ERRCODE = '55000';
      END IF;
    END IF;
    incarnation := pg_catalog.gen_random_uuid();
  ELSE
    IF NOT head_exists THEN
      RAISE EXCEPTION 'analytics source has no baseline or captured incarnation' USING ERRCODE = '55000';
    END IF;
    IF NOT head.active OR head.activation_id <> coverage.activation_id THEN
      RAISE EXCEPTION 'analytics source incarnation is inactive or belongs to another activation' USING ERRCODE = '55000';
    END IF;
    incarnation := head.incarnation_id;
    started_at := head.incarnation_started_at;
  END IF;

  INSERT INTO public.analytics_history_events (
    activation_id, entity_kind, entity_id, incarnation_id, event_kind,
    schema_version, transaction_id, observed_at, observation_snapshot, before_state, after_state,
    before_write_version, after_write_version, actor_id, command_id
  ) VALUES (
    coverage.activation_id, entity_kind_value, entity_id_value, incarnation, pg_catalog.lower(TG_OP),
    coverage.schema_version, pg_catalog.pg_current_xact_id()::text, pg_catalog.clock_timestamp(), pg_catalog.pg_current_snapshot(), before_projection, after_projection,
    before_version, after_version, NULL, NULL
  ) RETURNING ordinal, observed_at INTO event_ordinal, observation_at;
  IF TG_OP = 'INSERT' THEN started_at := observation_at; END IF;

  INSERT INTO public.analytics_history_heads (
    entity_kind, entity_id, activation_id, incarnation_id, active, last_event_ordinal,
    last_write_version, incarnation_started_at, last_observed_at
  ) VALUES (
    entity_kind_value, entity_id_value, coverage.activation_id, incarnation, TG_OP <> 'DELETE', event_ordinal,
    after_version, started_at, observation_at
  ) ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
    activation_id = EXCLUDED.activation_id, incarnation_id = EXCLUDED.incarnation_id,
    active = EXCLUDED.active, last_event_ordinal = EXCLUDED.last_event_ordinal,
    last_write_version = EXCLUDED.last_write_version,
    incarnation_started_at = EXCLUDED.incarnation_started_at,
    last_observed_at = EXCLUDED.last_observed_at;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Existing row assertions are observations at activation, not past stage entries.
INSERT INTO public.analytics_history_coverage (
  id, activated_at, activation_transaction_id, baseline_snapshot,
  baseline_deal_count, baseline_stage_count, baseline_pipeline_count
) SELECT true, pg_catalog.clock_timestamp(), pg_catalog.pg_current_xact_id()::text,
  pg_catalog.pg_current_snapshot(),
  (SELECT count(*) FROM public.deals), (SELECT count(*) FROM public.stages), (SELECT count(*) FROM public.pipelines);

INSERT INTO public.analytics_history_events (
  activation_id, entity_kind, entity_id, incarnation_id, event_kind, transaction_id, observed_at, observation_snapshot, after_state
) SELECT c.activation_id, 'pipeline', p.id, pg_catalog.gen_random_uuid(), 'baseline',
  c.activation_transaction_id, c.activated_at, c.baseline_snapshot, public.analytics_project_pipeline(p)
  FROM public.pipelines p CROSS JOIN public.analytics_history_coverage c WHERE c.id ORDER BY p.id;
INSERT INTO public.analytics_history_events (
  activation_id, entity_kind, entity_id, incarnation_id, event_kind, transaction_id, observed_at, observation_snapshot, after_state
) SELECT c.activation_id, 'stage', s.id, pg_catalog.gen_random_uuid(), 'baseline',
  c.activation_transaction_id, c.activated_at, c.baseline_snapshot, public.analytics_project_stage(s)
  FROM public.stages s CROSS JOIN public.analytics_history_coverage c WHERE c.id ORDER BY s.id;
INSERT INTO public.analytics_history_events (
  activation_id, entity_kind, entity_id, incarnation_id, event_kind, transaction_id, observed_at, observation_snapshot, after_state, after_write_version
) SELECT c.activation_id, 'deal', d.id, pg_catalog.gen_random_uuid(), 'baseline',
  c.activation_transaction_id, c.activated_at, c.baseline_snapshot, public.analytics_project_deal(d), d.write_version
  FROM public.deals d CROSS JOIN public.analytics_history_coverage c WHERE c.id ORDER BY d.id;
INSERT INTO public.analytics_history_heads (
  entity_kind, entity_id, activation_id, incarnation_id, active, last_event_ordinal,
  last_write_version, incarnation_started_at, last_observed_at
) SELECT entity_kind, entity_id, activation_id, incarnation_id, true, ordinal,
  after_write_version, observed_at, observed_at FROM public.analytics_history_events;

DO $$
DECLARE
  coverage public.analytics_history_coverage%ROWTYPE;
BEGIN
  SELECT * INTO STRICT coverage FROM public.analytics_history_coverage WHERE id;
  IF (SELECT count(*) FROM public.analytics_history_events WHERE entity_kind = 'deal') <> coverage.baseline_deal_count
    OR (SELECT count(*) FROM public.analytics_history_events WHERE entity_kind = 'stage') <> coverage.baseline_stage_count
    OR (SELECT count(*) FROM public.analytics_history_events WHERE entity_kind = 'pipeline') <> coverage.baseline_pipeline_count
    OR (SELECT count(*) FROM public.analytics_history_heads) <>
      coverage.baseline_deal_count + coverage.baseline_stage_count + coverage.baseline_pipeline_count THEN
    RAISE EXCEPTION 'analytics baseline is incomplete' USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Install guards only after the locked, private baseline writes. They admit no public
-- bypass flag, maintenance GUC, fake actor or direct history INSERT route.
CREATE FUNCTION public.analytics_reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'analytics history and snapshots are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE FUNCTION public.analytics_guard_event_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  -- FK cascades or another registered source trigger can add nesting above two.
  -- A direct INSERT has only this guard at depth one and is rejected.
  IF pg_catalog.pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'analytics events require source capture' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.analytics_guard_head_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' OR pg_catalog.pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'analytics heads require source capture' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.analytics_guard_snapshot_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  own_xid pg_catalog.xid8 := pg_catalog.pg_current_xact_id_if_assigned();
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'repeatable read' THEN
    RAISE EXCEPTION 'analytics snapshot insert requires repeatable read' USING ERRCODE = '55000';
  END IF;
  -- pg_snapshot has a canonical output format but no native equality operator.
  IF (NEW.transaction_snapshot::text COLLATE pg_catalog."C")
       IS DISTINCT FROM (pg_catalog.pg_current_snapshot()::text COLLATE pg_catalog."C") THEN
    RAISE EXCEPTION 'analytics snapshot witness does not match the current observation' USING ERRCODE = '55000';
  END IF;
  IF NEW.cutoff_observed_at < pg_catalog.transaction_timestamp()
     OR NEW.cutoff_observed_at > pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'analytics snapshot cutoff is outside its capture transaction' USING ERRCODE = '55000';
  END IF;
  -- The active MVCC snapshot cannot represent this transaction's own pending source writes.
  IF own_xid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.analytics_history_events WHERE transaction_id = own_xid::text
  ) THEN
    RAISE EXCEPTION 'analytics snapshot insert cannot follow pending source writes' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.analytics_reject_source_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'source truncate bypasses analytics row capture' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER analytics_events_insert_guard BEFORE INSERT ON public.analytics_history_events
  FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_event_insert();
CREATE TRIGGER analytics_events_mutation_guard BEFORE UPDATE OR DELETE ON public.analytics_history_events
  FOR EACH ROW EXECUTE FUNCTION public.analytics_reject_immutable_mutation();
CREATE TRIGGER analytics_events_truncate_guard BEFORE TRUNCATE ON public.analytics_history_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_reject_immutable_mutation();
CREATE TRIGGER analytics_heads_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.analytics_history_heads
  FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_head_mutation();
CREATE TRIGGER analytics_heads_truncate_guard BEFORE TRUNCATE ON public.analytics_history_heads
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_guard_head_mutation();
CREATE TRIGGER analytics_coverage_mutation_guard BEFORE UPDATE OR DELETE ON public.analytics_history_coverage
  FOR EACH ROW EXECUTE FUNCTION public.analytics_reject_immutable_mutation();
CREATE TRIGGER analytics_coverage_truncate_guard BEFORE TRUNCATE ON public.analytics_history_coverage
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_reject_immutable_mutation();
CREATE TRIGGER analytics_snapshots_insert_guard BEFORE INSERT ON public.analytics_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_snapshot_insert();
CREATE TRIGGER analytics_snapshots_mutation_guard BEFORE UPDATE OR DELETE ON public.analytics_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.analytics_reject_immutable_mutation();
CREATE TRIGGER analytics_snapshots_truncate_guard BEFORE TRUNCATE ON public.analytics_report_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_reject_immutable_mutation();
CREATE TRIGGER analytics_deals_capture AFTER INSERT OR UPDATE OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.analytics_capture_row_change();
CREATE TRIGGER analytics_stages_capture AFTER INSERT OR UPDATE OR DELETE ON public.stages
  FOR EACH ROW EXECUTE FUNCTION public.analytics_capture_row_change();
CREATE TRIGGER analytics_pipelines_capture AFTER INSERT OR UPDATE OR DELETE ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.analytics_capture_row_change();
CREATE TRIGGER analytics_deals_truncate_guard BEFORE TRUNCATE ON public.deals
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_reject_source_truncate();
CREATE TRIGGER analytics_stages_truncate_guard BEFORE TRUNCATE ON public.stages
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_reject_source_truncate();
CREATE TRIGGER analytics_pipelines_truncate_guard BEFORE TRUNCATE ON public.pipelines
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_reject_source_truncate();

ALTER TABLE public.analytics_history_events ENABLE ALWAYS TRIGGER analytics_events_insert_guard;
ALTER TABLE public.analytics_history_events ENABLE ALWAYS TRIGGER analytics_events_mutation_guard;
ALTER TABLE public.analytics_history_events ENABLE ALWAYS TRIGGER analytics_events_truncate_guard;
ALTER TABLE public.analytics_history_heads ENABLE ALWAYS TRIGGER analytics_heads_mutation_guard;
ALTER TABLE public.analytics_history_heads ENABLE ALWAYS TRIGGER analytics_heads_truncate_guard;
ALTER TABLE public.analytics_history_coverage ENABLE ALWAYS TRIGGER analytics_coverage_mutation_guard;
ALTER TABLE public.analytics_history_coverage ENABLE ALWAYS TRIGGER analytics_coverage_truncate_guard;
ALTER TABLE public.analytics_report_snapshots ENABLE ALWAYS TRIGGER analytics_snapshots_insert_guard;
ALTER TABLE public.analytics_report_snapshots ENABLE ALWAYS TRIGGER analytics_snapshots_mutation_guard;
ALTER TABLE public.analytics_report_snapshots ENABLE ALWAYS TRIGGER analytics_snapshots_truncate_guard;
ALTER TABLE public.deals ENABLE ALWAYS TRIGGER analytics_deals_capture;
ALTER TABLE public.stages ENABLE ALWAYS TRIGGER analytics_stages_capture;
ALTER TABLE public.pipelines ENABLE ALWAYS TRIGGER analytics_pipelines_capture;
ALTER TABLE public.deals ENABLE ALWAYS TRIGGER analytics_deals_truncate_guard;
ALTER TABLE public.stages ENABLE ALWAYS TRIGGER analytics_stages_truncate_guard;
ALTER TABLE public.pipelines ENABLE ALWAYS TRIGGER analytics_pipelines_truncate_guard;

REVOKE ALL ON public.analytics_history_coverage, public.analytics_history_events,
  public.analytics_history_heads, public.analytics_report_snapshots FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.analytics_history_events_ordinal_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_capture_row_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_guard_snapshot_insert() FROM PUBLIC;

COMMIT;
