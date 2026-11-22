import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { ScanInput, ScanResult } from "@/features/physical-labels/contracts";
import type { AssetSite } from "../contracts";
import { type AssetTagScanInput, type AssetTagScanResult, assetTagScanInput } from "./contracts";
import { parseLegacyTagIdentifier } from "./legacyImport";
import {
  activeTarget,
  invalid,
  type TagCode,
  targetRef,
  unavailable,
  withTagActor,
} from "./nativeScope";
import { assetTagAssignments, assetTagCodes, assetTagScans } from "./schema";
import { assetTagText, isAssetTagToken, parseAssetTagIdentifier, splitTagUrl } from "./tagCodes";

type RegistryMatch = { token: string } | { legacyId: string; origin: string | null };

function candidateFor(
  input: AssetTagScanInput["identifier"],
  origin: string,
  printed: boolean,
): RegistryMatch | null {
  if (printed && isAssetTagToken(input)) return { token: input };
  const token = parseAssetTagIdentifier(input, origin);
  if (token !== null) return { token };
  const shared = parseLegacyTagIdentifier(input);
  if (shared !== null) return { legacyId: shared.id, origin: null };

  const link = splitTagUrl(input.replace(/^\]Q[012]/u, "").replace(/[\r\n]+$/u, ""));
  if (link === null) return null;
  const legacy = parseLegacyTagIdentifier(input, link.origin);
  return legacy === null ? null : { legacyId: legacy.id, origin: link.origin };
}

async function findCode(tx: Db, candidate: RegistryMatch) {
  const where =
    "token" in candidate
      ? sql`${assetTagCodes.token} COLLATE "C" = ${candidate.token}`
      : and(
          sql`${assetTagCodes.legacyId} COLLATE "C" = ${candidate.legacyId}`,
          candidate.origin === null ? undefined : eq(assetTagCodes.legacyOrigin, candidate.origin),
        );
  const [tag] = await tx.select().from(assetTagCodes).where(where).limit(1);
  return tag;
}

async function recordScan(
  tx: Db,
  tag: TagCode,
  assignmentId: string,
  actorId: string,
  { source, coordinates }: Pick<AssetTagScanInput, "source" | "coordinates">,
) {
  const dedupe = `${assignmentId}:${actorId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-equipment-tag-scan'), hashtext(${dedupe}))`,
  );
  const [prior] = await tx
    .select({ id: assetTagScans.id, latitude: assetTagScans.latitude })
    .from(assetTagScans)
    .where(
      and(
        eq(assetTagScans.assignmentId, assignmentId),
        eq(assetTagScans.actorId, actorId),
        sql`${assetTagScans.at} >= clock_timestamp() - interval '30 seconds'`,
      ),
    )
    .orderBy(desc(assetTagScans.at), desc(assetTagScans.id))
    .limit(1);
  if (prior === undefined) {
    await tx.insert(assetTagScans).values({
      ...coordinates,
      tagId: tag.id,
      assignmentId,
      siteId: tag.siteId,
      actorId,
      source,
    });
  } else if (prior.latitude === null && coordinates !== null) {
    await tx.update(assetTagScans).set(coordinates).where(eq(assetTagScans.id, prior.id));
  }
}

async function resolveAndRecord(
  tx: Db,
  sites: AssetSite[],
  actorId: string,
  tag: TagCode,
  input: Pick<AssetTagScanInput, "source" | "coordinates">,
) {
  const site = sites.find(({ id }) => id === tag.siteId);
  if (site === undefined) return null;
  const [assignment] = await tx
    .select()
    .from(assetTagAssignments)
    .where(and(eq(assetTagAssignments.tagId, tag.id), isNull(assetTagAssignments.endedAt)))
    .limit(1);
  if (assignment === undefined) return null;
  const target = await activeTarget(tx, [site], targetRef(assignment));
  if (target === null) return null;

  await recordScan(tx, tag, assignment.id, actorId, input);
  return { target, assignedAt: assignment.assignedAt, assignmentId: assignment.id, tagId: tag.id };
}

export async function resolveAssetTag(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  origin: string,
  signal: AbortSignal,
): Promise<AssetTagScanResult> {
  const parsed = assetTagScanInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const input = parsed.data;
  const candidate = candidateFor(input.identifier, origin, input.source === "printed_link");
  if (candidate === null) return unavailable;

  return withTagActor(db, who, "read", signal, async (tx, actor, sites) => {
    const tag = await findCode(tx, candidate);
    if (tag === undefined) return unavailable;
    const match = await resolveAndRecord(tx, sites, actor.id, tag, input);
    return match === null
      ? unavailable
      : ({
          ok: true,
          target: match.target,
          assignmentId: match.assignmentId,
          tagId: match.tagId,
        } as const);
  });
}

export function resolveAssetTagFromLabelScan(
  db: Db,
  who: NativeSessionRef,
  input: ScanInput,
  origin: string,
  signal: AbortSignal,
): Promise<ScanResult | undefined> {
  const candidate = candidateFor(input.value, origin, false);
  if (candidate === null) return Promise.resolve(undefined);

  return withTagActor(db, who, "read", signal, async (tx, actor, sites) => {
    const tag = await findCode(tx, candidate);
    if (tag === undefined) return undefined;
    const match = await resolveAndRecord(tx, sites, actor.id, tag, {
      source: input.format === undefined ? "manual" : "camera",
      coordinates: null,
    });
    if (match === null) return unavailable;
    return {
      ok: true,
      label: {
        id: tag.id,
        target: match.target,
        source: "internal",
        format: "qr",
        value: assetTagText(tag.token),
        createdAt: match.assignedAt.toISOString(),
        retiredAt: null,
      },
    } as const;
  });
}
