ALTER TABLE "newsletter_person_events" DROP CONSTRAINT "newsletter_person_event_type_ck";--> statement-breakpoint
ALTER TABLE "newsletter_person_events" ADD COLUMN "grant_id" uuid;--> statement-breakpoint
ALTER TABLE "newsletter_person_events" ADD COLUMN "source_digest" text;--> statement-breakpoint
ALTER TABLE "newsletter_person_events" ADD CONSTRAINT "newsletter_person_revocation_scope_ck" CHECK (("newsletter_person_events"."event" = 'newsletter.consent.revoked' AND "newsletter_person_events"."grant_id" IS NOT NULL AND "newsletter_person_events"."source_digest" IS NOT NULL AND "newsletter_person_events"."source_digest" ~ '^[0-9a-f]{64}$')
        OR ("newsletter_person_events"."event" <> 'newsletter.consent.revoked' AND "newsletter_person_events"."grant_id" IS NULL AND "newsletter_person_events"."source_digest" IS NULL));--> statement-breakpoint
ALTER TABLE "newsletter_person_events" ADD CONSTRAINT "newsletter_person_event_type_ck" CHECK (
      ("newsletter_person_events"."event" = 'newsletter.identity.verified' AND "newsletter_person_events"."list_id" IS NULL)
      OR ("newsletter_person_events"."event" IN ('newsletter.consent.confirmed', 'newsletter.consent.revoked') AND "newsletter_person_events"."list_id" IS NOT NULL AND "newsletter_person_events"."list_id" > 0)
    );