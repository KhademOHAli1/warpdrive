"use client";

import { Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useFormatters } from "@/lib/useFormatters";
import { CatalogEditorDialog, CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import { calculateStockUnits } from "../../sourcing/contracts";
import {
  type PurchaseOffer,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseReceiptDisposition,
  type PurchasingIntent,
  type PurchasingWorkspace,
  purchaseReceiptDispositions,
  purchasingCommand,
} from "../contracts";
import type { PurchaseMessages } from "./messages";
import type { PurchaseDialogProps, PurchaseEditor } from "./types";

const validationId = "00000000-0000-4000-8000-000000000000";
const maxQuantity = 1_000_000;
const maxDraftLines = 20;
const maxReceiptEntries = 30;

function valid(intent: PurchasingIntent) {
  return purchasingCommand.safeParse({ ...intent, requestId: validationId }).success;
}

type DraftLineInput = { key: string; offerId: string; packs: string };

function DraftLine({
  line,
  index,
  offers,
  blockedOffers,
  disabled,
  update,
  remove,
  t,
}: {
  line: DraftLineInput;
  index: number;
  offers: PurchaseOffer[];
  blockedOffers: ReadonlySet<string>;
  disabled: boolean;
  update: (patch: Partial<Omit<DraftLineInput, "key">>) => void;
  remove?: () => void;
  t: PurchaseMessages;
}) {
  const packsId = useId();
  const { number } = useFormatters();
  const options = offers
    .filter(({ id }) => id === line.offerId || !blockedOffers.has(id))
    .map((offer) => ({
      value: offer.id,
      label: `${offer.partCode} · ${offer.revision} — ${offer.partName} · ${offer.partNumber}`,
    }));
  const offer = offers.find(({ id }) => id === line.offerId);
  const units =
    offer === undefined ? null : calculateStockUnits(Number(line.packs), offer.packQuantity);

  return (
    <div className="grid items-start gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_auto]">
      <CatalogField label={t.offerForLine(index)}>
        <CatalogSelect
          ariaLabel={t.offerForLine(index)}
          value={line.offerId}
          options={options}
          onChange={(offerId) => update({ offerId })}
          disabled={disabled || options.length === 0}
        />
      </CatalogField>
      <CatalogField label={t.packsForLine(index)} id={packsId}>
        <Input
          id={packsId}
          type="number"
          min={1}
          max={maxQuantity}
          step={1}
          required
          value={line.packs}
          disabled={disabled}
          onChange={(event) => update({ packs: event.target.value })}
        />
        {offer !== undefined && units !== null && (
          <span className="text-xs text-muted-foreground" data-purchasing-order-units={units}>
            <bdi>
              {number(units)} {offer.stockUnit}
            </bdi>
          </span>
        )}
      </CatalogField>
      {remove !== undefined && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t.removeOrderLine}
          disabled={disabled}
          onClick={remove}
          className="w-fit sm:mt-6"
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function draftRows(order: PurchaseOrder | null): DraftLineInput[] {
  return order === null
    ? [{ key: "0", offerId: "", packs: "1" }]
    : order.lines.map((line) => ({
        key: line.id,
        offerId: line.offerId,
        packs: String(line.packs),
      }));
}

function DraftDialog({
  order,
  workspace,
  siteId,
  dialog,
  t,
}: {
  order: PurchaseOrder | null;
  workspace: PurchasingWorkspace;
  siteId: string;
  dialog: PurchaseDialogProps;
  t: PurchaseMessages;
}) {
  const referenceId = useId();
  const dateId = useId();
  const nextKey = useRef(1);
  const [supplierOrganizationId, setSupplier] = useState(order?.supplierOrganizationId ?? "");
  const [locationId, setLocation] = useState(order?.locationId ?? "");
  const [reference, setReference] = useState(order?.reference ?? "");
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? "");
  const [lines, setLines] = useState(() => draftRows(order));

  const supplierIds = new Set(
    workspace.offers.map(({ supplierOrganizationId }) => supplierOrganizationId),
  );
  const suppliers = workspace.organizations.filter(
    ({ id }) => supplierIds.has(id) || id === order?.supplierOrganizationId,
  );
  const offers = workspace.offers.filter(
    (offer) => offer.supplierOrganizationId === supplierOrganizationId,
  );
  const selectedOffers = new Set(lines.map(({ offerId }) => offerId).filter(Boolean));
  const validPacks = lines.every(({ offerId, packs }) => {
    const offer = offers.find(({ id }) => id === offerId);
    return offer !== undefined && calculateStockUnits(Number(packs), offer.packQuantity) !== null;
  });
  const intent: PurchasingIntent = {
    type: "saveDraft",
    id: order?.id ?? null,
    expectedVersion: order?.version ?? null,
    siteId,
    locationId,
    supplierOrganizationId,
    reference: reference.trim(),
    expectedDate: expectedDate || null,
    lines: lines.map(({ offerId, packs }) => ({ offerId, packs: Number(packs) })),
  };

  return (
    <CatalogEditorDialog
      {...dialog}
      title={order === null ? t.newOrder : t.editOrder}
      description={t.draftDescription}
      submitDisabled={
        !validPacks ||
        selectedOffers.size !== lines.length ||
        !workspace.locations.some(({ id }) => id === locationId) ||
        !valid(intent)
      }
      submit={() => dialog.save(intent)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField label={t.supplier}>
          <CatalogSelect
            ariaLabel={t.supplier}
            value={supplierOrganizationId}
            options={suppliers.map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(next) => {
              setSupplier(next);
              setLines([{ key: String(nextKey.current++), offerId: "", packs: "1" }]);
            }}
            disabled={dialog.pending || suppliers.length === 0}
          />
        </CatalogField>
        <CatalogField label={t.receivingBin}>
          <CatalogSelect
            ariaLabel={t.receivingBin}
            value={locationId}
            options={workspace.locations.map(({ id, code, name }) => ({
              value: id,
              label: `${name} · ${code}`,
            }))}
            onChange={setLocation}
            disabled={dialog.pending || workspace.locations.length === 0}
          />
        </CatalogField>
        <CatalogField label={t.reference} id={referenceId}>
          <Input
            id={referenceId}
            required
            maxLength={120}
            value={reference}
            disabled={dialog.pending}
            onChange={(event) => setReference(event.target.value)}
          />
        </CatalogField>
        <CatalogField label={t.expectedDate} id={dateId}>
          <Input
            id={dateId}
            type="date"
            value={expectedDate}
            disabled={dialog.pending}
            onChange={(event) => setExpectedDate(event.target.value)}
          />
        </CatalogField>
      </div>
      {workspace.locations.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.noBins}</p>
      )}
      {(suppliers.length === 0 || (supplierOrganizationId !== "" && offers.length === 0)) && (
        <p className="text-sm text-muted-foreground">{t.noOffers}</p>
      )}
      <div className="space-y-2">
        {lines.map((line, index) => (
          <DraftLine
            key={line.key}
            line={line}
            index={index + 1}
            offers={offers}
            blockedOffers={selectedOffers}
            disabled={dialog.pending}
            update={(patch) =>
              setLines((current) =>
                current.map((row) => (row.key === line.key ? { ...row, ...patch } : row)),
              )
            }
            remove={
              lines.length > 1
                ? () => setLines((current) => current.filter(({ key }) => key !== line.key))
                : undefined
            }
            t={t}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            dialog.pending || lines.length >= maxDraftLines || lines.length >= offers.length
          }
          onClick={() => {
            const next = { key: String(nextKey.current++), offerId: "", packs: "1" };
            setLines((current) => [...current, next]);
          }}
        >
          <Plus aria-hidden="true" />
          {t.addOrderLine}
        </Button>
      </div>
    </CatalogEditorDialog>
  );
}

type ReceiptInput = {
  key: number;
  lineId: string;
  quantity: string;
  lot: string;
  serial: string;
  expiryDate: string;
  disposition: PurchaseReceiptDisposition;
  reason: string;
};

function receiptDraft(key: number, lineId: string): ReceiptInput {
  return {
    key,
    lineId,
    quantity: "1",
    lot: "",
    serial: "",
    expiryDate: "",
    disposition: "accepted",
    reason: "",
  };
}

function ReceiptEntry({
  row,
  index,
  lines,
  disabled,
  update,
  remove,
  t,
}: {
  row: ReceiptInput;
  index: number;
  lines: PurchaseOrderLine[];
  disabled: boolean;
  update: (patch: Partial<Omit<ReceiptInput, "key">>) => void;
  remove?: () => void;
  t: PurchaseMessages;
}) {
  const id = useId();
  const format = useFormatters();
  const line = lines.find(({ id }) => id === row.lineId);
  const serialRequired = row.disposition === "accepted" && line?.trackable === true;
  const lotRequired = row.disposition === "accepted" && line?.subcontracted === true;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {t.receiptEntry} {format.number(index)}
      </legend>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <CatalogField label={t.orderLineForEntry(index)}>
          <CatalogSelect
            ariaLabel={t.orderLineForEntry(index)}
            value={row.lineId}
            options={lines.map((item) => ({
              value: item.id,
              label: `${item.partCode} · ${item.revision} — ${item.partName} · ${item.partNumber}`,
            }))}
            disabled={disabled}
            onChange={(lineId) => update({ lineId })}
          />
        </CatalogField>
        <CatalogField label={t.quantityForEntry(index)} id={`${id}-quantity`}>
          <Input
            id={`${id}-quantity`}
            type="number"
            min={1}
            max={serialRequired || row.serial.trim() !== "" ? 1 : maxQuantity}
            step={1}
            required
            value={row.quantity}
            disabled={disabled}
            onChange={(event) => update({ quantity: event.target.value })}
          />
          {line !== undefined && (
            <span className="text-xs text-muted-foreground">
              {t.remaining}{" "}
              <bdi>
                {format.number(line.orderedUnits - line.receivedUnits)} {line.stockUnit}
              </bdi>
            </span>
          )}
        </CatalogField>
        <CatalogField label={t.lotForEntry(index)} id={`${id}-lot`}>
          <Input
            id={`${id}-lot`}
            value={row.lot}
            required={lotRequired}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => update({ lot: event.target.value })}
          />
        </CatalogField>
        <CatalogField label={t.serialForEntry(index)} id={`${id}-serial`}>
          <Input
            id={`${id}-serial`}
            value={row.serial}
            required={serialRequired}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => update({ serial: event.target.value })}
          />
        </CatalogField>
        <CatalogField label={t.expiryForEntry(index)} id={`${id}-expiry`}>
          <Input
            id={`${id}-expiry`}
            type="date"
            value={row.expiryDate}
            disabled={disabled}
            onChange={(event) => update({ expiryDate: event.target.value })}
          />
        </CatalogField>
        <CatalogField label={t.dispositionForEntry(index)}>
          <CatalogSelect
            ariaLabel={t.dispositionForEntry(index)}
            value={row.disposition}
            options={purchaseReceiptDispositions.map((value) => ({ value, label: t[value] }))}
            disabled={disabled}
            onChange={(value) => {
              if (value === "accepted" || value === "rejected") update({ disposition: value });
            }}
          />
        </CatalogField>
      </div>
      {row.disposition === "rejected" && (
        <CatalogField label={t.reasonForEntry(index)} id={`${id}-reason`}>
          <Input
            id={`${id}-reason`}
            required
            maxLength={500}
            value={row.reason}
            disabled={disabled}
            onChange={(event) => update({ reason: event.target.value })}
          />
        </CatalogField>
      )}
      {remove !== undefined && (
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={remove}>
          <X aria-hidden="true" />
          {t.removeReceiptEntry}
        </Button>
      )}
    </fieldset>
  );
}

