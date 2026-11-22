"use client";

import { Pencil, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateOnly, formatDateTime } from "@/lib/localeFormatting";
import type { BookingMaintenance, BookingSite } from "../contracts";
import type { OpenBookingEditor } from "./BookingDialog";
import { type BookingMembershipAccess, BookingMembershipPanel } from "./BookingMembershipPanel";
import { weekdays } from "./BookingPolicyEditors";
import type { BookingWords } from "./messages";

function PolicySummary({
  site,
  pending,
  open,
  words: t,
}: {
  site: BookingSite;
  pending: boolean;
  open: OpenBookingEditor;
  words: BookingWords;
}) {
  const { policy } = site;
  const preferences = useLocalePreferences();
  return (
    <section aria-label={t.settings} className="space-y-3 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.settings}</h2>
        {site.canConfigure && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={(event) => open(event.currentTarget, { type: "policy", siteId: site.id })}
          >
            <Pencil size={15} aria-hidden="true" /> {t.settingsEdit}
          </Button>
        )}
      </header>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t.zone}</dt>
          <dd>
            <bdi>{policy.timeZone}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.minLeadMinutes}</dt>
          <dd>{policy.minNoticeMinutes}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.maxDurationMinutes}</dt>
          <dd>{policy.maxDurationMinutes ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {policy.baseApproval && <Badge variant="outline">{t.requireBase}</Badge>}
          {policy.selfServiceApproval && <Badge variant="outline">{t.requireSelfService}</Badge>}
        </div>
      </dl>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t.workingHours}</h3>
        {policy.workingHours.enabled ? (
          <ul className="flex flex-wrap gap-1.5">
            {policy.workingHours.weekly.map(({ weekday, hours }) => (
              <li key={weekday} className="rounded-md border px-2 py-1 text-xs">
                {t[weekdays[weekday - 1] ?? "mon"]}{" "}
                {hours === null ? (
                  t.closed
                ) : (
                  <bdi>
                    {hours.opensAt} – {hours.closesAt}
                  </bdi>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t.fullDay}</p>
        )}
        {policy.workingHours.overrides.length > 0 && (
          <>
            <h3 className="text-sm font-semibold">{t.exceptions}</h3>
            <ul className="space-y-1 text-sm">
              {policy.workingHours.overrides.map(({ date, hours, reason }) => (
                <li
                  key={date}
                  data-booking-exception-date={date}
                  className="flex flex-wrap gap-x-2 [overflow-wrap:anywhere]"
                >
                  <time dateTime={date}>{formatDateOnly(date, preferences)}</time>
                  {hours === null ? (
                    <span className="text-muted-foreground">{t.closed}</span>
                  ) : (
                    <bdi>
                      {hours.opensAt} – {hours.closesAt}
                    </bdi>
                  )}
                  {reason !== null && <bdi className="text-muted-foreground">{reason}</bdi>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function MaintenanceSummary({
  site,
  entries,
  pending,
  open,
  words: t,
}: {
  site: BookingSite;
  entries: BookingMaintenance[];
  pending: boolean;
  open: OpenBookingEditor;
  words: BookingWords;
}) {
  const preferences = { ...useLocalePreferences(), timeZone: site.policy.timeZone };
  const active = entries.filter(({ cancelled }) => !cancelled);
  const editable = site.archived !== true;
  return (
    <section aria-label={t.maintenance} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.maintenance}</h2>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={(event) => open(event.currentTarget, { type: "maintenance", siteId: site.id })}
          >
            <Plus size={15} aria-hidden="true" /> {t.maintenanceAdd}
          </Button>
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noMaintenance}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {active.map((maintenance) => (
            <li
              key={maintenance.id}
              data-booking-maintenance={maintenance.id}
              className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium [overflow-wrap:anywhere]">
                  <bdi>{maintenance.title}</bdi>
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={maintenance.window.startAt}>
                    {formatDateTime(maintenance.window.startAt, preferences)}
                  </time>
                  {" – "}
                  <time dateTime={maintenance.window.endAt}>
                    {formatDateTime(maintenance.window.endAt, preferences)}
                  </time>
                </p>
              </div>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={(event) =>
                      open(event.currentTarget, {
                        type: "maintenance",
                        siteId: site.id,
                        maintenance,
                      })
                    }
                  >
                    <Pencil size={14} aria-hidden="true" /> {t.maintenanceEdit}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={(event) =>
                      open(event.currentTarget, {
                        type: "removeMaintenance",
                        siteId: site.id,
                        maintenance,
                      })
                    }
                  >
                    <X size={14} aria-hidden="true" /> {t.maintenanceRemove}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BookingSettings({
  site,
  maintenance,
  pending,
  open,
  words,
  membershipAccess,
}: {
  site: BookingSite;
  maintenance: BookingMaintenance[];
  pending: boolean;
  open: OpenBookingEditor;
  words: BookingWords;
  membershipAccess?: BookingMembershipAccess;
}) {
  return (
    <div className="space-y-3">
      <PolicySummary {...{ site, pending, open, words }} />
      <MaintenanceSummary {...{ site, pending, open, words }} entries={maintenance} />
      {membershipAccess !== undefined && (
        <BookingMembershipPanel key={site.id} site={site} {...membershipAccess} />
      )}
    </div>
  );
}
