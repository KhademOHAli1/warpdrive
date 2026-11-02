CREATE TABLE "activity_reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'assignment' NOT NULL,
	"use_default" boolean DEFAULT true NOT NULL,
	"rules" jsonb DEFAULT '{"timed":[{"method":"notification","minutesBefore":10},{"method":"email","minutesBefore":10}],"allDay":[{"method":"notification","daysBefore":0,"time":"09:00"},{"method":"email","daysBefore":0,"time":"09:00"}]}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"time_zone" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_reminder_source" CHECK ("activity_reminder_settings"."source" in ('assignment','personal'))
);
--> statement-breakpoint
CREATE TABLE "calendar_oauth_attempts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"browser_binding_hash" text NOT NULL,
	"code_verifier_enc" "bytea",
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"requested_access" text NOT NULL,
	"account_id" uuid,
	"account_version" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_oauth_access" CHECK ("calendar_oauth_attempts"."requested_access" in ('readOnly','readWrite'))
);
--> statement-breakpoint
CREATE TABLE "calendar_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"provider_subject" text NOT NULL,
	"client_id" text NOT NULL,
	"email_address" "citext" NOT NULL,
	"refresh_token_enc" "bytea",
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_error_code" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_provider_owner_subject_uniq" UNIQUE("user_id","provider","provider_subject"),
	CONSTRAINT "calendar_provider_id_owner_uniq" UNIQUE("id","user_id"),
	CONSTRAINT "calendar_provider_google" CHECK ("calendar_provider_accounts"."provider" = 'google'),
	CONSTRAINT "calendar_provider_status" CHECK ("calendar_provider_accounts"."status" in ('connected','reauthRequired','disconnected')),
	CONSTRAINT "calendar_provider_scope_array" CHECK (jsonb_typeof("calendar_provider_accounts"."scopes") = 'array')
);
--> statement-breakpoint
CREATE TABLE "calendar_reminder_defaults" (
	"calendar_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rules" jsonb DEFAULT '{"timed":[{"method":"notification","minutesBefore":10},{"method":"email","minutesBefore":10}],"allDay":[{"method":"notification","daysBefore":0,"time":"09:00"},{"method":"email","daysBefore":0,"time":"09:00"}]}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_reminder_defaults_calendar_id_user_id_pk" PRIMARY KEY("calendar_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "reminder_rebuilds" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"touched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "reminder_automation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "settings_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "settings_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "defaults_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "event_signature" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD COLUMN "email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_reminder_settings" ADD CONSTRAINT "activity_reminder_settings_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reminder_settings" ADD CONSTRAINT "activity_reminder_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_oauth_attempts" ADD CONSTRAINT "calendar_oauth_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_oauth_attempts" ADD CONSTRAINT "calendar_oauth_attempts_account_id_user_id_calendar_provider_accounts_id_user_id_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."calendar_provider_accounts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_accounts" ADD CONSTRAINT "calendar_provider_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminder_defaults" ADD CONSTRAINT "calendar_reminder_defaults_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_reminder_defaults" ADD CONSTRAINT "calendar_reminder_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_rebuilds" ADD CONSTRAINT "reminder_rebuilds_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_reminder_settings_user_idx" ON "activity_reminder_settings" USING btree ("activity_id","user_id");--> statement-breakpoint
CREATE INDEX "calendar_oauth_owner_expiry_idx" ON "calendar_oauth_attempts" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "calendar_provider_owner_status_idx" ON "calendar_provider_accounts" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "activity_reminder_intents" ADD CONSTRAINT "activity_reminder_intents_settings_id_activity_reminder_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."activity_reminder_settings"("id") ON DELETE cascade ON UPDATE no action;