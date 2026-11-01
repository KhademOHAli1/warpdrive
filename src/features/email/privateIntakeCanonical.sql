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
