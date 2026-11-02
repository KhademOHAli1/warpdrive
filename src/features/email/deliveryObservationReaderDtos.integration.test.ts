import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { withTestDb } from "@/db/testing";
import type { AuthUser } from "@/features/permissions/types";
import { deliveryActor, deliverySignal, hiddenRecipient } from "./deliveryObservation.test-helpers";
import {
  addMessageRefReview,
  seedCanonicalNotificationMessageRef,
  seedMessageRefFixture,
  shareMessageRefThreads,
} from "./deliveryObservationMessageRefs.test-helpers";
import { getThread } from "./emailReads";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { getMessage } from "./messageReads";

type Reader = "thread" | "message";
type Ref =
  | { kind: "source"; sourceMessageId: string }
  | { kind: "attempt"; attemptId: string }
  | null;
const readers: Reader[] = ["thread", "message"];

function readDto(
  db: Db,
  reader: Reader,
  actor: AuthUser,
  message: { messageId: string; threadId: string },
) {
  return reader === "thread"
    ? getThread(db, { actor, threadId: message.threadId, allowRemote: false }, deliverySignal())
    : getMessage(db, { actor, messageId: message.messageId, allowRemote: false }, deliverySignal());
}

async function expectRef(
  db: Db,
  actor: AuthUser,
  message: { messageId: string; threadId: string },
  ref: Ref,
) {
  for (const reader of readers) {
    const dto = { messageId: message.messageId, deliveryReportRef: ref };
    expect(await readDto(db, reader, actor, message)).toMatchObject({
      ok: true,
      value: reader === "thread" ? { messages: [dto] } : dto,
    });
  }
}

describe("actual reader DTOs carry only current owner delivery references", () => {
  it("projects an inbound report's real source identity through both read APIs", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db, "imap_smtp", "observed");
      await expectRef(db, f.actor, f.source, {
        kind: "source",
        sourceMessageId: f.source.messageId,
      });
    });
  });

  it.each(["imap_smtp", "gmail"] as const)(
    "projects the exact reviewed %s attempt without tracking",
    async (provider) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db, provider);
        expect((await db.execute(sql`SELECT id FROM email_tracking_tokens`)).rows).toEqual([]);
        await expectRef(db, f.actor, f.attempt, {
          kind: "attempt",
          attemptId: f.attempt.attemptId,
        });
      });
    },
  );

  it.each(["none", "observed"] as const)(
    "keeps ordinary or unreviewed outbound mail quiet: %s",
    async (evidence) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db, "gmail", evidence);
        await expectRef(
          db,
          f.actor,
          f.source,
          evidence === "none" ? null : { kind: "source", sourceMessageId: f.source.messageId },
        );
        await expectRef(db, f.actor, f.attempt, null);
      });
    },
  );

  it.each([false, true])(
    "keeps shared viewers' DTO references null without hiding readable mail (admin=%s)",
    async (isAdmin) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        await shareMessageRefThreads(db, f);
        const viewer = await seedMailHttpSession(db, {
          isAdmin,
          assurance: isAdmin ? "mfa" : "password",
        });
        const actor = deliveryActor(viewer.user.id, isAdmin);
        for (const message of [f.source, f.attempt]) {
          await expectRef(db, actor, message, null);
          for (const reader of readers) {
            const result = await readDto(db, reader, actor, message);
            expect(JSON.stringify(result)).not.toContain(f.attempt.attemptId);
            expect(JSON.stringify(result)).not.toContain(hiddenRecipient);
          }
        }
      });
    },
  );

  it.each([false, true])(
    "does not expose a private owner's DTO or reference to another native user (admin=%s)",
    async (isAdmin) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        const viewer = await seedMailHttpSession(db, {
          isAdmin,
          assurance: isAdmin ? "mfa" : "password",
        });
        const actor = deliveryActor(viewer.user.id, isAdmin);
        for (const message of [f.source, f.attempt])
          for (const reader of readers) {
            const result = await readDto(db, reader, actor, message);
            expect(result.ok).toBe(false);
            expect(JSON.stringify(result)).not.toContain("deliveryReportRef");
            expect(JSON.stringify(result)).not.toContain(f.attempt.attemptId);
            expect(JSON.stringify(result)).not.toContain(hiddenRecipient);
          }
      });
    },
  );

  it.each(["inactive", "invited"] as const)(
    "does not trust cached owner authority after becoming %s",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMessageRefFixture(db);
        await db.execute(
          state === "inactive"
            ? sql`UPDATE users SET is_active=false WHERE id=${f.actor.id}`
            : sql`UPDATE users SET invited_at=now() WHERE id=${f.actor.id}`,
        );
        await expectRef(db, f.actor, f.source, null);
        await expectRef(db, f.actor, f.attempt, null);
      });
    },
  );

  it("refreshes references from current mailbox ownership rather than cached compose flags", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db);
      await shareMessageRefThreads(db, f);
      const successor = await seedMailHttpSession(db);
      await db.execute(
        sql`UPDATE email_accounts SET user_id=${successor.user.id} WHERE id=${f.accountId}`,
      );
      await expectRef(db, f.actor, f.attempt, null);
      await expectRef(db, deliveryActor(successor.user.id), f.attempt, {
        kind: "attempt",
        attemptId: f.attempt.attemptId,
      });
    });
  });

  it("projects the canonical private Gmail reference for its owner without send capability", async () => {
    await withTestDb(async (db) => {
      const f = await seedCanonicalNotificationMessageRef(db);
      await expectRef(
        db,
        f.actor,
        { messageId: f.attempt.messageId, threadId: f.canonicalThreadId },
        { kind: "attempt", attemptId: f.attempt.attemptId },
      );
    });
  });

  it("projects each exact message reference in a mixed conversation without changing identities", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db);
      await db.execute(
        sql`UPDATE email_messages SET thread_id=${f.source.threadId} WHERE id=${f.attempt.messageId}`,
      );
      const result = await getThread(
        db,
        { actor: f.actor, threadId: f.source.threadId, allowRemote: false },
        deliverySignal(),
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          messages: expect.arrayContaining([
            expect.objectContaining({
              messageId: f.source.messageId,
              deliveryReportRef: { kind: "source", sourceMessageId: f.source.messageId },
            }),
            expect.objectContaining({
              messageId: f.attempt.messageId,
              deliveryReportRef: { kind: "attempt", attemptId: f.attempt.attemptId },
            }),
          ]),
        },
      });
      if (result.ok) expect(result.value.messages).toHaveLength(2);
    });
  });

  it("removes a stale outbound reference after a newer explicit dismissal", async () => {
    await withTestDb(async (db) => {
      const f = await seedMessageRefFixture(db);
      await expectRef(db, f.actor, f.attempt, { kind: "attempt", attemptId: f.attempt.attemptId });
      await addMessageRefReview(db, f, 1, f.attempt.attemptId, "dismiss");
      await expectRef(db, f.actor, f.attempt, null);
      await expectRef(db, f.actor, f.source, {
        kind: "source",
        sourceMessageId: f.source.messageId,
      });
    });
  });
});
