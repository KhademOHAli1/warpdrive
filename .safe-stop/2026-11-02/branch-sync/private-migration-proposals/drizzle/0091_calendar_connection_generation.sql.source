ALTER TABLE "calendar_oauth_attempts" ADD COLUMN "account_connection_generation" integer;--> statement-breakpoint
ALTER TABLE "calendar_oauth_attempts" ADD COLUMN "account_connection_generations" jsonb;--> statement-breakpoint
ALTER TABLE "calendar_provider_accounts" ADD COLUMN "connection_generation" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- A consumed callback can still be exchanging its code. Retire every old attempt,
-- including cancelled rows with leftover verifier material, before activating new code.
UPDATE calendar_oauth_attempts
SET cancelled_at = COALESCE(cancelled_at, transaction_timestamp()),
    code_verifier_enc = NULL
WHERE cancelled_at IS NULL OR code_verifier_enc IS NOT NULL;
