"use client";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

// Threads link to person_id (and deal_id), never to an organization, so an org has no linked
// mail to list. State the honest reason instead of a fake placeholder.

export function OrgEmailPanel(): React.ReactNode {
  const tContacts = useAppTranslations("contacts");

  return (
    <p className="text-sm text-muted-foreground">
      {tContacts("emailIsTrackedOnPeopleNotOrganizations")}
    </p>
  );
}
