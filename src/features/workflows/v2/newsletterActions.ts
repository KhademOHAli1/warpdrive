import type { BlockOutput, WorkflowV2Context } from "@/features/blocks/contracts";
import { resolvedBlockConfigSchemas } from "@/features/blocks/schemas";
import type { PersonNewsletterSummary } from "@/features/newsletter/identity/contracts";
import {
  readPersonNewsletter,
  readPersonNewsletterGrants,
  requestNewsletterInvite,
} from "@/features/newsletter/identity/service";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { newsletterPersonVisible } from "./newsletterAuthority";

export type NewsletterAction = "NEWSLETTER_CONSENT_STATUS" | "NEWSLETTER_INVITE";

export function projectWorkflowNewsletterConsent(
  summary: PersonNewsletterSummary,
  listId: number,
  linkId: string | undefined,
): BlockOutput {
  const links = summary.addresses.flatMap(({ links }) =>
    links.filter(
      (link) => link.state === "verified" && (linkId === undefined || link.id === linkId),
    ),
  );
  if (links.length !== 1) {
    return { state: links.length === 0 ? "unlinked" : "ambiguous", confirmed: false, linkId: null };
  }
  const [link] = links;
  if (link?.shared === true) return { state: "ambiguous", confirmed: false, linkId: null };
  if (link === undefined || !summary.engineAvailable || link.consent === null) {
    return { state: "unavailable", confirmed: false, linkId: null };
  }
  if (link.consent.status !== "enabled") {
    return { state: link.consent.status, confirmed: false, linkId: link.id };
  }
  const membership = link.consent.lists.find((list) => list.id === listId);
  if (membership?.optin === "single")
    return { state: "singleOptIn", confirmed: false, linkId: link.id };
  const state =
    membership?.status === "archived"
      ? "archived"
      : (membership?.subscriptionStatus ?? "notSubscribed");
  return {
    state,
    confirmed: state === "confirmed",
    linkId: link.id,
  };
}

export async function executeNewsletterWorkflowAction(
  context: WorkflowV2Context,
  type: NewsletterAction,
  config: BlockOutput,
) {
  if (context.mode === "test") return err({ id: "E_WORKFLOW_EXTERNAL_TEST_FORBIDDEN" });
  const parsed = resolvedBlockConfigSchemas[type].safeParse(config);
  if (!parsed.success) return err({ id: "E_WORKFLOW_V2_INVALID" });
  const { db, signal } = context;
  const actor = await hydrateActor(db, context.actor.id, signal);
  const access = type === "NEWSLETTER_INVITE" ? "consent" : "view";
  const { personId, listId, linkId } = parsed.data;
  if (actor === null || !(await newsletterPersonVisible(db, actor, personId, access, signal)))
    return err({ id: "E_WORKFLOW_V2_DENIED" });

  if (type === "NEWSLETTER_CONSENT_STATUS") {
    const summary = await readPersonNewsletter(db, actor, personId, signal);
    const status = projectWorkflowNewsletterConsent(summary, listId, linkId);
    if (status.confirmed !== true) return ok(status);
    // A mutable Listmonk membership flag alone cannot establish a CRM purpose grant.
    const grants = await readPersonNewsletterGrants(db, actor, [personId], listId, signal);
    return ok(
      grants.some(({ bindingUuid }) => bindingUuid === status.linkId)
        ? status
        : { ...status, state: "unverified", confirmed: false },
    );
  }
  if (linkId === undefined) return err({ id: "E_WORKFLOW_V2_INVALID" });
  const result = await requestNewsletterInvite(
    db,
    actor,
    { operationId: context.effectKey, personId, linkId, listId, originRunId: context.runId },
    signal,
  );
  if (result.state === "unknown")
    return err({ id: "E_WORKFLOW_V2_EXTERNAL_UNKNOWN", outcome: "unknown" as const });
  return ok({ id: result.id, state: result.state } satisfies BlockOutput);
}
