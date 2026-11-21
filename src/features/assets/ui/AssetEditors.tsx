"use client";

import { Plus, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import {
  CatalogCheckbox,
  CatalogEditorDialog,
} from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { formatNumber, localeTagForFormatting } from "@/lib/localeFormatting";
import {
  type AssetCategory,
  type AssetField,
  type AssetIntent,
  type AssetModel,
  type AssetRecord,
  type AssetsWorkspace,
  assetFieldTypes,
  assetTrackingMethods,
  validAssetIntent,
} from "../contracts";
import { uniqueAssetKeys, validAssetFields } from "../registerRules";
import {
  AssetDetailsFields,
  AssetFieldInput,
  detailsDraft,
  EditorSelect,
  type EditorWords,
  fieldLines,
  parseFieldInput,
  readDetails,
  readQuantity,
  siteLocations,
  toFieldInput,
} from "./AssetEditorFields";
import { assetEditorMessages } from "./assetEditorMessages";

export type AssetEditor =
  | { type: "create"; siteId: string }
  | { type: "createFleet"; siteId: string }
  | { type: "update"; asset: AssetRecord }
  | { type: "move"; asset: AssetRecord }
  | { type: "changePool"; asset: AssetRecord }
  | { type: "setArchive"; asset: AssetRecord }
  | { type: "note"; asset: AssetRecord }
  | { type: "saveCategory"; siteId: string; category?: AssetCategory }
  | { type: "saveModel"; siteId: string; model?: AssetModel };

type AssetEditorDialogProps = {
  editor: AssetEditor;
  workspace: AssetsWorkspace;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (intent: AssetIntent) => void;
  restoreFocus?: () => void;
};

type DialogProps = Pick<
  AssetEditorDialogProps,
  "pending" | "error" | "onClose" | "onSubmit" | "restoreFocus"
>;
type EditorProps = DialogProps & {
  t: EditorWords;
  preferences: ReturnType<typeof useLocalePreferences>;
};

function CommandDialog({
  dialog,
  title,
  description,
  intent,
  children,
}: {
  dialog: DialogProps;
  title: string;
  description: string;
  intent: AssetIntent | null;
  children: ReactNode;
}) {
  const verified = intent !== null && validAssetIntent(intent) ? intent : null;
  return (
    <CatalogEditorDialog
      title={title}
      description={description}
      pending={dialog.pending}
      error={dialog.error}
      close={dialog.onClose}
      restoreFocus={() => dialog.restoreFocus?.()}
      submitDisabled={verified === null}
      submit={() => {
        if (verified !== null) dialog.onSubmit(verified);
      }}
    >
      {children}
    </CatalogEditorDialog>
  );
}

function RecordEditor({
  asset,
  siteId,
  workspace,
  ...dialog
}: EditorProps & { asset?: AssetRecord; siteId: string; workspace: AssetsWorkspace }) {
  const { t, preferences, pending } = dialog;
  const categories = workspace.categories.filter((record) => record.siteId === siteId);
  const models = workspace.models.filter((record) => record.siteId === siteId);
  const [draft, setDraft] = useState(() => detailsDraft(categories, preferences, asset));
  const [tracking, setTracking] = useState(asset?.tracking ?? "individual");
  const [modelId, setModelId] = useState(
    asset?.tracking === "individual" ? (asset.modelId ?? "") : "",
  );
  const [serial, setSerial] = useState(
    asset?.tracking === "individual" ? (asset.serial ?? "") : "",
  );
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState("0");
  const locale = localeTagForFormatting(preferences);
  const binOptions = siteLocations(workspace, siteId);
  const isIndividual = tracking === "individual";
  const openingQuantity = isIndividual ? 0 : readQuantity(quantity, locale);
  const content = readDetails(draft, categories, locale);

  function selectModel(id: string) {
    setModelId(id);
    const model = models.find((entry) => entry.id === id);
    if (asset === undefined && model !== undefined) {
      setDraft((current) => ({
        ...detailsDraft(categories, preferences, model),
        code: current.code,
      }));
    }
  }

  const individual = {
    serial: isIndividual ? serial.trim() || null : null,
    modelId: isIndividual ? modelId || null : null,
  };
  const update = asset === undefined ? null : assetVersion(asset);
  const locationId = availablePlacement(isIndividual, openingQuantity, location);
  const intent = recordIntent({
    content,
    update,
    siteId,
    tracking,
    ...individual,
    openingQuantity,
    locationId,
  });

  return (
    <CommandDialog
      dialog={dialog}
      title={asset === undefined ? t.create : t.update}
      description={t.detailsDescription}
      intent={intent}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorSelect
          label={t.tracking}
          value={tracking}
          options={assetTrackingMethods.map((value) => ({ value, label: t[value] }))}
          disabled={pending || asset !== undefined}
          onChange={(next) => {
            const method = assetTrackingMethods.find((value) => value === next);
            if (method !== undefined) setTracking(method);
          }}
        />
        {isIndividual && (
          <EditorSelect
            label={t.model}
            value={modelId}
            options={[{ value: "", label: t.noModel }, ...modelOptions(models)]}
            disabled={pending}
            onChange={selectModel}
          />
        )}
      </div>
      <AssetDetailsFields {...{ categories, draft, pending, t, preferences }} change={setDraft} />
      {isIndividual && (
        <SalesInput
          label={t.serial}
          value={serial}
          disabled={pending}
          maxLength={80}
          dir="ltr"
          onChange={(event) => setSerial(event.target.value)}
        />
      )}
      {asset === undefined && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(isIndividual || openingQuantity !== 0) && (
            <EditorSelect
              label={t.location}
              value={location}
              options={
                isIndividual ? [{ value: "", label: t.noLocation }, ...binOptions] : binOptions
              }
              placeholder={t.selectLocation}
              disabled={pending}
              onChange={setLocation}
            />
          )}
          {!isIndividual && (
            <QuantityInput
              label={t.openingQuantity}
              pending={pending}
              value={quantity}
              change={setQuantity}
            />
          )}
        </div>
      )}
    </CommandDialog>
  );
}

