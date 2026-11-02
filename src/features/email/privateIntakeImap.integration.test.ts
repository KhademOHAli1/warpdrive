import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { parseDeliveryReport } from "./deliveryReportParse";
import { buildMime } from "./mime";
import { heldDeliveryReportSource, withHeldSelfDelivery } from "./privateIntakeImap.test-helpers";
import { parseRawMime } from "./providers/rawMime";

it("preserves held evidence when the same IMAP identity returns different content and public hints", async () => {
  await withTestDb(async (db) =>
    withHeldSelfDelivery(db, async (f) => {
      const before = await f.snapshot();
      const fingerprint = await f.locatorFingerprint();
      const attempts = await f.attempts();
      const canonical = await f.canonical();
      const changed = Buffer.from(
        buildMime({
          from: "different@example.test",
          to: ["owner@mail.test"],
          subject: "تغییر منبع / Geänderter Inhalt",
          html: "<p>نباید جایگزین شود / Nicht ersetzen</p>",
          messageId: `<${randomUUID()}@different-public-hint.test>`,
        }),
      );
      expect(changed.equals(f.source)).toBe(false);
      expect(await f.replay(changed)).toMatchObject({
        ok: true,
        value: { applied: 0, stale: false },
      });
      expect(await f.snapshot()).toEqual(before);
      expect(await f.locatorFingerprint()).toBe(fingerprint);
      expect(await f.attempts()).toEqual(attempts);
      expect(await f.canonical()).toEqual(canonical);
      expect(f.sendCount()).toBe(1);
    }),
  );
});

it("imports ordinary new UID bytes without aliasing them to stale held content", async () => {
  await withTestDb(async (db) =>
    withHeldSelfDelivery(db, async (f) => {
      const before = await f.snapshot();
      const fingerprint = await f.locatorFingerprint();
      const attempts = await f.attempts();
      const canonical = await f.canonical();
      const subject = "نامه عادی / Gewöhnliche Nachricht";
      const changed = Buffer.from(
        buildMime({
          from: "ordinary@example.test",
          to: ["owner@mail.test"],
          subject,
          html: "<p>محتوای عادی / Gewöhnlicher Inhalt</p>",
          messageId: `<${randomUUID()}@ordinary-message.test>`,
        }),
      );
      expect(await f.replay(changed)).toMatchObject({
        ok: true,
        value: { applied: 0, stale: false },
      });
      // Continue to the native second-UID import even if provenance was already corrupted.
      expect.soft(await f.locatorFingerprint()).toBe(fingerprint);
      expect
        .soft(await f.appendOrdinary(changed))
        .toMatchObject({ ok: true, value: { applied: 1, stale: false } });
      const ordinary =
        await db.execute(sql`SELECT l.message_id,m.provider_message_id,m.subject,m.body_html
      FROM mail_message_locators l JOIN email_messages m ON m.id=l.message_id AND m.account_id=l.account_id
      WHERE l.account_id=${f.accountId} AND l.folder_id=${f.identity.folder_id}
        AND l.uid_validity='123' AND l.uid=2`);
      f.signal.throwIfAborted();
      expect(ordinary.rows).toHaveLength(1);
      expect.soft(ordinary.rows[0]?.message_id).not.toBe(f.identity.message_id);
      expect.soft(ordinary.rows[0]).toMatchObject({
        provider_message_id: `imap:${f.identity.folder_id}:123:2`,
        subject,
        body_html: expect.stringContaining("Gewöhnlicher Inhalt"),
      });
      expect(await f.snapshot()).toEqual(before);
      expect(await f.attempts()).toEqual(attempts);
      expect(await f.canonical()).toEqual(canonical);
      expect(f.sendCount()).toBe(1);
    }),
  );
});

