import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import type { ApprovedBomLine } from "../schema";
import type { EngineeringChangeCommand } from "./contracts";
import { readEngineeringReleasePolicy } from "./effectivity";
import { failEngineering } from "./errors";
import { confirmEngineeringReviewFingerprint } from "./nativeReview";
import {
  advanceEngineeringChange,
  findEngineeringReceipt,
  readEngineeringTime,
  recordEngineeringEvent,
  requireEngineeringChange,
  storeEngineeringReceipt,
} from "./records";
import type { EngineeringChangeRow } from "./schema";

export type ReviewedEngineeringApproval = Extract<EngineeringChangeCommand, { type: "approve" }>;

export async function allowEngineeringApprovalReplay(
  tx: Db,
  actor: HydratedActor,
  command: ReviewedEngineeringApproval,
  itemId: string,
  releaseId: string,
) {
  if (command.itemId !== itemId) failEngineering("unavailable");
  const match = await requireEngineeringChange(tx, itemId, command.changeId);
  const receipt = await findEngineeringReceipt(tx, actor, command);
  if (
    match.status !== "approved" ||
    match.candidateReleaseId !== releaseId ||
    receipt?.changeId !== match.id
  )
    failEngineering("conflict");
}

export async function verifyEngineeringApproval(
  tx: Db,
  actor: HydratedActor,
  command: ReviewedEngineeringApproval,
  itemId: string,
  releaseId: string,
  bom: ApprovedBomLine[],
) {
  if (command.itemId !== itemId) failEngineering("unavailable");
  const change = await requireEngineeringChange(tx, itemId, command.changeId);
  const receipt = await findEngineeringReceipt(tx, actor, command);
  if (
    receipt !== null ||
    change.status !== "review" ||
    change.version !== command.expectedVersion ||
    change.candidateReleaseId !== releaseId
  )
    failEngineering("conflict");
  const policy = await readEngineeringReleasePolicy(tx, itemId);
  if (policy.releaseId !== change.baseReleaseId) failEngineering("staleReview");
  if (change.effectiveAt <= (await readEngineeringTime(tx))) failEngineering("effectiveDate");
  const fingerprint = await confirmEngineeringReviewFingerprint(
    tx,
    {
      itemId,
      baseReleaseId: change.baseReleaseId,
      candidateReleaseId: releaseId,
    },
    bom,
  );
  if (fingerprint !== command.fingerprint || fingerprint !== change.fingerprint)
    failEngineering("staleReview");
  return change;
}

export async function saveEngineeringApproval(
  tx: Db,
  actor: HydratedActor,
  command: ReviewedEngineeringApproval,
  current: EngineeringChangeRow,
  approvedAt: Date,
) {
  if (approvedAt >= current.effectiveAt) failEngineering("effectiveDate");
  const result = await advanceEngineeringChange(
    tx,
    current,
    { status: "approved", approvedBy: actor.id, approvedAt },
    approvedAt,
  );
  await recordEngineeringEvent(tx, actor, result, { type: "approved" });
  await storeEngineeringReceipt(tx, actor, command, result.id);
}
