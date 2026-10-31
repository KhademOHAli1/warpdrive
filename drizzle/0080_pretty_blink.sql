CREATE TABLE "auth_totp_replays" (
	"factor_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_totp_replays_factor_id_digest_pk" PRIMARY KEY("factor_id","digest")
);
--> statement-breakpoint
ALTER TABLE "auth_totp_replays" ADD CONSTRAINT "auth_totp_replays_factor_id_auth_two_factors_id_fk" FOREIGN KEY ("factor_id") REFERENCES "public"."auth_two_factors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_totp_replay_expiry_idx" ON "auth_totp_replays" USING btree ("expires_at");