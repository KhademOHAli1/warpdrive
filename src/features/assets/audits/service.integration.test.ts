import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { assert, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { createSourcingActor } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { runLabelCommand } from "@/features/physical-labels/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { runBookingMembershipCommand } from "../bookings/membershipService";
import { runAssetCommand } from "../service";
import type { EquipmentAuditCommand, EquipmentAuditDetail, EquipmentAuditScope } from "./contracts";
import { attachEquipmentAuditEvidence, readEquipmentAuditEvidence } from "./evidence";
import { equipmentAuditEvidencePath } from "./evidenceTransport";
import {
  assetAuditEvents,
  assetAuditEvidence,
  assetAuditReceipts,
  assetAuditRows,
  assetAudits,
} from "./schema";
import {
  lookupEquipmentAudit,
  readEquipmentAudit,
  readEquipmentAudits,
  runEquipmentAudit,
} from "./service";

const unavailable = { ok: false, error: "unavailable" } as const;
const stale = { ok: false, error: "stale" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cKioAAAAASUVORK5CYII=",
  "base64",
);

function accepted<T extends { ok: true } | { ok: false }>(result: T): Extract<T, { ok: true }> {
  assert(result.ok, JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

type Existing = Exclude<EquipmentAuditCommand, { type: "create" }>;
type Payload<T = Existing> = T extends Existing
  ? Omit<T, "auditId" | "version" | "requestId">
  : never;

function command(detail: EquipmentAuditDetail, payload: Payload): Existing {
  return { ...payload, auditId: detail.id, version: detail.version, requestId: randomUUID() };
}

function submit(db: Db, who: NativeSessionRef, input: EquipmentAuditCommand) {
  return runEquipmentAudit(db, who, input, signal());
}

function read(db: Db, who: NativeSessionRef, auditId: string) {
  return readEquipmentAudit(db, who, auditId, signal());
}

function rowFor(detail: EquipmentAuditDetail, assetId: string) {
  const row = detail.rows.find(({ target }) => target?.id === assetId);
  assert(row !== undefined);
  return row;
}

async function siteMember(
  h: TestDb,
  admin: NativeSessionRef,
  person: NativeSessionRef,
  siteId: string,
  role: "base" | "self_service" | null,
) {
  const result = await runBookingMembershipCommand(
    h.db,
    admin,
    {
      requestId: randomUUID(),
      siteId,
      userId: person.userId,
      role,
    },
    signal(),
  );
  assert(result.ok);
}

async function newEquipment(
  h: TestDb,
  manager: NativeSessionRef,
  siteId: string,
  locationId: string,
  code: string,
  tracking: "individual" | "returnable_pool",
  openingQuantity = 0,
) {
  const result = await runAssetCommand(
    h.db,
    manager,
    {
      type: "create",
      requestId: randomUUID(),
      siteId,
      locationId,
      code,
      name: code,
      tracking,
      openingQuantity,
      serial: tracking === "individual" ? `${code}-SERIAL` : null,
      modelId: null,
      description: null,
      categoryId: null,
      tags: [],
      fieldValues: {},
    },
    signal(),
  );
  assert(result.ok);
  const equipment = result.value.records.find(({ id }) => id === result.focusId);
  assert(equipment !== undefined);
  return equipment;
}

async function printedCode(h: TestDb, manager: NativeSessionRef, assetId: string) {
  const label = await runLabelCommand(
    h.db,
    manager,
    {
      type: "issue",
      requestId: randomUUID(),
      target: { kind: "asset", id: assetId },
    },
    signal(),
  );
  assert(label.ok);
  const issued = label.value.labels.find(({ id }) => id === label.focusId);
  assert(issued !== undefined);
  return issued.value;
}

async function setup(h: TestDb) {
  const { db } = h;
  const admin = await actor(h, "Audit administrator", true);
  const siteId = randomUUID();
  const remote = randomUUID();
  const source = randomUUID();
  const recovery = randomUUID();
  const remoteBin = randomUUID();
  await db.insert(directorySites).values([
    { id: siteId, name: "Equipment floor", code: "FLOOR" },
    { id: remote, name: "Other equipment site", code: "REMOTE" },
  ]);
  await db.insert(directoryLocations).values([
    { id: source, siteId, name: "Original bench", code: "BENCH" },
    { id: recovery, siteId, name: "Recovery bench", code: "RECOVERY" },
    { id: remoteBin, siteId: remote, name: "Foreign location", code: "REMOTE-BIN" },
  ]);

  const manager = await createSourcingActor(
    h,
    admin,
    "Named audit manager",
    siteId,
    "asset_manager",
  );
  const outside = await createSourcingActor(
    h,
    admin,
    "Other-site manager",
    remote,
    "asset_manager",
  );
  const base = await actor(h, "Assigned base auditor");
  const self = await actor(h, "Assigned self-service auditor");
  const unassigned = await actor(h, "Unassigned base member");
  const guest = await actor(h, "Project guest");
  await db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));

  await siteMember(h, admin, base, siteId, "base");
  await siteMember(h, admin, self, siteId, "self_service");
  await siteMember(h, admin, unassigned, siteId, "base");

  const meter = await newEquipment(h, manager, siteId, source, "METER-AUDIT", "individual");
  const missing = await newEquipment(h, manager, siteId, source, "METER-MISSING", "individual");
  const pool = await newEquipment(h, manager, siteId, source, "LEAD-AUDIT", "returnable_pool", 10);
  const additional = await newEquipment(
    h,
    manager,
    siteId,
    recovery,
    "OUTSIDE-SCOPE",
    "individual",
  );
  const foreign = await newEquipment(h, outside, remote, remoteBin, "FOREIGN-AUDIT", "individual");

  const scope: EquipmentAuditScope = {
    locationIds: [source],
    includeChildren: true,
    assetIds: [],
    kitIds: [],
    categoryIds: [],
    tag: null,
    includeCustody: false,
  };
  const draft = accepted(
    await submit(db, manager, {
      type: "create",
      siteId,
      title: "Instrument floor count",
      dueAt: null,
      scope,
      assigneeIds: [base.userId, self.userId],
      requestId: randomUUID(),
    }),
  );
  return {
    admin,
    manager,
    outside,
    base,
    self,
    unassigned,
    guest,
    meter,
    missing,
    pool,
    additional,
    foreign,
    siteId,
    source,
    recovery,
    remote,
    draft,
  };
}

it("uses live site and assignment scopes, freezes equipment at start, and records ordered atomic results", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { db } = h;
    const id = f.draft.detail.id;
    expect(f.draft.detail.activity[0]).toMatchObject({
      kind: "created",
      actor: "Named audit manager",
    });
    for (const denied of [f.outside, f.unassigned, f.guest]) {
      expect(await read(db, denied, id)).toEqual(unavailable);
      expect(await submit(db, denied, command(f.draft.detail, { type: "start" }))).toEqual(
        unavailable,
      );
    }
    const restricted = accepted(await readEquipmentAudits(db, f.base, signal()));
    expect(restricted.value.audits.map(({ id }) => id)).toEqual([id]);
    expect(restricted.value.sites[0]).toMatchObject({
      canManage: false,
      targets: [],
      auditors: [],
    });
    expect(
      await submit(db, f.manager, {
        type: "create",
        siteId: f.remote,
        scope: f.draft.detail.scope,
        title: "Outside audit",
        dueAt: null,
        assigneeIds: [],
        requestId: randomUUID(),
      }),
    ).toEqual(unavailable);

    const active = accepted(await submit(db, f.base, command(f.draft.detail, { type: "start" })));
    expect(active.detail.progress).toMatchObject({
      expectedRows: 3,
      expectedUnits: 12,
      missingRows: 0,
    });
    const meter = rowFor(active.detail, f.meter.id);
    const pool = rowFor(active.detail, f.pool.id);
    expect(meter.placement).toMatchObject({ locationId: f.source, label: "Original bench" });
    const moved = await runAssetCommand(
      db,
      f.manager,
      {
        type: "move",
        assetId: f.meter.id,
        version: f.meter.version,
        locationId: f.recovery,
        reason: "Instrument moved after the audit started",
        requestId: randomUUID(),
      },
      signal(),
    );
    assert(moved.ok);
    expect(rowFor(accepted(await read(db, f.self, id)).value, f.meter.id)).toEqual(meter);
    expect(moved.value.records.find(({ id }) => id === f.meter.id)).toMatchObject({
      locationId: f.recovery,
    });

    const knownCode = await printedCode(h, f.manager, f.meter.id);
    const foreignCode = await printedCode(h, f.outside, f.foreign.id);
    expect(await lookupEquipmentAudit(db, f.base, id, knownCode, signal())).toMatchObject({
      ok: true,
      targetId: f.meter.id,
      rows: [meter.id],
    });
    expect(
      await lookupEquipmentAudit(db, f.manager, id, f.additional.code, signal()),
    ).toMatchObject({
      ok: true,
      targetId: f.additional.id,
      rows: [],
    });
    const opaque = { ok: true, targetId: null, rows: [], label: null };
    expect(await lookupEquipmentAudit(db, f.self, id, f.additional.code, signal())).toEqual(opaque);
    expect(await lookupEquipmentAudit(db, f.manager, id, foreignCode, signal())).toEqual(opaque);
    expect(await lookupEquipmentAudit(db, f.outside, id, knownCode, signal())).toEqual(unavailable);

    const blocked = await submit(
      db,
      f.self,
      command(active.detail, {
        type: "bulkCount",
        counts: [
          { rowId: pool.id, quantity: 8 },
          { rowId: meter.id, quantity: 2 },
        ],
      }),
    );
    expect(blocked).toEqual({ ok: false, error: "quantity" });
    expect(rowFor(accepted(await read(db, f.self, id)).value, f.pool.id).counted).toBeNull();

    const batch = command(active.detail, {
      type: "bulkCount",
      counts: [
        { rowId: meter.id, quantity: 1 },
        { rowId: pool.id, quantity: 8 },
      ],
    });
    assert(batch.type === "bulkCount");
    const first = accepted(await submit(db, f.self, batch));
    expect(first.detail.version).toBe(active.detail.version + 1);
    expect(first.detail.activity.slice(0, 2).map(({ rowId }) => rowId)).toEqual([
      pool.id,
      meter.id,
    ]);
    const ordered = await db
      .select()
      .from(assetAuditEvents)
      .where(
        and(eq(assetAuditEvents.auditId, id), eq(assetAuditEvents.version, first.detail.version)),
      )
      .orderBy(asc(assetAuditEvents.ordinal));
    expect(ordered.map(({ rowId, ordinal }) => ({ rowId, ordinal }))).toEqual([
      { rowId: meter.id, ordinal: 0 },
      { rowId: pool.id, ordinal: 1 },
    ]);
    expect(accepted(await submit(db, f.self, batch)).detail.activity).toEqual(
      first.detail.activity,
    );
    expect(
      await submit(db, f.self, { ...batch, counts: [{ rowId: pool.id, quantity: 7 }] }),
    ).toEqual(conflict);

    const raced = await Promise.all(
      [f.base, f.self].map((auditor) =>
        submit(
          db,
          auditor,
          command(first.detail, {
            type: "setCount",
            mode: "add",
            proof: null,
            rowId: pool.id,
            quantity: 1,
          }),
        ),
      ),
    );
    expect(raced.filter(({ ok }) => ok)).toHaveLength(1);
    expect(raced.find(({ ok }) => !ok)).toEqual(stale);
    const latest = accepted(await read(db, f.self, id)).value;
    expect(rowFor(latest, f.pool.id).counted).toBe(9);
    const unexpected = command(latest, {
      type: "unexpected",
      code: foreignCode,
      expectedTargetId: null,
      locationId: f.source,
      quantity: 1,
    });
    const logged = accepted(await submit(db, f.base, unexpected));
    const unresolved = logged.detail.rows.find(({ result }) => result === "unexpected");
    assert(unresolved !== undefined);
    expect(unresolved.target).toBeNull();
    const [finding] = await db
      .select()
      .from(assetAuditRows)
      .where(eq(assetAuditRows.id, unresolved.id));
    const [receipt] = await db
      .select()
      .from(assetAuditReceipts)
      .where(eq(assetAuditReceipts.requestId, unexpected.requestId));
    expect(finding?.opaqueKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(receipt?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify({ finding, receipt, detail: logged.detail })).not.toContain(foreignCode);

    await siteMember(h, f.admin, f.base, f.siteId, null);
    expect(await read(db, f.base, id)).toEqual(unavailable);
    expect(await submit(db, f.base, unexpected)).toEqual(unavailable);
    const closed = accepted(
      await submit(
        db,
        f.self,
        command(logged.detail, { type: "complete", note: "Count finished" }),
      ),
    );
    expect(rowFor(closed.detail, f.missing.id)).toMatchObject({ counted: null, result: "missing" });
    expect(closed.detail.progress).toMatchObject({ missingRows: 2, missingUnits: 2 });
    expect(
      await submit(
        db,
        f.self,
        command(closed.detail, { type: "undo", rowId: meter.id, reason: "Too late" }),
      ),
    ).toEqual({ ok: false, error: "state" });
    const archived = accepted(
      await submit(db, f.manager, command(closed.detail, { type: "archive", archived: true })),
    );
    const duplicate = command(archived.detail, {
      type: "duplicate",
      title: "Second count",
      dueAt: null,
    });
    const fresh = accepted(await submit(db, f.manager, duplicate));
    expect(fresh.detail).toMatchObject({ status: "draft", assignees: [], rows: [], evidence: [] });
    expect(fresh.detail.id).not.toBe(id);
    expect(fresh.detail.activity.map(({ kind }) => kind)).toEqual(["duplicated"]);
    expect(accepted(await submit(db, f.manager, duplicate)).detail).toEqual(fresh.detail);
    await expect(
      db.update(assetAuditRows).set({ counted: 0 }).where(eq(assetAuditRows.id, meter.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(assetAudits).where(eq(assetAudits.id, id))).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    await expect(
      db.delete(assetAuditEvents).where(eq(assetAuditEvents.auditId, id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.delete(assetAuditReceipts).where(eq(assetAuditReceipts.auditId, id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally {
    await h.close();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((then) => {
    resolve = then;
  });
  return { promise, resolve };
}

it("keeps photo evidence private and stable across undo, retry, and membership revocation", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { db } = h;
    const active = accepted(
      await submit(db, f.manager, command(f.draft.detail, { type: "start" })),
    );
    const counted = accepted(
      await submit(
        db,
        f.base,
        command(active.detail, {
          type: "unexpected",
          code: "Unrecognized printed mark",
          expectedTargetId: null,
          locationId: f.source,
          quantity: 1,
        }),
      ),
    );
    const unexpected = counted.detail.rows.find(({ result }) => result === "unexpected");
    assert(unexpected !== undefined);
    const noted = accepted(
      await submit(
        db,
        f.base,
        command(counted.detail, {
          type: "note",
          rowId: unexpected.id,
          note: "Inspect worn instrument label",
        }),
      ),
    );
    const storage = new FakeStorageClient();
    const photo = {
      auditId: noted.detail.id,
      rowId: unexpected.id,
      version: noted.detail.version,
      requestId: randomUUID(),
      source: "camera",
      name: "Inspection.png",
      mime: "image/png",
      bytes: png,
      expectedActorId: f.base.userId,
    } as const;
    expect(
      await attachEquipmentAuditEvidence(
        db,
        f.unassigned,
        { ...photo, expectedActorId: f.unassigned.userId },
        signal(),
        storage,
      ),
    ).toEqual(unavailable);
    const entered = deferred<string>();
    const release = deferred<void>();
    const put = storage.putObjectBytes.bind(storage);
    vi.spyOn(storage, "putObjectBytes").mockImplementationOnce(async (key, bytes, mime) => {
      entered.resolve(key);
      await release.promise;
      return put(key, bytes, mime, signal());
    });
    const interrupt = new AbortController();
    const pending = attachEquipmentAuditEvidence(db, f.base, photo, interrupt.signal, storage);
    let interruption: unknown;
    const stopped = pending.catch((error: unknown) => {
      interruption = error;
    });
    const failedKey = await entered.promise;
    interrupt.abort();
    const retriedUpload = await (async () => {
      try {
        await vi.waitFor(() => expect(interruption).toMatchObject({ name: "AbortError" }), {
          timeout: 700,
        });
        await stopped;
        expect(
          await db
            .select()
            .from(assetAuditEvidence)
            .where(eq(assetAuditEvidence.auditId, photo.auditId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(assetAuditReceipts)
            .where(eq(assetAuditReceipts.requestId, photo.requestId)),
        ).toHaveLength(0);
        return await attachEquipmentAuditEvidence(db, f.base, photo, signal(), storage);
      } finally {
        release.resolve();
      }
    })();
    const uploaded = accepted(retriedUpload);
    await vi.waitFor(() => expect(storage.deletedKeys).toContain(failedKey));
    expect(storage.objectsByKey.has(failedKey)).toBe(false);
    expect(storage.objectsByKey.size).toBe(1);
    const item = uploaded.detail.evidence[0];
    assert(item !== undefined);
    expect(item).toMatchObject({
      rowId: unexpected.id,
      name: photo.name,
      source: "camera",
      actor: "Assigned base auditor",
      href: equipmentAuditEvidencePath(photo.auditId, item.id),
    });
    const retried = accepted(
      await attachEquipmentAuditEvidence(db, f.base, photo, signal(), storage),
    );
    expect(retried.detail.evidence).toEqual([item]);
    expect(
      await attachEquipmentAuditEvidence(
        db,
        f.base,
        { ...photo, name: "Changed.png" },
        signal(),
        storage,
      ),
    ).toEqual(conflict);
    const locator = { auditId: photo.auditId, evidenceId: item.id };
    const allowed = accepted(
      await readEquipmentAuditEvidence(db, f.self, locator, signal(), storage),
    );
    expect(allowed.value.mime).toBe("image/png");
    expect(Buffer.from(allowed.value.bytes)).toEqual(png);
    expect(await readEquipmentAuditEvidence(db, f.outside, locator, signal(), storage)).toEqual(
      unavailable,
    );
    expect(
      await readEquipmentAuditEvidence(
        db,
        f.manager,
        { ...locator, auditId: randomUUID() },
        signal(),
        storage,
      ),
    ).toEqual(unavailable);

    const undone = accepted(
      await submit(
        db,
        f.self,
        command(uploaded.detail, {
          type: "undo",
          rowId: unexpected.id,
          reason: "A second inspection ruled it out",
        }),
      ),
    );
    expect(undone.detail.rows.some(({ id }) => id === unexpected.id)).toBe(false);
    expect(undone.detail.evidence).toEqual([item]);
    expect(undone.detail.activity.slice(0, 3).map(({ kind }) => kind)).toEqual([
      "undone",
      "photo",
      "note",
    ]);
    const stored = await db
      .select()
      .from(assetAuditEvidence)
      .where(eq(assetAuditEvidence.auditId, photo.auditId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: item.id,
      siteId: f.siteId,
      rowId: unexpected.id,
      actorId: f.base.userId,
      sizeBytes: png.length,
      contentType: "image/png",
      sha256: createHash("sha256").update(png).digest("hex"),
    });
    await expect(
      db
        .update(assetAuditEvidence)
        .set({ name: "Changed.png" })
        .where(eq(assetAuditEvidence.id, item.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await siteMember(h, f.admin, f.base, f.siteId, null);
    expect(await readEquipmentAuditEvidence(db, f.base, locator, signal(), storage)).toEqual(
      unavailable,
    );
    expect(await attachEquipmentAuditEvidence(db, f.base, photo, signal(), storage)).toEqual(
      unavailable,
    );
  } finally {
    await h.close();
  }
});
