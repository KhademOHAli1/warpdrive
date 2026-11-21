CREATE TABLE "inventory_item_cost_overrides" (
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	CONSTRAINT "inventory_item_cost_overrides_pkey" PRIMARY KEY("site_id","item_id"),
	CONSTRAINT "inventory_item_cost_overrides_currency_check" CHECK ("inventory_item_cost_overrides"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "inventory_item_cost_overrides_amount_check" CHECK ("inventory_item_cost_overrides"."amount" BETWEEN 0 AND 99999999999999.9999)
);
--> statement-breakpoint
CREATE TABLE "inventory_manufacturer_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"part_number" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inventory_manufacturer_parts_scope_id_key" UNIQUE("site_id","item_id","id"),
	CONSTRAINT "inventory_manufacturer_parts_number_check" CHECK (length("inventory_manufacturer_parts"."part_number") BETWEEN 1 AND 120 AND "inventory_manufacturer_parts"."part_number" = btrim("inventory_manufacturer_parts"."part_number")),
	CONSTRAINT "inventory_manufacturer_parts_version_check" CHECK ("inventory_manufacturer_parts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_supplier_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_organization_id" uuid NOT NULL,
	"manufacturer_part_id" uuid,
	"part_number" text NOT NULL,
	"pack_quantity" integer NOT NULL,
	"stock_unit" text NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inventory_supplier_offers_scope_id_key" UNIQUE("site_id","item_id","id"),
	CONSTRAINT "inventory_supplier_offers_number_check" CHECK (length("inventory_supplier_offers"."part_number") BETWEEN 1 AND 120 AND "inventory_supplier_offers"."part_number" = btrim("inventory_supplier_offers"."part_number")),
	CONSTRAINT "inventory_supplier_offers_pack_check" CHECK ("inventory_supplier_offers"."pack_quantity" BETWEEN 1 AND 1000000000),
	CONSTRAINT "inventory_supplier_offers_version_check" CHECK ("inventory_supplier_offers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_supplier_price_tiers" (
	"offer_id" uuid NOT NULL,
	"min_packs" integer NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"pack_quantity" integer NOT NULL,
	"stock_unit" text NOT NULL,
	CONSTRAINT "inventory_supplier_price_tiers_pkey" PRIMARY KEY("offer_id","currency","min_packs"),
	CONSTRAINT "inventory_supplier_price_tiers_min_packs_check" CHECK ("inventory_supplier_price_tiers"."min_packs" BETWEEN 1 AND 1000000000),
	CONSTRAINT "inventory_supplier_price_tiers_pack_check" CHECK ("inventory_supplier_price_tiers"."pack_quantity" BETWEEN 1 AND 1000000000
        AND "inventory_supplier_price_tiers"."min_packs"::bigint * "inventory_supplier_price_tiers"."pack_quantity" <= 1000000000),
	CONSTRAINT "inventory_supplier_price_tiers_currency_check" CHECK ("inventory_supplier_price_tiers"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "inventory_supplier_price_tiers_amount_check" CHECK ("inventory_supplier_price_tiers"."amount" BETWEEN 0 AND 99999999999999.9999)
);
--> statement-breakpoint
ALTER TABLE "inventory_item_cost_overrides" ADD CONSTRAINT "inventory_item_cost_overrides_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_cost_overrides" ADD CONSTRAINT "inventory_item_cost_overrides_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_manufacturer_parts" ADD CONSTRAINT "inventory_manufacturer_parts_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_manufacturer_parts" ADD CONSTRAINT "inventory_manufacturer_parts_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_manufacturer_parts" ADD CONSTRAINT "inventory_manufacturer_parts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_offers" ADD CONSTRAINT "inventory_supplier_offers_site_id_directory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."directory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_offers" ADD CONSTRAINT "inventory_supplier_offers_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_offers" ADD CONSTRAINT "inventory_supplier_offers_supplier_organization_id_organizations_id_fk" FOREIGN KEY ("supplier_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_offers" ADD CONSTRAINT "inventory_supplier_offers_manufacturer_scope_fk" FOREIGN KEY ("site_id","item_id","manufacturer_part_id") REFERENCES "public"."inventory_manufacturer_parts"("site_id","item_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_price_tiers" ADD CONSTRAINT "inventory_supplier_price_tiers_offer_id_inventory_supplier_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."inventory_supplier_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_manufacturer_parts_number_key" ON "inventory_manufacturer_parts" USING btree ("site_id","item_id","organization_id",lower("part_number"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_supplier_offers_number_key" ON "inventory_supplier_offers" USING btree ("site_id","item_id","supplier_organization_id",lower("part_number"));--> statement-breakpoint
CREATE INDEX "inventory_supplier_offers_manufacturer_idx" ON "inventory_supplier_offers" USING btree ("manufacturer_part_id");