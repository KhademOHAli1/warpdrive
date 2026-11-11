CREATE TABLE "newsletter_identity_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"list_id" integer,
	"origin_run_id" uuid,
	"privacy_case_id" uuid,
	"approved_scope_version" integer,
	"approved_recipient_version" integer,
	"approved_verification_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"state" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "newsletter_identity_command_kind_ck" CHECK (
      ("newsletter_identity_commands"."kind" = 'invite' AND "newsletter_identity_commands"."list_id" IS NOT NULL AND "newsletter_identity_commands"."list_id" > 0 AND "newsletter_identity_commands"."privacy_case_id" IS NULL AND "newsletter_identity_commands"."state" <> 'erased')
      OR ("newsletter_identity_commands"."kind" = 'erase' AND "newsletter_identity_commands"."list_id" IS NULL AND "newsletter_identity_commands"."privacy_case_id" IS NOT NULL AND "newsletter_identity_commands"."state" <> 'confirmed')
    ),
	CONSTRAINT "newsletter_identity_command_approval_ck" CHECK (
      ("newsletter_identity_commands"."kind" = 'invite' AND "newsletter_identity_commands"."approved_scope_version" IS NULL AND "newsletter_identity_commands"."approved_recipient_version" IS NULL AND "newsletter_identity_commands"."approved_verification_version" IS NULL)
      OR ("newsletter_identity_commands"."kind" = 'erase' AND "newsletter_identity_commands"."approved_scope_version" IS NOT NULL AND "newsletter_identity_commands"."approved_recipient_version" IS NOT NULL AND "newsletter_identity_commands"."approved_verification_version" IS NOT NULL)
    ),
	CONSTRAINT "newsletter_identity_command_state_ck" CHECK (
      ("newsletter_identity_commands"."state" = 'pending' AND "newsletter_identity_commands"."resolved_at" IS NULL)
      OR ("newsletter_identity_commands"."state" IN ('confirmed', 'erased', 'expired', 'suppressed', 'detached') AND "newsletter_identity_commands"."resolved_at" IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE TABLE "newsletter_person_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"address_digest" "bytea" NOT NULL,
	"subscriber_id" integer,
	"subscriber_uuid" uuid,
	"actor_id" uuid NOT NULL,
	"evidence_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"detached_at" timestamp with time zone,
	"detached_reason" text,
	CONSTRAINT "newsletter_person_address_digest_ck" CHECK (octet_length("newsletter_person_addresses"."address_digest") = 32),
	CONSTRAINT "newsletter_person_address_proof_ck" CHECK (
      ("newsletter_person_addresses"."subscriber_id" IS NULL AND "newsletter_person_addresses"."subscriber_uuid" IS NULL AND "newsletter_person_addresses"."verified_at" IS NULL)
      OR ("newsletter_person_addresses"."subscriber_id" > 0 AND "newsletter_person_addresses"."subscriber_uuid" IS NOT NULL AND "newsletter_person_addresses"."verified_at" IS NOT NULL)
    ),
	CONSTRAINT "newsletter_person_address_detach_ck" CHECK (
      ("newsletter_person_addresses"."detached_at" IS NULL AND "newsletter_person_addresses"."detached_reason" IS NULL)
      OR ("newsletter_person_addresses"."detached_at" IS NOT NULL AND "newsletter_person_addresses"."detached_reason" IS NOT NULL AND
        "newsletter_person_addresses"."detached_reason" IN ('address_removed', 'person_archived', 'person_merged', 'operator', 'expired', 'shared', 'erasure', 'suppressed'))
    )
);
--> statement-breakpoint
CREATE TABLE "newsletter_person_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"list_id" integer,
	"origin_run_id" uuid,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "newsletter_person_event_type_ck" CHECK (
      ("newsletter_person_events"."event" = 'newsletter.identity.verified' AND "newsletter_person_events"."list_id" IS NULL)
      OR ("newsletter_person_events"."event" = 'newsletter.consent.confirmed' AND "newsletter_person_events"."list_id" IS NOT NULL AND "newsletter_person_events"."list_id" > 0)
    )
);
--> statement-breakpoint
ALTER TABLE "newsletter_identity_commands" ADD CONSTRAINT "newsletter_identity_commands_link_id_newsletter_person_addresses_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."newsletter_person_addresses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_person_addresses" ADD CONSTRAINT "newsletter_person_addresses_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_person_events" ADD CONSTRAINT "newsletter_person_events_link_id_newsletter_person_addresses_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."newsletter_person_addresses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_identity_pending_idx" ON "newsletter_identity_commands" USING btree ("next_check_at","id") WHERE "newsletter_identity_commands"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "newsletter_identity_command_link_idx" ON "newsletter_identity_commands" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_person_active_address_idx" ON "newsletter_person_addresses" USING btree ("person_id","address_digest") WHERE "newsletter_person_addresses"."detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX "newsletter_person_proof_pending_idx" ON "newsletter_person_addresses" USING btree ("next_check_at","id") WHERE "newsletter_person_addresses"."verified_at" IS NULL AND "newsletter_person_addresses"."detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX "newsletter_person_mailbox_idx" ON "newsletter_person_addresses" USING btree ("subscriber_uuid") WHERE "newsletter_person_addresses"."detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX "newsletter_person_events_link_idx" ON "newsletter_person_events" USING btree ("link_id","occurred_at");--> statement-breakpoint
CREATE INDEX "newsletter_person_events_delivery_idx" ON "newsletter_person_events" USING btree ("occurred_at","id") WHERE "newsletter_person_events"."delivered_at" IS NULL;