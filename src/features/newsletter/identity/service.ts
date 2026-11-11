import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { persons } from "@/db/schema/persons";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { newsletterPersonAddresses as links } from "../schema/personAddresses";
import {
  addressDigest,
  newsletterContactAddresses,
  requireIdentityPermission,
  requireNewsletterPerson,
} from "./authority";
import {
  maxNewsletterAudiencePeople,
  type PersonNewsletterGrant,
  type PersonNewsletterLink,
  type PersonNewsletterSummary,
} from "./contracts";
import { connectNewsletterIdentity } from "./engine";
import { sharedNewsletterAddresses } from "./linkStore";

export { requestNewsletterInvite } from "./write";

type Link = typeof links.$inferSelect;
type Engine = Awaited<ReturnType<typeof connectNewsletterIdentity>>;

async function projectLink(
  link: Link,
  shared: boolean,
  engine: Engine | null,
): Promise<PersonNewsletterLink> {
  const state =
    link.detachedAt !== null
      ? "detached"
      : link.verifiedAt !== null
        ? "verified"
        : link.expiresAt <= new Date()
          ? "expired"
          : "pending";
  const current =
    engine !== null && state === "verified" && link.subscriberId !== null
      ? await engine.subscriber(link.subscriberId).catch(() => null)
      : null;
  const consent =
    current !== null &&
    current.uuid === link.subscriberUuid &&
    addressDigest(current.email).equals(link.addressDigest)
      ? {
          status: current.status,
          lists: (current.lists ?? []).map(({ id, name, optin, status, subscription_status }) => ({
            id,
            name,
            optin,
            status,
            subscriptionStatus: subscription_status,
          })),
        }
      : null;
  return {
    id: link.id,
    subscriberId: link.subscriberId,
    subscriberUuid: link.subscriberUuid,
    state,
    shared,
    verifiedAt: link.verifiedAt,
    consent,
  };
}

export async function readPersonNewsletter(
  db: Db,
  actor: PermSetUser,
  personId: string,
  signal: AbortSignal,
): Promise<PersonNewsletterSummary> {
  requireIdentityPermission(actor, "view");
  const person = await requireNewsletterPerson(db, actor, personId, signal);
  const addresses = newsletterContactAddresses(person.emails).slice(0, 50);
  const selected = addresses.map((address) => ({ address, digest: addressDigest(address) }));
  const [engine, rows, shared] = await Promise.all([
    connectNewsletterIdentity(signal).catch(() => null),
    db.select().from(links).where(eq(links.personId, personId)).limit(100),
    sharedNewsletterAddresses(
      db,
      selected.map(({ digest }) => digest),
    ),
  ]);
  const [eligibleLists, projected] = await Promise.all([
    engine?.eligibleLists().catch(() => []) ?? [],
    Promise.all(
      selected.map(async ({ address, digest }) => ({
        address,
        links: await Promise.all(
          rows
            .filter((link) => link.addressDigest.equals(digest))
            .map((link) => projectLink(link, shared.has(digest.toString("hex")), engine)),
        ),
      })),
    ),
  ]);
  return {
    personId,
    addresses: projected,
    engineAvailable: engine !== null,
    deliveryAvailable: engine !== null && env.NEWSLETTER_DELIVERY_ENABLED,
    eligibleLists,
  };
}

export async function readPersonNewsletterGrants(
  db: Db,
  actor: PermSetUser,
  personIds: string[],
  listId: number,
  signal: AbortSignal,
): Promise<PersonNewsletterGrant[]> {
  requireIdentityPermission(actor, "view");
  if (personIds.length === 0) return [];
  if (personIds.length > maxNewsletterAudiencePeople) throw new TRPCError({ code: "BAD_REQUEST" });
  const rows = await db
    .select({ link: links, person: persons })
    .from(links)
    .innerJoin(persons, eq(persons.id, links.personId))
    .where(
      and(
        inArray(links.personId, personIds),
        isNotNull(links.verifiedAt),
        isNull(links.detachedAt),
        isNull(persons.deletedAt),
      ),
    );
  const scoped = rows.filter(
    ({ person, link }) =>
      canSee(actor, { kind: "person", ...person }) &&
      newsletterContactAddresses(person.emails).some((address) =>
        addressDigest(address).equals(link.addressDigest),
      ),
  );
  const shared = await sharedNewsletterAddresses(
    db,
    scoped.map(({ link }) => link.addressDigest),
  );
  const unique = scoped.filter(({ link }) => !shared.has(link.addressDigest.toString("hex")));
  if (unique.length === 0) return [];
  const engine = await connectNewsletterIdentity(signal);
  const grants: Omit<PersonNewsletterGrant, "personId">[] = [];
  // The private engine caps the JSON body at 16 KiB. A batch of 400 UUIDs fits with its metadata.
  const batchSize = 400;
  for (let offset = 0; offset < unique.length; offset += batchSize) {
    signal.throwIfAborted();
    const batch = unique.slice(offset, offset + batchSize);
    grants.push(
      ...(await engine.grants(
        batch.map(({ link }) => link.id),
        listId,
      )),
    );
  }
  const byBinding = new Map(unique.map(({ link }) => [link.id, link]));
  return grants.flatMap((grant) => {
    const link = byBinding.get(grant.bindingUuid);
    if (
      link === undefined ||
      grant.purposeListId !== listId ||
      grant.subscriberId !== link.subscriberId ||
      grant.subscriberUuid !== link.subscriberUuid ||
      !addressDigest(grant.email).equals(link.addressDigest)
    )
      return [];
    return [{ ...grant, personId: link.personId }];
  });
}
