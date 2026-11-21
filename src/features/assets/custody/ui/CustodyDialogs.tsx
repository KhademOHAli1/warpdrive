"use client";

import { type ReactNode, useState } from "react";
import type { SelectOption } from "@/components/ui/Select";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { CatalogEditorDialog } from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import type { AssetRecord, AssetsWorkspace } from "../../contracts";
import { EditorSelect, readQuantity, siteLocations } from "../../ui/AssetEditorFields";
import {
  type Custodian,
  type CustodyCondition,
  type CustodyHolding,
  type CustodyIntent,
  custodyConditions,
  validCustodyIntent,
} from "../contracts";
import { type CustodyWords, custodyMessages } from "./messages";

type HandoverEditor =
  | { type: "assign"; record: AssetRecord }
  | { type: "transfer" | "return"; record: AssetRecord; holding: CustodyHolding }
  | { type: "bulkAssign" | "bulkReturn"; siteId: string; records: AssetRecord[] };

type RosterEditor =
  | { type: "saveCustodian"; siteId: string; custodian?: Custodian }
  | { type: "noteCustodian"; custodian: Custodian };

export type CustodyEditor = HandoverEditor | RosterEditor;

export type CustodyOpener = (trigger: HTMLButtonElement, editor: CustodyEditor) => void;

type DialogState = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: CustodyIntent) => void;
};

type EditorProps = {
  workspace: AssetsWorkspace;
  state: DialogState;
  words: CustodyWords;
};

