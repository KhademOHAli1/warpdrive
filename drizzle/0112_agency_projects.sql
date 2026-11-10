-- Canonical Agency project admission after the reconciled 0111 lineage.
-- Preserve title validation and immutable audit/receipt triggers alongside generated models.
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
CREATE TABLE "agency_project_history" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"policy_version" smallint NOT NULL,
	"previous_revision" bigint,
	"revision" bigint NOT NULL,
	"previous_state" text,
	"state" text NOT NULL,
	"previous_archived_from" text,
	"archived_from" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_project_history_pkey" PRIMARY KEY("id"),
	CONSTRAINT "agency_history_project_revision_key" UNIQUE("project_id","revision"),
	CONSTRAINT "agency_history_receipt_identity_key" UNIQUE("project_id","revision","id","operation","recorded_by_user_id"),
	CONSTRAINT "agency_history_operation_check" CHECK ("agency_project_history"."operation" IN ('create', 'start')),
	CONSTRAINT "agency_history_policy_check" CHECK ("agency_project_history"."policy_version" = 1),
	CONSTRAINT "agency_history_revision_check" CHECK ("agency_project_history"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "agency_history_previous_revision_check" CHECK ("agency_project_history"."previous_revision" IS NULL OR "agency_project_history"."previous_revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "agency_history_transition_check" CHECK (
      ("agency_project_history"."operation" = 'create' AND "agency_project_history"."previous_revision" IS NULL AND "agency_project_history"."revision" = 0
        AND "agency_project_history"."previous_state" IS NULL AND "agency_project_history"."state" = 'planned'
        AND "agency_project_history"."previous_archived_from" IS NULL AND "agency_project_history"."archived_from" IS NULL)
      OR ("agency_project_history"."operation" = 'start' AND "agency_project_history"."previous_revision" IS NOT NULL
        AND "agency_project_history"."revision"::numeric = "agency_project_history"."previous_revision"::numeric + 1
        AND "agency_project_history"."previous_state" IS NOT NULL AND "agency_project_history"."previous_state" = 'planned' AND "agency_project_history"."state" = 'active'
        AND "agency_project_history"."previous_archived_from" IS NULL AND "agency_project_history"."archived_from" IS NULL)
    )
);
--> statement-breakpoint
CREATE TABLE "agency_project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_edit" boolean DEFAULT false NOT NULL,
	"assignment_coordinate" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agency_project_members_pkey" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "agency_project_requests" (
	"actor_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"intent_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"result_revision" bigint NOT NULL,
	"history_id" uuid NOT NULL,
	"payload_state" text NOT NULL,
	"private_payload" "bytea",
	"key_id" text,
	CONSTRAINT "agency_project_requests_pkey" PRIMARY KEY("actor_user_id","operation","intent_id"),
	CONSTRAINT "agency_requests_operation_check" CHECK ("agency_project_requests"."operation" IN ('create', 'start')),
	CONSTRAINT "agency_requests_revision_check" CHECK ("agency_project_requests"."result_revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "agency_requests_payload_state_check" CHECK ("agency_project_requests"."payload_state" IN ('retained', 'cleared', 'unreadable', 'disposed')),
	CONSTRAINT "agency_requests_retained_payload_check" CHECK (
      "agency_project_requests"."payload_state" <> 'retained'
      OR ("agency_project_requests"."private_payload" IS NOT NULL AND octet_length("agency_project_requests"."private_payload") > 0
        AND "agency_project_requests"."key_id" IS NOT NULL AND btrim("agency_project_requests"."key_id") <> '')
    )
);
--> statement-breakpoint
CREATE TABLE "agency_project_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agency_project_settings_singleton" CHECK ("agency_project_settings"."id" = true)
);
--> statement-breakpoint
CREATE TABLE "agency_projects" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"deal_id" uuid,
	"person_id" uuid,
	"org_id" uuid,
	"state" text DEFAULT 'planned' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"archived_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_projects_pkey" PRIMARY KEY("id"),
	CONSTRAINT "agency_projects_title_check" CHECK (public.agency_project_title_valid("agency_projects"."title")),
	CONSTRAINT "agency_projects_revision_check" CHECK ("agency_projects"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "agency_projects_state_check" CHECK ("agency_projects"."state" IN ('planned', 'active', 'on-hold', 'completed', 'canceled', 'archived')),
	CONSTRAINT "agency_projects_archive_check" CHECK (
      ("agency_projects"."state" = 'archived' AND "agency_projects"."archived_from" IS NOT NULL
        AND "agency_projects"."archived_from" IN ('planned', 'active', 'on-hold', 'completed', 'canceled'))
      OR ("agency_projects"."state" <> 'archived' AND "agency_projects"."archived_from" IS NULL)
    ),
	CONSTRAINT "agency_projects_anchor_check" CHECK ("agency_projects"."deal_id" IS NOT NULL OR "agency_projects"."person_id" IS NOT NULL OR "agency_projects"."org_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "agency_project_history" ADD CONSTRAINT "agency_project_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_project_history" ADD CONSTRAINT "agency_project_history_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_project_members" ADD CONSTRAINT "agency_project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_project_members" ADD CONSTRAINT "agency_project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_project_requests" ADD CONSTRAINT "agency_project_requests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_project_requests" ADD CONSTRAINT "agency_project_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."agency_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_project_requests" ADD CONSTRAINT "agency_requests_history_identity_fk" FOREIGN KEY ("project_id","result_revision","history_id","operation","actor_user_id") REFERENCES "public"."agency_project_history"("project_id","revision","id","operation","recorded_by_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_projects" ADD CONSTRAINT "agency_projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_projects" ADD CONSTRAINT "agency_projects_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_projects" ADD CONSTRAINT "agency_projects_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_projects" ADD CONSTRAINT "agency_projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
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
