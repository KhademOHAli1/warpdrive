import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  deliveryMachinePart,
  deliverySignal,
  seedDeliveryFixture,
  seedDeliverySource,
  submissionFacts,
} from "./deliveryObservation.test-helpers";
import { ingestDeliveryReports } from "./deliveryObservationIngest";

describe("untrusted delivery observation storage", () => {
  it("stores native FA/DE observations idempotently without mutating submission facts", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const before = await submissionFacts(db, f.attempt.attemptId);
      const input = {
        accountId: f.accountId,
        sourceMessageId: f.source.messageId,
        parts: [deliveryMachinePart()],
      };
      const first = await ingestDeliveryReports(db, input, deliverySignal());
      expect(first).toMatchObject({ ok: true, value: { skipped: 0 } });
      if (!first.ok) return;
      expect(first.value.reportIds).toHaveLength(1);
      expect(await ingestDeliveryReports(db, input, deliverySignal())).toEqual(first);
      const stored = (
        await db.execute(sql`SELECT account_id,source_message_id,part_key,parsed
        FROM email_delivery_reports`)
      ).rows;
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        account_id: f.accountId,
        source_message_id: f.source.messageId,
        part_key: "2",
        parsed: {
          trust: "unverified",
          requiresReview: true,
          correlationAuthority: false,
          recipients: [
            {
              action: "failed",
              localizedDiagnostics: [
                { languageTag: "fa", text: "نشانی گیرنده پیدا نشد", display: "plain_text" },
                {
                  languageTag: "de",
                  text: "Die Empfängeradresse wurde nicht gefunden",
                  display: "plain_text",
                },
              ],
            },
          ],
        },
      });
      expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("never infers an association from forged RFC IDs, ENVIDs, or public attempt headers", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const part = deliveryMachinePart();
      part.content = Buffer.from(
        part.content
          .toString()
          .replace(
            "Reporting-MTA:",
            `Original-Message-ID: ${f.attempt.messageIdHeader}\r\nX-Warpdrive-Send-Attempt: ${f.attempt.attemptId}\r\nReporting-MTA:`,
          ),
      );
      expect(
        await ingestDeliveryReports(
          db,
          { accountId: f.accountId, sourceMessageId: f.source.messageId, parts: [part] },
          deliverySignal(),
        ),
      ).toMatchObject({ ok: true });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
      expect((await submissionFacts(db, f.attempt.attemptId))?.status).toBe("sent");
    });
  });

  it("rejects changed bytes at an existing source/part key rather than overwriting evidence", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const input = {
        accountId: f.accountId,
        sourceMessageId: f.source.messageId,
        parts: [deliveryMachinePart()],
      };
      expect((await ingestDeliveryReports(db, input, deliverySignal())).ok).toBe(true);
      const before = (await db.execute(sql`SELECT parsed FROM email_delivery_reports`)).rows;
      expect(
        await ingestDeliveryReports(
          db,
          { ...input, parts: [deliveryMachinePart({ action: "delivered", status: "2.0.0" })] },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "conflict" });
      expect((await db.execute(sql`SELECT parsed FROM email_delivery_reports`)).rows).toEqual(
        before,
      );
    });
  });

  it("does not let malformed machine parts suppress an otherwise readable received message", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const invalid = { ...deliveryMachinePart(), content: Buffer.from([0xc0, 0xaf]) };
      expect(
        await ingestDeliveryReports(
          db,
          { accountId: f.accountId, sourceMessageId: f.source.messageId, parts: [invalid] },
          deliverySignal(),
        ),
      ).toEqual({ ok: true, value: { reportIds: [], skipped: 1 } });
      expect(
        (await db.execute(sql`SELECT body_text FROM email_messages WHERE id=${f.source.messageId}`))
          .rows[0]?.body_text,
      ).toContain("گزارش دریافت‌شده");
    });
  });

  it("pins report evidence to an inbound source in exactly the supplied mailbox", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const other = randomUUID();
      await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider)
        VALUES(${other},${f.owner.user.id},${`${other}@example.test`},'imap_smtp')`);
      const foreign = await seedDeliverySource(db, other);
      for (const sourceMessageId of [foreign.messageId, f.attempt.messageId, randomUUID()]) {
        expect(
          await ingestDeliveryReports(
            db,
            { accountId: f.accountId, sourceMessageId, parts: [deliveryMachinePart()] },
            deliverySignal(),
          ),
        ).toEqual({ ok: false, error: "not_found" });
      }
      expect((await db.execute(sql`SELECT id FROM email_delivery_reports`)).rows).toHaveLength(0);
    });
  });

  it("honors cancellation before storing any evidence", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const abort = new AbortController();
      abort.abort();
      await expect(
        ingestDeliveryReports(
          db,
          {
            accountId: f.accountId,
            sourceMessageId: f.source.messageId,
            parts: [deliveryMachinePart()],
          },
          abort.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reports`)).rows).toHaveLength(0);
    });
  });

  it("rejects an oversized or duplicate part batch before writing its first report", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      for (const parts of [
        Array.from({ length: 9 }, (_, index) => ({
          ...deliveryMachinePart(),
          partKey: String(index + 1),
        })),
        [deliveryMachinePart(), deliveryMachinePart()],
      ]) {
        expect(
          await ingestDeliveryReports(
            db,
            { accountId: f.accountId, sourceMessageId: f.source.messageId, parts },
            deliverySignal(),
          ),
        ).toEqual({ ok: false, error: "invalid_input" });
      }
      expect((await db.execute(sql`SELECT id FROM email_delivery_reports`)).rows).toHaveLength(0);
    });
  });

  it("rolls back a newly added part when another part conflicts with immutable existing bytes", async () => {
    await withTestDb(async (db) => {
      const f = await seedDeliveryFixture(db);
      const input = {
        accountId: f.accountId,
        sourceMessageId: f.source.messageId,
        parts: [deliveryMachinePart()],
      };
      expect((await ingestDeliveryReports(db, input, deliverySignal())).ok).toBe(true);
      const before = (await db.execute(sql`SELECT id,part_key,parsed FROM email_delivery_reports`))
        .rows;
      expect(
        await ingestDeliveryReports(
          db,
          {
            ...input,
            parts: [
              { ...deliveryMachinePart(), partKey: "3" },
              deliveryMachinePart({ action: "delivered", status: "2.0.0" }),
            ],
          },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "conflict" });
      expect(
        (await db.execute(sql`SELECT id,part_key,parsed FROM email_delivery_reports`)).rows,
      ).toEqual(before);
    });
  });
});
