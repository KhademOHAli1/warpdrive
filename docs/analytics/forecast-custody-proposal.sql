-- PRIVATE UNNUMBERED DISPOSABLE PROPOSAL. Apply after history-capture-proposal.sql.
-- Existing forecast-kind rows need an explicit adoption decision. This fails if any exist.
BEGIN;

ALTER TABLE public.analytics_report_snapshots
  ADD COLUMN forecast_request_key uuid,
  ADD COLUMN forecast_request_bytes text COLLATE pg_catalog."C",
  ADD COLUMN forecast_request_sha256 bytea,
  ADD COLUMN forecast_payload_bytes text COLLATE pg_catalog."C",
  ADD COLUMN forecast_payload_sha256 bytea,
  ADD COLUMN forecast_target_start timestamptz,
  ADD COLUMN forecast_target_end timestamptz,
  ADD COLUMN forecast_writer_xid pg_catalog.xid8,
  ADD COLUMN supersedes_forecast_id uuid,
  ADD COLUMN forecast_correction_reason text,
  ADD CONSTRAINT analytics_forecast_previous_fk FOREIGN KEY (supersedes_forecast_id)
    REFERENCES public.analytics_report_snapshots (id) ON DELETE RESTRICT,
  ADD CONSTRAINT analytics_forecast_custody_presence_ck CHECK (
    (kind = 'forecast'
      AND definition_version = 1
      AND forecast_request_key IS NOT NULL
      AND forecast_request_bytes IS NOT NULL
      AND forecast_request_sha256 IS NOT NULL
      AND forecast_payload_bytes IS NOT NULL
      AND forecast_payload_sha256 IS NOT NULL
      AND forecast_target_start IS NOT NULL
      AND forecast_target_end IS NOT NULL
      AND forecast_writer_xid IS NOT NULL
      AND event_high_water_ordinal IS NULL
      AND (
        (supersedes_forecast_id IS NULL AND forecast_correction_reason IS NULL)
        OR (supersedes_forecast_id IS NOT NULL AND supersedes_forecast_id <> id
          AND forecast_correction_reason IS NOT NULL
          AND pg_catalog.char_length(forecast_correction_reason) BETWEEN 1 AND 500
          AND forecast_correction_reason ~ '[^[:space:]]')
      ))
    OR
    (kind <> 'forecast'
      AND forecast_request_key IS NULL AND forecast_request_bytes IS NULL AND forecast_request_sha256 IS NULL
      AND forecast_payload_bytes IS NULL AND forecast_payload_sha256 IS NULL
      AND forecast_target_start IS NULL AND forecast_target_end IS NULL AND forecast_writer_xid IS NULL
      AND supersedes_forecast_id IS NULL AND forecast_correction_reason IS NULL)
  );

CREATE UNIQUE INDEX analytics_forecast_request_once_idx
  ON public.analytics_report_snapshots (created_by, forecast_request_key)
  WHERE kind = 'forecast';
CREATE UNIQUE INDEX analytics_forecast_one_successor_idx
  ON public.analytics_report_snapshots (supersedes_forecast_id)
  WHERE supersedes_forecast_id IS NOT NULL;

CREATE FUNCTION public.analytics_check_forecast_roster(
  roster jsonb, activation uuid, cut timestamptz, native_witness pg_catalog.pg_snapshot,
  selected_currency text
) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  members integer;
  distinct_members integer;
  open_members integer;
