import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { env } from "@/config/env";
import { users } from "@/db/schema/identity";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { createSourcingActor, setRole } from "@/features/inventory/sourcing/sourcing.test-helpers";
import {
  actor,
  seedStructures,
  signal,
  value,
} from "@/features/inventory/warehouse/operations/structures.test-helpers";
import { physicalLabels } from "@/features/physical-labels/schema";
import { resolveLabel, runLabelCommand } from "@/features/physical-labels/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { runKitCommand } from "../kits/service";
import { runAssetCommand } from "../service";
import type {
  AssetTagCommand,
  AssetTagResult,
  AssetTagScanInput,
  AssetTagTargetRef,
  AssetTagWorkspace,
} from "./contracts";
import {
  assetTagAssignments,
  assetTagBatches,
  assetTagCodes,
  assetTagOwnerMessages,
  assetTagReceipts,
  assetTagScans,
} from "./schema";
import {
  readAssetTagPublic,
  readAssetTagWorkspace,
  resolveAssetTag,
  resolveAssetTagFromLabelScan,
  runAssetTagCommand,
  sendAssetTagContact,
} from "./service";
import { assetTagLink, assetTagText, isAssetTagToken } from "./tagCodes";

type Intent<T = AssetTagCommand> = T extends AssetTagCommand ? Omit<T, "requestId"> : never;
type Seed = Awaited<ReturnType<typeof seedStructures>>;
type Endpoint = Seed["source"];
const origin = "https://equipment.example.test";
const unavailable = { ok: false, error: "unavailable" } as const;
const conflict = { ok: false, error: "conflict" } as const;
const state = { ok: false, error: "state" } as const;
const invalid = { ok: false, error: "invalid" } as const;

function found<T>(result: T | undefined | null): T {
  assert(result !== undefined && result !== null);
  return result;
}

function tagsOk(result: AssetTagResult) {
  assert(result.ok);
  return result;
}

function tag(workspace: AssetTagWorkspace, tagId: string) {
  return found(workspace.tags.find(({ id }) => id === tagId));
}

function send(h: TestDb, who: NativeSessionRef, intent: Intent, requestId = randomUUID()) {
  return runAssetTagCommand(h.db, who, { ...intent, requestId }, signal());
}

function read(h: TestDb, who: NativeSessionRef) {
  return readAssetTagWorkspace(h.db, who, signal());
}

function scan(
  h: TestDb,
  who: NativeSessionRef,
  identifier: string,
  overrides?: Partial<Pick<AssetTagScanInput, "source" | "coordinates">>,
) {
  return resolveAssetTag(
    h.db,
    who,
    { identifier, source: "manual", coordinates: null, ...overrides },
    origin,
    signal(),
  );
}

function makeBatch(siteId: string, count: number) {
  return { type: "createBatch", siteId, count, title: "Instrument workshop labels" } as const;
}

async function issueTags(h: TestDb, who: NativeSessionRef, siteId: string, count: number) {
  const issued = tagsOk(await send(h, who, makeBatch(siteId, count)));
  return issued.value.tags.filter(({ batchId }) => batchId === issued.batchId);
}

async function createAsset(h: TestDb, admin: NativeSessionRef, bin: Endpoint, code: string) {
  const result = await runAssetCommand(
    h.db,
    admin,
    {
      ...bin,
      type: "create",
      requestId: randomUUID(),
      code,
      name: code,
      description: null,
      categoryId: null,
      tags: [],
      fieldValues: {},
      tracking: "individual",
      serial: code,
      modelId: null,
      openingQuantity: 0,
    },
    signal(),
  );
  assert(result.ok && result.focusId !== null);
  return { kind: "asset", id: result.focusId } as const;
}

async function createKit(h: TestDb, admin: NativeSessionRef, bin: Endpoint, code: string) {
  const result = await runKitCommand(
    h.db,
    admin,
    {
      ...bin,
      type: "saveKit",
      requestId: randomUUID(),
      kitId: null,
      version: null,
      code,
      name: code,
      lines: [],
      note: null,
    },
    signal(),
  );
  assert(result.ok);
  return { kind: "kit", id: result.kitId } as const;
}

