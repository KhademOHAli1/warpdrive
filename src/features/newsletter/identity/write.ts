import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { recordAudit } from "@/features/identity/audit";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import {
  newsletterIdentityCommands as commands,
  newsletterPersonEvents as events,
  newsletterPersonAddresses as links,
} from "../schema/personAddresses";
import {
  addressDigest,
  newsletterContactAddresses,
  requireIdentityPermission,
  requireNewsletterPerson,
} from "./authority";
import type { IdentityCommandResult } from "./contracts";
import {
  connectNewsletterIdentity,
  type EngineIdentityChallenge,
  isEngineConflict,
} from "./engine";
import { sharedNewsletterAddresses } from "./linkStore";

type Link = typeof links.$inferSelect;
type Command = typeof commands.$inferSelect;
export type IdentityBeginInput = {
  operationId: string;
  personId: string;
  address: string;
  evidenceReference: string;
};
export type IdentityInviteInput = {
  operationId: string;
  personId: string;
  linkId: string;
  listId: number;
  originRunId?: string;
};

export function withNewsletterIdentityActor<T>(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  access: "view" | "consent" | "operate",
  run: (tx: Db, actor: PermSetUser) => Promise<T>,
): Promise<T> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const current = await hydrateActor(tx, actor.id, signal);
    if (current === null) throw new TRPCError({ code: "FORBIDDEN" });
    requireIdentityPermission(current, access);
    return run(tx, current);
  });
}

async function commandAudit(
  db: Db,
  actor: PermSetUser,
  action: string,
  operationId: string,
  signal: AbortSignal,
) {
  await recordAudit(
    db,
    {
      actorId: actor.id,
      targetType: "settings",
      targetId: null,
      action: `newsletter.identity.${action}`,
      correlationId: operationId,
      after: { outcome: "requested" },
    },
    signal,
  );
}

function requireDelivery() {
  if (!env.NEWSLETTER_DELIVERY_ENABLED)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Newsletter delivery is disabled.",
    });
}

function changed(): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message: "The newsletter identity or consent changed.",
  });
}

function linkAddress(link: Link, emails: readonly { value: string }[]): string {
  const address = newsletterContactAddresses(emails).find((item) =>
    addressDigest(item).equals(link.addressDigest),
  );
  if (address === undefined) throw changed();
  return address;
}

async function getLink(db: Db, personId: string, linkId: string): Promise<Link> {
  const [link] = await db
    .select()
    .from(links)
    .where(and(eq(links.id, linkId), eq(links.personId, personId)));
  if (link === undefined) throw new TRPCError({ code: "NOT_FOUND" });
  return link;
}

function linkState(link: Link): IdentityCommandResult {
  if (link.detachedAt !== null)
    return { id: link.id, state: link.detachedReason === "suppressed" ? "suppressed" : "detached" };
  if (link.verifiedAt !== null) return { id: link.id, state: "verified" };
  return { id: link.id, state: link.expiresAt <= new Date() ? "expired" : "pending" };
}

async function updateProof(
  db: Db,
  link: Link,
  proof: EngineIdentityChallenge,
): Promise<IdentityCommandResult> {
  if (
    proof.id !== link.id ||
    proof.bindingId !== link.id ||
    proof.purpose !== "identity" ||
    !addressDigest(proof.email).equals(link.addressDigest)
  )
    throw changed();
  const state = linkState(link);
  if (state.state === "detached" || state.state === "verified") return state;
  if (proof.state === "verified" && proof.verifiedAt !== null) {
    await db
      .update(links)
      .set({
        subscriberId: proof.subscriberId,
        subscriberUuid: proof.subscriberUuid,
        verifiedAt: proof.verifiedAt,
        expiresAt: proof.expiresAt,
      })
      .where(eq(links.id, link.id));
    await db
      .insert(events)
      .values({
        id: link.id,
        linkId: link.id,
        event: "newsletter.identity.verified",
        occurredAt: proof.verifiedAt,
      })
      .onConflictDoNothing();
    return { id: link.id, state: "verified" };
  }
  if (proof.state === "expired" || proof.state === "detached") {
    await db
      .update(links)
      .set({
        expiresAt: proof.expiresAt,
        detachedAt: sql`clock_timestamp()`,
        detachedReason: proof.state === "expired" ? "expired" : "operator",
      })
      .where(eq(links.id, link.id));
    return { id: link.id, state: proof.state };
  }
  await db.update(links).set({ expiresAt: proof.expiresAt }).where(eq(links.id, link.id));
  return { id: link.id, state: "pending" };
}

