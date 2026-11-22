"use client";

import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { EditorSelect, readQuantity } from "../../../ui/AssetEditorFields";
import type {
  BookingHandoverAccess,
  BookingHandoverLookup,
  BookingHandoverView,
  BookingPickupItem,
  BookingPickupLine,
} from "../contracts";
import { HandoverDialog, type HandoverDialogState } from "./HandoverDialog";
import { HandoverScanField, type ScanFeedback } from "./HandoverScanField";
import type { HandoverWords } from "./messages";

type Draft = Record<string, Record<string, string>>;

function displayEquipment(option: { name: string; code: string; serial: string | null }) {
  return [option.name, option.code, option.serial].filter(Boolean).join(" · ");
}

function setSelected(draft: Draft, key: string, targetId: string, value: string): Draft {
  return { ...draft, [key]: { ...draft[key], [targetId]: value } };
}

function lineQuantity(line: BookingPickupLine, items: BookingPickupItem[]) {
  return items
    .filter(({ lineKey }) => lineKey === line.key)
    .reduce((sum, row) => sum + row.quantity, 0);
}

function isPool(line: BookingPickupLine) {
  return line.kind === "returnable_pool" || line.kind === "consumable_pool";
}

function selectedLineItems(
  line: BookingPickupLine,
  draft: Draft[string] | undefined,
  locale: ReturnType<typeof localeTagForFormatting>,
) {
  const items: BookingPickupItem[] = [];
  for (const option of line.options) {
    const value = draft?.[option.targetId]?.trim() ?? "";
    const quantity = readQuantity(value === "" ? "0" : value, locale);
    if (quantity === null || quantity > option.available) return null;
    if (quantity > 0) items.push({ lineKey: line.key, targetId: option.targetId, quantity });
  }
  return lineQuantity(line, items) > line.quantity - line.picked ? null : items;
}

function selectedItems(
  lines: BookingPickupLine[],
  draft: Draft,
  locale: ReturnType<typeof localeTagForFormatting>,
) {
  const items: BookingPickupItem[] = [];
  const exact: string[] = [];
  for (const line of lines) {
    const selected = selectedLineItems(line, draft[line.key], locale);
    if (selected === null) return null;
    if (!isPool(line)) exact.push(...selected.map(({ targetId }) => targetId));
    items.push(...selected);
  }
  return exact.length === new Set(exact).size ? items : null;
}

function stageScan(
  result: BookingHandoverLookup,
  lines: BookingPickupLine[],
  items: BookingPickupItem[],
): { key: string; id: string } | ScanFeedback {
  if (!result.ok) return "scanIneligible";
  if (items.some(({ targetId }) => targetId === result.id)) return "scanDuplicate";
  const candidates = lines.filter(
    (line) =>
      (line.kind === "kit") === (result.kind === "kit") &&
      line.picked + lineQuantity(line, items) < line.quantity &&
      line.options.some(({ targetId, available }) => targetId === result.id && available > 0),
  );
  const [candidate] = candidates;
  if (candidate === undefined || candidates.length !== 1) return "scanIneligible";
  return { key: candidate.key, id: result.id };
}

function PickupLine({
  line,
  selected,
  pending,
  change,
  words: t,
}: {
  line: BookingPickupLine;
  selected: Draft[string] | undefined;
  pending: boolean;
  change: (targetId: string, value: string) => void;
  words: HandoverWords;
}) {
  const id = useId();
  const available = line.options.filter((option) => option.available > 0);
  return (
    <section data-handover-pick-line={line.key} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="min-w-0 font-medium wrap-anywhere">
          <bdi>
            {line.name} · {line.code}
          </bdi>
        </h3>
        <p className="text-sm text-muted-foreground">
          {t.pickupProgress}{" "}
          <bdi>
            {line.picked} / {line.quantity}
          </bdi>
        </p>
      </div>
      {line.bin !== null && (
        <p className="text-xs text-muted-foreground">
          <bdi>{line.bin}</bdi>
        </p>
      )}
      {available.length === 0 && line.picked < line.quantity && (
        <p className="text-sm text-muted-foreground">{t.noAvailable}</p>
      )}
      {available.map((option) => (
        <div key={option.targetId} data-handover-pick-option={option.targetId}>
          {isPool(line) ? (
            <SalesInput
              label={t.issueAmount}
              inputMode="numeric"
              value={selected?.[option.targetId] ?? ""}
              placeholder="0"
              disabled={pending}
              onChange={(event) => change(option.targetId, event.currentTarget.value)}
            />
          ) : (
            <label htmlFor={`${id}-${option.targetId}`} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`${id}-${option.targetId}`}
                label={displayEquipment(option)}
                checked={selected?.[option.targetId] === "1"}
                disabled={pending}
                onCheckedChange={(checked) => change(option.targetId, checked ? "1" : "0")}
                className="mt-0.5"
              />
              <bdi className="wrap-anywhere">{displayEquipment(option)}</bdi>
            </label>
          )}
        </div>
      ))}
    </section>
  );
}

