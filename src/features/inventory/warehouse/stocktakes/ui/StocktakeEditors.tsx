"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import { useFormatters } from "@/lib/useFormatters";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import {
  CatalogEditorDialog,
  CatalogField,
  CatalogSelect,
} from "../../../catalog/ui/CatalogFields";
import type { StocktakeDetail, StocktakeLine, StocktakeWorkspace } from "../contracts";
import type { StocktakeMessages } from "./messages";
import { type StocktakeDialogProps, type StocktakeEditor, stocktakeLineLabel } from "./types";

function validText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/\p{Cc}/u.test(trimmed);
}

function startLocationOption(location: StocktakeWorkspace["locations"][number]) {
  return { value: location.id, label: `${location.name} · ${location.code}` };
}

function HeaderEditor({
  type,
  workspace,
  siteId,
  dialog,
  t,
}: {
  type: "startCount" | "captureValuation";
  workspace: StocktakeWorkspace;
  siteId: string;
  dialog: StocktakeDialogProps;
  t: StocktakeMessages;
}) {
  const fieldId = useId();
  const [locationId, setLocationId] = useState(workspace.locations[0]?.id ?? "");
  const [text, setText] = useState("");
  const starting = type === "startCount";
  const submitDisabled = !validText(text) || (starting && locationId === "");
  return (
    <CatalogEditorDialog
      {...dialog}
      title={starting ? t.start : t.capture}
      description={starting ? t.startDescription : t.captureDescription}
      submitDisabled={submitDisabled}
      submit={() =>
        dialog.save(
          starting ? { type, locationId, note: text.trim() } : { type, siteId, label: text.trim() },
        )
      }
    >
      {starting && (
        <CatalogField label={t.bin}>
          <CatalogSelect
            ariaLabel={t.bin}
            value={locationId}
            options={workspace.locations.map(startLocationOption)}
            onChange={setLocationId}
            disabled={dialog.pending}
          />
        </CatalogField>
      )}
      <CatalogField id={fieldId} label={starting ? t.note : t.label}>
        <Input
          id={fieldId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={dialog.pending}
          maxLength={200}
          required
        />
      </CatalogField>
    </CatalogEditorDialog>
  );
}

type CountEntry = { quantity: string; reason: string };

function parsedCount(value: string) {
  const digits = normalizeDigits(value.trim());
  return /^\d{1,10}$/.test(digits) ? Number(digits) : null;
}

function recordedEntry(line: StocktakeLine): CountEntry {
  return { quantity: line.countedQuantity?.toString() ?? "", reason: line.reason ?? "" };
}

function validateCount(line: StocktakeLine, entry: CountEntry) {
  const countedQuantity = parsedCount(entry.quantity);
  const reason = entry.reason.trim() || null;
  if (
    countedQuantity === null ||
    countedQuantity > (line.serial === null ? 1_000_000_000 : 1) ||
    (reason !== null && !validText(reason)) ||
    (countedQuantity !== line.expectedOnHand && reason === null)
  ) {
    return null;
  }
  return { lineId: line.id, countedQuantity, reason };
}

function CountRow({
  line,
  entry,
  pending,
  onChange,
  t,
}: {
  line: StocktakeLine;
  entry: CountEntry;
  pending: boolean;
  onChange: (entry: CountEntry) => void;
  t: StocktakeMessages;
}) {
  const id = useId();
  const { number } = useFormatters();
  const identity = stocktakeLineLabel(line);
  const countedQuantity = parsedCount(entry.quantity);
  const showReason =
    entry.reason !== "" || (countedQuantity !== null && countedQuantity !== line.expectedOnHand);
  return (
    <li
      className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_7rem]"
      data-stocktake-position-id={line.positionId}
      data-stocktake-line-id={line.id}
    >
      <div className="min-w-0 text-sm">
        <p className="break-words font-medium">
          <bdi>{identity}</bdi>
        </p>
        <p className="break-words text-muted-foreground">
          <bdi>{line.name}</bdi>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.expected} <bdi>{number(line.expectedOnHand)}</bdi> · {t.reserved}{" "}
          <bdi>{number(line.reserved)}</bdi>
        </p>
      </div>
      <CatalogField id={`${id}-count`} label={t.counted}>
        <Input
          id={`${id}-count`}
          aria-label={`${t.countFor} ${identity}`}
          inputMode="numeric"
          maxLength={10}
          value={entry.quantity}
          onChange={(event) =>
            onChange({ ...entry, quantity: normalizeDigits(event.target.value) })
          }
          disabled={pending}
        />
      </CatalogField>
      {showReason && (
        <div className="sm:col-span-2">
          <CatalogField id={`${id}-reason`} label={t.reason}>
            <Input
              id={`${id}-reason`}
              aria-label={`${t.reasonFor} ${identity}`}
              maxLength={500}
              value={entry.reason}
              onChange={(event) => onChange({ ...entry, reason: event.target.value })}
              disabled={pending}
            />
          </CatalogField>
        </div>
      )}
    </li>
  );
}