export async function beginNewsletterProof(
  db: Db,
  actor: PermSetUser,
  input: IdentityBeginInput,
  signal: AbortSignal,
): Promise<IdentityCommandResult> {
  requireDelivery();
  await withNewsletterIdentityActor(db, actor, signal, "consent", async (tx, current) => {
    const person = await requireNewsletterPerson(tx, current, input.personId, signal, true);
    if (!newsletterContactAddresses(person.emails).includes(input.address)) throw changed();
    const digest = addressDigest(input.address);
    const [prior] = await tx.select().from(links).where(eq(links.id, input.operationId));
    if (prior !== undefined) {
      if (
        prior.actorId !== actor.id ||
        prior.personId !== person.id ||
        !prior.addressDigest.equals(digest) ||
        prior.evidenceReference !== input.evidenceReference
      )
        throw changed();
      return;
    }
    // An elapsed local clock is not evidence that the engine never confirmed the old claim.
    const [inserted] = await tx
      .insert(links)
      .values({
        id: input.operationId,
        personId: person.id,
        addressDigest: digest,
        actorId: actor.id,
        evidenceReference: input.evidenceReference,
        expiresAt: sql`clock_timestamp() + interval '31 minutes'`,
      })
      .onConflictDoNothing()
      .returning({ id: links.id });
    if (inserted === undefined) throw changed();
    await commandAudit(tx, current, "beginProof", input.operationId, signal);
  });
  return withNewsletterIdentityActor(db, actor, signal, "consent", async (tx, current) => {
    const person = await requireNewsletterPerson(tx, current, input.personId, signal, true);
    const link = await getLink(tx, person.id, input.operationId);
    const state = linkState(link);
    if (state.state !== "pending") return state;
    const email = linkAddress(link, person.emails);
    let result: EngineIdentityChallenge;
    try {
      const engine = await connectNewsletterIdentity(signal);
      result = await engine.issue({
        id: link.id,
        bindingId: link.id,
        purpose: "identity",
        email,
        listId: null,
      });
    } catch (error) {
      if (!isEngineConflict(error)) return { id: link.id, state: "unknown" };
      await tx
        .update(links)
        .set({ detachedAt: sql`clock_timestamp()`, detachedReason: "suppressed" })
        .where(eq(links.id, link.id));
      return { id: link.id, state: "suppressed" };
    }
    return updateProof(tx, link, result);
  });
}

async function reserveInvite(
  db: Db,
  actor: PermSetUser,
  input: IdentityInviteInput,
  signal: AbortSignal,
) {
  return withNewsletterIdentityActor(db, actor, signal, "consent", async (tx, current) => {
    const person = await requireNewsletterPerson(tx, current, input.personId, signal, true);
    const link = await getLink(tx, person.id, input.linkId);
    const [prior] = await tx.select().from(commands).where(eq(commands.id, input.operationId));
    if (prior !== undefined) {
      if (
        prior.kind !== "invite" ||
        prior.actorId !== actor.id ||
        prior.linkId !== link.id ||
        prior.listId !== input.listId ||
        prior.originRunId !== (input.originRunId ?? null)
      )
        throw changed();
      return;
    }
    linkAddress(link, person.emails);
    if (
      link.verifiedAt === null ||
      link.detachedAt !== null ||
      (await sharedNewsletterAddresses(tx, [link.addressDigest])).size > 0
    )
      throw changed();
    const [inserted] = await tx
      .insert(commands)
      .values({
        id: input.operationId,
        linkId: link.id,
        actorId: actor.id,
        kind: "invite",
        listId: input.listId,
        originRunId: input.originRunId,
      })
      .onConflictDoNothing()
      .returning({ id: commands.id });
    if (inserted === undefined) throw changed();
    await commandAudit(tx, current, "invite", input.operationId, signal);
  });
}

async function finishInvite(
  db: Db,
  command: Command,
  state: "confirmed" | "expired" | "detached" | "suppressed",
  at = new Date(),
) {
  const [updated] = await db
    .update(commands)
    .set({ state, resolvedAt: at })
    .where(and(eq(commands.id, command.id), eq(commands.state, "pending")))
    .returning({ id: commands.id });
  if (updated !== undefined && state === "confirmed") {
    await db
      .insert(events)
      .values({
        id: command.id,
        linkId: command.linkId,
        listId: command.listId,
        originRunId: command.originRunId,
        event: "newsletter.consent.confirmed",
        occurredAt: at,
      })
      .onConflictDoNothing();
  }
}

