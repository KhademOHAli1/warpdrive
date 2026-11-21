import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { assetCommissioningHandoffs } from "./schema";

export async function isCommissionedStock(tx: Db, positionId: string): Promise<boolean> {
  const [handoff] = await tx
    .select({ id: assetCommissioningHandoffs.id })
    .from(assetCommissioningHandoffs)
    .where(eq(assetCommissioningHandoffs.positionId, positionId));
  return handoff !== undefined;
}

export async function commissionedAssetSerial(tx: Db, assetId: string): Promise<string | null> {
  const [handoff] = await tx
    .select({ serial: assetCommissioningHandoffs.serial })
    .from(assetCommissioningHandoffs)
    .where(eq(assetCommissioningHandoffs.assetId, assetId));
  return handoff?.serial ?? null;
}
