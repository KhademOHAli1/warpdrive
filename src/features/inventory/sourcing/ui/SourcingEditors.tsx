"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import { useCompanyCurrency } from "@/features/currencies/CurrencyProvider";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { currencyCode, moneyAmount } from "@/features/currencies/currencySchema";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { normalizeDigits } from "@/utils/normalizeNumberInput";
import {
  CatalogCheckbox,
  CatalogEditorDialog,
  CatalogField,
  CatalogSelect,
} from "../../catalog/ui/CatalogFields";
import { sourcingMessages } from "./messages";
import type { DialogProps, Editor, Workspace } from "./types";

type Context = { siteId: string; itemId: string };
const maxPackQuantity = 1_000_000;
const partNumberLength = 120;

function textFieldValid(value: string) {
  return value.trim().length > 0 && value.trim().length <= partNumberLength;
}

function packsValid(packs: number) {
  return Number.isInteger(packs) && packs > 0 && packs <= maxPackQuantity;
}

function ManufacturerDialog({
  row,
  workspace,
  context,
  dialog,
}: {
  row: Extract<Editor, { type: "manufacturer" }>["row"];
  workspace: Workspace;
  context: Context;
  dialog: DialogProps;
}) {
  const t = sourcingMessages[useLocale()];
  const numberId = useId();
  const [organizationId, setOrganizationId] = useState(row?.organizationId ?? "");
  const [partNumber, setPartNumber] = useState(row?.partNumber ?? "");
  return (
    <CatalogEditorDialog
      {...dialog}
      title={row === null ? t.newManufacturer : t.editManufacturer}
      description={t.manufacturerDescription}
      submitDisabled={organizationId === "" || !textFieldValid(partNumber)}
      submit={() =>
        dialog.save({
          type: "saveManufacturer",
          ...context,
          id: row?.id ?? null,
          expectedVersion: row?.version ?? null,
          organizationId,
          partNumber: partNumber.trim(),
        })
      }
    >
      <CatalogField label={t.manufacturer}>
        <CatalogSelect
          ariaLabel={t.manufacturer}
          value={organizationId}
          onChange={setOrganizationId}
          disabled={dialog.pending}
          options={workspace.organizations.map(({ id, name }) => ({ value: id, label: name }))}
        />
      </CatalogField>
      <CatalogField label={t.manufacturerNumber} id={numberId}>
        <Input
          id={numberId}
          value={partNumber}
          maxLength={partNumberLength}
          required
          disabled={dialog.pending}
          onChange={(event) => setPartNumber(event.target.value)}
        />
      </CatalogField>
    </CatalogEditorDialog>
  );
}

function OfferDialog({
  row,
  workspace,
  context,
  dialog,
}: {
  row: Extract<Editor, { type: "offer" }>["row"];
  workspace: Workspace;
  context: Context;
  dialog: DialogProps;
}) {
  const t = sourcingMessages[useLocale()];
  const numberId = useId();
  const packId = useId();
  const approvedId = useId();
  const availableId = useId();
  const [supplierOrganizationId, setSupplierOrganizationId] = useState(
    row?.supplierOrganizationId ?? "",
  );
  const [manufacturerPartId, setManufacturerPartId] = useState(row?.manufacturerPartId ?? "");
  const [partNumber, setPartNumber] = useState(row?.partNumber ?? "");
  const [packQuantity, setPackQuantity] = useState(String(row?.packQuantity ?? 1));
  const [approved, setApproved] = useState(row?.approved ?? false);
  const [available, setAvailable] = useState(row?.available ?? true);
  const units = Number(packQuantity);
  const unit = workspace.parts.find(({ id }) => id === context.itemId)?.unit;
  return (
    <CatalogEditorDialog
      {...dialog}
      title={row === null ? t.newOffer : t.editOffer}
      description={t.offerDescription}
      submitDisabled={
        supplierOrganizationId === "" || !textFieldValid(partNumber) || !packsValid(units)
      }
      submit={() =>
        dialog.save({
          type: "saveOffer",
          ...context,
          id: row?.id ?? null,
          expectedVersion: row?.version ?? null,
          supplierOrganizationId,
          manufacturerPartId: manufacturerPartId === "" ? null : manufacturerPartId,
          partNumber: partNumber.trim(),
          packQuantity: units,
          approved,
          available,
        })
      }
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <CatalogField label={t.supplier}>
          <CatalogSelect
            ariaLabel={t.supplier}
            value={supplierOrganizationId}
            onChange={setSupplierOrganizationId}
            disabled={dialog.pending}
            options={workspace.organizations.map(({ id, name }) => ({ value: id, label: name }))}
          />
        </CatalogField>
        <CatalogField label={t.supplierNumber} id={numberId}>
          <Input
            id={numberId}
            value={partNumber}
            maxLength={partNumberLength}
            required
            disabled={dialog.pending}
            onChange={(event) => setPartNumber(event.target.value)}
          />
        </CatalogField>
        <CatalogField label={t.manufacturerPart}>
          <CatalogSelect
            ariaLabel={t.manufacturerPart}
            value={manufacturerPartId}
            onChange={setManufacturerPartId}
            disabled={dialog.pending}
            options={[
              { value: "", label: t.noManufacturer },
              ...workspace.manufacturers.map(({ id, organizationName, partNumber }) => ({
                value: id,
                label: `${organizationName} · ${partNumber}`,
              })),
            ]}
          />
        </CatalogField>
        <CatalogField label={t.packQuantity} id={packId}>
          <div className="flex items-center gap-2">
            <Input
              id={packId}
              type="number"
              min={1}
              max={maxPackQuantity}
              step={1}
              value={packQuantity}
              required
              disabled={dialog.pending}
              onChange={(event) => setPackQuantity(event.target.value)}
            />
            {unit !== undefined && <bdi className="text-sm text-muted-foreground">{unit}</bdi>}
          </div>
        </CatalogField>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <CatalogCheckbox
          id={approvedId}
          label={t.approved}
          checked={approved}
          disabled={dialog.pending}
          change={setApproved}
        />
        <CatalogCheckbox
          id={availableId}
          label={t.available}
          checked={available}
          disabled={dialog.pending}
          change={setAvailable}
        />
      </div>
    </CatalogEditorDialog>
  );
}

