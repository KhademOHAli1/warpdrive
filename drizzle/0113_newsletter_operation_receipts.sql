CREATE TABLE "newsletter_operation_receipts" (
	"actor_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"intent_version" smallint DEFAULT 1 NOT NULL,
	"intent_fingerprint" "bytea" NOT NULL,
	"state" text DEFAULT 'admitted' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"finished_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"resolution_outcome" text,
	"evidence_source" text,
	"evidence_reference" text,
	CONSTRAINT "newsletter_operation_receipts_pkey" PRIMARY KEY("actor_id","operation_id"),
	CONSTRAINT "newsletter_receipt_operation_ck" CHECK ("newsletter_operation_receipts"."operation" ~ '^[a-z][a-zA-Z]*[.][a-z][a-zA-Z]*$' AND char_length("newsletter_operation_receipts"."operation") <= 80),
	CONSTRAINT "newsletter_receipt_intent_version_ck" CHECK ("newsletter_operation_receipts"."intent_version" = 1),
	CONSTRAINT "newsletter_receipt_fingerprint_ck" CHECK (octet_length("newsletter_operation_receipts"."intent_fingerprint") = 32),
	CONSTRAINT "newsletter_receipt_state_ck" CHECK (
      ("newsletter_operation_receipts"."state" = 'admitted' AND "newsletter_operation_receipts"."finished_at" IS NULL AND "newsletter_operation_receipts"."result" IS NULL)
      OR ("newsletter_operation_receipts"."state" IN ('failed', 'unknown') AND "newsletter_operation_receipts"."finished_at" IS NOT NULL AND "newsletter_operation_receipts"."result" IS NULL)
      OR ("newsletter_operation_receipts"."state" = 'succeeded' AND "newsletter_operation_receipts"."finished_at" IS NOT NULL AND "newsletter_operation_receipts"."result" IS NOT NULL
        AND jsonb_typeof("newsletter_operation_receipts"."result") = 'object' AND octet_length("newsletter_operation_receipts"."result"::text) <= 128)
    ),
	CONSTRAINT "newsletter_receipt_resolution_ck" CHECK (
      ("newsletter_operation_receipts"."reviewed_at" IS NULL AND "newsletter_operation_receipts"."resolution_outcome" IS NULL
        AND "newsletter_operation_receipts"."evidence_source" IS NULL AND "newsletter_operation_receipts"."evidence_reference" IS NULL)
      OR ("newsletter_operation_receipts"."state" IN ('admitted', 'unknown') AND "newsletter_operation_receipts"."reviewed_at" IS NOT NULL
        AND "newsletter_operation_receipts"."resolution_outcome" IS NOT NULL AND "newsletter_operation_receipts"."resolution_outcome" IN ('applied', 'notApplied')
        AND "newsletter_operation_receipts"."evidence_source" IS NOT NULL AND "newsletter_operation_receipts"."evidence_source" IN ('engineRecord', 'engineLog', 'deliveryLog', 'importStatus')
        AND "newsletter_operation_receipts"."evidence_reference" IS NOT NULL AND "newsletter_operation_receipts"."evidence_reference" ~
          '^([1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$')
    )
);
--> statement-breakpoint
CREATE INDEX "newsletter_receipts_state_created_idx" ON "newsletter_operation_receipts" USING btree ("state","created_at");