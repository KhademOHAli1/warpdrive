CREATE TABLE "deal_create_operations" (
	"actor_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"intent_version" smallint NOT NULL,
	"intent_fingerprint" "bytea" NOT NULL,
	"deal_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "deal_create_operations_pkey" PRIMARY KEY("actor_id","operation_id"),
	CONSTRAINT "deal_create_operation_version_ck" CHECK ("deal_create_operations"."intent_version" = 1),
	CONSTRAINT "deal_create_operation_fingerprint_ck" CHECK (octet_length("deal_create_operations"."intent_fingerprint") = 32)
);
--> statement-breakpoint
ALTER TABLE "deal_create_operations" ADD CONSTRAINT "deal_create_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_create_operations" ADD CONSTRAINT "deal_create_operations_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_create_operations_deal_idx" ON "deal_create_operations" USING btree ("deal_id") WHERE "deal_create_operations"."deal_id" is not null;