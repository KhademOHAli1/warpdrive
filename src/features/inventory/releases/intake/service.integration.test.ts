import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sessions, users } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryItems } from "../../schema";
import { confirmReleaseArtifactUpload, requestReleaseArtifactUpload } from "../artifacts";
import { inventoryProductReleases, inventoryReleaseArtifacts } from "../schema";
import { executeReleaseMetadata } from "../service";
import type {
  ExportIntakeBinding,
  ExportIntakeKind,
  ExportManifest,
  PreparedExportIntake,
} from "./contracts";
import { inventoryExportJobs, inventoryExportRequests } from "./schema";
import {
  prepareExportIntake,
  queueExportIntake,
  readExportIntakeJobs,
  retryExportIntake,
} from "./service";
import { processReleaseExportJobs } from "./worker";

let fixture: TestDb;
const signal = () => AbortSignal.timeout(15_000);

beforeAll(async () => {
  fixture = await makeTestDb();
});
afterAll(async () => {
  await fixture.close();
});

function value<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return result.value;
}

function staging(prepared: PreparedExportIntake) {
  expect(prepared.state).toBe("staging");
  if (prepared.state !== "staging") throw new Error("Expected uploader forms");
  return prepared;
}

async function staff(name: string, isAdmin = false) {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await fixture.db
    .insert(users)
    .values({ id: userId, name, email: `${userId}@example.test`, isAdmin });
  await fixture.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 600_000),
    authMethod: "legacy",
    assurance: "legacy",
  });
  return { userId, sessionId };
}

async function draft(admin: NativeSessionRef, revision = "C"): Promise<ExportIntakeBinding> {
  const itemId = randomUUID();
  const sku = `EXPORT-${itemId.slice(0, 18).toUpperCase()}`;
  await fixture.db
    .insert(inventoryItems)
    .values({ id: itemId, sku, name: "Signal conditioner", kind: "product", revision: "A" });
  const releaseId = value(
    await executeReleaseMetadata(
      fixture.db,
      admin,
      { type: "createDraft", itemId, revision },
      signal(),
    ),
  ).releaseId;
  if (releaseId === undefined) throw new Error("Expected draft ID");
  return { itemId, releaseId, sku, revision };
}

async function grant(
  admin: NativeSessionRef,
  target: ExportIntakeBinding,
  staffMember: NativeSessionRef,
  role: "editor" | "approver" | null,
) {
  value(
    await executeReleaseMetadata(
      fixture.db,
      admin,
      {
        type: "setGrant",
        itemId: target.itemId,
        userId: staffMember.userId,
        role,
      },
      signal(),
    ),
  );
}

const bundleFiles = [
  {
    kind: "pcbSource",
    name: "controller.kicad_pcb",
    contents: "(kicad_pcb (version 20241229) (generator pcbnew))\n",
  },
  { kind: "testInstructions", name: "commissioning.txt", contents: "Check the input loop.\n" },
] satisfies { kind: ExportIntakeKind; name: string; contents: string }[];

function bundle(
  target: ExportIntakeBinding,
  sourceRevision = "firmware/main/4b9f12e",
): ExportManifest {
  return {
    schemaVersion: 1,
    exporter: { name: "kicad", version: "9.0", sourceRevision },
    target: { sku: target.sku, revision: target.revision },
    files: bundleFiles.map(({ kind, name, contents }) => ({
      kind,
      name,
      sizeBytes: Buffer.byteLength(contents),
      sha256: createHash("sha256").update(contents).digest("hex"),
    })),
  };
}

async function stageFiles(storage: FakeStorageClient, prepared: ReturnType<typeof staging>) {
  for (const upload of prepared.uploads) {
    const contents = bundleFiles.find(({ name }) => name === upload.name)?.contents;
    const key = upload.post.fields.key;
    if (contents === undefined || key === undefined) throw new Error("Unexpected packaged upload");
    value(await storage.putObjectBytes(key, Buffer.from(contents), upload.contentType, signal()));
  }
}

