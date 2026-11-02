CREATE TABLE "privacy_deadline_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"input_digest" text NOT NULL,
	"result_enc" "bytea" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_deadline_records" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"policy_version" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"original_due_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"snapshot_enc" "bytea" NOT NULL,
	"extension_months" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_deadline_version" CHECK ("privacy_deadline_records"."version" > 0 AND "privacy_deadline_records"."extension_months" >= 0),
	CONSTRAINT "privacy_deadline_instants" CHECK ("privacy_deadline_records"."original_due_at" > "privacy_deadline_records"."received_at" AND "privacy_deadline_records"."due_at" >= "privacy_deadline_records"."original_due_at")
);
--> statement-breakpoint
CREATE TABLE "privacy_policy_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content_enc" "bytea" NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_policy_draft_revision" CHECK ("privacy_policy_drafts"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_policy_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"version" integer,
	"generation" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_policy_state_singleton" CHECK ("privacy_policy_state"."id" = true),
	CONSTRAINT "privacy_policy_state_generation" CHECK ("privacy_policy_state"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_policy_versions" (
	"version" integer PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"draft_revision" integer NOT NULL,
	"profile_enc" "bytea" NOT NULL,
	"review_enc" "bytea" NOT NULL,
	"activated_by" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_policy_version" CHECK ("privacy_policy_versions"."version" > 0 AND "privacy_policy_versions"."draft_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "privacy_jobs" DROP CONSTRAINT "privacy_job_kind";--> statement-breakpoint
ALTER TABLE "privacy_jobs" DROP CONSTRAINT "privacy_job_versions";--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD COLUMN "active_policy_version" integer;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD COLUMN "policy_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_deadline_decisions" ADD CONSTRAINT "privacy_deadline_decisions_case_id_privacy_deadline_records_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."privacy_deadline_records"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_deadline_decisions" ADD CONSTRAINT "privacy_deadline_decisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_deadline_records" ADD CONSTRAINT "privacy_deadline_records_case_id_privacy_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."privacy_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_deadline_records" ADD CONSTRAINT "privacy_deadline_records_policy_version_privacy_policy_versions_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."privacy_policy_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy_drafts" ADD CONSTRAINT "privacy_policy_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy_drafts" ADD CONSTRAINT "privacy_policy_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy_state" ADD CONSTRAINT "privacy_policy_state_version_privacy_policy_versions_version_fk" FOREIGN KEY ("version") REFERENCES "public"."privacy_policy_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy_state" ADD CONSTRAINT "privacy_policy_state_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy_versions" ADD CONSTRAINT "privacy_policy_versions_draft_id_privacy_policy_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."privacy_policy_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_policy_versions" ADD CONSTRAINT "privacy_policy_versions_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_deadline_command_uq" ON "privacy_deadline_decisions" USING btree ("case_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_policy_draft_activation_uq" ON "privacy_policy_versions" USING btree ("draft_id","draft_revision");--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_job_kind" CHECK ("privacy_jobs"."kind" IN ('discovery','export','erasure','closure','correction','restriction','retention'));--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_job_versions" CHECK ("privacy_jobs"."authority_generation" > 0 AND "privacy_jobs"."member_generation" > 0 AND "privacy_jobs"."scope_version" > 0 AND "privacy_jobs"."recipient_version" > 0 AND "privacy_jobs"."verification_version" > 0 AND ("privacy_jobs"."policy_version" IS NULL OR "privacy_jobs"."policy_version" > 0) AND ("privacy_jobs"."active_policy_version" IS NULL OR "privacy_jobs"."active_policy_version" > 0) AND "privacy_jobs"."policy_generation" >= 0 AND "privacy_jobs"."attempts" >= 0);--> statement-breakpoint
CREATE FUNCTION privacy_preserve_policy_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activated privacy policy revisions are immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER privacy_policy_revision_immutable BEFORE UPDATE OR DELETE ON privacy_policy_versions
FOR EACH ROW EXECUTE FUNCTION privacy_preserve_policy_revision();--> statement-breakpoint
CREATE FUNCTION privacy_preserve_deadline_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
    OR NEW.original_due_at IS DISTINCT FROM OLD.original_due_at THEN
    RAISE EXCEPTION 'privacy deadline origin is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER privacy_deadline_origin_immutable BEFORE UPDATE ON privacy_deadline_records
FOR EACH ROW EXECUTE FUNCTION privacy_preserve_deadline_origin();--> statement-breakpoint
CREATE FUNCTION privacy_preserve_deadline_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'privacy deadline decisions are immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER privacy_deadline_decision_immutable BEFORE UPDATE OR DELETE ON privacy_deadline_decisions
FOR EACH ROW EXECUTE FUNCTION privacy_preserve_deadline_decision();
