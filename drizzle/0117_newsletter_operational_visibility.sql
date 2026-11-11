ALTER TYPE "public"."notification_type" ADD VALUE 'newsletter_operational';--> statement-breakpoint
CREATE TABLE "newsletter_operational_receipts" (
	"engine_key" text NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_operational_receipts_pkey" PRIMARY KEY("engine_key","event_id"),
	CONSTRAINT "newsletter_operational_receipt_engine_ck" CHECK ("newsletter_operational_receipts"."engine_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "newsletter_operational_receipt_at_ck" CHECK (char_length("newsletter_operational_receipts"."occurred_at") between 20 and 40),
	CONSTRAINT "newsletter_operational_receipt_kind_ck" CHECK ("newsletter_operational_receipts"."kind" IN ('delivery.failed','delivery.uncertain','delivery.resolved','feedback.bounce','feedback.complaint')),
	CONSTRAINT "newsletter_operational_receipt_reason_ck" CHECK ("newsletter_operational_receipts"."reason" IN ('delivery_rejected','submission_unknown','operator_accepted','operator_rejected','provider_accepted','hard_bounce','soft_bounce','unmatched_bounce','complaint','unmatched_complaint'))
);
--> statement-breakpoint
CREATE TABLE "newsletter_operational_state" (
	"engine_key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"incident_open" boolean DEFAULT false NOT NULL,
	"problem" text,
	"last_polled_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_operational_engine_key_ck" CHECK ("newsletter_operational_state"."engine_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "newsletter_operational_fingerprint_ck" CHECK (char_length("newsletter_operational_state"."fingerprint") between 1 and 160 AND "newsletter_operational_state"."fingerprint" ~ '^[a-z_/]+$'),
	CONSTRAINT "newsletter_operational_problem_ck" CHECK ("newsletter_operational_state"."problem" IS NULL OR (char_length("newsletter_operational_state"."problem") between 1 and 160 AND "newsletter_operational_state"."problem" ~ '^[a-z_/]+$'))
);
