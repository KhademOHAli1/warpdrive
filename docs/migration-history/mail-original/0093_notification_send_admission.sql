ALTER TABLE "email_send_attempts" ADD COLUMN "notification_suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_send_attempts" ADD COLUMN "notification_suppression_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_send_attempts_notification_purpose_uq" ON "email_send_attempts" USING btree (("payload"->'systemPurpose'->>'notificationId'),("payload"->'systemPurpose'->>'recipientUserId')) WHERE "email_send_attempts"."payload"->'systemPurpose'->>'kind'='notification'
        AND "email_send_attempts"."payload"->'systemPurpose'->>'version'='1';--> statement-breakpoint
ALTER TABLE "email_send_attempts" ADD CONSTRAINT "email_attempt_notification_suppression_pair" CHECK ((("email_send_attempts"."notification_suppressed_at" IS NULL AND "email_send_attempts"."notification_suppression_reason" IS NULL)
        OR ("email_send_attempts"."notification_suppressed_at" IS NOT NULL AND "email_send_attempts"."notification_suppression_reason"
          IN ('preference_disabled', 'entity_unavailable', 'recipient_unavailable', 'notification_unavailable', 'purpose_invalid'))) IS TRUE);