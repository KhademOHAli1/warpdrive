import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { ok } from "@/types/result";
import { inventoryProductionBuilds } from "../production/buildSchema";
import { lockInventoryStock } from "../stock";
import { addOperationEvent } from "../warehouse/operations/shared";
import { inventoryStockPositions } from "../warehouse/schema";
import { withQualityTarget } from "./access";
import type { QualityCommand, QualityStepDraft } from "./contracts";
import { failQuality } from "./failure";
import { hasPendingBuildInspection } from "./gates";
import {
  inventoryQualityEvidence,
  inventoryQualityRunEvidence,
  inventoryQualityRuns,
  inventoryQualityTargets,
  type QualityTargetRow,
} from "./schema";

type RecordRun = Extract<QualityCommand, { type: "recordRun" }>;

function evaluateTest(step: QualityStepDraft, actual: boolean | number) {
  if (step.kind === "check") {
    if (typeof actual !== "boolean") failQuality("invalid");
    return actual;
  }
  if (typeof actual !== "number") failQuality("invalid");
  return (
    (step.minimum === null || actual >= step.minimum) &&
    (step.maximum === null || actual <= step.maximum)
  );
}

function evaluateRun(steps: QualityStepDraft[], inputs: RecordRun["results"]) {
  const byKey = new Map(inputs.map((input) => [input.key, input]));
  if (byKey.size !== inputs.length || byKey.size !== steps.length) failQuality("invalid");
  return steps.map((step) => {
    const input = byKey.get(step.key);
    if (input === undefined) failQuality("invalid");
    if (step.evidenceRequired && input.evidenceIds.length === 0) failQuality("evidence");
    return {
      key: step.key,
      actual: input.actual,
      passed: evaluateTest(step, input.actual),
      evidenceIds: [...input.evidenceIds].sort(),
    };
  });
}

async function requireSealedEvidence(
  tx: Db,
  actorId: string,
  targetId: string,
  links: { evidenceId: string; key: string }[],
) {
  if (links.length === 0) return;
  const ids = new Set(links.map(({ evidenceId }) => evidenceId));
  if (ids.size !== links.length) failQuality("evidence");
  const evidence = await tx
    .select({ id: inventoryQualityEvidence.id, key: inventoryQualityEvidence.key })
    .from(inventoryQualityEvidence)
    .leftJoin(
      inventoryQualityRunEvidence,
      eq(inventoryQualityRunEvidence.evidenceId, inventoryQualityEvidence.id),
    )
    .where(
      and(
        inArray(inventoryQualityEvidence.id, [...ids]),
        eq(inventoryQualityEvidence.targetId, targetId),
        eq(inventoryQualityEvidence.uploaderId, actorId),
        isNotNull(inventoryQualityEvidence.objectKey),
        sql`${inventoryQualityRunEvidence.evidenceId} IS NULL`,
      ),
    );
  const keys = new Map(evidence.map(({ id, key }) => [id, key]));
  if (links.some(({ evidenceId, key }) => keys.get(evidenceId) !== key)) failQuality("evidence");
}

async function releaseInspectedSerial(
  tx: Db,
  actorId: string,
  requestId: string,
  target: QualityTargetRow,
) {
  await lockInventoryStock(tx, [target.itemId]);
  const [position] = await tx
    .update(inventoryStockPositions)
    .set({ state: "available" })
    .where(
      and(
        eq(inventoryStockPositions.id, target.positionId),
        eq(inventoryStockPositions.buildOutputId, target.outputId),
        eq(inventoryStockPositions.siteId, target.siteId),
        eq(inventoryStockPositions.serial, target.serial),
        eq(inventoryStockPositions.state, "hold"),
        eq(inventoryStockPositions.onHand, 1),
        eq(inventoryStockPositions.reserved, 0),
      ),
    )
    .returning();
  if (position === undefined) failQuality("state");
  await addOperationEvent(
    tx,
    { id: actorId },
    { requestId, reason: "Release serial after passing its approved tests" },
    {
      itemId: position.itemId,
      positionId: position.id,
      kind: "quality-release",
      state: "available",
      previousState: "hold",
    },
    { siteId: position.siteId, locationId: position.locationId, previousOnHand: position.onHand },
  );

  if (await hasPendingBuildInspection(tx, target.buildId)) return;
  await tx
    .update(inventoryProductionBuilds)
    .set({ status: "closed", version: sql`${inventoryProductionBuilds.version} + 1` })
    .where(
      and(
        eq(inventoryProductionBuilds.id, target.buildId),
        inArray(inventoryProductionBuilds.status, ["issued", "on_hold"]),
        sql`${inventoryProductionBuilds.completed} + ${inventoryProductionBuilds.scrapped} = ${inventoryProductionBuilds.quantity}`,
      ),
    );
}

export async function recordQualityRun(
  db: Db,
  who: NativeSessionRef,
  command: RecordRun,
  signal: AbortSignal,
) {
  return withQualityTarget(
    db,
    who,
    command.targetId,
    "record",
    signal,
    async (tx, actor, target, plan) => {
      const evaluated = evaluateRun(plan.steps, command.results);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([target.id, command.station, evaluated]))
        .digest("hex");
      const readReplay = async () => {
        const [run] = await tx
          .select()
          .from(inventoryQualityRuns)
          .where(
            and(
              eq(inventoryQualityRuns.actorId, actor.id),
              eq(inventoryQualityRuns.requestId, command.requestId),
            ),
          );
        if (run !== undefined && run.fingerprint !== fingerprint) failQuality("conflict");
        return run;
      };
      const replay = await readReplay();
      if (replay !== undefined) return ok({ runId: replay.id, passed: replay.passed });
      if (target.status === "passed") failQuality("state");
      const links = evaluated.flatMap(({ key, evidenceIds }) =>
        evidenceIds.map((evidenceId) => ({ key, evidenceId })),
      );
      await requireSealedEvidence(tx, actor.id, target.id, links);
      const passed = evaluated.every((line) => line.passed);
      const [run] = await tx
        .insert(inventoryQualityRuns)
        .values({
          actorId: actor.id,
          actorName: actor.name,
          targetId: target.id,
          requestId: command.requestId,
          station: command.station,
          fingerprint,
          passed,
          createdAt: sql`clock_timestamp()`,
          results: evaluated.map(({ key, actual, passed }) => ({ key, actual, passed })),
        })
        .onConflictDoNothing({
          target: [inventoryQualityRuns.actorId, inventoryQualityRuns.requestId],
        })
        .returning({ id: inventoryQualityRuns.id });
      if (run === undefined) {
        const concurrent = await readReplay();
        if (concurrent === undefined) failQuality("conflict");
        return ok({ runId: concurrent.id, passed: concurrent.passed });
      }
      if (links.length > 0)
        await tx
          .insert(inventoryQualityRunEvidence)
          .values(links.map((entry) => ({ ...entry, runId: run.id, targetId: target.id })));
      await tx
        .update(inventoryQualityTargets)
        .set({ status: passed ? "passed" : "failed" })
        .where(eq(inventoryQualityTargets.id, target.id));
      if (passed) await releaseInspectedSerial(tx, actor.id, command.requestId, target);
      return ok({ runId: run.id, passed });
    },
  );
}
