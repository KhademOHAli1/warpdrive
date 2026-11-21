import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { deals, pipelines, stages } from "@/db/schema";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { FakeStorageClient } from "@/features/files/storageFake";
import { directorySiteGrants } from "@/features/locations/schema";
import { operationsSiteGrants } from "@/features/operations-access/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { blankCatalogProfile } from "../catalog/contracts";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryFixture } from "../fixtures";
import type { ProductionIntent } from "../production/contracts";
import { readProductionWorkspace, runProductionCommand } from "../production/service";
import { confirmReleaseArtifactUpload, requestReleaseArtifactUpload } from "../releases/artifacts";
import { createReleaseFixture } from "../releases/fixtures";
import type { ReleaseMetadataCommand } from "../releases/liveContracts";
import { executeReleaseMetadata, readReleaseWorkspace } from "../releases/service";
import { inventoryOrders } from "../schema";
import { runInventoryCommand } from "../service";
import {
  actor,
  counts,
  position,
  seedStructures,
  signal,
  value,
} from "../warehouse/operations/structures.test-helpers";
import {
  inventoryStockAllocations,
  inventoryStockEvents,
  inventoryStockPositions,
} from "../warehouse/schema";
import { readWarehouseWorkspace, runWarehouseCommand } from "../warehouse/service";
import type { QualityCommand, QualityStepDraft } from "./contracts";
import { confirmQualityEvidence, readQualityEvidence, requestQualityEvidence } from "./evidence";
import { readQualityWorkspace } from "./reads";
import { recordQualityRun } from "./runs";
import { inventoryQualityRuns } from "./schema";

const unavailable = { ok: false, error: "unavailable" } as const;

function stageUpload(storage: FakeStorageClient, fields: Record<string, string>, bytes: Buffer) {
  const key = fields.key;
  const contentType = fields["Content-Type"];
  assert(key !== undefined && contentType !== undefined);
  storage.objectsByKey.set(key, { size: bytes.length, contentType });
  storage.objectBytes.set(key, bytes);
}

