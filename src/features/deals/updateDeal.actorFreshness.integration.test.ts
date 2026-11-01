import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { dealChannel } from "@/constants/boardChannels";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { changeLogs, channelVersions, deals, permissionSets } from "@/db/schema";
import { loadLiveSessionByToken } from "@/features/auth/session";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "@/test/integrationPlatformFixtures";
import { updateDeal } from "./dealUpdate";

const signal = () => AbortSignal.timeout(10_000);
let h: TestDb;

beforeEach(async () => {
  h = await makeTestDb();
});

afterEach(async () => {
  await h.close();
});

async function captureNativeEditor(operationSignal: AbortSignal) {
  const seeded = await createIntegrationPlatformFixtures(
    h,
    // Native session SQL expiry uses the real database clock; start its valid window now.
    { namespace: "actorfreshness", now: new Date() },
    operationSignal,
  );
  expect(seeded.ok).toBe(true);
  if (!seeded.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "actor freshness fixture setup failed");
  const f = seeded.value;
  const live = await loadLiveSessionByToken(h.db, f.sessions.member.token, operationSignal);
  expect(live.ok).toBe(true);
  if (!live.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "native fixture session was not accepted");
  expect(live.value).toEqual({ userId: f.users.member.id, sessionId: f.sessions.member.id });
  const actor = await hydrateActor(h.db, live.value.userId, operationSignal);
  expect(actor).not.toBeNull();
  if (actor === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "native fixture actor was not hydrated");
  expect(actor.type).toBe("regular");
  expect(actor.flags.has("deal.edit_own")).toBe(true);
  return { f, actor };
}

async function readEffects(dealId: string, operationSignal: AbortSignal) {
  operationSignal.throwIfAborted();
  const [target] = await h.db.select().from(deals).where(eq(deals.id, dealId));
  operationSignal.throwIfAborted();
  const logs = await h.db
    .select()
    .from(changeLogs)
    .where(and(eq(changeLogs.entityType, "deal"), eq(changeLogs.entityId, dealId)))
    .orderBy(changeLogs.id);
  operationSignal.throwIfAborted();
  const versions = await h.db
    .select()
    .from(channelVersions)
    .where(eq(channelVersions.channel, dealChannel(dealId)));
  operationSignal.throwIfAborted();
  return { target, logs, versions, version: Number(versions[0]?.version ?? 0) };
}

test("a captured native editor with unchanged permissions updates, audits and publishes", async () => {
  const operationSignal = signal();
  const { f, actor } = await captureNativeEditor(operationSignal);
  const before = await readEffects(f.deals.visible.id, operationSignal);
  const title = "Allowed native actor update";
  const result = await updateDeal(
    h.db,
    actor,
    {
      dealId: f.deals.visible.id,
      expectedUpdatedAt: f.deals.visible.updatedAt.toISOString(),
      title,
    },
    operationSignal,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = await readEffects(f.deals.visible.id, operationSignal);
  expect(after.target).toEqual(result.value);
  expect(after.target?.title).toBe(title);
  expect(after.logs).toHaveLength(before.logs.length + 1);
  expect(after.logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field: "title",
        oldValue: f.deals.visible.title,
        newValue: title,
        actorId: actor.id,
      }),
    ]),
  );
  expect(after.version).toBe(before.version + 1);
});

test("removing edit permission invalidates a captured native actor before mutation", async () => {
  const operationSignal = signal();
  const { f, actor } = await captureNativeEditor(operationSignal);
  const permissionSetId = f.users.member.permissionSetId;
  if (permissionSetId === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "native member permission set missing");
  const [permissionSet] = await h.db
    .select()
    .from(permissionSets)
    .where(eq(permissionSets.id, permissionSetId));
  operationSignal.throwIfAborted();
  if (permissionSet === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "native member permission set row missing");
  const changed = await h.db
    .update(permissionSets)
    .set({ flags: { ...permissionSet.flags, "deal.edit_own": false } })
    .where(eq(permissionSets.id, permissionSetId))
    .returning({ id: permissionSets.id });
  operationSignal.throwIfAborted();
  expect(changed).toHaveLength(1);
  const current = await hydrateActor(h.db, actor.id, operationSignal);
  expect(current).not.toBeNull();
  expect(current?.flags.has("deal.edit_own")).toBe(false);
  expect(actor.flags.has("deal.edit_own")).toBe(true);

  const before = await readEffects(f.deals.visible.id, operationSignal);
  // Only authority changed. Keep the actual target's valid CAS precondition.
  expect(before.target).toEqual(f.deals.visible);
  const result = await updateDeal(
    h.db,
    actor,
    {
      dealId: f.deals.visible.id,
      expectedUpdatedAt: f.deals.visible.updatedAt.toISOString(),
      title: "Denied stale native actor update",
    },
    operationSignal,
  );
  const after = await readEffects(f.deals.visible.id, operationSignal);
  expect.soft(result).toMatchObject({ ok: false, error: { id: ERROR_IDS.PERM_DENIED } });
  expect.soft(after.target).toEqual(before.target);
  expect.soft(after.logs).toEqual(before.logs);
  // The existing publisher bumps this durable version with pg_notify in the mutation tx.
  // This tests the domain publication boundary, not post-response recipient fanout.
  expect.soft(after.versions).toEqual(before.versions);
});