BEGIN
  SELECT count(*)::integer, count(DISTINCT d.id)::integer,
    (count(*) FILTER (WHERE d.status = 'open'))::integer
    INTO members, distinct_members, open_members
  FROM pg_catalog.jsonb_array_elements(roster) r(member)
  JOIN public.deals d ON d.id = (r.member->>'dealId')::uuid
  JOIN public.analytics_history_heads h ON h.entity_kind = 'deal' AND h.entity_id = d.id
    AND h.activation_id = activation AND h.active
  JOIN public.analytics_history_events tip ON tip.ordinal = h.last_event_ordinal
    AND tip.entity_kind = h.entity_kind AND tip.entity_id = h.entity_id
    AND tip.activation_id = h.activation_id AND tip.incarnation_id = h.incarnation_id
  WHERE d.currency = selected_currency AND d.archived_at IS NULL AND d.deleted_at IS NULL
    AND tip.observed_at <= cut AND tip.observed_at = h.last_observed_at
    AND tip.after_state = public.analytics_project_deal(d)
    AND pg_catalog.pg_visible_in_snapshot(tip.transaction_id::pg_catalog.xid8, native_witness)
    AND NOT EXISTS (
      SELECT 1 FROM public.analytics_history_events later
      WHERE later.entity_kind = h.entity_kind AND later.entity_id = h.entity_id
        AND later.activation_id = h.activation_id AND later.ordinal > h.last_event_ordinal
    )
    AND r.member = pg_catalog.jsonb_build_object(
      'dealId', d.id, 'incarnationId', h.incarnation_id, 'tipOrdinal', h.last_event_ordinal::text,
      'status', d.status, 'currency', d.currency, 'value', d.value::text,
      'expectedCloseDate', tip.after_state->'expectedCloseDate'
    );
  IF members <> pg_catalog.jsonb_array_length(roster) OR members <> distinct_members THEN
    RAISE EXCEPTION 'forecast roster disagrees with the captured deal tip' USING ERRCODE = '23514';
  END IF;
  RETURN open_members;
END;
$$;

CREATE FUNCTION public.analytics_check_forecast_scenario(
  contributors jsonb, roster jsonb, open_members integer
) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  matched integer;
  distinct_members integer;
BEGIN
  IF pg_catalog.jsonb_typeof(contributors) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'forecast scenario requires contributors' USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_array_length(contributors) <> open_members THEN
    RAISE EXCEPTION 'forecast scenario omits an open deal' USING ERRCODE = '23514';
  END IF;

  WITH roster_open AS MATERIALIZED (
    SELECT member FROM pg_catalog.jsonb_array_elements(roster) r(member)
    WHERE member->>'status' = 'open'
  )
  SELECT count(*)::integer, count(DISTINCT p.member->>'dealId')::integer
    INTO matched, distinct_members
  FROM pg_catalog.jsonb_array_elements(contributors) p(member)
  JOIN roster_open r ON r.member->>'dealId' = p.member->>'dealId'
    AND r.member->>'incarnationId' = p.member->>'incarnationId'
  WHERE p.member->'recordedValue' = r.member->'value'
    AND p.member->'recordedExpectedCloseDate' = r.member->'expectedCloseDate'
    AND pg_catalog.jsonb_typeof(p.member->'assumptions') = 'object'
    AND pg_catalog.jsonb_typeof(p.member->'expectedWonCount') IN ('string','null')
    AND pg_catalog.jsonb_typeof(p.member->'expectedWonValue') IN ('string','null');

  IF matched <> open_members OR distinct_members <> open_members THEN
    RAISE EXCEPTION 'forecast scenario disagrees with the saved open roster' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.analytics_guard_forecast_custody() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  payload jsonb;
  request jsonb;
  target jsonb;
  result jsonb;
  scenario text;
  open_members integer;
  previous public.analytics_report_snapshots%ROWTYPE;