async function claim(h: TestDb, who: NativeSessionRef, tagId: string, target: AssetTagTargetRef) {
  const result = tagsOk(await send(h, who, { type: "claim", tagId, target }));
  return found(tag(result.value, tagId).assignment);
}

async function grantSiteActors(h: TestDb, { admin, source, remote }: Seed) {
  const manager = await createSourcingActor(
    h,
    admin,
    "Tag site manager",
    source.siteId,
    "asset_manager",
  );
  const viewer = await createSourcingActor(
    h,
    admin,
    "Tag site viewer",
    source.siteId,
    "asset_viewer",
  );
  const foreign = await createSourcingActor(
    h,
    admin,
    "Other site manager",
    remote.siteId,
    "asset_manager",
  );
  const guest = await actor(h, "Project guest");
  await h.db.update(users).set({ projectsGuestOnly: true }).where(eq(users.id, guest.userId));
  return { manager, viewer, foreign, guest };
}

it("issues exactly one replay-safe batch of one hundred and enforces current site authority", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const { admin, source, remote } = f;
    const { manager, viewer, foreign, guest } = await grantSiteActors(h, f);
    const draft = makeBatch(source.siteId, 100);
    const requestId = randomUUID();
    const [first, replay] = await Promise.all([
      send(h, manager, draft, requestId),
      send(h, manager, draft, requestId),
    ]);
    const issued = tagsOk(first);
    expect(tagsOk(replay).batchId).toBe(issued.batchId);
    const batchId = found(issued.batchId);
    expect(issued.value.batches).toMatchObject([
      { id: batchId, siteId: source.siteId, source: "printed" },
    ]);
    const rows = await h.db.select().from(assetTagCodes).where(eq(assetTagCodes.batchId, batchId));
    expect(rows.map(({ ordinal }) => ordinal).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    expect(rows.every(({ token, legacyId }) => isAssetTagToken(token) && legacyId === null)).toBe(
      true,
    );
    expect(new Set(rows.map(({ token }) => token)).size).toBe(100);
    expect(await h.db.select().from(assetTagReceipts)).toMatchObject([
      { actorId: manager.userId, requestId, batchId, commandType: "createBatch", tagId: null },
    ]);
    expect(await send(h, manager, { ...draft, count: 99 }, requestId)).toEqual(conflict);
    expect(await send(h, viewer, draft)).toEqual(unavailable);
    expect(await send(h, manager, makeBatch(remote.siteId, 1))).toEqual(unavailable);
    expect(await send(h, foreign, draft)).toEqual(unavailable);
    expect(await send(h, guest, draft)).toEqual(unavailable);
    expect(await read(h, guest)).toEqual(unavailable);
    expect(value(await read(h, viewer)).tags).toEqual([]);
    expect(value(await read(h, foreign)).batches).toEqual([]);
    await setRole(h, admin, manager, source.siteId, "asset_manager", false);
    expect(await send(h, manager, draft, requestId)).toEqual(unavailable);
    expect(await h.db.select().from(assetTagBatches)).toHaveLength(1);
  } finally {
    await h.close();
  }
});

