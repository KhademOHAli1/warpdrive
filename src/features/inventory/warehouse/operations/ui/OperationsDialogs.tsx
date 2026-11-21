"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import {
  CatalogEditorDialog,
  CatalogField as Field,
  CatalogSelect as Select,
} from "../../../catalog/ui/CatalogFields";
import type { WarehouseLocation, WarehousePosition, WarehouseWorkspace } from "../../contracts";
import { locationOptions, warehouseLocationLabel } from "../../ui/warehouseDisplay";
import type { WarehouseOperationsIntent } from "../contracts";
import type { WarehouseMovementRow, WarehouseTransferRow } from "../readContracts";
import { displayStockPosition } from "./display";
import { operationsMessages } from "./operationsMessages";

export type OperationsEditor =
  | { type: "createTransfer" }
  | { type: "correctStock" }
  | { type: "reverseCorrection"; movement: WarehouseMovementRow; position: WarehousePosition }
  | {
      type: "dispatchTransfer" | "receiveTransfer" | "cancelTransfer";
      transfer: WarehouseTransferRow;
    };

export type OperationsDialogProps = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: WarehouseOperationsIntent) => Promise<void>;
};

const maxMovementQuantity = 1_000_000;
const maxReasonLength = 500;
const maxTransferLines = 20;

function useDialogWords() {
  const preferences = useLocalePreferences();
  return {
    t: operationsMessages[preferences.locale],
    numbers: new Intl.NumberFormat(localeTagForFormatting(preferences)),
  };
}

function ReasonField({
  value,
  change,
  pending,
}: {
  value: string;
  change: (value: string) => void;
  pending: boolean;
}) {
  const id = useId();
  const { t } = useDialogWords();
  return (
    <Field id={id} label={t.reason}>
      <Textarea
        id={id}
        value={value}
        maxLength={maxReasonLength}
        onChange={(event) => change(event.target.value)}
        disabled={pending}
        required
      />
    </Field>
  );
}

type DraftLine = { key: number; positionId: string; quantity: string };

