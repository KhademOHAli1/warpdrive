import type { Db } from "@/db/client";
import { canSeeLinkedDeal, canSeeLinkedPerson } from "./emailVisibility";
import { resolveOutboundLink } from "./linking";
import type { SmtpAttempt } from "./smtpOutboxTypes";
import { hydrateOwner } from "./syncCursor";

export async function smtpThreadLinks(db: Db, attempt: SmtpAttempt, signal: AbortSignal) {
  let personId: string | null = null;
  let dealId: string | null = null;
  const owner = await hydrateOwner(db, attempt.owner_id, signal);
  if (!owner.ok || !owner.value.isActive) return { personId, dealId };
  const payload = attempt.payload;
  if (
    payload.linkPersonId != null &&
    (await canSeeLinkedPerson(db, owner.value, payload.linkPersonId, signal))
  )
    personId = payload.linkPersonId;
  if (
    payload.linkDealId != null &&
    (await canSeeLinkedDeal(db, owner.value, payload.linkDealId, signal))
  )
    dealId = payload.linkDealId;
  if (personId === null || dealId === null) {
    const outcome = await resolveOutboundLink(
      db,
      {
        owner: owner.value,
        fromEmail: attempt.from_email,
        recipients: [...payload.to, ...(payload.cc ?? []), ...(payload.bcc ?? [])],
      },
      signal,
    );
    if (outcome.kind === "linked") {
      personId ??= outcome.personId;
      dealId ??= outcome.dealId;
    }
  }
  return { personId, dealId };
}
