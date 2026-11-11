import type { Db } from "@/db/client";
import type { WorkflowV2Node } from "@/features/blocks/contracts";
import { toContactActor } from "@/features/contacts/actorAdapters";
import { getPerson } from "@/features/contacts/personsRepo";
import { hasNewsletterPermission, type NewsletterAccess } from "@/features/newsletter/permissions";
import type { PermSetUser } from "@/features/permissions/effective";

export function newsletterActionAccess(type: WorkflowV2Node["type"]): NewsletterAccess | null {
  if (type === "NEWSLETTER_INVITE") return "consent";
  if (type === "NEWSLETTER_CONSENT_STATUS") return "view";
  return null;
}

export async function newsletterPersonVisible(
  db: Db,
  actor: PermSetUser,
  personId: string,
  access: NewsletterAccess,
  signal: AbortSignal,
): Promise<boolean> {
  if (!hasNewsletterPermission(actor, access)) return false;
  const person = await getPerson(db, toContactActor(actor), personId, signal);
  return person.ok;
}
