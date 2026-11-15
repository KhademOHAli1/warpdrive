-- Do not revive modern sessions that already exceeded the previous policy.
-- Legacy workflow sessions retain their separately qualified compatibility rules.
WITH previous_policy AS (
  SELECT
    COALESCE((SELECT idle_minutes FROM auth_policies WHERE id = true), 30) AS idle_minutes,
    COALESCE((SELECT absolute_hours FROM auth_policies WHERE id = true), 168) AS absolute_hours
)
UPDATE sessions SET revoked_at = now()
FROM previous_policy
WHERE sessions.revoked_at IS NULL AND sessions.auth_method <> 'legacy'
  AND (sessions.expires_at <= now()
    OR sessions.last_seen_at <= now() - previous_policy.idle_minutes * interval '1 minute'
    OR sessions.created_at <= now() - previous_policy.absolute_hours * interval '1 hour');--> statement-breakpoint
ALTER TABLE "auth_policies" DROP CONSTRAINT "auth_policy_limits";--> statement-breakpoint
ALTER TABLE "auth_policies" ALTER COLUMN "idle_minutes" SET DEFAULT 20160;--> statement-breakpoint
ALTER TABLE "auth_policies" ALTER COLUMN "absolute_hours" SET DEFAULT 336;--> statement-breakpoint
ALTER TABLE "auth_policies" ADD CONSTRAINT "auth_policy_limits" CHECK ("auth_policies"."idle_minutes" BETWEEN 5 AND 20160 AND "auth_policies"."absolute_hours" BETWEEN 1 AND 720 AND "auth_policies"."fresh_minutes" BETWEEN 1 AND 15 AND "auth_policies"."fresh_minutes" <= "auth_policies"."idle_minutes");--> statement-breakpoint
-- Upgrade the former defaults without widening a deliberately customized policy.
UPDATE "auth_policies" SET "idle_minutes" = 20160, "absolute_hours" = 336, "updated_at" = now()
WHERE "idle_minutes" = 30 AND "absolute_hours" = 168;
