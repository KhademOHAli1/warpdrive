import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { takeRateLimitBucket } from "@/features/auth/better/rateLimit";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { directorySites } from "@/features/locations/schema";
import { assetKits } from "../kits/schema";
import { assetRecords } from "../schema";
import {
  type AssetTagContactInput,
  type AssetTagContactResult,
  assetTagContactInput,
} from "./contracts";
import { invalid, lockTagResources, unavailable } from "./nativeScope";
import { assetTagAssignments, assetTagCodes, assetTagOwnerMessages } from "./schema";
import { isAssetTagToken } from "./tagCodes";

const proofLifetimeMs = 15 * 60 * 1000;
const proofPattern = /^(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u;
const delivered = { ok: true } as const;

function keyedHash(purpose: string, parts: readonly string[]) {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(JSON.stringify(["warpdrive-equipment-tag-v1", purpose, parts]))
    .digest();
}

async function contactAssignment(tx: Db, token: string) {
  const [assignment] = await tx
    .select({
      siteId: assetTagAssignments.siteId,
      tagId: assetTagAssignments.tagId,
      assignmentId: assetTagAssignments.id,
    })
    .from(assetTagCodes)
    .innerJoin(directorySites, eq(directorySites.id, assetTagCodes.siteId))
    .innerJoin(assetTagAssignments, eq(assetTagAssignments.tagId, assetTagCodes.id))
    .leftJoin(
      assetRecords,
      and(
        eq(assetRecords.id, assetTagAssignments.assetId),
        eq(assetRecords.siteId, assetTagAssignments.siteId),
      ),
    )
    .leftJoin(
      assetKits,
      and(
        eq(assetKits.id, assetTagAssignments.kitId),
        eq(assetKits.siteId, assetTagAssignments.siteId),
      ),
    )
    .where(
      and(
        sql`${assetTagCodes.token} COLLATE "C" = ${token}`,
        eq(directorySites.archived, false),
        eq(assetTagAssignments.ownerContact, true),
        isNull(assetTagAssignments.endedAt),
        or(
          and(sql`${assetRecords.id} IS NOT NULL`, isNull(assetRecords.archivedAt)),
          sql`${assetKits.id} IS NOT NULL`,
        ),
      ),
    )
    .limit(1);
  return assignment;
}

type ContactAssignment = NonNullable<Awaited<ReturnType<typeof contactAssignment>>>;

function makeProof(token: string, assignmentId: string) {
  const expires = String(Date.now() + proofLifetimeMs);
  const nonce = randomBytes(16).toString("base64url");
  const signature = keyedHash("owner-form", [token, assignmentId, expires, nonce]).toString(
    "base64url",
  );
  return `${expires}.${nonce}.${signature}`;
}

function matchesActiveProof(proof: string, token: string, assignmentId: string) {
  const match = proofPattern.exec(proof);
  const expires = match?.[1];
  const nonce = match?.[2];
  const encoded = match?.[3];
  if (expires === undefined || nonce === undefined || encoded === undefined) return false;
  const now = Date.now();
  if (Number(expires) < now || Number(expires) > now + proofLifetimeMs) return false;
  const expected = keyedHash("owner-form", [token, assignmentId, expires, nonce]);
  const presented = Buffer.from(encoded, "base64url");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export function readAssetTagPublic(db: Db, token: string, signal: AbortSignal) {
  if (!isAssetTagToken(token) || env.AUTH_SECRET.length === 0) return Promise.resolve(null);

  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockTagResources(tx, "read", signal);
    const assignment = await contactAssignment(tx, token);
    return assignment === undefined ? null : { proof: makeProof(token, assignment.assignmentId) };
  });
}

function contactRate(db: Db, bucket: string, subject: string, limit: number, signal: AbortSignal) {
  return takeRateLimitBucket(
    db,
    keyedHash("owner-contact-rate", [bucket, subject]).toString("base64url"),
    limit,
    signal,
  );
}

async function deliver(
  tx: Db,
  assignment: ContactAssignment,
  input: AssetTagContactInput,
  signal: AbortSignal,
): Promise<AssetTagContactResult> {
  const dedupe = `${assignment.assignmentId}:${input.requestId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-equipment-tag-contact'), hashtext(${dedupe}))`,
  );
  const fingerprint = keyedHash("owner-receipt", [input.replyTo ?? "", input.message]).toString(
    "hex",
  );
  const [existing] = await tx
    .select({ fingerprint: assetTagOwnerMessages.fingerprint })
    .from(assetTagOwnerMessages)
    .where(
      and(
        eq(assetTagOwnerMessages.assignmentId, assignment.assignmentId),
        eq(assetTagOwnerMessages.requestId, input.requestId),
      ),
    )
    .limit(1);
  if (existing !== undefined) return existing.fingerprint === fingerprint ? delivered : unavailable;
  if (!(await contactRate(tx, "tag", assignment.tagId, 6, signal))) return unavailable;
  await tx.insert(assetTagOwnerMessages).values({
    ...assignment,
    requestId: input.requestId,
    message: input.message,
    replyTo: input.replyTo,
    fingerprint,
  });
  return delivered;
}

export async function sendAssetTagContact(
  db: Db,
  raw: unknown,
  proof: unknown,
  visitorIp: string | null,
  signal: AbortSignal,
): Promise<AssetTagContactResult> {
  const input = assetTagContactInput.safeParse(raw);
  if (!input.success) return invalid;
  if (env.AUTH_SECRET.length === 0 || typeof proof !== "string" || proof.length > 100)
    return unavailable;

  // An aggregate bucket limits distributed requests, and untrusted forwarding data shares one lane.
  if (!(await contactRate(db, "global", "all", 180, signal))) return unavailable;
  const accepted =
    visitorIp === null
      ? await contactRate(db, "visitor", "unknown", 90, signal)
      : await contactRate(db, "visitor", visitorIp, 12, signal);
  if (!accepted) return unavailable;

  return withCurrentAuthority(db, "read", signal, async (tx) => {
    await lockTagResources(tx, "read", signal);
    const assignment = await contactAssignment(tx, input.data.token);
    if (
      assignment === undefined ||
      !matchesActiveProof(proof, input.data.token, assignment.assignmentId)
    )
      return unavailable;
    return deliver(tx, assignment, input.data, signal);
  });
}
