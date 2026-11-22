import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { assert, expect, test, vi } from "vitest";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryFixture } from "../../fixtures";
import { inventoryItems } from "../../schema";
import { actor, signal } from "../../warehouse/operations/structures.test-helpers";
import { confirmReleaseArtifactUpload, requestReleaseArtifactUpload } from "../artifacts";
import { createReleaseFixture } from "../fixtures";
import type { ReleaseMetadataCommand } from "../liveContracts";
import { inventoryProductReleases, inventoryReleaseArtifacts } from "../schema";
import { executeReleaseMetadata } from "../service";
import type { ExportIntakeBinding, ExportIntakeKind, ExportManifest } from "./contracts";
import { exportSealKey, exportStagingKey } from "./objectKeys";
import { inventoryExportAttempts, inventoryExportFiles, inventoryExportJobs } from "./schema";
import { prepareExportIntake, queueExportIntake, retryExportIntake } from "./service";
import { cleanupReleaseExportJobs, processReleaseExportJobs } from "./worker";

function accept<T>(result: { ok: true; value: T } | { ok: false }): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

const releaseSource = {
  kind: "pcbSource",
  name: "controller.kicad_pcb",
  bytes: Buffer.from("(kicad_pcb (version 20241229) (generator pcbnew))\n"),
} as const;

async function prepareWorkerCase(h: TestDb) {
  const admin = await actor(h, "Export release administrator", true);
  const editor = await actor(h, "Original export release editor");
  const approver = await actor(h, "Export release approver");
  const storage = new FakeStorageClient();
  const itemId = randomUUID();
  const revision = "B";
  const sku = `INTAKE-${itemId.slice(0, 12).toUpperCase()}`;
  const metadata = (who: NativeSessionRef, args: ReleaseMetadataCommand) =>
    executeReleaseMetadata(h.db, who, args, signal(), storage);
  await h.db
    .insert(inventoryItems)
    .values({ id: itemId, sku, name: "Export controller", kind: "product", revision: "A" });
  const { releaseId } = accept(await metadata(admin, { type: "createDraft", itemId, revision }));
  assert(releaseId !== undefined);
  accept(
    await metadata(admin, { type: "setGrant", itemId, userId: editor.userId, role: "editor" }),
  );
  accept(
    await metadata(admin, { type: "setGrant", itemId, userId: approver.userId, role: "approver" }),
  );
  return {
    storage,
    editor,
    approver,
    admin,
    metadata,
    target: { itemId, releaseId, sku, revision },
  };
}

