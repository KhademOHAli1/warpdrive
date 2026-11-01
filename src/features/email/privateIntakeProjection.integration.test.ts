import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedNotificationDeal } from "@/features/notifications/email/notificationJob.test-helpers";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import {
  expectPrivateProjectionSummary,
  privateProjectionActor,
  readPrivateProjectionCallers,
  seedOrdinaryPrivateProjection,
} from "./privateIntakeProjection.test-helpers";
import { reviewPrivateIntake } from "./privateIntakeReview";
import {
  confirmPrivateReviewFixture,
  seedAcknowledgedPrivateReview,
} from "./privateIntakeReview.lifecycle.test-helpers";
import {
  privateReviewProtectedSnapshot,
  privateReviewSignal,
  seedNativePrivateReview,
} from "./privateIntakeReview.test-helpers";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

it("projects the exact five-field protected-owner summary through actual thread, message and inbox callers", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    const expected: PrivateIntakeSummary = {
      id: f.id,
      revision: 0,
      state: "unverified",
      contentState: "retained",
      decision: null,
    };
    const dto = await readPrivateProjectionCallers(
      db,
      privateProjectionActor(f.ownerId),
      f,
      signal,
    );
    expectPrivateProjectionSummary(dto, f.threadId, expected);
    expect(dto.thread).toMatchObject({
      ok: true,
      value: {
        canCompose: false,
        thread: { isOwner: true },
        mailCapabilities: { read: true, send: false, markRead: false, move: false, trash: false },
      },
    });
    if (dto.message.ok) expect(dto.message.value.bodyHtml).toContain("محتوای خصوصی");
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it("reads the actual latest review despite a later non-review conflict revision", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    expect(
      await reviewPrivateIntake(db, f.owner.context, { ...f.input, decision: "dismiss" }, signal),
    ).toMatchObject({ ok: true, value: { revision: 1 } });
    await db.execute(sql`UPDATE email_private_intake SET intake_state='conflict',revision=revision+1
      WHERE id=${f.id}`);
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    const dto = await readPrivateProjectionCallers(
      db,
      privateProjectionActor(f.ownerId),
      f,
      signal,
    );
    expectPrivateProjectionSummary(dto, f.threadId, {
      id: f.id,
      revision: 2,
      state: "conflict",
      contentState: "retained",
      decision: "dismiss",
    });
    expect(dto.thread).toMatchObject({ ok: true, value: { canCompose: false } });
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it("keeps purged-thread review metadata local without exposing retained payload or a real submission identity", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedAcknowledgedPrivateReview(db, signal);
    const attempt = (
      await db.execute(sql`SELECT id FROM email_send_attempts
      WHERE account_id=${f.accountId} AND idempotency_key=${f.notificationId}`)
    ).rows[0];
    expect(typeof attempt?.id).toBe("string");
    expect(await reviewPrivateIntake(db, f.owner.context, f.input, signal)).toMatchObject({
      ok: true,
    });
    const actor = privateProjectionActor(f.ownerId);
    const held = await readPrivateProjectionCallers(db, actor, f, signal);
    expectPrivateProjectionSummary(held, f.threadId, {
      id: f.id,
      revision: 1,
      state: "unverified",
      contentState: "retained",
      decision: "dismiss",
    });
    expect(held.thread).toMatchObject({ ok: true, value: { canCompose: false } });
    await confirmPrivateReviewFixture(db, f, signal);
    const confirmed = await readPrivateProjectionCallers(db, actor, f, signal);
    expectPrivateProjectionSummary(confirmed, f.threadId, {
      id: f.id,
      revision: 2,
      state: "confirmed_notification",
      contentState: "retained",
      decision: "dismiss",
    });
    expect(confirmed.thread).toMatchObject({
      ok: true,
      value: {
        canCompose: true,
        thread: { isOwner: true },
      },
    });
    await db.execute(
      sql`DELETE FROM email_messages WHERE id=${f.messageId} AND account_id=${f.accountId}`,
    );
    expect(
      await reviewPrivateIntake(
        db,
        f.owner.context,
        { ...f.input, expectedRevision: 3, decision: "restore_private" },
        signal,
      ),
    ).toMatchObject({ ok: true });
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    const dto = await readPrivateProjectionCallers(
      db,
      privateProjectionActor(f.ownerId),
      f,
      signal,
    );
    expectPrivateProjectionSummary(
      dto,
      f.threadId,
      {
        id: f.id,
        revision: 4,
        state: "confirmed_notification",
        contentState: "purged",
        decision: "restore_private",
      },
      { messagePresent: false },
    );
    expect(dto.thread).toMatchObject({
      ok: true,
      value: { messages: [], canCompose: true, thread: { isOwner: true } },
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("observed_payload");
    expect(serialized).not.toContain("confirmation_snapshot");
    expect(serialized).not.toContain(f.observedId);
    if (typeof attempt?.id === "string") expect(serialized).not.toContain(attempt.id);
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
    expect(f.transport.gmail.raw).toHaveLength(1);
  });
});

it.each([false, true])(
  "keeps foreign and shared viewers quiet without an admin bypass (admin=%s)",
  async (isAdmin) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedNativePrivateReview(db, signal);
      const viewer = await seedMailHttpSession(db, {
        isAdmin,
        assurance: isAdmin ? "mfa" : "password",
      });
      const actor = privateProjectionActor(viewer.user.id, isAdmin);
      const privateDto = await readPrivateProjectionCallers(db, actor, f, signal);
      expect(privateDto.thread.ok).toBe(false);
      expect(privateDto.message.ok).toBe(false);
      expect(JSON.stringify(privateDto)).not.toContain(f.id);
      const dealId = await seedNotificationDeal(db, f.ownerId, "all", signal);
      await db.execute(
        sql`UPDATE email_threads SET visibility='shared',deal_id=${dealId} WHERE id=${f.threadId}`,
      );
      const shared = await readPrivateProjectionCallers(db, actor, f, signal);
      expectPrivateProjectionSummary(shared, f.threadId, null, { inboxPresent: false });
      expect(JSON.stringify(shared)).not.toContain(f.id);
      expect(JSON.stringify(shared)).not.toContain(f.observedId);
    });
  },
);

