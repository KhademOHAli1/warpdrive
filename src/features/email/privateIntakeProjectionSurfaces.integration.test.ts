import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedNotificationDeal } from "@/features/notifications/email/notificationJob.test-helpers";
import { listMessagesForDeal } from "./entityMessageReads";
import { applyThreadLink } from "./linkThread";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import {
  privateProjectionActor,
  seedOrdinaryPrivateProjection,
} from "./privateIntakeProjection.test-helpers";
import {
  readPrivateProjectionSurface,
  seedCanonicalPrivateSurface,
  seedPrivateSurfaceBatch,
} from "./privateIntakeProjectionSurfaces.test-helpers";
import { reviewPrivateIntake } from "./privateIntakeReview";
import {
  privateReviewProtectedSnapshot,
  privateReviewSignal,
  seedNativePrivateReview,
} from "./privateIntakeReview.test-helpers";
import { archiveThread, unarchiveThread } from "./threadArchive";

it.each(["inbox", "search", "workspace"] as const)(
  "enriches a batch of owner %s rows exactly once with latest decisions across a revision gap",
  async (surface) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const { first: f, second, actor } = await seedPrivateSurfaceBatch(db, signal);
      const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
      const result = await readPrivateProjectionSurface(db, actor, surface, signal);
      expect.soft(result.rows).toHaveLength(2);
      expect
        .soft(result.rows.find((row) => row.id === f.threadId))
        .toHaveProperty("privateIntake", {
          id: f.id,
          revision: 0,
          state: "unverified",
          contentState: "retained",
          decision: null,
        });
      expect
        .soft(result.rows.find((row) => row.id === second.threadId))
        .toHaveProperty("privateIntake", {
          id: second.id,
          revision: 2,
          state: "conflict",
          contentState: "retained",
          decision: "dismiss",
        });
      for (const row of result.rows)
        expect.soft(row).toMatchObject({
          isOwner: true,
          mailCapabilities: {
            read: true,
            send: false,
            markRead: false,
            move: false,
            trash: false,
          },
        });
      expect(result.transactions).toBe(1);
      expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
    });
  },
);

it.each(["sent", "archive"] as const)(
  "projects the summary of an actual API-ACK promoted copy in %s",
  async (surface) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedCanonicalPrivateSurface(db, signal);
      if (surface === "archive")
        expect(await archiveThread(db, { actor: f.actor, threadId: f.threadId }, signal)).toEqual({
          ok: true,
          value: { threadId: f.threadId },
        });
      const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
      const result = await readPrivateProjectionSurface(db, f.actor, surface, signal);
      expect(result.rows).toHaveLength(1);
      expect.soft(result.rows[0]).toHaveProperty("privateIntake", f.summary);
      expect(result.transactions).toBe(1);
      const workspace = await readPrivateProjectionSurface(db, f.actor, "workspace", signal, {
        folder: surface,
      });
      expect.soft(workspace.rows[0]).toHaveProperty("privateIntake", f.summary);
      expect(workspace.transactions).toBe(1);
      expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
      expect(f.transport.gmail.raw).toHaveLength(1);
    });
  },
);

