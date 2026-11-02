import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { expect, it } from "vitest";
import { runSendJob } from "@/features/email/worker";
import { makeTestDb } from "@/test/db";
import { ok } from "@/types/result";
import { setPreference } from "../preferences";
import {
  enqueueRetainedNotification,
  type NotificationSmtpFixture,
  notificationAttempts,
  notificationGmail,
  notificationSmtpFixture,
} from "./notificationDispatch.test-helpers";
import {
  disposeNotificationResources,
  waitForNotificationCondition,
} from "./notificationPg.test-helpers";

for (const provider of ["imap_smtp", "gmail"] as const)
  for (const finish of ["ROLLBACK", "COMMIT"] as const)
    it(`${provider} defers a contended notification intent and rechecks policy after writer ${finish}`, async () => {
      const h = await makeTestDb();
      let f: NotificationSmtpFixture | undefined;
      let writer: PoolClient | undefined;
      let pending: Promise<unknown> | undefined;
      try {
        f = await notificationSmtpFixture(h.db);
        await h.db.execute(
          sql`UPDATE email_accounts SET provider=${provider} WHERE id=${f.accountId}`,
        );
        expect(await enqueueRetainedNotification(h.db, f)).toMatchObject({ ok: true });
        const frozen = structuredClone(
          (await notificationAttempts(h.db, f.notificationId))[0]?.payload,
        );
        const gmail = notificationGmail(f);
        const deps = { ...f.deps, resolveClient: () => Promise.resolve(ok(gmail)) };
        const args = {
          accountId: f.accountId,
          idempotencyKey: f.notificationId,
          signal: f.args.signal,
        };
        writer = await h.pool.connect();
        await writer.query("BEGIN");
        await writer.query(
          "UPDATE notification_preferences SET email=false WHERE user_id=$1 AND type='activity_reminder'",
          [f.owner.id],
        );
        let settled = false;
        const first = runSendJob(h.db, args, deps);
        pending = first.finally(() => {
          settled = true;
        });
        void pending.catch(() => undefined);
        await waitForNotificationCondition(f.args.signal, () => Promise.resolve(settled));
        await first;
        expect(f.smtp.received).toHaveLength(0);
        expect(gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(0);
        const deferred = (
          await h.db.execute(sql`SELECT send_started_at,notification_suppressed_at,notification_suppression_reason
          FROM email_send_attempts WHERE account_id=${f.accountId} AND idempotency_key=${f.notificationId}`)
        ).rows;
        expect(deferred).toEqual([
          {
            send_started_at: null,
            notification_suppressed_at: null,
            notification_suppression_reason: null,
          },
        ]);
        await writer.query(finish);
        await runSendJob(h.db, args, deps);
        const sends =
          provider === "gmail"
            ? gmail.calls.filter((call) => call.method === "sendRaw").length
            : f.smtp.received.length;
        expect(sends).toBe(finish === "ROLLBACK" ? 1 : 0);
        const rows = await notificationAttempts(h.db, f.notificationId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.payload).toEqual(frozen);
        if (finish === "COMMIT") {
          const suppression = (
            await h.db.execute(sql`SELECT notification_suppressed_at,notification_suppression_reason
            FROM email_send_attempts WHERE idempotency_key=${f.notificationId}`)
          ).rows[0];
          expect(suppression?.notification_suppressed_at).not.toBeNull();
          expect(suppression?.notification_suppression_reason).toBe("preference_disabled");
          await setPreference(
            h.db,
            f.owner.id,
            "activity_reminder",
            { inApp: true, email: true },
            f.args.signal,
          );
          await runSendJob(h.db, args, deps);
        } else await runSendJob(h.db, args, deps);
        expect(f.smtp.received).toHaveLength(
          provider === "imap_smtp" && finish === "ROLLBACK" ? 1 : 0,
        );
        expect(gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(
          provider === "gmail" && finish === "ROLLBACK" ? 1 : 0,
        );
      } finally {
        await disposeNotificationResources(
          writer === undefined
            ? undefined
            : async () => {
                try {
                  await writer?.query("ROLLBACK");
                } finally {
                  writer?.release();
                }
              },
          f === undefined ? undefined : () => f?.close() ?? Promise.resolve(),
          pending === undefined ? undefined : () => pending ?? Promise.resolve(),
          () => h.close(),
        );
      }
    });

it("releases notification authority locks before native SMTP waits for the DATA acknowledgement", async () => {
  const h = await makeTestDb();
  let f: NotificationSmtpFixture | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    f = await notificationSmtpFixture(h.db, { stallAfterData: true });
    expect(await enqueueRetainedNotification(h.db, f)).toMatchObject({ ok: true });
    const frozen = structuredClone(
      (await notificationAttempts(h.db, f.notificationId))[0]?.payload,
    );
    const fixture = f;
    const args = {
      accountId: f.accountId,
      idempotencyKey: f.notificationId,
      signal: f.args.signal,
    };
    pending = runSendJob(h.db, args, f.deps);
    void pending.catch(() => undefined);
    await waitForNotificationCondition(f.args.signal, () =>
      Promise.resolve(fixture.smtp.received.length === 1),
    );
    // A bounded writer transaction must commit while SMTP is still awaiting its response.
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout='1s'`);
      await tx.execute(sql`UPDATE notification_preferences SET email=false
        WHERE user_id=${fixture.owner.id} AND type='activity_reminder'`);
    });
    fixture.smtp.disconnect();
    await pending;
    await runSendJob(h.db, args, f.deps);
    expect(f.smtp.received).toHaveLength(1);
    const rows = await notificationAttempts(h.db, f.notificationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual(frozen);
    expect(rows[0]).toMatchObject({ delivery_outcome: { state: "unknown" } });
    expect(
      (
        await h.db.execute(sql`SELECT notification_suppressed_at FROM email_send_attempts
      WHERE idempotency_key=${f.notificationId}`)
      ).rows[0]?.notification_suppressed_at,
    ).toBeNull();
  } finally {
    await disposeNotificationResources(
      f === undefined ? undefined : () => f?.close() ?? Promise.resolve(),
      pending === undefined ? undefined : () => pending ?? Promise.resolve(),
      () => h.close(),
    );
  }
});

it("releases notification authority locks before Gmail waits for its HTTP acknowledgement", async () => {
  const h = await makeTestDb();
  let f: NotificationSmtpFixture | undefined;
  let pending: Promise<unknown> | undefined;
  let releaseResponse = () => {};
  try {
    f = await notificationSmtpFixture(h.db);
    await h.db.execute(sql`UPDATE email_accounts SET provider='gmail' WHERE id=${f.accountId}`);
    expect(await enqueueRetainedNotification(h.db, f)).toMatchObject({ ok: true });
    const gmail = notificationGmail(f);
    const sendRaw = gmail.sendRaw.bind(gmail);
    const response = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let submitted = false;
    gmail.sendRaw = async (args) => {
      submitted = true;
      await response;
      args.signal.throwIfAborted();
      return sendRaw(args);
    };
    const deps = { ...f.deps, resolveClient: () => Promise.resolve(ok(gmail)) };
    const args = {
      accountId: f.accountId,
      idempotencyKey: f.notificationId,
      signal: f.args.signal,
    };
    pending = runSendJob(h.db, args, deps);
    void pending.catch(() => undefined);
    await waitForNotificationCondition(f.args.signal, () => Promise.resolve(submitted));
    const ownerId = f.owner.id;
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout='1s'`);
      await tx.execute(sql`UPDATE notification_preferences SET email=false
        WHERE user_id=${ownerId} AND type='activity_reminder'`);
    });
    releaseResponse();
    expect(await pending).toMatchObject({ ok: true, value: { status: "sent" } });
    await runSendJob(h.db, args, deps);
    expect(gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
    expect(
      (
        await h.db.execute(sql`SELECT notification_suppressed_at FROM email_send_attempts
      WHERE idempotency_key=${f.notificationId}`)
      ).rows[0]?.notification_suppressed_at,
    ).toBeNull();
  } finally {
    releaseResponse();
    await disposeNotificationResources(
      f === undefined ? undefined : () => f?.close() ?? Promise.resolve(),
      pending === undefined ? undefined : () => pending ?? Promise.resolve(),
      () => h.close(),
    );
  }
});
