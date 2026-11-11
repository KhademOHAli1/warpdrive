import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { persons } from "@/db/schema/persons";
import { newsletterPersonAddresses as links } from "../schema/personAddresses";

export async function sharedNewsletterAddresses(db: Db, digests: Buffer[]): Promise<Set<string>> {
  if (digests.length === 0) return new Set();
  const rows = await db
    .select({ digest: links.addressDigest })
    .from(links)
    .innerJoin(persons, eq(persons.id, links.personId))
    .where(
      and(
        inArray(links.addressDigest, digests),
        isNotNull(links.verifiedAt),
        isNull(links.detachedAt),
        isNull(persons.deletedAt),
      ),
    )
    .groupBy(links.addressDigest)
    .having(sql`count(distinct ${links.personId}) > 1`);
  return new Set(rows.map(({ digest }) => digest.toString("hex")));
}