test("serializes scoped prepare and queue replays without exposing private forms or editing the legacy draft", async () => {
  const admin = await staff("Operations admin", true);
  const editor = await staff("Release engineer");
  const alternate = await staff("Second engineer");
  const approver = await staff("Release approver");
  const target = await draft(admin);
  const outside = await draft(admin, "D");
  await grant(admin, target, editor, "editor");
  await grant(admin, target, alternate, "editor");
  await grant(admin, target, approver, "approver");

  const storage = new FakeStorageClient();
  const manifest = bundle(target);
  const payload = { target, requestId: randomUUID(), manifest };
  const prepare = (actor: NativeSessionRef, input: unknown = payload) =>
    prepareExportIntake(fixture.db, actor, input, signal(), storage);
  const list = (actor: NativeSessionRef, binding: ExportIntakeBinding) =>
    readExportIntakeJobs(fixture.db, actor, binding, signal());
  expect(await prepare(approver)).toEqual({ ok: false, issues: [{ code: "unavailable" }] });
  expect(await list(editor, outside)).toEqual({ ok: false, issues: [{ code: "unavailable" }] });
  expect(
    await prepare(editor, {
      ...payload,
      manifest: { ...manifest, target: { sku: outside.sku, revision: "D" } },
    }),
  ).toEqual({ ok: false, issues: [{ code: "wrongTarget" }] });
  expect(storage.calls).toHaveLength(0);

  const [first, duplicate] = await Promise.all([
    prepare(editor),
    prepare(editor, {
      ...payload,
      manifest: { ...manifest, files: [...manifest.files].reverse() },
    }),
  ]);
  const reserved = staging(value(first));
  expect(staging(value(duplicate))).toEqual(reserved);
  expect(new Set(reserved.uploads.map(({ post }) => post.fields.key)).size).toBe(2);
  expect(await prepare(alternate)).toEqual({ ok: false, issues: [{ code: "conflict" }] });
  expect(
    await prepare(editor, { ...payload, manifest: bundle(target, "different-source") }),
  ).toEqual({ ok: false, issues: [{ code: "conflict" }] });
  expect(await list(approver, target)).toEqual({ ok: true, value: [] });

  const queue = (actor: NativeSessionRef, requestId = payload.requestId) =>
    queueExportIntake(
      fixture.db,
      actor,
      { target, requestId, jobId: reserved.jobId },
      signal(),
      storage,
    );
  expect(await queue(editor, randomUUID())).toEqual({ ok: false, issues: [{ code: "conflict" }] });
  expect(await queue(editor)).toMatchObject({ ok: false, issues: [{ code: "temporary" }] });
  await stageFiles(storage, reserved);
  const firstUpload = reserved.uploads[0];
  const firstKey = firstUpload?.post.fields.key;
  if (firstUpload === undefined || firstKey === undefined)
    throw new Error("Expected a private upload");
  value(await storage.putObjectBytes(firstKey, Buffer.alloc(1), firstUpload.contentType, signal()));
  expect(await queue(editor)).toEqual({
    ok: false,
    issues: [{ code: "fileSize", file: firstUpload.name }],
  });
  await stageFiles(storage, reserved);

  const queued = (await Promise.all([queue(editor), queue(editor)])).map(value);
  expect(queued).toEqual([queued[0], queued[0]]);
  expect(queued[0]).toMatchObject({
    id: reserved.jobId,
    state: "queued",
    attempts: [],
    artifacts: [],
  });
  expect(value(await prepare(editor))).toEqual({ state: "known", job: queued[0] });
  expect(await list(approver, target)).toEqual({ ok: true, value: [queued[0]] });
  expect(
    await fixture.db
      .select()
      .from(inventoryReleaseArtifacts)
      .where(eq(inventoryReleaseArtifacts.releaseId, target.releaseId)),
  ).toEqual([]);
  const receipts = await fixture.db
    .select()
    .from(inventoryExportRequests)
    .where(eq(inventoryExportRequests.jobId, reserved.jobId));
  expect(receipts.map(({ kind }) => kind).sort()).toEqual(["prepare", "queue"]);

  await grant(admin, target, editor, null);
  expect(await prepare(editor)).toEqual({ ok: false, issues: [{ code: "unavailable" }] });
  expect(await queue(editor)).toEqual({ ok: false, issues: [{ code: "unavailable" }] });
  await processReleaseExportJobs(fixture.db, signal(), storage);
  expect(value(await list(approver, target))[0]).toMatchObject({
    state: "cancelled",
    artifacts: [],
  });
});

test("retires an obsolete stage after a manual file changes the draft and retains its old receipt", async () => {
  const admin = await staff("Release admin", true);
  const target = await draft(admin);
  const storage = new FakeStorageClient();
  const input = { target, requestId: randomUUID(), manifest: bundle(target) };
  const first = staging(
    value(await prepareExportIntake(fixture.db, admin, input, signal(), storage)),
  );
  await stageFiles(storage, first);

  const manual = value(
    await requestReleaseArtifactUpload(
      fixture.db,
      admin,
      { releaseId: target.releaseId, kind: "testInstructions", name: "operator.txt", sizeBytes: 9 },
      signal(),
      storage,
    ),
  );
  const manualKey = manual.post.fields.key;
  if (manualKey === undefined) throw new Error("Expected a storage key");
  value(await storage.putObjectBytes(manualKey, Buffer.from("check io\n"), "text/plain", signal()));
  value(
    await confirmReleaseArtifactUpload(
      fixture.db,
      admin,
      { releaseId: target.releaseId, artifactId: manual.artifactId },
      signal(),
      storage,
    ),
  );

  expect(
    await queueExportIntake(
      fixture.db,
      admin,
      { target, requestId: input.requestId, jobId: first.jobId },
      signal(),
      storage,
    ),
  ).toEqual({ ok: false, issues: [{ code: "draftChanged" }] });
  const next = staging(
    value(
      await prepareExportIntake(
        fixture.db,
        admin,
        { ...input, requestId: randomUUID() },
        signal(),
        storage,
      ),
    ),
  );
  expect(next.jobId).not.toBe(first.jobId);
  expect(next.uploads.map(({ post }) => post.fields.key)).not.toEqual(
    first.uploads.map(({ post }) => post.fields.key),
  );
  expect(
    value(await prepareExportIntake(fixture.db, admin, input, signal(), storage)),
  ).toMatchObject({ state: "known", job: { id: first.jobId, state: "cancelled", artifacts: [] } });
  const rows = await fixture.db
    .select()
    .from(inventoryExportJobs)
    .where(eq(inventoryExportJobs.releaseId, target.releaseId));
  const old = rows.find(({ id }) => id === first.jobId);
  expect(old?.stagingPurgeAfter?.getTime()).toBe(
    (old?.stagingExpiresAt.getTime() ?? 0) + 15 * 60_000,
  );
  expect(
    (
      await fixture.db
        .select()
        .from(inventoryReleaseArtifacts)
        .where(eq(inventoryReleaseArtifacts.releaseId, target.releaseId))
    ).map(({ id }) => id),
  ).toEqual([manual.artifactId]);
});

