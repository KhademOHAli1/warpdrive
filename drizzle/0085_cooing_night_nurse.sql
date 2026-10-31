CREATE TABLE "mail_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"path" text NOT NULL,
	"uid_validity" text,
	"last_uid" bigint DEFAULT 0 NOT NULL,
	"reconcile_after_uid" bigint DEFAULT 0 NOT NULL,
	"history_days" integer DEFAULT 90 NOT NULL,
	"history_since" timestamp with time zone,
	"read_only" boolean,
	"last_sync_at" timestamp with time zone,
	"last_error_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_folders_account_path_uq" UNIQUE("account_id","path"),
	CONSTRAINT "mail_folders_id_account_uq" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "mail_message_locators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"uid_validity" text NOT NULL,
	"uid" bigint NOT NULL,
	"message_id" uuid,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"skipped_reason" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_locators_folder_epoch_uid_uq" UNIQUE("folder_id","uid_validity","uid"),
	CONSTRAINT "mail_locator_uid_positive" CHECK ("mail_message_locators"."uid" > 0 AND "mail_message_locators"."uid" <= 4294967295)
);
--> statement-breakpoint
ALTER TABLE "email_message_attachments" ALTER COLUMN "gmail_attachment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ALTER COLUMN "gmail_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_threads" ALTER COLUMN "gmail_thread_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_message_attachments" ADD COLUMN "provider_locator" jsonb;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "rfc_message_id" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "in_reply_to" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "references" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "message_fingerprint" text;--> statement-breakpoint
ALTER TABLE "email_send_attempts" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "email_send_attempts" ADD COLUMN "connection_generation" integer;--> statement-breakpoint
ALTER TABLE "email_send_attempts" ADD COLUMN "delivery_outcome" jsonb;--> statement-breakpoint
ALTER TABLE "email_threads" ADD COLUMN "provider_thread_id" text;--> statement-breakpoint
ALTER TABLE "mail_folders" ADD CONSTRAINT "mail_folders_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_locators" ADD CONSTRAINT "mail_message_locators_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_locators" ADD CONSTRAINT "mail_locator_folder_same_account_fk" FOREIGN KEY ("folder_id","account_id") REFERENCES "public"."mail_folders"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_id_account_uq" UNIQUE("id","account_id");--> statement-breakpoint
ALTER TABLE "mail_message_locators" ADD CONSTRAINT "mail_locator_message_same_account_fk" FOREIGN KEY ("message_id","account_id") REFERENCES "public"."email_messages"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_locators_message_account_idx" ON "mail_message_locators" USING btree ("message_id","account_id");--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_message_provider_key_uq" UNIQUE("account_id","provider_message_id");--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_message_source_fingerprint_uq" UNIQUE("account_id","message_fingerprint");--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_thread_provider_key_uq" UNIQUE("account_id","provider_thread_id");--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_message_remote_identity_required" CHECK ("email_messages"."provider_message_id" IS NOT NULL OR "email_messages"."gmail_message_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_thread_remote_identity_required" CHECK ("email_threads"."provider_thread_id" IS NOT NULL OR "email_threads"."gmail_thread_id" IS NOT NULL);--> statement-breakpoint
UPDATE "email_threads" SET "provider_thread_id"="gmail_thread_id" WHERE "provider_thread_id" IS NULL AND "gmail_thread_id" IS NOT NULL;--> statement-breakpoint
UPDATE "email_messages" SET "provider_message_id"="gmail_message_id" WHERE "provider_message_id" IS NULL AND "gmail_message_id" IS NOT NULL;--> statement-breakpoint
UPDATE "email_send_attempts" s SET "provider_message_id"=s."gmail_message_id", "connection_generation"=a."connection_generation" FROM "email_accounts" a WHERE a."id"=s."account_id";
