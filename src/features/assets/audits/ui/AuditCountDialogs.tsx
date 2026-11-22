"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { EditorSelect, readQuantity } from "../../ui/AssetEditorFields";
import type {
  EquipmentAuditDetail,
  EquipmentAuditIntent,
  EquipmentAuditRow,
  EquipmentAuditSite,
} from "../contracts";
import { AuditCommandDialog, type AuditDialogState } from "./AuditDialog";
import { type AuditScan, equipmentLabel, placementLabel } from "./auditView";
import type { AuditWords } from "./messages";

type StateProps = { detail: EquipmentAuditDetail; state: AuditDialogState; words: AuditWords };
type QuantityMode = Extract<EquipmentAuditIntent, { type: "setCount" }>["mode"];

function countInput(
  raw: string,
  row: EquipmentAuditRow,
  locale: ReturnType<typeof localeTagForFormatting>,
) {
  if (raw.trim() === "") return null;
  const number = readQuantity(raw, locale);
  return number !== null && (row.quantityType === "pool" || number <= 1) ? number : null;
}

function firstQuantity(row?: EquipmentAuditRow) {
  return row === undefined ? "" : String(row.counted ?? row.expected ?? 1);
}

export function AuditCountDialog({
  detail,
  rows,
  scan,
  state,
  words: t,
}: StateProps & {
  rows: EquipmentAuditRow[];
  scan?: AuditScan;
}) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const [rowId, choose] = useState(rows.length === 1 ? (rows[0]?.id ?? "") : "");
  const row = rows.find(({ id }) => id === rowId);
  const [raw, setRaw] = useState(() => firstQuantity(row));
  const [mode, setMode] = useState<QuantityMode>("replace");
  const quantity = row === undefined ? null : countInput(raw, row, locale);
  const multipleEquipment = new Set(rows.map((item) => item.target?.id)).size > 1;
  const intent: EquipmentAuditIntent | null =
    row === undefined || quantity === null
      ? null
      : {
          type: "setCount",
          auditId: detail.id,
          version: detail.version,
          rowId: row.id,
          quantity,
          mode,
          proof: scan === undefined ? null : { code: scan.code, expectedTargetId: scan.targetId },
        };

  return (
    <AuditCommandDialog
      type="setCount"
      title={t.setCount}
      description={rows.length > 1 ? t.scanChoose : t.countIntro}
      {...{ intent, state }}
      words={t}
    >
      {rows.length > 1 && (
        <EditorSelect
          label={t.poolChoice}
          value={rowId}
          disabled={state.pending}
          options={[
            { value: "", label: t.choose },
            ...rows.map((item) => ({
              value: item.id,
              label: multipleEquipment
                ? `${equipmentLabel(item, t)} · ${placementLabel(item, t)}`
                : placementLabel(item, t),
            })),
          ]}
          onChange={(id) => {
            choose(id);
            setMode("replace");
            setRaw(firstQuantity(rows.find((item) => item.id === id)));
          }}
        />
      )}
      {row !== undefined && (
        <>
          <div className="space-y-1 rounded-md border p-3 text-sm" data-audit-count-row={row.id}>
            <p className="font-medium wrap-anywhere">
              <bdi>{equipmentLabel(row, t)}</bdi>
            </p>
            <p className="text-muted-foreground">
              <bdi>{placementLabel(row, t)}</bdi>
            </p>
            <p>
              {t.expectedUnits} <bdi>{row.expected ?? "—"}</bdi>
            </p>
          </div>
          {row.quantityType === "pool" && (
            <EditorSelect
              label={t.countMode}
              value={mode}
              disabled={state.pending}
              options={[
                { value: "replace", label: t.replace },
                { value: "add", label: t.add },
              ]}
              onChange={(value) => {
                if (value === "replace" || value === "add") {
                  setMode(value);
                  setRaw(value === "replace" ? firstQuantity(row) : "");
                }
              }}
            />
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <SalesInput
                label={t.countedUnits}
                data-audit-count-input
                inputMode="numeric"
                value={raw}
                required
                disabled={state.pending}
                onChange={(event) => setRaw(event.currentTarget.value)}
              />
            </div>
            {row.expected !== null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={state.pending}
                onClick={() => {
                  setMode("replace");
                  setRaw(String(row.expected));
                }}
              >
                {t.allHere}
              </Button>
            )}
          </div>
        </>
      )}
    </AuditCommandDialog>
  );
}

