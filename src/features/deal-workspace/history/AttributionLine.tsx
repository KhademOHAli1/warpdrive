"use client";
import type React from "react";
import { useSyncExternalStore } from "react";
import { formatTimelineEmailDate } from "@/features/email/inboxDate";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatUserName } from "@/features/identity/formatUserName";

const subscribe = (): (() => void) => () => {};
const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

export function AttributionLine({
  at,
  actorName,
}: {
  at: Date;
  actorName: string | null;
}): React.ReactNode {
  const t = useAppTranslations("sales");
  const preferences = useLocalePreferences();
  // A minute can tick during hydration, and server/browser Intl punctuation differs.
  // Start with the stable ISO timestamp, then localize once the browser owns the render.
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      <time dateTime={at.toISOString()}>
        {hydrated
          ? formatTimelineEmailDate(at.toISOString(), undefined, preferences)
          : at.toISOString()}
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
