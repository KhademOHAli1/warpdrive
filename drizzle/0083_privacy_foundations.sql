CREATE TABLE "privacy_authority" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_authority_capabilities" CHECK (jsonb_typeof("privacy_authority"."capabilities") = 'array'),
	CONSTRAINT "privacy_authority_generation" CHECK ("privacy_authority"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version" integer NOT NULL,
	"command_id" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"detail_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_case_event_version" CHECK ("privacy_case_events"."case_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_case_members" (
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "privacy_case_members_case_id_user_id_pk" PRIMARY KEY("case_id","user_id"),
	CONSTRAINT "privacy_case_member_capabilities" CHECK (jsonb_typeof("privacy_case_members"."capabilities") = 'array'),
	CONSTRAINT "privacy_case_member_generation" CHECK ("privacy_case_members"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_by" uuid NOT NULL,
	"requester_user_id" uuid,
	"intake_key" text NOT NULL,
	"intake_digest" text NOT NULL,
	"metadata_enc" "bytea" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"scope_version" integer DEFAULT 1 NOT NULL,
	"policy_version" integer,
	"recipient_version" integer DEFAULT 1 NOT NULL,
	"verification_version" integer DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"response_recorded_at" timestamp with time zone,
	"unresolved_obligations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_case_kind" CHECK ("privacy_cases"."kind" IN ('access','portability','correction','restriction','objection','closure','erasure')),
	CONSTRAINT "privacy_case_status" CHECK ("privacy_cases"."status" IN ('received','verification_needed','under_review','action_approved','running','needs_attention','refused','response_ready','responded','closed','cancelled')),
	CONSTRAINT "privacy_case_versions" CHECK ("privacy_cases"."version" > 0 AND "privacy_cases"."scope_version" > 0 AND "privacy_cases"."recipient_version" > 0 AND "privacy_cases"."verification_version" > 0 AND ("privacy_cases"."policy_version" IS NULL OR "privacy_cases"."policy_version" > 0) AND "privacy_cases"."unresolved_obligations" >= 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"originating_session_id" uuid NOT NULL,
	"authority_generation" integer NOT NULL,
	"member_generation" integer NOT NULL,
	"scope_version" integer NOT NULL,
	"policy_version" integer,
	"recipient_version" integer NOT NULL,
	"verification_version" integer NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_enc" "bytea",
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_job_kind" CHECK ("privacy_jobs"."kind" IN ('export','erasure','closure','correction','restriction','retention')),
	CONSTRAINT "privacy_job_status" CHECK ("privacy_jobs"."status" IN ('queued','running','needs_attention','succeeded','failed','cancelled')),
	CONSTRAINT "privacy_job_versions" CHECK ("privacy_jobs"."authority_generation" > 0 AND "privacy_jobs"."member_generation" > 0 AND "privacy_jobs"."scope_version" > 0 AND "privacy_jobs"."recipient_version" > 0 AND "privacy_jobs"."verification_version" > 0 AND ("privacy_jobs"."policy_version" IS NULL OR "privacy_jobs"."policy_version" > 0) AND "privacy_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "privacy_authority" ADD CONSTRAINT "privacy_authority_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_authority" ADD CONSTRAINT "privacy_authority_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_case_events" ADD CONSTRAINT "privacy_case_events_case_id_privacy_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."privacy_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_case_events" ADD CONSTRAINT "privacy_case_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_case_members" ADD CONSTRAINT "privacy_case_members_case_id_privacy_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."privacy_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_case_members" ADD CONSTRAINT "privacy_case_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_cases" ADD CONSTRAINT "privacy_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_cases" ADD CONSTRAINT "privacy_cases_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_case_id_privacy_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."privacy_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_originating_session_id_sessions_id_fk" FOREIGN KEY ("originating_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_case_event_command_uq" ON "privacy_case_events" USING btree ("case_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_case_event_version_uq" ON "privacy_case_events" USING btree ("case_id","case_version");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_case_intake_uq" ON "privacy_cases" USING btree ("created_by","intake_key");--> statement-breakpoint
CREATE INDEX "privacy_case_queue_idx" ON "privacy_cases" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_job_command_uq" ON "privacy_jobs" USING btree ("case_id","kind","idempotency_key");--> statement-breakpoint
CREATE INDEX "privacy_job_claim_idx" ON "privacy_jobs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE FUNCTION privacy_preserve_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.received_at IS DISTINCT FROM OLD.received_at
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.intake_key IS DISTINCT FROM OLD.intake_key
    OR NEW.intake_digest IS DISTINCT FROM OLD.intake_digest THEN
    RAISE EXCEPTION 'privacy receipt is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER privacy_receipt_immutable BEFORE UPDATE ON privacy_cases
FOR EACH ROW EXECUTE FUNCTION privacy_preserve_receipt();--> statement-breakpoint
CREATE FUNCTION privacy_preserve_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Clearing obsolete encrypted detail preserves minimal decision evidence without retaining its content.
  IF TG_OP = 'UPDATE' AND NEW.detail_enc IS NULL
    AND (to_jsonb(NEW) - 'detail_enc') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'detail_enc') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'privacy transition evidence is immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER privacy_event_immutable BEFORE UPDATE OR DELETE ON privacy_case_events
FOR EACH ROW EXECUTE FUNCTION privacy_preserve_event();
