import { eq, sql } from "drizzle-orm";
import { completePermissionFlags } from "@/app/(app)/settings/permission-sets/permissionSetFlags";
import { auditEvents, permissionSets, users } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { permissionFlagsSchema } from "@/features/permissions/schemas";
import type { TestDb } from "@/test/db";

export const signal = () => AbortSignal.timeout(8000);
export const baselineId = "aaaaaaaa-1111-4111-8111-000000000001";
const managerSetId = "aaaaaaaa-1111-4111-8111-000000000002";
export const candidateId = "aaaaaaaa-1111-4111-8111-000000000003";
export const targetId = "bbbbbbbb-2222-4222-8222-000000000003";
export const admin: PermSetUser = {
  id: "bbbbbbbb-2222-4222-8222-000000000001",
  type: "admin",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
};
export const manager: PermSetUser = {
  id: "bbbbbbbb-2222-4222-8222-000000000002",
  type: "regular",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(["permissions.manage"]),
};

export function flags(overrides: Parameters<typeof completePermissionFlags>[0] = {}) {
  return permissionFlagsSchema.parse(completePermissionFlags(overrides));
}

export const setRows = (h: TestDb, id: string) =>
  h.db.select().from(permissionSets).where(eq(permissionSets.id, id));
export const assignment = (h: TestDb) =>
  h.db.select({ setId: users.permissionSetId }).from(users).where(eq(users.id, targetId));
export const auditRows = (h: TestDb, action: string) =>
  h.db.select().from(auditEvents).where(eq(auditEvents.action, action));

export async function seedProjectCreateGrantServices(h: TestDb): Promise<void> {
  await h.db.execute(sql`TRUNCATE users, permission_sets, audit_events RESTART IDENTITY CASCADE`);
  await h.db.insert(permissionSets).values([
    { id: baselineId, name: "Baseline", flags: flags() },
    { id: managerSetId, name: "Manager", flags: flags({ "permissions.manage": true }) },
    { id: candidateId, name: "Candidate", flags: flags() },
  ]);
  await h.db.insert(users).values([
    {
      id: admin.id,
      email: "admin@fixture.invalid",
      name: "Admin",
      isAdmin: true,
      isActive: true,
      invitedAt: null,
      permissionSetId: baselineId,
    },
    {
      id: manager.id,
      email: "manager@fixture.invalid",
      name: "Manager",
      isAdmin: false,
      isActive: true,
      invitedAt: null,
      permissionSetId: managerSetId,
    },
    {
      id: targetId,
      email: "target@fixture.invalid",
      name: "Target",
      isAdmin: false,
      isActive: true,
      invitedAt: null,
      permissionSetId: baselineId,
    },
  ]);
}
