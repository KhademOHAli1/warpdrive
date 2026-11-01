import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  EMAIL_NOTIFICATION_QUEUE,
  PGBOSS_QUEUE_EMAIL_SEND,
  PGBOSS_QUEUE_EMAIL_SYNC,
} from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { recoverMailJobs } from "@/features/email/mailJobRecovery";
import { enqueueSend, processSendAttempt } from "@/features/email/outbox";
import { observeBossErrors } from "@/jobs/bossObserver";
import { makeTestDb } from "@/test/db";
import { setPreference } from "../preferences";
import { registerEmailNotificationWorker } from "./job";
import { prepareNotificationEmail } from "./notificationBinding";
import { gmailNotificationCollisionFixture } from "./notificationCrmPrivacy.test-helpers";
import { notificationAttempts, notificationSmtpFixture } from "./notificationDispatch.test-helpers";
import type { NotificationDispatchDependencies } from "./notificationEmailTypes";
import {
  disposeNotificationResources,
  waitForNotificationCondition,
} from "./notificationPg.test-helpers";

type FixtureRegistration = (
  boss: PgBoss,
  options: {
    db: Db;
    dispatchDeps: NotificationDispatchDependencies;
  },
) => Promise<void>;

it("routes retained notification recovery to the existing notification queue and never resurrects an opted-out intent", async () => {
  const h = await makeTestDb();
  let boss: PgBoss | undefined;
  let f: Awaited<ReturnType<typeof notificationSmtpFixture>> | undefined;
  try {
    f = await notificationSmtpFixture(h.db);
    boss = new PgBoss({ connectionString: h.url });
    observeBossErrors(boss, "worker");
    await boss.start();
    for (const queue of [
      EMAIL_NOTIFICATION_QUEUE,
      PGBOSS_QUEUE_EMAIL_SEND,
      PGBOSS_QUEUE_EMAIL_SYNC,
    ])
      await boss.createQueue(queue);
    expect(
      await enqueueSend(h.db, {
        accountId: f.accountId,
        idempotencyKey: f.notificationId,
        payload: {
          to: [f.runtime.emailAddress],
          subject: "Retained notification",
          html: "<p>Private notice</p>",
          visibility: "private",
          trackOpens: false,
          trackLinks: false,
          systemPurpose: {
            version: 1,
            kind: "notification",
            notificationId: f.notificationId,
            recipientUserId: f.owner.id,
          },
        },
      }),
    ).toMatchObject({ ok: true });
    const frozen = structuredClone(
      (await notificationAttempts(h.db, f.notificationId))[0]?.payload,
    );
    await f.revoke("opt_out");
    await recoverMailJobs(h.db, boss, f.args.signal);
    const jobs = (
      await h.db.execute(sql`SELECT id,name,data FROM pgboss.job WHERE state='created'`)
    ).rows;
    expect(jobs.filter((job) => job.name === PGBOSS_QUEUE_EMAIL_SEND)).toHaveLength(0);
    expect(jobs.filter((job) => job.name === EMAIL_NOTIFICATION_QUEUE)).toMatchObject([
      { data: { notificationId: f.notificationId } },
    ]);
    const recovered = jobs.find((job) => job.name === EMAIL_NOTIFICATION_QUEUE);
    expect(recovered).toBeDefined();
    // Fail closed before calling the legacy one-argument registrar, which imports global DB.
    // The approved optional options parameter must be declared without an initializer.
    if (registerEmailNotificationWorker.length < 2)
      throw new AppError(
        ERROR_IDS.NOTIF_SEND_PURPOSE_INVALID,
        "Notification worker fixture injection is not implemented",
      );
    const register: FixtureRegistration = registerEmailNotificationWorker;
    await register(boss, { db: h.db, dispatchDeps: f.deps });
    const notificationId = f.notificationId;
    const signal = f.args.signal;
    await waitForNotificationCondition(
      signal,
      async () =>
        (
          await h.db.execute(
            sql`SELECT id FROM pgboss.job WHERE id=${recovered?.id} AND state='completed'`,
          )
        ).rows.length === 1,
    );
    const suppression = (
      await h.db.execute(sql`SELECT notification_suppressed_at,notification_suppression_reason
      FROM email_send_attempts WHERE idempotency_key=${notificationId}`)
    ).rows;
    expect(suppression).toHaveLength(1);
    expect(suppression[0]?.notification_suppressed_at).not.toBeNull();
    expect(suppression[0]?.notification_suppression_reason).toBe("preference_disabled");
    await setPreference(
      h.db,
      f.owner.id,
      "activity_reminder",
      { inApp: true, email: true },
      f.args.signal,
    );
    const replayJob = await boss.send(EMAIL_NOTIFICATION_QUEUE, { notificationId });
    expect(replayJob).not.toBeNull();
    await waitForNotificationCondition(
      signal,
      async () =>
        (
          await h.db.execute(
            sql`SELECT id FROM pgboss.job WHERE id=${replayJob} AND state='completed'`,
          )
        ).rows.length === 1,
    );
    const replay = await notificationAttempts(h.db, notificationId);
    expect(replay).toHaveLength(1);
    expect(replay[0]?.payload).toEqual(frozen);
    expect(
      (
        await h.db.execute(sql`SELECT notification_suppressed_at,notification_suppression_reason
      FROM email_send_attempts WHERE idempotency_key=${notificationId}`)
      ).rows,
    ).toEqual(suppression);
    expect(f.smtp.received).toHaveLength(0);
    expect(f.smtp.authenticationAttempts()).toBe(0);
  } finally {
    await disposeNotificationResources(
      boss === undefined ? undefined : () => boss?.stop() ?? Promise.resolve(),
      f === undefined ? undefined : () => f?.close() ?? Promise.resolve(),
      () => h.close(),
    );
  }
});

