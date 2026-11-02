CREATE TABLE "email_private_intake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"observed_provider_id" text NOT NULL,
	"observed_payload" jsonb,
	"observed_payload_hash" text NOT NULL,
	"hash_version" integer DEFAULT 1 NOT NULL,
	"baseline_version" integer DEFAULT 1 NOT NULL,
	"owned_message_id" uuid,
	"baseline_thread_id" uuid NOT NULL,
	"baseline_message_hash" text NOT NULL,
	"baseline_thread_hash" text NOT NULL,
	"baseline_attachments_hash" text NOT NULL,
	"confirmation_attempt_id" uuid,
	"confirmation_snapshot" jsonb,
	"intake_state" text DEFAULT 'unverified' NOT NULL,
	"content_state" text DEFAULT 'retained' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_private_intake_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "email_private_intake_observed_uq" UNIQUE("account_id","provider","observed_provider_id"),
	CONSTRAINT "email_private_intake_owned_message_uq" UNIQUE("account_id","owned_message_id"),
	CONSTRAINT "email_private_intake_confirmation_uq" UNIQUE("account_id","confirmation_attempt_id"),
	CONSTRAINT "email_private_intake_provider" CHECK ("email_private_intake"."provider" IN ('gmail','imap_smtp')),
	CONSTRAINT "email_private_intake_observed_id" CHECK (octet_length("email_private_intake"."observed_provider_id")
      BETWEEN 1 AND 2048),
	CONSTRAINT "email_private_intake_hash_version" CHECK ("email_private_intake"."hash_version"=1),
	CONSTRAINT "email_private_intake_baseline_version" CHECK ("email_private_intake"."baseline_version"=1),
	CONSTRAINT "email_private_intake_hashes" CHECK ("email_private_intake"."observed_payload_hash" ~ '^[a-f0-9]{64}$'
      AND "email_private_intake"."baseline_message_hash" ~ '^[a-f0-9]{64}$'
      AND "email_private_intake"."baseline_thread_hash" ~ '^[a-f0-9]{64}$'
      AND "email_private_intake"."baseline_attachments_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "email_private_intake_state" CHECK ("email_private_intake"."intake_state"
      IN ('unverified','confirmed_notification','conflict')),
	CONSTRAINT "email_private_intake_content_state" CHECK ("email_private_intake"."content_state" IN ('retained','purged')),
	CONSTRAINT "email_private_intake_revision" CHECK ("email_private_intake"."revision">=0),
	CONSTRAINT "email_private_intake_content_shape" CHECK (((
      "email_private_intake"."content_state"='retained' AND "email_private_intake"."owned_message_id" IS NOT NULL
        AND "email_private_intake"."observed_payload" IS NOT NULL AND jsonb_typeof("email_private_intake"."observed_payload")='object'
      ) OR (
      "email_private_intake"."content_state"='purged' AND "email_private_intake"."owned_message_id" IS NULL AND "email_private_intake"."observed_payload" IS NULL
      )) IS TRUE),
	CONSTRAINT "email_private_intake_confirmation_shape" CHECK (((
      "email_private_intake"."intake_state" IN ('unverified','conflict') AND "email_private_intake"."confirmation_attempt_id" IS NULL
        AND "email_private_intake"."confirmation_snapshot" IS NULL
      ) OR (
      "email_private_intake"."intake_state"='confirmed_notification' AND "email_private_intake"."provider"='gmail'
        AND jsonb_typeof("email_private_intake"."confirmation_snapshot")='object'
        AND octet_length("email_private_intake"."confirmation_snapshot"::text)<=16384
        AND "email_private_intake"."confirmation_snapshot"->'version'='1'::jsonb
        AND jsonb_typeof("email_private_intake"."confirmation_snapshot"->'accountId')='string'
        AND "email_private_intake"."confirmation_snapshot"->>'accountId'="email_private_intake"."account_id"::text
        AND jsonb_typeof("email_private_intake"."confirmation_snapshot"->'attemptId')='string'
        AND "email_private_intake"."confirmation_snapshot"->>'attemptId'
          ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        AND ("email_private_intake"."confirmation_attempt_id" IS NULL OR
          "email_private_intake"."confirmation_snapshot"->>'attemptId'="email_private_intake"."confirmation_attempt_id"::text)
        AND jsonb_typeof("email_private_intake"."confirmation_snapshot"->'providerMessageId')='string'
        AND "email_private_intake"."confirmation_snapshot"->>'providerMessageId'="email_private_intake"."observed_provider_id"
        AND jsonb_typeof("email_private_intake"."confirmation_snapshot"->'payloadHash')='string'
        AND "email_private_intake"."confirmation_snapshot"->>'payloadHash' ~ '^[a-f0-9]{64}$'
        AND ("email_private_intake"."confirmation_snapshot"-'version'-'accountId'-'attemptId'-'providerMessageId'-'payloadHash')='{}'::jsonb
      )) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "email_private_intake_reviews" (
	"intake_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"actor_id" uuid,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_private_intake_reviews_pk" PRIMARY KEY("intake_id","revision"),
	CONSTRAINT "email_private_intake_review_revision" CHECK ("email_private_intake_reviews"."revision">0),
	CONSTRAINT "email_private_intake_review_decision" CHECK ("email_private_intake_reviews"."decision"
      IN ('keep_private','dismiss','restore_private'))
);
--> statement-breakpoint
ALTER TABLE "email_private_intake" ADD CONSTRAINT "email_private_intake_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_private_intake" ADD CONSTRAINT "email_private_intake_message_same_account_fk" FOREIGN KEY ("owned_message_id","account_id") REFERENCES "public"."email_messages"("id","account_id") ON DELETE SET NULL ("owned_message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_private_intake" ADD CONSTRAINT "email_private_intake_attempt_same_account_fk" FOREIGN KEY ("confirmation_attempt_id","account_id") REFERENCES "public"."email_send_attempts"("id","account_id") ON DELETE SET NULL ("confirmation_attempt_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_private_intake_reviews" ADD CONSTRAINT "email_private_intake_reviews_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_private_intake_reviews" ADD CONSTRAINT "email_private_intake_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_private_intake_reviews" ADD CONSTRAINT "email_private_intake_review_same_account_fk" FOREIGN KEY ("intake_id","account_id") REFERENCES "public"."email_private_intake"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_private_intake_account_state_idx" ON "email_private_intake" USING btree ("account_id","content_state","intake_state");
--> statement-breakpoint
CREATE FUNCTION public.private_intake_hash_v1(payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $private_intake_hash_v1$
  SELECT encode(public.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex');
$private_intake_hash_v1$;
--> statement-breakpoint

-- Versioned projections must not inherit future columns from their composite inputs.
CREATE FUNCTION public.private_intake_message_v1(row_data public.email_messages) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $private_intake_message_v1$
  SELECT jsonb_build_object(
    'id', (row_data).id,
    'thread_id', (row_data).thread_id,
    'account_id', (row_data).account_id,
    'gmail_message_id', (row_data).gmail_message_id,
    'provider_message_id', (row_data).provider_message_id,
    'rfc_message_id', (row_data).rfc_message_id,
    'in_reply_to', (row_data).in_reply_to,
    'references', (row_data).references,
    'message_fingerprint', (row_data).message_fingerprint,
    'direction', (row_data).direction,
    'from_email', (row_data).from_email::text,
    'from_name', (row_data).from_name,
    'to_emails', (row_data).to_emails,
    'cc_emails', (row_data).cc_emails,
    'subject', (row_data).subject,
    'snippet', (row_data).snippet,
    'body_html', (row_data).body_html,
    'body_text', (row_data).body_text,
    'sent_at_us', (extract(epoch FROM (row_data).sent_at) * 1000000)::bigint,
    'tracking_enabled', (row_data).tracking_enabled,
    'created_at_us', (extract(epoch FROM (row_data).created_at) * 1000000)::bigint
  );
$private_intake_message_v1$;
--> statement-breakpoint

-- Numeric instants preserve microseconds without session TimeZone or DateStyle rendering.
CREATE FUNCTION public.private_intake_thread_v1(row_data public.email_threads) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $private_intake_thread_v1$
  SELECT jsonb_build_object(
    'id', (row_data).id,
    'account_id', (row_data).account_id,
    'gmail_thread_id', (row_data).gmail_thread_id,
    'provider_thread_id', (row_data).provider_thread_id,
    'subject', (row_data).subject,
    'deal_id', (row_data).deal_id,
    'lead_id', (row_data).lead_id,
    'person_id', (row_data).person_id,
    'visibility', (row_data).visibility,
    'last_message_at_us', (extract(epoch FROM (row_data).last_message_at) * 1000000)::bigint,
    'archived_at_us', (extract(epoch FROM (row_data).archived_at) * 1000000)::bigint,
    'trashed_at_us', (extract(epoch FROM (row_data).trashed_at) * 1000000)::bigint,
    'remote_trashed_at_us', (extract(epoch FROM (row_data).remote_trashed_at) * 1000000)::bigint,
    'follow_up_status', (row_data).follow_up_status,
    'labels', (row_data).labels,
    'created_at_us', (extract(epoch FROM (row_data).created_at) * 1000000)::bigint,
    'updated_at_us', (extract(epoch FROM (row_data).updated_at) * 1000000)::bigint
  );
$private_intake_thread_v1$;
--> statement-breakpoint

CREATE FUNCTION public.private_intake_attachment_v1(row_data public.email_message_attachments) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $private_intake_attachment_v1$
  SELECT jsonb_build_object(
    'id', (row_data).id,
    'message_id', (row_data).message_id,
    'account_id', (row_data).account_id,
    'gmail_attachment_id', (row_data).gmail_attachment_id,
    'provider_locator', (row_data).provider_locator,
    'filename', (row_data).filename,
    'mime_type', (row_data).mime_type,
    'size_bytes', (row_data).size_bytes,
    'created_at_us', (extract(epoch FROM (row_data).created_at) * 1000000)::bigint
  );
$private_intake_attachment_v1$;
--> statement-breakpoint

-- Native callers establish owner authority and lock their rows before using these hashes.
CREATE FUNCTION public.private_intake_baseline_v1(p_account_id uuid, p_message_id uuid)
RETURNS TABLE(message_hash text, thread_hash text, attachments_hash text)
LANGUAGE plpgsql STABLE STRICT
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $private_intake_baseline_v1$
DECLARE
  message_projection jsonb;
  thread_projection jsonb;
  attachment_projection jsonb;
BEGIN
  SELECT public.private_intake_message_v1(m), public.private_intake_thread_v1(t)
    INTO message_projection, thread_projection
    FROM public.email_messages m
    JOIN public.email_threads t ON t.id = m.thread_id AND t.account_id = m.account_id
    WHERE m.id = p_message_id AND m.account_id = p_account_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Filtering corrupted same-message metadata out would certify an incomplete baseline.
  IF EXISTS (
    SELECT 1 FROM public.email_message_attachments a
    WHERE a.message_id = p_message_id AND a.account_id IS DISTINCT FROM p_account_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'private intake attachment mailbox differs from its message';
  END IF;

  SELECT coalesce(
      jsonb_agg(public.private_intake_attachment_v1(a) ORDER BY a.id),
      '[]'::jsonb
    )
    INTO attachment_projection
    FROM public.email_message_attachments a
    WHERE a.message_id = p_message_id AND a.account_id = p_account_id;

  message_hash := public.private_intake_hash_v1(message_projection);
  thread_hash := public.private_intake_hash_v1(thread_projection);
  attachments_hash := public.private_intake_hash_v1(attachment_projection);
  RETURN NEXT;
END;
$private_intake_baseline_v1$;

--> statement-breakpoint

-- Native callers retain the existing owner/account fence. These local guards
-- establish copy provenance and constrain state, never session or resend authority.
CREATE FUNCTION public.private_intake_assert_owned_v1(p_intake public.email_private_intake)
RETURNS void
LANGUAGE plpgsql VOLATILE STRICT
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $private_intake_assert_owned_v1$
DECLARE
  message_row public.email_messages%ROWTYPE;
  thread_row public.email_threads%ROWTYPE;
  baseline record;
  synthetic_id text := 'private-intake:' || p_intake.id::text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_accounts a
      WHERE a.id=p_intake.account_id AND a.provider=p_intake.provider)
    OR p_intake.content_state IS DISTINCT FROM 'retained'
    OR p_intake.hash_version IS DISTINCT FROM 1
    OR p_intake.baseline_version IS DISTINCT FROM 1
    OR jsonb_typeof(p_intake.observed_payload->'id') IS DISTINCT FROM 'string'
    OR p_intake.observed_payload->>'id' IS DISTINCT FROM p_intake.observed_provider_id
    OR public.private_intake_hash_v1(p_intake.observed_payload)
      IS DISTINCT FROM p_intake.observed_payload_hash THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake origin is invalid';
  END IF;

  SELECT m.* INTO message_row FROM public.email_messages m
    WHERE m.id=p_intake.owned_message_id AND m.account_id=p_intake.account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake owned message is unavailable';
  END IF;
  SELECT t.* INTO thread_row FROM public.email_threads t
    WHERE t.id=message_row.thread_id AND t.account_id=p_intake.account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake owned thread is unavailable';
  END IF;

  IF message_row.thread_id IS DISTINCT FROM p_intake.baseline_thread_id
    OR message_row.provider_message_id IS DISTINCT FROM synthetic_id
    OR message_row.gmail_message_id IS NOT NULL OR message_row.message_fingerprint IS NOT NULL
    OR message_row.tracking_enabled IS DISTINCT FROM false
    OR thread_row.provider_thread_id IS DISTINCT FROM synthetic_id
    OR thread_row.gmail_thread_id IS NOT NULL OR thread_row.visibility IS DISTINCT FROM 'private'
    OR thread_row.person_id IS NOT NULL OR thread_row.deal_id IS NOT NULL OR thread_row.lead_id IS NOT NULL
    OR thread_row.archived_at IS NOT NULL OR thread_row.trashed_at IS NOT NULL
    OR thread_row.remote_trashed_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.email_messages other
      WHERE other.account_id=p_intake.account_id AND other.thread_id=thread_row.id
        AND other.id<>message_row.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake copy is not exclusive';
  END IF;

  -- Parent FOR UPDATE locks also fence new FK children. Existing attachment
  -- edits require their own row locks before the fresh canonical baseline read.
  PERFORM a.id FROM public.email_message_attachments a
    WHERE a.message_id=message_row.id FOR UPDATE;
  SELECT b.* INTO baseline FROM public.private_intake_baseline_v1(
    p_intake.account_id,p_intake.owned_message_id) b;
  IF NOT FOUND OR baseline.message_hash IS DISTINCT FROM p_intake.baseline_message_hash
    OR baseline.thread_hash IS DISTINCT FROM p_intake.baseline_thread_hash
    OR baseline.attachments_hash IS DISTINCT FROM p_intake.baseline_attachments_hash THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake baseline differs';
  END IF;
END;
$private_intake_assert_owned_v1$;
--> statement-breakpoint

CREATE FUNCTION public.email_private_intake_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $email_private_intake_guard$
DECLARE
  message_absent boolean;
  attempt_absent boolean;
  proof_exists boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision IS DISTINCT FROM 0 OR NEW.intake_state IS DISTINCT FROM 'unverified'
      OR NEW.confirmation_attempt_id IS NOT NULL OR NEW.confirmation_snapshot IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake initial state is invalid';
    END IF;
    PERFORM public.private_intake_assert_owned_v1(NEW::public.email_private_intake);
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.email_accounts WHERE id=OLD.account_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake tombstone is immutable';
  END IF;

  IF ROW(NEW.id,NEW.account_id,NEW.provider,NEW.observed_provider_id,NEW.observed_payload_hash,
      NEW.hash_version,NEW.baseline_version,NEW.baseline_thread_id,NEW.baseline_message_hash,
      NEW.baseline_thread_hash,NEW.baseline_attachments_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.account_id,OLD.provider,OLD.observed_provider_id,OLD.observed_payload_hash,
      OLD.hash_version,OLD.baseline_version,OLD.baseline_thread_id,OLD.baseline_message_hash,
      OLD.baseline_thread_hash,OLD.baseline_attachments_hash,OLD.created_at)
    OR (OLD.confirmation_snapshot IS NOT NULL
      AND NEW.confirmation_snapshot IS DISTINCT FROM OLD.confirmation_snapshot) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake evidence is immutable';
  END IF;

  message_absent := OLD.owned_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.email_messages WHERE id=OLD.owned_message_id AND account_id=OLD.account_id);
  attempt_absent := OLD.confirmation_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.email_send_attempts WHERE id=OLD.confirmation_attempt_id AND account_id=OLD.account_id);

  -- RI cleanup is authorized by the exact parent's absence, never trigger depth.
  -- The FK updates only its pointer; complete the one-way payload purge here.
  IF message_absent AND NEW.owned_message_id IS NULL
    AND (NEW.observed_payload IS NOT DISTINCT FROM OLD.observed_payload OR NEW.observed_payload IS NULL)
    AND NEW.content_state IN (OLD.content_state,'purged')
    AND NEW.intake_state IS NOT DISTINCT FROM OLD.intake_state
    AND NEW.confirmation_snapshot IS NOT DISTINCT FROM OLD.confirmation_snapshot
    AND (NEW.confirmation_attempt_id IS NOT DISTINCT FROM OLD.confirmation_attempt_id
      OR (attempt_absent AND NEW.confirmation_attempt_id IS NULL))
    AND NEW.revision IN (OLD.revision,OLD.revision+1) THEN
    NEW.observed_payload := NULL;
    NEW.content_state := 'purged';
    NEW.revision := OLD.revision+1;
    RETURN NEW;
  END IF;

  IF attempt_absent AND NEW.confirmation_attempt_id IS NULL
    AND ROW(NEW.owned_message_id,NEW.observed_payload,NEW.content_state,NEW.intake_state,NEW.confirmation_snapshot)
      IS NOT DISTINCT FROM
      ROW(OLD.owned_message_id,OLD.observed_payload,OLD.content_state,OLD.intake_state,OLD.confirmation_snapshot)
    AND NEW.revision IN (OLD.revision,OLD.revision+1) THEN
    NEW.revision := OLD.revision+1;
    RETURN NEW;
  END IF;

  IF NEW.revision IS DISTINCT FROM OLD.revision+1
    OR ROW(NEW.owned_message_id,NEW.observed_payload,NEW.content_state)
      IS DISTINCT FROM ROW(OLD.owned_message_id,OLD.observed_payload,OLD.content_state) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake revision or content transition is invalid';
  END IF;

  -- Reviews advance only the ledger revision, leaving evidence and receipt facts intact.
  IF ROW(NEW.intake_state,NEW.confirmation_attempt_id,NEW.confirmation_snapshot)
      IS NOT DISTINCT FROM ROW(OLD.intake_state,OLD.confirmation_attempt_id,OLD.confirmation_snapshot) THEN
    RETURN NEW;
  END IF;
  IF OLD.intake_state='unverified' AND NEW.intake_state='conflict'
    AND NEW.confirmation_attempt_id IS NULL AND NEW.confirmation_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.intake_state='unverified' AND NEW.intake_state='confirmed_notification'
    AND OLD.confirmation_attempt_id IS NULL AND OLD.confirmation_snapshot IS NULL
    AND NEW.confirmation_attempt_id IS NOT NULL AND NEW.confirmation_snapshot IS NOT NULL
    AND NEW.provider='gmail' AND NEW.content_state='retained' THEN
    PERFORM public.private_intake_assert_owned_v1(OLD::public.email_private_intake);
    SELECT EXISTS (
      SELECT 1 FROM public.email_send_attempts s JOIN public.email_accounts a ON a.id=s.account_id
      WHERE s.id=NEW.confirmation_attempt_id AND s.account_id=NEW.account_id AND a.provider='gmail'
        AND s.status='sent' AND s.payload_prepared AND s.thread_id IS NULL
        AND s.send_started_at IS NOT NULL AND s.sent_at IS NOT NULL
        AND s.gmail_message_id=NEW.observed_provider_id AND s.provider_message_id=s.gmail_message_id
        AND s.payload->'systemPurpose'=jsonb_build_object('version',1,'kind','notification',
          'notificationId',s.idempotency_key::text,'recipientUserId',a.user_id::text)
        AND s.delivery_outcome=jsonb_build_object('version',1,'provider','gmail','state','accepted',
          'evidence','api_ack','providerMessageId',s.gmail_message_id)
        AND NEW.confirmation_snapshot=jsonb_build_object('version',1,'accountId',s.account_id::text,
          'attemptId',s.id::text,'providerMessageId',s.gmail_message_id,
          'payloadHash',public.private_intake_hash_v1(s.payload))
      FOR SHARE OF s
    ) INTO proof_exists;
    IF proof_exists AND NOT EXISTS (
        SELECT 1 FROM public.email_messages m WHERE m.account_id=NEW.account_id
          AND m.id<>NEW.owned_message_id
          AND (m.gmail_message_id=NEW.observed_provider_id OR m.provider_message_id=NEW.observed_provider_id)
      ) AND NOT EXISTS (
        SELECT 1 FROM public.email_threads t WHERE t.account_id=NEW.account_id
          AND t.id<>NEW.baseline_thread_id
          AND t.provider_thread_id='notification:' || NEW.confirmation_attempt_id::text
      ) THEN
      -- The native transaction now promotes only these locked owned rows, keeping UUIDs.
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake confirmation is not authoritative';
END;
$email_private_intake_guard$;
--> statement-breakpoint

CREATE TRIGGER email_private_intake_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.email_private_intake
FOR EACH ROW EXECUTE FUNCTION public.email_private_intake_guard();
--> statement-breakpoint

CREATE FUNCTION public.email_private_intake_review_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $email_private_intake_review_guard$
DECLARE
  current_revision integer;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT i.revision INTO current_revision FROM public.email_private_intake i
      WHERE i.id=NEW.intake_id AND i.account_id=NEW.account_id FOR UPDATE;
    IF NOT FOUND OR NEW.revision<=0 OR NEW.revision IS DISTINCT FROM current_revision
      OR NEW.actor_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.email_accounts a JOIN public.users u ON u.id=a.user_id
        WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id AND u.is_active AND u.invited_at IS NULL
      ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake review revision or actor is invalid';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
      AND ROW(NEW.intake_id,NEW.account_id,NEW.revision,NEW.decision,NEW.created_at)
        IS NOT DISTINCT FROM ROW(OLD.intake_id,OLD.account_id,OLD.revision,OLD.decision,OLD.created_at)
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE id=OLD.actor_id) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP='DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.email_accounts WHERE id=OLD.account_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='private intake review history is immutable';
END;
$email_private_intake_review_guard$;
--> statement-breakpoint

CREATE TRIGGER email_private_intake_reviews_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.email_private_intake_reviews
FOR EACH ROW EXECUTE FUNCTION public.email_private_intake_review_guard();
