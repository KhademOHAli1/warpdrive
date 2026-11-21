"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { type FormattingLocaleTag, localeTagForFormatting } from "@/lib/localeFormatting";
import type { AssetsWorkspace } from "../../contracts";
import { type CustodyCondition, custodyConditions } from "../../custody/contracts";
import { EditorSelect, readQuantity, siteLocations } from "../../ui/AssetEditorFields";
import type { Kit, KitCheckoutLine, KitIntent, KitMember } from "../contracts";
import { currentKitVersion, KitDialog, type KitEditor, type KitEditorProps } from "./KitDialog";
import { availableKitAsset, kitModeLabel, kitRemaining, referenceAsset } from "./kitView";
import type { KitWords } from "./messages";

function KitName({ kit }: { kit: Kit }) {
  return (
    <p className="text-sm font-medium [overflow-wrap:anywhere]">
      <bdi>{kit.name}</bdi>
      <bdi className="ms-2 text-muted-foreground">{kit.code}</bdi>
    </p>
  );
}

export function KitMoveDialog({
  editor,
  workspace,
  state,
  words: t,
}: KitEditorProps & { editor: Extract<KitEditor, { type: "moveKit" }> }) {
  const { kit } = editor;
  const [locationId, setLocation] = useState("");
  const [note, setNote] = useState("");
  const options = siteLocations(workspace, kit.siteId).filter(
    ({ value }) => value !== kit.locationId,
  );
  const intent: KitIntent = {
    type: "moveKit",
    ...currentKitVersion(kit),
    locationId,
    note: note.trim() || null,
  };
  return (
    <KitDialog state={state} intent={intent} title={t.move} description={t.moveIntro}>
      <KitName kit={kit} />
      <EditorSelect
        label={t.destination}
        value={locationId}
        placeholder={t.chooseLocation}
        options={options}
        disabled={state.pending}
        onChange={setLocation}
      />
      <SalesTextarea
        label={t.note}
        value={note}
        rows={2}
        maxLength={400}
        disabled={state.pending}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </KitDialog>
  );
}

function alternateOptions(workspace: AssetsWorkspace, kit: Kit, line: KitMember) {
  const activeLocations = new Set(siteLocations(workspace, kit.siteId).map(({ value }) => value));
  const occupied = new Set(
    workspace.kits?.records.flatMap((row) =>
      row.lines.filter(({ id }) => id !== line.id).map(({ assetId }) => assetId),
    ) ?? [],
  );
  const checkedOut = new Set(
    workspace.kits?.checkouts
      .filter(({ closedAt }) => closedAt === null)
      .flatMap(({ lines }) =>
        lines.filter((row) => kitRemaining(row) > 0).map(({ assetId }) => assetId),
      ) ?? [],
  );
  return workspace.records
    .filter((asset) => {
      if (
        asset.siteId !== kit.siteId ||
        asset.tracking !== "individual" ||
        asset.modelId !== line.modelId
      )
        return false;
      if (asset.id === line.assetId) return true;
      return (
        availableKitAsset(workspace, asset) &&
        !occupied.has(asset.id) &&
        !checkedOut.has(asset.id) &&
        (asset.locationId === null || activeLocations.has(asset.locationId))
      );
    })
    .map((asset) => ({ value: asset.id, label: referenceAsset(asset) }));
}

function CheckoutMember({
  line,
  kit,
  workspace,
  selected,
  onSelect,
  pending,
  words: t,
}: {
  line: KitMember;
  kit: Kit;
  workspace: AssetsWorkspace;
  selected: string;
  onSelect: (value: string) => void;
  pending: boolean;
  words: KitWords;
}) {
  const current = workspace.records.find(({ id }) => id === line.assetId);
  return (
    <li data-kit-checkout-member={line.id} className="space-y-2 p-3">
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
        <bdi>{current === undefined ? t.asset : referenceAsset(current)}</bdi>
      </p>
      <p className="text-xs text-muted-foreground">
        {t[kitModeLabel[line.mode]]} · {line.quantity}
      </p>
      {line.mode === "model" && (
        <EditorSelect
          label={t.exactUnit}
          value={selected}
          options={alternateOptions(workspace, kit, line)}
          placeholder={t.unitUnavailable}
          disabled={pending}
          onChange={onSelect}
        />
      )}
    </li>
  );
}

export function KitCheckoutDialog({
  editor,
  workspace,
  state,
  words: t,
}: KitEditorProps & { editor: Extract<KitEditor, { type: "checkoutKit" }> }) {
  const { kit } = editor;
  const [custodianId, setCustodian] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const staff = new Set(workspace.custody?.staff.map(({ id }) => id) ?? []);
  const custodians = (workspace.custody?.custodians ?? [])
    .filter(
      (row) =>
        row.siteId === kit.siteId &&
        row.active &&
        (row.kind === "non_login" || (row.staffId !== null && staff.has(row.staffId))),
    )
    .map(({ id, name }) => ({ value: id, label: name }));
  const replacements = kit.lines.flatMap((line) => {
    const assetId = chosen[line.id];
    return assetId === undefined || assetId === line.assetId ? [] : [{ lineId: line.id, assetId }];
  });
  const intent: KitIntent = {
    type: "checkoutKit",
    ...currentKitVersion(kit),
    custodianId,
    replacements,
    note: note.trim() || null,
  };

  return (
    <KitDialog state={state} intent={intent} title={t.checkout} description={t.checkoutIntro}>
      <KitName kit={kit} />
      <EditorSelect
        label={t.custodian}
        value={custodianId}
        placeholder={t.chooseCustodian}
        options={custodians}
        disabled={state.pending}
        onChange={setCustodian}
      />
      {custodians.length === 0 && <p className="text-sm text-muted-foreground">{t.noCustodians}</p>}
      <fieldset className="space-y-2 rounded-md border">
        <legend className="ms-2 px-1 text-sm font-medium">{t.selectContents}</legend>
        <ul className="divide-y">
          {kit.lines.map((line) => (
            <CheckoutMember
              key={line.id}
              {...{ line, kit, workspace }}
              words={t}
              selected={chosen[line.id] ?? line.assetId}
              pending={state.pending}
              onSelect={(assetId) => setChosen((prior) => ({ ...prior, [line.id]: assetId }))}
            />
          ))}
        </ul>
      </fieldset>
      <SalesTextarea
        label={t.note}
        value={note}
        rows={2}
        maxLength={400}
        disabled={state.pending}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </KitDialog>
  );
}