export function NewTransferDialog({
  workspace,
  locations,
  ...dialog
}: OperationsDialogProps & { workspace: WarehouseWorkspace; locations: WarehouseLocation[] }) {
  const { t, numbers } = useDialogWords();
  const id = useId();
  const nextKey = useRef(1);
  const firstLine = { key: 0, positionId: "", quantity: "1" };
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<DraftLine[]>([firstLine]);

  const freePositions = workspace.positions.filter(({ onHand, reserved }) => onHand > reserved);
  const choices = freePositions.filter(({ locationId }) => locationId === source);
  const origins = locations.filter(({ id }) =>
    freePositions.some(({ locationId }) => locationId === id),
  );
  const destinations = locations.filter(({ id }) => id !== source);
  const lines = rows.map(({ positionId, quantity }) => ({
    positionId,
    quantity: Number(quantity),
  }));
  const valid = lines.every(({ positionId, quantity }) => {
    const row = choices.find(({ id }) => id === positionId);
    const max = row === undefined ? 0 : Math.min(maxMovementQuantity, row.onHand - row.reserved);
    return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= max;
  });
  const canSubmit =
    source !== "" &&
    destinations.some(({ id }) => id === destination) &&
    reason.trim() !== "" &&
    valid &&
    new Set(lines.map(({ positionId }) => positionId)).size === rows.length;

  function changeLine(key: number, patch: Partial<Omit<DraftLine, "key">>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <CatalogEditorDialog
      {...dialog}
      title={t.newTransfer}
      description={t.transferDescription}
      submitDisabled={!canSubmit}
      submit={() => {
        void dialog.save({
          type: "createTransfer",
          sourceLocationId: source,
          destinationLocationId: destination,
          reason: reason.trim(),
          lines,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.sourceLocation}>
          <Select
            ariaLabel={t.sourceLocation}
            value={source}
            options={locationOptions(origins, workspace)}
            disabled={dialog.pending}
            onChange={(value) => {
              setSource(value);
              if (destination === value) setDestination("");
              setRows([firstLine]);
            }}
          />
        </Field>
        <Field label={t.destinationLocation}>
          <Select
            ariaLabel={t.destinationLocation}
            value={destination}
            options={locationOptions(destinations, workspace)}
            disabled={dialog.pending}
            onChange={setDestination}
          />
        </Field>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => {
          const options = choices.filter(
            ({ id }) => id === row.positionId || !rows.some(({ positionId }) => positionId === id),
          );
          const selected = options.find(({ id }) => id === row.positionId);
          const free = selected === undefined ? 0 : selected.onHand - selected.reserved;
          const label = `${t.stockPosition} ${numbers.format(index + 1)}`;
          const quantityId = `${id}-quantity-${row.key}`;
          return (
            <div key={row.key} className="flex flex-wrap items-end gap-2 rounded-md border p-2.5">
              <div className="min-w-full flex-1 sm:min-w-56">
                <Field label={label}>
                  <Select
                    ariaLabel={label}
                    value={row.positionId}
                    options={options.map((position) => ({
                      value: position.id,
                      label: displayStockPosition(position, workspace, t, numbers),
                    }))}
                    disabled={dialog.pending || source === ""}
                    onChange={(positionId) => changeLine(row.key, { positionId, quantity: "1" })}
                  />
                </Field>
              </div>
              <div className="w-28">
                <Field id={quantityId} label={`${t.quantity} ${numbers.format(index + 1)}`}>
                  <Input
                    id={quantityId}
                    type="number"
                    min={1}
                    max={Math.max(1, Math.min(maxMovementQuantity, free))}
                    step={1}
                    value={row.quantity}
                    required
                    disabled={dialog.pending || row.positionId === ""}
                    onChange={(event) => changeLine(row.key, { quantity: event.target.value })}
                  />
                </Field>
              </div>
              {rows.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  aria-label={`${t.removeLine} ${numbers.format(index + 1)}`}
                  disabled={dialog.pending}
                  onClick={() => setRows((current) => current.filter(({ key }) => key !== row.key))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </div>
          );
        })}
        {rows.length < maxTransferLines && choices.length > rows.length && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={dialog.pending}
            onClick={() => {
              const key = nextKey.current++;
              setRows((current) => [...current, { key, positionId: "", quantity: "1" }]);
            }}
          >
            <Plus aria-hidden="true" />
            {t.addLine}
          </Button>
        )}
      </div>
      <ReasonField value={reason} change={setReason} pending={dialog.pending} />
    </CatalogEditorDialog>
  );
}

export function TransferProgressDialog({
  mode,
  transfer,
  ...dialog
}: OperationsDialogProps & {
  mode: "dispatchTransfer" | "receiveTransfer" | "cancelTransfer";
  transfer: WarehouseTransferRow;
}) {
  const { t, numbers } = useDialogWords();
  const id = useId();
  const [reason, setReason] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      transfer.lines.map((line) => [line.id, String(line.quantity - line.received)]),
    ),
  );
  const labels = {
    dispatchTransfer: { title: t.dispatchTitle, description: t.dispatchDescription },
    receiveTransfer: { title: t.receiveTitle, description: t.receiveDescription },
    cancelTransfer: { title: t.cancelTransfer, description: t.cancelDescription },
  };
  const isReceive = mode === "receiveTransfer";
  const remaining = transfer.lines.filter((line) => line.received < line.quantity);
  const validCounts = remaining.every(({ id, quantity, received }) => {
    const amount = Number(counts[id]);
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= quantity - received;
  });
  const lines = remaining
    .map(({ id }) => ({ lineId: id, quantity: Number(counts[id]) }))
    .filter(({ quantity }) => quantity > 0);
  const canSubmit = reason.trim() !== "" && (!isReceive || (validCounts && lines.length > 0));
  return (
    <CatalogEditorDialog
      {...dialog}
      {...labels[mode]}
      submitDisabled={!canSubmit}
      submit={() => {
        const base = { id: transfer.id, version: transfer.version, reason: reason.trim() };
        void dialog.save(
          isReceive ? { type: "receiveTransfer", ...base, lines } : { type: mode, ...base },
        );
      }}
    >
      <dl className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t.sourceLocation}</dt>
          <dd>
            <bdi>
              {transfer.sourceSiteName} / {transfer.sourceLocationName}
            </bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.destinationLocation}</dt>
          <dd>
            <bdi>
              {transfer.destinationSiteName} / {transfer.destinationLocationName}
            </bdi>
          </dd>
        </div>
      </dl>
      {isReceive && (
        <div className="grid gap-3 sm:grid-cols-2">
          {remaining.map((line, index) => {
            const inputId = `${id}-receive-${line.id}`;
            return (
              <div key={line.id} className="space-y-2 rounded-md border p-2.5">
                <div className="min-w-0 text-sm">
                  <bdi className="font-medium">
                    {line.code} · {line.revision}
                  </bdi>
                  <p className="break-words text-muted-foreground">
                    <bdi>
                      {[line.name, line.lot, line.serial]
                        .filter((value) => value !== null)
                        .join(" · ")}
                    </bdi>
                  </p>
                </div>
                <Field id={inputId} label={`${t.receiveQuantity} ${numbers.format(index + 1)}`}>
                  <Input
                    id={inputId}
                    type="number"
                    min={0}
                    max={line.quantity - line.received}
                    step={1}
                    value={counts[line.id] ?? ""}
                    disabled={dialog.pending}
                    required
                    onChange={(event) =>
                      setCounts((current) => ({ ...current, [line.id]: event.target.value }))
                    }
                  />
                </Field>
              </div>
            );
          })}
        </div>
      )}
      <ReasonField value={reason} change={setReason} pending={dialog.pending} />
    </CatalogEditorDialog>
  );
}

