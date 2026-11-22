"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { ToggleField } from "@/components/ui/ToggleField";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { readQuantity } from "../../ui/AssetEditorFields";
import type { BookingIntent, BookingPolicy, BookingSite } from "../contracts";
import { BookingDialog, type BookingEditor, type BookingEditorProps } from "./BookingDialog";
import { BookingDemandRow, demandDrafts, emptyDemand, readDemand } from "./BookingResourceFields";
import { BookingTimeFields, resolveBookingWindow, windowDraft } from "./BookingTimeFields";
import type { BookingWords } from "./messages";

type Hours = BookingPolicy["workingHours"]["weekly"][number]["hours"];
type ExceptionDraft = BookingPolicy["workingHours"]["overrides"][number] & { key: string };
const defaultHours = { opensAt: "09:00", closesAt: "17:00" };
export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function HoursInputs({
  hours,
  words: t,
  onChange,
  label,
}: {
  hours: Hours;
  words: BookingWords;
  onChange: (hours: Hours) => void;
  label: string;
}) {
  const closed = hours === null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ToggleField
        label={t.closed}
        accessibleLabel={`${label} · ${t.closed}`}
        checked={closed}
        onCheckedChange={(next) => onChange(next ? null : defaultHours)}
      />
      {hours !== null && (
        <>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>{t.opens}</span>
            <TimePicker
              ariaLabel={t.opens}
              value={hours.opensAt}
              required
              onChange={(opensAt) => onChange({ ...hours, opensAt })}
            />
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>{t.closes}</span>
            <TimePicker
              ariaLabel={t.closes}
              value={hours.closesAt}
              required
              onChange={(closesAt) => onChange({ ...hours, closesAt })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ExceptionEditor({
  entry,
  pending,
  words: t,
  onChange,
  onRemove,
}: {
  entry: ExceptionDraft;
  pending: boolean;
  words: BookingWords;
  onChange: (entry: ExceptionDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div data-booking-exception className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <DatePicker
          value={entry.date || null}
          ariaLabel={t.date}
          onChange={(date) => onChange({ ...entry, date: date ?? "" })}
        />
        <HoursInputs
          hours={entry.hours}
          words={t}
          label={entry.date || t.date}
          onChange={(hours) => onChange({ ...entry, hours })}
        />
        <Button variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
          <X size={15} aria-hidden="true" /> {t.removeException}
        </Button>
      </div>
      <SalesInput
        label={t.optionalReason}
        value={entry.reason ?? ""}
        maxLength={500}
        disabled={pending}
        onChange={(event) => onChange({ ...entry, reason: event.currentTarget.value || null })}
      />
    </div>
  );
}

export function PolicyEditorDialog({
  site,
  state,
  words: t,
}: Omit<BookingEditorProps, "workspace"> & { site: BookingSite }) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const [policy, setPolicy] = useState(site.policy);
  const [notice, setNotice] = useState(String(policy.minNoticeMinutes));
  const [duration, setDuration] = useState(policy.maxDurationMinutes?.toString() ?? "");
  const [overrides, setOverrides] = useState<ExceptionDraft[]>(() =>
    policy.workingHours.overrides.map((row) => ({ ...row, key: row.date })),
  );
  const minNoticeMinutes = readQuantity(notice, locale);
  const maxDurationMinutes = readQuantity(duration, locale);
  const allowsDuration = duration.trim() === "" || maxDurationMinutes !== null;
  const intent: BookingIntent | null =
    minNoticeMinutes === null || !allowsDuration
      ? null
      : {
          type: "savePolicy",
          siteId: site.id,
          version: site.policyVersion,
          policy: {
            ...policy,
            minNoticeMinutes,
            maxDurationMinutes,
            workingHours: {
              ...policy.workingHours,
              overrides: overrides.map(({ date, hours, reason }) => ({
                date,
                hours,
                reason: (reason ?? "").trim() || null,
              })),
            },
          },
        };
  const { workingHours } = policy;

  return (
    <BookingDialog
      state={state}
      intent={intent}
      title={t.settingsEdit}
      description={t.settingsIntro}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <SalesInput
            label={t.zone}
            value={policy.timeZone}
            maxLength={80}
            required
            disabled={state.pending}
            dir="ltr"
            onChange={(event) => setPolicy({ ...policy, timeZone: event.currentTarget.value })}
          />
          <p className="text-xs text-muted-foreground">{t.timezoneHint}</p>
        </div>
        <div className="space-y-1">
          <ToggleField
            label={t.requireBase}
            checked={policy.baseApproval}
            disabled={state.pending}
            onCheckedChange={(baseApproval) => setPolicy({ ...policy, baseApproval })}
          />
          <ToggleField
            label={t.requireSelfService}
            checked={policy.selfServiceApproval}
            disabled={state.pending}
            onCheckedChange={(selfServiceApproval) => setPolicy({ ...policy, selfServiceApproval })}
          />
        </div>
      </div>
      <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium">{t.limits}</legend>
        <SalesInput
          label={t.minLeadMinutes}
          value={notice}
          dir="ltr"
          inputMode="numeric"
          maxLength={12}
          required
          disabled={state.pending}
          onChange={(event) => setNotice(event.currentTarget.value)}
        />
        <SalesInput
          label={t.maxDurationMinutes}
          value={duration}
          dir="ltr"
          inputMode="numeric"
          maxLength={12}
          disabled={state.pending}
          onChange={(event) => setDuration(event.currentTarget.value)}
        />
      </fieldset>
      <fieldset disabled={state.pending} className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-medium">{t.workingHours}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleField
            label={t.enforceHours}
            checked={workingHours.enabled}
            disabled={state.pending}
            onCheckedChange={(enabled) =>
              setPolicy({ ...policy, workingHours: { ...workingHours, enabled } })
            }
          />
          <ToggleField
            label={t.skipClosedDays}
            checked={policy.skipClosedDays}
            disabled={state.pending}
            onCheckedChange={(skipClosedDays) => setPolicy({ ...policy, skipClosedDays })}
          />
        </div>
        <ul className="divide-y rounded-md border">
          {workingHours.weekly.map(({ weekday, hours }) => {
            const label = t[weekdays[weekday - 1] ?? "mon"];
            return (
              <li
                key={weekday}
                data-booking-day={weekday}
                className="flex flex-wrap items-start justify-between gap-2 p-2.5"
              >
                <p className="min-w-24 text-sm font-medium">{label}</p>
                <HoursInputs
                  hours={hours}
                  words={t}
                  label={label}
                  onChange={(hours) =>
                    setPolicy({
                      ...policy,
                      workingHours: {
                        ...workingHours,
                        weekly: workingHours.weekly.map((row) =>
                          row.weekday === weekday ? { ...row, hours } : row,
                        ),
                      },
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t.exceptions}</h3>
          {overrides.map((entry) => (
            <ExceptionEditor
              key={entry.key}
              entry={entry}
              pending={state.pending}
              words={t}
              onChange={(next) =>
                setOverrides((rows) => rows.map((row) => (row.key === entry.key ? next : row)))
              }
              onRemove={() => setOverrides((rows) => rows.filter(({ key }) => key !== entry.key))}
            />
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={state.pending || overrides.length >= 366}
            onClick={() =>
              setOverrides((rows) => [
                ...rows,
                { key: crypto.randomUUID(), date: "", hours: null, reason: null },
              ])
            }
          >
            <Plus size={15} aria-hidden="true" /> {t.addException}
          </Button>
        </div>
      </fieldset>
    </BookingDialog>
  );
}

type MaintenanceEditor = Extract<BookingEditor, { type: "maintenance" | "removeMaintenance" }>;

export function MaintenanceEditorDialog({
  editor,
  site,
  workspace,
  state,
  words: t,
}: BookingEditorProps & {
  site: BookingSite;
  editor: Extract<MaintenanceEditor, { type: "maintenance" }>;
}) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const { maintenance } = editor;
  const { timeZone } = site.policy;
  const [title, setTitle] = useState(maintenance?.title ?? "");
  const [times, setTimes] = useState(() => windowDraft(maintenance?.window, timeZone));
  const [draft, setDraft] = useState(() =>
    maintenance === undefined
      ? emptyDemand("maintenance")
      : (demandDrafts([maintenance.demand])[0] ?? emptyDemand("maintenance")),
  );
  const resolved = resolveBookingWindow(times, timeZone, maintenance?.window);
  const demand = readDemand(draft, locale);
  const intent: BookingIntent | null =
    resolved === null || demand === null
      ? null
      : {
          type: "saveMaintenance",
          siteId: site.id,
          maintenanceId: maintenance?.id ?? null,
          version: maintenance?.version ?? null,
          title,
          window: resolved.window,
          demand,
        };
  return (
    <BookingDialog
      state={state}
      intent={intent}
      title={maintenance === undefined ? t.maintenanceAdd : t.maintenanceEdit}
      description={t.maintenanceIntro}
    >
      <SalesInput
        label={t.maintenanceTitle}
        value={title}
        required
        maxLength={120}
        disabled={state.pending}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      <BookingTimeFields
        value={times}
        pending={state.pending}
        timeZone={timeZone}
        valid={resolved !== null}
        ambiguous={resolved?.ambiguous === true}
        maintenance
        words={t}
        onChange={setTimes}
      />
      <BookingDemandRow
        draft={draft}
        resources={workspace.resources.filter((row) => row.siteId === site.id)}
        pending={state.pending}
        words={t}
        onChange={setDraft}
      />
    </BookingDialog>
  );
}

export function RemoveMaintenanceDialog({
  editor,
  state,
  words: t,
}: Pick<BookingEditorProps, "state" | "words"> & {
  editor: Extract<MaintenanceEditor, { type: "removeMaintenance" }>;
}) {
  const { maintenance, siteId } = editor;
  return (
    <BookingDialog
      state={state}
      title={t.maintenanceRemove}
      description={t.maintenanceRemoveIntro}
      intent={{
        type: "cancelMaintenance",
        siteId,
        maintenanceId: maintenance.id,
        version: maintenance.version,
      }}
    >
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
        <bdi>{maintenance.title}</bdi>
      </p>
    </BookingDialog>
  );
}
