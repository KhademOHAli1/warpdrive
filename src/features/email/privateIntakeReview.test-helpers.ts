import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { connectNotificationMailbox } from "@/features/notifications/email/notificationJob.test-helpers";
import {
  type MailSessionFixtureOptions,
  seedMailHttpSession,
} from "./mailConnectionHttp.test-helpers";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";

export const privateReviewSignal = () => AbortSignal.timeout(30_000);

// Real native identity/session rows from the existing HTTP fixture. No actor-only
// shortcut or synthetic full-session claim is passed to the service under test.
export async function seedNativePrivateReviewMailbox(
  db: Db,
  signal: AbortSignal,
  options: MailSessionFixtureOptions = {},
) {
  const owner = await seedMailHttpSession(db, {
    freshAt: new Date(Date.now() - 3_600_000),
    mfaAt: null,
    ...options,
  });
  const account = await connectNotificationMailbox(db, owner.user.id, signal);
  return { owner, account };
}

export async function seedNativePrivateReview(
  db: Db,
  signal: AbortSignal,
  options: MailSessionFixtureOptions = {},
) {
  const { owner, account } = await seedNativePrivateReviewMailbox(db, signal, options);
  const intake = await seedPrivateIntake(db, signal, { accountId: account.id });
  return {
    ...intake,
    owner,
    account,
    scope: { accountId: account.id, intakeId: intake.id },
    input: {
      accountId: account.id,
      intakeId: intake.id,
      expectedRevision: 0,
      decision: "keep_private" as const,
    },
  };
}

export async function privateReviewHistory(db: Db, intakeId: string, signal: AbortSignal) {
  const result = await db.execute(sql`SELECT revision,decision,actor_id
    FROM email_private_intake_reviews WHERE intake_id=${intakeId} ORDER BY revision`);
  signal.throwIfAborted();
  return result.rows;
}

// Revision/history are the only expected review effects. All body, provenance,
// provider identity, submission, tracking and notification facts remain identical.
export async function privateReviewProtectedSnapshot(
  db: Db,
  accountId: string,
  signal: AbortSignal,
) {
  const result = await db.execute(sql`SELECT jsonb_build_object(
    'intake',(SELECT jsonb_agg(to_jsonb(i)-'revision' ORDER BY i.id)
      FROM email_private_intake i WHERE i.account_id=${accountId}),
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb)
      FROM email_messages m WHERE m.account_id=${accountId}),
    'threads',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)
      FROM email_threads t WHERE t.account_id=${accountId}),
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM email_send_attempts s WHERE s.account_id=${accountId}),
    'tracking',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.id),'[]'::jsonb)
      FROM email_tracking_tokens k JOIN email_send_attempts s ON s.id=k.send_attempt_id
      WHERE s.account_id=${accountId}),
    'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]'::jsonb)
      FROM notifications n JOIN email_accounts a ON a.user_id=n.user_id WHERE a.id=${accountId})
    ) AS snapshot`);
  signal.throwIfAborted();
  return result.rows;
}

export async function privateReviewMutableSnapshot(db: Db, intakeId: string, signal: AbortSignal) {
  const result = await db.execute(sql`SELECT to_jsonb(i) AS intake,
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.revision),'[]'::jsonb)
      FROM email_private_intake_reviews r WHERE r.intake_id=i.id) AS reviews
    FROM email_private_intake i WHERE i.id=${intakeId}`);
  signal.throwIfAborted();
  return result.rows;
}
