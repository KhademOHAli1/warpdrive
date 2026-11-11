"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import { AudienceReadError, AudienceWriteError } from "./components";
import {
  type Subscriber,
  type SubscriberActivity,
  type SubscriberExport,
  type SubscriberExportSection,
  subscriberExportSections,
} from "./contracts";
import { useAudienceMessages } from "./messages";

function download(receipt: SubscriberExport) {
  const url = URL.createObjectURL(
    new Blob([receipt.contents], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = receipt.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SubscriberRecordsDialog({
  row,
  close,
}: {
  row: Subscriber & { recordProof: string };
  close: () => void;
}) {
  const L = useAudienceMessages();
  const format = useFormatters();
  const prefix = useId();
  const [sections, setSections] = useState<SubscriberExportSection[]>(["profile", "memberships"]);
  const identity = { id: row.id, recordProof: row.recordProof, status: row.status };
  const read = useNewsletterRead<SubscriberActivity>("subscribers.activity", identity);
  const data = read.error === null && !read.isFetching ? read.data : undefined;
  const changed = read.error?.message === "audience_subscriber_changed";
  const write = useNewsletterWrite<SubscriberExport>();
  const labels = {
    profile: L.exportProfile,
    memberships: L.exportMemberships,
    activity: L.exportActivity,
  };

  function runExport() {
    void write
      .run("subscribers.export", { ...identity, sections })
      .then(download)
      .catch(() => undefined);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !write.isPending) close();
      }}
    >
      <DialogContent
        className={`max-h-[90dvh] overflow-y-auto sm:max-w-2xl ${BLOCK_CLASS} ph-no-capture`}
      >
        <DialogHeader>
          <DialogTitle>{L.subscriberActivity}</DialogTitle>
          <DialogDescription>
            <bdi dir="ltr">{row.email}</bdi> · {L[row.status]}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {changed && (
            <p role="alert" className="text-sm text-destructive">
              {L.subscriberChanged}
            </p>
          )}
          {read.error !== null && !changed && <AudienceReadError read={read} />}
          {read.isLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              {L.loading}
            </p>
          )}
          {data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">{L.noSubscriberActivity}</p>
          )}
          {data && data.items.length > 0 && (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
              {data.items.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 break-words">
                    <bdi dir="auto">{item.campaignName ?? L.unknownCampaign}</bdi>
                    <span className="block text-xs text-muted-foreground">
                      {item.kind === "view" ? L.activityViews : L.activityClicks}{" "}
                      {format.number(item.count)}
                    </span>
                  </span>
                  <time dateTime={item.lastAt} className="text-xs text-muted-foreground">
                    {format.dateTime(item.lastAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {data?.truncated === true && (
            <p className="text-xs text-muted-foreground">{L.activityLimit}</p>
          )}
        </div>
        <fieldset className="space-y-2 border-t pt-3">
          <legend className="text-sm font-medium">{L.exportFields}</legend>
          {subscriberExportSections.map((section) => (
            <label
              key={section}
              htmlFor={`${prefix}-${section}`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`${prefix}-${section}`}
                label={labels[section]}
                checked={sections.includes(section)}
                disabled={write.isPending}
                onCheckedChange={(checked) =>
                  setSections((previous) =>
                    checked ? [...previous, section] : previous.filter((item) => item !== section),
                  )
                }
              />
              {labels[section]}
            </label>
          ))}
        </fieldset>
        <AudienceWriteError error={write.error} />
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={write.isPending}>
            {L.close}
          </Button>
          <Button
            onClick={runExport}
            disabled={write.isPending || changed || sections.length === 0}
          >
            {L.downloadSubscriber}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
