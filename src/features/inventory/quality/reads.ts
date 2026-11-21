import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory } from "@/features/locations/service";
import { err, ok } from "@/types/result";
import { lockInventoryCatalog } from "../catalog/policy";
import { inventoryProductReleases } from "../releases/schema";
import { inventoryItems } from "../schema";
import { listQualitySites, requireQualityActor } from "./access";
import type {
  QualityQuery,
  QualityResultLine,
  QualityRun,
  QualityWorkspaceResult,
} from "./contracts";
import { failQuality, QualityFailure } from "./failure";
import { inventoryQualityPlanVersions } from "./planSchema";
import {
  inventoryQualityEvidence,
  inventoryQualityRunEvidence,
  inventoryQualityRuns,
  inventoryQualityTargets,
} from "./schema";

const targets = inventoryQualityTargets;

async function readTargets(tx: Db, siteIds: string[]) {
  const rows = await tx
    .select({
      id: targets.id,
      siteId: targets.siteId,
      positionId: targets.positionId,
      buildId: targets.buildId,
      outputId: targets.outputId,
      releaseId: targets.releaseId,
      releaseRevision: inventoryProductReleases.revision,
      partCode: inventoryItems.sku,
      partName: inventoryItems.name,
      serial: targets.serial,
      lot: targets.lot,
      status: targets.status,
      createdAt: targets.createdAt,
      planVersionId: targets.planVersionId,
    })
    .from(targets)
    .innerJoin(inventoryProductReleases, eq(inventoryProductReleases.id, targets.releaseId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, targets.itemId))
    .where(inArray(targets.siteId, siteIds))
    .orderBy(
      sql`case when ${targets.status} = 'passed' then 1 else 0 end`,
      desc(targets.createdAt),
      targets.id,
    );
  return rows.map(({ createdAt, planVersionId, ...row }) => ({
    summary: { ...row, createdAt: createdAt.toISOString() },
    planVersionId,
  }));
}

async function readRuns(tx: Db, targetId: string): Promise<QualityRun[]> {
  const runs = await tx
    .select()
    .from(inventoryQualityRuns)
    .where(eq(inventoryQualityRuns.targetId, targetId))
    .orderBy(desc(inventoryQualityRuns.createdAt), desc(inventoryQualityRuns.id));
  if (runs.length === 0) return [];
  const attachments = await tx
    .select({
      runId: inventoryQualityRunEvidence.runId,
      key: inventoryQualityRunEvidence.key,
      id: inventoryQualityEvidence.id,
      name: inventoryQualityEvidence.name,
      sizeBytes: inventoryQualityEvidence.sizeBytes,
    })
    .from(inventoryQualityRunEvidence)
    .innerJoin(
      inventoryQualityEvidence,
      eq(inventoryQualityEvidence.id, inventoryQualityRunEvidence.evidenceId),
    )
    .where(eq(inventoryQualityRunEvidence.targetId, targetId))
    .orderBy(inventoryQualityEvidence.id);
  const evidence = new Map<string, QualityResultLine["evidence"]>();
  for (const { runId, key, ...attachment } of attachments) {
    const identity = `${runId}:${key}`;
    const group = evidence.get(identity) ?? [];
    group.push(attachment);
    evidence.set(identity, group);
  }
  return runs.map(({ id, station, actorName, createdAt, passed, results }) => ({
    id,
    station,
    actorName,
    createdAt: createdAt.toISOString(),
    passed,
    results: results.map((line) => ({
      ...line,
      evidence: evidence.get(`${id}:${line.key}`) ?? [],
    })),
  }));
}

export async function readQualityWorkspace(
  db: Db,
  who: NativeSessionRef,
  query: QualityQuery,
  signal: AbortSignal,
): Promise<QualityWorkspaceResult> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      const actor = await requireQualityActor(tx, who, signal);
      const sites = await listQualitySites(tx, actor);
      const matching =
        query.siteId === undefined ? sites : sites.filter(({ id }) => id === query.siteId);
      if (
        matching.length === 0 &&
        (sites.length > 0 || query.siteId !== undefined || actor.type !== "admin")
      ) {
        failQuality("unavailable");
      }
      const siteIds = matching.map(({ id }) => id);
      const queue = await readTargets(tx, siteIds);
      let detail = null;
      if (query.targetId !== undefined) {
        const selected = queue.find(({ summary }) => summary.id === query.targetId);
        if (selected === undefined) failQuality("unavailable");
        const { planVersionId, summary } = selected;
        const [plan] = await tx
          .select({
            id: inventoryQualityPlanVersions.id,
            name: inventoryQualityPlanVersions.name,
            version: inventoryQualityPlanVersions.version,
            steps: inventoryQualityPlanVersions.steps,
          })
          .from(inventoryQualityPlanVersions)
          .where(eq(inventoryQualityPlanVersions.id, planVersionId));
        if (plan === undefined) failQuality("state");
        detail = {
          ...summary,
          plan,
          canRecord:
            summary.status !== "passed" &&
            matching.some(({ id, archived }) => id === summary.siteId && !archived),
          runs: await readRuns(tx, summary.id),
        };
      }
      await requireQualityActor(tx, who, signal);
      return ok({
        sites: sites.map(({ id, code, name }) => ({ id, code, name })),
        targets: queue.map(({ summary }) => summary),
        detail,
      });
    });
  } catch (error) {
    if (error instanceof QualityFailure) return err(error.code);
    throw error;
  }
}
