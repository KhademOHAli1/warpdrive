import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import {
  newsletterIdentityCommands as commands,
  newsletterPersonEvents as events,
  newsletterPersonAddresses as links,
} from "../schema/personAddresses";
import { requireIdentityPermission, requireNewsletterPerson } from "./authority";
import type { PersonNewsletterEvent } from "./contracts";
import { reconcileNewsletterIdentity } from "./write";

const projection = {
  id: events.id,
  personId: links.personId,
  linkId: events.linkId,
  listId: events.listId,
  event: events.event,
  occurredAt: events.occurredAt,
  originRunId: events.originRunId,
};

export async function listPersonNewsletterEvents(
  db: Db,
  actor: PermSetUser,
  personId: string,
  signal: AbortSignal,
): Promise<PersonNewsletterEvent[]> {
  requireIdentityPermission(actor, "view");
  await requireNewsletterPerson(db, actor, personId, signal);
  return db
    .select(projection)
    .from(events)
    .innerJoin(links, eq(links.id, events.linkId))
    .where(eq(links.personId, personId))
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(50);
}

/** A worker may deliver an event again after a lost ack; the consumer deduplicates its event UUID. */
export async function drainNewsletterIdentityEvents(
  db: Db,
  consume: (event: PersonNewsletterEvent) => Promise<void>,
  signal: AbortSignal,
): Promise<number> {
  const rows = await db
    .select(projection)
    .from(events)
    .innerJoin(links, eq(links.id, events.linkId))
    .where(isNull(events.deliveredAt))
    .orderBy(asc(events.occurredAt), asc(events.id))
    .limit(30);
  let delivered = 0;
  for (const event of rows) {
    signal.throwIfAborted();
    await consume(event);
    await db
      .update(events)
      .set({ deliveredAt: sql`clock_timestamp()` })
      .where(and(eq(events.id, event.id), isNull(events.deliveredAt)));
    delivered += 1;
  }
  return delivered;
}

/** Only read engine proof for previously authorized claims; this path never issues mail. */
export async function synchronizeNewsletterIdentity(db: Db, signal: AbortSignal): Promise<void> {
  const [proofs, invites] = await Promise.all([
    db
      .select({ id: links.id, actorId: links.actorId, personId: links.personId })
      .from(links)
      .where(
        and(
          isNull(links.verifiedAt),
          isNull(links.detachedAt),
          lt(links.nextCheckAt, sql`clock_timestamp()`),
        ),
      )
      .orderBy(asc(links.nextCheckAt), asc(links.id))
      .limit(15),
    db
      .select({ id: commands.id, actorId: commands.actorId, personId: links.personId })
      .from(commands)
      .innerJoin(links, eq(links.id, commands.linkId))
      .where(
        and(
          eq(commands.kind, "invite"),
          eq(commands.state, "pending"),
          lt(commands.nextCheckAt, sql`clock_timestamp()`),
        ),
      )
      .orderBy(asc(commands.nextCheckAt), asc(commands.id))
      .limit(15),
  ]);
  await Promise.allSettled([
    ...proofs.map(async (row) => {
      await db
        .update(links)
        .set({ nextCheckAt: sql`clock_timestamp() + interval '30 seconds'` })
        .where(eq(links.id, row.id));
      await synchronizeClaim(db, row, signal);
    }),
    ...invites.map(async (row) => {
      await db
        .update(commands)
        .set({ nextCheckAt: sql`clock_timestamp() + interval '30 seconds'` })
        .where(eq(commands.id, row.id));
      await synchronizeClaim(db, row, signal);
    }),
  ]);
}

async function synchronizeClaim(
  db: Db,
  row: { id: string; actorId: string; personId: string },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const actor = await hydrateActor(db, row.actorId, signal);
  if (actor !== null) await reconcileNewsletterIdentity(db, actor, row.personId, row.id, signal);
}
