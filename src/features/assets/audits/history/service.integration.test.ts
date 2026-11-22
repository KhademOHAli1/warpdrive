import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  actor,
  incumbentRows,
  seedStructures,
  signal,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { runBookingMembershipCommand } from "../../bookings/membershipService";
import type { AssetIntent, AssetRecord } from "../../contracts";
import { readAssetsWorkspace, runAssetCommand } from "../../service";
import type { EquipmentAuditDetail, EquipmentAuditIntent, EquipmentAuditScope } from "../contracts";
import { attachEquipmentAuditEvidence, readEquipmentAuditEvidence } from "../evidence";
import { readEquipmentAudit, runEquipmentAudit } from "../service";
import { readAssetAuditHistory } from "./service";

const denied = { ok: false, error: "unavailable" } as const;
const empty = { ok: true, entries: [] } as const;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cKioAAAAASUVORK5CYII=",
  "base64",
);

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  assert(result.ok, JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

function history(h: TestDb, who: NativeSessionRef, assetId: string) {
  return readAssetAuditHistory(h.db, who, assetId, signal());
}

function assetIdentity({ id, version }: AssetRecord) {
  return { assetId: id, version };
}

function metadata(code: string) {
  return {
    code,
    name: code,
    description: null,
    categoryId: null,
    tags: [],
    fieldValues: {},
    modelId: null,
  };
}

async function changeAsset(h: TestDb, who: NativeSessionRef, input: AssetIntent) {
  const { focusId, value } = expectOk(
    await runAssetCommand(h.db, who, { ...input, requestId: randomUUID() }, signal()),
  );
  const found = value.records.find(({ id }) => id === focusId);
  assert(found !== undefined);
  return found;
}

function newAsset(
  h: TestDb,
  who: NativeSessionRef,
  site: { siteId: string; locationId: string },
  code: string,
  openingQuantity = 0,
) {
  return changeAsset(h, who, {
    type: "create",
    ...site,
    ...metadata(code),
    openingQuantity,
    tracking: openingQuantity === 0 ? "individual" : "returnable_pool",
    serial: openingQuantity === 0 ? `${code}-SERIAL` : null,
  });
}

async function auditCommand(h: TestDb, who: NativeSessionRef, input: EquipmentAuditIntent) {
  return expectOk(
    await runEquipmentAudit(h.db, who, { ...input, requestId: randomUUID() }, signal()),
  ).detail;
}

function pinAudit({ id, version }: EquipmentAuditDetail) {
  return { auditId: id, version };
}

function auditScope(filters: Partial<EquipmentAuditScope> = {}): EquipmentAuditScope {
  return {
    locationIds: [],
    includeChildren: false,
    assetIds: [],
    kitIds: [],
    categoryIds: [],
    tag: null,
    includeCustody: false,
    ...filters,
  };
}

function rowFor(detail: EquipmentAuditDetail, assetId: string, locationId?: string) {
  const row = detail.rows.find(
    (item) =>
      item.target?.id === assetId &&
      (locationId === undefined || item.placement.locationId === locationId),
  );
  assert(row !== undefined);
  return row;
}

function membership(
  h: TestDb,
  admin: NativeSessionRef,
  siteId: string,
  person: NativeSessionRef,
  role: "base" | null,
) {
  return runBookingMembershipCommand(
    h.db,
    admin,
    { siteId, userId: person.userId, role, requestId: randomUUID() },
    signal(),
  ).then(expectOk);
}

async function evidenceOnPool(
  h: TestDb,
  who: NativeSessionRef,
  detail: EquipmentAuditDetail,
  rowId: string,
) {
  const storage = new FakeStorageClient();
  const uploaded = expectOk(
    await attachEquipmentAuditEvidence(
      h.db,
      who,
      {
        ...pinAudit(detail),
        rowId,
        requestId: randomUUID(),
        source: "file",
        name: "Private equipment survey.png",
        mime: "image/png",
        bytes: png,
        expectedActorId: who.userId,
      },
      signal(),
      storage,
    ),
  );
  const [item] = uploaded.detail.evidence;
  assert(item !== undefined);
  return { detail: uploaded.detail, storage, evidenceId: item.id };
}

async function renameMoveArchive(
  h: TestDb,
  who: NativeSessionRef,
  record: AssetRecord,
  locationId: string,
) {
  const renamed = await changeAsset(h, who, {
    type: "update",
    ...assetIdentity(record),
    ...metadata("RETIRED-METER"),
    serial: "RETIRED-SERIAL",
  });
  const moved = await changeAsset(h, who, {
    type: "move",
    ...assetIdentity(renamed),
    locationId,
    reason: "Moved after the audit snapshot",
  });
  return changeAsset(h, who, {
    type: "setArchive",
    ...assetIdentity(moved),
    archived: true,
    reason: "Retired following instrument replacement",
  });
}

async function populatedAudit(h: TestDb) {
  const { admin, source, recovery } = await seedStructures(h);
  const siteId = source.siteId;
  const annex = { siteId, locationId: randomUUID() };
  await h.db
    .insert(directoryLocations)
    .values({ id: annex.locationId, siteId, name: "Quality annex", code: "QA-ANNEX" });
  const manager = await createSourcingActor(
    h,
    admin,
    "Equipment audit manager",
    siteId,
    "asset_manager",
  );
  const pool = await newAsset(h, manager, source, "TEST-LEADS", 10);
  const pooled = await changeAsset(h, manager, {
    type: "changePool",
    ...assetIdentity(pool),
    operation: "restock",
    locationId: recovery.locationId,
    toLocationId: null,
    quantity: 6,
    reason: "Staged in the second bin",
  });
  const meter = await newAsset(h, manager, source, "TEST-METER");
  const extra = await newAsset(h, manager, annex, "FOUND-METER");
  const draft = await auditCommand(h, manager, {
    type: "create",
    siteId,
    title: "Instrument discrepancy audit",
    dueAt: null,
    assigneeIds: [],
    scope: auditScope({ locationIds: [source.locationId, recovery.locationId] }),
  });
  const active = await auditCommand(h, manager, { type: "start", ...pinAudit(draft) });
  const poolA = rowFor(active, pool.id, source.locationId);
  const poolB = rowFor(active, pool.id, recovery.locationId);
  const meterRow = rowFor(active, meter.id);
  const first = await auditCommand(h, manager, {
    type: "bulkCount",
    ...pinAudit(active),
    counts: [
      { rowId: poolA.id, quantity: 4 },
      { rowId: meterRow.id, quantity: 1 },
    ],
  });
  const corrected = await auditCommand(h, manager, {
    type: "undo",
    ...pinAudit(first),
    rowId: poolA.id,
    reason: "Wrong bin was counted initially",
  });
  const recounted = await auditCommand(h, manager, {
    type: "setCount",
    ...pinAudit(corrected),
    rowId: poolA.id,
    quantity: 0,
    mode: "replace",
    proof: null,
  });
  const known = await auditCommand(h, manager, {
    type: "unexpected",
    ...pinAudit(recounted),
    code: extra.code,
    expectedTargetId: extra.id,
    locationId: annex.locationId,
    quantity: 1,
  });
  const knownRow = rowFor(known, extra.id);
  const withdrawn = await auditCommand(h, manager, {
    type: "undo",
    ...pinAudit(known),
    rowId: knownRow.id,
    reason: "Duplicate instrument observation",
  });
  const unknownCode = "UNREADABLE-AUDIT-MARK";
  const opaque = await auditCommand(h, manager, {
    type: "unexpected",
    ...pinAudit(withdrawn),
    code: unknownCode,
    expectedTargetId: null,
    locationId: source.locationId,
    quantity: 1,
  });
  const opaqueRow = opaque.rows.find(({ target }) => target === null);
  assert(opaqueRow !== undefined);
  const withNote = await auditCommand(h, manager, {
    type: "note",
    ...pinAudit(opaque),
    rowId: poolA.id,
    note: "Private note unrelated to the count",
  });
  const evidence = await evidenceOnPool(h, manager, withNote, poolA.id);
  const retired = await renameMoveArchive(h, manager, meter, annex.locationId);
  const closed = await auditCommand(h, manager, {
    type: "complete",
    ...pinAudit(evidence.detail),
    note: "Audit-wide private note",
  });
  const archived = await auditCommand(h, manager, {
    type: "archive",
    ...pinAudit(closed),
    archived: true,
  });
  const matchingNewCode = await newAsset(h, manager, annex, unknownCode);
  return {
    manager,
    pooled,
    poolA,
    poolB,
    retired,
    meterRow,
    extra,
    knownRow,
    opaqueRow,
    matchingNewCode,
    archived,
    evidence,
  };
}

it("projects exact frozen observations and corrections after a populated 0153 to 0154 upgrade", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 154);
    const f = await populatedAudit(h);
    const before = await incumbentRows(h);
    const prefix = await ledger(h);
    const targetRows = await h.db.execute(
      sql`SELECT to_regclass('asset_audit_rows_target_history_idx') AS idx`,
    );
    expect(targetRows.rows).toEqual([{ idx: null }]);

    expectOk(await applyMigrations(h.db, signal(), canonicalFolder));
    const upgraded = await ledger(h);
    expect(upgraded).toHaveLength(prefix.length + 1);
    expect(upgraded.slice(0, -1)).toEqual(prefix);
    const indexes = await h.db.execute(sql`SELECT
      to_regclass('asset_audit_rows_target_history_idx')::text AS findings,
      to_regclass('asset_audit_events_row_history_idx')::text AS events`);
    expect(indexes.rows).toEqual([
      {
        findings: "asset_audit_rows_target_history_idx",
        events: "asset_audit_events_row_history_idx",
      },
    ]);

    const pool = expectOk(await history(h, f.manager, f.pooled.id));
    const [entry] = pool.entries;
    assert(entry !== undefined);
    expect(pool.entries).toHaveLength(1);
    expect(entry).toMatchObject({ auditId: f.archived.id, archived: true, status: "completed" });
    expect(entry.findings).toHaveLength(2);
    const count = entry.findings.find(({ id }) => id === f.poolA.id);
    const untouched = entry.findings.find(({ id }) => id === f.poolB.id);
    expect(count).toMatchObject({
      expected: 10,
      counted: 0,
      result: "missing",
      placement: { label: "ASSEMBLY" },
    });
    expect(count?.activity).toMatchObject([
      { kind: "counted", before: null, after: 4, actor: "Equipment audit manager" },
      { kind: "undone", before: 4, after: null, note: "Wrong bin was counted initially" },
      { kind: "counted", before: null, after: 0 },
    ]);
    expect(untouched).toMatchObject({
      expected: 6,
      counted: null,
      result: "missing",
      activity: [],
      placement: { label: "RECOVERY" },
    });
    const serialized = JSON.stringify(pool);
    for (const omitted of [
      "Private equipment survey.png",
      "Private note unrelated to the count",
      "Audit-wide private note",
      f.evidence.evidenceId,
      f.meterRow.id,
      f.knownRow.id,
      f.opaqueRow.id,
    ]) {
      expect(serialized).not.toContain(omitted);
    }

    expect(f.retired).toMatchObject({ name: "RETIRED-METER", serial: "RETIRED-SERIAL" });
    expect(f.retired.archivedAt).not.toBeNull();
    expect(await history(h, f.manager, f.retired.id)).toMatchObject({
      ok: true,
      entries: [
        {
          findings: [
            {
              id: f.meterRow.id,
              name: "TEST-METER",
              serial: "TEST-METER-SERIAL",
              result: "found",
              placement: { label: "ASSEMBLY" },
            },
          ],
        },
      ],
    });
    expect(await history(h, f.manager, f.extra.id)).toMatchObject({
      ok: true,
      entries: [
        {
          findings: [
            {
              id: f.knownRow.id,
              result: "withdrawn",
              expected: null,
              counted: null,
              activity: [
                { kind: "unexpected", after: 1 },
                {
                  kind: "undone",
                  before: 1,
                  after: null,
                  note: "Duplicate instrument observation",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(await history(h, f.manager, f.matchingNewCode.id)).toEqual(empty);

    const register = expectOk(await readAssetsWorkspace(h.db, f.manager, signal()));
    expect(register.value.records.find(({ id }) => id === f.pooled.id)).toEqual(f.pooled);
    const audit = expectOk(await readEquipmentAudit(h.db, f.manager, f.archived.id, signal()));
    expect(audit.value).toEqual(f.archived);
    const photo = expectOk(
      await readEquipmentAuditEvidence(
        h.db,
        f.manager,
        { auditId: f.archived.id, evidenceId: f.evidence.evidenceId },
        signal(),
        f.evidence.storage,
      ),
    );
    expect(Buffer.from(photo.value.bytes)).toEqual(png);
    expect(await incumbentRows(h)).toEqual(before);
    expectOk(await applyMigrations(h.db, signal(), canonicalFolder));
    expect(await ledger(h)).toEqual(upgraded);
    expect(await history(h, f.manager, f.pooled.id)).toEqual(pool);
  } finally {
    await h.close();
  }
});

async function scopeFixture(h: TestDb) {
  const admin = await actor(h, "Operations administrator", true);
  const home = { siteId: randomUUID(), locationId: randomUUID() };
  const remote = { siteId: randomUUID(), locationId: randomUUID() };
  await h.db.insert(directorySites).values([
    { id: home.siteId, name: "Home tools", code: "HISTORY-HOME" },
    { id: remote.siteId, name: "Remote tools", code: "HISTORY-REMOTE" },
  ]);
  await h.db.insert(directoryLocations).values([
    { id: home.locationId, siteId: home.siteId, name: "Home bench", code: "HOME-BENCH" },
    { id: remote.locationId, siteId: remote.siteId, name: "Remote bench", code: "REMOTE-BENCH" },
  ]);
  const manager = await createSourcingActor(
    h,
    admin,
    "Home equipment manager",
    home.siteId,
    "asset_manager",
  );
  const outside = await createSourcingActor(
    h,
    admin,
    "Remote equipment manager",
    remote.siteId,
    "asset_manager",
  );
  const viewer = await createSourcingActor(
    h,
    admin,
    "Equipment-only viewer",
    home.siteId,
    "asset_viewer",
  );
  const unassigned = await createSourcingActor(
    h,
    admin,
    "Unassigned equipment viewer",
    home.siteId,
    "asset_viewer",
  );
  const assigned = await actor(h, "Assigned auditor");
  const guest = await actor(h, "Project-only guest");
  await h.db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));
  await membership(h, admin, home.siteId, assigned, "base");
  await membership(h, admin, home.siteId, unassigned, "base");
  const equipment = await newAsset(h, manager, home, "CALIBRATOR");
  const remoteEquipment = await newAsset(h, outside, remote, equipment.code);
  return {
    admin,
    home,
    manager,
    outside,
    viewer,
    unassigned,
    assigned,
    guest,
    equipment,
    remoteEquipment,
  };
}

it("applies exact current Asset and audit scope before bounding the latest four completions", async () => {
  const h = await makeTestDb();
  try {
    const f = await scopeFixture(h);
    const assetId = f.equipment.id;
    const auditIdsInCompletionOrder: string[] = [];
    const drafts: EquipmentAuditDetail[] = [];
    for (const number of [1, 2, 3, 4, 5, 6, 7]) {
      drafts.push(
        await auditCommand(h, f.manager, {
          type: "create",
          siteId: f.home.siteId,
          dueAt: null,
          title: `Instrument count ${number}`,
          scope: auditScope({ assetIds: [assetId] }),
          assigneeIds: number === 2 ? [] : [f.assigned.userId],
        }),
      );
    }
    for (const index of [4, 5, 2, 3, 0, 1]) {
      const draft = drafts[index];
      assert(draft !== undefined);
      const active = await auditCommand(h, f.manager, { type: "start", ...pinAudit(draft) });
      const completed = await auditCommand(h, f.manager, {
        type: "complete",
        ...pinAudit(active),
        note: null,
      });
      auditIdsInCompletionOrder.unshift(completed.id);
    }
    const [unassignedNewest, firstVisible] = auditIdsInCompletionOrder;
    assert(unassignedNewest !== undefined && firstVisible !== undefined);
    const openDraft = drafts.at(-1);
    assert(openDraft !== undefined);
    await auditCommand(h, f.manager, { type: "start", ...pinAudit(openDraft) });

    const manager = expectOk(await history(h, f.manager, assetId));
    expect(manager.truncated).toBe(true);
    expect(manager.entries.map(({ auditId }) => auditId)).toEqual(
      auditIdsInCompletionOrder.slice(0, 4),
    );
    expect(
      expectOk(await readEquipmentAudit(h.db, f.assigned, firstVisible, signal())).value.id,
    ).toBe(firstVisible);
    for (const deniedActor of [f.assigned, f.viewer, f.outside, f.guest]) {
      expect(await history(h, deniedActor, assetId)).toEqual(denied);
    }
    expect(await history(h, f.unassigned, assetId)).toEqual(empty);
    expect(await history(h, f.manager, f.remoteEquipment.id)).toEqual(denied);
    expect(await history(h, f.outside, f.remoteEquipment.id)).toEqual(empty);
    expect(await history(h, f.manager, randomUUID())).toEqual(denied);

    await setRole(h, f.admin, f.assigned, f.home.siteId, "asset_viewer");
    const scoped = expectOk(await history(h, f.assigned, assetId));
    expect(scoped.truncated).toBe(true);
    expect(scoped.entries.map(({ auditId }) => auditId)).toEqual(
      auditIdsInCompletionOrder.slice(1, 5),
    );
    expect(scoped.entries.some(({ auditId }) => auditId === unassignedNewest)).toBe(false);
    await membership(h, f.admin, f.home.siteId, f.assigned, null);
    expect(await history(h, f.assigned, assetId)).toEqual(denied);
    await membership(h, f.admin, f.home.siteId, f.assigned, "base");
    expect(await history(h, f.assigned, assetId)).toEqual(scoped);
    await setRole(h, f.admin, f.assigned, f.home.siteId, "asset_viewer", false);
    expect(await history(h, f.assigned, assetId)).toEqual(denied);
  } finally {
    await h.close();
  }
});