BEGIN
  NEW.created_at := pg_catalog.clock_timestamp();
  IF NEW.forecast_target_start IS NULL OR NEW.forecast_target_end IS NULL
    OR NOT pg_catalog.isfinite(NEW.forecast_target_start) OR NOT pg_catalog.isfinite(NEW.forecast_target_end)
    OR NEW.forecast_target_start >= NEW.forecast_target_end
    OR NEW.cutoff_observed_at > NEW.created_at OR NEW.created_at >= NEW.forecast_target_start
    OR NOT EXISTS (
      SELECT 1 FROM public.analytics_history_coverage c
      WHERE c.id AND c.activation_id = NEW.activation_id AND c.activated_at <= NEW.cutoff_observed_at
    )
  THEN
    RAISE EXCEPTION 'forecast cutoff and save must precede a valid target' USING ERRCODE = '23514';
  END IF;
  IF NEW.time_zone !~ '^[A-Za-z]' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names zone
    WHERE pg_catalog.lower(zone.name) = pg_catalog.lower(NEW.time_zone)
  ) THEN
    RAISE EXCEPTION 'forecast requires a named reporting zone' USING ERRCODE = '23514';
  END IF;
  IF (NEW.target_from::timestamp AT TIME ZONE NEW.time_zone) IS DISTINCT FROM NEW.forecast_target_start
    OR (NEW.target_to_exclusive::timestamp AT TIME ZONE NEW.time_zone) IS DISTINCT FROM NEW.forecast_target_end
    OR (NEW.forecast_target_start AT TIME ZONE NEW.time_zone)::date IS DISTINCT FROM NEW.target_from
    OR (NEW.forecast_target_end AT TIME ZONE NEW.time_zone)::date IS DISTINCT FROM NEW.target_to_exclusive
  THEN
    RAISE EXCEPTION 'forecast target dates disagree with the resolved instants' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.users u WHERE u.id = NEW.created_by AND u.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forecast creator unavailable' USING ERRCODE = '42501';
  END IF;
  IF NEW.forecast_request_bytes IS NULL OR pg_catalog.octet_length(NEW.forecast_request_bytes) NOT BETWEEN 1 AND 65536
    OR NEW.forecast_payload_bytes IS NULL OR pg_catalog.octet_length(NEW.forecast_payload_bytes) NOT BETWEEN 1 AND 8388608
    OR pg_catalog.jsonb_typeof(NEW.records) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'forecast custody payload is missing or oversized' USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_array_length(NEW.records) > 5000 THEN
    RAISE EXCEPTION 'forecast roster exceeds the custody limit' USING ERRCODE = '23514';
  END IF;

  payload := NEW.forecast_payload_bytes::jsonb;
  request := NEW.forecast_request_bytes::jsonb;
  target := pg_catalog.jsonb_build_object(
    'from', public.analytics_history_utc(NEW.forecast_target_start),
    'toExclusive', public.analytics_history_utc(NEW.forecast_target_end),
    'timeZone', NEW.time_zone, 'calendar', NEW.calendar
  );
  result := payload->'result';
  IF pg_catalog.jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(request) IS DISTINCT FROM 'object'
    OR payload->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR payload->'request' IS DISTINCT FROM request
    OR payload->'activationId' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.activation_id)
    OR payload->'createdBy' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.created_by)
    OR payload->'nativeSnapshot' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.transaction_snapshot::text)
    OR payload->'roster' IS DISTINCT FROM NEW.records
    OR request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR request->'requestKey' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.forecast_request_key)
    OR request->'scope' IS DISTINCT FROM NEW.scope
    OR request->'target' IS DISTINCT FROM target
    OR request->'currency' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.currency)
    OR request->'reportDefinition' IS DISTINCT FROM NEW.report_definition
    OR request->'modelDefinition' IS DISTINCT FROM NEW.model_definition
    OR request->'modelVersion' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.model_version)
    OR request->'supersedesForecastId' IS DISTINCT FROM
      coalesce(pg_catalog.to_jsonb(NEW.supersedes_forecast_id), 'null'::jsonb)
    OR request->'correctionReason' IS DISTINCT FROM
      coalesce(pg_catalog.to_jsonb(NEW.forecast_correction_reason), 'null'::jsonb)
  THEN
    RAISE EXCEPTION 'forecast custody envelope disagrees with snapshot fields' USING ERRCODE = '23514';
  END IF;

  open_members := public.analytics_check_forecast_roster(
    NEW.records, NEW.activation_id, NEW.cutoff_observed_at, NEW.transaction_snapshot, NEW.currency
  );
  IF pg_catalog.jsonb_typeof(result) IS DISTINCT FROM 'object'
    OR result->'ok' IS DISTINCT FROM 'true'::jsonb
    OR result->'definitionVersion' IS DISTINCT FROM '1'::jsonb
    OR result->>'basis' IS DISTINCT FROM 'explicit-assumptions'
    OR result->'currency' IS DISTINCT FROM pg_catalog.to_jsonb(NEW.currency)
    OR result->'target' IS DISTINCT FROM target
    OR result->'cutoffObservedAt' IS DISTINCT FROM pg_catalog.to_jsonb(
      public.analytics_history_utc(NEW.cutoff_observed_at))
    OR result->'openDealCount' IS DISTINCT FROM pg_catalog.to_jsonb(open_members)
    OR result->'closedDealCount' IS DISTINCT FROM pg_catalog.to_jsonb(
      pg_catalog.jsonb_array_length(NEW.records) - open_members)
    OR pg_catalog.jsonb_typeof(result->'scenarios') IS DISTINCT FROM 'object'
    OR (result->'scenarios') - ARRAY['conservative','base','upside'] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'forecast result disagrees with the snapshot definition or roster' USING ERRCODE = '23514';
  END IF;
  FOREACH scenario IN ARRAY ARRAY['conservative','base','upside'] LOOP
    PERFORM public.analytics_check_forecast_scenario(
      result #> ARRAY['scenarios',scenario,'contributors'], NEW.records, open_members
    );
  END LOOP;

  NEW.forecast_writer_xid := pg_catalog.pg_current_xact_id();
  IF NEW.supersedes_forecast_id IS NOT NULL THEN
    SELECT s.* INTO previous FROM public.analytics_report_snapshots s
    WHERE s.id = NEW.supersedes_forecast_id AND s.kind = 'forecast';
    IF NOT FOUND OR previous.forecast_writer_xid = NEW.forecast_writer_xid
      OR NOT pg_catalog.pg_visible_in_snapshot(previous.forecast_writer_xid, NEW.transaction_snapshot)
      OR previous.created_at > NEW.cutoff_observed_at
      OR previous.cutoff_observed_at >= NEW.cutoff_observed_at
      OR ROW(previous.created_by, previous.activation_id, previous.scope, previous.report_definition,
        previous.currency, previous.time_zone, previous.calendar, previous.target_from,
        previous.target_to_exclusive, previous.forecast_target_start, previous.forecast_target_end)
        IS DISTINCT FROM
        ROW(NEW.created_by, NEW.activation_id, NEW.scope, NEW.report_definition, NEW.currency,
        NEW.time_zone, NEW.calendar, NEW.target_from, NEW.target_to_exclusive,
        NEW.forecast_target_start, NEW.forecast_target_end)
    THEN
      RAISE EXCEPTION 'forecast correction requires an earlier committed matching snapshot' USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.forecast_request_sha256 := pg_catalog.sha256(pg_catalog.convert_to(
    'warpdrive-forecast-request-v1' || E'\n' || NEW.forecast_request_bytes, 'UTF8'));
  NEW.forecast_payload_sha256 := pg_catalog.sha256(pg_catalog.convert_to(
    'warpdrive-forecast-payload-v1' || E'\n' || NEW.forecast_payload_bytes, 'UTF8'));
  -- This is the insert receipt time. An independent observation must still prove
  -- the transaction committed before target start for retrospective evaluation.
  NEW.created_at := pg_catalog.clock_timestamp();
  IF NEW.cutoff_observed_at > NEW.created_at OR NEW.created_at >= NEW.forecast_target_start THEN
    RAISE EXCEPTION 'forecast cutoff and save must precede a valid target' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger name sorts after analytics_snapshots_insert_guard. The base guard first validates
-- the current native witness and rejects pending source writes for all snapshot kinds.
CREATE TRIGGER analytics_snapshots_z_forecast_custody
  BEFORE INSERT ON public.analytics_report_snapshots FOR EACH ROW WHEN (NEW.kind = 'forecast')
  EXECUTE FUNCTION public.analytics_guard_forecast_custody();
ALTER TABLE public.analytics_report_snapshots ENABLE ALWAYS TRIGGER analytics_snapshots_z_forecast_custody;

REVOKE ALL ON FUNCTION public.analytics_check_forecast_roster(
  jsonb, uuid, timestamptz, pg_catalog.pg_snapshot, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_check_forecast_scenario(jsonb, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_guard_forecast_custody() FROM PUBLIC;

COMMIT;
