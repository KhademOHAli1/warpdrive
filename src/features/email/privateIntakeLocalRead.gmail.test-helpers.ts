import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailThreadReads } from "@/db/schema/emailReads";
import { seedUser } from "@/db/testing/factories";
import { threadMailCapabilities } from "./imapThreadOperationsCapabilities";
import { privateReviewProtectedSnapshot } from "./privateIntakeReview.test-helpers";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";
import { hydrateOwner } from "./syncCursor";

export async function privateGmailLocalReadFixture(db: Db, signal: AbortSignal, admin = false) {
  const f = await seedPrivateIntake(db, signal);
  if (admin) await db.execute(sql`UPDATE users SET is_admin=true WHERE id=${f.ownerId}`);
  const actor = await hydrateOwner(db, f.ownerId, signal);
  if (!actor.ok) throw actor.error;
  return { ...f, actor: actor.value, signal };
}

export type PrivateGmailLocalReadFixture = Awaited<ReturnType<typeof privateGmailLocalReadFixture>>;

export async function privateGmailLocalReadRows(db: Db, f: PrivateGmailLocalReadFixture) {
  const rows = await db
    .select({
      thread_id: emailThreadReads.threadId,
      user_id: emailThreadReads.userId,
      read_at: emailThreadReads.readAt,
      read_at_exact: sql<string>`${emailThreadReads.readAt}::text`,
    })
    .from(emailThreadReads)
    .where(eq(emailThreadReads.threadId, f.threadId))
    .orderBy(emailThreadReads.userId);
  f.signal.throwIfAborted();
  return rows;
}

export async function privateGmailLocalReadSnapshot(db: Db, f: PrivateGmailLocalReadFixture) {
  return privateReviewProtectedSnapshot(db, f.accountId, f.signal);
}

export async function privateGmailLocalReadCaps(
  db: Db,
  f: PrivateGmailLocalReadFixture,
  actor = f.actor,
) {
  return (await threadMailCapabilities(db, actor, [f.threadId], f.signal)).get(f.threadId);
}

export async function foreignPrivateGmailReader(db: Db, f: PrivateGmailLocalReadFixture) {
  const user = await seedUser(db, { isAdmin: true });
  const actor = await hydrateOwner(db, user.id, f.signal);
  if (!actor.ok) throw actor.error;
  return actor.value;
}