it("recovers a known Gmail notification ACK after disconnect through the notification consumer without provider IO", async () => {
  const h = await makeTestDb();
  let boss: PgBoss | undefined;
  try {
    const signal = AbortSignal.timeout(30_000);
    const f = await gmailNotificationCollisionFixture(h.db, signal);
    expect(
      await prepareNotificationEmail(h.db, { notificationId: f.notificationId, signal }),
    ).toMatchObject({ ok: true, value: { status: "prepared" } });
    expect(
      await processSendAttempt(h.db, {
        accountId: f.account.id,
        idempotencyKey: f.notificationId,
        gmail: f.transport.gmail,
        storage: f.transport.deps.storage,
        signal,
      }),
    ).toMatchObject({ ok: true, value: { status: "sent" } });
    expect(await f.copy()).toEqual([]);
    await h.db.execute(sql`UPDATE email_accounts SET status='disconnected',
      connection_generation=connection_generation+1 WHERE id=${f.account.id}`);
    const providerCalls = [...f.transport.gmail.calls];
    const resolveClient = vi.fn(f.transport.deps.resolveClient);
    boss = new PgBoss(h.url);
    observeBossErrors(boss, "worker");
    await boss.start();
    for (const queue of [
      EMAIL_NOTIFICATION_QUEUE,
      PGBOSS_QUEUE_EMAIL_SEND,
      PGBOSS_QUEUE_EMAIL_SYNC,
    ])
      await boss.createQueue(queue);
    await Promise.all([recoverMailJobs(h.db, boss, signal), recoverMailJobs(h.db, boss, signal)]);
    const queued = (
      await h.db.execute(sql`SELECT id,name,data FROM pgboss.job WHERE state='created'`)
    ).rows;
    expect(queued.filter((row) => row.name === PGBOSS_QUEUE_EMAIL_SEND)).toEqual([]);
    const notices = queued.filter((row) => row.name === EMAIL_NOTIFICATION_QUEUE);
    expect(notices).toMatchObject([{ data: { notificationId: f.notificationId } }]);
    const jobId = notices[0]?.id;
    expect(jobId).toBeDefined();
    await registerEmailNotificationWorker(boss, {
      db: h.db,
      dispatchDeps: { ...f.transport.deps, resolveClient },
    });
    await waitForNotificationCondition(
      signal,
      async () =>
        (await h.db.execute(sql`SELECT id FROM pgboss.job WHERE id=${jobId} AND state='completed'`))
          .rows.length === 1,
    );
    expect(await f.copy()).toMatchObject([
      { visibility: "private", person_id: null, deal_id: null },
    ]);
    const marker = (
      await h.db.execute(sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`)
    ).rows;
    expect(marker).toHaveLength(1);
    expect(marker[0]?.email_sent_at).not.toBeNull();
    await recoverMailJobs(h.db, boss, signal);
    expect(
      (await h.db.execute(sql`SELECT id FROM pgboss.job WHERE name=${EMAIL_NOTIFICATION_QUEUE}`))
        .rows,
    ).toHaveLength(1);
    expect(resolveClient).not.toHaveBeenCalled();
    expect(f.transport.gmail.calls).toEqual(providerCalls);
    expect(f.transport.gmail.raw).toHaveLength(1);
  } finally {
    await disposeNotificationResources(
      boss === undefined ? undefined : () => boss?.stop() ?? Promise.resolve(),
      () => h.close(),
    );
  }
});
