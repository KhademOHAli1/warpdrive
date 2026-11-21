"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { type FormattingLocaleTag, localeTagForFormatting } from "@/lib/localeFormatting";
import type { AssetRecord, AssetsWorkspace } from "../../contracts";
import { EditorSelect, readQuantity, siteLocations } from "../../ui/AssetEditorFields";
import { type KitIntent, type KitMember, type KitMemberInput, kitMemberModes } from "../contracts";
import { KitDialog, type KitEditor, type KitEditorProps } from "./KitDialog";
import { availableKitAsset, kitModeLabel, kitsForAsset, referenceAsset } from "./kitView";
import type { KitWords } from "./messages";

type DraftMember = {
  key: string;
  mode: KitMemberInput["mode"];
  assetId: string;
  modelId: string;
  sourceLocationId: string;
  quantity: string;
};

function existingMember(row: KitMember, kitLocationId: string): DraftMember {
  return {
    key: row.id,
    mode: row.mode,
    assetId: row.assetId,
    modelId: row.modelId ?? "",
    sourceLocationId:
      poolMode(row.mode) && row.packedQuantity > 0 ? kitLocationId : (row.sourceLocationId ?? ""),
    quantity: String(row.quantity),
  };
}

function applicableAsset(asset: AssetRecord, row: DraftMember) {
  if (row.mode === "model") return asset.tracking === "individual" && asset.modelId === row.modelId;
  return asset.tracking === row.mode;
}

function poolMode(mode: KitMemberInput["mode"]) {
  return mode === "returnable_pool" || mode === "consumable_pool";
}

function memberInput(row: DraftMember, locale: FormattingLocaleTag): KitMemberInput | null {
  const pooled = poolMode(row.mode);
  const quantity = pooled ? readQuantity(row.quantity, locale) : 1;
  if (quantity === null || (pooled && row.sourceLocationId === "")) return null;
  return {
    mode: row.mode,
    assetId: row.assetId,
    modelId: row.mode === "model" ? row.modelId : null,
    sourceLocationId: pooled ? row.sourceLocationId : null,
    quantity,
  };
}

function MemberEditor({
  row,
  assets,
  models,
  locations,
  pending,
  words: t,
  onChange,
  onRemove,
}: {
  row: DraftMember;
  assets: AssetRecord[];
  models: { value: string; label: string }[];
  locations: ReturnType<typeof siteLocations>;
  pending: boolean;
  words: KitWords;
  onChange: (next: DraftMember) => void;
  onRemove: () => void;
}) {
  const candidates = assets.filter((asset) => applicableAsset(asset, row));
  const chosen = candidates.find(({ id }) => id === row.assetId);
  const pooled = poolMode(row.mode);
  const balances = chosen?.tracking === "individual" ? [] : (chosen?.balances ?? []);
  const sources = locations.filter(
    ({ value }) =>
      value === row.sourceLocationId ||
      balances.some(({ locationId, quantity }) => locationId === value && quantity > 0),
  );
  return (
    <div data-kit-member className="space-y-3 rounded-md border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorSelect
          label={t.type}
          value={row.mode}
          options={kitMemberModes.map((value) => ({ value, label: t[kitModeLabel[value]] }))}
          disabled={pending}
          onChange={(next) => {
            const mode = kitMemberModes.find((candidate) => candidate === next);
            if (mode !== undefined) {
              onChange({
                ...row,
                mode,
                assetId: "",
                modelId: "",
                sourceLocationId: "",
                quantity: "1",
              });
            }
          }}
        />
        {row.mode === "model" && (
          <EditorSelect
            label={t.model}
            value={row.modelId}
            options={models}
            placeholder={t.chooseModel}
            disabled={pending}
            onChange={(modelId) => onChange({ ...row, modelId, assetId: "" })}
          />
        )}
        <EditorSelect
          label={t.asset}
          value={row.assetId}
          options={candidates.map((asset) => ({ value: asset.id, label: referenceAsset(asset) }))}
          placeholder={t.chooseAsset}
          disabled={pending}
          onChange={(assetId) => onChange({ ...row, assetId, sourceLocationId: "" })}
        />
        {pooled && (
          <>
            <EditorSelect
              label={t.source}
              value={row.sourceLocationId}
              options={sources}
              placeholder={t.chooseLocation}
              disabled={pending}
              onChange={(sourceLocationId) => onChange({ ...row, sourceLocationId })}
            />
            <SalesInput
              label={t.quantity}
              value={row.quantity}
              inputMode="numeric"
              dir="ltr"
              maxLength={12}
              disabled={pending}
              required
              onChange={(event) => onChange({ ...row, quantity: event.currentTarget.value })}
            />
          </>
        )}
      </div>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onRemove}>
        <X size={14} aria-hidden="true" /> {t.removeMember}
      </Button>
    </div>
  );
}

