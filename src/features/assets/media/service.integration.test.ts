import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import { actor, signal } from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { directoryLocations, directorySites } from "@/features/locations/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import type { AssetIntent } from "../contracts";
import { assetRecords } from "../schema";
import { runAssetCommand } from "../service";
import type { AssetMediaTarget } from "./contracts";
import { assetMediaEvents, assetMediaReceipts, assetMediaTargets } from "./schema";
import {
  readAssetMediaFile,
  readAssetMediaWorkspace,
  selectAssetMediaCover,
  uploadAssetMediaFile,
} from "./service";
import { type AssetMediaFileView, assetMediaPath } from "./transport";

const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const invalid = { ok: false, error: "invalid" } as const;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWOQM+KSM+JigFAACjYBaTqdoIAAAAAASUVORK5CYII=",
  "base64",
);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

function accepted<T extends { ok: true } | { ok: false }>(result: T): Extract<T, { ok: true }> {
  assert(result.ok, JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

async function register(db: Db, user: NativeSessionRef, input: AssetIntent) {
  return accepted(await runAssetCommand(db, user, { ...input, requestId: randomUUID() }, signal()));
}

function workspace(db: Db, user: NativeSessionRef, target: AssetMediaTarget) {
  return readAssetMediaWorkspace(db, user, target, signal());
}

function uploadInput(
  user: NativeSessionRef,
  target: AssetMediaTarget,
  version: number,
  kind: "photo" | "document",
  name: string,
) {
  return {
    target,
    version,
    requestId: randomUUID(),
    kind,
    name,
    expectedActorId: user.userId,
    bytes: kind === "photo" ? png : pdf,
    mime: kind === "photo" ? "image/png" : "application/pdf",
  };
}

function file(
  db: Db,
  user: NativeSessionRef,
  target: AssetMediaTarget,
  fileId: string,
  view: AssetMediaFileView,
  storage: FakeStorageClient,
) {
  return readAssetMediaFile(db, user, { target, fileId, view }, signal(), storage);
}

async function setup(h: TestDb) {
  const { db } = h;
  const admin = await actor(h, "Media test administrator", true);
  const siteId = randomUUID();
  const remote = randomUUID();
  const bin = randomUUID();
  await db.insert(directorySites).values([
    { id: siteId, code: "EQUIPMENT", name: "Equipment site" },
    { id: remote, code: "REMOTE", name: "Other site" },
  ]);
  await db
    .insert(directoryLocations)
    .values({ id: bin, siteId, code: "LAB", name: "Instrumentation lab" });
  const manager = await createSourcingActor(h, admin, "Equipment manager", siteId, "asset_manager");
  const viewer = await createSourcingActor(h, admin, "Equipment viewer", siteId, "asset_viewer");
  const warehouse = await createSourcingActor(
    h,
    admin,
    "Warehouse-only operator",
    siteId,
    "warehouse_manager",
  );
  const foreign = await createSourcingActor(
    h,
    admin,
    "Other site manager",
    remote,
    "asset_manager",
  );

  const saved = await register(db, manager, {
    type: "saveModel",
    siteId,
    modelId: null,
    version: null,
    code: "PRECISION",
    name: "Precision meter",
    description: "Bench equipment",
    categoryId: null,
    tags: [],
    fieldValues: {},
  });
  const template = saved.value.models.find(
    (model) => model.siteId === siteId && model.code === "PRECISION",
  );
  assert(template !== undefined);
  const model: AssetMediaTarget = { type: "model", id: template.id };
  const fleet = await register(db, manager, {
    type: "createFleet",
    siteId,
    modelId: template.id,
    locationId: bin,
    units: [
      { code: "UNIT-A", serial: "SERIAL-A" },
      { code: "UNIT-B", serial: "SERIAL-B" },
    ],
  });
  const first = fleet.value.records.find(({ code }) => code === "UNIT-A");
  const second = fleet.value.records.find(({ code }) => code === "UNIT-B");
  assert(first !== undefined && second !== undefined);
  return {
    db,
    admin,
    manager,
    viewer,
    warehouse,
    foreign,
    siteId,
    model,
    first,
    second,
    asset: { type: "asset", id: first.id } satisfies AssetMediaTarget,
    sibling: { type: "asset", id: second.id } satisfies AssetMediaTarget,
    storage: new FakeStorageClient(),
  };
}

it("inherits a model photo and keeps scoped files and revisions through archive and reinstatement", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { db, manager, viewer, model, asset, sibling, storage } = f;
    const modelUpload = uploadInput(manager, model, 0, "photo", "Fleet cover.png");
    const covered = accepted(
      await uploadAssetMediaFile(db, manager, modelUpload, signal(), storage),
    ).value;
    const modelPhoto = covered.files[0];
    assert(modelPhoto !== undefined);
    expect(covered).toMatchObject({ version: 1, coverId: modelPhoto.id });
    expect(modelPhoto.previewHref).toBe(assetMediaPath(model, modelPhoto.id, "preview"));
    for (const target of [asset, sibling]) {
      const inherited = accepted(await workspace(db, viewer, target)).value;
      expect(inherited).toMatchObject({
        version: 0,
        coverId: null,
        inheritedCover: modelPhoto,
        canManage: false,
      });
    }

    const ownUpload = uploadInput(manager, asset, 0, "photo", "Individual meter.png");
    const withOwn = accepted(
      await uploadAssetMediaFile(db, manager, ownUpload, signal(), storage),
    ).value;
    const own = withOwn.files[0];
    assert(own !== undefined && own.kind === "photo");
    expect(withOwn).toMatchObject({ version: 1, coverId: own.id, inheritedCover: modelPhoto });
    expect(await workspace(db, viewer, sibling)).toMatchObject({
      ok: true,
      value: { version: 0, coverId: null, inheritedCover: modelPhoto },
    });
    const certificate = uploadInput(manager, asset, 1, "document", "Calibration.pdf");
    const supporting = accepted(
      await uploadAssetMediaFile(db, manager, certificate, signal(), storage),
    ).value;
    const attachment = supporting.files.find(({ kind }) => kind === "document");
    assert(attachment !== undefined);
    expect(attachment.previewHref).toBeNull();
    expect(supporting).toMatchObject({ version: 2, coverId: own.id });
    expect(
      await uploadAssetMediaFile(
        db,
        manager,
        { ...certificate, target: model, requestId: randomUUID() },
        signal(),
        storage,
      ),
    ).toEqual(invalid);
    expect(
      await selectAssetMediaCover(
        db,
        manager,
        { target: asset, version: 2, requestId: randomUUID(), fileId: attachment.id },
        signal(),
      ),
    ).toEqual(invalid);
    const cleared = accepted(
      await selectAssetMediaCover(
        db,
        manager,
        {
          target: asset,
          version: 2,
          requestId: randomUUID(),
          fileId: null,
        },
        signal(),
      ),
    ).value;
    expect(cleared).toMatchObject({
      version: 3,
      coverId: null,
      inheritedCover: modelPhoto,
      files: supporting.files,
    });
    const restoredCover = accepted(
      await selectAssetMediaCover(
        db,
        manager,
        {
          target: asset,
          version: 3,
          requestId: randomUUID(),
          fileId: own.id,
        },
        signal(),
      ),
    ).value;
    expect(restoredCover).toMatchObject({ version: 4, coverId: own.id, files: supporting.files });
    expect(restoredCover.history.map(({ type }) => type)).toEqual([
      "cover_changed",
      "cover_changed",
      "uploaded",
      "uploaded",
    ]);

    expect(
      accepted(await uploadAssetMediaFile(db, manager, ownUpload, signal(), storage)).value,
    ).toEqual(restoredCover);
    expect(
      await uploadAssetMediaFile(
        db,
        manager,
        { ...ownUpload, name: "Changed.png" },
        signal(),
        storage,
      ),
    ).toEqual(conflict);
    expect(
      await uploadAssetMediaFile(db, manager, { ...ownUpload, target: sibling }, signal(), storage),
    ).toEqual(conflict);
    expect(storage.objectsByKey.size).toBe(3);
    expect(await file(db, viewer, sibling, own.id, "download", storage)).toEqual(unavailable);
    expect(await file(db, viewer, asset, modelPhoto.id, "preview", storage)).toEqual(unavailable);
    expect(await file(db, viewer, asset, attachment.id, "preview", storage)).toEqual(unavailable);
    expect(
      accepted(await file(db, viewer, asset, attachment.id, "download", storage)).value.bytes,
    ).toEqual(pdf);
    for (const excluded of [f.warehouse, f.foreign]) {
      expect(await workspace(db, excluded, asset)).toEqual(unavailable);
      expect(await file(db, excluded, model, modelPhoto.id, "preview", storage)).toEqual(
        unavailable,
      );
    }
    expect(
      await uploadAssetMediaFile(
        db,
        viewer,
        uploadInput(viewer, asset, 4, "photo", "Denied.png"),
        signal(),
        storage,
      ),
    ).toEqual(unavailable);

    const archived = accepted(
      await runAssetCommand(
        db,
        manager,
        {
          type: "setArchive",
          assetId: f.first.id,
          version: f.first.version,
          archived: true,
          reason: "Remove meter from active inventory",
          requestId: randomUUID(),
        },
        signal(),
      ),
    );
    const historical = archived.value.records.find(({ id }) => id === asset.id);
    assert(historical !== undefined);
    expect(accepted(await workspace(db, viewer, asset)).value).toEqual({
      ...restoredCover,
      canManage: false,
    });
    expect(accepted(await file(db, viewer, asset, own.id, "preview", storage)).value.bytes).toEqual(
      png,
    );
    expect(
      await uploadAssetMediaFile(
        db,
        manager,
        uploadInput(manager, asset, 4, "photo", "Archived.png"),
        signal(),
        storage,
      ),
    ).toEqual(unavailable);
    const reinstated = await register(db, manager, {
      type: "setArchive",
      assetId: historical.id,
      version: historical.version,
      archived: false,
      reason: "Return meter to the bench",
    });
    expect(reinstated.value.records.find(({ id }) => id === asset.id)).toMatchObject({
      id: f.first.id,
      version: f.first.version + 2,
      modelId: model.id,
      archivedAt: null,
    });
    expect(accepted(await workspace(db, manager, asset)).value).toEqual(restoredCover);

    const [stored] = await db
      .select()
      .from(assetMediaEvents)
      .where(eq(assetMediaEvents.id, own.id));
    assert(stored !== undefined && stored.objectKey !== null);
    expect(stored.sha256).toBe(createHash("sha256").update(png).digest("hex"));
    storage.objectBytes.set(stored.objectKey, Buffer.alloc(png.length));
    expect(await file(db, viewer, asset, own.id, "preview", storage)).toEqual(unavailable);
    storage.objectBytes.set(stored.objectKey, png);
    await expect(
      db
        .update(assetMediaEvents)
        .set({ name: "Rewrite.png" })
        .where(eq(assetMediaEvents.id, own.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.delete(assetMediaReceipts).where(eq(assetMediaReceipts.eventId, own.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await setRole(h, f.admin, viewer, f.siteId, "asset_viewer", false);
    expect(await workspace(db, viewer, asset)).toEqual(unavailable);
    expect(await file(db, viewer, asset, own.id, "download", storage)).toEqual(unavailable);
  } finally {
    await h.close();
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

it("serializes equal-revision uploads and removes only the losing private object", async () => {
  const h = await makeTestDb();
  try {
    const f = await setup(h);
    const { db, manager, asset, storage } = f;
    const gate = deferred();
    const keys: string[] = [];
    const original = storage.putObjectBytes.bind(storage);
    vi.spyOn(storage, "putObjectBytes").mockImplementation(
      async (key, bytes, mime, requestSignal) => {
        keys.push(key);
        await gate.promise;
        return original(key, bytes, mime, requestSignal);
      },
    );
    const pending = Promise.all(
      ["Attempt A.png", "Attempt B.png"].map((name) =>
        uploadAssetMediaFile(
          db,
          manager,
          uploadInput(manager, asset, 0, "photo", name),
          signal(),
          storage,
        ),
      ),
    );
    try {
      await vi.waitFor(() => expect(keys).toHaveLength(2));
    } finally {
      gate.resolve();
    }
    const outcomes = await pending;
    expect(outcomes.filter(({ ok }) => ok)).toHaveLength(1);
    expect(outcomes.find(({ ok }) => !ok)).toEqual(conflict);
    const [registered] = await db.select().from(assetRecords).where(eq(assetRecords.id, asset.id));
    expect(registered?.version).toBe(f.first.version);
    const [winner] = await db.select().from(assetMediaEvents);
    assert(winner !== undefined && winner.objectKey !== null);
    expect(keys).toContain(winner.objectKey);
    expect(storage.deletedKeys).toEqual(keys.filter((key) => key !== winner.objectKey));
    expect([...storage.objectsByKey.keys()]).toEqual([winner.objectKey]);
    const [state] = await db
      .select()
      .from(assetMediaTargets)
      .where(eq(assetMediaTargets.assetId, asset.id));
    assert(state !== undefined);
    expect(state.version).toBe(1);
    expect(await db.select().from(assetMediaReceipts)).toHaveLength(1);
    expect(accepted(await workspace(db, manager, asset)).value).toMatchObject({
      version: 1,
      coverId: winner.id,
      files: [{ id: winner.id }],
    });
    await expect(
      db.update(assetMediaTargets).set({ version: 2 }).where(eq(assetMediaTargets.id, state.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally {
    await h.close();
  }
});
