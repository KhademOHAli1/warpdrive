CREATE TABLE "inventory_stock_allocations" (
	"order_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_stock_allocations_pkey" PRIMARY KEY("order_id","position_id"),
	CONSTRAINT "inventory_stock_allocation_quantity_check" CHECK ("inventory_stock_allocations"."quantity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"position_id" uuid,
	"source_position_id" uuid,
	"incoming_id" uuid,
	"movement_id" uuid,
	"order_id" uuid,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"on_hand_delta" integer DEFAULT 0 NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"incoming_delta" integer DEFAULT 0 NOT NULL,
	"previous_state" text,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_stock_event_kind_check" CHECK ("inventory_stock_events"."kind" IN ('receipt', 'reconcile', 'state', 'incoming-create', 'incoming-cancel',
        'order-reserve', 'materials-reserve', 'build-consume', 'shipment', 'cancel-release')),
	CONSTRAINT "inventory_stock_event_previous_state_check" CHECK ("inventory_stock_events"."previous_state" IN ('available', 'quarantine', 'hold')),
	CONSTRAINT "inventory_stock_event_state_check" CHECK ("inventory_stock_events"."state" IN ('available', 'quarantine', 'hold'))
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_incoming" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"owner_organization_id" uuid,
	"quantity" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"expected_date" date,
	"reference" text,
	CONSTRAINT "inventory_stock_incoming_id_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_stock_incoming_quantity_check" CHECK ("inventory_stock_incoming"."quantity" BETWEEN 1 AND 1000000000 AND "inventory_stock_incoming"."received" BETWEEN 0 AND "inventory_stock_incoming"."quantity"),
	CONSTRAINT "inventory_stock_incoming_reference_check" CHECK (length(btrim("inventory_stock_incoming"."reference")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_location_policies" (
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "inventory_stock_location_policies_pkey" PRIMARY KEY("site_id","location_id"),
	CONSTRAINT "inventory_stock_policy_kind_check" CHECK ("inventory_stock_location_policies"."kind" IN ('storage', 'structure', 'external'))
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"lot" text,
	"serial" text,
	"expiry_date" date,
	"state" text DEFAULT 'available' NOT NULL,
	"owner_organization_id" uuid,
	"on_hand" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_stock_positions_id_item_key" UNIQUE("id","item_id"),
	CONSTRAINT "inventory_stock_position_balance_check" CHECK ("inventory_stock_positions"."reserved" BETWEEN 0 AND "inventory_stock_positions"."on_hand" AND "inventory_stock_positions"."on_hand" <= 1000000000),
	CONSTRAINT "inventory_stock_position_lot_check" CHECK ("inventory_stock_positions"."lot" = upper(btrim("inventory_stock_positions"."lot")) AND length("inventory_stock_positions"."lot") BETWEEN 1 AND 80),
	CONSTRAINT "inventory_stock_position_serial_check" CHECK ("inventory_stock_positions"."serial" IS NULL OR (
        "inventory_stock_positions"."serial" = upper(btrim("inventory_stock_positions"."serial")) AND
        length("inventory_stock_positions"."serial") BETWEEN 1 AND 80 AND "inventory_stock_positions"."on_hand" <= 1
      )),
	CONSTRAINT "inventory_stock_position_state_check" CHECK ("inventory_stock_positions"."state" IN ('available', 'quarantine', 'hold')),
	CONSTRAINT "inventory_stock_position_allocatable_check" CHECK ("inventory_stock_positions"."reserved" = 0 OR ("inventory_stock_positions"."state" = 'available' AND "inventory_stock_positions"."owner_organization_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inventory_stock_allocations" ADD CONSTRAINT "inventory_stock_allocations_order_id_inventory_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_allocations" ADD CONSTRAINT "inventory_stock_allocation_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_events_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_events_order_id_inventory_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_position_fk" FOREIGN KEY ("position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_source_position_fk" FOREIGN KEY ("source_position_id","item_id") REFERENCES "public"."inventory_stock_positions"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_incoming_fk" FOREIGN KEY ("incoming_id","item_id") REFERENCES "public"."inventory_stock_incoming"("id","item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_events" ADD CONSTRAINT "inventory_stock_event_movement_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_incoming" ADD CONSTRAINT "inventory_stock_incoming_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_incoming" ADD CONSTRAINT "inventory_stock_incoming_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_incoming" ADD CONSTRAINT "inventory_stock_incoming_owner_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_location_policies" ADD CONSTRAINT "inventory_stock_policy_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_positions" ADD CONSTRAINT "inventory_stock_positions_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_positions" ADD CONSTRAINT "inventory_stock_position_location_fk" FOREIGN KEY ("site_id","location_id") REFERENCES "public"."directory_locations"("site_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_positions" ADD CONSTRAINT "inventory_stock_position_owner_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_stock_allocations_order_item_idx" ON "inventory_stock_allocations" USING btree ("order_id","item_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_allocations_position_idx" ON "inventory_stock_allocations" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_events_item_time_idx" ON "inventory_stock_events" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_stock_events_position_idx" ON "inventory_stock_events" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_events_source_position_idx" ON "inventory_stock_events" USING btree ("source_position_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_events_incoming_idx" ON "inventory_stock_events" USING btree ("incoming_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_events_movement_idx" ON "inventory_stock_events" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_events_actor_request_idx" ON "inventory_stock_events" USING btree ("actor_id","request_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_incoming_item_idx" ON "inventory_stock_incoming" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_incoming_site_location_idx" ON "inventory_stock_incoming" USING btree ("site_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_stock_positions_serial_key" ON "inventory_stock_positions" USING btree ("item_id","serial") WHERE "inventory_stock_positions"."serial" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_stock_positions_item_idx" ON "inventory_stock_positions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_positions_site_location_idx" ON "inventory_stock_positions" USING btree ("site_id","location_id");