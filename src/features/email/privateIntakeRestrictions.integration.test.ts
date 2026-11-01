import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import type { AuthUser } from "@/features/permissions/types";
import { saveDraft } from "./draftRepo";
import { getThread } from "./emailReads";
import { threadMailCapabilities } from "./imapThreadOperationsCapabilities";
import { applyThreadLink } from "./linkThread";
import { enqueueSend } from "./outbox";
import {
  appendPrivateIntakeSchemaReview,
  privateIntakeRow,
  seedPrivateIntake,
} from "./privateIntakeSchema.test-helpers";
import { archiveThread } from "./threadArchive";
import { setFollowUpStatus, setThreadLabels } from "./threadAttributes";
import { setThreadVisibility } from "./threadVisibility";

const owner = (id: string): AuthUser => ({
  id,
  type: "regular",
  isActive: true,
  groupIds: new Set(),
});

for (const operation of ["share", "link", "archive", "labels", "follow_up"] as const)
  it(`denies the actual ${operation} mutation for unresolved private intake without modifying content`, async () => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      const f = await seedPrivateIntake(db, signal);
      const actor = owner(f.ownerId);
      const before = (
        await db.execute(sql`SELECT to_jsonb(t) AS thread,to_jsonb(m) AS message
        FROM email_threads t JOIN email_messages m ON m.thread_id=t.id
        WHERE t.id=${f.threadId}`)
      ).rows;
      const context = { actor, threadId: f.threadId };
      const result =
        operation === "share"
          ? await setThreadVisibility(db, { ...context, visibility: "shared" }, signal)
          : operation === "link"
            ? await applyThreadLink(db, { ...context, personId: null, dealId: null }, signal)
            : operation === "archive"
              ? await archiveThread(db, context, signal)
              : operation === "labels"
                ? await setThreadLabels(db, { ...context, labels: [] }, signal)
                : await setFollowUpStatus(db, { ...context, status: "waiting" }, signal);
      expect.soft(result).toMatchObject({ ok: false });
      expect(
        (
          await db.execute(sql`SELECT to_jsonb(t) AS thread,to_jsonb(m) AS message
        FROM email_threads t JOIN email_messages m ON m.thread_id=t.id
        WHERE t.id=${f.threadId}`)
        ).rows,
      ).toEqual(before);
      expect((await privateIntakeRow(db, f.id, signal))?.intake_state).toBe("unverified");
    });
  });

it("denies draft and outbox reply creation for the held thread while preserving ordinary new mail", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const actor = owner(f.ownerId);
    const draft = {
      accountId: f.accountId,
      threadId: f.threadId,
      subject: "Reply",
      bodyHtml: "<p>Reply</p>",
      toEmails: ["customer@example.test"],
      ccEmails: [],
    };
    expect.soft(await saveDraft(db, { actor, draft }, signal)).toMatchObject({ ok: false });
    const input = {
      accountId: f.accountId,
      idempotencyKey: randomUUID(),
      threadId: f.threadId,
      payload: { to: ["customer@example.test"], subject: "Reply", html: "<p>Reply</p>" },
    };
    expect.soft(await enqueueSend(db, input)).toMatchObject({ ok: false });
    expect
      .soft(
        (
          await db.execute(sql`SELECT id FROM email_send_attempts
      WHERE account_id=${f.accountId}`)
        ).rows,
      )
      .toHaveLength(0);
    expect
      .soft(
        (
          await db.execute(sql`SELECT id FROM email_drafts
      WHERE account_id=${f.accountId}`)
        ).rows,
      )
      .toHaveLength(0);
    expect(
      await enqueueSend(db, { ...input, idempotencyKey: randomUUID(), threadId: null }),
    ).toMatchObject({ ok: true });
    expect(
      await saveDraft(db, { actor, draft: { ...draft, threadId: null } }, signal),
    ).toMatchObject({ ok: true });
  });
});

it("projects owner read access with remote/send capabilities disabled for held copies", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const actor = owner(f.ownerId);
    const expected = {
      read: true,
      send: false,
      markRead: false,
      localRead: true,
      move: false,
      trash: false,
    };
    expect((await threadMailCapabilities(db, actor, [f.threadId], signal)).get(f.threadId)).toEqual(
      expected,
    );
    const read = await getThread(db, { actor, threadId: f.threadId, allowRemote: false }, signal);
    expect(read).toMatchObject({
      ok: true,
      value: { canCompose: false, thread: { isOwner: true }, mailCapabilities: expected },
    });
  });
});

it("a local keep/dismiss/restore review never unlocks reply, sharing or provider writes", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    const actor = owner(f.ownerId);
    let revision = 0;
    for (const decision of ["keep_private", "dismiss", "restore_private"] as const) {
      revision = await appendPrivateIntakeSchemaReview(db, {
        intakeId: f.id,
        accountId: f.accountId,
        actorId: f.ownerId,
        expectedRevision: revision,
        decision,
        signal,
      });
      expect
        .soft((await threadMailCapabilities(db, actor, [f.threadId], signal)).get(f.threadId))
        .toEqual({
          read: true,
          send: false,
          markRead: false,
          localRead: true,
          move: false,
          trash: false,
        });
      expect
        .soft(
          await setThreadVisibility(
            db,
            { actor, threadId: f.threadId, visibility: "shared" },
            signal,
          ),
        )
        .toMatchObject({ ok: false });
      expect
        .soft(
          await enqueueSend(db, {
            accountId: f.accountId,
            idempotencyKey: randomUUID(),
            threadId: f.threadId,
            payload: { to: ["customer@example.test"], subject: "Held", html: "<p>Held</p>" },
          }),
        )
        .toMatchObject({ ok: false });
      expect(await privateIntakeRow(db, f.id, signal)).toMatchObject({
        revision,
        intake_state: "unverified",
        confirmation_snapshot: null,
        confirmation_attempt_id: null,
      });
    }
  });
});