export function PickupDialog({
  view,
  lookup,
  state,
  words: t,
}: {
  view: BookingHandoverView;
  lookup: BookingHandoverAccess["lookup"];
  state: HandoverDialogState;
  words: HandoverWords;
}) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const keepId = useId();
  const [draft, change] = useState<Draft>({});
  const [scanning, setScanning] = useState(false);
  const [custodian, setCustodian] = useState(
    view.custodian?.id ?? (view.custodians.length === 1 ? (view.custodians[0]?.id ?? "") : ""),
  );
  const [keep, setKeep] = useState(true);
  const [note, setNote] = useState("");
  const items = selectedItems(view.lines, draft, locale);
  const complete =
    items !== null &&
    view.lines.every((line) => line.picked + lineQuantity(line, items) === line.quantity);
  const pending = state.pending || scanning;

  async function scan(code: string): Promise<ScanFeedback> {
    if (items === null) return "scanIneligible";
    const match = stageScan(await lookup(view.bookingId, code), view.lines, items);
    if (typeof match === "string") return match;
    change((current) => setSelected(current, match.key, match.id, "1"));
    return "scanAdded";
  }

  return (
    <HandoverDialog
      type="pickup"
      title={t.startPickup}
      description={t.pickupIntro}
      confirm={t.confirmPickup}
      state={{ ...state, pending }}
      intent={
        items === null
          ? null
          : {
              type: "pickup",
              bookingId: view.bookingId,
              bookingVersion: view.bookingVersion,
              handoverVersion: view.version,
              custodianId: custodian,
              items,
              keepPickupOpen: !complete && keep,
              note: note.trim() || null,
            }
      }
      words={t}
    >
      {view.custodians.length === 0 && view.custodian === null ? (
        <p className="text-sm text-muted-foreground">{t.noCustodians}</p>
      ) : (
        <EditorSelect
          label={t.custodian}
          value={custodian}
          disabled={pending || view.custodian !== null}
          options={[
            { value: "", label: t.choose },
            ...(view.custodian === null ? view.custodians : [view.custodian]).map(
              ({ id, name }) => ({
                value: id,
                label: name,
              }),
            ),
          ]}
          onChange={setCustodian}
        />
      )}
      <HandoverScanField
        pending={state.pending}
        onScan={scan}
        onScanning={setScanning}
        unavailable="scanIneligible"
        words={t}
      />
      <div className="space-y-2">
        {view.lines.map((line) => (
          <PickupLine
            key={line.key}
            line={line}
            selected={draft[line.key]}
            pending={pending}
            change={(targetId, value) =>
              change((current) => setSelected(current, line.key, targetId, value))
            }
            words={t}
          />
        ))}
      </div>
      {complete ? (
        <p className="text-sm text-muted-foreground">{t.fullSelection}</p>
      ) : (
        <label htmlFor={keepId} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={keepId}
            label={t.keepOpen}
            checked={keep}
            onCheckedChange={setKeep}
            disabled={pending}
          />
          {t.keepOpen}
        </label>
      )}
      <SalesTextarea
        label={t.note}
        value={note}
        maxLength={500}
        rows={2}
        disabled={pending}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </HandoverDialog>
  );
}
