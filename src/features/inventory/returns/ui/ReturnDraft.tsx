"use client";

import { Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import {
  CatalogCheckbox,
  CatalogEditorDialog,
  CatalogField,
  CatalogSelect,
} from "../../catalog/ui/CatalogFields";
import {
  SalesInput as ReturnInput,
  SalesTextarea as ReturnTextarea,
} from "../../sales/ui/SalesFields";
import type { ReturnablePart, ReturnDetail, ReturnSource, ReturnsWorkspace } from "../contracts";
import { returnPartLabel, useReturnDisplay } from "./display";
import type { ReturnMessages } from "./messages";
import { type ReturnDialog, type ReturnIntent, validReturnIntent } from "./types";

type LineDraft = { selected: boolean; quantity: string; reason: string };
type ChargeDraft = { key: string; label: string; amount: string };

const blankLine: LineDraft = { selected: false, quantity: "1", reason: "" };

function DraftLine({
  source,
  row,
  pending,
  update,
  t,
}: {
  source: ReturnablePart;
  row: LineDraft;
  pending: boolean;
  update: (value: LineDraft) => void;
  t: ReturnMessages;
}) {
  const id = useId();
  const f = useReturnDisplay();
  return (
    <div data-return-source-line-id={source.id} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 break-words text-sm">
          <bdi className="block font-medium">{returnPartLabel(source)}</bdi>
          <bdi className="block text-muted-foreground">{source.name}</bdi>
        </div>
        <p className="text-xs text-muted-foreground">
          {t.available} {f.quantity(source.eligible)}
        </p>
      </div>
      <CatalogCheckbox
        id={id}
        label={`${t.selectLine} — ${returnPartLabel(source)}`}
        checked={row.selected}
        disabled={pending || (source.eligible === 0 && !row.selected)}
        change={(selected) => update({ ...row, selected })}
      />
      {row.selected && (
        <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <ReturnInput
            label={t.quantity}
            type="number"
            min={1}
            max={source.eligible}
            step={1}
            value={row.quantity}
            onChange={(event) => update({ ...row, quantity: event.target.value })}
            readOnly={source.serial !== null}
            required
            disabled={pending}
          />
          <ReturnInput
            label={t.reason}
            value={row.reason}
            maxLength={400}
            onChange={(event) => update({ ...row, reason: event.target.value })}
            required
            disabled={pending}
          />
        </div>
      )}
    </div>
  );
}

function Charges({
  charges,
  currency,
  pending,
  setCharges,
  t,
}: {
  charges: ChargeDraft[];
  currency: string;
  pending: boolean;
  setCharges: (value: ChargeDraft[]) => void;
  t: ReturnMessages;
}) {
  const sequence = useRef(0);
  function addCharge() {
    sequence.current += 1;
    setCharges([...charges, { key: `new-${sequence.current}`, label: "", amount: "" }]);
  }
  function updateCharge(key: string, patch: Partial<Pick<ChargeDraft, "label" | "amount">>) {
    setCharges(charges.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {t.extraCharges} <bdi className="font-normal text-muted-foreground">{currency}</bdi>
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || charges.length >= 20}
          onClick={addCharge}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t.addCharge}
        </Button>
      </div>
      {charges.map(({ key, label, amount }) => (
        <div
          key={key}
          className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,1fr)_auto]"
        >
          <ReturnInput
            label={t.chargeLabel}
            maxLength={120}
            value={label}
            onChange={(event) => updateCharge(key, { label: event.target.value })}
            required
            disabled={pending}
          />
          <ReturnInput
            label={t.amount}
            inputMode="decimal"
            maxLength={32}
            value={amount}
            onChange={(event) => updateCharge(key, { amount: event.target.value })}
            required
            disabled={pending}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 self-end"
            aria-label={t.removeCharge}
            onClick={() => setCharges(charges.filter((row) => row.key !== key))}
            disabled={pending}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
    </section>
  );
}

export function ReturnDraft({
  detail,
  source,
  sites,
  preferredSiteId,
  dialog,
  t,
}: {
  detail: ReturnDetail | null;
  source: ReturnSource;
  sites: ReturnsWorkspace["sites"];
  preferredSiteId: string | undefined;
  dialog: ReturnDialog;
  t: ReturnMessages;
}) {
  const prefs = useLocalePreferences();
  const locale = localeTagForFormatting(prefs);
  const format = new Intl.NumberFormat(locale, { useGrouping: false });
  const decimal = format.formatToParts(1.1).find(({ type }) => type === "decimal")?.value ?? ".";
  const activeSites = sites.filter(({ archived }) => !archived);
  const [siteId, setSite] = useState(
    detail?.siteId ??
      preferredSiteId ??
      (activeSites.length === 1 ? (activeSites[0]?.id ?? "") : ""),
  );
  const [reference, setReference] = useState(detail?.reference ?? "");
  const [note, setNote] = useState(detail?.note ?? "");
  const [lines, setLines] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      (detail?.lines ?? []).map(({ shipmentLineId, quantity, reason }) => [
        shipmentLineId,
        { selected: true, quantity: String(quantity), reason },
      ]),
    ),
  );
  const [charges, setCharges] = useState<ChargeDraft[]>(() =>
    (detail?.charges ?? []).map(({ label, amount }, index) => ({
      key: `existing-${index}`,
      label,
      amount: amount.replace(".", decimal),
    })),
  );
  const selected = source.lines.filter(({ id }) => lines[id]?.selected === true);
  const exceedsEligible = selected.some(
    ({ id, eligible }) => Number(lines[id]?.quantity) > eligible,
  );
  const intent: ReturnIntent = {
    type: "saveDraft",
    shipmentId: source.id,
    caseId: detail?.id ?? null,
    version: detail?.version ?? null,
    siteId,
    reference,
    note: note.trim() === "" ? null : note,
    charges: charges.map(({ label, amount }) => ({
      label,
      amount: normalizeNumberInput(amount, locale) ?? "",
    })),
    lines: selected.map(({ id }) => ({
      shipmentLineId: id,
      quantity: Number(lines[id]?.quantity),
      reason: lines[id]?.reason ?? "",
    })),
  };
  return (
    <CatalogEditorDialog
      {...dialog}
      title={detail === null ? t.newReturn : t.editDraft}
      description={t.draftDescription}
      submitDisabled={
        !activeSites.some(({ id }) => id === siteId) ||
        exceedsEligible ||
        !validReturnIntent(intent)
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
            disabled={dialog.pending}
          />
        </CatalogField>
        <ReturnInput
          label={t.reference}
          value={reference}
          maxLength={80}
          onChange={(event) => setReference(event.target.value)}
          required
          disabled={dialog.pending}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.caseItems}</h3>
        {source.lines.length === 0 && (
          <p className="text-sm text-muted-foreground">{t.noSourceLines}</p>
        )}
        {source.lines.map((item) => (
          <DraftLine
            key={item.id}
            source={item}
            row={lines[item.id] ?? blankLine}
            pending={dialog.pending}
            t={t}
            update={(value) => setLines((current) => ({ ...current, [item.id]: value }))}
          />
        ))}
      </div>
      <ReturnTextarea
        label={t.note}
        value={note}
        maxLength={1000}
        rows={2}
        onChange={(event) => setNote(event.target.value)}
        disabled={dialog.pending}
      />
      {source.currency !== null && (
        <Charges
          {...{ charges, setCharges, t }}
          currency={source.currency}
          pending={dialog.pending}
        />
      )}
    </CatalogEditorDialog>
  );
}