function CustodyDialog({
  state,
  intent,
  title,
  description,
  children,
}: {
  state: DialogState;
  intent: CustodyIntent | null;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const valid = intent !== null && validCustodyIntent(intent);
  return (
    <CatalogEditorDialog
      title={title}
      description={description}
      pending={state.pending}
      error={state.error}
      close={state.close}
      restoreFocus={state.restoreFocus}
      submitDisabled={!valid}
      submit={() => {
        if (valid) state.save(intent);
      }}
    >
      {children}
    </CatalogEditorDialog>
  );
}

function RecipientEditor({
  editor,
  workspace,
  state,
  words: t,
}: EditorProps & { editor: Extract<RosterEditor, { type: "saveCustodian" }> }) {
  const { custodian, siteId } = editor;
  const [kind, setKind] = useState<"staff" | "non_login">(custodian?.kind ?? "non_login");
  const [name, setName] = useState(custodian?.name ?? "");
  const [staffId, setStaffId] = useState(custodian?.staffId ?? "");
  const [active, setActive] = useState(custodian?.active ?? true);
  const linked = kind === "staff";
  const adding = custodian === undefined;
  const staffChoices = (workspace.custody?.staff ?? [])
    .filter(
      ({ id }) =>
        workspace.custody?.custodians.some((row) => row.siteId === siteId && row.staffId === id) !==
        true,
    )
    .map(({ id, name }) => ({ value: id, label: name }));
  const intent: CustodyIntent | null =
    linked && adding && staffId === ""
      ? null
      : {
          type: "saveCustodian",
          siteId,
          custodianId: custodian?.id ?? null,
          version: custodian?.version ?? null,
          staffId: linked ? staffId || null : null,
          name: linked ? null : name.trim(),
          active,
        };

  return (
    <CustodyDialog
      state={state}
      intent={intent}
      title={adding ? t.addCustodian : t.editCustodian}
      description={adding ? t.custodianIntro : t.editCustodianIntro}
    >
      {adding && (
        <EditorSelect
          label={t.type}
          value={kind}
          disabled={state.pending}
          options={[
            { value: "non_login", label: t.named },
            { value: "staff", label: t.staff },
          ]}
          onChange={(next) => setKind(next === "staff" ? "staff" : "non_login")}
        />
      )}
      {linked ? (
        adding ? (
          <EditorSelect
            label={t.staffMember}
            value={staffId}
            placeholder={t.chooseStaff}
            disabled={state.pending}
            options={staffChoices}
            onChange={setStaffId}
          />
        ) : (
          <p className="text-sm font-medium">
            <bdi>{custodian.name}</bdi>
          </p>
        )
      ) : (
        <SalesInput
          label={t.name}
          value={name}
          maxLength={120}
          required
          disabled={state.pending}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      )}
      <EditorSelect
        label={t.status}
        value={active ? "active" : "inactive"}
        disabled={state.pending}
        options={[
          { value: "active", label: t.active },
          { value: "inactive", label: t.inactive },
        ]}
        onChange={(next) => setActive(next === "active")}
      />
    </CustodyDialog>
  );
}

function RecipientNoteEditor({
  editor,
  state,
  words: t,
}: Omit<EditorProps, "workspace"> & {
  editor: Extract<RosterEditor, { type: "noteCustodian" }>;
}) {
  const { custodian } = editor;
  const [note, setNote] = useState("");
  return (
    <CustodyDialog
      state={state}
      title={t.noteCustodian}
      description={t.noteIntro}
      intent={{ type: "noteCustodian", custodianId: custodian.id, siteId: custodian.siteId, note }}
    >
      <p className="text-sm font-medium">
        <bdi>{custodian.name}</bdi>
      </p>
      <SalesTextarea
        label={t.note}
        value={note}
        disabled={state.pending}
        required
        rows={3}
        maxLength={400}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </CustodyDialog>
  );
}

const handoverIntro = {
  assign: "assignIntro",
  transfer: "transferIntro",
  return: "returnIntro",
  bulkAssign: "bulkAssignIntro",
  bulkReturn: "bulkReturnIntro",
} as const;

function handoverDraft({
  editor,
  locationId,
  custodianId,
  quantity,
  condition,
  note,
}: {
  editor: HandoverEditor;
  locationId: string | null;
  custodianId: string;
  quantity: number;
  condition: CustodyCondition;
  note: string | null;
}): CustodyIntent {
  const handover = { locationId, condition, note };
  if ("records" in editor) {
    const bulk = {
      ...handover,
      siteId: editor.siteId,
      assets: editor.records.map(({ id, version }) => ({ assetId: id, version })),
    };
    return editor.type === "bulkAssign"
      ? { type: "bulkAssign", ...bulk, custodianId }
      : { type: "bulkReturn", ...bulk };
  }
  const { id: assetId, version, siteId } = editor.record;
  const single = { ...handover, assetId, version, siteId, quantity };
  if (editor.type === "assign") return { type: "assign", ...single, custodianId };
  const holdingId = editor.holding.id;
  return editor.type === "transfer"
    ? { type: "transfer", ...single, custodianId, holdingId }
    : { type: "return", ...single, holdingId };
}

function HandoverNames({ editor, words: t }: { editor: HandoverEditor; words: CustodyWords }) {
  if ("records" in editor) {
    return (
      <ul
        data-custody-bulk-preview
        className="max-h-28 space-y-1 overflow-y-auto rounded-md border p-2.5 text-sm"
      >
        {editor.records.map(({ id, name, code }) => (
          <li key={id} className="min-w-0 [overflow-wrap:anywhere]">
            <bdi>{name}</bdi>
            <bdi className="ms-2 text-muted-foreground">{code}</bdi>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">
        <bdi>{editor.record.name}</bdi>
      </p>
      {"holding" in editor && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          <span className="me-2">{t.currentHolder}</span>
          <bdi>{editor.holding.custodianName}</bdi>
        </p>
      )}
    </div>
  );
}

function handoverLocation(
  poolAssign: boolean,
  returning: boolean,
  sourceLocations: SelectOption[],
  locations: SelectOption[],
  t: CustodyWords,
) {
  if (poolAssign) return { label: t.sourceLocation, options: sourceLocations };
  return {
    label: returning ? t.returnLocation : t.handoverLocation,
    options: [{ value: "", label: returning ? t.originalLocation : t.noLocation }, ...locations],
  };
}

function HandoverDialog({
  editor,
  workspace,
  state,
  words: t,
}: EditorProps & { editor: HandoverEditor }) {
  const preferences = useLocalePreferences();
  const { type } = editor;
  const record = "record" in editor ? editor.record : null;
  const holding = "holding" in editor ? editor.holding : null;
  const siteId = "siteId" in editor ? editor.siteId : editor.record.siteId;
  const pool = record?.tracking === "returnable_pool";
  const poolAssign = pool && type === "assign";
  const returning = type === "return" || type === "bulkReturn";
  const balances = record?.tracking === "returnable_pool" ? record.balances : [];
  const locations = siteLocations(workspace, siteId);
  const sourceLocations = locations.filter(({ value }) =>
    balances.some(({ locationId, quantity }) => locationId === value && quantity > 0),
  );
  const [location, setLocation] = useState(
    poolAssign && sourceLocations.length === 1 ? (sourceLocations[0]?.value ?? "") : "",
  );
  const [custodianId, setCustodianId] = useState("");
  const [condition, setCondition] = useState<CustodyCondition>(holding?.condition ?? "good");
  const [quantity, setQuantity] = useState(holding?.quantity.toString() ?? "1");
  const [note, setNote] = useState("");
  const recipients = (workspace.custody?.custodians ?? [])
    .filter((row) => row.siteId === siteId && row.active && row.id !== holding?.custodianId)
    .map(({ id, name }) => ({ value: id, label: name }));
  const amount = pool ? readQuantity(quantity, localeTagForFormatting(preferences)) : 1;
  const available = poolAssign
    ? (balances.find(({ locationId }) => locationId === location)?.quantity ?? 0)
    : (holding?.quantity ?? 1);
  const needsLocation = poolAssign && location === "";
  const intent =
    amount === null || amount < 1 || amount > available || needsLocation
      ? null
      : handoverDraft({
          editor,
          locationId: location || null,
          custodianId,
          quantity: amount,
          condition,
          note: note.trim() || null,
        });
  const locationSelect = handoverLocation(poolAssign, returning, sourceLocations, locations, t);

  return (
    <CustodyDialog
      state={state}
      title={t[type]}
      description={t[handoverIntro[type]]}
      intent={intent}
    >
      <HandoverNames editor={editor} words={t} />
      <div className="grid gap-3 sm:grid-cols-2">
        {!returning && (
          <EditorSelect
            label={t.custodian}
            value={custodianId}
            disabled={state.pending}
            options={recipients}
            placeholder={t.chooseCustodian}
            onChange={setCustodianId}
          />
        )}
        <EditorSelect
          label={locationSelect.label}
          value={location}
          disabled={state.pending}
          placeholder={t.chooseLocation}
          options={locationSelect.options}
          onChange={setLocation}
        />
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
        {pool && (
          <SalesInput
            label={t.quantity}
            required
            dir="ltr"
            inputMode="numeric"
            value={quantity}
            disabled={state.pending}
            maxLength={12}
            onChange={(event) => setQuantity(event.currentTarget.value)}
          />
        )}
      </div>
      {!returning && recipients.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.noActiveCustodians}</p>
      )}
      <SalesTextarea
        label={t.note}
        value={note}
        disabled={state.pending}
        rows={3}
        maxLength={400}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </CustodyDialog>
  );
}

export function CustodyEditorDialog({
  editor,
  workspace,
  state,
}: Omit<EditorProps, "words"> & {
  editor: CustodyEditor;
}) {
  const words = custodyMessages[useLocalePreferences().locale];
  if (editor.type === "saveCustodian") {
    return <RecipientEditor {...{ editor, workspace, state, words }} />;
  }
  if (editor.type === "noteCustodian") return <RecipientNoteEditor {...{ editor, state, words }} />;
  return <HandoverDialog {...{ editor, workspace, state, words }} />;
}