it("keeps purged latest-review metadata across archive, search and inbox without inventing a Sent message", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedCanonicalPrivateSurface(db, signal);
    const context = { actor: f.actor, threadId: f.threadId };
    expect(await archiveThread(db, context, signal)).toMatchObject({ ok: true });
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
    ).toMatchObject({ ok: true, value: { revision: 4 } });
    const expected = {
      ...f.summary,
      revision: 4,
      contentState: "purged",
      decision: "restore_private",
    };
    const archived = await readPrivateProjectionSurface(db, f.actor, "archive", signal);
    expect.soft(archived.rows[0]).toHaveProperty("privateIntake", expected);
    expect
      .soft(
        (
          await readPrivateProjectionSurface(db, f.actor, "workspace", signal, {
            folder: "archive",
          })
        ).rows[0],
      )
      .toHaveProperty("privateIntake", expected);
    expect((await readPrivateProjectionSurface(db, f.actor, "sent", signal)).rows).toEqual([]);
    expect(await unarchiveThread(db, context, signal)).toMatchObject({ ok: true });
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    for (const surface of ["inbox", "search", "workspace"] as const) {
      const result = await readPrivateProjectionSurface(db, f.actor, surface, signal);
      expect
        .soft(result.rows.find((row) => row.id === f.threadId))
        .toHaveProperty("privateIntake", expected);
      expect(JSON.stringify(result.rows)).not.toContain(f.attemptId);
      expect(JSON.stringify(result.rows)).not.toContain(f.observedId);
    }
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it.each([false, true])(
  "keeps another valid owner's private surfaces empty without an admin bypass (admin=%s)",
  async (isAdmin) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedCanonicalPrivateSurface(db, signal);
      expect(
        await archiveThread(db, { actor: f.actor, threadId: f.threadId }, signal),
      ).toMatchObject({ ok: true });
      const viewer = await seedMailHttpSession(db, {
        isAdmin,
        assurance: isAdmin ? "mfa" : "password",
        twoFactorEnabled: isAdmin,
      });
      const actor = privateProjectionActor(viewer.user.id, isAdmin);
      const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
      for (const surface of ["inbox", "search", "sent", "archive", "workspace"] as const)
        expect((await readPrivateProjectionSurface(db, actor, surface, signal)).rows).toEqual([]);
      expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
    });
  },
);

it("keeps ordinary owner mail quiet on every surface without suppressing local eligibility", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedOrdinaryPrivateProjection(db, signal);
    await db.execute(
      sql`UPDATE email_messages SET direction='outbound',sent_at=now() WHERE id=${f.messageId}`,
    );
    const context = { actor: f.actor, threadId: f.threadId };
    expect(await archiveThread(db, context, signal)).toMatchObject({ ok: true });
    for (const surface of ["sent", "archive"] as const) {
      const rows = (await readPrivateProjectionSurface(db, f.actor, surface, signal)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ isOwner: true, privateIntake: null });
    }
    expect(await unarchiveThread(db, context, signal)).toMatchObject({ ok: true });
    for (const surface of ["inbox", "search", "workspace"] as const)
      expect(
        (await readPrivateProjectionSurface(db, f.actor, surface, signal)).rows[0],
      ).toMatchObject({ isOwner: true, privateIntake: null });
  });
});

it.each([false, true])(
  "keeps ordinary workspace ownership/local eligibility when sending is disabled or paused (paused=%s)",
  async (paused) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedOrdinaryPrivateProjection(db, signal);
      await db.execute(sql`UPDATE email_accounts SET paused=${paused},capabilities=jsonb_set(
      capabilities,'{send}',${JSON.stringify(paused)}::jsonb) WHERE id=${f.account.id}`);
      const before = await privateReviewProtectedSnapshot(db, f.account.id, signal);
      const result = await readPrivateProjectionSurface(db, f.actor, "workspace", signal);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        isOwner: true,
        privateIntake: null,
        mailCapabilities: { read: true, send: false },
      });
      expect(await privateReviewProtectedSnapshot(db, f.account.id, signal)).toEqual(before);
    });
  },
);

it("cannot place unresolved intake on an entity through native linking, while a confirmed copy retains owner compose eligibility", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const held = await seedNativePrivateReview(db, signal);
    const actor = privateProjectionActor(held.ownerId);
    const dealId = await seedNotificationDeal(db, held.ownerId, "all", signal);
    const before = await privateReviewProtectedSnapshot(db, held.accountId, signal);
    expect(
      await applyThreadLink(db, { actor, threadId: held.threadId, dealId }, signal),
    ).toMatchObject({ ok: false });
    expect(await listMessagesForDeal(db, { actor, dealId }, signal)).toEqual([]);
    expect(await privateReviewProtectedSnapshot(db, held.accountId, signal)).toEqual(before);
    const confirmed = await seedCanonicalPrivateSurface(db, signal);
    expect(
      await applyThreadLink(
        db,
        { actor: confirmed.actor, threadId: confirmed.threadId, dealId },
        signal,
      ),
    ).toMatchObject({ ok: true });
    const messages = await listMessagesForDeal(db, { actor: confirmed.actor, dealId }, signal);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ messageId: confirmed.messageId, canCompose: true });
  });
});
