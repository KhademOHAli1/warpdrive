import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, leads, privacyCases, privacyCaseVerifications } from "@/db/schema";
import { recordAudit } from "@/features/identity/audit";
import type { PermSetUser } from "@/features/permissions/effective";
import { privacyIntakeSchema } from "@/features/privacy/caseSchemas";
import { decodeIdentity } from "@/features/privacy/identityPersistence";
import {
  type PrivacyActor,
  type PrivacyAuthorityTicket,
  withPrivacyAuthority,
} from "@/features/privacy/permissions";
import { ok } from "@/types/result";
import {
  newsletterDealSources,
  newsletterExposureReceipts,
  newsletterLeadSources,
} from "../attribution/schema";
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
import { connectNewsletterIdentity, type EngineErasureReceipt } from "./engine";
import { sharedNewsletterAddresses } from "./linkStore";

export type ErasureCommand = {
  operationId: string;
  personId: string;
  linkId: string;
  privacyCaseId: string;
};

function forbidden(): TRPCError {
  return new TRPCError({ code: "FORBIDDEN" });
}

async function caseRecipient(db: Db, input: ErasureCommand) {
  const [row] = await db
    .select({ case: privacyCases, proof: privacyCaseVerifications })
    .from(privacyCases)
    .innerJoin(privacyCaseVerifications, eq(privacyCases.id, privacyCaseVerifications.caseId))
    .where(eq(privacyCases.id, input.privacyCaseId));
  if (
    row === undefined ||
    row.case.kind !== "erasure" ||
    !["under_review", "action_approved", "running", "needs_attention"].includes(row.case.status) ||
    row.proof.subjectKind !== "contact" ||
    row.proof.subjectReferenceId !== input.personId
  )
    throw forbidden();
  const recipient = decodeIdentity(
    row.proof.recipientEnc,
    privacyIntakeSchema.shape.recipient,
    input.privacyCaseId,
  );
  if (!recipient.ok || recipient.value.channel !== "email") throw forbidden();
  return recipient.value.address;
}

async function erasureScope(
  db: Db,
  actor: PermSetUser,
  input: ErasureCommand,
  signal: AbortSignal,
) {
  const person = await requireNewsletterPerson(db, actor, input.personId, signal, true);
  const [link] = await db
    .select()
    .from(links)
    .where(and(eq(links.id, input.linkId), eq(links.personId, person.id)));
  if (link === undefined || link.verifiedAt === null || link.detachedAt !== null) throw forbidden();
  const recipient = await caseRecipient(db, input);
  if (
    !addressDigest(recipient).equals(link.addressDigest) ||
    !newsletterContactAddresses(person.emails).some((address) =>
      addressDigest(address).equals(link.addressDigest),
    ) ||
    (await sharedNewsletterAddresses(db, [link.addressDigest])).size > 0
  )
    throw forbidden();
  return link;
}

function sameApproval(
  command: typeof commands.$inferSelect,
  input: ErasureCommand,
  ticket: PrivacyAuthorityTicket,
) {
  return (
    command.kind === "erase" &&
    command.linkId === input.linkId &&
    command.privacyCaseId === input.privacyCaseId &&
    command.approvedScopeVersion === ticket.scopeVersion &&
    command.approvedRecipientVersion === ticket.recipientVersion &&
    command.approvedVerificationVersion === ticket.verificationVersion
  );
}

async function eraseNewsletterAttribution(tx: Db, linkId: string) {
  const scoped = eq(newsletterExposureReceipts.linkId, linkId);
  const scopedLeads = tx
    .select({ id: newsletterLeadSources.leadId })
    .from(newsletterLeadSources)
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterLeadSources.exposureId),
    )
    .where(scoped);
  // Conversion locks its lead before carrying lineage. Read deal sources only after that fence.
  await tx
    .select({ id: leads.id })
    .from(leads)
    .where(inArray(leads.id, scopedLeads))
    .orderBy(asc(leads.id))
    .for("no key update");
  const scopedDeals = tx
    .select({ id: newsletterDealSources.dealId })
    .from(newsletterDealSources)
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterDealSources.exposureId),
    )
    .where(scoped);
  // Win recording follows the deal update. Wait for any in-flight transition before removing lineage.
  await tx
    .select({ id: deals.id })
    .from(deals)
    .where(inArray(deals.id, scopedDeals))
    .orderBy(asc(deals.id))
    .for("no key update");
  await tx
    .update(leads)
    .set({
      sourceChannel: null,
      sourceChannelId: null,
      updatedAt: sql`greatest(clock_timestamp(), ${leads.updatedAt} + interval '1 millisecond')`,
    })
    .from(newsletterLeadSources)
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterLeadSources.exposureId),
    )
    .where(
      and(
        scoped,
        eq(leads.id, newsletterLeadSources.leadId),
        eq(leads.sourceChannel, "campaign"),
        eq(leads.sourceChannelId, sql`${newsletterExposureReceipts.campaignId}::text`),
      ),
    );
  await tx
    .update(deals)
    .set({
      sourceChannel: null,
      sourceChannelId: null,
      updatedAt: sql`greatest(clock_timestamp(), ${deals.updatedAt} + interval '1 millisecond')`,
    })
    .from(newsletterDealSources)
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterDealSources.exposureId),
    )
    .where(
      and(
        scoped,
        eq(deals.id, newsletterDealSources.dealId),
        eq(deals.sourceChannel, "campaign"),
        eq(deals.sourceChannelId, sql`${newsletterExposureReceipts.campaignId}::text`),
      ),
    );
  // Exposure deletion cascades only to newsletter Lead/Deal sources and attributed wins.
  await tx.delete(newsletterExposureReceipts).where(scoped);
}

