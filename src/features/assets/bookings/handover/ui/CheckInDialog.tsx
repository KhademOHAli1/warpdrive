"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { EditorSelect, readQuantity } from "../../../ui/AssetEditorFields";
import type {
  BookingCheckInItem,
  BookingHandoverAccess,
  BookingHandoverAllocation,
  BookingHandoverView,
  BookingKitMember,
} from "../contracts";
import { HandoverDialog, type HandoverDialogState } from "./HandoverDialog";
import { HandoverScanField, type ScanFeedback } from "./HandoverScanField";
import type { HandoverWords } from "./messages";

type Equipment = Extract<BookingCheckInItem, { kind: "equipment" }>;
type MemberDraft = { returned: string; consumed: string };
type RowDraft = {
  quantity: string;
  locationId: string;
  condition: Equipment["condition"];
  members: Record<string, MemberDraft>;
};
type Draft = Record<string, RowDraft>;
type Location = BookingHandoverView["locations"][number];
type Locale = ReturnType<typeof localeTagForFormatting>;
const conditions = ["good", "worn", "damaged", "needs_inspection"] as const;
const blankMember = { returned: "", consumed: "" } satisfies MemberDraft;

function initialRow(row: BookingHandoverAllocation, locations: Location[]): RowDraft {
  return {
    quantity: "",
    locationId: locations.find(({ id }) => id === row.sourceLocationId)?.id ?? "",
    condition: "good",
    members: {},
  };
}

function readAmount(value: string, locale: Locale) {
  return readQuantity(value.trim() || "0", locale);
}

function kitItems(row: BookingHandoverAllocation, values: RowDraft, locale: Locale) {
  const members: Extract<BookingCheckInItem, { kind: "kit" }>["members"] = [];
  for (const member of row.members) {
    const draft = values.members[member.id] ?? blankMember;
    const returned = readAmount(draft.returned, locale);
    const consumed = readAmount(draft.consumed, locale);
    if (returned === null || consumed === null || returned + consumed > member.outstanding)
      return null;
    if (returned + consumed > 0) members.push({ id: member.id, returned, consumed });
  }
  return members;
}

function selectedReturns(rows: BookingHandoverAllocation[], draft: Draft, locale: Locale) {
  const items: BookingCheckInItem[] = [];
  for (const row of rows) {
    const values = draft[row.id];
    if (values === undefined) continue;
    if (row.kind === "kit") {
      const members = kitItems(row, values, locale);
      if (members === null) return null;
      if (members.length > 0) items.push({ kind: "kit", allocationId: row.id, members });
      continue;
    }
    const quantity = readAmount(values.quantity, locale);
    if (quantity === null || quantity > row.outstanding) return null;
    if (quantity > 0) {
      const { locationId, condition } = values;
      items.push({ kind: "equipment", allocationId: row.id, locationId, condition, quantity });
    }
  }
  return items;
}

function allReturns(rows: BookingHandoverAllocation[], locations: Location[]): Draft {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        ...initialRow(row, locations),
        quantity: String(row.outstanding),
        members: Object.fromEntries(
          row.members.map(({ id, outstanding }) => [
            id,
            { returned: String(outstanding), consumed: "" },
          ]),
        ),
      },
    ]),
  );
}

function scanRows(rows: BookingHandoverAllocation[], targetId: string, kind: "asset" | "kit") {
  return rows.flatMap((row) => {
    if (row.targetId === targetId && (row.kind === "kit") === (kind === "kit"))
      return [{ row, member: null as BookingKitMember | null }];
    const members = row.members.filter(
      (member) => kind === "asset" && member.targetId === targetId && member.outstanding > 0,
    );
    return members.map((member) => ({ row, member }));
  });
}

function stageReturnScan(
  row: BookingHandoverAllocation,
  member: BookingKitMember | null,
  values: RowDraft,
): RowDraft | "scanDuplicate" | "scanChoose" {
  if (member !== null) {
    if (member.outstanding !== 1 || member.consumable) return "scanChoose";
    const draft = values.members[member.id];
    if (draft?.returned === "1") return "scanDuplicate";
    return {
      ...values,
      members: { ...values.members, [member.id]: { returned: "1", consumed: "" } },
    };
  }
  if (row.kind !== "asset") return "scanChoose";
  if (values.quantity === "1") return "scanDuplicate";
  return { ...values, quantity: "1" };
}

function MemberFields({
  member,
  draft,
  pending,
  scanned,
  change,
  words: t,
}: {
  member: BookingKitMember;
  draft: MemberDraft;
  pending: boolean;
  scanned: boolean;
  change: (value: MemberDraft) => void;
  words: HandoverWords;
}) {
  return (
    <fieldset
      data-handover-return-member={member.id}
      data-scanned={scanned || undefined}
      className="space-y-2 rounded-md border p-2 data-[scanned=true]:border-primary"
    >
      <legend className="max-w-full px-1 text-sm wrap-anywhere">
        <bdi>{[member.name, member.code, member.serial].filter(Boolean).join(" · ")}</bdi>
      </legend>
      <p className="text-xs text-muted-foreground">
        {t.outstandingQty} <bdi>{member.outstanding}</bdi>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <SalesInput
          label={t.returnAmount}
          inputMode="numeric"
          value={draft.returned}
          placeholder="0"
          disabled={pending}
          onChange={(event) => change({ ...draft, returned: event.currentTarget.value })}
        />
        {member.consumable && (
          <SalesInput
            label={t.useAmount}
            inputMode="numeric"
            value={draft.consumed}
            placeholder="0"
            disabled={pending}
            onChange={(event) => change({ ...draft, consumed: event.currentTarget.value })}
          />
        )}
      </div>
    </fieldset>
  );
}

