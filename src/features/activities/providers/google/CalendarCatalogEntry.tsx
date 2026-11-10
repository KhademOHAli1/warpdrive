"use client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { isTimeZone } from "@/features/i18n/preferences";
import type { GoogleCalendarCatalogEntry } from "./catalogContracts";

function roleLabel(role: string | null) {
  switch (role) {
    case "owner":
      return "owner";
    case "writer":
      return "writer";
    case "writerWithoutPrivateAccess":
      return "restrictedWriter";
    case "reader":
      return "reader";
    case "freeBusyReader":
      return "freeBusy";
    case "none":
      return "none";
    case null:
    default:
      return "unknown";
  }
}
export function CalendarCatalogEntry({
  row,
  pending,
  canAdd,
  onSelect,
}: {
  row: GoogleCalendarCatalogEntry;
  pending: boolean;
  canAdd: boolean;
  onSelect: (row: GoogleCalendarCatalogEntry) => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const selected = row.selection?.selected === true;
  const supportedZone =
    row.timeZone !== null && row.timeZone.length <= 100 && isTimeZone(row.timeZone);
  return (
    <li className="flex min-w-0 flex-wrap items-start gap-3 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p dir="auto" className="break-words text-sm font-medium">
          {row.name}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">
            {t(`googleConnection.catalog.roles.${roleLabel(row.accessRole)}`)}
          </Badge>
          {selected && <Badge variant="secondary">{t("googleConnection.catalog.selected")}</Badge>}
          {row.hidden && <Badge variant="outline">{t("googleConnection.catalog.hidden")}</Badge>}
        </div>
        {row.timeZone !== null && (
          <p className="text-xs text-muted-foreground" dir="ltr">
            {row.timeZone}
          </p>
        )}
        {!row.available && (
          <p className="text-xs text-muted-foreground">
            {t("googleConnection.catalog.unavailable")}
          </p>
        )}
        {!supportedZone && (
          <p className="text-xs text-muted-foreground">
            {t("googleConnection.catalog.zoneUnavailable")}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || (!selected && (!canAdd || !row.available || !supportedZone))}
        aria-label={t(
          selected
            ? "googleConnection.catalog.removeCalendar"
            : "googleConnection.catalog.addCalendar",
          { name: row.name },
        )}
        onClick={() => onSelect(row)}
      >
        {t(selected ? "googleConnection.catalog.remove" : "googleConnection.catalog.add")}
      </Button>
    </li>
  );
}