it.each(["inactive", "invited"] as const)(
  "does not project a hint from cached owner authority after becoming %s",
  async (reason) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedNativePrivateReview(db, signal);
      const actor = privateProjectionActor(f.ownerId);
      await db.execute(
        reason === "inactive"
          ? sql`UPDATE users SET is_active=false WHERE id=${f.ownerId}`
          : sql`UPDATE users SET invited_at=now() WHERE id=${f.ownerId}`,
      );
      const dto = await readPrivateProjectionCallers(db, actor, f, signal);
      expectPrivateProjectionSummary(dto, f.threadId, null);
      expect(JSON.stringify(dto)).not.toContain(f.id);
    });
  },
);

it("keeps ordinary mail null and preserves owner local controls independently of paused or disabled sending", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedOrdinaryPrivateProjection(db, signal);
    const normal = await readPrivateProjectionCallers(db, f.actor, f, signal);
    expectPrivateProjectionSummary(normal, f.threadId, null);
    expect(normal.thread).toMatchObject({
      ok: true,
      value: {
        canCompose: true,
        thread: { isOwner: true },
        mailCapabilities: { send: true },
      },
    });
    // Disable sending on an active mailbox, then pause a send-enabled mailbox.
    for (const paused of [false, true]) {
      await db.execute(sql`UPDATE email_accounts SET paused=${paused},capabilities=jsonb_set(
        capabilities,'{send}',${JSON.stringify(paused)}::jsonb) WHERE id=${f.account.id}`);
      const dto = await readPrivateProjectionCallers(db, f.actor, f, signal);
      expectPrivateProjectionSummary(dto, f.threadId, null);
      expect(dto.thread).toMatchObject({
        ok: true,
        value: {
          canCompose: true,
          thread: { isOwner: true },
          mailCapabilities: { read: true, send: false },
        },
      });
    }
  });
});