async function queuePackage(
  h: TestDb,
  { editor, storage, target }: Awaited<ReturnType<typeof prepareWorkerCase>>,
  payload: readonly { kind: ExportIntakeKind; name: string; bytes: Buffer }[],
) {
  const manifest: ExportManifest = {
    schemaVersion: 1,
    exporter: { name: "kicad", version: "9.0.2", sourceRevision: "d7599f2" },
    target: { sku: target.sku, revision: target.revision },
    files: payload.map(({ kind, name, bytes }) => ({
      kind,
      name,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  };
  const requestId = randomUUID();
  const prepared = accept(
    await prepareExportIntake(h.db, editor, { target, manifest, requestId }, signal(), storage),
  );
  assert(prepared.state === "staging");
  for (const upload of prepared.uploads) {
    const input = payload.find(({ name }) => name === upload.name);
    const key = upload.post.fields.key;
    assert(input !== undefined && key !== undefined);
    accept(await storage.putObjectBytes(key, input.bytes, upload.contentType, signal()));
  }
  const queued = accept(
    await queueExportIntake(
      h.db,
      editor,
      { target, requestId, jobId: prepared.jobId },
      signal(),
      storage,
    ),
  );
  expect(queued.state).toBe("queued");
  return queued.id;
}

function releaseArtifacts(h: TestDb, target: ExportIntakeBinding) {
  return h.db
    .select()
    .from(inventoryReleaseArtifacts)
    .where(eq(inventoryReleaseArtifacts.releaseId, target.releaseId))
    .orderBy(inventoryReleaseArtifacts.id);
}

async function addIncumbentApprovedFiles(
  h: TestDb,
  context: Awaited<ReturnType<typeof prepareWorkerCase>>,
) {
  const partSku = "EXPORT-COMPONENT";
  await h.db
    .insert(inventoryItems)
    .values({ sku: partSku, name: "M12 connector", kind: "component", revision: "A" });
  const sample = inventoryFixture(undefined).items.find(({ sku }) => sku === "IO-24-DIN");
  assert(sample !== undefined);
  const fabrication = createReleaseFixture(sample).releases[0]?.artifacts.find(
    ({ kind }) => kind === "pcbFabrication",
  );
  assert(fabrication !== undefined);
  const {
    target: { releaseId },
    editor,
    storage,
  } = context;
  for (const [kind, name, bytes] of [
    ["pcbFabrication", "incumbent-gerber.zip", Buffer.from(await fabrication.bytes.arrayBuffer())],
    ["manufacturingBom", "incumbent-bom.csv", Buffer.from(`sku,quantity\n${partSku},2\n`)],
  ] as const) {
    const { post, artifactId } = accept(
      await requestReleaseArtifactUpload(
        h.db,
        editor,
        { releaseId, kind, name, sizeBytes: bytes.length },
        signal(),
        storage,
      ),
    );
    const key = post.fields.key;
    const contentType = post.fields["Content-Type"];
    assert(key !== undefined && contentType !== undefined);
    accept(await storage.putObjectBytes(key, bytes, contentType, signal()));
    accept(
      await confirmReleaseArtifactUpload(
        h.db,
        editor,
        { releaseId, artifactId },
        signal(),
        storage,
      ),
    );
  }
}

test("original editor revocation and incumbent approval during storage I/O both prevent publication", async () => {
  const h = await makeTestDb();
  try {
    for (const race of ["revoked", "approved"] as const) {
      const context = await prepareWorkerCase(h);
      const { admin, editor, approver, storage, metadata, target } = context;
      if (race === "approved") await addIncumbentApprovedFiles(h, context);
      const oldFiles = await releaseArtifacts(h, target);
      const jobId = await queuePackage(h, context, [releaseSource]);
      const previousGet = storage.getObjectBytes.bind(storage);
      const stageKey = exportStagingKey(jobId, 0);
      let raced = false;
      vi.spyOn(storage, "getObjectBytes").mockImplementation(async (key, abort, max) => {
        if (!raced && key === stageKey) {
          raced = true;
          if (race === "revoked") {
            accept(
              await metadata(admin, {
                type: "setGrant",
                itemId: target.itemId,
                userId: editor.userId,
                role: null,
              }),
            );
          } else {
            accept(await metadata(approver, { type: "approve", releaseId: target.releaseId }));
          }
        }
        return previousGet(key, abort, max);
      });

      expect(await processReleaseExportJobs(h.db, signal(), storage)).toBe(1);
      expect(raced).toBe(true);
      expect(await releaseArtifacts(h, target)).toEqual(oldFiles);
      const [attempt] = await h.db
        .select()
        .from(inventoryExportAttempts)
        .where(eq(inventoryExportAttempts.jobId, jobId));
      expect(attempt).toMatchObject({
        outcome: "cancelled",
        issue: { code: race === "revoked" ? "unavailable" : "draftChanged" },
      });
      const [release] = await h.db
        .select()
        .from(inventoryProductReleases)
        .where(eq(inventoryProductReleases.id, target.releaseId));
      expect(release?.status).toBe(race === "approved" ? "released" : "draft");
      if (race === "approved") expect(release?.bom).toMatchObject([{ quantity: 2 }]);
    }
  } finally {
    await h.close();
  }
});

test("temporary publication rollback retains staging, and ambiguous success preserves winning seals through cleanup", async () => {
  const h = await makeTestDb();
  try {
    const context = await prepareWorkerCase(h);
    const { storage, editor, target } = context;
    const jobId = await queuePackage(h, context, [
      releaseSource,
      {
        kind: "testInstructions",
        name: "field-tests.txt",
        bytes: Buffer.from("Inspect controller status.\n"),
      },
    ]);
    const manifestFiles = await h.db
      .select()
      .from(inventoryExportFiles)
      .where(eq(inventoryExportFiles.jobId, jobId));
    await h.pool.query(`CREATE FUNCTION pg_temp_placeholder_release_export_fault() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.kind = 'testInstructions' AND NEW.object_key LIKE '%/export-%' THEN
          RAISE EXCEPTION 'disposable test publication failure' USING ERRCODE = '55P03';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_release_export_fault BEFORE INSERT ON public.inventory_release_artifacts
      FOR EACH ROW EXECUTE FUNCTION pg_temp_placeholder_release_export_fault()`);
    expect(await processReleaseExportJobs(h.db, signal(), storage)).toBe(1);
    expect(await releaseArtifacts(h, target)).toEqual([]);
    const [failed] = await h.db
      .select()
      .from(inventoryExportAttempts)
      .where(eq(inventoryExportAttempts.jobId, jobId));
    assert(failed !== undefined);
    expect(failed).toMatchObject({ outcome: "failed", issue: { code: "temporary" }, ordinal: 1 });
    const stagedKeys = manifestFiles.map(({ ordinal }) => exportStagingKey(jobId, ordinal));
    const discardedSeals = manifestFiles.map(({ artifactId }) =>
      exportSealKey(target.releaseId, artifactId, failed.id),
    );
    for (const key of [...stagedKeys, ...discardedSeals])
      expect(storage.objectBytes.has(key)).toBe(true);
    await h.pool.query(
      `DROP TRIGGER test_release_export_fault ON public.inventory_release_artifacts`,
    );
    expect(
      accept(
        await retryExportIntake(
          h.db,
          editor,
          {
            target,
            jobId,
            requestId: randomUUID(),
            failedAttemptId: failed.id,
          },
          signal(),
        ),
      ).state,
    ).toBe("queued");

    const commit = h.db.transaction.bind(h.db);
    const ambiguous = vi.spyOn(h.db, "transaction").mockImplementation(async (...args) => {
      const result = await commit(...args);
      if (result === true) throw new Error("Test connection dropped after committed publication");
      return result;
    });
    await expect(processReleaseExportJobs(h.db, signal(), storage)).rejects.toThrow(
      "after committed publication",
    );
    ambiguous.mockRestore();
    const [job] = await h.db
      .select()
      .from(inventoryExportJobs)
      .where(eq(inventoryExportJobs.id, jobId));
    expect(job?.state).toBe("ready");
    const published = await releaseArtifacts(h, target);
    expect(published).toHaveLength(2);
    expect(await processReleaseExportJobs(h.db, signal(), storage)).toBe(0);
    expect(await releaseArtifacts(h, target)).toEqual(published);
    expect(storage.deletedKeys).toEqual([]);

    // Advance the two disposable cleanup deadlines without changing the verified
    // bytes or the ready outcome. Production transitions keep these timestamps immutable.
    await h.db.transaction(async (tx) => {
      await tx.execute(
        sql`ALTER TABLE public.inventory_release_export_jobs DISABLE TRIGGER inventory_release_export_job_guard`,
      );
      await tx.execute(
        sql`ALTER TABLE public.inventory_release_export_attempts DISABLE TRIGGER inventory_release_export_attempt_guard`,
      );
      await tx
        .update(inventoryExportJobs)
        .set({ stagingPurgeAfter: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(inventoryExportJobs.id, jobId));
      await tx
        .update(inventoryExportAttempts)
        .set({ sealPurgeAfter: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(inventoryExportAttempts.id, failed.id));
      await tx.execute(sql`SET CONSTRAINTS inventory_release_export_attempt_lease_check IMMEDIATE`);
      await tx.execute(
        sql`ALTER TABLE public.inventory_release_export_attempts ENABLE TRIGGER inventory_release_export_attempt_guard`,
      );
      await tx.execute(
        sql`ALTER TABLE public.inventory_release_export_jobs ENABLE TRIGGER inventory_release_export_job_guard`,
      );
    });
    await cleanupReleaseExportJobs(h.db, signal(), storage);
    expect(new Set(storage.deletedKeys)).toEqual(new Set([...stagedKeys, ...discardedSeals]));
    for (const artifact of published)
      expect(storage.objectBytes.has(artifact.objectKey)).toBe(true);
    expect(await releaseArtifacts(h, target)).toEqual(published);
  } finally {
    await h.close();
  }
});
