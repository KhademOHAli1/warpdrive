CREATE TABLE "operations_current" (
	"source_id" uuid NOT NULL,
	"observation_key" text NOT NULL,
	"generation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"receipt_id" uuid NOT NULL,
	"payload_sha256" text NOT NULL,
	"observation" jsonb NOT NULL,
	"batch_observed_at" timestamp (3) with time zone NOT NULL,
	"ordering_at" timestamp (3) with time zone NOT NULL,
	"received_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operations_current_source_id_observation_key_pk" PRIMARY KEY("source_id","observation_key"),
	CONSTRAINT "operations_current_key_ck" CHECK (char_length("operations_current"."observation_key") BETWEEN 1 AND 200 AND "operations_current"."observation_key" ~ '^[a-z0-9_.:-]+$'),
	CONSTRAINT "operations_current_sequence_ck" CHECK ("operations_current"."sequence" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "operations_current_fingerprint_ck" CHECK ("operations_current"."payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "operations_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"observation_key" text NOT NULL,
	"state" text NOT NULL,
	"reason" text NOT NULL,
	"fingerprint" text NOT NULL,
	"revision" integer NOT NULL,
	"opened_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"recovered_at" timestamp (3) with time zone,
	CONSTRAINT "operations_incidents_state_ck" CHECK ("operations_incidents"."state" IN ('degraded','failed','unknown','stale')),
	CONSTRAINT "operations_incidents_reason_ck" CHECK ("operations_incidents"."reason" ~ '^[a-z_]{1,64}$'),
	CONSTRAINT "operations_incidents_fingerprint_ck" CHECK ("operations_incidents"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operations_incidents_revision_ck" CHECK ("operations_incidents"."revision" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "operations_installation" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"installation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_installation_installation_id_unique" UNIQUE("installation_id"),
	CONSTRAINT "operations_installation_singleton_ck" CHECK ("operations_installation"."singleton" = true)
);
--> statement-breakpoint
CREATE TABLE "operations_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"ordinal" bigint NOT NULL,
	"payload_sha256" text NOT NULL,
	"payload" jsonb NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"received_at" timestamp (3) with time zone NOT NULL,
	"observation_count" integer NOT NULL,
	CONSTRAINT "operations_receipts_ordinal_uq" UNIQUE("source_id","ordinal"),
	CONSTRAINT "operations_receipts_sequence_uq" UNIQUE("source_id","generation_id","sequence"),
	CONSTRAINT "operations_receipts_sequence_ck" CHECK ("operations_receipts"."sequence" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "operations_receipts_ordinal_ck" CHECK ("operations_receipts"."ordinal" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "operations_receipts_fingerprint_ck" CHECK ("operations_receipts"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operations_receipts_count_ck" CHECK ("operations_receipts"."observation_count" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "operations_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"current_generation_id" uuid NOT NULL,
	"highest_sequence" bigint DEFAULT 0 NOT NULL,
	"receipt_ordinal" bigint DEFAULT 0 NOT NULL,
	"admission_state" text DEFAULT 'ready' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_sources_sequence_ck" CHECK ("operations_sources"."highest_sequence" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "operations_sources_ordinal_ck" CHECK ("operations_sources"."receipt_ordinal" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "operations_sources_admission_ck" CHECK ("operations_sources"."admission_state" IN ('ready','storage_pressure')),
	CONSTRAINT "operations_sources_role_ck" CHECK ("operations_sources"."role" IN ('host_collector','application_sampler','recovery_verifier'))
);
--> statement-breakpoint
CREATE TABLE "operations_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "operations_transitions_revision_uq" UNIQUE("incident_id","revision"),
	CONSTRAINT "operations_transitions_kind_ck" CHECK ("operations_transitions"."kind" IN ('opened','changed','recovered')),
	CONSTRAINT "operations_transitions_state_ck" CHECK ("operations_transitions"."state" IN ('healthy','degraded','failed','unknown','stale')),
	CONSTRAINT "operations_transitions_reason_ck" CHECK ("operations_transitions"."reason" ~ '^[a-z_]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "operations_current" ADD CONSTRAINT "operations_current_source_id_operations_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."operations_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_incidents" ADD CONSTRAINT "operations_incidents_source_id_operations_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."operations_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_receipts" ADD CONSTRAINT "operations_receipts_source_id_operations_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."operations_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_sources" ADD CONSTRAINT "operations_sources_installation_id_operations_installation_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."operations_installation"("installation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_transitions" ADD CONSTRAINT "operations_transitions_incident_id_operations_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."operations_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operations_incidents_open_uq" ON "operations_incidents" USING btree ("source_id","observation_key") WHERE "operations_incidents"."recovered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "operations_incidents_updated_idx" ON "operations_incidents" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "operations_receipts_received_idx" ON "operations_receipts" USING btree ("source_id","received_at","id");--> statement-breakpoint
CREATE INDEX "operations_sources_installation_idx" ON "operations_sources" USING btree ("installation_id","id");