CREATE TABLE "internal_project_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "internal_project_item_events_kind_check" CHECK ("internal_project_item_events"."kind" IN ('created', 'updated'))
);
--> statement-breakpoint
CREATE TABLE "internal_project_item_subscriptions" (
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "internal_project_item_subscriptions_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "internal_project_item_events" ADD CONSTRAINT "internal_project_item_events_item_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."internal_project_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_events" ADD CONSTRAINT "internal_project_item_events_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_subscriptions" ADD CONSTRAINT "internal_project_item_subscriptions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_project_item_subscriptions" ADD CONSTRAINT "internal_project_item_subscriptions_item_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."internal_project_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_item_events_actor_order_idx" ON "internal_project_item_events" USING btree ("actor_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "internal_project_item_events_item_idx" ON "internal_project_item_events" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "internal_project_item_subscriptions_item_idx" ON "internal_project_item_subscriptions" USING btree ("item_id");