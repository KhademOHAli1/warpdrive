"use client";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { formatUserName } from "@/features/identity/formatUserName";
import { useFormatters } from "@/lib/useFormatters";

export function AttributionLine({
  at,
  actorName,
}: {
  at: Date;
  actorName: string | null;
}): React.ReactNode {
  const t = useAppTranslations("sales");
  const format = useFormatters();
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      <time dateTime={at.toISOString()}>{format.dateTime(at)}</time>
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