async function auditErasure(
  db: Db,
  actor: PermSetUser,
  input: ErasureCommand,
  outcome: "requested" | "succeeded",
  signal: AbortSignal,
) {
  await recordAudit(
    db,
    {
      actorId: actor.id,
      targetType: "settings",
      targetId: null,
      action: "newsletter.identity.erase",
      correlationId: input.operationId,
      after: { outcome },
    },
    signal,
  );
}

export async function approveNewsletterErasure(
  db: Db,
  actor: PermSetUser,
  privacyActor: PrivacyActor,
  input: ErasureCommand,
  signal: AbortSignal,
): Promise<IdentityCommandResult> {
  requireIdentityPermission(actor, "operate");
  const result = await withPrivacyAuthority(
    db,
    privacyActor,
    { capability: "case.erase.approve", caseId: input.privacyCaseId },
    signal,
    async (tx, ticket) => {
      const [existing] = await tx.select().from(commands).where(eq(commands.id, input.operationId));
      if (existing !== undefined) {
        if (!sameApproval(existing, input, ticket) || existing.actorId !== actor.id)
          throw forbidden();
        await requireNewsletterPerson(tx, actor, input.personId, signal, true);
        const [target] = await tx
          .select({ personId: links.personId })
          .from(links)
          .where(eq(links.id, existing.linkId));
        if (target?.personId !== input.personId) throw forbidden();
        return ok<IdentityCommandResult>({ id: existing.id, state: existing.state });
      }
      const link = await erasureScope(tx, actor, input, signal);
      await tx.insert(commands).values({
        id: input.operationId,
        linkId: link.id,
        actorId: actor.id,
        kind: "erase",
        privacyCaseId: input.privacyCaseId,
        approvedScopeVersion: ticket.scopeVersion,
        approvedRecipientVersion: ticket.recipientVersion,
        approvedVerificationVersion: ticket.verificationVersion,
      });
      await auditErasure(tx, actor, input, "requested", signal);
      return ok<IdentityCommandResult>({ id: input.operationId, state: "pending" });
    },
  );
  if (!result.ok) throw forbidden();
  return result.value;
}

export async function executeNewsletterErasure(
  db: Db,
  actor: PermSetUser,
  privacyActor: PrivacyActor,
  input: ErasureCommand,
  signal: AbortSignal,
): Promise<IdentityCommandResult> {
  requireIdentityPermission(actor, "operate");
  const result = await withPrivacyAuthority(
    db,
    privacyActor,
    { capability: "case.erase.execute", caseId: input.privacyCaseId },
    signal,
    async (tx, ticket) => {
      const [approval] = await tx
        .select()
        .from(commands)
        .where(eq(commands.id, input.operationId))
        .for("update");
      if (approval === undefined || !sameApproval(approval, input, ticket)) throw forbidden();
      await requireNewsletterPerson(tx, actor, input.personId, signal, true);
      const [approvedLink] = await tx
        .select({ personId: links.personId })
        .from(links)
        .where(eq(links.id, approval.linkId));
      if (approvedLink?.personId !== input.personId) throw forbidden();
      if (approval.state === "erased")
        return ok<IdentityCommandResult>({ id: approval.id, state: "erased" });
      let engine: Awaited<ReturnType<typeof connectNewsletterIdentity>>;
      let receipt: EngineErasureReceipt | null;
      try {
        engine = await connectNewsletterIdentity(signal);
        receipt = await engine.erasure(input.operationId);
      } catch {
        return ok<IdentityCommandResult>({ id: approval.id, state: "unknown" });
      }
      if (receipt === null) {
        await erasureScope(tx, actor, input, signal);
        try {
          receipt = await engine.erase(input.operationId, approval.linkId);
        } catch {
          return ok<IdentityCommandResult>({ id: approval.id, state: "unknown" });
        }
      }
      if (receipt.id !== input.operationId || receipt.bindingId !== approval.linkId)
        throw forbidden();
      await eraseNewsletterAttribution(tx, approval.linkId);
      await tx.delete(events).where(eq(events.linkId, approval.linkId));
      await tx
        .delete(commands)
        .where(and(eq(commands.linkId, approval.linkId), ne(commands.id, approval.id)));
      await tx
        .update(links)
        .set({
          addressDigest: randomBytes(32),
          subscriberId: null,
          subscriberUuid: null,
          verifiedAt: null,
          detachedAt: receipt.erasedAt,
          detachedReason: "erasure",
        })
        .where(eq(links.id, approval.linkId));
      await tx
        .update(commands)
        .set({ state: "erased", resolvedAt: receipt.erasedAt })
        .where(eq(commands.id, approval.id));
      await auditErasure(tx, actor, input, "succeeded", signal);
      return ok<IdentityCommandResult>({ id: approval.id, state: "erased" });
    },
  );
  if (!result.ok) throw forbidden();
  return result.value;
}
