-- Private Agency reservation 0099, exercised only as an overlay on the frozen 0000..0097 fixture.
-- No canonical journal/snapshot, installed migration admission, codec or lifecycle acceptance is implied.
-- Unicode classes below come from the recorded Bun 1.4.4 Cf/Default_Ignorable and JS.trim probe.
CREATE FUNCTION public.agency_project_title_valid(candidate text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $title$
  SELECT candidate COLLATE "C" = btrim(candidate, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
    AND char_length(candidate) BETWEEN 1 AND 160
    -- PostgreSQL UTF-8 text already excludes U+0000 and lone surrogate encodings.
    AND candidate COLLATE "C" !~ U&'[\0001-\001f\007f-\009f\2028\2029]'
    AND char_length(btrim(
      regexp_replace(candidate COLLATE "C", U&'[\00ad\034f\0600-\0605\061c\06dd\070f\0890-\0891\08e2\115f-\1160\17b4-\17b5\180b-\180f\200b-\200f\202a-\202e\2060-\206f\3164\fe00-\fe0f\feff\ffa0\fff0-\fffb\+0110bd\+0110cd\+013430-\+01343f\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0000-\+0e0fff]', '', 'g'),
      U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'
    )) > 0
$title$;
--> statement-breakpoint
CREATE TABLE public.agency_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  deal_id uuid REFERENCES public.deals(id) ON DELETE RESTRICT,
  person_id uuid REFERENCES public.persons(id) ON DELETE RESTRICT,
  org_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'planned',
  revision bigint NOT NULL DEFAULT 0,
  archived_from text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_projects_title_check CHECK (public.agency_project_title_valid(title)),
  CONSTRAINT agency_projects_revision_check CHECK (revision BETWEEN 0 AND 9007199254740991),
  CONSTRAINT agency_projects_state_check
    CHECK (state IN ('planned', 'active', 'on-hold', 'completed', 'canceled', 'archived')),
  CONSTRAINT agency_projects_archive_check CHECK (
    (state = 'archived' AND archived_from IS NOT NULL
      AND archived_from IN ('planned', 'active', 'on-hold', 'completed', 'canceled'))
    OR (state <> 'archived' AND archived_from IS NULL)
  ),
  CONSTRAINT agency_projects_anchor_check
    CHECK (deal_id IS NOT NULL OR person_id IS NOT NULL OR org_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE public.agency_project_members (
  project_id uuid NOT NULL REFERENCES public.agency_projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  project_edit boolean NOT NULL DEFAULT false,
  assignment_coordinate boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, user_id)
);
--> statement-breakpoint
CREATE TABLE public.agency_project_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.agency_projects(id) ON DELETE RESTRICT,
  recorded_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  policy_version smallint NOT NULL,
  previous_revision bigint,
  revision bigint NOT NULL,
  previous_state text,
  state text NOT NULL,
  previous_archived_from text,
  archived_from text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_history_operation_check CHECK (operation IN ('create', 'start')),
  CONSTRAINT agency_history_policy_check CHECK (policy_version = 1),
  CONSTRAINT agency_history_revision_check CHECK (revision BETWEEN 0 AND 9007199254740991),
  CONSTRAINT agency_history_previous_revision_check
    CHECK (previous_revision IS NULL OR previous_revision BETWEEN 0 AND 9007199254740991),
  CONSTRAINT agency_history_transition_check CHECK (
    (operation = 'create' AND previous_revision IS NULL AND revision = 0
      AND previous_state IS NULL AND state = 'planned'
      AND previous_archived_from IS NULL AND archived_from IS NULL)
    OR (operation = 'start' AND previous_revision IS NOT NULL
      AND revision::numeric = previous_revision::numeric + 1
      AND previous_state IS NOT NULL AND previous_state = 'planned' AND state = 'active'
      AND previous_archived_from IS NULL AND archived_from IS NULL)
  ),
  CONSTRAINT agency_history_project_revision_key UNIQUE (project_id, revision),
  CONSTRAINT agency_history_receipt_identity_key
    UNIQUE (project_id, revision, id, operation, recorded_by_user_id)
);
--> statement-breakpoint
CREATE TABLE public.agency_project_requests (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  intent_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.agency_projects(id) ON DELETE RESTRICT,
  result_revision bigint NOT NULL,
  history_id uuid NOT NULL,
  payload_state text NOT NULL,
  private_payload bytea,
  key_id text,
  PRIMARY KEY (actor_user_id, operation, intent_id),
  CONSTRAINT agency_requests_operation_check CHECK (operation IN ('create', 'start')),
  CONSTRAINT agency_requests_revision_check CHECK (result_revision BETWEEN 0 AND 9007199254740991),
  CONSTRAINT agency_requests_payload_state_check
    CHECK (payload_state IN ('retained', 'cleared', 'unreadable', 'disposed')),
  CONSTRAINT agency_requests_retained_payload_check CHECK (
    payload_state <> 'retained'
    OR (private_payload IS NOT NULL AND octet_length(private_payload) > 0
      AND key_id IS NOT NULL AND btrim(key_id) <> '')
  ),
  CONSTRAINT agency_requests_history_identity_fk
    FOREIGN KEY (project_id, result_revision, history_id, operation, actor_user_id)
    REFERENCES public.agency_project_history(project_id, revision, id, operation, recorded_by_user_id)
    ON DELETE RESTRICT
);
--> statement-breakpoint
-- Only finite immutable facts are stored here. Optional free-form reasons are not accepted.
CREATE FUNCTION public.agency_project_history_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $history$
BEGIN
  -- TRUNCATE already holds ACCESS EXCLUSIVE. Zero heap size proves absence across
  -- snapshots; an old MVCC-visible count must not hide a committed fact.
  IF TG_OP = 'TRUNCATE'
    AND pg_catalog.pg_relation_size(TG_RELID::pg_catalog.regclass, 'main') = 0
  THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Agency project history is append-only' USING ERRCODE = '23514';
END;
$history$;
--> statement-breakpoint
CREATE TRIGGER agency_project_history_immutable
  BEFORE UPDATE OR DELETE ON public.agency_project_history
  FOR EACH ROW EXECUTE FUNCTION public.agency_project_history_immutable();
--> statement-breakpoint
CREATE TRIGGER agency_project_history_no_truncate
  BEFORE TRUNCATE ON public.agency_project_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.agency_project_history_immutable();
--> statement-breakpoint
-- Payload/key/disposition changes remain possible; no unresolved rotation or retention policy is invented.
CREATE FUNCTION public.agency_project_request_identity_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $request$
BEGIN
  IF TG_OP = 'TRUNCATE'
    AND pg_catalog.pg_relation_size(TG_RELID::pg_catalog.regclass, 'main') = 0
  THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Agency request identity tombstones cannot be removed' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.actor_user_id, NEW.operation, NEW.intent_id, NEW.project_id, NEW.result_revision, NEW.history_id)
    IS DISTINCT FROM ROW(OLD.actor_user_id, OLD.operation, OLD.intent_id, OLD.project_id, OLD.result_revision, OLD.history_id)
  THEN
    RAISE EXCEPTION 'Agency request identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$request$;
--> statement-breakpoint
CREATE TRIGGER agency_project_request_identity_immutable
  BEFORE UPDATE OR DELETE ON public.agency_project_requests
  FOR EACH ROW EXECUTE FUNCTION public.agency_project_request_identity_immutable();
--> statement-breakpoint
CREATE TRIGGER agency_project_request_no_truncate
  BEFORE TRUNCATE ON public.agency_project_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.agency_project_request_identity_immutable();