type PriceEditor = Extract<Editor, { type: "tier" | "override" }>;

function PriceDialog({
  editor,
  context,
  dialog,
}: {
  editor: PriceEditor;
  context: Context;
  dialog: DialogProps;
}) {
  const t = sourcingMessages[useLocale()];
  const packsId = useId();
  const amountId = useId();
  const record = editor.type === "tier" ? editor.tier : editor.cost;
  const [minPacks, setMinPacks] = useState(
    String(editor.type === "tier" ? (editor.tier?.minPacks ?? 1) : 1),
  );
  const companyCurrency = currencyCode.safeParse(useCompanyCurrency());
  const defaultCurrency = companyCurrency.success ? companyCurrency.data : "EUR";
  const [currency, setCurrency] = useState(record?.currency ?? defaultCurrency);
  const [amount, setAmount] = useState(record?.amount ?? "");
  const tier = editor.type === "tier";
  const existingTier = tier && editor.tier !== null;
  const cleaned = normalizeDigits(amount.trim()).replace(/٫|,/g, ".");
  const validAmount = moneyAmount.safeParse(cleaned).success;
  const validCurrency = currencyCode.safeParse(currency).success;
  const validPacks = !tier || packsValid(Number(minPacks));

  return (
    <CatalogEditorDialog
      {...dialog}
      title={tier ? (existingTier ? t.editTier : t.addTier) : t.setOverride}
      description={tier ? t.priceTierDescription : t.overrideDescription}
      submitDisabled={!validAmount || !validCurrency || !validPacks}
      submit={() =>
        dialog.save(
          tier
            ? {
                type: "setPriceTier",
                ...context,
                offerId: editor.offer.id,
                minPacks: Number(minPacks),
                currency,
                amount: cleaned,
              }
            : {
                type: "setCostOverride",
                ...context,
                cost: { currency, amount: cleaned },
              },
        )
      }
    >
      {tier && (
        <CatalogField label={t.minimumPacks} id={packsId}>
          <Input
            id={packsId}
            value={minPacks}
            type="number"
            min={1}
            max={maxPackQuantity}
            step={1}
            required
            disabled={dialog.pending || existingTier}
            onChange={(event) => setMinPacks(event.target.value)}
          />
        </CatalogField>
      )}
      <CatalogField label={t.currency}>
        {existingTier || dialog.pending ? (
          <bdi className="text-sm text-muted-foreground">{currency}</bdi>
        ) : (
          <CurrencySelect value={currency} onChange={setCurrency} />
        )}
      </CatalogField>
      <CatalogField label={tier ? t.pricePerPack : t.amount} id={amountId}>
        <Input
          id={amountId}
          value={amount}
          inputMode="decimal"
          maxLength={19}
          required
          disabled={dialog.pending}
          onChange={(event) => setAmount(event.target.value)}
        />
      </CatalogField>
    </CatalogEditorDialog>
  );
}

export function SourcingEditor({
  editor,
  workspace,
  context,
  dialog,
}: {
  editor: Editor;
  workspace: Workspace;
  context: Context;
  dialog: DialogProps;
}) {
  const t = sourcingMessages[useLocale()];
  switch (editor.type) {
    case "manufacturer":
      return <ManufacturerDialog {...{ row: editor.row, workspace, context, dialog }} />;
    case "offer":
      return <OfferDialog {...{ row: editor.row, workspace, context, dialog }} />;
    case "tier":
    case "override":
      return <PriceDialog {...{ editor, context, dialog }} />;
    case "removeTier":
      return (
        <CatalogEditorDialog
          {...dialog}
          title={t.removeTier}
          description={t.removeTierDescription}
          submit={() =>
            dialog.save({
              type: "setPriceTier",
              ...context,
              offerId: editor.tier.offerId,
              minPacks: editor.tier.minPacks,
              currency: editor.tier.currency,
              amount: null,
            })
          }
        >
          <bdi>
            {editor.tier.currency} · {editor.tier.minPacks}
          </bdi>
        </CatalogEditorDialog>
      );
    case "removeOverride":
      return (
        <CatalogEditorDialog
          {...dialog}
          title={t.removeOverride}
          description={t.removeOverrideDescription}
          submit={() => dialog.save({ type: "setCostOverride", ...context, cost: null })}
        >
          {null}
        </CatalogEditorDialog>
      );
  }
}
