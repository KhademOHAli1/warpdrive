import { randomUUID } from "node:crypto";
import { assert } from "vitest";
import { organizations } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { OperationsRole } from "@/features/operations-access/contracts";
import { executeOperationsAccessCommand } from "@/features/operations-access/service";
import type { TestDb } from "@/test/db";
import { actor, seedStructures, signal } from "../warehouse/operations/structures.test-helpers";
import { readSourcingWorkspace, runSourcingCommand } from "./service";

export async function seedSourcing(h: TestDb) {
  const fixture = await seedStructures(h);
  const ownerId = fixture.admin.userId;
  const manufacturer = randomUUID();
  const firstSupplier = randomUUID();
  const secondSupplier = randomUUID();
  const privateSupplier = randomUUID();
  const deletedSupplier = randomUUID();
  await h.db.insert(organizations).values([
    { id: manufacturer, ownerId, name: "Instrument Components", visibilityLevel: "all" },
    { id: firstSupplier, ownerId, name: "First Distributor", visibilityLevel: "all" },
    { id: secondSupplier, ownerId, name: "Alternate Distributor", visibilityLevel: "all" },
    { id: privateSupplier, ownerId, name: "Private Distributor", visibilityLevel: "owner" },
    {
      id: deletedSupplier,
      ownerId,
      name: "Removed Distributor",
      visibilityLevel: "all",
      deletedAt: new Date(),
    },
  ]);
  return {
    ...fixture,
    manufacturer,
    firstSupplier,
    secondSupplier,
    privateSupplier,
    deletedSupplier,
  };
}

export async function setRole(
  h: TestDb,
  admin: NativeSessionRef,
  who: NativeSessionRef,
  siteId: string,
  role: OperationsRole,
  enabled = true,
) {
  const change = await executeOperationsAccessCommand(
    h.db,
    admin,
    { requestId: randomUUID(), siteId, userId: who.userId, role, enabled },
    signal(),
  );
  assert(change.ok);
}

export async function createSourcingActor(
  h: TestDb,
  admin: NativeSessionRef,
  name: string,
  siteId: string,
  ...roles: OperationsRole[]
) {
  const who = await actor(h, name);
  for (const role of roles) await setRole(h, admin, who, siteId, role);
  return who;
}

export function sourceCommand(
  h: TestDb,
  who: NativeSessionRef,
  scope: { siteId: string; itemId: string },
  body: Record<string, unknown>,
) {
  return runSourcingCommand(h.db, who, { requestId: randomUUID(), ...scope, ...body }, signal());
}

export function sourcing(
  h: TestDb,
  who: NativeSessionRef,
  query: { siteId?: string; itemId?: string } = {},
) {
  return readSourcingWorkspace(h.db, who, query, signal());
}
