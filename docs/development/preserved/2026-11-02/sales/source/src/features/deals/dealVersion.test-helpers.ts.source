import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { deals } from "@/db/schema/deals";
import type { DbOrTx } from "@/server/realtime/channelVersions";

// Fixture arrangement only. Production must retain the token from its displayed snapshot.
export async function observeDealVersion(db: DbOrTx, dealId: string): Promise<string> {
  const [row] = await db
    .select({ writeVersion: deals.writeVersion })
    .from(deals)
    .where(eq(deals.id, dealId));
  assert(row !== undefined, "version fixture deal is missing");
  return row.writeVersion;
}
