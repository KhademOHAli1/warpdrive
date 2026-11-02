ALTER TABLE "email_send_attempts" ADD CONSTRAINT "email_send_attempts_id_account_uq" UNIQUE("id","account_id");--> statement-breakpoint
CREATE TABLE "email_delivery_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"part_key" text NOT NULL,
	"media_type" text NOT NULL,
	"provenance" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_bytes" integer NOT NULL,
	"parsed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_reports_id_account_uq" UNIQUE("id","account_id"),
	CONSTRAINT "email_delivery_reports_source_part_uq" UNIQUE("account_id","source_message_id","part_key"),
	CONSTRAINT "email_delivery_report_part_key" CHECK (octet_length("email_delivery_reports"."part_key") BETWEEN 1 AND 2048
        AND "email_delivery_reports"."part_key" ~ '^[0-9]+([.!][0-9]+)*$'),
	CONSTRAINT "email_delivery_report_media_type" CHECK ("email_delivery_reports"."media_type" IN ('message/delivery-status','message/global-delivery-status')),
	CONSTRAINT "email_delivery_report_provenance" CHECK ("email_delivery_reports"."provenance" IN ('direct','nested','forwarded')),
	CONSTRAINT "email_delivery_report_content_hash" CHECK ("email_delivery_reports"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "email_delivery_report_content_bytes" CHECK ("email_delivery_reports"."content_bytes" BETWEEN 1 AND 131072),
	CONSTRAINT "email_delivery_report_untrusted_shape" CHECK ((jsonb_typeof("email_delivery_reports"."parsed")='object'
        AND octet_length("email_delivery_reports"."parsed"::text) <= 1048576
        AND "email_delivery_reports"."parsed"->>'trust'='unverified'
        AND "email_delivery_reports"."parsed"->'requiresReview'='true'::jsonb
        AND "email_delivery_reports"."parsed"->'correlationAuthority'='false'::jsonb
        AND "email_delivery_reports"."parsed"->>'mediaType'="email_delivery_reports"."media_type"
        AND "email_delivery_reports"."parsed"->>'provenance'="email_delivery_reports"."provenance"
        AND jsonb_typeof("email_delivery_reports"."parsed"->'recipients')='array'
        AND jsonb_array_length("email_delivery_reports"."parsed"->'recipients') BETWEEN 1 AND 100) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE "email_delivery_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"recipient_index" integer NOT NULL,
	"revision" integer NOT NULL,
	"decision" text NOT NULL,
	"attempt_id" uuid,
	"recipient_snapshot" jsonb,
	"attempt_snapshot_hash" text,
	"reviewer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_review_revision_uq" UNIQUE("report_id","recipient_index","revision"),
	CONSTRAINT "email_delivery_review_recipient_index" CHECK ("email_delivery_reviews"."recipient_index" >= 0 AND "email_delivery_reviews"."recipient_index" < 100),
	CONSTRAINT "email_delivery_review_revision" CHECK ("email_delivery_reviews"."revision" > 0),
	CONSTRAINT "email_delivery_review_decision" CHECK ("email_delivery_reviews"."decision" IN ('associate','dismiss')),
	CONSTRAINT "email_delivery_review_target_shape" CHECK ((("email_delivery_reviews"."decision"='dismiss' AND "email_delivery_reviews"."attempt_id" IS NULL
        AND "email_delivery_reviews"."recipient_snapshot" IS NULL AND "email_delivery_reviews"."attempt_snapshot_hash" IS NULL)
        OR ("email_delivery_reviews"."decision"='associate'
          AND "email_delivery_reviews"."attempt_snapshot_hash" IS NOT NULL
          AND "email_delivery_reviews"."recipient_snapshot" IS NOT NULL
          AND "email_delivery_reviews"."attempt_snapshot_hash" ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof("email_delivery_reviews"."recipient_snapshot")='object'
          AND octet_length("email_delivery_reviews"."recipient_snapshot"::text) <= 4096
          AND "email_delivery_reviews"."recipient_snapshot" ?& ARRAY['address','kind']
          AND ("email_delivery_reviews"."recipient_snapshot"-'address'-'kind')='{}'::jsonb
          AND jsonb_typeof("email_delivery_reviews"."recipient_snapshot"->'address')='string'
          AND length("email_delivery_reviews"."recipient_snapshot"->>'address') > 0
          AND position(chr(10) in "email_delivery_reviews"."recipient_snapshot"->>'address')=0
          AND position(chr(13) in "email_delivery_reviews"."recipient_snapshot"->>'address')=0
          AND "email_delivery_reviews"."recipient_snapshot"->>'kind' IN ('to','cc','bcc'))) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "email_delivery_reports" ADD CONSTRAINT "email_delivery_reports_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_reports" ADD CONSTRAINT "email_delivery_report_source_same_account_fk" FOREIGN KEY ("source_message_id","account_id") REFERENCES "public"."email_messages"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_reviews" ADD CONSTRAINT "email_delivery_reviews_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_reviews" ADD CONSTRAINT "email_delivery_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_reviews" ADD CONSTRAINT "email_delivery_review_report_same_account_fk" FOREIGN KEY ("report_id","account_id") REFERENCES "public"."email_delivery_reports"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_reviews" ADD CONSTRAINT "email_delivery_review_attempt_same_account_fk" FOREIGN KEY ("attempt_id","account_id") REFERENCES "public"."email_send_attempts"("id","account_id") ON DELETE SET NULL ("attempt_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_delivery_review_attempt_idx" ON "email_delivery_reviews" USING btree ("account_id","attempt_id");
--> statement-breakpoint
-- Evidence removal is restricted to its source/account privacy cascade.
CREATE FUNCTION public.email_delivery_report_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $delivery_report_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 AND (
      NOT EXISTS (SELECT 1 FROM public.email_accounts WHERE id = OLD.account_id)
      OR NOT EXISTS (
        SELECT 1 FROM public.email_messages
        WHERE id = OLD.source_message_id AND account_id = OLD.account_id
      )
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'delivery report evidence is immutable';
END;
$delivery_report_guard$;
--> statement-breakpoint
CREATE TRIGGER email_delivery_reports_immutable
BEFORE UPDATE OR DELETE ON public.email_delivery_reports
FOR EACH ROW EXECUTE FUNCTION public.email_delivery_report_guard();
--> statement-breakpoint
-- Target purge clears only the FK pointer, never the verdict, snapshot or CAS revision.
CREATE FUNCTION public.email_delivery_review_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $delivery_review_guard$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF pg_trigger_depth() > 1
      AND OLD.attempt_id IS NOT NULL
      AND NEW.attempt_id IS NULL
      AND (to_jsonb(NEW) - 'attempt_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'attempt_id')
      AND NOT EXISTS (
        SELECT 1 FROM public.email_send_attempts
        WHERE id = OLD.attempt_id AND account_id = OLD.account_id
      ) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 AND (
      NOT EXISTS (SELECT 1 FROM public.email_accounts WHERE id = OLD.account_id)
      OR NOT EXISTS (
        SELECT 1 FROM public.email_delivery_reports
        WHERE id = OLD.report_id AND account_id = OLD.account_id
      )
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'delivery review history is immutable';
END;
$delivery_review_guard$;
--> statement-breakpoint
CREATE TRIGGER email_delivery_reviews_immutable
BEFORE UPDATE OR DELETE ON public.email_delivery_reviews
FOR EACH ROW EXECUTE FUNCTION public.email_delivery_review_guard();
