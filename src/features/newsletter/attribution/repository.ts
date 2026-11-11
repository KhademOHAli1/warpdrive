import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { Deal } from "@/db/schema/deals";
import { persons } from "@/db/schema/persons";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import {
  addressDigest,
  newsletterContactAddresses,
  requireNewsletterPerson,
} from "../identity/authority";
import { sharedNewsletterAddresses } from "../identity/linkStore";
import { hasNewsletterPermission } from "../permissions";
import { newsletterPersonAddresses } from "../schema/personAddresses";
import {
  newsletterAttributedWins,
  newsletterDealSources,
  newsletterExposureReceipts,
  newsletterLeadSources,
} from "./schema";

type Exposure = typeof newsletterExposureReceipts.$inferSelect;

export async function authorizeNewsletterExposure(
  db: Db,
  exposureId: string,
  personId: string | null,
  actorId: string,
  signal: AbortSignal,
): Promise<Result<Exposure, AppError>> {
  const deny = () =>
    err(new AppError(ERROR_IDS.PERM_DENIED, "Newsletter campaign source is unavailable"));
  if (personId === null) return deny();
  const actor = await hydrateActor(db, actorId, signal);
  if (actor === null || !hasNewsletterPermission(actor, "view")) return deny();
  let person: Awaited<ReturnType<typeof requireNewsletterPerson>>;
  try {
    person = await requireNewsletterPerson(db, actor, personId, signal, true);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return deny();
    throw error;
  }
  const [row] = await db
    .select({
      exposure: newsletterExposureReceipts,
      digest: newsletterPersonAddresses.addressDigest,
    })
    .from(newsletterExposureReceipts)
    .innerJoin(
      newsletterPersonAddresses,
      eq(newsletterPersonAddresses.id, newsletterExposureReceipts.linkId),
    )
    .where(
      and(
        eq(newsletterExposureReceipts.id, exposureId),
        eq(newsletterExposureReceipts.personId, personId),
        eq(newsletterPersonAddresses.personId, personId),
        isNotNull(newsletterPersonAddresses.verifiedAt),
        isNull(newsletterPersonAddresses.detachedAt),
      ),
    )
    .for("share");
  signal.throwIfAborted();
  if (
    row === undefined ||
    !newsletterContactAddresses(person.emails).some((address) =>
      addressDigest(address).equals(row.digest),
    )
  )
    return deny();
  if ((await sharedNewsletterAddresses(db, [row.digest])).size > 0) return deny();
  return ok(row.exposure);
}

export async function readNewsletterLeadSource(tx: Db, leadId: string, signal: AbortSignal) {
  const [source] = await tx
    .select({
      exposureId: newsletterLeadSources.exposureId,
      personId: newsletterExposureReceipts.personId,
      campaignId: newsletterExposureReceipts.campaignId,
    })
    .from(newsletterLeadSources)
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterLeadSources.exposureId),
    )
    .where(eq(newsletterLeadSources.leadId, leadId));
  signal.throwIfAborted();
  return source;
}

export async function carryNewsletterLeadSource(
  tx: Db,
  leadId: string,
  dealId: string,
  exposureId: string,
  signal: AbortSignal,
) {
  await tx.insert(newsletterDealSources).values({ dealId, leadId, exposureId });
  signal.throwIfAborted();
}

export async function recordNewsletterWin(tx: Db, before: Deal, after: Deal, signal: AbortSignal) {
  if (
    before.status !== "open" ||
    after.status !== "won" ||
    after.personId === null ||
    before.personId !== after.personId
  )
    return;
  const [source] = await tx
    .select({ dealId: newsletterDealSources.dealId })
    .from(newsletterDealSources)
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterDealSources.exposureId),
    )
    .innerJoin(persons, eq(persons.id, newsletterExposureReceipts.personId))
    .where(
      and(
        eq(newsletterDealSources.dealId, after.id),
        eq(newsletterExposureReceipts.personId, after.personId),
        isNull(persons.deletedAt),
        lte(newsletterExposureReceipts.acceptedAt, after.createdAt),
      ),
    );
  if (source !== undefined) {
    await tx
      .insert(newsletterAttributedWins)
      .values({ dealId: source.dealId, occurredAt: sql`clock_timestamp()` })
      .onConflictDoNothing({ target: newsletterAttributedWins.dealId });
  }
  signal.throwIfAborted();
}
