import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import {
  deliveryActor,
  deliverySignal,
  hiddenRecipient,
  seedDeliveryAttempt,
  submissionFacts,
} from "./deliveryObservation.test-helpers";
import { readDeliveryObservationMessageRefs } from "./deliveryObservationMessageRefs";
import {
  addMessageRefReview,
  seedCanonicalNotificationMessageRef,
  seedMessageRefFixture,
  shareMessageRefThreads,
} from "./deliveryObservationMessageRefs.test-helpers";
import { getThread } from "./emailReads";

function project(
  db: Db,
  scope: Pick<Awaited<ReturnType<typeof seedMessageRefFixture>>, "actor" | "accountId">,
  messageIds: readonly string[],
) {
  return readDeliveryObservationMessageRefs(
    db,
    { actor: scope.actor, accountId: scope.accountId, messageIds },
    deliverySignal(),
  );
}

describe("owner-only delivery references for exact reader message identities", () => {
  it("projects an owned inbound source UUID and no unrequested message", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db);
      const refs = await project(db, f, [f.source.messageId]);
      expect([...refs]).toEqual([
        [f.source.messageId, { kind: "source", sourceMessageId: f.source.messageId }],
      ]);
    });
  });

  it.each(["imap_smtp", "gmail"] as const)(
    "projects the unique submitted %s attempt by exact provider identity without tracking",
    async (provider) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db, provider);
        const before = await submissionFacts(db, f.attempt.attemptId);
        expect((await db.execute(sql`SELECT id FROM email_tracking_tokens`)).rows).toEqual([]);
        const refs = await project(db, f, [f.attempt.messageId]);
        expect([...refs]).toEqual([
          [f.attempt.messageId, { kind: "attempt", attemptId: f.attempt.attemptId }],
        ]);
        expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
      });
    },
  );

  it.each(["none", "observed"] as const)(
    "keeps ordinary mail without an associated report quiet: %s",
    async (evidence) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db, "gmail", evidence);
        const refs = await project(db, f, [f.source.messageId, f.attempt.messageId]);
        const source =
          evidence === "none" ? null : { kind: "source", sourceMessageId: f.source.messageId };
        expect([...refs]).toEqual([
          [f.source.messageId, source],
          [f.attempt.messageId, null],
        ]);
      });
    },
  );

  it("projects the private synthetic Gmail notification copy with no send capability or attempt thread", async () => {
    await withTestDb(async (db) => {
      const f = await seedCanonicalNotificationMessageRef(db);
      const before = await submissionFacts(db, f.attempt.attemptId);
      expect(before).toMatchObject({ send_started_at: expect.anything(), payload_prepared: true });
      expect(
        (
          await getThread(
            db,
            { actor: f.actor, threadId: f.canonicalThreadId, allowRemote: false },
            deliverySignal(),
          )
        ).ok,
      ).toBe(true);
      const refs = await project(db, f, [f.attempt.messageId]);
      expect([...refs]).toEqual([
        [f.attempt.messageId, { kind: "attempt", attemptId: f.attempt.attemptId }],
      ]);
      for (const isAdmin of [false, true]) {
        const viewer = await seedUser(db, { isAdmin });
        const hidden = await readDeliveryObservationMessageRefs(
          db,
          {
            actor: deliveryActor(viewer.id, isAdmin),
            accountId: f.accountId,
            messageIds: [f.attempt.messageId],
          },
          deliverySignal(),
        );
        expect([...hidden]).toEqual([[f.attempt.messageId, null]]);
      }
      expect(await submissionFacts(db, f.attempt.attemptId)).toEqual(before);
      expect(
        (
          await db.execute(sql`SELECT visibility,person_id,deal_id FROM email_threads
        WHERE id=${f.canonicalThreadId}`)
        ).rows,
      ).toEqual([{ visibility: "private", person_id: null, deal_id: null }]);
    });
  });

  it.each(["shared", "admin", "private"] as const)(
    "reveals no references to a %s nonowner",
    async (mode) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        const viewer = await seedUser(db, { isAdmin: mode === "admin" });
        const actor = deliveryActor(viewer.id, mode === "admin");
        if (mode !== "private") {
          await shareMessageRefThreads(db, f);
          expect(
            (
              await getThread(
                db,
                { actor, threadId: f.attempt.threadId, allowRemote: false },
                deliverySignal(),
              )
            ).ok,
          ).toBe(true);
        }
        const refs = await readDeliveryObservationMessageRefs(
          db,
          { actor, accountId: f.accountId, messageIds: [f.source.messageId, f.attempt.messageId] },
          deliverySignal(),
        );
        expect([...refs]).toEqual([
          [f.source.messageId, null],
          [f.attempt.messageId, null],
        ]);
        expect(JSON.stringify([...refs])).not.toContain(f.attempt.attemptId);
        expect(JSON.stringify([...refs])).not.toContain(hiddenRecipient);
      });
    },
  );

  it.each(["inactive", "invited"] as const)(
    "rejects a cached owner after becoming %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        await db.execute(
          state === "inactive"
            ? sql`UPDATE users SET is_active=false WHERE id=${f.actor.id}`
            : sql`UPDATE users SET invited_at=now() WHERE id=${f.actor.id}`,
        );
        const refs = await project(db, f, [f.source.messageId, f.attempt.messageId]);
        expect([...refs]).toEqual([
          [f.source.messageId, null],
          [f.attempt.messageId, null],
        ]);
      });
    },
  );

  it.each([false, true])(
    "does not widen the caller's account scope (same owner=%s)",
    async (sameOwner) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        const foreign = await seedMessageRefFixture(db);
        if (sameOwner)
          await db.execute(sql`UPDATE email_accounts SET user_id=${f.actor.id}
        WHERE id=${foreign.accountId}`);
        const refs = await project(db, f, [foreign.source.messageId, foreign.attempt.messageId]);
        expect([...refs]).toEqual([
          [foreign.source.messageId, null],
          [foreign.attempt.messageId, null],
        ]);
      });
    },
  );

  it("does not use an exact provider identity from another owned account", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db);
      const foreign = await seedMessageRefFixture(db);
      await db.execute(
        sql`UPDATE email_accounts SET user_id=${f.actor.id} WHERE id=${foreign.accountId}`,
      );
      await db.execute(sql`UPDATE email_messages SET provider_message_id=${foreign.providerId}
        WHERE id=${f.attempt.messageId}`);
      const refs = await project(db, f, [f.attempt.messageId]);
      expect([...refs]).toEqual([[f.attempt.messageId, null]]);
    });
  });

  it.each(["unprepared", "not_started", "missing", "ambiguous"] as const)(
    "keeps a Gmail copy unavailable when its attempt is %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db, "gmail");
        if (state === "unprepared")
          await db.execute(sql`UPDATE email_send_attempts
          SET payload_prepared=false WHERE id=${f.attempt.attemptId}`);
        if (state === "not_started")
          await db.execute(sql`UPDATE email_send_attempts
          SET send_started_at=NULL WHERE id=${f.attempt.attemptId}`);
        if (state === "missing")
          await db.execute(sql`DELETE FROM email_send_attempts WHERE id=${f.attempt.attemptId}`);
        if (state === "ambiguous") {
          const second = await seedDeliveryAttempt(db, f.accountId);
          await db.execute(sql`UPDATE email_send_attempts SET provider_message_id=${f.providerId},
            gmail_message_id=${f.providerId} WHERE id=${second.attemptId}`);
        }
        const refs = await project(db, f, [f.attempt.messageId]);
        expect([...refs]).toEqual([[f.attempt.messageId, null]]);
      });
    },
  );

  it.each(["dismissed", "reassociated", "source_trashed", "snapshot_changed"] as const)(
    "hides outbound references when the latest association is no longer available: %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        if (state === "dismissed")
          await addMessageRefReview(db, f, 1, f.attempt.attemptId, "dismiss");
        if (state === "reassociated") {
          const replacement = await seedDeliveryAttempt(db, f.accountId);
          await addMessageRefReview(db, f, 1, replacement.attemptId);
        }
        if (state === "source_trashed")
          await db.execute(sql`UPDATE email_threads
          SET trashed_at=now() WHERE id=${f.source.threadId}`);
        if (state === "snapshot_changed")
          await db.execute(sql`UPDATE email_send_attempts
          SET payload=jsonb_set(payload,'{subject}','"Changed after review"'::jsonb) WHERE id=${f.attempt.attemptId}`);
        const refs = await project(db, f, [f.attempt.messageId]);
        expect([...refs]).toEqual([[f.attempt.messageId, null]]);
      });
    },
  );

  it("never promotes RFC, envelope or body hints into a Gmail attempt reference", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db, "gmail");
      await db.execute(sql`UPDATE email_messages SET provider_message_id='unrelated-gmail-id',
        gmail_message_id='unrelated-gmail-id',in_reply_to=${f.attempt.messageIdHeader},
        "references"=ARRAY[${f.attempt.messageIdHeader}],
        body_text=${`Original-Envelope-Id: ${f.attempt.attemptId}\nAttempt-ID: ${f.attempt.attemptId}`}
        WHERE id=${f.attempt.messageId}`);
      const refs = await project(db, f, [f.attempt.messageId]);
      expect([...refs]).toEqual([[f.attempt.messageId, null]]);
    });
  });

  it.each(["wrong_uuid", "missing_stored_identity"] as const)(
    "rejects a spoofed SMTP hint: %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        if (state === "wrong_uuid") {
          const forged = `smtp:${randomUUID()}`;
          await db.execute(
            sql`UPDATE email_messages SET provider_message_id=${forged} WHERE id=${f.attempt.messageId}`,
          );
          await db.execute(
            sql`UPDATE email_send_attempts SET provider_message_id=${forged} WHERE id=${f.attempt.attemptId}`,
          );
        } else
          await db.execute(
            sql`UPDATE email_send_attempts SET provider_message_id=NULL WHERE id=${f.attempt.attemptId}`,
          );
        const refs = await project(db, f, [f.attempt.messageId]);
        expect([...refs]).toEqual([[f.attempt.messageId, null]]);
      });
    },
  );

  it.each(["source_trashed", "outbound_trashed", "missing_message"] as const)(
    "returns no reference for unreadable or missing mail: %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        const messageId = state === "outbound_trashed" ? f.attempt.messageId : f.source.messageId;
        if (state === "missing_message")
          await db.execute(sql`DELETE FROM email_messages WHERE id=${messageId}`);
        else
          await db.execute(sql`UPDATE email_threads SET trashed_at=now()
          WHERE id=${state === "source_trashed" ? f.source.threadId : f.attempt.threadId}`);
        const refs = await project(db, f, [messageId]);
        expect([...refs]).toEqual([[messageId, null]]);
      });
    },
  );
});
