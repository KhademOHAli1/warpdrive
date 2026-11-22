import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { sessions, users } from "@/db/schema/identity";
import { runAssetCommand } from "@/features/assets/service";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { inventoryPartProfiles } from "@/features/inventory/catalog/schema";
import {
  inventoryProductReleases,
  inventoryReleaseArtifacts,
} from "@/features/inventory/releases/schema";
import { executeReleaseMetadata, findActiveRelease } from "@/features/inventory/releases/service";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { readWarehouseTransfers } from "@/features/inventory/warehouse/operations/reads";
import {
  actor,
  incumbentRows,
  position,
  seedStructures,
  signal,
  value,
  command as warehouse,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { inventoryStockAllocations } from "@/features/inventory/warehouse/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import type { LabelCommand, LabelResult, LabelTargetRef } from "./contracts";
import { isInternalLabelCode, physicalLabelScanUrl } from "./formats";
import { physicalLabelReceipts, physicalLabels } from "./schema";
import { readLabelWorkspace, resolveLabel, runLabelCommand } from "./service";

type Intent<T = LabelCommand> = T extends LabelCommand ? Omit<T, "requestId"> : never;
type Seed = Awaited<ReturnType<typeof seedStructures>>;
const origin = "https://labels.example.test";
const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;

function send(h: TestDb, who: NativeSessionRef, command: Intent, requestId = randomUUID()) {
  return runLabelCommand(h.db, who, { ...command, requestId }, signal());
}

function focused(result: LabelResult) {
  assert(result.ok);
  const label = result.value.labels.find(({ id }) => id === result.focusId);
  assert(label !== undefined);
  return label;
}

function lookup(h: TestDb, who: NativeSessionRef, code: string) {
  return resolveLabel(h.db, who, { value: code }, origin, signal());
}

function target(kind: LabelTargetRef["kind"], id: string): LabelTargetRef {
  return { kind, id };
}

async function asset(h: TestDb, { admin, source }: Seed, code: string) {
  const result = await runAssetCommand(
    h.db,
    admin,
    {
      type: "create",
      requestId: randomUUID(),
      siteId: source.siteId,
      code,
      name: code,
      description: null,
      categoryId: null,
      tags: [],
      fieldValues: {},
      tracking: "individual",
      serial: code,
      modelId: null,
      locationId: source.locationId,
      openingQuantity: 0,
    },
    signal(),
  );
  assert(result.ok && result.focusId !== null);
  return target("asset", result.focusId);
}

async function receiptRows(h: TestDb, who: NativeSessionRef, requestId: string) {
  return h.db
    .select()
    .from(physicalLabelReceipts)
    .where(
      and(
        eq(physicalLabelReceipts.actorId, who.userId),
        eq(physicalLabelReceipts.requestId, requestId),
      ),
    );
}

it("reuses one active code, replays exact receipts, and never rebinds an issued or retired code", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const assetA = await asset(h, f, "METER-A");
    const assetB = await asset(h, f, "METER-B");
    const { admin } = f;
    const incumbent = await incumbentRows(h);
    const firstRequest = randomUUID();
    const secondRequest = randomUUID();
    const issue = { type: "issue", target: assetA } as const;
    const [first, reused] = (
      await Promise.all([send(h, admin, issue, firstRequest), send(h, admin, issue, secondRequest)])
    ).map(focused);
    assert(first !== undefined && reused !== undefined);
    expect(first).toMatchObject({
      format: "qr",
      source: "internal",
      target: assetA,
      retiredAt: null,
    });
    expect(isInternalLabelCode(first.value)).toBe(true);
    expect(reused).toEqual(first);
    expect(focused(await send(h, admin, issue, firstRequest)).id).toBe(first.id);
    expect(await send(h, admin, { ...issue, target: assetB }, firstRequest)).toEqual(conflict);
    expect(await receiptRows(h, admin, firstRequest)).toMatchObject([
      { labelId: first.id, commandType: "issue" },
    ]);
    expect(await receiptRows(h, admin, secondRequest)).toMatchObject([
      { labelId: first.id, commandType: "issue" },
    ]);

    const url = physicalLabelScanUrl(origin, first.value);
    assert(url !== null);
    expect(await lookup(h, admin, url)).toMatchObject({
      ok: true,
      label: { id: first.id, target: assetA },
    });

    const requestId = randomUUID();
    const retire = { type: "retire", labelId: first.id } as const;
    const retired = focused(await send(h, admin, retire, requestId));
    expect(retired.retiredAt).not.toBeNull();
    expect(focused(await send(h, admin, retire, requestId))).toEqual(retired);
    expect(await send(h, admin, retire)).toEqual({ ok: false, error: "state" });
    expect(await receiptRows(h, admin, requestId)).toMatchObject([
      { labelId: first.id, commandType: "retire" },
    ]);
    expect(await lookup(h, admin, first.value)).toEqual(unavailable);
    const next = focused(await send(h, admin, issue));
    expect(next.value).not.toBe(first.value);
    expect(next.id).not.toBe(first.id);
    expect(await lookup(h, admin, first.value)).toEqual(unavailable);
    expect(await incumbentRows(h)).toEqual(incumbent);
  } finally {
    await h.close();
  }
});

