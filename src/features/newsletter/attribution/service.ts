import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { toRefActor } from "@/features/contacts/actorAdapters";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import {
  addressDigest,
  newsletterContactAddresses,
  requireIdentityPermission,
  requireNewsletterPerson,
} from "../identity/authority";
import { sharedNewsletterAddresses } from "../identity/linkStore";
import { newsletterPersonAddresses } from "../schema/personAddresses";
import { connectNewsletterAttribution, type EngineNewsletterExposure } from "./engine";
import {
  newsletterAttributedWins,
  newsletterDealSources,
  newsletterExposureReceipts,
} from "./schema";

export async function attributionBindings(
  db: Db,
  actor: PermSetUser,
  personId: string,
  signal: AbortSignal,
  lock = false,
) {
  requireIdentityPermission(actor, "view");
  const person = await requireNewsletterPerson(db, actor, personId, signal, lock);
  const currentAddresses = new Set(
    newsletterContactAddresses(person.emails).map((address) =>
      addressDigest(address).toString("hex"),
    ),
  );
  const query = db
    .select({ id: newsletterPersonAddresses.id, digest: newsletterPersonAddresses.addressDigest })
    .from(newsletterPersonAddresses)
    .where(
      and(
        eq(newsletterPersonAddresses.personId, personId),
        isNotNull(newsletterPersonAddresses.verifiedAt),
        isNull(newsletterPersonAddresses.detachedAt),
      ),
    )
    .limit(25);
  const rows = (await (lock ? query.for("share") : query)).filter(({ digest }) =>
    currentAddresses.has(digest.toString("hex")),
  );
  const shared = await sharedNewsletterAddresses(
    db,
    rows.map(({ digest }) => digest),
  );
  return rows.filter(({ digest }) => !shared.has(digest.toString("hex"))).map(({ id }) => id);
}

async function readPersonAttributedWins(
  db: Db,
  actor: PermSetUser,
  personId: string,
  bindingIds: string[],
  signal: AbortSignal,
) {
  if (bindingIds.length === 0) return [];
  const rows = await db
    .select({
      dealId: deals.id,
      title: deals.title,
      campaignId: newsletterExposureReceipts.campaignId,
      occurredAt: newsletterAttributedWins.occurredAt,
    })
    .from(newsletterAttributedWins)
    .innerJoin(
      newsletterDealSources,
      eq(newsletterDealSources.dealId, newsletterAttributedWins.dealId),
    )
    .innerJoin(
      newsletterExposureReceipts,
      eq(newsletterExposureReceipts.id, newsletterDealSources.exposureId),
    )
    .innerJoin(deals, eq(deals.id, newsletterDealSources.dealId))
    .innerJoin(
      newsletterPersonAddresses,
      eq(newsletterPersonAddresses.id, newsletterExposureReceipts.linkId),
    )
    .where(
      and(
        eq(newsletterExposureReceipts.personId, personId),
        inArray(newsletterExposureReceipts.linkId, bindingIds),
        eq(deals.personId, personId),
        eq(deals.status, "won"),
        isNull(deals.deletedAt),
        isNull(newsletterPersonAddresses.detachedAt),
      ),
    )
    .orderBy(desc(newsletterAttributedWins.occurredAt), deals.id)
    .limit(30);
  const refActor = toRefActor(actor);
  const visible = await Promise.all(
    rows.map(async (row) =>
      (await assertReferenceVisible(db, refActor, { kind: "deal", id: row.dealId }, signal)).ok
        ? row
        : null,
    ),
  );
  return visible.filter((row) => row !== null);
}

export async function readPersonNewsletterAttribution(
  db: Db,
  actor: PermSetUser,
  personId: string,
  signal: AbortSignal,
) {
  const bindings = await attributionBindings(db, actor, personId, signal);
  const wins = await readPersonAttributedWins(db, actor, personId, bindings, signal);
  try {
    if (bindings.length === 0)
      return { personId, state: "available" as const, exposures: [], wins };
    const read = await connectNewsletterAttribution(signal);
    const results = await Promise.allSettled(bindings.map((id) => read(id)));
    signal.throwIfAborted();
    const exposures = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())
      .slice(0, 100)
      .map(({ bindingId, deliveryId, campaignName, acceptedAt }) => ({
        bindingId,
        deliveryId,
        campaignName,
        acceptedAt,
      }));
    const state = results.some((result) => result.status === "rejected")
      ? ("partial" as const)
      : ("available" as const);
    return { personId, state, exposures, wins };
  } catch {
    signal.throwIfAborted();
    return { personId, state: "unavailable" as const, exposures: [], wins };
  }
}

export async function readExactNewsletterExposure(
  bindingId: string,
  deliveryId: string,
  signal: AbortSignal,
): Promise<EngineNewsletterExposure> {
  const read = await connectNewsletterAttribution(signal);
  const [proof] = await read(bindingId, deliveryId);
  if (proof === undefined || proof.acceptedAt > new Date())
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Verified campaign exposure was unavailable.",
    });
  return proof;
}
