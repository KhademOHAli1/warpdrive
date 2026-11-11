import { createHmac, hkdfSync } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { persons } from "@/db/schema/persons";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { hasNewsletterPermission } from "../permissions";

const addressKey = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"),
    "warpdrive-newsletter",
    "crm-address-v1",
    32,
  ),
);

export const canonicalNewsletterAddress = z.string().trim().toLowerCase().max(254).pipe(z.email());

export function addressDigest(address: string): Buffer {
  return createHmac("sha256", addressKey).update(address.trim().toLowerCase()).digest();
}

export function newsletterContactAddresses(emails: readonly { value: string }[]): string[] {
  const addresses = new Set<string>();
  for (const { value } of emails) {
    const address = canonicalNewsletterAddress.safeParse(value);
    if (address.success) addresses.add(address.data);
  }
  return [...addresses];
}

export function requireIdentityPermission(
  actor: PermSetUser,
  access: "view" | "consent" | "operate",
) {
  if (!hasNewsletterPermission(actor, access)) throw new TRPCError({ code: "FORBIDDEN" });
}

export async function requireNewsletterPerson(
  db: Db,
  actor: PermSetUser,
  personId: string,
  signal: AbortSignal,
  lock = false,
) {
  signal.throwIfAborted();
  const query = db
    .select()
    .from(persons)
    .where(and(eq(persons.id, personId), isNull(persons.deletedAt)));
  const [person] = await (lock ? query.for("update") : query);
  signal.throwIfAborted();
  if (person === undefined || !canSee(actor, { kind: "person", ...person })) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return person;
}