it("swaps tags between exact assignment epochs, preserves historical targets and admits coordinates once", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const { admin, source, remote } = f;
    const { manager, viewer, foreign, guest } = await grantSiteActors(h, f);
    const meter = await createAsset(h, admin, source, "METER-S04");
    const otherSite = await createAsset(h, admin, remote, "REMOTE-S04");
    const instruments = await createKit(h, admin, source, "KIT-S04");
    const [oldTag, replacement] = await issueTags(h, manager, source.siteId, 2);
    assert(oldTag !== undefined && replacement !== undefined);
    const oldCode = assetTagText(oldTag.token);
    expect(await scan(h, manager, oldCode)).toEqual(unavailable);
    expect(await send(h, viewer, { type: "claim", tagId: oldTag.id, target: meter })).toEqual(
      unavailable,
    );
    expect(await send(h, manager, { type: "claim", tagId: oldTag.id, target: otherSite })).toEqual(
      unavailable,
    );

    const initial = await claim(h, manager, oldTag.id, meter);
    expect(await send(h, manager, { type: "claim", tagId: replacement.id, target: meter })).toEqual(
      conflict,
    );
    expect(await scan(h, guest, oldCode)).toEqual(unavailable);
    expect(await scan(h, foreign, oldCode)).toEqual(await scan(h, foreign, "unrecognized"));
    const link = found(assetTagLink(origin, oldTag.token));
    expect(await scan(h, viewer, link)).toMatchObject({
      ok: true,
      tagId: oldTag.id,
      assignmentId: initial.id,
      target: { ...meter, canManage: false },
    });
    const coordinates = { latitude: 52.5, longitude: 13.4, accuracy: 10 };
    await Promise.all([
      scan(h, viewer, oldCode, { source: "camera", coordinates }),
      scan(h, viewer, oldCode),
    ]);
    await scan(h, viewer, oldCode, {
      source: "camera",
      coordinates: { ...coordinates, accuracy: 100 },
    });
    const scans = await h.db.select().from(assetTagScans);
    expect(scans).toMatchObject([
      { assignmentId: initial.id, actorId: viewer.userId, source: "manual", ...coordinates },
    ]);
    expect(value(await read(h, viewer)).scans).toMatchObject([{ coordinates: null }]);
    expect(value(await read(h, manager)).scans).toMatchObject([{ coordinates }]);
    expect(
      await scan(h, viewer, oldCode, { coordinates: { ...coordinates, longitude: 181 } }),
    ).toEqual(invalid);
    const scanRow = found(scans[0]);
    await expect(
      h.db.update(assetTagScans).set({ latitude: 45 }).where(eq(assetTagScans.id, scanRow.id)),
    ).rejects.toThrow();

    const swap = {
      type: "swap",
      tagId: replacement.id,
      previousTagId: oldTag.id,
      assignmentId: initial.id,
    } as const;
    const changed = tagsOk(await send(h, manager, swap));
    expect(tag(changed.value, oldTag.id).assignment).toBeNull();
    const moved = found(tag(changed.value, replacement.id).assignment);
    expect(moved).toMatchObject({ target: meter, ownerContact: false });
    expect(await scan(h, manager, oldCode)).toEqual(unavailable);
    expect(await scan(h, manager, replacement.token, { source: "printed_link" })).toMatchObject({
      ok: true,
      assignmentId: moved.id,
      target: meter,
    });

    const recovered = await claim(h, manager, oldTag.id, instruments);
    expect(recovered.id).not.toBe(initial.id);
    expect(await scan(h, manager, oldCode)).toMatchObject({
      ok: true,
      tagId: oldTag.id,
      assignmentId: recovered.id,
      target: instruments,
    });
    expect(
      await send(h, manager, { type: "unlink", tagId: oldTag.id, assignmentId: initial.id }),
    ).toEqual(state);
    tagsOk(
      await send(h, manager, { type: "unlink", tagId: oldTag.id, assignmentId: recovered.id }),
    );
    expect(await scan(h, manager, oldCode)).toEqual(unavailable);
    const history = value(await read(h, manager));
    expect(history.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagId: oldTag.id,
          assignmentId: initial.id,
          target: meter,
          kind: "unlink",
        }),
        expect.objectContaining({
          tagId: replacement.id,
          assignmentId: moved.id,
          target: meter,
          kind: "swap",
        }),
        expect.objectContaining({
          tagId: oldTag.id,
          assignmentId: recovered.id,
          target: instruments,
          kind: "unlink",
        }),
      ]),
    );
    expect(await h.db.select().from(assetTagAssignments)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: initial.id,
          assetId: meter.id,
          kitId: null,
          endedAt: expect.any(Date),
        }),
        expect.objectContaining({
          id: recovered.id,
          assetId: null,
          kitId: instruments.id,
          endedAt: expect.any(Date),
        }),
      ]),
    );
  } finally {
    await h.close();
  }
});