it("treats equivalent decoded carrier values as one reserved key and preserves case", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const { admin } = f;
    const equipment = await asset(h, f, "SCOPE-METER");
    const part = target("part", f.lot.itemId);
    const code = "instrument-aBc-123";
    const external = {
      type: "registerExternal",
      format: "code128",
      value: code,
      target: equipment,
    } as const;
    const label = focused(await send(h, admin, external));
    expect(label).toMatchObject({ source: "external", format: "code128", value: code });
    expect(await lookup(h, admin, `]C0${code}\r\n`)).toMatchObject({ ok: true, label });
    expect(await lookup(h, admin, code)).toMatchObject({ ok: true, label });
    const same = { ...external, format: "datamatrix", target: part } as const;
    expect(await send(h, admin, same)).toEqual(conflict);
    const different = focused(await send(h, admin, { ...same, value: code.toUpperCase() }));
    expect(await lookup(h, admin, code.toUpperCase())).toMatchObject({
      ok: true,
      label: different,
    });
    focused(await send(h, admin, { type: "retire", labelId: label.id }));
    expect(await send(h, admin, same)).toEqual(conflict);
    expect(await lookup(h, admin, code)).toEqual(unavailable);

    const gs1 = focused(
      await send(h, admin, {
        ...external,
        format: "gs1_datamatrix",
        value: "(01)09504000059118(10)lot-a(21)SN23",
      }),
    );
    expect(await lookup(h, admin, "]C1010950400005911810lot-a\u001d21SN23")).toMatchObject({
      ok: true,
      label: gs1,
    });
    expect(
      await send(h, admin, {
        ...external,
        target: part,
        format: "gs1_128",
        value: "(21)SN23(01)09504000059118(10)lot-a",
      }),
    ).toEqual(conflict);
    expect(await h.db.select().from(physicalLabels)).toHaveLength(3);
  } finally {
    await h.close();
  }
});

async function scoped(h: TestDb) {
  const f = await seedStructures(h);
  const { admin, source, remote } = f;
  const equipment = await asset(h, f, "CAL-LABEL");
  const equipmentManager = await createSourcingActor(
    h,
    admin,
    "Equipment issuer",
    source.siteId,
    "asset_manager",
  );
  const equipmentViewer = await createSourcingActor(
    h,
    admin,
    "Equipment reader",
    source.siteId,
    "asset_viewer",
  );
  const stockViewer = await createSourcingActor(
    h,
    admin,
    "Source warehouse reader",
    source.siteId,
    "warehouse_viewer",
  );
  const outsider = await createSourcingActor(
    h,
    admin,
    "Other site reader",
    remote.siteId,
    "asset_viewer",
    "warehouse_viewer",
  );
  return { f, equipment, equipmentManager, equipmentViewer, stockViewer, outsider };
}