function CountEditor({
  stocktake,
  dialog,
  t,
}: {
  stocktake: StocktakeDetail;
  dialog: StocktakeDialogProps;
  t: StocktakeMessages;
}) {
  const [entries, setEntries] = useState<Record<string, CountEntry>>({});
  const changedLines = stocktake.lines.filter((line) => {
    const entry = entries[line.id];
    return (
      entry !== undefined &&
      (entry.quantity.trim() !== (line.countedQuantity?.toString() ?? "") ||
        entry.reason.trim() !== (line.reason ?? ""))
    );
  });
  const counts = changedLines.map((line) =>
    validateCount(line, entries[line.id] ?? recordedEntry(line)),
  );
  return (
    <CatalogEditorDialog
      {...dialog}
      title={t.record}
      description={t.recordDescription}
      submitDisabled={counts.length === 0 || counts.some((count) => count === null)}
      submit={() =>
        dialog.save({
          type: "recordCounts",
          stocktakeId: stocktake.id,
          expectedVersion: stocktake.version,
          counts: counts.filter((count) => count !== null),
        })
      }
    >
      <ul className="space-y-3">
        {stocktake.lines.map((line) => (
          <CountRow
            key={line.id}
            line={line}
            entry={entries[line.id] ?? recordedEntry(line)}
            pending={dialog.pending}
            onChange={(entry) => setEntries((current) => ({ ...current, [line.id]: entry }))}
            t={t}
          />
        ))}
      </ul>
    </CatalogEditorDialog>
  );
}

function CloseEditor({
  type,
  stocktake,
  dialog,
  t,
}: {
  type: "reconcileCount" | "cancelCount";
  stocktake: StocktakeDetail;
  dialog: StocktakeDialogProps;
  t: StocktakeMessages;
}) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const cancelling = type === "cancelCount";
  const header = { stocktakeId: stocktake.id, expectedVersion: stocktake.version };
  return (
    <CatalogEditorDialog
      {...dialog}
      title={cancelling ? t.cancel : t.reconcile}
      description={cancelling ? t.cancelDescription : t.reconcileDescription}
      submitDisabled={cancelling && !validText(reason)}
      submit={() =>
        dialog.save(cancelling ? { type, ...header, reason: reason.trim() } : { type, ...header })
      }
    >
      {cancelling && (
        <CatalogField id={fieldId} label={t.reason}>
          <Input
            id={fieldId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={dialog.pending}
            maxLength={500}
            required
          />
        </CatalogField>
      )}
    </CatalogEditorDialog>
  );
}

export function StocktakeEditors({
  editor,
  workspace,
  siteId,
  dialog,
  t,
}: {
  editor: StocktakeEditor;
  workspace: StocktakeWorkspace;
  siteId: string;
  dialog: StocktakeDialogProps;
  t: StocktakeMessages;
}) {
  switch (editor.type) {
    case "startCount":
    case "captureValuation":
      return <HeaderEditor type={editor.type} {...{ workspace, siteId, dialog, t }} />;
    case "recordCounts":
      return <CountEditor stocktake={editor.stocktake} {...{ dialog, t }} />;
    case "reconcileCount":
    case "cancelCount":
      return <CloseEditor type={editor.type} stocktake={editor.stocktake} {...{ dialog, t }} />;
  }
}
