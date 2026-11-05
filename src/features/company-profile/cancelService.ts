import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { CompanyCommand } from "./contracts";
import { privateFingerprint, sealCompany } from "./crypto";
import { companyFailure } from "./policy";
import { assetUrl } from "./readiness";
import { companyReceiptValue } from "./receipts";
import { companyAssets, companyOperations } from "./schema";

type CancelCommand = Extract<CompanyCommand, { action: "cancel_operation" }>;
async function existingReceipt(
  db: Db,
  actor: PermSetUser,
  command: CancelCommand,
  receipt: typeof companyOperations.$inferSelect,
  signal: AbortSignal,
) {
  if (receipt.actorId !== actor.id) return err(companyFailure("not_found"));
  if (receipt.kind === `canceled:${command.operationAction}`)
    return ok({ operationId: command.operationId, status: "canceled" as const });
  if (receipt.kind !== command.operationAction) return err(companyFailure("replay_conflict"));
  return ok({
    operationId: command.operationId,
    status: "completed" as const,
    result: await companyReceiptValue(db, actor, receipt, signal),
  });
}

/** Caller holds the same workspace write lock as every original command/upload. */
export async function cancelCompanyOperation(
  db: Db,
  actor: PermSetUser,
  command: CancelCommand,
  signal: AbortSignal,
) {
  if (command.requestId === command.operationId) return err(companyFailure("invalid_input"));
  const [receipt] = await db
    .select()
    .from(companyOperations)
    .where(eq(companyOperations.requestId, command.operationId));
  signal.throwIfAborted();
  if (receipt) return existingReceipt(db, actor, command, receipt, signal);
  const [asset] = await db
    .select()
    .from(companyAssets)
    .where(eq(companyAssets.requestId, command.operationId));
  signal.throwIfAborted();
  if (asset) {
    if (asset.createdBy !== actor.id) return err(companyFailure("not_found"));
    if (command.operationAction !== "upload_asset") return err(companyFailure("replay_conflict"));
    if (asset.ready)
      return ok({
        operationId: command.operationId,
        status: "completed" as const,
        result: {
          assetId: asset.id,
          url: assetUrl(asset.id),
          width: asset.width,
          height: asset.height,
          contentType: "image/png" as const,
        },
      });
  }
  const response = { operationId: command.operationId, status: "canceled" as const };
  await db.insert(companyOperations).values({
    requestId: command.operationId,
    actorId: actor.id,
    kind: `canceled:${command.operationAction}`,
    fingerprint: privateFingerprint({ canceled: command.operationId, actor: actor.id }),
    responseCiphertext: sealCompany(response, `operation:${command.operationId}`),
  });
  signal.throwIfAborted();
  return ok(response);
}
