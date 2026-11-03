import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { authUsers, deals, permissionSets, sessions } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { makeTestDb } from "@/test/db";
import { moveNativeDealStage, readNativeDealStage } from "./nativeStage";
import {
  nativeStageFixture,
  stageEffects,
  stageSignal,
  storedStage,
} from "./nativeStage.test-helpers";

test("UUID move commits one current row, audit and event, preserving exact money and creation receipt", async () => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h, true),
      before = await stageEffects(h, f);
    const result = await moveNativeDealStage(h.db, f.who, f.move, stageSignal());
    expect(result).toMatchObject({ ok: true, deal: { id: f.deal.id, stageId: f.target.id } });
    const row = await storedStage(h, f.deal.id),
      after = await stageEffects(h, f);
    expect(row.writeVersion).not.toBe(f.move.expectedWriteVersion);
    expect(row.value).toBe("99999999999999.9999");
    expect(row.currency).toBe("USD");
    expect(row.stageEnteredAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
    expect(after).toMatchObject({ audit: 1, channel: before.channel + 1, receipts: 1 });
    expect(
      (
        await h.pool.query(
          "SELECT old_value,new_value,actor_id FROM change_logs WHERE entity_id=$1 AND field='stageId'",
          [row.id],
        )
      ).rows,
    ).toEqual([{ old_value: f.stage.id, new_value: f.target.id, actor_id: f.user.id }]);
    expect(result.ok && Object.keys(result.deal).sort()).toEqual(
      [
        "id",
        "pipelineId",
        "stageId",
        "status",
        "boardPosition",
        "updatedAt",
        "writeVersion",
      ].sort(),
    );
  } finally {
    await h.close();
  }
});

test("an intervening write with identical updated_at still rejects the old UUID without effects", async () => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h);
    await h.db.execute(
      sql`UPDATE deals SET title='Concurrent change', updated_at=updated_at WHERE id=${f.deal.id}`,
    );
    const before = await stageEffects(h, f);
    expect(await moveNativeDealStage(h.db, f.who, f.move, stageSignal())).toEqual({
      ok: false,
      reason: "conflict",
      errorId: "E_DEAL_002",
    });
    expect(await stageEffects(h, f)).toEqual(before);
  } finally {
    await h.close();
  }
});

test("two independent native attempts with one revision produce one move, audit and channel increment", async () => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h),
      before = await stageEffects(h, f);
    const results = await Promise.all([
      moveNativeDealStage(h.db, f.who, f.move, stageSignal()),
      moveNativeDealStage(h.db, f.who, f.move, stageSignal()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ reason: "conflict" });
    expect(await stageEffects(h, f)).toMatchObject({
      audit: 1,
      channel: before.channel + 1,
      receipts: 1,
    });
  } finally {
    await h.close();
  }
});

test("same-stage reorder rotates revision without resetting stage stay or adding stage history", async () => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h);
    await h.db.execute(
      sql`UPDATE deals SET stage_entered_at='2001-02-01T10:00:00.123456Z'::timestamptz WHERE id=${f.deal.id}`,
    );
    const before = await storedStage(h, f.deal.id),
      beforeEffects = await stageEffects(h, f);
    expect(
      (
        await moveNativeDealStage(
          h.db,
          f.who,
          {
            ...f.move,
            expectedWriteVersion: before.writeVersion,
            toStageId: f.stage.id,
            beforePosition: "10",
            afterPosition: "20",
          },
          stageSignal(),
        )
      ).ok,
    ).toBe(true);
    const row = await storedStage(h, f.deal.id);
    expect(row.boardPosition).toBe("15");
    expect(row.stageEnteredAt).toEqual(before.stageEnteredAt);
    expect(row.writeVersion).not.toBe(before.writeVersion);
    const after = await stageEffects(h, f);
    expect(after).toMatchObject({ audit: 0, receipts: 1 });
    expect(after.deal?.stage_entered_at).toBe(beforeEffects.deal?.stage_entered_at);
  } finally {
    await h.close();
  }
});

test.each([
  "actor",
  "revoked",
  "expired",
  "unverified",
  "mfa",
  "permission",
  "hidden",
  "archived",
  "target",
] as const)("%s denial leaves deal/audit/event/receipt unchanged", async (kind) => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h, true),
      input = { ...f.move };
    if (kind === "actor") input.expectedActorId = randomUUID();
    if (kind === "revoked")
      await h.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, f.who.sessionId));
    if (kind === "expired")
      await h.db
        .update(sessions)
        .set({ expiresAt: new Date(0) })
        .where(eq(sessions.id, f.who.sessionId));
    if (kind === "unverified")
      await h.db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.user.id));
    if (kind === "mfa")
      await h.db
        .update(authUsers)
        .set({ twoFactorEnabled: true })
        .where(eq(authUsers.id, f.user.id));
    if (kind === "permission")
      await h.db
        .update(permissionSets)
        .set({ flags: { "deal.create": true } })
        .where(eq(permissionSets.id, f.permissionSetId));
    if (kind === "hidden") {
      const other = await seedUser(h.db);
      await h.db
        .update(deals)
        .set({ ownerId: other.id, visibilityLevel: "owner" })
        .where(eq(deals.id, f.deal.id));
    }
    if (kind === "archived")
      await h.db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, f.deal.id));
    if (kind === "target") input.toStageId = randomUUID();
    const before = await stageEffects(h, f);
    const result = await moveNativeDealStage(h.db, f.who, input, stageSignal());
    expect(result.ok).toBe(false);
    if (kind === "hidden" || kind === "archived")
      expect(result).toMatchObject({ reason: "unavailable", errorId: "E_DEAL_001" });
    expect(await stageEffects(h, f)).toEqual(before);
  } finally {
    await h.close();
  }
});

test("read-only recovery reads moved/won/current-pipeline state without repeating any move effect", async () => {
  const h = await makeTestDb();
  try {
    const f = await nativeStageFixture(h);
    expect((await moveNativeDealStage(h.db, f.who, f.move, stageSignal())).ok).toBe(true);
    const other = await seedPipelineWithStages(h.db, ["Elsewhere"]),
      stage = other.stages[0];
    if (stage === undefined) throw new Error("Missing current stage");
    await h.db
      .update(deals)
      .set({ pipelineId: other.pipeline.id, stageId: stage.id, status: "won" })
      .where(eq(deals.id, f.deal.id));
    // Visibility alone is enough for recovery; it does not confer edit authority.
    await h.db
      .update(permissionSets)
      .set({ flags: {} })
      .where(eq(permissionSets.id, f.permissionSetId));
    const before = await stageEffects(h, f);
    expect(await readNativeDealStage(h.db, f.who, f.read, stageSignal())).toMatchObject({
      ok: true,
      deal: { id: f.deal.id, pipelineId: other.pipeline.id, stageId: stage.id, status: "won" },
    });
    expect(await stageEffects(h, f)).toEqual(before);
    await h.db.delete(deals).where(eq(deals.id, f.deal.id));
    const deleted = await stageEffects(h, f);
    expect(await readNativeDealStage(h.db, f.who, f.read, stageSignal())).toEqual({
      ok: true,
      deal: null,
    });
    expect(await stageEffects(h, f)).toEqual(deleted);
  } finally {
    await h.close();
  }
});
