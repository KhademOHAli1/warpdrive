-- PRIVATE UNNUMBERED ACTIVATION REHEARSAL. Do not run on an installed system.
-- Requires history-storage-dormant.sql in a fresh disposable canonical-prefix
-- database and a caller-owned, fresh session. Before BEGIN the fixture supplies
-- nonzero lock, statement and idle transaction timeouts and session row budgets:
-- warpdrive.analytics_activation_max_{pipelines,stages,deals}.
-- The bounds cannot grant authority or select individual CRM rows.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path = pg_catalog, pg_temp;

DO $$
BEGIN
  IF pg_catalog.current_setting('lock_timeout') = '0'
     OR pg_catalog.current_setting('statement_timeout') = '0'
     OR pg_catalog.current_setting('idle_in_transaction_session_timeout') = '0' THEN
    RAISE EXCEPTION 'analytics activation needs bounded lock, statement and idle transaction timeouts'
      USING ERRCODE = '55000';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('warpdrive:canonical-migrations')
  ) THEN
    RAISE EXCEPTION 'a canonical migration or activation is in progress'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Block source writers before freezing the empty ledger. All locks survive until
-- commit, including while the two baseline-write guards are locally disabled.
LOCK TABLE public.pipelines, public.stages, public.deals IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.analytics_history_coverage, public.analytics_history_events,
  public.analytics_history_heads, public.analytics_report_snapshots IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  pipeline_limit text := pg_catalog.current_setting('warpdrive.analytics_activation_max_pipelines', true);
  stage_limit text := pg_catalog.current_setting('warpdrive.analytics_activation_max_stages', true);
  deal_limit text := pg_catalog.current_setting('warpdrive.analytics_activation_max_deals', true);
BEGIN
  IF pipeline_limit IS NULL OR pipeline_limit !~ '^[0-9]{1,9}$'
    OR stage_limit IS NULL OR stage_limit !~ '^[0-9]{1,9}$'
    OR deal_limit IS NULL OR deal_limit !~ '^[0-9]{1,9}$' THEN
    RAISE EXCEPTION 'analytics activation needs valid per-source row budgets'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.analytics_history_coverage)
    OR EXISTS (SELECT 1 FROM public.analytics_history_events)
    OR EXISTS (SELECT 1 FROM public.analytics_history_heads)
    OR EXISTS (SELECT 1 FROM public.analytics_report_snapshots) THEN
    RAISE EXCEPTION 'analytics activation requires a fresh dormant ledger'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid IN ('public.pipelines'::regclass, 'public.stages'::regclass, 'public.deals'::regclass)
      AND (tgname IN (
        'analytics_deals_capture', 'analytics_stages_capture', 'analytics_pipelines_capture',
        'analytics_deals_truncate_guard', 'analytics_stages_truncate_guard', 'analytics_pipelines_truncate_guard'
      ) OR tgfoid IN (
        'public.analytics_capture_row_change()'::regprocedure,
        'public.analytics_reject_source_truncate()'::regprocedure
      ))
  ) THEN
    RAISE EXCEPTION 'analytics activation requires unattached source capture'
      USING ERRCODE = '55000';
  END IF;
  IF (
    WITH required(relation_name, trigger_name, function_name, trigger_type) AS (VALUES
      ('analytics_history_events', 'analytics_events_insert_guard', 'analytics_guard_event_insert', 7),
      ('analytics_history_events', 'analytics_events_mutation_guard', 'analytics_reject_immutable_mutation', 27),
      ('analytics_history_events', 'analytics_events_truncate_guard', 'analytics_reject_immutable_mutation', 34),
      ('analytics_history_heads', 'analytics_heads_mutation_guard', 'analytics_guard_head_mutation', 31),
      ('analytics_history_heads', 'analytics_heads_truncate_guard', 'analytics_guard_head_mutation', 34),
      ('analytics_history_coverage', 'analytics_coverage_mutation_guard', 'analytics_reject_immutable_mutation', 27),
      ('analytics_history_coverage', 'analytics_coverage_truncate_guard', 'analytics_reject_immutable_mutation', 34),
      ('analytics_report_snapshots', 'analytics_snapshots_insert_guard', 'analytics_guard_snapshot_insert', 7),
      ('analytics_report_snapshots', 'analytics_snapshots_mutation_guard', 'analytics_reject_immutable_mutation', 27),
      ('analytics_report_snapshots', 'analytics_snapshots_truncate_guard', 'analytics_reject_immutable_mutation', 34)
    )
    SELECT count(*) FROM required
    JOIN pg_catalog.pg_trigger t ON t.tgrelid = pg_catalog.to_regclass('public.' || required.relation_name)
      AND t.tgname = required.trigger_name AND t.tgenabled = 'A'
      AND t.tgfoid = pg_catalog.to_regprocedure('public.' || required.function_name || '()')
      AND t.tgtype = required.trigger_type AND t.tgqual IS NULL
      AND t.tgnargs = 0 AND t.tgattr = ''::int2vector
      AND NOT t.tgisinternal AND NOT t.tgdeferrable
  ) <> 10 THEN
    RAISE EXCEPTION 'analytics activation requires the dormant guard set'
      USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM public.pipelines LIMIT pipeline_limit::bigint + 1) source_rows) > pipeline_limit::bigint
    OR (SELECT count(*) FROM (SELECT 1 FROM public.stages LIMIT stage_limit::bigint + 1) source_rows) > stage_limit::bigint
    OR (SELECT count(*) FROM (SELECT 1 FROM public.deals LIMIT deal_limit::bigint + 1) source_rows) > deal_limit::bigint THEN
    RAISE EXCEPTION 'analytics activation exceeds its per-source row budgets'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE public.analytics_history_events DISABLE TRIGGER analytics_events_insert_guard;
ALTER TABLE public.analytics_history_heads DISABLE TRIGGER analytics_heads_mutation_guard;

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

ALTER TABLE public.analytics_history_events ENABLE ALWAYS TRIGGER analytics_events_insert_guard;
ALTER TABLE public.analytics_history_heads ENABLE ALWAYS TRIGGER analytics_heads_mutation_guard;

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

ALTER TABLE public.deals ENABLE ALWAYS TRIGGER analytics_deals_capture;
ALTER TABLE public.stages ENABLE ALWAYS TRIGGER analytics_stages_capture;
ALTER TABLE public.pipelines ENABLE ALWAYS TRIGGER analytics_pipelines_capture;
ALTER TABLE public.deals ENABLE ALWAYS TRIGGER analytics_deals_truncate_guard;
ALTER TABLE public.stages ENABLE ALWAYS TRIGGER analytics_stages_truncate_guard;
ALTER TABLE public.pipelines ENABLE ALWAYS TRIGGER analytics_pipelines_truncate_guard;

COMMIT;