async function approveTestRelease(h: TestDb, admin: NativeSessionRef, itemId: string) {
  const editor = await actor(h, "Quality plan engineer");
  const approver = await actor(h, "Independent release approver");
  const storage = new FakeStorageClient();
  const metadata = (who: NativeSessionRef, input: ReleaseMetadataCommand) =>
    executeReleaseMetadata(h.db, who, input, signal(), storage);
  value(await metadata(admin, { type: "setGrant", itemId, userId: editor.userId, role: "editor" }));
  value(
    await metadata(admin, { type: "setGrant", itemId, userId: approver.userId, role: "approver" }),
  );
  await h.db
    .update(inventoryPartProfiles)
    .set({ flags: { ...blankCatalogProfile("product").flags, trackable: true } })
    .where(eq(inventoryPartProfiles.itemId, itemId));

  const measure: QualityStepDraft = {
    kind: "measurement",
    key: randomUUID(),
    label: "Fastener torque",
    unit: "Nm",
    minimum: 3,
    maximum: 5,
    evidenceRequired: true,
  };
  const check: QualityStepDraft = {
    kind: "check",
    key: randomUUID(),
    label: "Sealed enclosure",
    evidenceRequired: false,
  };
  const command: ReleaseMetadataCommand = {
    type: "createQualityPlanVersion",
    itemId,
    requestId: randomUUID(),
    name: "Controller final inspection",
    steps: [measure, check],
  };
  expect(await metadata(approver, command)).toMatchObject({ ok: false });
  const created = await metadata(editor, command);
  expect(await metadata(editor, command)).toEqual(created);
  const { planVersionId } = value(created);
  const { planVersionId: laterVersionId } = value(
    await metadata(editor, {
      ...command,
      requestId: randomUUID(),
      steps: [{ ...measure, minimum: 4, evidenceRequired: false }, check],
    }),
  );
  const { releaseId } = value(
    await metadata(editor, { type: "createDraft", itemId, revision: "QA-A" }),
  );
  assert(planVersionId !== undefined && laterVersionId !== undefined && releaseId !== undefined);
  value(await metadata(editor, { type: "setQualityPlan", releaseId, planVersionId }));

  const sampleProduct = inventoryFixture(undefined).items.find(({ sku }) => sku === "IO-24-DIN");
  assert(sampleProduct !== undefined);
  const archive = createReleaseFixture(sampleProduct).releases[0]?.artifacts.find(
    ({ kind }) => kind === "pcbFabrication",
  );
  assert(archive !== undefined);
  for (const [kind, name, bytes] of [
    ["pcbFabrication", "fabrication.zip", Buffer.from(await archive.bytes.arrayBuffer())],
    ["manufacturingBom", "bom.csv", Buffer.from("sku,quantity\nCONTROL-0132,1\n")],
  ] as const) {
    const { artifactId, post } = value(
      await requestReleaseArtifactUpload(
        h.db,
        editor,
        {
          releaseId,
          kind,
          name,
          sizeBytes: bytes.length,
        },
        signal(),
        storage,
      ),
    );
    stageUpload(storage, post.fields, bytes);
    value(
      await confirmReleaseArtifactUpload(
        h.db,
        editor,
        { releaseId, artifactId },
        signal(),
        storage,
      ),
    );
  }

  const approval = {
    type: "approve",
    releaseId,
    expectedQualityPlanVersionId: planVersionId,
  } as const;
  expect(await metadata(approver, { type: "approve", releaseId })).toEqual({
    ok: false,
    error: "The test plan changed. Review the pinned version before approving.",
  });
  expect(
    await metadata(approver, { ...approval, expectedQualityPlanVersionId: laterVersionId }),
  ).toMatchObject({ ok: false });
  expect(await metadata(editor, approval)).toMatchObject({ ok: false });
  value(await metadata(approver, approval));
  expect(
    await metadata(editor, { type: "setQualityPlan", releaseId, planVersionId: null }),
  ).toMatchObject({ ok: false });
  expect(value(await readReleaseWorkspace(h.db, approver, itemId, signal()))).toMatchObject({
    activeReleaseId: releaseId,
    releases: [{ id: releaseId, qualityPlanVersionId: planVersionId, status: "released" }],
    qualityPlanVersions: [
      { id: laterVersionId, version: 2 },
      { id: planVersionId, version: 1, steps: [measure, check] },
    ],
  });
  return { releaseId, planVersionId, measure, check };
}

type BatchCommand =
  | { type: "issue" | "autoAllocate" }
  | { type: "startBatch"; quantity: number }
  | Omit<Extract<ProductionIntent, { type: "finalizeBatch" }>, "version" | "buildId">
  | Omit<Extract<ProductionIntent, { type: "cancelBuild" }>, "version" | "buildId">;

