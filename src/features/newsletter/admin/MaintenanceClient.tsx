"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { EngineReadinessCard } from "@/features/newsletter/delivery/EngineReadinessCard";
import { useNewsletterRead, useNewsletterWrite } from "../ui/client";
import { cleanupKinds, type MaintenanceSnapshot } from "./contracts";
import { adminMessages } from "./messages";

type CleanupKind = (typeof cleanupKinds)[number];
type AnalyticsKind = Exclude<CleanupKind, "unconfirmed">;
type Labels = ReturnType<typeof adminMessages>;
type CleanupReceipt = { deleted: number | null };
type ExportReceipt = { filename: string; csv: string };

function Retention({ data, L }: { data: MaintenanceSnapshot; L: Labels }) {
  return (
    <SettingsCard>
      <SettingsCardHeader title={L.retention} description={L.retentionInfo} />
      <SettingsCardBody className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{L.orphans}</dt>
            <dd className="text-lg font-semibold">{data.orphanedSubscribers}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{L.blocked}</dt>
            <dd className="text-lg font-semibold">{data.blocklistedSubscribers}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/campaigns/subscribers"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {L.subscriptions}
          </Link>
          <Link
            href="/settings/privacy"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {L.privacy}
          </Link>
        </div>
      </SettingsCardBody>
    </SettingsCard>
  );
}

function CleanupCard({ today, weekAgo, L }: { today: string; weekAgo: string; L: Labels }) {
  const [kind, setKind] = useState<CleanupKind>("unconfirmed");
  const [before, setBefore] = useState<string | null>(weekAgo);
  const [confirmed, setConfirmed] = useState<{ kind: CleanupKind; before: string } | null>(null);
  const [receipt, setReceipt] = useState<CleanupReceipt | null>(null);
  const write = useNewsletterWrite<CleanupReceipt>();
  const options = [
    { value: "unconfirmed", label: L.oldSubscriptions },
    { value: "views", label: L.views },
    { value: "clicks", label: L.clicks },
  ];
  const label = options.find((option) => option.value === confirmed?.kind)?.label ?? "";

  async function removeMatching() {
    const request = confirmed;
    if (request === null || write.isPending) return;
    setReceipt(null);
    try {
      setReceipt(await write.run("admin.cleanup", { ...request, confirmed: true }));
    } catch {
      // The mutation exposes the failure without repeating the request.
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader title={L.cleanup} />
      <SettingsCardBody className="space-y-4">
        <div className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_auto]">
          <div className="space-y-1">
            <p className="text-sm font-medium">{L.operation}</p>
            <Select
              value={kind}
              ariaLabel={L.operation}
              options={options}
              disabled={write.isPending}
              onChange={(value) => {
                const next = cleanupKinds.find((key) => key === value);
                if (next !== undefined) setKind(next);
              }}
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{L.cutoff}</p>
            <DatePicker
              value={before}
              onChange={setBefore}
              ariaLabel={L.cutoff}
              triggerClassName="w-full justify-start"
            />
          </div>
          <Button
            variant="destructive"
            disabled={before === null || before > today || write.isPending}
            onClick={() => {
              if (before !== null) setConfirmed({ kind, before });
            }}
          >
            {L.cleanup}
          </Button>
        </div>
        {receipt !== null && (
          <p role="status" className="text-sm">
            {receipt.deleted === null ? L.cleanupDone : `${L.cleanupCount} · ${receipt.deleted}`}
          </p>
        )}
        {write.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {L.writeError}
          </p>
        )}
      </SettingsCardBody>
      <ConfirmDialog
        open={confirmed !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmed(null);
        }}
        title={L.cleanupTitle}
        description={`${label} · ${L.cutoff} ${confirmed?.before ?? ""}`}
        confirmLabel={L.cleanup}
        destructive
        onConfirm={() => void removeMatching()}
      />
    </SettingsCard>
  );
}

function downloadCsv(receipt: ExportReceipt) {
  const url = URL.createObjectURL(new Blob([receipt.csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = receipt.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportCard({ today, monthAgo, L }: { today: string; monthAgo: string; L: Labels }) {
  const [kind, setKind] = useState<AnalyticsKind>("views");
  const [since, setSince] = useState<string | null>(monthAgo);
  const write = useNewsletterWrite<ExportReceipt>();
  const options = [
    { value: "views", label: L.views },
    { value: "clicks", label: L.clicks },
  ];

  async function exportData() {
    if (since === null || since > today || write.isPending) return;
    try {
      downloadCsv(await write.run("admin.export", { kind, since }));
    } catch {
      // A failed or incomplete response never triggers a download.
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader title={L.analyticsExport} description={L.exportInfo} />
      <SettingsCardBody className="space-y-4">
        <div className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_auto]">
          <div className="space-y-1">
            <p className="text-sm font-medium">{L.analytics}</p>
            <Select
              value={kind}
              onChange={(value) => {
                if (value === "views" || value === "clicks") setKind(value);
              }}
              options={options}
              ariaLabel={L.analytics}
              disabled={write.isPending}
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{L.since}</p>
            <DatePicker
              value={since}
              onChange={setSince}
              ariaLabel={L.since}
              triggerClassName="w-full justify-start"
            />
          </div>
          <Button
            disabled={since === null || since > today || write.isPending}
            onClick={() => void exportData()}
          >
            {L.export}
          </Button>
        </div>
        {write.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {L.writeError}
          </p>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}

export function MaintenanceClient({
  today,
  weekAgo,
  monthAgo,
}: {
  today: string;
  weekAgo: string;
  monthAgo: string;
}) {
  const L = adminMessages(useLocale());
  const status = useNewsletterRead<{ configured: boolean }>("system.status");
  const configured = status.data?.configured === true;
  const maintenance = useNewsletterRead<MaintenanceSnapshot>("admin.maintenance", {}, configured);
  const data = maintenance.data;
  if (data === undefined) {
    const failed = maintenance.isError || status.isError;
    return (
      <SettingsCard>
        <SettingsCardBody className="flex flex-wrap items-center justify-between gap-3">
          <p role={failed ? "alert" : "status"} className="text-sm text-muted-foreground">
            {failed
              ? L.unavailable
              : status.data?.configured === false
                ? L.disconnected
                : L.loading}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={status.isFetching || maintenance.isFetching}
            onClick={() => {
              if (configured) void maintenance.refetch();
              else void status.refetch();
            }}
          >
            {L.refresh}
          </Button>
        </SettingsCardBody>
      </SettingsCard>
    );
  }
  return (
    <>
      <EngineReadinessCard />
      <Retention data={data} L={L} />
      <CleanupCard today={today} weekAgo={weekAgo} L={L} />
      <ExportCard today={today} monthAgo={monthAgo} L={L} />
      <SettingsCard>
        <SettingsCardHeader title={L.vacuum} description={L.vacuumInfo} />
        <SettingsCardBody className="flex flex-wrap items-center gap-3 text-sm">
          <span>{data.vacuumEnabled ? L.on : L.off}</span>
          {data.vacuumEnabled && data.vacuumSchedule !== null && (
            <code dir="ltr">{data.vacuumSchedule}</code>
          )}
        </SettingsCardBody>
      </SettingsCard>
    </>
  );
}