async function updateInvite(
  db: Db,
  command: Command,
  link: Link,
  proof: EngineIdentityChallenge,
): Promise<IdentityCommandResult> {
  if (
    proof.id !== command.id ||
    proof.bindingId !== link.id ||
    proof.purpose !== "newsletter" ||
    proof.subscriberId !== link.subscriberId ||
    proof.subscriberUuid !== link.subscriberUuid ||
    proof.listId !== command.listId ||
    !addressDigest(proof.email).equals(link.addressDigest)
  )
    throw changed();
  if (proof.state === "confirmed" && proof.verifiedAt !== null) {
    await finishInvite(db, command, "confirmed", proof.verifiedAt);
    return { id: command.id, state: "confirmed" };
  }
  if (proof.state === "expired" || proof.state === "detached") {
    await finishInvite(db, command, proof.state);
    return { id: command.id, state: proof.state };
  }
  return { id: command.id, state: "pending" };
}

export async function requestNewsletterInvite(
  db: Db,
  actor: PermSetUser,
  input: IdentityInviteInput,
  signal: AbortSignal,
): Promise<IdentityCommandResult> {
  requireDelivery();
  await reserveInvite(db, actor, input, signal);
  return withNewsletterIdentityActor(db, actor, signal, "consent", async (tx, current) => {
    const person = await requireNewsletterPerson(tx, current, input.personId, signal, true);
    const link = await getLink(tx, person.id, input.linkId);
    const [command] = await tx.select().from(commands).where(eq(commands.id, input.operationId));
    if (command === undefined || command.linkId !== link.id) throw changed();
    if (command.state !== "pending") return { id: command.id, state: command.state };
    if (link.detachedAt !== null || link.verifiedAt === null) {
      await finishInvite(tx, command, "detached");
      return { id: command.id, state: "detached" };
    }
    const email = linkAddress(link, person.emails);
    let result: EngineIdentityChallenge;
    try {
      const engine = await connectNewsletterIdentity(signal);
      result = await engine.issue({
        id: command.id,
        bindingId: link.id,
        purpose: "newsletter",
        email,
        listId: input.listId,
      });
    } catch (error) {
      if (!isEngineConflict(error)) return { id: command.id, state: "unknown" };
      await finishInvite(tx, command, "suppressed");
      return { id: command.id, state: "suppressed" };
    }
    return updateInvite(tx, command, link, result);
  });
}

export async function reconcileNewsletterIdentity(
  db: Db,
  actor: PermSetUser,
  personId: string,
  claimId: string,
  signal: AbortSignal,
): Promise<IdentityCommandResult> {
  return withNewsletterIdentityActor(db, actor, signal, "consent", async (tx, current) => {
    const person = await requireNewsletterPerson(tx, current, personId, signal, true);
    const [command] = await tx.select().from(commands).where(eq(commands.id, claimId));
    const link = await getLink(tx, person.id, command?.linkId ?? claimId);
    if (command !== undefined && command.state !== "pending")
      return { id: command.id, state: command.state };
    if (command?.kind === "erase") return { id: command.id, state: "unknown" };
    if (link.detachedAt !== null || (command === undefined && link.verifiedAt !== null))
      return linkState(link);
    linkAddress(link, person.emails);
    let result: EngineIdentityChallenge | null;
    try {
      result = await (await connectNewsletterIdentity(signal)).challenge(claimId);
    } catch {
      return { id: claimId, state: "unknown" };
    }
    if (result === null) {
      const expiresAt =
        command === undefined
          ? link.expiresAt.getTime()
          : command.createdAt.getTime() + 31 * 60_000;
      if (expiresAt > Date.now()) return { id: claimId, state: "unknown" };
      if (command === undefined) {
        await tx
          .update(links)
          .set({ detachedAt: sql`clock_timestamp()`, detachedReason: "expired" })
          .where(eq(links.id, link.id));
      } else {
        await finishInvite(tx, command, "expired");
      }
      return { id: claimId, state: "expired" };
    }
    return command === undefined
      ? updateProof(tx, link, result)
      : updateInvite(tx, command, link, result);
  });
}
