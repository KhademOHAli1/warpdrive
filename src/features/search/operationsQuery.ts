import { and, inArray, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { readBookingRoles } from "@/features/assets/bookings/scope";
import { assetActor, lockAssetRegister } from "@/features/assets/service";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockDirectory, readDirectorySiteScope } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { type OperationsSearchResult, operationsSearchResultsPerKind } from "./operationsContracts";

function matchesAllWords(label: SQL, words: SQL) {
  return sql`NOT EXISTS (
    SELECT 1 FROM (VALUES ${words}) AS query_words(word)
    WHERE strpos(lower(${label}), lower(query_words.word)) = 0
  )`;
}

async function searchLocations(tx: Db, actor: HydratedActor, term: string, words: SQL) {
  const { sites } = await readDirectorySiteScope(tx, actor.id, actor.type === "admin");
  const siteIds = sites.filter(({ archived }) => !archived).map(({ id }) => id);
  if (siteIds.length === 0) return [];
  const label = sql`concat_ws(' ', l.name, l.code, s.name, l.id::text)`;
  const matches = await tx.execute<OperationsSearchResult>(sql`
    SELECT l.id, 'location' AS kind, l.name AS primary, l.code || ' · ' || s.name AS secondary
    FROM directory_locations l
    JOIN directory_sites s ON s.id = l.site_id
    WHERE ${inArray(sql`l.site_id`, siteIds)}
      AND NOT l.archived AND NOT s.archived AND ${matchesAllWords(label, words)}
    ORDER BY CASE
      WHEN lower(l.code) = lower(${term}) OR lower(l.name) = lower(${term}) THEN 0
      WHEN starts_with(lower(l.code), lower(${term})) OR starts_with(lower(l.name), lower(${term})) THEN 1
      ELSE 2
    END, lower(l.name), lower(l.code), l.id
    LIMIT ${operationsSearchResultsPerKind}
  `);
  return matches.rows;
}

async function bookingTitleScope(tx: Db, actor: HydratedActor): Promise<SQL | null> {
  if (actor.type === "admin") return sql`true`;
  const roles = [...(await readBookingRoles(tx, actor.id))];
  const managerSites = roles.filter(([, role]) => role === "manager").map(([siteId]) => siteId);
  const requesterSites = roles
    .filter(([, role]) => role === "base" || role === "self_service")
    .map(([siteId]) => siteId);
  if (managerSites.length + requesterSites.length === 0) return null;
  return (
    or(
      inArray(sql`b.site_id`, managerSites),
      and(inArray(sql`b.site_id`, requesterSites), sql`b.requester_id = ${actor.id}`),
    ) ?? null
  );
}

async function searchBookings(tx: Db, actor: HydratedActor, term: string, words: SQL) {
  const scope = await bookingTitleScope(tx, actor);
  if (scope === null) return [];
  const label = sql`concat_ws(' ', b.title, s.name, b.id::text)`;
  const matches = await tx.execute<OperationsSearchResult>(sql`
    SELECT b.id, 'booking' AS kind, b.title AS primary, s.name AS secondary
    FROM asset_bookings b
    JOIN directory_sites s ON s.id = b.site_id
    WHERE ${scope} AND NOT b.archived AND NOT s.archived AND ${matchesAllWords(label, words)}
    ORDER BY CASE
      WHEN lower(b.title) = lower(${term}) THEN 0
      WHEN starts_with(lower(b.title), lower(${term})) THEN 1
      ELSE 2
    END, lower(b.title), b.id
    LIMIT ${operationsSearchResultsPerKind}
  `);
  return matches.rows;
}

export async function searchOperations(
  db: Db,
  who: NativeSessionRef,
  query: string,
  signal: AbortSignal,
): Promise<OperationsSearchResult[]> {
  const term = query.trim();
  if (term === "" || term.includes("\u0000")) return [];
  const words = sql.join(
    term.split(/\s+/u).map((word) => sql`(${word})`),
    sql`, `,
  );
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockDirectory(tx, "read", signal);
    // Both modules require current accepted staff. Their site grants resolve separately.
    const actor = await assetActor(tx, who, signal);
    if (actor === null) return [];
    await lockAssetRegister(tx, "read", signal);
    const locations = await searchLocations(tx, actor, term, words);
    const bookings = await searchBookings(tx, actor, term, words);
    return (await assetActor(tx, who, signal)) === null ? [] : [...locations, ...bookings];
  });
}
