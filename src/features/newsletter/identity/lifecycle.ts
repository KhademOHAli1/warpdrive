import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import {
  newsletterIdentityCommands as commands,
  newsletterPersonAddresses as links,
  type NewsletterDetachReason,
} from "../schema/personAddresses";
import { addressDigest, newsletterContactAddresses } from "./authority";
import { connectNewsletterIdentity } from "./engine";

export function detachRemovedNewsletterAddresses(
  db: Db,
  personId: string,
  previous: readonly { value: string }[],
  next: readonly { value: string }[],
  signal: AbortSignal,
): Promise<Result<void, AppError>> {
  const retained = new Set(newsletterContactAddresses(next));
  if (newsletterContactAddresses(previous).every((address) => retained.has(address))) {
    return Promise.resolve(ok(undefined));
  }
  return detachNewsletterPersonLinks(db, personId, signal, {
    reason: "address_removed",
    keepEmails: next,
  });
}

export async function markNewsletterLinksDetached(
  db: Db,
  ids: string[],
  reason: NewsletterDetachReason,
) {
  if (ids.length === 0) return;
  await db
    .update(links)
    .set({ detachedAt: sql`clock_timestamp()`, detachedReason: reason })
    .where(and(inArray(links.id, ids), isNull(links.detachedAt)));
  await db
    .update(commands)
    .set({ state: "detached", resolvedAt: sql`clock_timestamp()` })
    .where(
      and(
        inArray(commands.linkId, ids),
        eq(commands.state, "pending"),
        eq(commands.kind, "invite"),
      ),
    );
}

/** Call under the Person row lock, before changing or archiving the contact. */
export async function detachNewsletterPersonLinks(
  db: Db,
  personId: string,
  signal: AbortSignal,
  options: {
    reason: NewsletterDetachReason;
    keepEmails?: readonly { value: string }[];
    linkId?: string;
  },
): Promise<Result<void, AppError>> {
  const active = await db
    .select({ id: links.id, addressDigest: links.addressDigest })
    .from(links)
    .where(
      and(
        eq(links.personId, personId),
        isNull(links.detachedAt),
        options.linkId === undefined ? undefined : eq(links.id, options.linkId),
      ),
    );
  const retained = new Set(
    newsletterContactAddresses(options.keepEmails ?? []).map((value) =>
      addressDigest(value).toString("hex"),
    ),
  );
  const ids = active
    .filter(({ addressDigest: digest }) => !retained.has(digest.toString("hex")))
    .map(({ id }) => id);
  if (ids.length === 0) return ok(undefined);
  try {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(4_000)]);
    const engine = await connectNewsletterIdentity(bounded);
    // Revocation is idempotent and deliberately precedes the CRM commit. If the CRM
    // rolls back afterward, revoked grants stay fenced and the contact operation can retry.
    const outcomes = await Promise.allSettled(ids.map((id) => engine.revoke(id)));
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      return err(
        new AppError(
          ERROR_IDS.INTEGRATION_CREDENTIALS_UNAVAILABLE,
          "Newsletter revocation is unavailable. Retry the contact change.",
          {},
        ),
      );
    }
  } catch {
    return err(
      new AppError(
        ERROR_IDS.INTEGRATION_CREDENTIALS_UNAVAILABLE,
        "Newsletter revocation is unavailable. Retry the contact change.",
        {},
      ),
    );
  }
  await markNewsletterLinksDetached(db, ids, options.reason);
  return ok(undefined);
}
