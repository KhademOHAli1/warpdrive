CREATE TABLE "inventory_bom_lines" (
	"item_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_bom_lines_pkey" PRIMARY KEY("item_id","component_id"),
	CONSTRAINT "inventory_bom_lines_quantity_check" CHECK ("inventory_bom_lines"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "inventory_bom_lines_distinct_items_check" CHECK ("inventory_bom_lines"."item_id" <> "inventory_bom_lines"."component_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_command_receipts" (
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_command_receipts_pkey" PRIMARY KEY("actor_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"revision" text NOT NULL,
	"kind" text NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_items_sku_key" UNIQUE("sku"),
	CONSTRAINT "inventory_items_kind_check" CHECK ("inventory_items"."kind" IN ('component', 'product')),
	CONSTRAINT "inventory_items_sku_check" CHECK ("inventory_items"."sku" ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
	CONSTRAINT "inventory_items_name_check" CHECK (length(btrim("inventory_items"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "inventory_items_revision_check" CHECK (length(btrim("inventory_items"."revision")) BETWEEN 1 AND 20),
	CONSTRAINT "inventory_items_balance_check" CHECK ("inventory_items"."reserved" >= 0 AND "inventory_items"."reserved" <= "inventory_items"."on_hand" AND "inventory_items"."on_hand" <= 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"order_id" uuid,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"on_hand_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_kind_check" CHECK ("inventory_movements"."kind" IN ('receipt', 'order-reserve', 'materials-reserve', 'build-consume', 'build-output', 'shipment', 'cancel-release'))
);
--> statement-breakpoint
CREATE TABLE "inventory_order_materials" (
	"order_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_order_materials_pkey" PRIMARY KEY("order_id","component_id"),
	CONSTRAINT "inventory_order_materials_quantity_check" CHECK ("inventory_order_materials"."quantity" BETWEEN 1 AND 1000000000)
);
--> statement-breakpoint
CREATE TABLE "inventory_order_tasks" (
	"order_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "inventory_order_tasks_pkey" PRIMARY KEY("order_id","position"),
	CONSTRAINT "inventory_order_tasks_item_key" UNIQUE("item_id"),
	CONSTRAINT "inventory_order_tasks_position_check" CHECK ("inventory_order_tasks"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reserved" integer NOT NULL,
	"build_quantity" integer NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"project_id" uuid,
	"template_revision" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_orders_id_project_key" UNIQUE("id","project_id"),
	CONSTRAINT "inventory_orders_quantity_check" CHECK ("inventory_orders"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "inventory_orders_balance_check" CHECK ("inventory_orders"."reserved" BETWEEN 0 AND "inventory_orders"."quantity" AND "inventory_orders"."build_quantity" BETWEEN 0 AND "inventory_orders"."quantity"),
	CONSTRAINT "inventory_orders_status_check" CHECK ("inventory_orders"."status" IN ('awaiting_materials', 'in_production', 'ready', 'shipped', 'cancelled')),
	CONSTRAINT "inventory_orders_status_reservation_check" CHECK (CASE
        WHEN "inventory_orders"."status" = 'ready' THEN "inventory_orders"."reserved" = "inventory_orders"."quantity"
        WHEN "inventory_orders"."status" IN ('awaiting_materials', 'in_production')
          THEN "inventory_orders"."build_quantity" > 0 AND "inventory_orders"."reserved" = "inventory_orders"."quantity" - "inventory_orders"."build_quantity"
        ELSE "inventory_orders"."reserved" = 0
      END),
	CONSTRAINT "inventory_orders_build_source_check" CHECK (CASE
        WHEN "inventory_orders"."build_quantity" = 0 THEN "inventory_orders"."project_id" IS NULL AND "inventory_orders"."template_revision" IS NULL
        ELSE "inventory_orders"."project_id" IS NOT NULL AND "inventory_orders"."template_revision" IS NOT NULL
      END),
	CONSTRAINT "inventory_orders_revision_check" CHECK ("inventory_orders"."revision" >= 1),
	CONSTRAINT "inventory_orders_template_revision_check" CHECK ("inventory_orders"."template_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_templates" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"configured_by" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"steps" jsonb NOT NULL,
	CONSTRAINT "inventory_templates_revision_check" CHECK ("inventory_templates"."revision" >= 1),
	CONSTRAINT "inventory_templates_steps_check" CHECK (CASE WHEN jsonb_typeof("inventory_templates"."steps") = 'array' THEN jsonb_array_length("inventory_templates"."steps") BETWEEN 1 AND 10 ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "inventory_bom_lines" ADD CONSTRAINT "inventory_bom_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_bom_lines" ADD CONSTRAINT "inventory_bom_lines_component_id_inventory_items_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_command_receipts" ADD CONSTRAINT "inventory_command_receipts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_inventory_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_order_materials" ADD CONSTRAINT "inventory_order_materials_order_id_inventory_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."inventory_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_order_materials" ADD CONSTRAINT "inventory_order_materials_component_id_inventory_items_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_order_tasks" ADD CONSTRAINT "inventory_order_tasks_order_project_fk" FOREIGN KEY ("order_id","project_id") REFERENCES "public"."inventory_orders"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_order_tasks" ADD CONSTRAINT "inventory_order_tasks_item_project_fk" FOREIGN KEY ("item_id","project_id") REFERENCES "public"."internal_project_items"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_orders" ADD CONSTRAINT "inventory_orders_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_orders" ADD CONSTRAINT "inventory_orders_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_orders" ADD CONSTRAINT "inventory_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_orders" ADD CONSTRAINT "inventory_orders_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."internal_project_settings"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_templates" ADD CONSTRAINT "inventory_templates_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_templates" ADD CONSTRAINT "inventory_templates_configured_by_users_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_templates" ADD CONSTRAINT "inventory_templates_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."internal_project_settings"("project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_bom_lines_component_idx" ON "inventory_bom_lines" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_created_idx" ON "inventory_movements" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_order_idx" ON "inventory_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_request_idx" ON "inventory_movements" USING btree ("actor_id","request_id");--> statement-breakpoint
CREATE INDEX "inventory_order_materials_component_idx" ON "inventory_order_materials" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "inventory_orders_deal_created_idx" ON "inventory_orders" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_orders_item_idx" ON "inventory_orders" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inventory_orders_project_idx" ON "inventory_orders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "inventory_templates_project_idx" ON "inventory_templates" USING btree ("project_id");--> statement-breakpoint

CREATE FUNCTION "public"."inventory_reject_movement_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "inventory_movements_append_only"
BEFORE UPDATE OR DELETE ON "public"."inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "public"."inventory_reject_movement_change"();
