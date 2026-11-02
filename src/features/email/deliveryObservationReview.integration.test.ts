import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import {
  deliverySignal,
  hiddenRecipient,
  seedDeliveryAttempt,
  submissionFacts,
} from "./deliveryObservation.test-helpers";
import { reviewDeliveryReport } from "./deliveryObservationReview";
import { seedObservedDelivery } from "./deliveryObservationReview.test-helpers";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";

describe("explicit owner review of untrusted delivery reports", () => {
  it("saves an auditable association to an exact recipient snapshot without rewriting submission", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const before = await submissionFacts(db, f.attempt.attemptId);
      const result = await reviewDeliveryReport(
        db,
        f.owner.context,
        f.association,
        deliverySignal(),
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          revision: 1,
          decision: "associated",
          target: {
            attemptId: f.attempt.attemptId,
            recipient: f.association.target.recipient,
            kind: "to",
          },
        },
      });
      const rows = (
        await db.execute(sql`SELECT account_id,report_id,recipient_index,revision,
        decision,attempt_id,recipient_snapshot,reviewer_id FROM email_delivery_reviews`)
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: f.accountId,
        report_id: f.reportId,
        recipient_index: 0,
        revision: 1,
        decision: "associate",
        attempt_id: f.attempt.attemptId,
        recipient_snapshot: { address: f.association.target.recipient, kind: "to" },
        reviewer_id: f.actor.id,
      });
      expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
    });
  });

  it("can dismiss a report and later replace the review while preserving its earlier audit entry", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const dismissed = {
        reportId: f.reportId,
        recipientIndex: 0,
        expectedRevision: 0,
        decision: "dismiss",
        confirmUnverified: true,
      };
      expect(
        await reviewDeliveryReport(db, f.owner.context, dismissed, deliverySignal()),
      ).toMatchObject({ ok: true, value: { revision: 1, decision: "dismissed", target: null } });
      expect(
        await reviewDeliveryReport(
          db,
          f.owner.context,
          {
            ...f.association,
            expectedRevision: 1,
            target: { attemptId: f.attempt.attemptId, recipient: hiddenRecipient },
          },
          deliverySignal(),
        ),
      ).toMatchObject({
        ok: true,
        value: { revision: 2, decision: "associated", target: { kind: "bcc" } },
      });
      const history = (
        await db.execute(sql`SELECT revision,decision,attempt_id FROM email_delivery_reviews
        WHERE report_id=${f.reportId} ORDER BY revision`)
      ).rows;
      expect(history).toEqual([
        { revision: 1, decision: "dismiss", attempt_id: null },
        { revision: 2, decision: "associate", attempt_id: f.attempt.attemptId },
      ]);
    });
  });

  it.each([
    { confirmUnverified: false },
    { recipientIndex: -1 },
    { recipientIndex: 1 },
    { recipientIndex: 100 },
    { expectedRevision: -1 },
    { actorId: "forged-owner-id" },
    { recipientSnapshot: { address: "forged@example.test", kind: "bcc" } },
    { decision: "dismiss" },
  ])("rejects forged or incomplete review input %#", async (override) => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      expect(
        await reviewDeliveryReport(
          db,
          f.owner.context,
          { ...f.association, ...override },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "invalid_input" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("does not accept recipients absent from the immutable send snapshot, even if the report names them", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      for (const recipient of [
        "forged@example.test",
        "kunde@example.test",
        "Kunde@example.test\r\nBcc: other@example.test",
      ]) {
        expect(
          await reviewDeliveryReport(
            db,
            f.owner.context,
            { ...f.association, target: { attemptId: f.attempt.attemptId, recipient } },
            deliverySignal(),
          ),
        ).toEqual({ ok: false, error: "invalid_input" });
      }
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("cannot associate a report with another mailbox, including another mailbox owned by the same actor", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const accountId = randomUUID();
      await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider)
        VALUES(${accountId},${f.actor.id},${`${accountId}@example.test`},'imap_smtp')`);
      const foreign = await seedDeliveryAttempt(db, accountId);
      expect(
        await reviewDeliveryReport(
          db,
          f.owner.context,
          {
            ...f.association,
            target: { attemptId: foreign.attemptId, recipient: f.association.target.recipient },
          },
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "not_found" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it.each(["unprepared", "not_started"])(
    "rejects a send with no immutable submitted snapshot: %s",
    async (reason) => {
      await withTestDb(async (db) => {
        const f = await seedObservedDelivery(db);
        if (reason === "unprepared")
          await db.execute(
            sql`UPDATE email_send_attempts SET payload_prepared=false WHERE id=${f.attempt.attemptId}`,
          );
        else
          await db.execute(
            sql`UPDATE email_send_attempts SET send_started_at=NULL WHERE id=${f.attempt.attemptId}`,
          );
        expect(
          await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal()),
        ).toEqual({ ok: false, error: "invalid_input" });
        expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
      });
    },
  );

  it("rejects another native session's owner ID rather than trusting client identifiers", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      const other = await seedMailHttpSession(db);
      expect(
        await reviewDeliveryReport(
          db,
          { actorId: f.actor.id, sessionId: other.context.sessionId },
          f.association,
          deliverySignal(),
        ),
      ).toEqual({ ok: false, error: "permission" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
    });
  });

  it("allows a valid ordinary native session without requiring fresh password or TOTP proof", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      await db.execute(sql`UPDATE sessions SET fresh_authenticated_at=now()-interval '1 hour',
        mfa_verified_at=NULL WHERE id=${f.owner.context.sessionId}`);
      expect(
        (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
      ).toBe(true);
    });
  });

  it.each(["pending", "revoked", "expired", "unverified", "inactive"])(
    "denies %s native authority at review commit",
    async (reason) => {
      await withTestDb(async (db) => {
        const f = await seedObservedDelivery(db);
        if (reason === "pending")
          await db.execute(
            sql`UPDATE sessions SET assurance='pending' WHERE id=${f.owner.context.sessionId}`,
          );
        if (reason === "revoked")
          await db.execute(
            sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.owner.context.sessionId}`,
          );
        if (reason === "expired")
          await db.execute(
            sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=${f.owner.context.sessionId}`,
          );
        if (reason === "unverified")
          await db.execute(sql`UPDATE auth_users SET email_verified=false WHERE id=${f.actor.id}`);
        if (reason === "inactive")
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.actor.id}`);
        expect(
          await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal()),
        ).toEqual({ ok: false, error: "permission" });
        expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(0);
      });
    },
  );

  it("refuses stale revision replay without overwriting the first review", async () => {
    await withTestDb(async (db) => {
      const f = await seedObservedDelivery(db);
      expect(
        (await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal())).ok,
      ).toBe(true);
      expect(
        await reviewDeliveryReport(db, f.owner.context, f.association, deliverySignal()),
      ).toEqual({ ok: false, error: "conflict" });
      expect((await db.execute(sql`SELECT id FROM email_delivery_reviews`)).rows).toHaveLength(1);
    });
  });
});
