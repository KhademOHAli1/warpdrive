import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withAssetDiscoveryAuthority } from "@/features/assets/discovery/scope";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { directorySites } from "@/features/locations/schema";
import type { EquipmentSearchResult } from "./equipmentContracts";

const LIMIT = 8;

export async function searchEquipment(
  db: Db,
  who: NativeSessionRef,
  query: string,
  signal: AbortSignal,
): Promise<EquipmentSearchResult[]> {
  const term = query.trim();
  if (term === "" || term.includes("\u0000")) return [];
  const terms = sql.join(
    term.split(/\s+/u).map((word) => sql`(${word})`),
    sql`, `,
  );

  const result = await withAssetDiscoveryAuthority(
    db,
    who,
    signal,
    "read",
    async (tx, _, sites) => {
      const scopedSites = sites.map(({ id }) => id);
      const matches = await tx.execute<EquipmentSearchResult>(sql`
      WITH allowed_sites AS (
        SELECT ${directorySites.id} AS id
        FROM ${directorySites}
        WHERE ${inArray(directorySites.id, scopedSites)} AND NOT ${directorySites.archived}
      ), equipment AS (
        SELECT a.id, 'asset' AS kind, a.name, a.code, a.serial
        FROM asset_records a JOIN allowed_sites s ON s.id = a.site_id
        WHERE a.archived_at IS NULL
        UNION ALL
        SELECT k.id, 'kit' AS kind, k.name, k.code, NULL::text AS serial
        FROM asset_kits k JOIN allowed_sites s ON s.id = k.site_id
      )
      SELECT id, kind, name AS primary,
        CASE WHEN serial IS NULL THEN code ELSE code || ' · ' || serial END AS secondary
      FROM equipment
      WHERE NOT EXISTS (
        SELECT 1 FROM (VALUES ${terms}) AS words(word)
        WHERE strpos(lower(concat_ws(' ', name, code, serial)), lower(words.word)) = 0
      )
      ORDER BY CASE
        WHEN lower(code) = lower(${term}) OR lower(serial) = lower(${term}) THEN 0
        WHEN starts_with(lower(code), lower(${term})) OR starts_with(lower(serial), lower(${term})) THEN 1
        WHEN starts_with(lower(name), lower(${term})) THEN 2
        ELSE 3
      END, lower(name), lower(code), kind, id
      LIMIT ${LIMIT}
    `);
      signal.throwIfAborted();
      return matches.rows;
    },
  );
  return Array.isArray(result) ? result : [];
}
