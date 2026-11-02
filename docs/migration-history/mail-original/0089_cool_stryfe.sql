ALTER TABLE "email_drafts" ADD COLUMN "bcc_emails" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "attachments" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "send_intent_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "track_opens" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD COLUMN "track_links" boolean DEFAULT false NOT NULL;