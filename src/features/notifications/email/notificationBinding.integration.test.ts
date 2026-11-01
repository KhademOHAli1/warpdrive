import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { selectDefaultMailbox } from "@/features/email/mailAccountsRepo";
import { enqueueSend } from "@/features/email/outbox";
import { makeTestDb } from "@/test/db";
import { prepareNotificationEmail } from "./notificationBinding";
import { notificationAttempts, notificationSmtpFixture } from "./notificationDispatch.test-helpers";
import {
  disposeNotificationResources,
  waitForNotificationWaiters,
} from "./notificationPg.test-helpers";

it("binds concurrent first deliveries to one eligible default account and one immutable attempt", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      await f.addSecondMailbox();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => prepareNotificationEmail(db, f.input)),
      );
      expect(results.every((r) => r.ok && r.value.status === "prepared")).toBe(true);
      const attempts = await notificationAttempts(db, f.notificationId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        account_id: f.accountId,
        idempotency_key: f.notificationId,
      });
      expect(f.smtp.received).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});

it("pins concurrent binders across a committed default change using the real owner-lock queue", async () => {
  const h = await makeTestDb();
  let f: Awaited<ReturnType<typeof notificationSmtpFixture>> | undefined;
  let controller: PoolClient | undefined;
  const pending: Promise<unknown>[] = [];
  try {
    f = await notificationSmtpFixture(h.db);
    const second = await f.addSecondMailbox();
    controller = await h.pool.connect();
    await controller.query("BEGIN");
    await controller.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [f.owner.id]);
    const first = prepareNotificationEmail(h.db, f.input);
    pending.push(first);
    void first.catch(() => undefined);
    await waitForNotificationWaiters(controller, 1, f.args.signal);
    const change = selectDefaultMailbox(h.db, f.owner.id, second, f.args.signal);
    pending.push(change);
    void change.catch(() => undefined);
    await waitForNotificationWaiters(controller, 2, f.args.signal);
    const replay = prepareNotificationEmail(h.db, f.input);
    pending.push(replay);
    void replay.catch(() => undefined);
    await waitForNotificationWaiters(controller, 3, f.args.signal);
    await controller.query("COMMIT");
    expect(await change).toMatchObject({ ok: true });
    expect(await first).toMatchObject({ ok: true, value: { accountId: f.accountId } });
    expect(await replay).toEqual(await first);
    expect(
      (
        await h.db.execute(
          sql`SELECT id FROM email_accounts WHERE user_id=${f.owner.id} AND is_default`,
        )
      ).rows,
    ).toEqual([{ id: second }]);
    expect(await notificationAttempts(h.db, f.notificationId)).toMatchObject([
      { account_id: f.accountId },
    ]);
    expect(await notificationAttempts(h.db, f.notificationId)).toHaveLength(1);
    expect(f.smtp.received).toHaveLength(0);
  } finally {
    await disposeNotificationResources(
      controller === undefined
        ? undefined
        : async () => {
            try {
              await controller?.query("ROLLBACK");
            } finally {
              controller?.release();
            }
          },
      () => Promise.allSettled(pending),
      f === undefined ? undefined : () => f?.close() ?? Promise.resolve(),
      () => h.close(),
    );
  }
});

it("does not adopt or overwrite an interactive intent that collides with the notification key", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const original = {
        to: ["other@mail.test"],
        subject: "Independent user message",
        html: "<p>Keep this intact</p>",
      };
      await enqueueSend(db, {
        accountId: f.accountId,
        idempotencyKey: f.notificationId,
        payload: original,
      });
      const before = await notificationAttempts(db, f.notificationId);
      expect(before).toHaveLength(1);
      const result = await prepareNotificationEmail(db, f.input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.id).toBe(ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT);
      expect(await notificationAttempts(db, f.notificationId)).toEqual(before);
      const rows = (
        await db.execute(
          sql`SELECT payload FROM email_send_attempts WHERE account_id=${f.accountId} AND idempotency_key=${f.notificationId}`,
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toEqual(before[0]?.payload);
      expect(f.smtp.received).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});

it("rejects a colliding interactive intent on another mailbox even when the chosen default has no attempt", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const second = await f.addSecondMailbox();
      expect(
        await enqueueSend(db, {
          accountId: second,
          idempotencyKey: f.notificationId,
          payload: {
            to: ["customer@mail.test"],
            subject: "Original",
            html: "<p>Independent intent</p>",
            bcc: ["private@mail.test"],
          },
        }),
      ).toMatchObject({ ok: true });
      const before = await notificationAttempts(db, f.notificationId);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ account_id: second });
      expect(await prepareNotificationEmail(db, f.input)).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT },
      });
      expect(await notificationAttempts(db, f.notificationId)).toEqual(before);
      expect(f.smtp.received).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});

it("chooses an eligible deterministic fallback instead of an unavailable default", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const second = await f.addSecondMailbox();
      await db.execute(
        sql`UPDATE email_accounts SET status='disconnected' WHERE id=${f.accountId}`,
      );
      expect(await prepareNotificationEmail(db, f.input)).toMatchObject({
        ok: true,
        value: { status: "prepared", accountId: second },
      });
      expect(await notificationAttempts(db, f.notificationId)).toMatchObject([
        { account_id: second },
      ]);
    } finally {
      await f.close();
    }
  });
});

for (const [locale, prefix, direction] of [
  ["fa", "یادآوری:", "rtl"],
  ["de", "Erinnerung:", "ltr"],
  ["en", "Reminder:", "ltr"],
] as const)
  it(`freezes the recipient's latest ${locale} rendering and an untracked private purpose`, async () => {
    await withTestDb(async (db) => {
      const f = await notificationSmtpFixture(db);
      try {
        await f.locale(locale === "fa" ? "de" : "fa");
        await f.locale(locale);
        expect(await prepareNotificationEmail(db, f.input)).toMatchObject({
          ok: true,
          value: { status: "prepared" },
        });
        const attempts = await notificationAttempts(db, f.notificationId);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]?.payload).toMatchObject({
          to: [f.runtime.emailAddress],
          visibility: "private",
          trackOpens: false,
          trackLinks: false,
          systemPurpose: {
            version: 1,
            kind: "notification",
            notificationId: f.notificationId,
            recipientUserId: f.owner.id,
          },
        });
        const payload = attempts[0]?.payload as Record<string, unknown>;
        expect(payload.subject).toContain(prefix);
        expect(payload.html).toContain(`lang="${locale}" dir="${direction}"`);
        expect(payload.html).toContain("&lt;Acme&gt;");
        expect(payload.html).not.toContain("<Acme>");
        expect(payload.signatureId).toBeUndefined();
        const frozen = structuredClone(payload);
        await f.locale(locale === "de" ? "en" : "de");
        await prepareNotificationEmail(db, f.input);
        const replay = await notificationAttempts(db, f.notificationId);
        expect(replay).toHaveLength(1);
        expect(replay[0]?.payload).toEqual(frozen);
      } finally {
        await f.close();
      }
    });
  });
