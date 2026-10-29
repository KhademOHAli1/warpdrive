"use client";
import type React from "react";
import { formatTimelineEmailDate } from "@/features/email/inboxDate";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatUserName } from "@/features/identity/formatUserName";

export function AttributionLine({
  at,
  actorName,
}: {
  at: Date;
  actorName: string | null;
}): React.ReactNode {
  const t = useAppTranslations("sales");
  const preferences = useLocalePreferences();
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      <time dateTime={at.toISOString()}>
        {formatTimelineEmailDate(at.toISOString(), undefined, preferences)}
      </time>
      {" · "}
      {actorName === null ? (
        t("computed.unknownActor")
      ) : (
        <>
          <bdi dir="auto">{formatUserName(actorName)}</bdi>
          {` (${t("computed.webApp")})`}
        </>
      )}
    </p>
  );
}
