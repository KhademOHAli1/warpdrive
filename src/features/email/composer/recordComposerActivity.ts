import { createActivityAction } from "@/features/activities/actions";
import { readCsrfToken } from "@/utils/csrfCookie";
import { COMPOSER_STRINGS } from "./composer.constants";
import type { ComposerSendDeps } from "./useComposerSend";

export function recordComposerActivity(
  deps: Pick<
    ComposerSendDeps,
    "addAsActivity" | "activityTypes" | "context" | "linkDealId" | "linkPersonId"
  >,
  capturedSubject: string,
  scheduled: boolean,
): void {
  const { addAsActivity, activityTypes, context, linkDealId, linkPersonId } = deps;
  if (!addAsActivity) return;

  const emailType = activityTypes.find((t) => t.key === COMPOSER_STRINGS.emailActivityTypeKey);
  const typeId = emailType?.id ?? activityTypes[0]?.id;
  if (typeId === undefined) {
    console.warn(
      "add-as-activity: typeId unavailable (activity types not loaded), activity not created",
    );
    return;
  }

  void createActivityAction(
    {
      typeId,
      subject: capturedSubject,
      priority: null,
      // The email has gone out, so the activity is already done. Logged open it would sit in
      // the dashboard's undated bucket forever: no due date to schedule it by, and nobody
      // goes back to tick off a mail they already sent.
      done: true,
      dueAt: null,
      durationMinutes: null,
      dealId: context?.kind === "deal" ? context.dealId : (linkDealId ?? null),
      personId: (context?.kind === "deal" ? context.personId : linkPersonId) ?? null,
      orgId: context?.kind === "deal" ? (context.orgId ?? null) : null,
      guestPersonIds: [],
      participantUserIds: [],
      customFields: {},
    },
    readCsrfToken(),
  ).then((activityResult) => {
    if (!activityResult.ok) {
      const label = scheduled ? "add-as-activity (scheduled)" : "add-as-activity";
      console.warn(`${label} failed after send`, activityResult.error.id);
    }
  });
}
