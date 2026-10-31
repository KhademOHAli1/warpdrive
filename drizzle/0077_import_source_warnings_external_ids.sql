CREATE TABLE "import_external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"local_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_external_ids_source_entity_external_unique" UNIQUE("source","entity","external_id")
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "source" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_external_ids" ADD CONSTRAINT "import_external_ids_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_external_ids_batch_idx" ON "import_external_ids" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "import_external_ids_entity_local_idx" ON "import_external_ids" USING btree ("entity","local_id");