it("checks current target grants before exposing scans, scope lists, mutations, or receipt replays", async () => {
  const h = await makeTestDb();
  try {
    const { f, equipment, equipmentManager, equipmentViewer, stockViewer, outsider } =
      await scoped(h);
    const { admin, source, lot } = f;
    const requestId = randomUUID();
    const issue = { type: "issue", target: equipment } as const;
    const equipmentLabel = focused(await send(h, equipmentManager, issue, requestId));
    const lotTarget = target("stock_position", lot.positionId);
    const lotLabel = focused(await send(h, admin, { type: "issue", target: lotTarget }));
    expect(await lookup(h, equipmentViewer, equipmentLabel.value)).toMatchObject({
      ok: true,
      label: { id: equipmentLabel.id, target: { ...equipment, canManage: false } },
    });
    expect(await lookup(h, stockViewer, lotLabel.value)).toMatchObject({
      ok: true,
      label: { id: lotLabel.id, target: { ...lotTarget, canManage: false } },
    });
    const unknown = await lookup(h, outsider, "ABSENT-LABEL");
    expect(unknown).toEqual(unavailable);
    expect(await lookup(h, outsider, equipmentLabel.value)).toEqual(unknown);
    expect(await lookup(h, outsider, lotLabel.value)).toEqual(unknown);
    expect(await lookup(h, equipmentViewer, lotLabel.value)).toEqual(unknown);
    expect(await lookup(h, stockViewer, equipmentLabel.value)).toEqual(unknown);
    const outside = value(await readLabelWorkspace(h.db, outsider, signal()));
    expect(outside.labels).toEqual([]);
    expect(outside.targets).not.toContainEqual(expect.objectContaining(equipment));
    expect(outside.targets).not.toContainEqual(expect.objectContaining(lotTarget));
    expect(await send(h, equipmentViewer, issue)).toEqual(unavailable);
    expect(await send(h, stockViewer, { type: "retire", labelId: lotLabel.id })).toEqual(
      unavailable,
    );

    await setRole(h, admin, equipmentManager, source.siteId, "asset_manager", false);
    expect(await send(h, equipmentManager, issue, requestId)).toEqual(unavailable);
    expect(await lookup(h, equipmentManager, equipmentLabel.value)).toEqual(unknown);
    expect(await receiptRows(h, equipmentManager, requestId)).toHaveLength(1);

    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin" })
      .where(eq(inventoryPartProfiles.itemId, lot.itemId));
    expect(await lookup(h, stockViewer, lotLabel.value)).toEqual(unknown);
    expect(await lookup(h, admin, lotLabel.value)).toMatchObject({ ok: true, label: lotLabel });
  } finally {
    await h.close();
  }
});

async function approveRevision(h: TestDb, f: Seed, revision: string, approvedAt: Date) {
  const { admin, parent, child } = f;
  const result = await executeReleaseMetadata(
    h.db,
    admin,
    { type: "createDraft", itemId: parent.itemId, revision },
    signal(),
  );
  assert(result.ok && result.value.releaseId !== undefined);
  const id = result.value.releaseId;
  const shared = {
    releaseId: id,
    createdBy: admin.userId,
    sizeBytes: 32,
    sha256: "a".repeat(64),
    etag: "label-test",
    state: "ready",
  } as const;
  const line = { itemId: child.itemId, sku: "CONTROL-0132", name: "Controller", quantity: 1 };
  await h.db.insert(inventoryReleaseArtifacts).values([
    {
      ...shared,
      kind: "pcbFabrication",
      name: "pcb.zip",
      objectKey: `${id}/pcb`,
      contentType: "application/zip",
    },
    {
      ...shared,
      kind: "manufacturingBom",
      name: "bom.csv",
      objectKey: `${id}/bom`,
      contentType: "text/csv",
      bomEntries: [{ sku: line.sku, quantity: line.quantity }],
    },
  ]);
  await h.db
    .update(inventoryProductReleases)
    .set({ bom: [line], status: "released", approvedBy: admin.userId, approvedAt })
    .where(eq(inventoryProductReleases.id, id));
  return target("release", id);
}

it("keeps an approved Rev A label pinned after Rev B and checks current release access", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const { admin, parent } = f;
    const first = await approveRevision(h, f, "A", new Date("2026-11-10T09:00:00.000Z"));
    const issue = { type: "issue", target: first } as const;
    const label = focused(await send(h, admin, issue));
    const second = await approveRevision(h, f, "B", new Date("2026-11-11T09:00:00.000Z"));
    expect((await findActiveRelease(h.db, parent.itemId))?.id).toBe(second.id);
    expect(await lookup(h, admin, label.value)).toMatchObject({
      ok: true,
      label: { target: first },
    });

    const reader = await actor(h, "Release approver");
    const grant = { type: "setGrant", itemId: parent.itemId, userId: reader.userId } as const;
    const unknown = await lookup(h, reader, "ABSENT-RELEASE-CODE");
    expect(unknown).toEqual(unavailable);
    expect(await lookup(h, reader, label.value)).toEqual(unknown);
    expect(
      (await executeReleaseMetadata(h.db, admin, { ...grant, role: "approver" }, signal())).ok,
    ).toBe(true);
    expect(await lookup(h, reader, label.value)).toMatchObject({
      ok: true,
      label: { id: label.id, target: { ...first, canManage: false } },
    });
    expect(await send(h, reader, issue)).toEqual(unavailable);
    expect((await executeReleaseMetadata(h.db, admin, { ...grant, role: null }, signal())).ok).toBe(
      true,
    );
    expect(await lookup(h, reader, label.value)).toEqual(unknown);
  } finally {
    await h.close();
  }
});

