ALTER TABLE "internal_project_items" ADD COLUMN "priority" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_project_items_created_by_idx" ON "internal_project_items" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_priority_check" CHECK ("internal_project_items"."priority" IN ('urgent', 'high', 'medium', 'low', 'none'));--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_date_order_check" CHECK ("internal_project_items"."start_date" IS NULL OR "internal_project_items"."due_date" IS NULL OR "internal_project_items"."start_date" <= "internal_project_items"."due_date");--> statement-breakpoint
ALTER TABLE "internal_project_items" ADD CONSTRAINT "internal_project_items_description_check" CHECK (char_length("internal_project_items"."description") <= 10000);