type SettlementDraft = { returned: string; consumed: string };
const noSettlement = { returned: "0", consumed: "0" };

function settlementRows(
  lines: KitCheckoutLine[],
  chosen: Record<string, SettlementDraft>,
  locale: FormattingLocaleTag,
) {
  const entries: { lineId: string; returned: number; consumed: number }[] = [];
  for (const line of lines) {
    const values = chosen[line.id] ?? noSettlement;
    const returned = readQuantity(values.returned.trim() || "0", locale);
    const consumed = readQuantity(values.consumed.trim() || "0", locale);
    if (returned === null || consumed === null || returned + consumed > kitRemaining(line))
      return null;
    if (returned + consumed > 0) entries.push({ lineId: line.id, returned, consumed });
  }
  return entries;
}

function ReturnMember({
  line,
  values,
  pending,
  words: t,
  onChange,
}: {
  line: KitCheckoutLine;
  values: SettlementDraft;
  pending: boolean;
  words: KitWords;
  onChange: (values: SettlementDraft) => void;
}) {
  const individual = line.mode === "individual" || line.mode === "model";
  return (
    <li className="space-y-2 p-3" data-kit-return-line={line.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold [overflow-wrap:anywhere]">
          <bdi>{line.assetName}</bdi>
          <bdi className="ms-2 text-xs font-normal text-muted-foreground">
            {line.serial ?? line.assetCode}
          </bdi>
        </p>
        <p className="text-xs text-muted-foreground">
          {t.remaining} {kitRemaining(line)}
        </p>
      </div>
      {individual ? (
        <div className="flex items-center gap-2 rounded-md border p-2">
          <Checkbox
            label={t.returned}
            checked={values.returned === "1"}
            disabled={pending}
            onCheckedChange={(next) => onChange({ returned: next ? "1" : "0", consumed: "0" })}
          />
          <span className="text-sm">{t.returned}</span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <SalesInput
            label={t.returnedQuantity}
            value={values.returned}
            dir="ltr"
            inputMode="numeric"
            maxLength={12}
            disabled={pending}
            onChange={(event) => onChange({ ...values, returned: event.currentTarget.value })}
          />
          {line.mode === "consumable_pool" && (
            <SalesInput
              label={t.usedQuantity}
              value={values.consumed}
              dir="ltr"
              inputMode="numeric"
              maxLength={12}
              disabled={pending}
              onChange={(event) => onChange({ ...values, consumed: event.currentTarget.value })}
            />
          )}
        </div>
      )}
    </li>
  );
}

export function KitReturnDialog({
  editor,
  state,
  words: t,
}: KitEditorProps & { editor: Extract<KitEditor, { type: "returnKit" }> }) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const { kit, checkout } = editor;
  const pendingLines = checkout.lines.filter((line) => kitRemaining(line) > 0);
  const [draft, setDraft] = useState<Record<string, SettlementDraft>>({});
  const [condition, setCondition] = useState<CustodyCondition>("good");
  const [note, setNote] = useState("");
  const lines = settlementRows(pendingLines, draft, locale);
  const intent: KitIntent | null =
    lines === null
      ? null
      : {
          type: "returnKit",
          ...currentKitVersion(kit),
          checkoutId: checkout.id,
          lines,
          condition,
          note: note.trim() || null,
        };
  return (
    <KitDialog state={state} intent={intent} title={t.return} description={t.returnIntro}>
      <KitName kit={kit} />
      <p className="text-sm text-muted-foreground">
        {t.holder} <bdi className="ms-1">{checkout.custodianName}</bdi>
      </p>
      <ul className="divide-y rounded-md border">
        {pendingLines.map((line) => (
          <ReturnMember
            key={line.id}
            line={line}
            values={draft[line.id] ?? noSettlement}
            pending={state.pending}
            words={t}
            onChange={(values) => setDraft((prior) => ({ ...prior, [line.id]: values }))}
          />
        ))}
      </ul>
      <EditorSelect
        label={t.condition}
        value={condition}
        disabled={state.pending}
        options={custodyConditions.map((value) => ({ value, label: t[value] }))}
        onChange={(next) => {
          const value = custodyConditions.find((candidate) => candidate === next);
          if (value !== undefined) setCondition(value);
        }}
      />
      <SalesTextarea
        label={t.note}
        value={note}
        rows={2}
        maxLength={400}
        disabled={state.pending}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </KitDialog>
  );
}
