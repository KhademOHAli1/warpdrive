CREATE TABLE "mail_connection_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"payload_enc" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_connection_checks_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD COLUMN "identity_key" text;--> statement-breakpoint
ALTER TABLE "mail_connection_checks" ADD CONSTRAINT "mail_connection_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_connection_checks" ADD CONSTRAINT "mail_connection_checks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_connection_checks_expiry_idx" ON "mail_connection_checks" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_identity_key_unique" UNIQUE("identity_key");