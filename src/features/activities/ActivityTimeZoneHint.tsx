"use client";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { instantParts, wallTimeToInstant } from "@/lib/zonedDateTime";
export function ActivityTimeZoneHint({
  timeZone,
  date,
  time,
  legacy = false,
  originalInstant,
}: {
  timeZone: string;
  date: string;
  time: string;
  legacy?: boolean;
  originalInstant?: string | null;
}) {
  const t = useAppTranslations("calendar");
  let offset = "";
  let ambiguous = false;
  try {
    if (date !== "" && time !== "")
      ({ offset, ambiguous } = wallTimeToInstant(date, time, timeZone));
  } catch {}
  if (originalInstant != null && originalInstant !== "" && date !== "" && time !== "") {
    const original = instantParts(originalInstant, timeZone);
    if (original.date === date && original.time === time) offset = original.offset;
  }
  return (
    <div className="text-xs text-muted-foreground">
      <p>
        {t("draftTimeZone", {
          zone: `\u2066${timeZone}\u2069`,
          offset: offset ? `\u2066UTC${offset}\u2069` : "",
        })}
      </p>
      {ambiguous && <p>{t("ambiguousTime")}</p>}
      {legacy && <p>{t("legacyAllDay")}</p>}
    </div>
  );
}
