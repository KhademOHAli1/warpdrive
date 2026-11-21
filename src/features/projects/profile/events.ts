import type { Db } from "@/db/client";
import { internalProjectItemEvents } from "./schema";

export async function recordProjectItemEvent(
  tx: Db,
  event: Pick<typeof internalProjectItemEvents.$inferInsert, "itemId" | "actorId" | "kind">,
): Promise<void> {
  await tx.insert(internalProjectItemEvents).values(event);
}
