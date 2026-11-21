"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { useFormatters } from "@/lib/useFormatters";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { CatalogEditorDialog, CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { SalesOrderDetail, SalesPart, SalesWorkspace } from "../contracts";
import type { SalesMessages } from "./messages";
import { SalesInput, SalesTextarea } from "./SalesFields";
import { type SalesDialog, type SalesIntent, validSalesIntent } from "./types";

type ProductDraft = {
  key: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  note: string;
};
type ChargeDraft = { key: string; label: string; amount: string };
const maxLines = 100;
const maxCharges = 20;

function newProduct(key: string): ProductDraft {
  return { key, itemId: "", quantity: "1", unitPrice: "", note: "" };
}

function ProductField({
  line,
  parts,
  reservedIds,
  disabled,
  t,
  change,
  remove,
}: {
  line: ProductDraft;
  parts: SalesPart[];
  reservedIds: ReadonlySet<string>;
  disabled: boolean;
  t: SalesMessages;
  change: (next: ProductDraft) => void;
  remove: (() => void) | undefined;
}) {
  const options = parts
    .filter(({ id }) => id === line.itemId || !reservedIds.has(id))
    .map(({ id, code, name, revision, unit }) => ({
      value: id,
      label: `${code} · ${revision} — ${name} (${unit})`,
    }));
  return (
    <div data-sales-draft-line className="space-y-2 rounded-md border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(5.5rem,1fr)_minmax(6rem,1fr)_auto]">
        <CatalogField label={t.part}>
          <CatalogSelect
            ariaLabel={t.part}
            value={line.itemId}
            options={options}
            onChange={(itemId) => change({ ...line, itemId })}
            disabled={disabled || options.length === 0}
          />
        </CatalogField>
        <SalesInput
          label={t.quantity}
          type="number"
          min={1}
          max={1_000_000}
          step={1}
          value={line.quantity}
          onChange={(event) => change({ ...line, quantity: event.target.value })}
          required
          disabled={disabled}
        />
        <SalesInput
          label={t.unitPrice}
          type="text"
          inputMode="decimal"
          maxLength={32}
          value={line.unitPrice}
          onChange={(event) => change({ ...line, unitPrice: event.target.value })}
          required
          disabled={disabled}
        />
        {remove !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 self-end"
            aria-label={t.removeLine}
            disabled={disabled}
            onClick={remove}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
      <SalesInput
        label={t.note}
        value={line.note}
        maxLength={240}
        onChange={(event) => change({ ...line, note: event.target.value })}
        disabled={disabled}
      />
    </div>
  );
}

function ChargeField({
  charge,
  disabled,
  t,
  change,
  remove,
}: {
  charge: ChargeDraft;
  disabled: boolean;
  t: SalesMessages;
  change: (next: ChargeDraft) => void;
  remove: () => void;
}) {
  return (
    <div
      data-sales-draft-charge
      className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_auto]"
    >
      <SalesInput
        label={t.chargeLabel}
        value={charge.label}
        maxLength={120}
        onChange={(event) => change({ ...charge, label: event.target.value })}
        required
        disabled={disabled}
      />
      <SalesInput
        label={t.chargeAmount}
        type="text"
        inputMode="decimal"
        maxLength={32}
        value={charge.amount}
        onChange={(event) => change({ ...charge, amount: event.target.value })}
        required
        disabled={disabled}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 self-end"
        aria-label={t.removeCharge}
        disabled={disabled}
        onClick={remove}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

export function DraftEditor({
  order,
  workspace,
  selectedSiteId,
  dialog,
  t,
}: {
  order: SalesOrderDetail | null;
  workspace: SalesWorkspace;
  selectedSiteId: string | undefined;
  dialog: SalesDialog;
  t: SalesMessages;
}) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const { number } = useFormatters();
  const initialMoney = (value: string) =>
    number(value, { useGrouping: false, maximumFractionDigits: 4 });
  const nextKey = useRef(0);
  const activeSites = workspace.sites.filter(({ archived }) => archived !== true);
  const [siteId, setSite] = useState(
    order?.siteId ??
      activeSites.find(({ id }) => id === selectedSiteId)?.id ??
      activeSites[0]?.id ??
      "",
  );
  const [reference, setReference] = useState(order?.reference ?? "");
  const [recipient, setRecipient] = useState(
    order?.delivery?.recipient ?? workspace.deal?.customerName ?? "",
  );
  const [address, setAddress] = useState(order?.delivery?.address ?? workspace.deal?.address ?? "");
  const [currency, setCurrency] = useState(
    order?.commercial?.currency ?? workspace.deal?.currency ?? "",
  );
  const [dueDate, setDue] = useState(order?.dueDate ?? "");
  const [lines, setLines] = useState<ProductDraft[]>(() =>
    order === null
      ? [newProduct("first")]
      : order.lines.map((line) => ({
          key: line.id,
          itemId: line.itemId,
          quantity: String(line.quantity),
          unitPrice: line.unitPrice === null ? "" : initialMoney(line.unitPrice),
          note: line.note ?? "",
        })),
  );
  const [charges, setCharges] = useState<ChargeDraft[]>(
    () =>
      order?.commercial?.charges.map(({ label, amount }, index) => ({
        key: `existing-${index}`,
        label,
        amount: initialMoney(amount),
      })) ?? [],
  );
  const dealId = order?.dealId ?? workspace.deal?.id;
  const inUse = new Set(lines.map(({ itemId }) => itemId).filter(Boolean));
  const uniqueCharges = new Set(charges.map(({ label }) => label.trim().toLowerCase()));
  const intent: SalesIntent = {
    type: "saveDraft",
    orderId: order?.id ?? null,
    version: order?.version ?? null,
    siteId,
    dealId: dealId ?? "",
    reference,
    recipient,
    address,
    currency,
    dueDate: dueDate === "" ? null : dueDate,
    lines: lines.map(({ itemId, quantity, unitPrice, note }) => ({
      itemId,
      quantity: Number(quantity),
      unitPrice: normalizeNumberInput(unitPrice, locale) ?? "",
      note: note.trim() === "" ? null : note,
    })),
    charges: charges.map(({ label, amount }) => ({
      label,
      amount: normalizeNumberInput(amount, locale) ?? "",
    })),
  };

  return (
    <CatalogEditorDialog
      title={order === null ? t.newOrder : t.editOrder}
      description={t.draftDescription}
      {...dialog}
      submitDisabled={
        inUse.size !== lines.length ||
        uniqueCharges.size !== charges.length ||
        !activeSites.some(({ id }) => id === siteId) ||
        !validSalesIntent(intent)
      }
      submit={() => dialog.save(intent)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField label={t.site}>
          <CatalogSelect
            ariaLabel={t.site}
            value={siteId}
            options={activeSites.map(({ id, name, code }) => ({
              value: id,
              label: `${name} · ${code}`,
            }))}
            onChange={setSite}
            disabled={dialog.pending || activeSites.length < 2}
          />
        </CatalogField>
        <SalesInput
          label={t.reference}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          maxLength={80}
          required
          disabled={dialog.pending}
        />
        <SalesInput
          label={t.customer}
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          maxLength={180}
          required
          disabled={dialog.pending}
        />
        <SalesInput
          label={t.due}
          type="date"
          value={dueDate}
          onChange={(event) => setDue(event.target.value)}
          disabled={dialog.pending}
        />
        <SalesInput
          label={t.currency}
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          autoCapitalize="characters"
          maxLength={3}
          required
          disabled={dialog.pending}
        />
      </div>
      <SalesTextarea
        label={t.shipTo}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        maxLength={1_000}
        required
        disabled={dialog.pending}
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t.products}</legend>
        {lines.map((line) => (
          <ProductField
            key={line.key}
            line={line}
            parts={workspace.parts}
            reservedIds={inUse}
            disabled={dialog.pending}
            t={t}
            change={(next) =>
              setLines((current) => current.map((item) => (item.key === next.key ? next : item)))
            }
            remove={
              lines.length > 1
                ? () => setLines((current) => current.filter(({ key }) => key !== line.key))
                : undefined
            }
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            dialog.pending || lines.length >= maxLines || lines.length >= workspace.parts.length
          }
          onClick={() => setLines([...lines, newProduct(String(nextKey.current++))])}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t.addLine}
        </Button>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t.extraCharges}</legend>
        {charges.map((charge) => (
          <ChargeField
            key={charge.key}
            charge={charge}
            disabled={dialog.pending}
            t={t}
            change={(next) =>
              setCharges((current) => current.map((item) => (item.key === next.key ? next : item)))
            }
            remove={() => setCharges((current) => current.filter(({ key }) => key !== charge.key))}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={dialog.pending || charges.length >= maxCharges}
          onClick={() =>
            setCharges([...charges, { key: String(nextKey.current++), label: "", amount: "" }])
          }
        >
          <Plus aria-hidden="true" className="size-4" />
          {t.addCharge}
        </Button>
      </fieldset>
    </CatalogEditorDialog>
  );
}
