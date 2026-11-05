-- PRIVATE UNNUMBERED PROPOSAL. No runtime grants, registration or admission claim.
-- Apply only in one disposable PostgreSQL transaction for future native rehearsal.
BEGIN;

CREATE DOMAIN public.analytics_input_source_id AS text COLLATE pg_catalog."C"
  CHECK (pg_catalog.char_length(VALUE) BETWEEN 1 AND 160 AND VALUE ~ '[^[:space:]]');

CREATE DOMAIN public.analytics_input_event_family AS text COLLATE pg_catalog."C"
  CHECK (VALUE IN ('touchpoint', 'campaign-cost', 'commerce', 'billing', 'delivery-cost',
    'experiment-assignment', 'experiment-exposure', 'geo-outcome', 'customer-signal'));

CREATE TABLE public.analytics_input_producers (
  producer public.analytics_input_source_id PRIMARY KEY,
  registration_ref public.analytics_input_source_id NOT NULL,
  enabled boolean NOT NULL DEFAULT false
);

-- The registry names a server-verified principal. It never stores credentials or tokens.
CREATE TABLE public.analytics_input_grants (
  grant_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  producer public.analytics_input_source_id NOT NULL
    REFERENCES public.analytics_input_producers (producer) ON DELETE RESTRICT,
  principal_kind text COLLATE pg_catalog."C" NOT NULL,
  principal_ref public.analytics_input_source_id NOT NULL,
  event_family public.analytics_input_event_family NOT NULL,
  policy_version public.analytics_input_source_id NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT analytics_input_grant_kind_ck CHECK (principal_kind IN ('interactive-user', 'service-adapter')),
  CONSTRAINT analytics_input_grant_window_ck CHECK (expires_at IS NULL OR expires_at > valid_from),
  CONSTRAINT analytics_input_grant_binding_uq UNIQUE
    (grant_id, producer, principal_kind, principal_ref, event_family, policy_version)
);
CREATE INDEX analytics_input_grant_lookup_idx ON public.analytics_input_grants
  (producer, principal_kind, principal_ref, event_family) WHERE revoked_at IS NULL;

CREATE TABLE public.analytics_input_admissions (
  admission_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  producer public.analytics_input_source_id NOT NULL
    REFERENCES public.analytics_input_producers (producer) ON DELETE RESTRICT,
  batch_id public.analytics_input_source_id NOT NULL,
  contract_version smallint NOT NULL CHECK (contract_version = 1),
  principal_kind text COLLATE pg_catalog."C" NOT NULL,
  principal_ref public.analytics_input_source_id NOT NULL,
  actor_user_id uuid,
  authentication_ref public.analytics_input_source_id NOT NULL,
  admitted_at timestamptz NOT NULL,
  input_count smallint NOT NULL CHECK (input_count BETWEEN 1 AND 500),
  CONSTRAINT analytics_input_admission_actor_ck CHECK (
    (principal_kind = 'interactive-user' AND actor_user_id IS NOT NULL AND principal_ref = actor_user_id::text)
    OR (principal_kind = 'service-adapter' AND actor_user_id IS NULL)
  ),
  CONSTRAINT analytics_input_admission_binding_uq UNIQUE
    (admission_id, producer, principal_kind, principal_ref, input_count)
);
CREATE INDEX analytics_input_admission_browse_idx ON public.analytics_input_admissions
  (producer, admitted_at, admission_id);

