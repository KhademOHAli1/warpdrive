CREATE TABLE "calendar_members" (
	"calendar_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "calendar_members_calendar_id_user_id_pk" PRIMARY KEY("calendar_id","user_id"),
	CONSTRAINT "calendar_member_role" CHECK ("calendar_members"."role" in ('freeBusy','reader','editor'))
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "event_visibility" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "availability" text DEFAULT 'busy' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_members" ADD CONSTRAINT "calendar_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_primary_owner" ON "calendars" USING btree ("owner_id") WHERE "calendars"."is_primary" = true;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_calendar_idx" ON "activities" USING btree ("calendar_id","due_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activity_event_visibility" CHECK ("activities"."event_visibility" in ('default','private'));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activity_availability" CHECK ("activities"."availability" in ('busy','free'));