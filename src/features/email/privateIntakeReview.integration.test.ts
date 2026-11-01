import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { revokeUserAccess } from "@/features/auth/management/offboarding";
import { connectNotificationMailbox } from "@/features/notifications/email/notificationJob.test-helpers";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { readPrivateIntake, reviewPrivateIntake } from "./privateIntakeReview";
import {
  privateReviewHistory,
  privateReviewMutableSnapshot,
  privateReviewProtectedSnapshot,
  privateReviewSignal,
  seedNativePrivateReview,
} from "./privateIntakeReview.test-helpers";

it("reads only the five-field owner summary and reviews all local decisions with an ordinary native session", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    const summary = {
      id: f.id,
      revision: 0,
      state: "unverified",
      contentState: "retained",
      decision: null,
    };
    expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
      ok: true,
      value: summary,
    });
    for (const [index, decision] of (
      ["keep_private", "dismiss", "restore_private"] as const
    ).entries()) {
      const expected = { ...summary, revision: index + 1, decision };
      expect(
        await reviewPrivateIntake(
          db,
          f.owner.context,
          {
            ...f.input,
            expectedRevision: index,
            decision,
          },
          signal,
        ),
      ).toEqual({ ok: true, value: expected });
      expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
        ok: true,
        value: expected,
      });
    }
    expect(await privateReviewHistory(db, f.id, signal)).toEqual([
      { revision: 1, decision: "keep_private", actor_id: f.ownerId },
      { revision: 2, decision: "dismiss", actor_id: f.ownerId },
      { revision: 3, decision: "restore_private", actor_id: f.ownerId },
    ]);
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it("allows a valid native MFA owner whose password and MFA freshness are old without a new challenge", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const oldProof = new Date(Date.now() - 3_600_000);
    const f = await seedNativePrivateReview(db, signal, {
      assurance: "mfa",
      twoFactorEnabled: true,
      freshAt: oldProof,
      mfaAt: oldProof,
    });
    const before = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 0,
        state: "unverified",
        contentState: "retained",
        decision: null,
      },
    });
    expect(await reviewPrivateIntake(db, f.owner.context, f.input, signal)).toEqual({
      ok: true,
      value: {
        id: f.id,
        revision: 1,
        state: "unverified",
        contentState: "retained",
        decision: "keep_private",
      },
    });
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(before);
  });
});

it.each(["foreign_owner", "foreign_admin", "same_owner_other_account"] as const)(
  "hides shared private-intake existence from %s without an administrator bypass",
  async (scope) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedNativePrivateReview(db, signal);
      await db.execute(sql`UPDATE email_threads SET visibility='shared' WHERE id=${f.threadId}`);
      const stranger = await seedMailHttpSession(db, {
        isAdmin: scope === "foreign_admin",
        assurance: scope === "foreign_admin" ? "mfa" : "password",
        twoFactorEnabled: scope === "foreign_admin",
        mfaAt: new Date(Date.now() - 3_600_000),
      });
      const other = await connectNotificationMailbox(db, f.ownerId, signal);
      const context = scope === "same_owner_other_account" ? f.owner.context : stranger.context;
      const accountId = scope === "same_owner_other_account" ? other.id : f.accountId;
      const before = await privateReviewMutableSnapshot(db, f.id, signal);
      const protectedBefore = await privateReviewProtectedSnapshot(db, f.accountId, signal);
      expect(await readPrivateIntake(db, context, { ...f.scope, accountId }, signal)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await reviewPrivateIntake(db, context, { ...f.input, accountId }, signal)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await privateReviewMutableSnapshot(db, f.id, signal)).toEqual(before);
      expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(
        protectedBefore,
      );
    });
  },
);

it.each(["pending", "revoked", "expired", "offboarded", "invited", "unverified"] as const)(
  "denies %s native authority for both read and review without touching intake",
  async (reason) => {
    await withTestDb(async (db) => {
      const signal = privateReviewSignal();
      const f = await seedNativePrivateReview(db, signal);
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
      if (reason === "offboarded") await revokeUserAccess(db, f.ownerId, signal);
      if (reason === "invited")
        await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${f.ownerId}`);
      if (reason === "unverified")
        await db.execute(sql`UPDATE auth_users SET email_verified=false WHERE id=${f.ownerId}`);
      const before = await privateReviewMutableSnapshot(db, f.id, signal);
      const protectedBefore = await privateReviewProtectedSnapshot(db, f.accountId, signal);
      expect(await readPrivateIntake(db, f.owner.context, f.scope, signal)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await reviewPrivateIntake(db, f.owner.context, f.input, signal)).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(await privateReviewMutableSnapshot(db, f.id, signal)).toEqual(before);
      expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(
        protectedBefore,
      );
    });
  },
);

it("rejects a real foreign session paired with the mailbox owner's actor ID", async () => {
  await withTestDb(async (db) => {
    const signal = privateReviewSignal();
    const f = await seedNativePrivateReview(db, signal);
    const other = await seedMailHttpSession(db);
    const context = { actorId: f.ownerId, sessionId: other.context.sessionId };
    const before = await privateReviewMutableSnapshot(db, f.id, signal);
    const protectedBefore = await privateReviewProtectedSnapshot(db, f.accountId, signal);
    expect(await readPrivateIntake(db, context, f.scope, signal)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await reviewPrivateIntake(db, context, f.input, signal)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await privateReviewMutableSnapshot(db, f.id, signal)).toEqual(before);
    expect(await privateReviewProtectedSnapshot(db, f.accountId, signal)).toEqual(protectedBefore);
  });
});
