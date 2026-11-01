import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { permissionSets } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createPermissionSet, updatePermissionSetFlags } from "./permission-sets.service";
import {
  admin,
  assignment,
  auditRows,
  baselineId,
  candidateId,
  flags,
  manager,
  seedProjectCreateGrantServices,
  setRows,
  signal,
  targetId,
} from "./projectCreateGrantServices.test-support";
import { assignSetInput, createPermissionSetInput, updateFlagsInput } from "./schemas";
import { assignPermissionSet } from "./users.service";

let h: TestDb;

beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await seedProjectCreateGrantServices(h);
});

describe("project create grants through real identity services", () => {
  it("denies delegated creation with the new true flag without a set or audit write", async () => {
    const before = await h.db.select().from(permissionSets).orderBy(permissionSets.id);
    const input = createPermissionSetInput.parse({
      name: "Project creators",
      flags: flags({ "project.create": true }),
    });
    expect(await createPermissionSet(h.db, manager, input, signal())).toEqual({
      ok: false,
      error: "granting project.create requires admin",
    });
    expect(await h.db.select().from(permissionSets).orderBy(permissionSets.id)).toEqual(before);
    expect(await auditRows(h, "permission_set.create")).toEqual([]);
  });

  it("allows delegated creation with explicit false and writes the exact ordinary grant audit", async () => {
    const input = createPermissionSetInput.parse({
      name: "Ordinary",
      flags: flags({ "project.create": false, "deal.create": true }),
    });
    const result = await createPermissionSet(h.db, manager, input, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await setRows(h, result.value.id)).toMatchObject([
      { name: input.name, flags: input.flags },
    ]);
    const audit = await auditRows(h, "permission_set.create");
    expect(audit).toHaveLength(1);
    expect(audit).toMatchObject([
      {
        actorId: manager.id,
        targetType: "permission_set",
        targetId: result.value.id,
        after: input,
      },
    ]);
  });

  it("allows native-admin creation with only project create enabled", async () => {
    const input = createPermissionSetInput.parse({
      name: "Admin granted",
      flags: flags({ "project.create": true }),
    });
    const result = await createPermissionSet(h.db, admin, input, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await setRows(h, result.value.id)).toMatchObject([{ flags: input.flags }]);
    expect(await auditRows(h, "permission_set.create")).toMatchObject([
      { actorId: admin.id, targetId: result.value.id, after: input },
    ]);
  });

  it("denies a delegated update retaining true while another flag changes, preserving the row", async () => {
    const previousFlags = flags({ "project.create": true });
    await h.db
      .update(permissionSets)
      .set({ flags: previousFlags })
      .where(eq(permissionSets.id, candidateId));
    const before = await setRows(h, candidateId);
    const input = updateFlagsInput.parse({
      setId: candidateId,
      flags: flags({ "project.create": true, "deal.create": true }),
    });
    expect(await updatePermissionSetFlags(h.db, manager, input, signal())).toEqual({
      ok: false,
      error: "granting project.create requires admin",
    });
    expect(await setRows(h, candidateId)).toEqual(before);
    expect(await auditRows(h, "permission_set.update")).toEqual([]);
  });

  it("allows delegated removal of true on another set and audits the old and new maps", async () => {
    const previousFlags = flags({ "project.create": true });
    await h.db
      .update(permissionSets)
      .set({ flags: previousFlags })
      .where(eq(permissionSets.id, candidateId));
    const nextFlags = flags({ "project.create": false, "deal.create": true });
    const input = updateFlagsInput.parse({ setId: candidateId, flags: nextFlags });
    expect(await updatePermissionSetFlags(h.db, manager, input, signal())).toEqual({
      ok: true,
      value: true,
    });
    expect(await setRows(h, candidateId)).toMatchObject([{ flags: nextFlags }]);
    const audit = await auditRows(h, "permission_set.update");
    expect(audit).toHaveLength(1);
    expect(audit).toMatchObject([
      {
        actorId: manager.id,
        targetId: candidateId,
        before: { flags: previousFlags },
        after: { flags: nextFlags },
      },
    ]);
  });

  it("denies delegated assignment of a set carrying true without replacing the baseline assignment", async () => {
    await h.db
      .update(permissionSets)
      .set({ flags: flags({ "project.create": true }) })
      .where(eq(permissionSets.id, candidateId));
    const input = assignSetInput.parse({ userId: targetId, setId: candidateId });
    expect(await assignment(h)).toEqual([{ setId: baselineId }]);
    expect(await assignPermissionSet(h.db, manager, input, signal())).toEqual({
      ok: false,
      error: "granting project.create requires admin",
    });
    expect(await assignment(h)).toEqual([{ setId: baselineId }]);
    expect(await auditRows(h, "user.assign_permission_set")).toEqual([]);
  });

  it("allows delegated assignment of ordinary true flags with project create explicitly false", async () => {
    await h.db
      .update(permissionSets)
      .set({ flags: flags({ "project.create": false, "deal.create": true }) })
      .where(eq(permissionSets.id, candidateId));
    const input = assignSetInput.parse({ userId: targetId, setId: candidateId });
    expect(await assignPermissionSet(h.db, manager, input, signal())).toEqual({
      ok: true,
      value: true,
    });
    expect(await assignment(h)).toEqual([{ setId: candidateId }]);
    const audit = await auditRows(h, "user.assign_permission_set");
    expect(audit).toHaveLength(1);
    expect(audit).toMatchObject([{ actorId: manager.id, targetId, after: { setId: candidateId } }]);
  });

  it("allows the native-admin retained-true update and carried-set assignment controls", async () => {
    await h.db
      .update(permissionSets)
      .set({ flags: flags({ "project.create": true }) })
      .where(eq(permissionSets.id, candidateId));
    const nextFlags = flags({ "project.create": true, "deal.create": true });
    const update = updateFlagsInput.parse({ setId: candidateId, flags: nextFlags });
    expect(await updatePermissionSetFlags(h.db, admin, update, signal())).toEqual({
      ok: true,
      value: true,
    });
    expect(await setRows(h, candidateId)).toMatchObject([{ flags: nextFlags }]);
    const assign = assignSetInput.parse({ userId: targetId, setId: candidateId });
    expect(await assignPermissionSet(h.db, admin, assign, signal())).toEqual({
      ok: true,
      value: true,
    });
    expect(await assignment(h)).toEqual([{ setId: candidateId }]);
    expect(await auditRows(h, "permission_set.update")).toMatchObject([
      { actorId: admin.id, targetId: candidateId },
    ]);
    expect(await auditRows(h, "user.assign_permission_set")).toMatchObject([
      { actorId: admin.id, targetId, after: { setId: candidateId } },
    ]);
  });
});
