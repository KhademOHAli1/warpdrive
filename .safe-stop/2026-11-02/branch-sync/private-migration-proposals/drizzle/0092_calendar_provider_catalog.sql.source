CREATE TABLE "calendar_provider_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_calendar_id" uuid NOT NULL,
	"local_calendar_id" uuid NOT NULL,
	"calendar_source" text DEFAULT 'provider' NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_provider_binding_source_uniq" UNIQUE("provider_calendar_id"),
	CONSTRAINT "calendar_provider_binding_local_uniq" UNIQUE("local_calendar_id"),
	CONSTRAINT "calendar_provider_binding_source" CHECK ("calendar_provider_bindings"."calendar_source" = 'provider'),
	CONSTRAINT "calendar_provider_binding_version" CHECK ("calendar_provider_bindings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "calendar_provider_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_id_hash" text GENERATED ALWAYS AS (encode(digest("calendar_id", 'sha256'), 'hex')) STORED NOT NULL,
	"raw" jsonb NOT NULL,
	"connection_generation" integer NOT NULL,
	"last_seen_revision" integer NOT NULL,
	CONSTRAINT "calendar_provider_calendar_identity_uniq" UNIQUE("account_id","calendar_id_hash"),
	CONSTRAINT "calendar_provider_calendar_owner_uniq" UNIQUE("id","user_id"),
	CONSTRAINT "calendar_provider_calendar_raw_object" CHECK (jsonb_typeof("calendar_provider_calendars"."raw") = 'object'),
	CONSTRAINT "calendar_provider_calendar_generation" CHECK ("calendar_provider_calendars"."connection_generation" > 0),
	CONSTRAINT "calendar_provider_calendar_revision" CHECK ("calendar_provider_calendars"."last_seen_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "calendar_provider_catalog_states" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"latest_run_id" uuid NOT NULL,
	"requested_generation" integer NOT NULL,
	"request_expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"published_run_id" uuid,
	"published_generation" integer,
	"revision" integer DEFAULT 0 NOT NULL,
	"sync_token" text,
	"discovered_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "calendar_catalog_request_generation" CHECK ("calendar_provider_catalog_states"."requested_generation" > 0),
	CONSTRAINT "calendar_catalog_status" CHECK ("calendar_provider_catalog_states"."status" in ('refreshing','ready','error')),
	CONSTRAINT "calendar_catalog_publication" CHECK ((
      "calendar_provider_catalog_states"."revision" = 0 and "calendar_provider_catalog_states"."published_run_id" is null and "calendar_provider_catalog_states"."published_generation" is null
      and "calendar_provider_catalog_states"."sync_token" is null and "calendar_provider_catalog_states"."discovered_at" is null
    ) or (
      "calendar_provider_catalog_states"."revision" > 0 and "calendar_provider_catalog_states"."published_run_id" is not null
      and "calendar_provider_catalog_states"."published_generation" is not null and "calendar_provider_catalog_states"."published_generation" > 0
      and "calendar_provider_catalog_states"."sync_token" is not null and "calendar_provider_catalog_states"."discovered_at" is not null
    ))
);
--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "source" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendar_id_owner_source_uniq" UNIQUE("id","owner_id","source");--> statement-breakpoint
ALTER TABLE "calendar_provider_bindings" ADD CONSTRAINT "calendar_provider_bindings_provider_calendar_id_user_id_calendar_provider_calendars_id_user_id_fk" FOREIGN KEY ("provider_calendar_id","user_id") REFERENCES "public"."calendar_provider_calendars"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_bindings" ADD CONSTRAINT "calendar_provider_bindings_local_calendar_id_user_id_calendar_source_calendars_id_owner_id_source_fk" FOREIGN KEY ("local_calendar_id","user_id","calendar_source") REFERENCES "public"."calendars"("id","owner_id","source") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_calendars" ADD CONSTRAINT "calendar_provider_calendars_account_id_user_id_calendar_provider_accounts_id_user_id_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."calendar_provider_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_catalog_states" ADD CONSTRAINT "calendar_provider_catalog_states_account_id_calendar_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendar_source" CHECK ("calendars"."source" in ('native','provider'));--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendar_provider_not_primary" CHECK ("calendars"."source" <> 'provider' or "calendars"."is_primary" = false);