function selectedCounts(
  detail: EquipmentAuditDetail,
  values: Record<string, string>,
  locale: ReturnType<typeof localeTagForFormatting>,
) {
  const counts: { rowId: string; quantity: number }[] = [];
  for (const row of detail.rows) {
    const raw = values[row.id]?.trim() ?? "";
    if (raw === "") continue;
    const quantity = countInput(raw, row, locale);
    if (quantity === null) return null;
    counts.push({ rowId: row.id, quantity });
  }
  return counts;
}

export function AuditBulkCountDialog({ detail, state, words: t }: StateProps) {
  const preferences = useLocalePreferences();
  const locale = localeTagForFormatting(preferences);
  const [values, setValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase(preferences.locale);
  const counts = selectedCounts(detail, values, locale);
  const rows = detail.rows.filter(
    (row) =>
      row.expected !== null &&
      `${equipmentLabel(row, t)} ${placementLabel(row, t)}`
        .toLocaleLowerCase(preferences.locale)
        .includes(query),
  );
  return (
    <AuditCommandDialog
      type="bulkCount"
      title={t.bulkCount}
      description={t.bulkIntro}
      state={state}
      words={t}
      intent={
        counts === null
          ? null
          : { type: "bulkCount", auditId: detail.id, version: detail.version, counts }
      }
    >
      <SalesInput
        label={t.filterOptions}
        type="search"
        value={search}
        disabled={state.pending}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border p-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{t.noOptions}</p>}
        {rows.map((row) => (
          <div key={row.id} data-audit-bulk-row={row.id}>
            <SalesInput
              label={`${equipmentLabel(row, t)} · ${placementLabel(row, t)}`}
              inputMode="numeric"
              value={values[row.id] ?? ""}
              placeholder={String(row.counted ?? row.expected ?? 0)}
              disabled={state.pending}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setValues((current) => ({ ...current, [row.id]: value }));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t.expectedUnits} <bdi>{row.expected}</bdi>
            </p>
          </div>
        ))}
      </div>
    </AuditCommandDialog>
  );
}

export function AuditUnexpectedDialog({
  detail,
  scan,
  site,
  state,
  words: t,
}: StateProps & {
  scan: AuditScan;
  site: EquipmentAuditSite;
}) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const [raw, setRaw] = useState("1");
  const [locationId, setLocation] = useState("");
  const amount = readQuantity(raw, locale);
  const intent: EquipmentAuditIntent | null =
    amount === null || amount === 0
      ? null
      : {
          type: "unexpected",
          auditId: detail.id,
          version: detail.version,
          code: scan.code,
          expectedTargetId: scan.targetId,
          locationId: locationId === "" ? null : locationId,
          quantity: amount,
        };
  return (
    <AuditCommandDialog
      type="unexpected"
      title={t.unexpected}
      description={t.unexpectedIntro}
      {...{ intent, state }}
      words={t}
    >
      <p className="wrap-anywhere">
        <bdi>{scan.label ?? t.unknown}</bdi>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <EditorSelect
          label={t.actualPlacement}
          value={locationId}
          disabled={state.pending}
          options={[
            { value: "", label: t.unlocated },
            ...site.locations.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={setLocation}
        />
        <SalesInput
          label={t.countedUnits}
          data-audit-count-input
          inputMode="numeric"
          value={raw}
          required
          disabled={state.pending}
          onChange={(event) => setRaw(event.currentTarget.value)}
        />
      </div>
    </AuditCommandDialog>
  );
}
