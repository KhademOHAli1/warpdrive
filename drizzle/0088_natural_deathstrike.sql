ALTER TABLE "email_accounts" DROP CONSTRAINT "email_accounts_user_id_unique";--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "provider" text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "connection_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "credentials_enc" "bytea";--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "connection_settings" jsonb;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "history_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "folder_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "capabilities" jsonb DEFAULT '{"read":true,"send":true,"markRead":false,"move":false,"trash":true}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "email_accounts" SET "is_default" = true;--> statement-breakpoint
CREATE INDEX "email_accounts_owner_idx" ON "email_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_default_owner_uq" ON "email_accounts" USING btree ("user_id") WHERE "email_accounts"."is_default" = true;