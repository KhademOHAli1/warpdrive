import type { PermSetUser } from "@/features/permissions/effective";

export type NewsletterAccess = "view" | "edit" | "send" | "consent" | "operate";

export function hasNewsletterPermission(
  actor: PermSetUser | null | undefined,
  access: NewsletterAccess,
): boolean {
  if (actor == null || !actor.isActive) return false;
  if (actor.type === "admin") return true;
  if (access === "operate" || !actor.flags.has("newsletter.view")) return false;
  return access === "view" || actor.flags.has(`newsletter.${access}`);
}

const readOnly: Readonly<Record<string, NewsletterAccess>> = {
  "system.status": "view",
  "campaigns.list": "view",
  "campaigns.detail": "view",
  "campaigns.config": "view",
  "campaigns.replyMailboxes": "edit",
  "analytics.series": "view",
  "delivery.status": "view",
  "media.list": "view",
  "templates.list": "view",
  "templates.detail": "view",
  "lists.minimal": "view",
  "crmAudience.views": "view",
  "crmAudience.purposes": "view",
  "crmAudience.seal": "view",
  "crmAudience.preview": "view",
};

const writes: Readonly<Record<string, NewsletterAccess>> = {
  "campaigns.preview": "view",
  "templates.preview": "view",
  "campaigns.create": "edit",
  "campaigns.clone": "edit",
  "campaigns.update": "edit",
  "crmAudience.freeze": "edit",
  "media.upload": "edit",
  "templates.create": "edit",
  "templates.update": "edit",
  "campaigns.status": "send",
  "campaigns.test": "send",
};

export function newsletterOperationAccess(
  operation: string,
  method: "read" | "write",
): NewsletterAccess {
  const declared = method === "read" ? readOnly : writes;
  return Object.hasOwn(declared, operation) ? (declared[operation] ?? "operate") : "operate";
}