it("validates exact legacy aliases and preserves issued codes across both tag and label registries", async () => {
  const h = await makeTestDb();
  try {
    const { admin, source, remote, parent } = await seedStructures(h);
    const localAsset = await createAsset(h, admin, source, "LEGACY-METER");
    const spareAsset = await createAsset(h, admin, source, "SPARE-METER");
    const wrongSite = await createAsset(h, admin, remote, "FOREIGN-METER");
    const localKit = await createKit(h, admin, source, "LEGACY-KIT");
    const unclaimed = found((await issueTags(h, admin, source.siteId, 1))[0]);
    const oldOrigin = "https://legacy-shelf.example.test:8433";
    const alternateOrigin = "https://different-shelf.example.test";
    const id = "shelf9d2tg";
    const otherId = "other3a7bc";
    const imported = (
      approvedLegacyOrigin: string | null,
      entries: { identifier: string; target: AssetTagTargetRef }[],
    ) =>
      ({
        type: "importLegacy",
        siteId: source.siteId,
        title: "Legacy equipment labels",
        approvedLegacyOrigin,
        entries,
      }) as const;
    const first = imported(oldOrigin, [
      { identifier: `${oldOrigin}/qr/${id}`, target: localAsset },
    ]);
    const requestId = randomUUID();
    const result = tagsOk(await send(h, admin, first, requestId));
    expect(tagsOk(await send(h, admin, first, requestId)).batchId).toBe(result.batchId);
    const importedTag = found(result.value.tags.find((entry) => entry.batchId === result.batchId));
    expect(importedTag.legacy).toEqual({ id, origin: oldOrigin });
    tagsOk(
      await send(
        h,
        admin,
        imported(alternateOrigin, [
          { identifier: `${alternateOrigin}/qr/${otherId}`, target: localKit },
        ]),
      ),
    );
    for (const candidate of [id, `https://eam.sh/${id}`, `${oldOrigin}/qr/${id}`]) {
      expect(await scan(h, admin, candidate)).toMatchObject({
        ok: true,
        tagId: importedTag.id,
        target: localAsset,
      });
    }
    expect(await scan(h, admin, `${alternateOrigin}/qr/${id}`)).toEqual(unavailable);
    expect(
      await resolveAssetTagFromLabelScan(h.db, admin, { value: id }, origin, signal()),
    ).toMatchObject({
      ok: true,
      label: { id: importedTag.id, target: localAsset, value: assetTagText(importedTag.token) },
    });
    expect(await send(h, admin, imported(null, [{ identifier: id, target: spareAsset }]))).toEqual(
      conflict,
    );
    expect(
      await send(h, admin, imported(null, [{ identifier: "unused8xy1", target: wrongSite }])),
    ).toEqual(unavailable);

    const olderAlias = "prior8tag1";
    const external = (value: string) =>
      runLabelCommand(
        h.db,
        admin,
        {
          type: "registerExternal",
          requestId: randomUUID(),
          target: { kind: "part", id: parent.itemId },
          format: "code128",
          value,
        },
        signal(),
      );
    expect((await external(olderAlias)).ok).toBe(true);
    expect(
      await send(
        h,
        admin,
        imported(null, [{ identifier: `https://eam.sh/${olderAlias}`, target: spareAsset }]),
      ),
    ).toEqual(conflict);
    expect(await external(id)).toEqual(conflict);
    expect(await external(assetTagText(unclaimed.token))).toEqual(invalid);
    expect(await resolveLabel(h.db, admin, { value: olderAlias }, origin, signal())).toMatchObject({
      ok: true,
      label: { value: olderAlias, target: { kind: "part", id: parent.itemId } },
    });
    expect(await h.db.select().from(physicalLabels)).toHaveLength(1);
    expect(await h.db.select().from(assetTagBatches)).toHaveLength(3);
    expect(await h.db.select().from(assetTagCodes)).toHaveLength(3);
  } finally {
    await h.close();
  }
});