async function transferSerial(h: TestDb, { admin, parent, source, remote }: Seed) {
  const { id } = value(
    await warehouse(h, admin, {
      type: "createTransfer",
      sourceLocationId: source.locationId,
      destinationLocationId: remote.locationId,
      reason: "Move this labeled serial to the remote bin",
      lines: [{ positionId: parent.positionId, quantity: 1 }],
    }),
  );
  const current = async () => {
    const { rows } = value(await readWarehouseTransfers(h.db, admin, {}, signal()));
    const order = rows.find((row) => row.id === id);
    assert(order !== undefined);
    return order;
  };
  value(
    await warehouse(h, admin, {
      type: "dispatchTransfer",
      id,
      version: (await current()).version,
      reason: "The carrier picked up this serial",
    }),
  );
  const dispatched = await current();
  const line = dispatched.lines[0];
  assert(line !== undefined);
  value(
    await warehouse(h, admin, {
      type: "receiveTransfer",
      id,
      version: dispatched.version,
      reason: "Remote warehouse checked in this serial",
      lines: [{ lineId: line.id, quantity: 1 }],
    }),
  );
}

it("follows an exact serialized position through transfer but keeps bulk labels on the original row", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const { admin, parent, lot, source, remote, orderId } = f;
    const stockFrom = await createSourcingActor(
      h,
      admin,
      "Origin warehouse team",
      source.siteId,
      "warehouse_viewer",
    );
    const stockTo = await createSourcingActor(
      h,
      admin,
      "Destination warehouse team",
      remote.siteId,
      "warehouse_viewer",
    );
    const serial = target("stock_position", parent.positionId);
    const serialLabel = focused(await send(h, admin, { type: "issue", target: serial }));
    expect(await lookup(h, stockFrom, serialLabel.value)).toMatchObject({
      ok: true,
      label: { target: serial },
    });
    expect(await lookup(h, stockTo, serialLabel.value)).toEqual(unavailable);
    await transferSerial(h, f);
    expect(await position(h, parent.positionId)).toMatchObject({
      siteId: remote.siteId,
      locationId: remote.locationId,
      serial: "PARENT-001",
    });
    expect(await lookup(h, stockFrom, serialLabel.value)).toEqual(unavailable);
    expect(await lookup(h, stockTo, serialLabel.value)).toMatchObject({
      ok: true,
      label: { id: serialLabel.id, target: serial },
    });

    const bulk = target("stock_position", lot.positionId);
    const bulkLabel = focused(await send(h, admin, { type: "issue", target: bulk }));
    value(
      await warehouse(h, admin, {
        type: "splitStock",
        sourcePositionId: lot.positionId,
        locationId: source.locationId,
        quantity: 2,
        reason: "Split two free pieces out of the labeled lot",
      }),
    );
    expect(await lookup(h, stockFrom, bulkLabel.value)).toMatchObject({
      ok: true,
      label: { id: bulkLabel.id, target: bulk },
    });
    expect(await position(h, lot.positionId)).toMatchObject({ onHand: 8, reserved: 4 });
    expect(await h.db.select().from(inventoryStockAllocations)).toMatchObject([
      { positionId: lot.positionId, orderId, quantity: 4 },
    ]);
  } finally {
    await h.close();
  }
});

it("protects stored identity and receipts while erasing a deleted issuer's actor reference", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const who = await actor(h, "Disposable label issuer", true);
    const first = target("part", f.lot.itemId);
    const requestId = randomUUID();
    const label = focused(await send(h, who, { type: "issue", target: first }, requestId));
    const scopedLabel = eq(physicalLabels.id, label.id);
    const scopedReceipt = eq(physicalLabelReceipts.requestId, requestId);
    await expect(
      h.db
        .update(physicalLabels)
        .set({ itemId: f.child.itemId, targetId: f.child.itemId })
        .where(scopedLabel),
    ).rejects.toThrow();
    await expect(h.db.delete(physicalLabels).where(scopedLabel)).rejects.toThrow();
    await expect(h.db.delete(physicalLabelReceipts).where(scopedReceipt)).rejects.toThrow();
    const retired = focused(await send(h, who, { type: "retire", labelId: label.id }));
    await expect(
      h.db.update(physicalLabels).set({ retiredAt: null, retiredBy: null }).where(scopedLabel),
    ).rejects.toThrow();
    await h.db.delete(sessions).where(eq(sessions.id, who.sessionId));
    await h.db.delete(users).where(eq(users.id, who.userId));
    expect(await h.db.select().from(physicalLabels).where(scopedLabel)).toMatchObject([
      {
        id: label.id,
        targetId: first.id,
        retiredAt: new Date(retired.retiredAt ?? ""),
        createdBy: null,
        retiredBy: null,
      },
    ]);
    expect(await h.db.select().from(physicalLabelReceipts).where(scopedReceipt)).toMatchObject([
      { actorId: null, labelId: label.id, requestId },
    ]);
  } finally {
    await h.close();
  }
});