it("releases inspected serials independently with immutable test evidence and no second stock credit", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedStructures(h);
    const quality = await actor(h, "Quality station operator");
    const remoteQuality = await actor(h, "Remote quality operator");
    const warehouse = await actor(h, "Warehouse manager without quality access");
    await h.db.insert(operationsSiteGrants).values([
      { siteId: f.source.siteId, userId: quality.userId, role: "quality_operator" },
      { siteId: f.remote.siteId, userId: remoteQuality.userId, role: "quality_operator" },
    ]);
    await h.db
      .insert(directorySiteGrants)
      .values({ siteId: f.source.siteId, userId: warehouse.userId, role: "manager" });
    const release = await approveTestRelease(h, f.admin, f.parent.itemId);
    expect(await readReleaseWorkspace(h.db, quality, f.parent.itemId, signal())).toMatchObject({
      ok: false,
    });
    value(
      await runWarehouseCommand(
        h.db,
        f.admin,
        {
          type: "receive",
          requestId: randomUUID(),
          itemId: f.child.itemId,
          locationId: f.source.locationId,
          quantity: 1,
          lot: null,
          serial: "CHILD-QA-02",
          expiryDate: null,
          ownerOrganizationId: null,
          state: "available",
          incomingId: null,
        },
        signal(),
      ),
    );

    const production = (intent: ProductionIntent) =>
      runProductionCommand(h.db, f.admin, { ...intent, requestId: randomUUID() }, signal());
    const { buildId } = value(
      await production({
        type: "createBuild",
        releaseId: release.releaseId,
        ...f.source,
        quantity: 2,
        priority: "normal",
        dueDate: null,
        useTemplate: false,
        choices: [],
      }),
    );
    async function build() {
      const { detail } = value(await readProductionWorkspace(h.db, f.admin, { buildId }, signal()));
      assert(detail !== null);
      return detail;
    }
    async function onBuild(intent: BatchCommand) {
      return production({ ...intent, buildId, version: (await build()).version });
    }
    value(await onBuild({ type: "autoAllocate" }));
    value(await onBuild({ type: "issue" }));
    value(await onBuild({ type: "startBatch", quantity: 2 }));
    const output = (await build()).outputs.find(({ status }) => status === "wip");
    assert(output !== undefined);
    const serials = ["QUALITY-CONTROLLER-01", "QUALITY-CONTROLLER-02"];
    value(
      await onBuild({
        type: "finalizeBatch",
        outputId: output.id,
        disposition: "completed",
        lot: "QA-FINAL",
        serials,
        reason: "Manufacturing complete and ready for inspection",
      }),
    );
    expect(await build()).toMatchObject({
      status: "issued",
      completed: 2,
      release: { id: release.releaseId },
    });
    expect(
      await onBuild({ type: "cancelBuild", reason: "Exercise pending inspection guard" }),
    ).toEqual({ ok: false, error: "state" });
    const siteId = f.source.siteId;
    const qualityRead = (who: NativeSessionRef, targetId?: string) =>
      readQualityWorkspace(
        h.db,
        who,
        { siteId, ...(targetId === undefined ? {} : { targetId }) },
        signal(),
      );
    expect(await qualityRead(warehouse)).toEqual(unavailable);
    expect(await qualityRead(remoteQuality)).toEqual(unavailable);
    const { targets } = value(await qualityRead(quality));
    expect(targets).toHaveLength(2);
    const first = targets.find(({ serial }) => serial === serials[0]);
    const second = targets.find(({ serial }) => serial === serials[1]);
    assert(first !== undefined && second !== undefined);
    expect(targets).toMatchObject(
      Array.from({ length: 2 }, () => ({
        status: "pending",
        releaseId: release.releaseId,
        buildId,
        outputId: output.id,
        lot: "QA-FINAL",
      })),
    );
    expect(value(await qualityRead(quality, first.id)).detail?.plan).toMatchObject({
      id: release.planVersionId,
      version: 1,
      steps: [release.measure, release.check],
    });

    const inspectStock = async () => {
      const stock = value(
        await readWarehouseWorkspace(
          h.db,
          warehouse,
          { siteId, itemId: f.parent.itemId },
          signal(),
        ),
      );
      return serials.map((serial) => stock.positions.find((row) => row.serial === serial));
    };
    expect(await inspectStock()).toMatchObject([
      { id: first.positionId, state: "hold", onHand: 1, available: 0 },
      { id: second.positionId, state: "hold", onHand: 1, available: 0 },
    ]);
    expect(
      await runWarehouseCommand(
        h.db,
        warehouse,
        {
          type: "setPositionState",
          requestId: randomUUID(),
          id: first.positionId,
          state: "available",
          quantity: 1,
        },
        signal(),
      ),
    ).toEqual({ ok: false, error: "conflict" });
    await expect(
      h.db
        .update(inventoryStockPositions)
        .set({ state: "available" })
        .where(eq(inventoryStockPositions.id, second.positionId)),
    ).rejects.toThrow();
    const afterManufacturing = await counts(h, f.parent.itemId);

    const command = (
      targetId: string,
      actual: number,
      evidenceIds: string[],
    ): Extract<QualityCommand, { type: "recordRun" }> => ({
      type: "recordRun",
      targetId,
      requestId: randomUUID(),
      station: "QA Bench 4",
      results: [
        { key: release.measure.key, actual, evidenceIds },
        { key: release.check.key, actual: true, evidenceIds: [] },
      ],
    });
    const save = (who: NativeSessionRef, input: ReturnType<typeof command>) =>
      recordQualityRun(h.db, who, input, signal());
    const missing = command(first.id, 3, []);
    await expect(save(warehouse, missing)).rejects.toMatchObject({ code: "unavailable" });
    await expect(save(remoteQuality, missing)).rejects.toMatchObject({ code: "unavailable" });
    await expect(save(quality, missing)).rejects.toMatchObject({ code: "evidence" });

    const storage = new FakeStorageClient();
    const evidenceBytes = Buffer.from("station,certificate\nQA Bench 4,Fixture 71\n");
    async function attach(targetId: string, name: string) {
      const { post, evidenceId } = value(
        await requestQualityEvidence(
          h.db,
          quality,
          {
            type: "requestEvidence",
            targetId,
            name,
            key: release.measure.key,
            sizeBytes: evidenceBytes.length,
          },
          signal(),
          storage,
        ),
      );
      assert(evidenceId !== undefined && post !== undefined);
      stageUpload(storage, post.fields, evidenceBytes);
      expect(
        await confirmQualityEvidence(
          h.db,
          remoteQuality,
          { type: "confirmEvidence", targetId, evidenceId },
          signal(),
          storage,
        ),
      ).toEqual(unavailable);
      value(
        await confirmQualityEvidence(
          h.db,
          quality,
          { type: "confirmEvidence", targetId, evidenceId },
          signal(),
          storage,
        ),
      );
      return evidenceId;
    }

    const rejectedEvidence = await attach(first.id, "serial-01-failed.csv");
    await expect(save(quality, command(second.id, 3, [rejectedEvidence]))).rejects.toMatchObject({
      code: "evidence",
    });
    const failed = command(first.id, 2.9, [rejectedEvidence]);
    const rejection = value(await save(quality, failed));
    expect(rejection).toMatchObject({ passed: false });
    expect(value(await save(quality, failed))).toEqual(rejection);
    await expect(save(quality, { ...failed, station: "Different station" })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await position(h, first.positionId)).toMatchObject({
      state: "hold",
      onHand: 1,
      reserved: 0,
    });

    const secondEvidence = await attach(second.id, "serial-02-passed.csv");
    expect(value(await save(quality, command(second.id, 3, [secondEvidence])))).toMatchObject({
      passed: true,
    });
    expect(await inspectStock()).toMatchObject([
      { id: first.positionId, state: "hold", onHand: 1, available: 0 },
      { id: second.positionId, state: "available", onHand: 1, available: 1 },
    ]);
    expect(await build()).toMatchObject({ status: "issued", completed: 2 });
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    const dealId = randomUUID();
    await h.db.insert(pipelines).values({ id: pipelineId, name: "Quality order qualification" });
    await h.db.insert(stages).values({ id: stageId, pipelineId, name: "Ready for allocation" });
    await h.db.insert(deals).values({
      id: dealId,
      pipelineId,
      stageId,
      title: "Serialized controller request",
      ownerId: f.admin.userId,
      visibilityLevel: "all",
    });
    const order = () =>
      runInventoryCommand(
        h.db,
        f.admin,
        {
          type: "place",
          requestId: randomUUID(),
          dealId,
          itemId: f.parent.itemId,
          quantity: 3,
        },
        dealId,
        signal(),
      );
    expect(await order()).toMatchObject({
      ok: false,
      error:
        "Plan a serialized production build and pass its tests before allocating this stock to the order.",
    });
    expect(
      await h.db.select().from(inventoryOrders).where(eq(inventoryOrders.dealId, dealId)),
    ).toEqual([]);
    await expect(save(quality, command(first.id, 3, [rejectedEvidence]))).rejects.toMatchObject({
      code: "evidence",
    });

    const retryEvidence = await attach(first.id, "serial-01-retest.csv");
    const retest = command(first.id, 5, [retryEvidence]);
    const accepted = value(await save(quality, retest));
    expect(accepted).toMatchObject({ passed: true });
    expect(value(await save(quality, retest))).toEqual(accepted);
    expect(await inspectStock()).toMatchObject([
      { id: first.positionId, state: "available", onHand: 1, available: 1 },
      { id: second.positionId, state: "available", onHand: 1, available: 1 },
    ]);
    expect(await counts(h, f.parent.itemId)).toEqual(afterManufacturing);
    expect(await build()).toMatchObject({ status: "closed", completed: 2 });

    const acceptedEvents = await h.db
      .select()
      .from(inventoryStockEvents)
      .where(
        and(
          eq(inventoryStockEvents.itemId, f.parent.itemId),
          eq(inventoryStockEvents.kind, "quality-release"),
        ),
      );
    expect(acceptedEvents).toHaveLength(2);
    for (const { positionId } of [first, second]) {
      expect(acceptedEvents.find((event) => event.positionId === positionId)).toMatchObject({
        onHandDelta: 0,
        reservedDelta: 0,
        previousState: "hold",
        state: "available",
        actorId: quality.userId,
      });
    }
    expect(value(await qualityRead(quality, first.id)).detail).toMatchObject({
      status: "passed",
      canRecord: false,
      runs: [
        {
          id: accepted.runId,
          passed: true,
          station: "QA Bench 4",
          actorName: "Quality station operator",
          results: [
            { actual: 5, passed: true, evidence: [{ id: retryEvidence }] },
            { actual: true, passed: true },
          ],
        },
        {
          id: rejection.runId,
          passed: false,
          station: "QA Bench 4",
          results: [
            { actual: 2.9, passed: false, evidence: [{ id: rejectedEvidence }] },
            { actual: true, passed: true },
          ],
        },
      ],
    });
    const download = { targetId: first.id, runId: accepted.runId, evidenceId: retryEvidence };
    expect(value(await readQualityEvidence(h.db, quality, download, signal(), storage))).toEqual({
      name: "serial-01-retest.csv",
      bytes: evidenceBytes,
    });
    expect(await readQualityEvidence(h.db, warehouse, download, signal(), storage)).toEqual(
      unavailable,
    );
    expect(
      await readQualityEvidence(
        h.db,
        quality,
        { ...download, evidenceId: rejectedEvidence },
        signal(),
        storage,
      ),
    ).toEqual(unavailable);
    await expect(
      h.db
        .update(inventoryQualityRuns)
        .set({ station: "Edited after release" })
        .where(eq(inventoryQualityRuns.id, accepted.runId)),
    ).rejects.toThrow();

    await h.db.delete(operationsSiteGrants).where(eq(operationsSiteGrants.userId, quality.userId));
    expect(await qualityRead(quality, first.id)).toEqual(unavailable);
    await expect(save(quality, retest)).rejects.toMatchObject({ code: "unavailable" });
    expect(await readQualityEvidence(h.db, quality, download, signal(), storage)).toEqual(
      unavailable,
    );
    expect(await order()).toMatchObject({ ok: true });
    const [placed] = await h.db
      .select()
      .from(inventoryOrders)
      .where(eq(inventoryOrders.dealId, dealId));
    assert(placed !== undefined);
    expect(placed).toMatchObject({ quantity: 3, reserved: 3, buildQuantity: 0, status: "ready" });
    const allocation = await h.db
      .select()
      .from(inventoryStockAllocations)
      .where(eq(inventoryStockAllocations.orderId, placed.id));
    expect(allocation.map(({ positionId }) => positionId).sort()).toEqual(
      [f.parent.positionId, first.positionId, second.positionId].sort(),
    );
  } finally {
    await h.close();
  }
});