it("pins anonymous inbox submissions to the displayed assignment and marks a scoped message read once", async () => {
  const h = await makeTestDb();
  const previousSecret = env.AUTH_SECRET;
  env.AUTH_SECRET = "equipment-tag-native-test-signing-secret";
  try {
    const f = await seedStructures(h);
    const { admin, source } = f;
    const { manager, viewer, foreign } = await grantSiteActors(h, f);
    const meter = await createAsset(h, admin, source, "OPT-IN-METER");
    const second = await createAsset(h, admin, source, "OPT-IN-SPARE");
    const issued = found((await issueTags(h, manager, source.siteId, 1))[0]);
    const original = await claim(h, manager, issued.id, meter);
    const publicContact = () => readAssetTagPublic(h.db, issued.token, signal());
    const optIn = (assignmentId: string) =>
      send(h, manager, {
        type: "setOwnerContact",
        tagId: issued.id,
        assignmentId,
        enabled: true,
      }).then(tagsOk);
    const submit = (
      input: { requestId: string; token: string; replyTo: string; message: string },
      proof: string,
    ) => sendAssetTagContact(h.db, input, proof, "203.0.113.9", signal());

    expect(await publicContact()).toBeNull();
    await optIn(original.id);
    const before = found(await publicContact());
    expect(Object.keys(before)).toEqual(["proof"]);
    const originalMessage = {
      requestId: randomUUID(),
      token: issued.token,
      replyTo: "finder@example.test",
      message: "The meter is at reception.",
    };
    expect(await submit(originalMessage, before.proof)).toEqual({ ok: true });
    expect(await submit(originalMessage, before.proof)).toEqual({ ok: true });
    expect(
      await submit({ ...originalMessage, message: "A different submission" }, before.proof),
    ).toEqual(unavailable);
    expect(value(await read(h, viewer)).messages).toEqual([]);
    expect(value(await read(h, foreign)).messages).toEqual([]);
    const saved = found(value(await read(h, manager)).messages[0]);
    expect(saved).toMatchObject({
      tagId: issued.id,
      assignmentId: original.id,
      message: originalMessage.message,
      readAt: null,
    });

    const mark = { type: "markMessageRead", messageId: saved.id } as const;
    expect(await send(h, viewer, mark)).toEqual(unavailable);
    expect(await send(h, foreign, mark)).toEqual(unavailable);
    const readRequest = randomUUID();
    const marked = tagsOk(await send(h, manager, mark, readRequest));
    const readAt = found(marked.value.messages.find(({ id }) => id === saved.id)).readAt;
    expect(readAt).not.toBeNull();
    expect(tagsOk(await send(h, manager, mark, readRequest)).value.messages[0]?.readAt).toBe(
      readAt,
    );
    expect(tagsOk(await send(h, manager, mark)).value.messages[0]?.readAt).toBe(readAt);

    tagsOk(await send(h, manager, { type: "unlink", tagId: issued.id, assignmentId: original.id }));
    const after = await claim(h, manager, issued.id, second);
    expect(await publicContact()).toBeNull();
    await optIn(after.id);
    const current = found(await publicContact());
    const newMessage = {
      ...originalMessage,
      requestId: randomUUID(),
      message: "The spare is at receiving.",
    };
    expect(await submit(newMessage, before.proof)).toEqual(unavailable);
    expect(await submit(newMessage, current.proof)).toEqual({ ok: true });
    expect(await h.db.select().from(assetTagOwnerMessages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: original.id,
          message: originalMessage.message,
          readAt: expect.any(Date),
        }),
        expect.objectContaining({
          assignmentId: after.id,
          message: newMessage.message,
          readAt: null,
        }),
      ]),
    );
    expect(await h.db.select().from(assetTagOwnerMessages)).toHaveLength(2);
  } finally {
    env.AUTH_SECRET = previousSecret;
    await h.close();
  }
});
