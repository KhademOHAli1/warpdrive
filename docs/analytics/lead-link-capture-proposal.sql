-- PRIVATE UNNUMBERED DISPOSABLE PROPOSAL. No backfill, runtime grants or report route.
BEGIN;

-- Establish the start boundary before concurrent writers can change a lead pointer.
LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.analytics_lead_link_capture (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activation_id uuid NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
  activated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  activation_xid pg_catalog.xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id(),
  activation_snapshot pg_catalog.pg_snapshot NOT NULL DEFAULT pg_catalog.pg_current_snapshot(),
  stopped_at timestamptz
);

CREATE TABLE public.analytics_lead_link_events (
  ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activation_id uuid NOT NULL REFERENCES public.analytics_lead_link_capture (activation_id),
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  before_deal_id uuid REFERENCES public.deals (id) ON DELETE CASCADE,
  after_deal_id uuid REFERENCES public.deals (id) ON DELETE CASCADE,
  transaction_id pg_catalog.xid8 NOT NULL,
  observed_at timestamptz NOT NULL,
  observation_snapshot pg_catalog.pg_snapshot NOT NULL,
  CONSTRAINT analytics_lead_link_changed_ck CHECK (before_deal_id IS DISTINCT FROM after_deal_id)
);
CREATE INDEX analytics_lead_link_events_lead_idx ON public.analytics_lead_link_events (lead_id, ordinal);
CREATE INDEX analytics_lead_link_events_before_idx ON public.analytics_lead_link_events (before_deal_id)
  WHERE before_deal_id IS NOT NULL;
CREATE INDEX analytics_lead_link_events_after_idx ON public.analytics_lead_link_events (after_deal_id)
  WHERE after_deal_id IS NOT NULL;

CREATE FUNCTION public.analytics_capture_lead_link_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  activation uuid;
  stopped timestamptz;
