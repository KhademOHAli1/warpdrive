CREATE TABLE "newsletter_attributed_wins" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_attributed_wins_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_deal_sources" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"exposure_id" uuid NOT NULL,
	"lead_id" uuid
);
--> statement-breakpoint
CREATE TABLE "newsletter_exposure_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"grant_id" uuid NOT NULL,
	"purpose_list_id" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_lead_sources" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"exposure_id" uuid NOT NULL,
	"actor_id" uuid,
	"operation_id" uuid,
	"intent_fingerprint" text,
	CONSTRAINT "newsletter_lead_sources_operation_uidx" UNIQUE("actor_id","operation_id"),
	CONSTRAINT "newsletter_lead_sources_intent_ck" CHECK (
    ("newsletter_lead_sources"."actor_id" IS NULL AND "newsletter_lead_sources"."operation_id" IS NULL AND "newsletter_lead_sources"."intent_fingerprint" IS NULL)
    OR ("newsletter_lead_sources"."actor_id" IS NOT NULL AND "newsletter_lead_sources"."operation_id" IS NOT NULL
        AND "newsletter_lead_sources"."intent_fingerprint" IS NOT NULL AND "newsletter_lead_sources"."intent_fingerprint" ~ '^[0-9a-f]{64}$')
  )
);
--> statement-breakpoint
ALTER TABLE "newsletter_attributed_wins" ADD CONSTRAINT "newsletter_attributed_wins_deal_id_newsletter_deal_sources_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."newsletter_deal_sources"("deal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deal_sources" ADD CONSTRAINT "newsletter_deal_sources_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deal_sources" ADD CONSTRAINT "newsletter_deal_sources_exposure_id_newsletter_exposure_receipts_id_fk" FOREIGN KEY ("exposure_id") REFERENCES "public"."newsletter_exposure_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deal_sources" ADD CONSTRAINT "newsletter_deal_sources_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_exposure_receipts" ADD CONSTRAINT "newsletter_exposure_receipts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_exposure_receipts" ADD CONSTRAINT "newsletter_exposure_receipts_link_id_newsletter_person_addresses_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."newsletter_person_addresses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_lead_sources" ADD CONSTRAINT "newsletter_lead_sources_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_lead_sources" ADD CONSTRAINT "newsletter_lead_sources_exposure_id_newsletter_exposure_receipts_id_fk" FOREIGN KEY ("exposure_id") REFERENCES "public"."newsletter_exposure_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_exposure_receipts_person_idx" ON "newsletter_exposure_receipts" USING btree ("person_id","accepted_at");