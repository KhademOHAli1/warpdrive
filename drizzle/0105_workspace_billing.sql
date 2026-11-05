CREATE TABLE "billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'workspace' NOT NULL,
	"livemode" boolean NOT NULL,
	"customer_id" text,
	"checkout_operation_id" uuid,
	"seat_operation_id" uuid,
	"subscription" jsonb,
	"sync_state" text DEFAULT 'never' NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "billing_accounts_scope_check" CHECK ("billing_accounts"."scope" = 'workspace'),
	CONSTRAINT "billing_accounts_sync_check" CHECK ("billing_accounts"."sync_state" IN ('never', 'current', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "billing_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"resource_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "billing_operations_kind_check" CHECK ("billing_operations"."kind" IN ('customer', 'checkout', 'seats'))
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_receipts" (
	"event_id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"digest" text NOT NULL,
	"provider_created" integer NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_webhook_receipts" ADD CONSTRAINT "billing_webhook_receipts_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_scope_mode_uq" ON "billing_accounts" USING btree ("scope","livemode");--> statement-breakpoint
CREATE INDEX "billing_audit_account_idx" ON "billing_audit_events" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_operations_request_uq" ON "billing_operations" USING btree ("account_id","kind","request_key");--> statement-breakpoint
CREATE INDEX "billing_webhook_account_idx" ON "billing_webhook_receipts" USING btree ("account_id");