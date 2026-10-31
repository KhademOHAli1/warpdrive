CREATE TABLE "privacy_case_verifications" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"subject_kind" text,
	"subject_reference_id" uuid,
	"subject_enc" "bytea",
	"recipient_enc" "bytea" NOT NULL,
	"recipient_digest" text NOT NULL,
	"evidence_enc" "bytea",
	"method" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"scope_version" integer NOT NULL,
	"recipient_version" integer NOT NULL,
	"verification_version" integer NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "privacy_verification_versions" CHECK ("privacy_case_verifications"."scope_version" > 0 AND "privacy_case_verifications"."recipient_version" > 0 AND "privacy_case_verifications"."verification_version" > 0),
	CONSTRAINT "privacy_verification_subject" CHECK ("privacy_case_verifications"."subject_kind" IS NULL OR "privacy_case_verifications"."subject_kind" IN ('user','contact','external')),
	CONSTRAINT "privacy_verification_method" CHECK ("privacy_case_verifications"."method" IS NULL OR "privacy_case_verifications"."method" IN ('operator_review','authenticated_self')),
	CONSTRAINT "privacy_verification_complete" CHECK ("privacy_case_verifications"."verified_at" IS NULL OR ("privacy_case_verifications"."verified_by" IS NOT NULL AND "privacy_case_verifications"."method" IS NOT NULL AND "privacy_case_verifications"."subject_kind" IS NOT NULL AND "privacy_case_verifications"."subject_enc" IS NOT NULL AND "privacy_case_verifications"."evidence_enc" IS NOT NULL AND length("privacy_case_verifications"."recipient_digest") > 0 AND (("privacy_case_verifications"."subject_kind" = 'external' AND "privacy_case_verifications"."subject_reference_id" IS NULL) OR ("privacy_case_verifications"."subject_kind" IN ('user','contact') AND "privacy_case_verifications"."subject_reference_id" IS NOT NULL))))
);
--> statement-breakpoint
ALTER TABLE "privacy_case_verifications" ADD CONSTRAINT "privacy_case_verifications_case_id_privacy_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."privacy_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_case_verifications" ADD CONSTRAINT "privacy_case_verifications_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;