BEGIN
  IF TG_RELID <> 'public.leads'::pg_catalog.regclass OR TG_OP <> 'UPDATE' OR TG_WHEN <> 'AFTER' THEN
    RAISE EXCEPTION 'lead link capture requires its native source trigger' USING ERRCODE = '55000';
  END IF;

  -- A retained-source erasure updates this row and waits for admitted captures.
  -- A writer with an earlier RR cut fails to lock an interveningly changed row.
  SELECT c.activation_id, c.stopped_at INTO activation, stopped
  FROM public.analytics_lead_link_capture c WHERE c.singleton FOR SHARE;
  IF NOT FOUND THEN
    -- A source transaction may hold an RR cut from before installation.
    RAISE EXCEPTION 'lead link writer must retry with a visible activation' USING ERRCODE = '40001';
  END IF;
  IF stopped IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.analytics_lead_link_events (
    activation_id, lead_id, before_deal_id, after_deal_id,
    transaction_id, observed_at, observation_snapshot
  ) VALUES (
    activation, NEW.id, OLD.converted_deal_id, NEW.converted_deal_id,
    pg_catalog.pg_current_xact_id(), pg_catalog.clock_timestamp(), pg_catalog.pg_current_snapshot()
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.analytics_guard_lead_link_events() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Nesting is a misuse check. The absence of runtime INSERT grants is the authority boundary.
  IF TG_OP = 'INSERT' AND pg_catalog.pg_trigger_depth() >= 2 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'lead link evidence requires source capture' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.analytics_guard_lead_link_capture_stop() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.stopped_at IS NOT NULL OR NEW.stopped_at IS NULL
    OR NEW.singleton IS DISTINCT FROM OLD.singleton
    OR NEW.activation_id IS DISTINCT FROM OLD.activation_id
    OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
    OR NEW.activation_xid IS DISTINCT FROM OLD.activation_xid
    OR NEW.activation_snapshot::text IS DISTINCT FROM OLD.activation_snapshot::text
  THEN
    RAISE EXCEPTION 'lead link capture can only stop once' USING ERRCODE = '55000';
  END IF;
  NEW.stopped_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

-- Internal owner-only rehearsal operation. No authorization, subject resolution or
-- hold check is inferred from the UUID arrays. A future privacy executor owns those.
-- Stop this generation before deleting so retained live records cannot recapture it.
CREATE FUNCTION public.analytics_erase_retained_lead_link_evidence(
  lead_keys uuid[], deal_keys uuid[]
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  removed bigint;
BEGIN
  -- After waiting for admitted writers, DELETE must acquire a new statement snapshot.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'lead link erasure requires read committed' USING ERRCODE = '55000';
  END IF;
  IF lead_keys IS NULL OR deal_keys IS NULL
    OR pg_catalog.cardinality(lead_keys)::bigint + pg_catalog.cardinality(deal_keys) NOT BETWEEN 1 AND 500
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(lead_keys) AS k(id) WHERE k.id IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(deal_keys) AS k(id) WHERE k.id IS NULL)
  THEN
    RAISE EXCEPTION 'lead link erasure requires bounded explicit keys' USING ERRCODE = '22023';
  END IF;

  UPDATE public.analytics_lead_link_capture SET stopped_at = pg_catalog.clock_timestamp()
  WHERE singleton AND stopped_at IS NULL;

  DELETE FROM public.analytics_lead_link_events
  WHERE lead_id = ANY(lead_keys) OR before_deal_id = ANY(deal_keys) OR after_deal_id = ANY(deal_keys);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

CREATE TRIGGER analytics_lead_link_source_change AFTER UPDATE ON public.leads
  FOR EACH ROW WHEN (
    OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
    AND OLD.converted_deal_id IS DISTINCT FROM NEW.converted_deal_id
  ) EXECUTE FUNCTION public.analytics_capture_lead_link_change();
CREATE TRIGGER analytics_lead_link_event_guard BEFORE INSERT OR UPDATE ON public.analytics_lead_link_events
  FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_lead_link_events();
CREATE TRIGGER analytics_lead_link_event_no_truncate BEFORE TRUNCATE ON public.analytics_lead_link_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_guard_lead_link_events();
CREATE TRIGGER analytics_lead_link_capture_stop BEFORE UPDATE ON public.analytics_lead_link_capture
  FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_lead_link_capture_stop();
CREATE TRIGGER analytics_lead_link_capture_no_delete BEFORE DELETE ON public.analytics_lead_link_capture
  FOR EACH ROW EXECUTE FUNCTION public.analytics_guard_lead_link_events();
CREATE TRIGGER analytics_lead_link_capture_no_truncate BEFORE TRUNCATE ON public.analytics_lead_link_capture
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_guard_lead_link_events();

ALTER TABLE public.leads ENABLE ALWAYS TRIGGER analytics_lead_link_source_change;
ALTER TABLE public.analytics_lead_link_events ENABLE ALWAYS TRIGGER analytics_lead_link_event_guard;
ALTER TABLE public.analytics_lead_link_events ENABLE ALWAYS TRIGGER analytics_lead_link_event_no_truncate;
ALTER TABLE public.analytics_lead_link_capture ENABLE ALWAYS TRIGGER analytics_lead_link_capture_stop;
ALTER TABLE public.analytics_lead_link_capture ENABLE ALWAYS TRIGGER analytics_lead_link_capture_no_delete;
ALTER TABLE public.analytics_lead_link_capture ENABLE ALWAYS TRIGGER analytics_lead_link_capture_no_truncate;

REVOKE ALL ON public.analytics_lead_link_capture, public.analytics_lead_link_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.analytics_lead_link_events_ordinal_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_capture_lead_link_change(), public.analytics_guard_lead_link_events(),
  public.analytics_guard_lead_link_capture_stop(), public.analytics_erase_retained_lead_link_evidence(uuid[], uuid[])
  FROM PUBLIC;

INSERT INTO public.analytics_lead_link_capture DEFAULT VALUES;
COMMIT;