export function KitDefinitionDialog({
  editor,
  workspace,
  state,
  words: t,
}: KitEditorProps & { editor: Extract<KitEditor, { type: "saveKit" }> }) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const { kit, siteId } = editor;
  const [code, setCode] = useState(kit?.code ?? "");
  const [name, setName] = useState(kit?.name ?? "");
  const [locationId, setLocation] = useState(kit?.locationId ?? "");
  const [members, setMembers] = useState(
    () => kit?.lines.map((line) => existingMember(line, kit.locationId)) ?? [],
  );
  const [note, setNote] = useState("");
  const edit = kit !== undefined;
  const locations = siteLocations(workspace, siteId);
  const models = workspace.models
    .filter((model) => model.siteId === siteId)
    .map(({ id, name, code }) => ({ value: id, label: `${name} · ${code}` }));
  const original = new Set(kit?.lines.map(({ assetId }) => assetId) ?? []);
  const assets = availableMembers(workspace, siteId, original, kit?.id);
  const lines = members.flatMap((row) => memberInput(row, locale) ?? []);
  const intent: KitIntent | null =
    lines.length === members.length
      ? {
          type: "saveKit",
          siteId,
          kitId: kit?.id ?? null,
          version: kit?.version ?? null,
          code,
          name,
          locationId,
          lines,
          note: note.trim() || null,
        }
      : null;

  function addMember() {
    setMembers((previous) => [
      ...previous,
      {
        key: crypto.randomUUID(),
        mode: "individual",
        assetId: "",
        modelId: "",
        sourceLocationId: "",
        quantity: "1",
      },
    ]);
  }

  return (
    <KitDialog
      state={state}
      intent={intent}
      title={edit ? t.edit : t.add}
      description={edit ? t.editIntro : t.addIntro}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SalesInput
          label={t.name}
          value={name}
          required
          maxLength={120}
          disabled={state.pending}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <SalesInput
          label={t.code}
          value={code}
          required
          dir="ltr"
          maxLength={80}
          disabled={state.pending}
          onChange={(event) => setCode(event.currentTarget.value)}
        />
        <EditorSelect
          label={t.location}
          value={locationId}
          options={locations}
          placeholder={t.chooseLocation}
          disabled={state.pending || edit}
          onChange={setLocation}
        />
      </div>
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t.contents}</legend>
        {members.map((row) => (
          <MemberEditor
            key={row.key}
            {...{ row, assets, models, locations }}
            pending={state.pending}
            words={t}
            onChange={(next) =>
              setMembers((previous) =>
                previous.map((member) => (member.key === row.key ? next : member)),
              )
            }
            onRemove={() => setMembers((previous) => previous.filter(({ key }) => key !== row.key))}
          />
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={state.pending || members.length === 60}
          onClick={addMember}
        >
          <Plus size={15} aria-hidden="true" /> {t.addMember}
        </Button>
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

function availableMembers(
  workspace: AssetsWorkspace,
  siteId: string,
  original: ReadonlySet<string>,
  kitId: string | undefined,
) {
  return workspace.records.filter((asset) => {
    if (asset.siteId !== siteId) return false;
    if (original.has(asset.id)) return true;
    if (asset.tracking === "individual") {
      return (
        availableKitAsset(workspace, asset) &&
        kitsForAsset(workspace, asset.id).every(({ id }) => id === kitId)
      );
    }
    return asset.archivedAt === null;
  });
}