it("keeps a purged exact IMAP identity as a tombstone without recreating its copy or payload", async () => {
  await withTestDb(async (db) =>
    withHeldSelfDelivery(db, async (f) => {
      const attempts = await f.attempts();
      const canonical = await f.canonical();
      const removed = await db.execute(sql`DELETE FROM email_messages
      WHERE id=${f.identity.message_id} AND account_id=${f.accountId} RETURNING id`);
      f.signal.throwIfAborted();
      expect(removed.rows).toEqual([{ id: f.identity.message_id }]);
      const purged = await f.snapshot();
      expect(purged).toMatchObject({
        intake: {
          owned_message_id: null,
          observed_payload: null,
          content_state: "purged",
          revision: 1,
          intake_state: "unverified",
          confirmation_attempt_id: null,
          confirmation_snapshot: null,
        },
        message: null,
      });
      for (let replay = 0; replay < 2; replay += 1) {
        expect(await f.replay(f.source)).toMatchObject({
          ok: true,
          value: { applied: 0, stale: false },
        });
        expect(await f.snapshot()).toEqual(purged);
      }
      const locators = await db.execute(sql`SELECT message_id FROM mail_message_locators
      WHERE account_id=${f.accountId} AND folder_id=${f.identity.folder_id} AND uid_validity='123' AND uid=1`);
      f.signal.throwIfAborted();
      expect(locators.rows).toEqual([{ message_id: null }]);
      expect(
        (await db.execute(sql`SELECT id FROM email_private_intake WHERE account_id=${f.accountId}`))
          .rows,
      ).toEqual([{ id: f.identity.intake_id }]);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE id=${f.identity.message_id}`))
          .rows,
      ).toEqual([]);
      expect(await f.attempts()).toEqual(attempts);
      expect(await f.canonical()).toEqual(canonical);
      expect(f.sendCount()).toBe(1);
    }),
  );
});

it("does not attach a new DSN part from changed UID bytes to the old retained source", async () => {
  await withTestDb(async (db) =>
    withHeldSelfDelivery(db, async (f) => {
      const before = await f.snapshot();
      const fingerprint = await f.locatorFingerprint();
      const attempts = await f.attempts();
      const canonical = await f.canonical();
      const reports = () =>
        db.execute(sql`SELECT id,source_message_id,part_key,content_hash
      FROM email_delivery_reports WHERE account_id=${f.accountId} ORDER BY id`);
      const reviews = () =>
        db.execute(sql`SELECT report_id,recipient_index,revision,decision,attempt_id
      FROM email_delivery_reviews WHERE account_id=${f.accountId} ORDER BY report_id,recipient_index,revision`);
      const reportsBefore = (await reports()).rows;
      const reviewsBefore = (await reviews()).rows;
      expect(reportsBefore).toEqual([]);
      expect(reviewsBefore).toEqual([]);
      const changed = heldDeliveryReportSource();
      expect(changed.equals(f.source)).toBe(false);
      // Prove the new raw source contains a valid decoded DSN, rather than passing by malformed skip.
      const parsed = await parseRawMime({ source: changed, signal: f.signal });
      expect(parsed).toMatchObject({ ok: true, value: { deliveryReports: [{ partKey: "2" }] } });
      if (!parsed.ok) return;
      const machine = parsed.value.deliveryReports[0];
      expect(machine).toBeDefined();
      if (machine === undefined) return;
      expect(
        parseDeliveryReport({
          content: machine.content,
          mediaType: machine.mediaType,
          provenance: machine.provenance,
        }),
      ).toMatchObject({ ok: true, value: { trust: "unverified" } });
      expect(await f.replay(changed)).toMatchObject({
        ok: true,
        value: { applied: 0, stale: false },
      });
      expect.soft((await reports()).rows).toEqual(reportsBefore);
      expect.soft((await reviews()).rows).toEqual(reviewsBefore);
      expect(await f.snapshot()).toEqual(before);
      expect(await f.locatorFingerprint()).toBe(fingerprint);
      expect(await f.attempts()).toEqual(attempts);
      expect(await f.canonical()).toEqual(canonical);
      expect(f.sendCount()).toBe(1);
    }),
  );
});
