import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { calendarProviderAccounts } from "@/db/schema/calendarProviderAccounts";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok } from "@/types/result";

const accountIdSchema = z.uuid();
export async function activeCalendarOwner(
  db: DbOrTx,
  userId: string,
  signal: AbortSignal,
  lock = false,
) {
  signal.throwIfAborted();
  if (!accountIdSchema.safeParse(userId).success) return err({ kind: "not_found" as const });
  const query = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)));
  const [owner] = lock ? await query.for("update") : await query;
  signal.throwIfAborted();
  return owner === undefined ? err({ kind: "not_found" as const }) : ok(owner);
}
export async function ownedCalendarAccount(
  db: DbOrTx,
  userId: string,
  accountId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!accountIdSchema.safeParse(userId).success || !accountIdSchema.safeParse(accountId).success)
    return err({ kind: "not_found" as const });
  const [row] = await db
    .select({ account: calendarProviderAccounts })
    .from(calendarProviderAccounts)
    .innerJoin(users, and(eq(users.id, calendarProviderAccounts.userId), eq(users.isActive, true)))
    .where(
      and(eq(calendarProviderAccounts.id, accountId), eq(calendarProviderAccounts.userId, userId)),
    );
  signal.throwIfAborted();
  return row === undefined ? err({ kind: "not_found" as const }) : ok(row.account);
}