export function StockCorrectionDialog({
  positions,
  workspace,
  reverse,
  ...dialog
}: OperationsDialogProps & {
  positions: WarehousePosition[];
  workspace: WarehouseWorkspace;
  reverse?: { movement: WarehouseMovementRow; position: WarehousePosition };
}) {
  const { t, numbers } = useDialogWords();
  const id = useId();
  const [positionId, setPositionId] = useState("");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const position = reverse?.position ?? positions.find(({ id }) => id === positionId);
  const location = workspace.locations.find(({ id }) => id === position?.locationId);
  const amount = Number(count);
  const max = position?.serial == null ? 1_000_000_000 : 1;
  const validCount =
    position !== undefined &&
    count.trim() !== "" &&
    Number.isSafeInteger(amount) &&
    amount >= position.reserved &&
    amount <= max &&
    amount !== position.onHand;
  const canSubmit =
    position !== undefined && reason.trim() !== "" && (reverse !== undefined || validCount);

  function save() {
    if (position === undefined) return;
    const base = { expectedOnHand: position.onHand, reason: reason.trim() };
    void dialog.save(
      reverse === undefined
        ? {
            type: "correctStock",
            ...base,
            positionId: position.id,
            locationId: position.locationId,
            countedQuantity: amount,
          }
        : { type: "reverseCorrection", ...base, eventId: reverse.movement.id },
    );
  }

  return (
    <CatalogEditorDialog
      {...dialog}
      title={reverse === undefined ? t.correctStock : t.reverseCorrection}
      description={reverse === undefined ? t.correctDescription : t.reverseDescription}
      submitDisabled={!canSubmit}
      submit={save}
    >
      {reverse === undefined && (
        <Field label={t.stockPosition}>
          <Select
            ariaLabel={t.stockPosition}
            value={positionId}
            options={positions.map((row) => ({
              value: row.id,
              label: displayStockPosition(row, workspace, t, numbers),
            }))}
            disabled={dialog.pending}
            onChange={(value) => {
              setPositionId(value);
              setCount(String(positions.find(({ id }) => id === value)?.onHand ?? ""));
            }}
          />
        </Field>
      )}
      {position !== undefined && (
        <div className="space-y-1 rounded-md border bg-muted/20 p-3 text-sm">
          {location !== undefined && (
            <p>
              <bdi>{warehouseLocationLabel(location, workspace)}</bdi>
            </p>
          )}
          <p>
            {t.onHand} <bdi>{numbers.format(position.onHand)}</bdi> · {t.reserved}{" "}
            <bdi>{numbers.format(position.reserved)}</bdi>
          </p>
        </div>
      )}
      {reverse === undefined && (
        <Field id={id} label={t.countedQuantity}>
          <Input
            id={id}
            type="number"
            min={position?.reserved ?? 0}
            max={max}
            step={1}
            value={count}
            disabled={dialog.pending || position === undefined}
            required
            onChange={(event) => setCount(event.target.value)}
          />
        </Field>
      )}
      <ReasonField value={reason} change={setReason} pending={dialog.pending} />
    </CatalogEditorDialog>
  );
}
