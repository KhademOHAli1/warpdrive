"use client";

import { useState } from "react";
import {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_HEAD,
  SETTINGS_TABLE_HEADER_CELL,
  SETTINGS_TABLE_ROW,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { operationalNoticeText } from "../delivery/operationalMessages";
import { useNewsletterRead } from "../ui/client";
import {
  type LogCursor,
  type LogEntry,
  type LogOutcome,
  type LogPage,
  logOutcomes,
} from "./contracts";
import { adminMessages } from "./messages";

type Labels = ReturnType<typeof adminMessages>;
type Source = LogEntry["source"];

function EventsTable({
  rows,
  formatter,
  L,
  locale,
}: {
  rows: LogEntry[];
  formatter: Intl.DateTimeFormat;
  L: Labels;
  locale: Locale;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={SETTINGS_TABLE_HEAD}>
          <tr>
            {[
              L.timestamp,
              L.source,
              L.operation,
              L.outcome,
              L.operationalDetail,
              L.correlation,
            ].map((label) => (
              <th key={label} scope="col" className={SETTINGS_TABLE_HEADER_CELL}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id} className={SETTINGS_TABLE_ROW}>
              <td className={SETTINGS_TABLE_CELL}>
                <time dateTime={entry.at}>{formatter.format(new Date(entry.at))}</time>
              </td>
              <td className={SETTINGS_TABLE_CELL}>{L[entry.source]}</td>
              <td className={SETTINGS_TABLE_CELL}>
                <code className="break-all" dir="ltr">
                  {entry.action}
                </code>
              </td>
              <td className={SETTINGS_TABLE_CELL}>{L.logOutcome(entry.outcome)}</td>
              <td className={SETTINGS_TABLE_CELL}>
                {entry.detail ? operationalNoticeText(entry.detail, locale) : "—"}
              </td>
              <td className={SETTINGS_TABLE_CELL}>
                <code className="break-all text-xs" dir="ltr">
                  {entry.correlationId ?? "—"}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LogsClient() {
  const prefs = useLocalePreferences();
  const L = adminMessages(prefs.locale);
  const [source, setSource] = useState<Source | undefined>();
  const [outcome, setOutcome] = useState<LogOutcome | undefined>();
  const [pages, setPages] = useState<LogCursor[]>([]);
  const cursor = pages.at(-1);
  const logs = useNewsletterRead<LogPage>("admin.logs", { source, outcome, cursor });
  const result = logs.data;
  const formatter = new Intl.DateTimeFormat(prefs.locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: prefs.timeZone,
    calendar: prefs.calendar,
  });
  const sources = [
    { value: "", label: L.allSources },
    { value: "workspace", label: L.workspace },
    { value: "campaigns", label: L.campaigns },
  ];
  const outcomes = [
    { value: "", label: L.all },
    ...logOutcomes.map((value) => ({ value, label: L.logOutcome(value) })),
  ];
  const next = result?.next ?? null;
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L.logs}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={logs.isFetching}
            onClick={() => void logs.refetch()}
          >
            {L.refresh}
          </Button>
        }
      />
      <SettingsCardBody>
        <div className="flex flex-wrap gap-2">
          <Select
            value={source ?? ""}
            options={sources}
            ariaLabel={L.source}
            onChange={(value) => {
              setSource(value === "workspace" || value === "campaigns" ? value : undefined);
              setPages([]);
            }}
          />
          <Select
            value={outcome ?? ""}
            options={outcomes}
            ariaLabel={L.outcome}
            onChange={(value) => {
              setOutcome(logOutcomes.find((key) => key === value));
              setPages([]);
            }}
          />
        </div>
      </SettingsCardBody>
      {result !== undefined && result.rows.length > 0 ? (
        <EventsTable rows={result.rows} formatter={formatter} L={L} locale={prefs.locale} />
      ) : (
        <SettingsCardBody>
          <p role={logs.isError ? "alert" : "status"} className="text-sm text-muted-foreground">
            {logs.isError ? L.unavailable : logs.isPending ? L.loading : L.noLogs}
          </p>
        </SettingsCardBody>
      )}
      <div className="flex justify-end gap-2 border-t px-5 py-3">
        <Button
          variant="outline"
          size="sm"
          disabled={pages.length === 0 || logs.isFetching}
          onClick={() => setPages((current) => current.slice(0, -1))}
        >
          {L.newer}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={next === null || logs.isFetching}
          onClick={() => {
            if (next !== null) setPages((current) => [...current, next]);
          }}
        >
          {L.older}
        </Button>
      </div>
    </SettingsCard>
  );
}
