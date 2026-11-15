ALTER TABLE "auth_policies" DROP CONSTRAINT "auth_policy_limits";--> statement-breakpoint
ALTER TABLE "auth_policies" ALTER COLUMN "idle_minutes" SET DEFAULT 20160;--> statement-breakpoint
ALTER TABLE "auth_policies" ALTER COLUMN "absolute_hours" SET DEFAULT 336;--> statement-breakpoint
ALTER TABLE "auth_policies" ADD CONSTRAINT "auth_policy_limits" CHECK ("auth_policies"."idle_minutes" BETWEEN 5 AND 20160 AND "auth_policies"."absolute_hours" BETWEEN 1 AND 720 AND "auth_policies"."fresh_minutes" BETWEEN 1 AND 15 AND "auth_policies"."fresh_minutes" <= "auth_policies"."idle_minutes");--> statement-breakpoint
-- Upgrade the former defaults without widening a deliberately customized policy.
UPDATE "auth_policies" SET "idle_minutes" = 20160, "absolute_hours" = 336, "updated_at" = now()
WHERE "idle_minutes" = 30 AND "absolute_hours" = 168;
