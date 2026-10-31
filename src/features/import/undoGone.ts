import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { activities, deals, leads, notes, organizations, persons } from "@/db/schema";
import type { ImportTarget } from "./wizardState";

const PRIMARY_TABLES = {
  person: persons,
  organization: organizations,
  deal: deals,
  lead: leads,
  activity: activities,
  note: notes,
} as const;

export async function alreadyGone(
  db: Db,
  target: ImportTarget,
  id: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const table = PRIMARY_TABLES[target];
  const [row] = await db.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, id));
  return row === undefined || row.deletedAt !== null;
}