function EquipmentFields({
  row,
  draft,
  locations,
  pending,
  change,
  words: t,
}: {
  row: BookingHandoverAllocation;
  draft: RowDraft;
  locations: Location[];
  pending: boolean;
  change: (value: RowDraft) => void;
  words: HandoverWords;
}) {
  const id = useId();
  return (
    <>
      {row.kind === "asset" ? (
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={id}
            label={t.returned}
            checked={draft.quantity === "1"}
            disabled={pending}
            onCheckedChange={(checked) => change({ ...draft, quantity: checked ? "1" : "" })}
          />
          {t.returned}
        </label>
      ) : (
        <SalesInput
          label={t.returnAmount}
          inputMode="numeric"
          value={draft.quantity}
          placeholder="0"
          disabled={pending}
          onChange={(event) => change({ ...draft, quantity: event.currentTarget.value })}
        />
      )}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <EditorSelect
          label={t.destination}
          value={draft.locationId}
          disabled={pending}
          options={[
            { value: "", label: t.choose },
            ...locations.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(locationId) => change({ ...draft, locationId })}
        />
        <EditorSelect
          label={t.condition}
          value={draft.condition}
          disabled={pending}
          options={conditions.map((value) => ({ value, label: t[value] }))}
          onChange={(condition) => {
            const match = conditions.find((value) => value === condition);
            if (match !== undefined) change({ ...draft, condition: match });
          }}
        />
      </div>
    </>
  );
}

function ReturnRow({
  row,
  locations,
  draft,
  pending,
  scanned,
  scannedMembers,
  change,
  words: t,
}: {
  row: BookingHandoverAllocation;
  locations: Location[];
  draft: RowDraft;
  pending: boolean;
  scanned: boolean;
  scannedMembers: string[];
  change: (value: RowDraft) => void;
  words: HandoverWords;
}) {
  return (
    <section
      data-handover-return={row.id}
      data-scanned={scanned || undefined}
      className="space-y-2 rounded-md border p-3 data-[scanned=true]:border-primary"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-medium wrap-anywhere">
          <bdi>{[row.name, row.code, row.serial].filter(Boolean).join(" · ")}</bdi>
        </h3>
        <p className="text-sm text-muted-foreground">
          {t.outstandingQty} <bdi>{row.outstanding}</bdi>
        </p>
      </div>
      {row.sourceBin !== null && (
        <p className="text-xs text-muted-foreground">
          {t.source} <bdi>{row.sourceBin}</bdi>
        </p>
      )}
      {row.kind === "kit" ? (
        row.members
          .filter(({ outstanding }) => outstanding > 0)
          .map((member) => (
            <MemberFields
              key={member.id}
              member={member}
              draft={draft.members[member.id] ?? blankMember}
              pending={pending}
              scanned={scannedMembers.includes(member.id)}
              words={t}
              change={(entry) =>
                change({ ...draft, members: { ...draft.members, [member.id]: entry } })
              }
            />
          ))
      ) : (
        <EquipmentFields {...{ row, draft, locations, pending, change }} words={t} />
      )}
    </section>
  );
}

export function CheckInDialog({
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
  const [draft, setDraft] = useState<Draft>({});
  const [note, setNote] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<ReturnType<typeof scanRows>>([]);
  const locale = localeTagForFormatting(useLocalePreferences());
  const rows = view.allocations.filter(({ outstanding }) => outstanding > 0);
  const items = selectedReturns(rows, draft, locale);
  const pending = state.pending || scanning;
  async function scan(code: string): Promise<ScanFeedback> {
    const match = await lookup(view.bookingId, code);
    const matches = match.ok ? scanRows(rows, match.id, match.kind) : [];
    setScanned(matches);
    const [first] = matches;
    if (first === undefined) return "scanReturnIneligible";
    if (matches.length > 1) return "scanChoose";
    const { row, member } = first;
    const values = stageReturnScan(row, member, draft[row.id] ?? initialRow(row, view.locations));
    if (typeof values === "string") return values;
    setDraft((current) => ({ ...current, [row.id]: values }));
    return "scanReturnAdded";
  }
  return (
    <HandoverDialog
      type="checkIn"
      title={t.startCheckIn}
      description={t.checkInIntro}
      confirm={t.confirmCheckIn}
      state={{ ...state, pending }}
      words={t}
      intent={
        items === null
          ? null
          : {
              type: "checkIn",
              bookingId: view.bookingId,
              bookingVersion: view.bookingVersion,
              handoverVersion: view.version,
              items,
              note: note.trim() || null,
            }
      }
    >
      <HandoverScanField
        pending={state.pending}
        onScan={scan}
        onScanning={setScanning}
        unavailable="scanReturnIneligible"
        words={t}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || rows.length === 0}
        onClick={() => setDraft(allReturns(rows, view.locations))}
      >
        {t.returnAll}
      </Button>
      {rows.map((row) => (
        <ReturnRow
          key={row.id}
          row={row}
          locations={view.locations}
          draft={draft[row.id] ?? initialRow(row, view.locations)}
          pending={pending}
          scanned={scanned.some((match) => match.row.id === row.id)}
          scannedMembers={scanned.flatMap(({ member }) => (member === null ? [] : [member.id]))}
          change={(value) => setDraft((current) => ({ ...current, [row.id]: value }))}
          words={t}
        />
      ))}
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
