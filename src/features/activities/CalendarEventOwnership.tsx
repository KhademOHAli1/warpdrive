"use client";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/primitives/collapsible";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { CalendarEditorSettings } from "./useCalendarEventSettings";

export function CalendarEventOwnership({
  settings,
  calendars,
  legacy,
  reveal = false,
  onChange,
}: {
  settings: CalendarEditorSettings;
  calendars: { id: string; name: string; role: string | null }[];
  legacy: boolean;
  reveal?: boolean;
  onChange: (patch: Partial<CalendarEditorSettings>) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const [expanded, setExpanded] = useState(false);
  const open = expanded || reveal;
  const options = calendars
    .filter((c) => c.role === "owner" || c.role === "editor")
    .map((c) => ({
      value: c.id,
      label: c.name === "" ? t("settings.personal") : c.name,
    }));
  if (legacy) options.unshift({ value: "", label: t("settings.crm") });
  if (settings.calendarId !== "" && !options.some((c) => c.value === settings.calendarId))
    options.push({ value: settings.calendarId, label: t("settings.current") });
  const name =
    options.find((c) => c.value === settings.calendarId)?.label ?? t("settings.personal");
  return (
    <Collapsible open={open} onOpenChange={setExpanded}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            aria-label={`${t("settings.eventCalendar")}: ${name}`}
            className="min-w-0 max-w-full justify-start px-0 font-normal"
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <bdi dir="auto" className="truncate">
              {name}
            </bdi>
            <ChevronDown
              data-disclosure-chevron
              data-state={open ? "open" : "closed"}
              data-rtl-mirror="false"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
        {settings.eventVisibility === "private" && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs">{t("settings.private")}</span>
        )}
        {settings.availability === "free" && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs">{t("settings.free")}</span>
        )}
      </div>
      <CollapsibleContent className="space-y-3 pb-2 ps-6 pt-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("settings.eventCalendar")}</p>
          <Select
            ariaLabel={t("settings.eventCalendar")}
            value={settings.calendarId}
            options={options}
            onChange={(calendarId) =>
              onChange(
                calendarId === ""
                  ? { calendarId, eventVisibility: "default", availability: "busy" }
                  : { calendarId },
              )
            }
          />
        </div>
        {settings.calendarId !== "" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("settings.availability")}
                </p>
                <Select
                  ariaLabel={t("settings.availability")}
                  value={settings.availability}
                  options={[
                    { value: "busy", label: t("busy") },
                    { value: "free", label: t("settings.free") },
                  ]}
                  onChange={(availability) => {
                    if (availability === "busy" || availability === "free")
                      onChange({ availability });
                  }}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("settings.visibility")}
                </p>
                <Select
                  ariaLabel={t("settings.visibility")}
                  value={settings.eventVisibility}
                  options={[
                    { value: "default", label: t("settings.defaultVisibility") },
                    { value: "private", label: t("settings.private") },
                  ]}
                  onChange={(eventVisibility) => {
                    if (eventVisibility === "private" || eventVisibility === "default")
                      onChange({ eventVisibility });
                  }}
                />
              </div>
            </div>
            {settings.eventVisibility === "private" && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("settings.privateHint")}
              </p>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
