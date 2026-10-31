import { eq, sql } from "drizzle-orm";
import { deals, leads, organizations, persons } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export type OwnedImportEntity = "deal" | "lead" | "person" | "organization";

export async function assignImportedOwner(
  tx: DbOrTx,
  entity: OwnedImportEntity,
  id: string,
  ownerId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const set = { ownerId, updatedAt: sql`now()` };
  if (entity === "deal") await tx.update(deals).set(set).where(eq(deals.id, id));
  else if (entity === "lead") await tx.update(leads).set(set).where(eq(leads.id, id));
  else if (entity === "person") await tx.update(persons).set(set).where(eq(persons.id, id));
  else await tx.update(organizations).set(set).where(eq(organizations.id, id));
}
