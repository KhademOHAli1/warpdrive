import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { env } from "@/config/env";
import type { DashboardFilters } from "@/types/stats";
import {
  CONFIGURED_LOST_REASON,
  LEGACY_LOST_REASON,
  lostReasonSelector,
  MISSING_LOST_REASON,
} from "./lostReasonSelector";

const PURPOSE = "warpdrive-lost-reason-selector-v1";
const KEY = Buffer.from(
  hkdfSync("sha256", Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"), PURPOSE, "legacy-digest", 32),
);
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function lostReasonBinding(actorId: string, filters: DashboardFilters): Buffer {
  const owners = filters.owners.everyone
    ? null
    : [...new Set(filters.owners.ids.map((id) => id.toLowerCase()))].sort();
  return Buffer.from(
    JSON.stringify([
      PURPOSE,
      actorId,
      filters.pipelineId?.toLowerCase() ?? null,
      filters.currency ?? null,
      filters.from,
      filters.to,
      filters.timeZone ?? "UTC",
      owners,
    ]),
  );
}

export function encodeLostReasonSelection(
  group: { reasonId: string | null; name: string | null; configured: boolean },
  binding: Buffer,
): string | undefined {
  if (group.reasonId !== null) {
    return group.configured ? `${CONFIGURED_LOST_REASON}${group.reasonId}` : undefined;
  }
  if (group.name === null) return MISSING_LOST_REASON;

  const digest = createHash("sha256").update(group.name, "utf8").digest();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, nonce);
  cipher.setAAD(binding);
  const encrypted = Buffer.concat([cipher.update(digest), cipher.final()]);
  return (
    LEGACY_LOST_REASON +
    Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")
  );
}

function openLegacyDigest(selector: string, binding: Buffer): Buffer | null {
  try {
    const packed = Buffer.from(selector.slice(LEGACY_LOST_REASON.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", KEY, packed.subarray(0, NONCE_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(binding);
    decipher.setAuthTag(packed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(packed.subarray(NONCE_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}

/** The selection only narrows a freshly authorized live lost-deal population. */
export function resolveLostReasonSelection(
  selector: string,
  actorId: string,
  filters: DashboardFilters,
): { predicate: SQL; legacy: boolean } | null {
  if (!lostReasonSelector.safeParse(selector).success) return null;
  if (selector === MISSING_LOST_REASON) {
    return { predicate: sql`d.lost_reason_id IS NULL AND d.lost_reason IS NULL`, legacy: false };
  }
  if (selector.startsWith(CONFIGURED_LOST_REASON)) {
    const id = selector.slice(CONFIGURED_LOST_REASON.length);
    return {
      predicate: sql`d.lost_reason_id = ${id}::pg_catalog.uuid AND EXISTS (
        SELECT 1 FROM public.lost_reasons reason WHERE reason.id = d.lost_reason_id
      )`,
      legacy: false,
    };
  }
  const digest = openLegacyDigest(selector, lostReasonBinding(actorId, filters));
  if (digest === null) return null;
  return {
    predicate: sql`d.lost_reason_id IS NULL AND d.lost_reason IS NOT NULL
      AND pg_catalog.sha256(pg_catalog.convert_to(d.lost_reason, 'UTF8')) = ${digest}::pg_catalog.bytea`,
    legacy: true,
  };
}
