import { and, eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export type ImportOwnerMatch =
  | { kind: "one"; userId: string }
  | { kind: "none" }
  | { kind: "many" };

export async function resolveImportOwner(
  db: DbOrTx,
  value: string,
  signal: AbortSignal,
): Promise<ImportOwnerMatch> {
  const needle = value.trim();
  const byEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), sql`lower(${users.email}) = lower(${needle})`));
  signal.throwIfAborted();
  const [email, extraEmail] = byEmail;
  if (email !== undefined) {
    return extraEmail === undefined ? { kind: "one", userId: email.id } : { kind: "many" };
  }
  const byName = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), sql`lower(${users.name}) = lower(${needle})`));
  signal.throwIfAborted();
  const [name, extraName] = byName;
  if (name === undefined) return { kind: "none" };
  return extraName === undefined ? { kind: "one", userId: name.id } : { kind: "many" };
}