function availablePlacement(
  individual: boolean,
  quantity: number | null,
  location: string,
): string | null {
  return individual || quantity !== 0 ? location || null : null;
}

type CreateAsset = Extract<AssetIntent, { type: "create" }>;
type Version = { assetId: string; version: number };

function recordIntent({
  content,
  update,
  openingQuantity,
  siteId,
  tracking,
  locationId,
  serial,
  modelId,
}: {
  content: ReturnType<typeof readDetails>;
  update: Version | null;
  openingQuantity: number | null;
} & Pick<
  CreateAsset,
  "siteId" | "tracking" | "locationId" | "serial" | "modelId"
>): AssetIntent | null {
  if (content === null) return null;
  const values = { ...content, serial, modelId };
  if (update !== null) return { type: "update", ...update, ...values };
  if (openingQuantity === null || (openingQuantity > 0 && locationId === null)) return null;
  return { type: "create", siteId, tracking, locationId, openingQuantity, ...values };
}

function assetVersion({ id, version }: AssetRecord) {
  return { assetId: id, version };
}

function modelOptions(models: AssetModel[]) {
  return models.map(({ id, code, name }) => ({ value: id, label: `${name} · ${code}` }));
}

function FleetEditor({
  siteId,
  workspace,
  ...dialog
}: EditorProps & { siteId: string; workspace: AssetsWorkspace }) {
  const { t, pending } = dialog;
  const models = workspace.models.filter((record) => record.siteId === siteId);
  const [modelId, setModel] = useState(models.length === 1 ? (models[0]?.id ?? "") : "");
  const [location, setLocation] = useState("");
  const [units, setUnits] = useState([{ key: "first", code: "", serial: "" }]);

  const unitInputs = units.map(({ code, serial }) => ({
    code: code.trim(),
    serial: serial.trim() || null,
  }));
  const serials = unitInputs.flatMap(({ serial }) => (serial === null ? [] : [serial]));
  const unique = uniqueAssetKeys(unitInputs.map(({ code }) => code)) && uniqueAssetKeys(serials);
  const intent: AssetIntent | null = unique
    ? { type: "createFleet", siteId, modelId, locationId: location || null, units: unitInputs }
    : null;

  function updateUnit(key: string, change: { code?: string; serial?: string }) {
    setUnits((previous) =>
      previous.map((unit) => (unit.key === key ? { ...unit, ...change } : unit)),
    );
  }

  return (
    <CommandDialog
      dialog={dialog}
      title={t.createFleet}
      description={t.fleetDescription}
      intent={intent}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorSelect
          label={t.model}
          value={modelId}
          options={modelOptions(models)}
          disabled={pending}
          onChange={setModel}
        />
        <EditorSelect
          label={t.location}
          value={location}
          options={[{ value: "", label: t.noLocation }, ...siteLocations(workspace, siteId)]}
          disabled={pending}
          onChange={setLocation}
        />
      </div>
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t.units}</legend>
        {units.map(({ key, code, serial }) => (
          <div
            key={key}
            className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
            data-asset-unit
          >
            <SalesInput
              label={t.code}
              value={code}
              required
              disabled={pending}
              maxLength={80}
              dir="ltr"
              onChange={(event) => updateUnit(key, { code: event.target.value })}
            />
            <SalesInput
              label={t.serial}
              value={serial}
              disabled={pending}
              maxLength={80}
              dir="ltr"
              onChange={(event) => updateUnit(key, { serial: event.target.value })}
            />
            {units.length > 1 && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t.removeUnit}
                disabled={pending}
                onClick={() => setUnits((previous) => previous.filter((unit) => unit.key !== key))}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || units.length === 50}
          onClick={() => setUnits([...units, { key: crypto.randomUUID(), code: "", serial: "" }])}
        >
          <Plus aria-hidden="true" /> {t.addUnit}
        </Button>
      </fieldset>
    </CommandDialog>
  );
}

function MoveEditor({
  asset,
  workspace,
  ...dialog
}: EditorProps & {
  asset: Extract<AssetRecord, { tracking: "individual" }>;
  workspace: AssetsWorkspace;
}) {
  const { t, pending } = dialog;
  const [location, setLocation] = useState(asset.locationId ?? "");
  const [reason, setReason] = useState("");
  const locationId = location || null;
  const intent: AssetIntent | null =
    locationId === asset.locationId
      ? null
      : { type: "move", ...assetVersion(asset), locationId, reason };
  return (
    <CommandDialog dialog={dialog} title={t.move} description={t.moveDescription} intent={intent}>
      <EditorSelect
        label={t.location}
        value={location}
        options={[{ value: "", label: t.noLocation }, ...siteLocations(workspace, asset.siteId)]}
        disabled={pending}
        onChange={setLocation}
      />
      <ReasonInput label={t.reason} pending={pending} value={reason} change={setReason} />
    </CommandDialog>
  );
}

function QuantityInput({
  label,
  pending,
  value,
  change,
}: {
  label: string;
  pending: boolean;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <SalesInput
      label={label}
      value={value}
      required
      disabled={pending}
      inputMode="numeric"
      dir="ltr"
      maxLength={16}
      onChange={(event) => change(event.target.value)}
    />
  );
}

function ReasonInput({
  label,
  pending,
  value,
  change,
}: {
  label: string;
  pending: boolean;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <SalesTextarea
      label={label}
      value={value}
      required
      disabled={pending}
      rows={3}
      maxLength={400}
      onChange={(event) => change(event.target.value)}
    />
  );
}

type PoolOperation = Extract<AssetIntent, { type: "changePool" }>["operation"];

function PoolEditor({
  asset,
  workspace,
  ...dialog
}: EditorProps & {
  asset: Exclude<AssetRecord, { tracking: "individual" }>;
  workspace: AssetsWorkspace;
}) {
  const { t, preferences, pending } = dialog;
  const [operation, setOperation] = useState<PoolOperation>("restock");
  const [location, setLocation] = useState("");
  const [destination, setDestination] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const bins = siteLocations(workspace, asset.siteId);
  const byBin = new Map(asset.balances.map(({ locationId, quantity }) => [locationId, quantity]));
  const outgoing = operation === "consume" || operation === "move";
  const sources = bins
    .filter(({ value }) => !outgoing || (byBin.get(value) ?? 0) > 0)
    .map((option) => ({
      ...option,
      label: `${option.label} · ${formatNumber(byBin.get(option.value) ?? 0, preferences)}`,
    }));
  const operations: { value: PoolOperation; label: string }[] = [
    { value: "restock", label: t.restock },
    { value: "adjust", label: t.adjust },
    { value: "move", label: t.poolMove },
  ];
  if (asset.tracking === "consumable_pool") operations.push({ value: "consume", label: t.consume });

  const units = readQuantity(quantity, localeTagForFormatting(preferences));
  const available = byBin.get(location) ?? 0;
  const amountAllowed =
    units !== null && (operation === "adjust" || units > 0) && (!outgoing || units <= available);
  const destinationAllowed =
    operation !== "move" || (destination !== "" && destination !== location);
  const intent: AssetIntent | null =
    location !== "" && amountAllowed && destinationAllowed
      ? {
          type: "changePool",
          ...assetVersion(asset),
          operation,
          locationId: location,
          toLocationId: operation === "move" ? destination : null,
          quantity: units,
          reason,
        }
      : null;

  return (
    <CommandDialog
      dialog={dialog}
      title={t.changePool}
      description={t.poolDescription}
      intent={intent}
    >
      <EditorSelect
        label={t.operation}
        value={operation}
        options={operations}
        disabled={pending}
        onChange={(next) => {
          const option = operations.find(({ value }) => value === next);
          if (option === undefined) return;
          setOperation(option.value);
          setLocation("");
          setDestination("");
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorSelect
          label={operation === "move" ? t.fromLocation : t.location}
          value={location}
          options={sources}
          placeholder={t.selectLocation}
          disabled={pending}
          onChange={(next) => {
            setLocation(next);
            if (destination === next) setDestination("");
          }}
        />
        {operation === "move" && (
          <EditorSelect
            label={t.toLocation}
            value={destination}
            options={bins.filter(({ value }) => value !== location)}
            placeholder={t.selectLocation}
            disabled={pending}
            onChange={setDestination}
          />
        )}
      </div>
      <QuantityInput label={t.quantity} pending={pending} value={quantity} change={setQuantity} />
      <ReasonInput label={t.reason} pending={pending} value={reason} change={setReason} />
    </CommandDialog>
  );
}

function LifecycleEditor({
  editor,
  ...dialog
}: EditorProps & { editor: Extract<AssetEditor, { type: "setArchive" | "note" }> }) {
  const { t, pending } = dialog;
  const [reason, setReason] = useState("");
  const archived = editor.asset.archivedAt === null;
  const note = editor.type === "note";
  const version = assetVersion(editor.asset);
  const intent: AssetIntent = note
    ? { type: "note", ...version, reason }
    : { type: "setArchive", ...version, archived, reason };
  return (
    <CommandDialog
      dialog={dialog}
      title={note ? t.note : archived ? t.archive : t.reinstate}
      description={
        note ? t.noteDescription : archived ? t.archiveDescription : t.reinstateDescription
      }
      intent={intent}
    >
      <p className="break-words text-sm font-medium">
        <bdi>{editor.asset.name}</bdi>
      </p>
      <ReasonInput
        label={note ? t.noteText : t.reason}
        pending={pending}
        value={reason}
        change={setReason}
      />
    </CommandDialog>
  );
}

type FieldDefinitionDraft = Omit<AssetField, "options" | "defaultValue"> & {
  optionsText: string;
  input: string;
  existing: boolean;
};

function CategoryFieldEditor({
  field,
  update,
  remove,
  pending,
  t,
}: {
  field: FieldDefinitionDraft;
  update: (changes: Partial<FieldDefinitionDraft>) => void;
  remove: () => void;
  pending: boolean;
  t: EditorWords;
}) {
  const requiredId = useId();
  const choicesHelpId = useId();
  const options = field.type === "choice" ? fieldLines(field.optionsText) : [];
  const validChoices = uniqueAssetKeys(options);

  return (
    <div className="space-y-3 rounded-md border bg-background p-3" data-asset-field>
      <div className="grid gap-3 sm:grid-cols-2">
        <SalesInput
          label={t.fieldLabel}
          value={field.label}
          required
          disabled={pending}
          maxLength={80}
          onChange={(event) => update({ label: event.target.value })}
        />
        <EditorSelect
          label={t.fieldType}
          value={field.type}
          options={assetFieldTypes.map((value) => ({ value, label: t[value] }))}
          disabled={pending || field.existing}
          onChange={(next) => {
            const type = assetFieldTypes.find((value) => value === next);
            if (type !== undefined) update({ type, optionsText: "", input: "" });
          }}
        />
      </div>
      {field.type === "choice" && (
        <div className="space-y-1">
          <SalesTextarea
            label={t.fieldOptions}
            value={field.optionsText}
            required
            disabled={pending}
            rows={3}
            aria-describedby={choicesHelpId}
            onChange={(event) => update({ optionsText: event.target.value })}
          />
          <p id={choicesHelpId} className="text-xs text-muted-foreground">
            {t.optionsHint}
          </p>
        </div>
      )}
      <AssetFieldInput
        field={{ type: field.type, options: validChoices ? options : [] }}
        label={t.defaultValue}
        required={false}
        pending={pending}
        value={field.input}
        change={(input) => update({ input })}
        t={t}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CatalogCheckbox
          id={requiredId}
          label={t.fieldRequired}
          checked={field.required}
          disabled={pending}
          change={(required) => update({ required })}
        />
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove}>
          <X aria-hidden="true" /> {t.removeField}
        </Button>
      </div>
    </div>
  );
}

function CategoryEditor({
  siteId,
  category,
  ...dialog
}: EditorProps & { siteId: string; category: AssetCategory | undefined }) {
  const { t, preferences, pending } = dialog;
  const [name, setName] = useState(category?.name ?? "");
  const [fields, setFields] = useState<FieldDefinitionDraft[]>(() =>
    (category?.fields ?? []).map(({ options, defaultValue, ...field }) => ({
      ...field,
      optionsText: options.join("\n"),
      input: toFieldInput(defaultValue, preferences),
      existing: true,
    })),
  );
  const locale = localeTagForFormatting(preferences);
  const definitions = fields.flatMap(({ id, label, type, required, optionsText, input }) => {
    const options = type === "choice" ? fieldLines(optionsText) : [];
    const defaultValue = parseFieldInput({ type, options }, input, locale);
    return defaultValue === undefined ? [] : [{ id, label, type, options, required, defaultValue }];
  });
  const intent: AssetIntent | null =
    definitions.length === fields.length && validAssetFields(definitions)
      ? {
          type: "saveCategory",
          siteId,
          categoryId: category?.id ?? null,
          version: category?.version ?? null,
          name,
          fields: definitions,
        }
      : null;

  function addField() {
    setFields([
      ...fields,
      {
        id: crypto.randomUUID(),
        label: "",
        type: "text",
        required: false,
        optionsText: "",
        input: "",
        existing: false,
      },
    ]);
  }

  return (
    <CommandDialog
      dialog={dialog}
      title={category === undefined ? t.createCategory : t.updateCategory}
      description={t.categoryDescription}
      intent={intent}
    >
      <SalesInput
        label={t.categoryName}
        value={name}
        required
        disabled={pending}
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t.fieldValues}</legend>
        {fields.map((field) => (
          <CategoryFieldEditor
            key={field.id}
            field={field}
            pending={pending}
            update={(changes) =>
              setFields((previous) =>
                previous.map((entry) => (entry.id === field.id ? { ...entry, ...changes } : entry)),
              )
            }
            remove={() => setFields((previous) => previous.filter(({ id }) => id !== field.id))}
            t={t}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || fields.length === 32}
          onClick={addField}
        >
          <Plus aria-hidden="true" /> {t.addField}
        </Button>
      </fieldset>
    </CommandDialog>
  );
}

function ModelEditor({
  siteId,
  model,
  workspace,
  ...dialog
}: EditorProps & { siteId: string; model: AssetModel | undefined; workspace: AssetsWorkspace }) {
  const { t, preferences, pending } = dialog;
  const categories = workspace.categories.filter((record) => record.siteId === siteId);
  const [draft, setDraft] = useState(() => detailsDraft(categories, preferences, model));
  const values = readDetails(draft, categories, localeTagForFormatting(preferences));
  const intent: AssetIntent | null =
    values === null
      ? null
      : {
          type: "saveModel",
          siteId,
          modelId: model?.id ?? null,
          version: model?.version ?? null,
          ...values,
        };
  return (
    <CommandDialog
      dialog={dialog}
      title={model === undefined ? t.createModel : t.updateModel}
      description={t.modelDescription}
      intent={intent}
    >
      <AssetDetailsFields
        {...{ categories, draft, pending, t, preferences }}
        model
        change={setDraft}
      />
    </CommandDialog>
  );
}

export function AssetEditorDialog({ editor, workspace, ...dialog }: AssetEditorDialogProps) {
  const preferences = useLocalePreferences();
  const props = { ...dialog, preferences, t: assetEditorMessages[preferences.locale] };
  switch (editor.type) {
    case "create":
      return (
        <RecordEditor {...props} key={editor.siteId} siteId={editor.siteId} workspace={workspace} />
      );
    case "update":
      return (
        <RecordEditor
          {...props}
          key={editor.asset.id}
          siteId={editor.asset.siteId}
          asset={editor.asset}
          workspace={workspace}
        />
      );
    case "createFleet":
      return (
        <FleetEditor {...props} key={editor.siteId} siteId={editor.siteId} workspace={workspace} />
      );
    case "move":
      return (
        editor.asset.tracking === "individual" && (
          <MoveEditor {...props} key={editor.asset.id} asset={editor.asset} workspace={workspace} />
        )
      );
    case "changePool":
      return (
        editor.asset.tracking !== "individual" && (
          <PoolEditor {...props} key={editor.asset.id} asset={editor.asset} workspace={workspace} />
        )
      );
    case "setArchive":
    case "note":
      return (
        <LifecycleEditor {...props} key={`${editor.type}-${editor.asset.id}`} editor={editor} />
      );
    case "saveCategory":
      return (
        <CategoryEditor
          {...props}
          key={editor.category?.id ?? editor.siteId}
          siteId={editor.siteId}
          category={editor.category}
        />
      );
    case "saveModel":
      return (
        <ModelEditor
          {...props}
          key={editor.model?.id ?? editor.siteId}
          siteId={editor.siteId}
          model={editor.model}
          workspace={workspace}
        />
      );
  }
}