test("rechecks the real editor after Silo signing and retries only the latest transient attempt once", async () => {
  const admin = await staff("Release admin", true);
  const editor = await staff("Export operator");
  const target = await draft(admin);
  await grant(admin, target, editor, "editor");
  const storage = new FakeStorageClient();
  const signed = storage.presignPost.bind(storage);
  vi.spyOn(storage, "presignPost").mockImplementationOnce(async (...args) => {
    await grant(admin, target, editor, null);
    return signed(...args);
  });
  const input = { target, requestId: randomUUID(), manifest: bundle(target) };
  expect(await prepareExportIntake(fixture.db, editor, input, signal(), storage)).toEqual({
    ok: false,
    issues: [{ code: "unavailable" }],
  });
  await grant(admin, target, editor, "editor");
  const staged = staging(
    value(await prepareExportIntake(fixture.db, editor, input, signal(), storage)),
  );
  await stageFiles(storage, staged);
  const queued = value(
    await queueExportIntake(
      fixture.db,
      editor,
      { target, jobId: staged.jobId, requestId: input.requestId },
      signal(),
      storage,
    ),
  );
  expect(queued.state).toBe("queued");

  // The already-queued storage keys become temporarily unavailable to the worker.
  await processReleaseExportJobs(fixture.db, signal(), new FakeStorageClient());
  const [failed] = value(await readExportIntakeJobs(fixture.db, admin, target, signal()));
  const failedAttemptId = failed?.failedAttemptId;
  if (failedAttemptId == null) throw new Error("Expected retryable attempt");
  expect(failed).toMatchObject({
    id: staged.jobId,
    state: "failed",
    attempts: [{ id: failedAttemptId, outcome: "failed", issue: { code: "temporary" } }],
    artifacts: [],
  });
  const retry = { target, jobId: staged.jobId, failedAttemptId, requestId: randomUUID() };
  const run = (actor: NativeSessionRef, command = retry) =>
    retryExportIntake(fixture.db, actor, command, signal());
  expect(await run(editor, { ...retry, failedAttemptId: randomUUID() })).toEqual({
    ok: false,
    issues: [{ code: "conflict" }],
  });
  await grant(admin, target, editor, null);
  expect(await run(editor)).toEqual({ ok: false, issues: [{ code: "unavailable" }] });
  expect(await run(admin)).toEqual({ ok: false, issues: [{ code: "unavailable" }] });
  await grant(admin, target, editor, "editor");
  const replay = (await Promise.all([run(editor), run(editor)])).map(value);
  expect(replay).toEqual([replay[0], replay[0]]);
  expect(replay[0]).toMatchObject({ state: "queued", failedAttemptId: null, artifacts: [] });
  expect(await run(editor, { ...retry, requestId: randomUUID() })).toEqual({
    ok: false,
    issues: [{ code: "conflict" }],
  });
  const receipts = await fixture.db
    .select()
    .from(inventoryExportRequests)
    .where(
      and(
        eq(inventoryExportRequests.jobId, staged.jobId),
        eq(inventoryExportRequests.kind, "retry"),
      ),
    );
  expect(receipts).toHaveLength(1);

  await processReleaseExportJobs(fixture.db, signal(), storage);
  const [ready] = value(await readExportIntakeJobs(fixture.db, admin, target, signal()));
  expect(ready).toMatchObject({
    id: staged.jobId,
    state: "ready",
    attempts: [{ outcome: "failed" }, { outcome: "ready", issue: null }],
  });
  expect(ready?.artifacts.map(({ name, kind, sha256 }) => ({ name, kind, sha256 }))).toEqual(
    input.manifest.files.map(({ name, kind, sha256 }) => ({ name, kind, sha256 })),
  );
  expect(
    (
      await fixture.db
        .select()
        .from(inventoryProductReleases)
        .where(eq(inventoryProductReleases.id, target.releaseId))
    )[0],
  ).toMatchObject({ status: "draft", bom: [] });
});
