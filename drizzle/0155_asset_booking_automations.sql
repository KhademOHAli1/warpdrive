CREATE TABLE "asset_booking_automation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"actor_id" uuid,
	CONSTRAINT "asset_booking_automation_attempt_ordinal_key" UNIQUE("run_id","ordinal"),
	CONSTRAINT "asset_booking_automation_attempt_outcome_check" CHECK ("asset_booking_automation_attempts"."ordinal" > 0 AND CASE "asset_booking_automation_attempts"."outcome"
      WHEN 'delivered' THEN "asset_booking_automation_attempts"."reason" IS NULL
      WHEN 'failed' THEN "asset_booking_automation_attempts"."reason" IS NOT DISTINCT FROM 'temporary'
      WHEN 'skipped' THEN "asset_booking_automation_attempts"."reason" IS NOT NULL AND "asset_booking_automation_attempts"."reason" IN ('recipient_unavailable','rule_disabled','superseded')
      ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "asset_booking_automation_profiles" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"principal_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"sent_back_enabled_at" timestamp with time zone,
	"overdue_enabled_at" timestamp with time zone,
	"pickup_expired_enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_booking_automation_principal_key" UNIQUE("principal_id"),
	CONSTRAINT "asset_booking_automation_site_principal_key" UNIQUE("site_id","principal_id"),
	CONSTRAINT "asset_booking_automation_profile_revision_check" CHECK ("asset_booking_automation_profiles"."version" > 0 AND "asset_booking_automation_profiles"."created_at" <= "asset_booking_automation_profiles"."updated_at"
      AND ("asset_booking_automation_profiles"."sent_back_enabled_at" IS NULL OR "asset_booking_automation_profiles"."sent_back_enabled_at" BETWEEN "asset_booking_automation_profiles"."created_at" AND "asset_booking_automation_profiles"."updated_at")
      AND ("asset_booking_automation_profiles"."overdue_enabled_at" IS NULL OR "asset_booking_automation_profiles"."overdue_enabled_at" BETWEEN "asset_booking_automation_profiles"."created_at" AND "asset_booking_automation_profiles"."updated_at")
      AND ("asset_booking_automation_profiles"."pickup_expired_enabled_at" IS NULL OR "asset_booking_automation_profiles"."pickup_expired_enabled_at" BETWEEN "asset_booking_automation_profiles"."created_at" AND "asset_booking_automation_profiles"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "asset_booking_automation_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"request_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"run_id" uuid,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_booking_automation_receipt_actor_request_key" UNIQUE("actor_id","request_id"),
	CONSTRAINT "asset_booking_automation_receipt_check" CHECK ("asset_booking_automation_receipts"."fingerprint" ~ '^[0-9a-f]{64}$' AND (
      ("asset_booking_automation_receipts"."kind" = 'save_profile' AND "asset_booking_automation_receipts"."run_id" IS NULL) OR ("asset_booking_automation_receipts"."kind" = 'retry' AND "asset_booking_automation_receipts"."run_id" IS NOT NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "asset_booking_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"recipient_id" uuid,
	"trigger" text NOT NULL,
	"source_version" integer,
	"due_at" timestamp with time zone,
	"handover_kind" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "asset_booking_automation_run_site_key" UNIQUE("site_id","id"),
	CONSTRAINT "asset_booking_automation_run_state_check" CHECK ("asset_booking_automation_runs"."state" IN ('pending','delivered','failed','skipped')),
	CONSTRAINT "asset_booking_automation_run_source_check" CHECK (CASE "asset_booking_automation_runs"."trigger"
      WHEN 'request_sent_back' THEN "asset_booking_automation_runs"."source_version" IS NOT NULL AND "asset_booking_automation_runs"."source_version" > 0
        AND "asset_booking_automation_runs"."due_at" IS NULL AND "asset_booking_automation_runs"."handover_kind" IS NULL
      WHEN 'return_overdue' THEN "asset_booking_automation_runs"."source_version" IS NULL AND "asset_booking_automation_runs"."due_at" IS NOT NULL AND "asset_booking_automation_runs"."due_at" <= "asset_booking_automation_runs"."scheduled_at"
        AND "asset_booking_automation_runs"."handover_kind" IS NOT DISTINCT FROM 'overdue'
      WHEN 'pickup_expired' THEN "asset_booking_automation_runs"."source_version" IS NULL AND "asset_booking_automation_runs"."due_at" IS NOT NULL AND "asset_booking_automation_runs"."due_at" <= "asset_booking_automation_runs"."scheduled_at"
        AND "asset_booking_automation_runs"."handover_kind" IS NOT DISTINCT FROM 'expired'
      ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "asset_booking_automation_attempts" ADD CONSTRAINT "asset_booking_automation_attempts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_attempts" ADD CONSTRAINT "asset_booking_automation_attempt_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."asset_booking_automation_runs"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_profiles" ADD CONSTRAINT "asset_booking_automation_profiles_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_receipts" ADD CONSTRAINT "asset_booking_automation_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_receipts" ADD CONSTRAINT "asset_booking_automation_receipts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_receipts" ADD CONSTRAINT "asset_booking_automation_receipt_run_fk" FOREIGN KEY ("site_id","run_id") REFERENCES "public"."asset_booking_automation_runs"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_runs" ADD CONSTRAINT "asset_booking_automation_runs_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_runs" ADD CONSTRAINT "asset_booking_automation_run_principal_fk" FOREIGN KEY ("site_id","principal_id") REFERENCES "public"."asset_booking_automation_profiles"("site_id","principal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_runs" ADD CONSTRAINT "asset_booking_automation_run_booking_fk" FOREIGN KEY ("site_id","booking_id") REFERENCES "public"."asset_bookings"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_runs" ADD CONSTRAINT "asset_booking_automation_run_review_fk" FOREIGN KEY ("booking_id","source_version") REFERENCES "public"."asset_booking_events"("booking_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_booking_automation_runs" ADD CONSTRAINT "asset_booking_automation_run_handover_fk" FOREIGN KEY ("booking_id","due_at","handover_kind") REFERENCES "public"."asset_booking_handover_notices"("booking_id","due_at","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_booking_automation_attempt_delivered_key" ON "asset_booking_automation_attempts" USING btree ("run_id") WHERE "asset_booking_automation_attempts"."outcome" = 'delivered';--> statement-breakpoint
CREATE UNIQUE INDEX "asset_booking_automation_review_source_key" ON "asset_booking_automation_runs" USING btree ("booking_id","source_version") WHERE "asset_booking_automation_runs"."source_version" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_booking_automation_handover_source_key" ON "asset_booking_automation_runs" USING btree ("booking_id","due_at","handover_kind") WHERE "asset_booking_automation_runs"."due_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_booking_automation_runs_site_idx" ON "asset_booking_automation_runs" USING btree ("site_id","scheduled_at","id");--> statement-breakpoint
CREATE INDEX "asset_booking_automation_runs_pending_idx" ON "asset_booking_automation_runs" USING btree ("scheduled_at","id") WHERE "asset_booking_automation_runs"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "asset_booking_automation_runs_recipient_idx" ON "asset_booking_automation_runs" USING btree ("recipient_id","booking_id","id") WHERE "asset_booking_automation_runs"."state" = 'delivered';
--> statement-breakpoint
CREATE FUNCTION public.guard_booking_automation_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Booking automation site principals are retained' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.directory_sites WHERE id = NEW.site_id AND NOT archived) THEN
    RAISE EXCEPTION 'Booking automation profiles require an active site' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.created_at IS DISTINCT FROM NEW.updated_at
      OR (NEW.sent_back_enabled_at IS NOT NULL AND NEW.sent_back_enabled_at IS DISTINCT FROM NEW.updated_at)
      OR (NEW.overdue_enabled_at IS NOT NULL AND NEW.overdue_enabled_at IS DISTINCT FROM NEW.updated_at)
      OR (NEW.pickup_expired_enabled_at IS NOT NULL AND NEW.pickup_expired_enabled_at IS DISTINCT FROM NEW.updated_at) THEN
      RAISE EXCEPTION 'Booking automation site principals start at version one' USING ERRCODE = '23514';
    END IF;
  ELSIF (NEW.site_id, NEW.principal_id, NEW.created_at)
      IS DISTINCT FROM (OLD.site_id, OLD.principal_id, OLD.created_at)
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at
    OR (NEW.sent_back_enabled_at IS NOT NULL AND NEW.sent_back_enabled_at IS DISTINCT FROM coalesce(OLD.sent_back_enabled_at, NEW.updated_at))
    OR (NEW.overdue_enabled_at IS NOT NULL AND NEW.overdue_enabled_at IS DISTINCT FROM coalesce(OLD.overdue_enabled_at, NEW.updated_at))
    OR (NEW.pickup_expired_enabled_at IS NOT NULL AND NEW.pickup_expired_enabled_at IS DISTINCT FROM coalesce(OLD.pickup_expired_enabled_at, NEW.updated_at)) THEN
    RAISE EXCEPTION 'Booking automation profile activation must advance with its exact site principal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_profile_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.asset_booking_automation_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_booking_automation_profile();
--> statement-breakpoint
CREATE FUNCTION public.guard_booking_automation_run() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Booking automation runs are retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NOT EXISTS (
      SELECT 1 FROM public.asset_bookings b
      JOIN public.directory_sites s ON s.id = b.site_id AND NOT s.archived
      JOIN public.asset_booking_automation_profiles p ON (p.site_id, p.principal_id) = (NEW.site_id, NEW.principal_id)
      WHERE (b.site_id, b.id) = (NEW.site_id, NEW.booking_id) AND NOT b.archived
        AND b.requester_id IS NOT DISTINCT FROM NEW.recipient_id AND CASE NEW.trigger
          WHEN 'request_sent_back' THEN b.status = 'draft' AND b.version = NEW.source_version
            AND p.created_at <= NEW.scheduled_at AND EXISTS (
              SELECT 1 FROM public.asset_booking_events e
              WHERE (e.site_id, e.booking_id, e.version) = (NEW.site_id, NEW.booking_id, NEW.source_version)
                AND e.kind = 'sent_back'
            )
          WHEN 'return_overdue' THEN b.status = 'confirmed' AND b.end_at = NEW.due_at
            AND p.created_at <= NEW.due_at AND EXISTS (
              SELECT 1 FROM public.asset_booking_handover_notices n
              WHERE (n.site_id, n.booking_id, n.due_at, n.kind, n.at) =
                (NEW.site_id, NEW.booking_id, NEW.due_at, 'overdue', NEW.scheduled_at)
            )
          WHEN 'pickup_expired' THEN b.status = 'confirmed' AND b.end_at = NEW.due_at
            AND p.created_at <= NEW.due_at AND EXISTS (
              SELECT 1 FROM public.asset_booking_handover_notices n
              WHERE (n.site_id, n.booking_id, n.due_at, n.kind, n.at) =
                (NEW.site_id, NEW.booking_id, NEW.due_at, 'expired', NEW.scheduled_at)
            )
          ELSE false END
    ) THEN
      RAISE EXCEPTION 'Booking automation runs require the exact admitted source and recipient' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() > 1 AND OLD.recipient_id IS NOT NULL AND NEW.recipient_id IS NULL
    AND (to_jsonb(NEW) - 'recipient_id') = (to_jsonb(OLD) - 'recipient_id') THEN
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() < 2 OR OLD.state NOT IN ('pending', 'failed')
    OR (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state')
    OR NEW.state IS DISTINCT FROM (
      SELECT a.outcome FROM public.asset_booking_automation_attempts a
      WHERE (a.site_id, a.run_id) = (OLD.site_id, OLD.id)
      ORDER BY a.ordinal DESC LIMIT 1
    ) THEN
    RAISE EXCEPTION 'Booking automation run state is derived from an appended attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_run_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.asset_booking_automation_runs FOR EACH ROW EXECUTE FUNCTION public.guard_booking_automation_run();
--> statement-breakpoint
CREATE FUNCTION public.guard_booking_automation_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE head public.asset_booking_automation_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO head FROM public.asset_booking_automation_runs
    WHERE (site_id, id) = (NEW.site_id, NEW.run_id) FOR UPDATE;
    IF NOT FOUND OR head.state NOT IN ('pending', 'failed') OR NEW.at < head.scheduled_at
      OR NEW.ordinal <> coalesce((
        SELECT max(a.ordinal) FROM public.asset_booking_automation_attempts a
        WHERE (a.site_id, a.run_id) = (NEW.site_id, NEW.run_id)
      ), 0) + 1 THEN
      RAISE EXCEPTION 'Booking automation attempts must advance the exact open or failed run' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Booking automation attempts are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_attempt_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.asset_booking_automation_attempts FOR EACH ROW EXECUTE FUNCTION public.guard_booking_automation_attempt();
--> statement-breakpoint
CREATE FUNCTION public.advance_booking_automation_run() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  UPDATE public.asset_booking_automation_runs SET state = NEW.outcome
  WHERE (site_id, id) = (NEW.site_id, NEW.run_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_attempt_advances AFTER INSERT
ON public.asset_booking_automation_attempts FOR EACH ROW EXECUTE FUNCTION public.advance_booking_automation_run();
--> statement-breakpoint
CREATE FUNCTION public.guard_booking_automation_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
    AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Booking automation receipts are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_receipt_guard BEFORE UPDATE OR DELETE
ON public.asset_booking_automation_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_booking_automation_receipt();
--> statement-breakpoint
CREATE FUNCTION public.capture_booking_sent_back_automation() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
DECLARE captured_at timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.asset_booking_automation_runs (
    site_id, principal_id, booking_id, recipient_id, trigger, source_version, scheduled_at
  )
  SELECT b.site_id, p.principal_id, b.id, b.requester_id, 'request_sent_back', NEW.version, captured_at
  FROM public.asset_bookings b
  JOIN public.directory_sites s ON s.id = b.site_id AND NOT s.archived
  JOIN public.asset_booking_automation_profiles p ON p.site_id = b.site_id
  WHERE (b.site_id, b.id, b.version) = (NEW.site_id, NEW.booking_id, NEW.version)
    AND b.status = 'draft' AND NOT b.archived AND p.created_at <= captured_at
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_capture_sent_back AFTER INSERT ON public.asset_booking_events
FOR EACH ROW WHEN (NEW.kind = 'sent_back') EXECUTE FUNCTION public.capture_booking_sent_back_automation();
--> statement-breakpoint
CREATE FUNCTION public.capture_booking_handover_automation() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, public AS $$
BEGIN
  INSERT INTO public.asset_booking_automation_runs (
    site_id, principal_id, booking_id, recipient_id, trigger, due_at, handover_kind, scheduled_at
  )
  SELECT b.site_id, p.principal_id, b.id, b.requester_id,
    CASE NEW.kind WHEN 'overdue' THEN 'return_overdue' WHEN 'expired' THEN 'pickup_expired' END,
    NEW.due_at, NEW.kind, NEW.at
  FROM public.asset_bookings b
  JOIN public.directory_sites s ON s.id = b.site_id AND NOT s.archived
  JOIN public.asset_booking_automation_profiles p ON p.site_id = b.site_id
  WHERE (b.site_id, b.id, b.end_at) = (NEW.site_id, NEW.booking_id, NEW.due_at)
    AND b.status = 'confirmed' AND NOT b.archived AND p.created_at <= NEW.due_at
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER asset_booking_automation_capture_handover AFTER INSERT ON public.asset_booking_handover_notices
FOR EACH ROW WHEN (NEW.kind IN ('overdue', 'expired')) EXECUTE FUNCTION public.capture_booking_handover_automation();
