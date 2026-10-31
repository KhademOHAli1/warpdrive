import { and, eq } from "drizzle-orm";
import { importExternalIds } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";

type MergedEntity = "person" | "organization" | "deal";

export async function repointMappings(
  tx: DbOrTx,
  entity: MergedEntity,
  survivorId: string,
  mergedId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await tx
    .update(importExternalIds)
    .set({ localId: survivorId })
    .where(and(eq(importExternalIds.entity, entity), eq(importExternalIds.localId, mergedId)));
}
