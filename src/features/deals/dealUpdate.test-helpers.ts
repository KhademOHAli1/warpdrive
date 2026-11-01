// Shared setup helpers for dealUpdate.test.ts and dealUpdatePerms.test.ts.
import { randomUUID } from "node:crypto";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { permissionSets } from "@/db/schema";
import type { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { createDeal } from "./dealActions";
import { createSession, seedSettings } from "./dealMove.test-helpers";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];

export async function seedDealOwnerEditor(db: Db, signal: AbortSignal) {
  signal.throwIfAborted();
  const [permissionSet] = await db
    .insert(permissionSets)
    .values({
      name: `deal-update-owner-${randomUUID()}`,
      flags: { "deal.create": true, "deal.edit_own": true },
    })
    .returning({ id: permissionSets.id });
  signal.throwIfAborted();
  if (permissionSet === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "setup: missing editor permission set");
  const user = await seedUser(db, { isAdmin: false, permissionSetId: permissionSet.id });
  signal.throwIfAborted();
  return user;
}

export async function setupDeal(db: Db, actorKind: "admin" | "owner-editor" = "admin") {
  await seedSettings(db);
  const signal = new AbortController().signal;
  // Service checks reload authority, so the database must match each test's actor intent.
  const u =
    actorKind === "admin"
      ? await seedUser(db, { isAdmin: true })
      : await seedDealOwnerEditor(db, signal);
  const p = await seedPipelineWithStages(db, ["A"]);
  const stage = p.stages[0];
  if (stage === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "setup: missing stage");
  const created = await createDeal(
    db,
    { ...createSession(u.id), isAdmin: u.isAdmin },
    { title: "Initial", pipelineId: p.pipeline.id, stageId: stage.id },
    new AbortController().signal,
  );
  if (created.ok === false)
    throw new AppError(ERROR_IDS.DB_INVARIANT, `createDeal failed: ${created.error.message}`);
  return { u, deal: created.value, p };
}