CREATE TABLE public.analytics_input_events (
  producer public.analytics_input_source_id NOT NULL,
  event_id public.analytics_input_source_id NOT NULL,
  source_record_id public.analytics_input_source_id NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  event_family public.analytics_input_event_family NOT NULL,
  supersedes_event_id public.analytics_input_source_id,
  supersedes_revision bigint,
  fingerprint_version text COLLATE pg_catalog."C" NOT NULL
    CHECK (fingerprint_version = 'analytics-input-event-v1:sha256'),
  fingerprint_sha256 bytea NOT NULL CHECK (pg_catalog.octet_length(fingerprint_sha256) = 32),
  canonical_payload text NOT NULL CHECK (pg_catalog.octet_length(canonical_payload) BETWEEN 1 AND 32768),
  payload jsonb NOT NULL,
  first_admission_id uuid NOT NULL,
  first_input_index smallint NOT NULL CHECK (first_input_index BETWEEN 0 AND 499),
  CONSTRAINT analytics_input_event_pkey PRIMARY KEY (producer, event_id),
  CONSTRAINT analytics_input_event_revision_uq UNIQUE (producer, source_record_id, revision),
  CONSTRAINT analytics_input_event_binding_uq UNIQUE
    (producer, source_record_id, revision, event_id, event_family),
  CONSTRAINT analytics_input_event_previous_fk FOREIGN KEY
    (producer, source_record_id, supersedes_revision, supersedes_event_id, event_family)
    REFERENCES public.analytics_input_events (producer, source_record_id, revision, event_id, event_family)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_input_event_payload_ck CHECK (
    pg_catalog.jsonb_typeof(payload) = 'object' AND canonical_payload::jsonb = payload
    AND payload -> 'kind' IS NOT DISTINCT FROM pg_catalog.to_jsonb(event_family::text)
    AND payload #> '{provenance,producer}' IS NOT DISTINCT FROM pg_catalog.to_jsonb(producer::text)
    AND payload #> '{provenance,sourceRecordId}' IS NOT DISTINCT FROM pg_catalog.to_jsonb(source_record_id::text)
    AND payload #> '{provenance,eventId}' IS NOT DISTINCT FROM pg_catalog.to_jsonb(event_id::text)
    AND payload #> '{provenance,revision}' IS NOT DISTINCT FROM pg_catalog.to_jsonb(revision)
    AND pg_catalog.jsonb_typeof(payload #> '{provenance,capturedAt}') IS NOT DISTINCT FROM 'string'
    AND pg_catalog.jsonb_typeof(payload #> '{provenance,effectiveAt}') IS NOT DISTINCT FROM 'string'
  ),
  CONSTRAINT analytics_input_event_fingerprint_ck CHECK (
    fingerprint_sha256 = pg_catalog.sha256(pg_catalog.convert_to(
      fingerprint_version || E'\n' || canonical_payload, 'UTF8'))
  ),
  CONSTRAINT analytics_input_event_chain_ck CHECK (
    (revision = 1 AND supersedes_revision IS NULL AND supersedes_event_id IS NULL
      AND NOT ((payload -> 'provenance') ? 'supersedes')
      AND NOT ((payload -> 'provenance') ? 'correctionReason'))
    OR
    (revision > 1 AND supersedes_revision IS NOT NULL AND supersedes_revision = revision - 1
      AND supersedes_event_id IS NOT NULL AND supersedes_event_id <> event_id
      AND payload #> '{provenance,supersedes}' IS NOT DISTINCT FROM pg_catalog.jsonb_build_object(
        'eventId', supersedes_event_id::text, 'revision', supersedes_revision)
      AND pg_catalog.jsonb_typeof(payload #> '{provenance,correctionReason}') IS NOT DISTINCT FROM 'string'
      AND payload #>> '{provenance,correctionReason}' ~ '[^[:space:]]'
      AND pg_catalog.char_length(payload #>> '{provenance,correctionReason}') <= 500)
  )
);

-- An item's disposition is derived from the event's immutable first-admission link.
-- A later retry records its own verified receipt and grant without appending another event.
CREATE TABLE public.analytics_input_admission_items (
  admission_id uuid NOT NULL,
  input_index smallint NOT NULL,
  input_count smallint NOT NULL,
  producer public.analytics_input_source_id NOT NULL,
  principal_kind text COLLATE pg_catalog."C" NOT NULL,
  principal_ref public.analytics_input_source_id NOT NULL,
  grant_id uuid NOT NULL,
  policy_version public.analytics_input_source_id NOT NULL,
  source_record_id public.analytics_input_source_id NOT NULL,
  revision bigint NOT NULL,
  event_id public.analytics_input_source_id NOT NULL,
  event_family public.analytics_input_event_family NOT NULL,
  CONSTRAINT analytics_input_item_pkey PRIMARY KEY (admission_id, input_index),
  CONSTRAINT analytics_input_item_event_once_uq UNIQUE (admission_id, event_id),
  CONSTRAINT analytics_input_item_binding_uq UNIQUE
    (admission_id, input_index, producer, source_record_id, revision, event_id, event_family),
  CONSTRAINT analytics_input_item_index_ck CHECK (input_index >= 0 AND input_index < input_count),
  CONSTRAINT analytics_input_item_admission_fk FOREIGN KEY
    (admission_id, producer, principal_kind, principal_ref, input_count)
    REFERENCES public.analytics_input_admissions (admission_id, producer, principal_kind, principal_ref, input_count)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_input_item_grant_fk FOREIGN KEY
    (grant_id, producer, principal_kind, principal_ref, event_family, policy_version)
    REFERENCES public.analytics_input_grants (grant_id, producer, principal_kind, principal_ref, event_family, policy_version)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_input_item_event_fk FOREIGN KEY
    (producer, source_record_id, revision, event_id, event_family)
    REFERENCES public.analytics_input_events (producer, source_record_id, revision, event_id, event_family)
    ON DELETE RESTRICT
);
ALTER TABLE public.analytics_input_events ADD CONSTRAINT analytics_input_event_first_item_fk
  FOREIGN KEY (first_admission_id, first_input_index, producer, source_record_id, revision, event_id, event_family)
  REFERENCES public.analytics_input_admission_items
    (admission_id, input_index, producer, source_record_id, revision, event_id, event_family)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION public.analytics_input_stamp_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.admitted_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

-- A second storage fence for configured authority, not authentication of a caller.
CREATE FUNCTION public.analytics_input_check_item_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  producer_enabled boolean;
  receipt_time timestamptz;
  permit public.analytics_input_grants%ROWTYPE;
BEGIN
  SELECT p.enabled INTO producer_enabled FROM public.analytics_input_producers p
  WHERE p.producer = NEW.producer FOR SHARE;
  IF producer_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'analytics input producer unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT a.admitted_at INTO receipt_time FROM public.analytics_input_admissions a
  WHERE a.admission_id = NEW.admission_id;
  SELECT g.* INTO permit FROM public.analytics_input_grants g
  WHERE g.grant_id = NEW.grant_id AND g.producer = NEW.producer
    AND g.principal_kind = NEW.principal_kind AND g.principal_ref = NEW.principal_ref
    AND g.event_family = NEW.event_family AND g.policy_version = NEW.policy_version
  FOR SHARE;
  IF NOT FOUND OR receipt_time IS NULL OR permit.revoked_at IS NOT NULL
    OR permit.valid_from > receipt_time OR (permit.expires_at IS NOT NULL AND permit.expires_at <= receipt_time)
  THEN
    RAISE EXCEPTION 'analytics input grant unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.analytics_input_check_complete_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actual_count bigint;
  payload_bytes bigint;
BEGIN
  SELECT pg_catalog.count(*), coalesce(pg_catalog.sum(pg_catalog.octet_length(e.canonical_payload)), 0)
    INTO actual_count, payload_bytes
  FROM public.analytics_input_admission_items i
  JOIN public.analytics_input_events e ON e.producer = i.producer AND e.event_id = i.event_id
  WHERE i.admission_id = NEW.admission_id;
  IF actual_count <> NEW.input_count OR payload_bytes > 4194304 THEN
    RAISE EXCEPTION 'analytics input admission is incomplete or oversized' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.analytics_input_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'analytics input custody is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.analytics_input_guard_authority_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'analytics_input_producers' THEN
    IF (pg_catalog.to_jsonb(NEW) - 'enabled') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'enabled') THEN
      RAISE EXCEPTION 'analytics input producer identity is immutable' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
      OR (pg_catalog.to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'revoked_at')
    THEN
      RAISE EXCEPTION 'analytics input grant can only be revoked once' USING ERRCODE = '55000';
    END IF;
    NEW.revoked_at := pg_catalog.clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER analytics_input_admission_stamp BEFORE INSERT ON public.analytics_input_admissions
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_stamp_admission();
CREATE TRIGGER analytics_input_item_authority BEFORE INSERT ON public.analytics_input_admission_items
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_check_item_grant();
CREATE CONSTRAINT TRIGGER analytics_input_admission_complete AFTER INSERT ON public.analytics_input_admissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.analytics_input_check_complete_admission();

CREATE TRIGGER analytics_input_event_immutable BEFORE UPDATE OR DELETE ON public.analytics_input_events
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_admission_immutable BEFORE UPDATE OR DELETE ON public.analytics_input_admissions
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_item_immutable BEFORE UPDATE OR DELETE ON public.analytics_input_admission_items
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_producer_no_delete BEFORE DELETE ON public.analytics_input_producers
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_grant_no_delete BEFORE DELETE ON public.analytics_input_grants
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_producer_control BEFORE UPDATE ON public.analytics_input_producers
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_guard_authority_update();
CREATE TRIGGER analytics_input_grant_control BEFORE UPDATE ON public.analytics_input_grants
  FOR EACH ROW EXECUTE FUNCTION public.analytics_input_guard_authority_update();

CREATE TRIGGER analytics_input_event_no_truncate BEFORE TRUNCATE ON public.analytics_input_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_admission_no_truncate BEFORE TRUNCATE ON public.analytics_input_admissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_item_no_truncate BEFORE TRUNCATE ON public.analytics_input_admission_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_producer_no_truncate BEFORE TRUNCATE ON public.analytics_input_producers
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_input_reject_mutation();
CREATE TRIGGER analytics_input_grant_no_truncate BEFORE TRUNCATE ON public.analytics_input_grants
  FOR EACH STATEMENT EXECUTE FUNCTION public.analytics_input_reject_mutation();

ALTER TABLE public.analytics_input_admissions ENABLE ALWAYS TRIGGER analytics_input_admission_stamp;
ALTER TABLE public.analytics_input_admissions ENABLE ALWAYS TRIGGER analytics_input_admission_complete;
ALTER TABLE public.analytics_input_admission_items ENABLE ALWAYS TRIGGER analytics_input_item_authority;
ALTER TABLE public.analytics_input_events ENABLE ALWAYS TRIGGER analytics_input_event_immutable;
ALTER TABLE public.analytics_input_admissions ENABLE ALWAYS TRIGGER analytics_input_admission_immutable;
ALTER TABLE public.analytics_input_admission_items ENABLE ALWAYS TRIGGER analytics_input_item_immutable;
ALTER TABLE public.analytics_input_producers ENABLE ALWAYS TRIGGER analytics_input_producer_no_delete;
ALTER TABLE public.analytics_input_grants ENABLE ALWAYS TRIGGER analytics_input_grant_no_delete;
ALTER TABLE public.analytics_input_producers ENABLE ALWAYS TRIGGER analytics_input_producer_control;
ALTER TABLE public.analytics_input_grants ENABLE ALWAYS TRIGGER analytics_input_grant_control;
ALTER TABLE public.analytics_input_events ENABLE ALWAYS TRIGGER analytics_input_event_no_truncate;
ALTER TABLE public.analytics_input_admissions ENABLE ALWAYS TRIGGER analytics_input_admission_no_truncate;
ALTER TABLE public.analytics_input_admission_items ENABLE ALWAYS TRIGGER analytics_input_item_no_truncate;
ALTER TABLE public.analytics_input_producers ENABLE ALWAYS TRIGGER analytics_input_producer_no_truncate;
ALTER TABLE public.analytics_input_grants ENABLE ALWAYS TRIGGER analytics_input_grant_no_truncate;

REVOKE ALL ON public.analytics_input_producers, public.analytics_input_grants,
  public.analytics_input_admissions, public.analytics_input_events, public.analytics_input_admission_items FROM PUBLIC;
REVOKE ALL ON TYPE public.analytics_input_source_id, public.analytics_input_event_family FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_input_stamp_admission(), public.analytics_input_check_item_grant(),
  public.analytics_input_check_complete_admission(), public.analytics_input_reject_mutation(),
  public.analytics_input_guard_authority_update() FROM PUBLIC;

COMMIT;
