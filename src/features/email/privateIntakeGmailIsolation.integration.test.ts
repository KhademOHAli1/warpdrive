import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { prepareNotificationEmail } from "@/features/notifications/email/notificationBinding";
import {
  gmailNotificationCollisionFixture,
  NOTIFICATION_PROVIDER_MESSAGE_ID,
} from "@/features/notifications/email/notificationCrmPrivacy.test-helpers";
import {
  disposeNotificationResources,
  waitForNotificationCondition,
} from "@/features/notifications/email/notificationPg.test-helpers";
import { makeTestDb } from "@/test/db";
import { ok } from "@/types/result";
import { storeNotificationGmailCopy } from "./notificationGmailCopy";
import { processSendAttempt } from "./outbox";

interface HeldState {
  id: string;
  owned_message_id: string;
  intake_state: string;
  revision: number;
  confirmation_attempt_id: string | null;
  confirmation_snapshot: unknown;
  baseline_attachments_hash: string;
  current_attachments_hash: string;
  message: unknown;
  thread: unknown;
  attempt: unknown;
}

async function heldState(db: Db, accountId: string, signal: AbortSignal): Promise<HeldState> {
  const row = (
    await db.execute(sql`SELECT i.id,i.owned_message_id,i.intake_state,i.revision,
      i.confirmation_attempt_id,i.confirmation_snapshot,i.baseline_attachments_hash,
      b.attachments_hash AS current_attachments_hash,
      to_jsonb(m) AS message,to_jsonb(t) AS thread,to_jsonb(s) AS attempt
    FROM email_private_intake i
    JOIN email_messages m ON m.id=i.owned_message_id AND m.account_id=i.account_id
    JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
    JOIN email_send_attempts s ON s.account_id=i.account_id
      AND s.gmail_message_id=i.observed_provider_id
    CROSS JOIN LATERAL public.private_intake_baseline_v1(i.account_id,m.id) b
    WHERE i.account_id=${accountId} AND i.provider='gmail'
      AND i.observed_provider_id=${NOTIFICATION_PROVIDER_MESSAGE_ID}`)
  ).rows;
  signal.throwIfAborted();
  expect(row).toHaveLength(1);
  const state = row[0] as HeldState | undefined;
  if (state === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Gmail isolation fixture held copy missing");
  return state;
}

async function releaseContender(client: PoolClient | undefined): Promise<void> {
  if (client === undefined) return;
  try {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

it("refuses a Gmail promotion after an attachment commits during its parent-lock wait under an operator RR default", async () => {
  const h = await makeTestDb();
  const db = drizzle(h.pool, { schema });
  const signal = AbortSignal.timeout(20_000);
  const applicationName = `wd_gmail_rr_${randomUUID()}`;
  const repeatableReadPool = new Pool({
    ...db.$client.options,
    options: "-c default_transaction_isolation=repeatable\\ read",
    application_name: applicationName,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 12_000,
    lock_timeout: 10_000,
  });
  const copyDb = drizzle(repeatableReadPool, { schema });
  let contender: PoolClient | undefined;
  let observer: PoolClient | undefined;
  let pending: ReturnType<typeof storeNotificationGmailCopy> | undefined;
  try {
    const f = await gmailNotificationCollisionFixture(db, signal);
    const original = await f.originalState();
    expect(
      await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
    ).toMatchObject({ ok: true, value: { status: "prepared" } });
    let preAckIntakes = 0;
    const providerSend = f.transport.gmail.sendRaw.bind(f.transport.gmail);
    f.transport.gmail.sendRaw = async (args) => {
      const accepted = await providerSend(args);
      if (!accepted.ok) return accepted;
      preAckIntakes += 1;
      expect((await f.sync()).result).toMatchObject({ ok: true });
      return accepted;
    };
    expect(
      await processSendAttempt(db, {
        accountId: f.account.id,
        idempotencyKey: f.notificationId,
        gmail: f.transport.gmail,
        storage: f.transport.deps.storage,
        signal,
      }),
    ).toEqual(ok({ status: "sent", gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID }));
    expect(preAckIntakes).toBe(1);
    const before = await heldState(db, f.account.id, signal);
    expect(before).toMatchObject({
      intake_state: "unverified",
      confirmation_attempt_id: null,
      confirmation_snapshot: null,
      attempt: {
        status: "sent",
        gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        delivery_outcome: { state: "accepted", evidence: "api_ack" },
      },
    });
    expect(before.current_attachments_hash).toBe(before.baseline_attachments_hash);
    expect((await repeatableReadPool.query("SHOW default_transaction_isolation")).rows).toEqual([
      { default_transaction_isolation: "repeatable read" },
    ]);
    signal.throwIfAborted();

    contender = await db.$client.connect();
    observer = await db.$client.connect();
    await contender.query("BEGIN");
    await contender.query("SET LOCAL statement_timeout='12s'");
    const contenderPid = (await contender.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
      .rows[0]?.pid;
    expect(typeof contenderPid).toBe("number");
    const attachmentId = randomUUID();
    // The actual FK check holds KEY SHARE on the message until this transaction ends.
    await contender.query(
      `INSERT INTO email_message_attachments
        (id,account_id,message_id,gmail_attachment_id,filename,mime_type,size_bytes)
        VALUES ($1,$2,$3,'concurrent-local-part','ویرایش / Bearbeitung.pdf','application/pdf',7)`,
      [attachmentId, f.account.id, before.owned_message_id],
    );
    signal.throwIfAborted();
    pending = storeNotificationGmailCopy(copyDb, {
      accountId: f.account.id,
      idempotencyKey: f.notificationId,
      gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
      signal,
    });
    void pending.catch(() => undefined);
    const controller = observer;
    await waitForNotificationCondition(signal, async () => {
      await controller.query("SELECT pg_stat_clear_snapshot()");
      signal.throwIfAborted();
      const waiting = await controller.query<{ query: string }>(
        `SELECT query FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=$1
          AND state='active' AND wait_event_type='Lock'
          AND $2::int=ANY(pg_blocking_pids(pid))`,
        [applicationName, contenderPid],
      );
      signal.throwIfAborted();
      return waiting.rows.some(
        (row) =>
          row.query.includes("FROM email_messages m") && row.query.includes("FOR UPDATE OF m,t"),
      );
    });
    await contender.query("COMMIT");
    signal.throwIfAborted();
    expect.soft(await pending).toMatchObject({
      ok: false,
      error: { id: ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT },
    });
    const after = await heldState(db, f.account.id, signal);
    expect.soft(after).toMatchObject({
      id: before.id,
      owned_message_id: before.owned_message_id,
      intake_state: "conflict",
      revision: before.revision + 1,
      confirmation_attempt_id: null,
      confirmation_snapshot: null,
      baseline_attachments_hash: before.baseline_attachments_hash,
    });
    expect.soft(after.current_attachments_hash).not.toBe(before.baseline_attachments_hash);
    expect.soft(after.message).toEqual(before.message);
    expect.soft(after.thread).toEqual(before.thread);
    expect.soft(after.attempt).toEqual(before.attempt);
    expect.soft(await f.originalState()).toEqual(original);
    expect(
      (
        await db.execute(sql`SELECT id FROM email_message_attachments
        WHERE id=${attachmentId} AND account_id=${f.account.id}
          AND message_id=${before.owned_message_id}`)
      ).rows,
    ).toEqual([{ id: attachmentId }]);
    signal.throwIfAborted();
    expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
  } finally {
    await disposeNotificationResources(
      () => releaseContender(contender),
      () => pending ?? Promise.resolve(),
      () => Promise.resolve(observer?.release()),
      () => repeatableReadPool.end(),
      () => h.close(),
    );
  }
});