type AcceptedReceiptInput = Extract<PurchasingIntent, { type: "receive" }>["lines"][number];

function validAcceptedIdentity(line: PurchaseOrderLine, entry: AcceptedReceiptInput) {
  if (line.subcontracted === true && entry.lot === null) return false;
  return entry.serial === null ? !line.trackable : entry.quantity === 1;
}

function receiptIsWithinOrder(
  lines: readonly PurchaseOrderLine[],
  input: Extract<PurchasingIntent, { type: "receive" }>["lines"],
) {
  const accepted = new Map<string, number>();
  const orderLines = new Map(lines.map((line) => [line.id, line]));
  for (const entry of input) {
    const line = orderLines.get(entry.lineId);
    if (line === undefined) return false;
    if (entry.disposition === "rejected" && entry.reason === null) return false;
    if (entry.disposition === "rejected") continue;
    if (!validAcceptedIdentity(line, entry)) return false;
    const next = (accepted.get(line.id) ?? 0) + entry.quantity;
    if (next > line.orderedUnits - line.receivedUnits) return false;
    accepted.set(line.id, next);
  }
  return true;
}

function ReceiptDialog({
  order,
  dialog,
  t,
}: {
  order: PurchaseOrder;
  dialog: PurchaseDialogProps;
  t: PurchaseMessages;
}) {
  const slipId = useId();
  const nextKey = useRef(1);
  const availableLines = order.lines.filter(
    ({ orderedUnits, receivedUnits }) => receivedUnits < orderedUnits,
  );
  const firstLineId = availableLines[0]?.id ?? "";
  const [supplierSlip, setSlip] = useState("");
  const [rows, setRows] = useState(() => [receiptDraft(0, firstLineId)]);
  const intent: PurchasingIntent = {
    type: "receive",
    id: order.id,
    expectedVersion: order.version,
    supplierSlip: supplierSlip.trim(),
    lines: rows.map((row) => ({
      lineId: row.lineId,
      quantity: Number(row.quantity),
      lot: row.lot.trim() || null,
      serial: row.serial.trim() || null,
      expiryDate: row.expiryDate || null,
      disposition: row.disposition,
      reason: row.disposition === "rejected" ? row.reason.trim() || null : null,
    })),
  };
  return (
    <CatalogEditorDialog
      {...dialog}
      title={t.receive}
      description={t.receiptDescription}
      submitDisabled={!valid(intent) || !receiptIsWithinOrder(availableLines, intent.lines)}
      submit={() => dialog.save(intent)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField label={t.packingSlip} id={slipId}>
          <Input
            id={slipId}
            required
            maxLength={120}
            value={supplierSlip}
            disabled={dialog.pending}
            onChange={(event) => setSlip(event.target.value)}
          />
        </CatalogField>
        <CatalogField label={t.receivingBin}>
          <bdi className="py-2 text-sm">{order.locationName}</bdi>
        </CatalogField>
      </div>
      {availableLines.some(({ subcontracted }) => subcontracted === true) && (
        <p className="text-sm text-muted-foreground">{t.subcontractReceiptHold}</p>
      )}
      <div className="space-y-3">
        {rows.map((row, index) => (
          <ReceiptEntry
            key={row.key}
            row={row}
            index={index + 1}
            lines={availableLines}
            disabled={dialog.pending}
            update={(patch) =>
              setRows((current) =>
                current.map((entry) => (entry.key === row.key ? { ...entry, ...patch } : entry)),
              )
            }
            remove={
              rows.length > 1
                ? () => setRows((current) => current.filter(({ key }) => key !== row.key))
                : undefined
            }
            t={t}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={dialog.pending || rows.length >= maxReceiptEntries || firstLineId === ""}
          onClick={() => {
            const next = receiptDraft(nextKey.current++, firstLineId);
            setRows((current) => [...current, next]);
          }}
        >
          <Plus aria-hidden="true" />
          {t.addReceiptEntry}
        </Button>
      </div>
    </CatalogEditorDialog>
  );
}

function TransitionDialog({
  change,
  order,
  dialog,
  t,
}: {
  change: "issue" | "cancel";
  order: PurchaseOrder;
  dialog: PurchaseDialogProps;
  t: PurchaseMessages;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const header = { id: order.id, expectedVersion: order.version };
  const intent: PurchasingIntent =
    change === "issue"
      ? { ...header, type: "issue" }
      : { ...header, type: "cancel", reason: reason.trim() };
  return (
    <CatalogEditorDialog
      {...dialog}
      title={change === "issue" ? t.issue : t.cancelOrder}
      description={change === "issue" ? t.issueDescription : t.cancelDescription}
      submitDisabled={!valid(intent)}
      submit={() => dialog.save(intent)}
    >
      <bdi className="text-sm font-medium">{order.reference}</bdi>
      {change === "cancel" && (
        <CatalogField label={t.cancellationReason} id={reasonId}>
          <Input
            id={reasonId}
            required
            maxLength={500}
            value={reason}
            disabled={dialog.pending}
            onChange={(event) => setReason(event.target.value)}
          />
        </CatalogField>
      )}
    </CatalogEditorDialog>
  );
}

export function PurchaseEditors({
  editor,
  workspace,
  siteId,
  dialog,
  t,
}: {
  editor: PurchaseEditor;
  workspace: PurchasingWorkspace;
  siteId: string;
  dialog: PurchaseDialogProps;
  t: PurchaseMessages;
}) {
  switch (editor.type) {
    case "draft":
      return <DraftDialog order={editor.order} {...{ workspace, siteId, dialog, t }} />;
    case "receive":
      return <ReceiptDialog order={editor.order} {...{ dialog, t }} />;
    case "issue":
    case "cancel":
      return <TransitionDialog change={editor.type} order={editor.order} {...{ dialog, t }} />;
  }
}
