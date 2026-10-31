CREATE TABLE "auth_email_verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"target_email" "citext",
	"purpose" text NOT NULL,
	"parent_token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_email_verification_tokens" ADD CONSTRAINT "auth_email_verification_tokens_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_email_verification_user_idx" ON "auth_email_verification_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "auth_email_verification_expiry_idx" ON "auth_email_verification_tokens" USING btree ("expires_at");