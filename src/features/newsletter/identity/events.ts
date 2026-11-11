import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { persons } from "@/db/schema/persons";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import {
  newsletterIdentityCommands as commands,
  newsletterPersonEvents as events,
  newsletterPersonAddresses as links,
} from "../schema/personAddresses";
import { requireIdentityPermission, requireNewsletterPerson } from "./authority";
import type { PersonNewsletterEvent } from "./contracts";
import { connectNewsletterIdentity, type EngineConsentRevocation } from "./engine";
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
  await synchronizeNewsletterRevocations(db, signal);
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

function scopeDigest(
  row: { subscriberId: number | null; subscriberUuid: string | null },
  event: EngineConsentRevocation,
): string {
  return createHash("sha256")
    .update(
      [
        event.bindingUuid,
        event.grantUuid,
        row.subscriberId,
        row.subscriberUuid,
        event.purposeListId,
      ].join(":"),
    )
    .digest("hex");
}

async function persistRevocation(db: Db, event: EngineConsentRevocation): Promise<void> {
  await db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ personId: links.personId })
      .from(links)
      .where(eq(links.id, event.bindingUuid));
    if (reference === undefined) return; // An erased Person is a terminal orphan.
    // Read the link and invite again after the Person fence so completed erasure cannot be repopulated.
    const [person] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, reference.personId))
      .for("update");
    if (person === undefined) return;
    const [scope] = await tx
      .select({ link: links, command: commands })
      .from(links)
      .innerJoin(commands, eq(commands.linkId, links.id))
      .where(
        and(
          eq(links.id, event.bindingUuid),
          eq(links.personId, person.id),
          eq(commands.id, event.grantUuid),
          eq(commands.kind, "invite"),
          eq(commands.listId, event.purposeListId),
        ),
      );
    if (
      scope === undefined ||
      scope.link.detachedReason === "erasure" ||
      scope.link.subscriberId === null ||
      scope.link.subscriberUuid === null ||
      scopeDigest(scope.link, event) !== event.scopeDigest
    )
      return;
    const [stored] = await tx
      .insert(events)
      .values({
        id: event.id,
        linkId: scope.link.id,
        listId: event.purposeListId,
        event: "newsletter.consent.revoked",
        occurredAt: event.occurredAt,
        grantId: event.grantUuid,
        sourceDigest: event.scopeDigest,
      })
      .onConflictDoNothing()
      .returning({ id: events.id });
    if (stored === undefined) {
      const [prior] = await tx.select().from(events).where(eq(events.id, event.id));
      if (
        prior?.event !== "newsletter.consent.revoked" ||
        prior.linkId !== event.bindingUuid ||
        prior.listId !== event.purposeListId ||
        prior.grantId !== event.grantUuid ||
        prior.sourceDigest !== event.scopeDigest ||
        prior.occurredAt.getTime() !== event.occurredAt.getTime()
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Newsletter consent event scope changed",
        });
    }
    // A lost confirmation acknowledgement must never later project consent after its revocation.
    await tx
      .update(commands)
      .set({ state: "suppressed", resolvedAt: event.occurredAt })
      .where(and(eq(commands.id, event.grantUuid), eq(commands.state, "pending")));
  });
}

/** The engine records facts for an already-authorized invite; delivery never grants actor authority. */
export async function synchronizeNewsletterRevocations(db: Db, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const engine = await connectNewsletterIdentity(signal);
  const pending = await engine.revocations();
  for (const event of pending) {
    signal.throwIfAborted();
    await persistRevocation(db, event);
  }
  // Acknowledgement follows committed persistence (or a terminal erased/orphan/unrelated decision).
  // If it is lost, the engine replays the same UUID and the local insert validates its prior scope.
  if (pending.length > 0) await engine.acknowledgeRevocations(pending.map(({ id }) => id));
}
