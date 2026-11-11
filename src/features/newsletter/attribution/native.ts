import { createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import {
  type CurrentNativeActor,
  currentNativeActor,
  type NativeSessionRef,
} from "@/features/auth/currentNativeActor";
import { isLeadVisibleToSession } from "@/features/leads/createdVisibility";
import { createLead, type LeadSession } from "@/features/leads/leadActions";
import { newsletterExposureReceipts, newsletterLeadSources } from "./schema";
import { attributionBindings, readExactNewsletterExposure } from "./service";

type CreateInput = {
  personId: string;
  bindingId: string;
  deliveryId: string;
  operationId: string;
  title: string;
};

function leadSession(current: CurrentNativeActor): LeadSession {
  const { actor } = current;
  return {
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
    primaryVisibilityGroupId: current.primaryVisibilityGroupId,
    flags: Object.fromEntries([...actor.flags].map((flag) => [flag, true])),
  };
}

async function authorizedBinding(
  tx: Db,
  who: NativeSessionRef,
  input: CreateInput,
  signal: AbortSignal,
  lock: boolean,
) {
  const current = await currentNativeActor(tx, who, signal);
  if (current === null) throw new TRPCError({ code: "FORBIDDEN" });
  const session = leadSession(current);
  if (!session.isAdmin && session.flags["deal.create"] !== true)
    throw new TRPCError({ code: "FORBIDDEN" });
  const bindings = await attributionBindings(tx, current.actor, input.personId, signal, lock);
  if (!bindings.includes(input.bindingId)) throw new TRPCError({ code: "NOT_FOUND" });
  return session;
}

async function recoverLead(
  tx: Db,
  session: LeadSession,
  input: CreateInput,
  fingerprint: string,
  signal: AbortSignal,
) {
  const [previous] = await tx
    .select({
      id: newsletterLeadSources.leadId,
      fingerprint: newsletterLeadSources.intentFingerprint,
    })
    .from(newsletterLeadSources)
    .where(
      and(
        eq(newsletterLeadSources.actorId, session.userId),
        eq(newsletterLeadSources.operationId, input.operationId),
      ),
    );
  if (previous === undefined) return undefined;
  if (previous.fingerprint !== fingerprint) throw new TRPCError({ code: "CONFLICT" });
  return {
    id: (await isLeadVisibleToSession(tx, session, previous.id, signal)) ? previous.id : null,
  };
}

export async function createLeadFromNewsletterExposure(
  db: Db,
  who: NativeSessionRef,
  input: CreateInput,
  signal: AbortSignal,
): Promise<{ id: string | null }> {
  const fingerprint = createHmac("sha256", Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"))
    .update(
      JSON.stringify([
        "warpdrive.newsletter.attribution.create-lead.v1",
        who.userId,
        input.operationId,
        input.personId,
        input.bindingId,
        input.deliveryId,
        input.title,
      ]),
    )
    .digest("hex");
  const previous = await withCurrentAuthority(db, "read", signal, async (tx) => {
    const session = await authorizedBinding(tx, who, input, signal, false);
    return recoverLead(tx, session, input, fingerprint, signal);
  });
  if (previous !== undefined) return previous;

  const proof = await readExactNewsletterExposure(input.bindingId, input.deliveryId, signal);
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`newsletter-attribution:${who.userId}:${input.operationId}`}, 0))`,
    );
    const session = await authorizedBinding(tx, who, input, signal, true);
    const replay = await recoverLead(tx, session, input, fingerprint, signal);
    if (replay !== undefined) return replay;
    await tx
      .insert(newsletterExposureReceipts)
      .values({
        id: proof.deliveryId,
        personId: input.personId,
        linkId: proof.bindingId,
        campaignId: proof.campaignId,
        grantId: proof.grantId,
        purposeListId: proof.purposeListId,
        acceptedAt: proof.acceptedAt,
      })
      .onConflictDoNothing({ target: newsletterExposureReceipts.id });
    const [stored] = await tx
      .select()
      .from(newsletterExposureReceipts)
      .where(eq(newsletterExposureReceipts.id, proof.deliveryId));
    if (
      stored === undefined ||
      stored.personId !== input.personId ||
      stored.linkId !== proof.bindingId ||
      stored.campaignId !== proof.campaignId ||
      stored.grantId !== proof.grantId ||
      stored.purposeListId !== proof.purposeListId ||
      stored.acceptedAt.getTime() !== proof.acceptedAt.getTime()
    )
      throw new TRPCError({ code: "CONFLICT" });
    const lead = await createLead(
      tx,
      session,
      {
        title: input.title,
        personId: input.personId,
        sourceChannel: "campaign",
        sourceChannelId: String(proof.campaignId),
        newsletterExposureId: proof.deliveryId,
      },
      signal,
    );
    if (!lead.ok) throw new TRPCError({ code: "PRECONDITION_FAILED" });
    await tx
      .update(newsletterLeadSources)
      .set({
        actorId: session.userId,
        operationId: input.operationId,
        intentFingerprint: fingerprint,
      })
      .where(eq(newsletterLeadSources.leadId, lead.value.id));
    return {
      id: (await isLeadVisibleToSession(tx, session, lead.value.id, signal)) ? lead.value.id : null,
    };
  });
}
