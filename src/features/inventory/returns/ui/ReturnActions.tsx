"use client";

import { type ReactNode, useState } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { CatalogEditorDialog, CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import {
  SalesInput as ReturnInput,
  SalesTextarea as ReturnTextarea,
} from "../../sales/ui/SalesFields";
import {
  type ReturnCommercialKind,
  type ReturnCondition,
  type ReturnDispositionKind,
  type ReturnsWorkspace,
  returnCommercialKinds,
  returnConditions,
  returnDispositions,
} from "../contracts";
import { returnPartLabel, useReturnDisplay } from "./display";
import type { ReturnMessages } from "./messages";
import {
  type ReturnDialog,
  type ReturnEditor,
  type ReturnIntent,
  returnCaseVersion,
  validReturnIntent,
} from "./types";

type ActionEditor = Exclude<ReturnEditor, { type: "saveDraft" }>;
type EditorProps<T extends ActionEditor["type"]> = {
  editor: Extract<ActionEditor, { type: T }>;
  workspace: ReturnsWorkspace;
  dialog: ReturnDialog;
  t: ReturnMessages;
};

function CommandDialog({
  intent,
  dialog,
  title,
  description,
  disabled = false,
  children,
}: {
  intent: ReturnIntent | null;
  dialog: ReturnDialog;
  title: string;
  description: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <CatalogEditorDialog
      {...dialog}
      title={title}
      description={description}
      submitDisabled={disabled || intent === null || !validReturnIntent(intent)}
      submit={() => {
        if (intent !== null) dialog.save(intent);
      }}
    >
      {children}
    </CatalogEditorDialog>
  );
}

type Lifecycle = Exclude<ActionEditor["type"], "receive" | "disposition" | "commercial">;

const lifecycleText = {
  issue: ["issue", "issueDescription"],
  hold: ["hold", "holdDescription"],
  resume: ["resume", "resumeDescription"],
  duplicate: ["duplicate", "duplicateDescription"],
  cancel: ["cancelReturn", "cancelDescription"],
  complete: ["complete", "completeDescription"],
} satisfies Record<Lifecycle, [keyof ReturnMessages, keyof ReturnMessages]>;

function LifecycleDialog({ editor, dialog, t }: EditorProps<Lifecycle>) {
  const [value, setValue] = useState("");
  const base = returnCaseVersion(editor.detail);
  const type = editor.type;
  const [title, description] = lifecycleText[type];
  const intent: ReturnIntent =
    type === "duplicate"
      ? { ...base, type, reference: value }
      : type === "hold" || type === "resume" || type === "cancel"
        ? { ...base, type, reason: value }
        : { ...base, type };
  return (
    <CommandDialog {...{ intent, dialog }} title={t[title]} description={t[description]}>
      <p className="text-sm font-medium">
        <bdi>{editor.detail.reference}</bdi>
      </p>
      {type === "duplicate" && (
        <ReturnInput
          label={t.reference}
          maxLength={80}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          disabled={dialog.pending}
        />
      )}
      {(type === "hold" || type === "resume" || type === "cancel") && (
        <ReturnTextarea
          label={t.reason}
          rows={2}
          maxLength={400}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          disabled={dialog.pending}
        />
      )}
    </CommandDialog>
  );
}

function ReceiveDialog({ editor, workspace, dialog, t }: EditorProps<"receive">) {
  const { detail, line } = editor;
  const bins = workspace.bins.filter(({ siteId }) => siteId === detail.siteId);
  const [locationId, setLocationId] = useState(bins.length === 1 ? (bins[0]?.id ?? "") : "");
  const [quantity, setQuantity] = useState("1");
  const [serial, setSerial] = useState("");
  const [condition, setCondition] = useState<ReturnCondition | "">("");
  const [note, setNote] = useState("");
  const f = useReturnDisplay();
  const remaining = line.quantity - line.received;
  const intent: ReturnIntent | null =
    condition === ""
      ? null
      : {
          ...returnCaseVersion(detail),
          type: "receive",
          lineId: line.id,
          locationId,
          quantity: Number(quantity),
          serial: line.serial === null ? null : serial,
          condition,
          note: note.trim() === "" ? null : note,
        };
  const disabled = !bins.some(({ id }) => id === locationId) || Number(quantity) > remaining;
  return (
    <CommandDialog
      {...{ intent, dialog, disabled }}
      title={t.receive}
      description={t.receiveDescription}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <bdi className="font-medium">{returnPartLabel(line)}</bdi>
        <span className="text-muted-foreground">
          {t.remaining} {f.quantity(remaining)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField label={t.bin}>
          <CatalogSelect
            ariaLabel={t.bin}
            value={locationId}
            options={bins.map(({ id, code, name }) => ({ value: id, label: `${name} · ${code}` }))}
            onChange={setLocationId}
            disabled={dialog.pending}
          />
        </CatalogField>
        <ReturnInput
          label={t.quantity}
          type="number"
          min={1}
          max={remaining}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          readOnly={line.serial !== null}
          required
          disabled={dialog.pending}
        />
        {line.serial !== null && (
          <ReturnInput
            label={t.serial}
            value={serial}
            maxLength={120}
            onChange={(event) => setSerial(event.target.value)}
            autoComplete="off"
            required
            disabled={dialog.pending}
          />
        )}
        <CatalogField label={t.condition}>
          <CatalogSelect
            ariaLabel={t.condition}
            value={condition}
            options={returnConditions.map((value) => ({ value, label: t[value] }))}
            onChange={(next) =>
              setCondition(returnConditions.find((value) => value === next) ?? "")
            }
            disabled={dialog.pending}
          />
        </CatalogField>
      </div>
      <ReturnTextarea
        label={t.conditionNote}
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

function DispositionDialog({ editor, dialog, t }: EditorProps<"disposition">) {
  const [kind, setKind] = useState<ReturnDispositionKind | "">("");
  const [reason, setReason] = useState("");
  const possible = returnDispositions.filter(
    (value) => value !== "repair" || editor.receipt.physical !== "repair",
  );
  const intent: ReturnIntent | null =
    kind === ""
      ? null
      : {
          ...returnCaseVersion(editor.detail),
          type: "disposition",
          receiptId: editor.receipt.id,
          kind,
          reason,
        };
  return (
    <CommandDialog {...{ intent, dialog }} title={t.dispose} description={t.disposeDescription}>
      <CatalogField label={t.dispositions}>
        <CatalogSelect
          ariaLabel={t.dispositions}
          value={kind}
          options={possible.map((value) => ({ value, label: t[value] }))}
          onChange={(next) => setKind(possible.find((value) => value === next) ?? "")}
          disabled={dialog.pending}
        />
      </CatalogField>
      <ReturnTextarea
        label={t.reason}
        rows={2}
        maxLength={400}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

function CommercialDialog({ editor, workspace, dialog, t }: EditorProps<"commercial">) {
  const [kind, setKind] = useState<ReturnCommercialKind | "">("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const locale = localeTagForFormatting(useLocalePreferences());
  const f = useReturnDisplay();
  const shipmentLineId = editor.detail.lines.find(({ receipts }) =>
    receipts.some(({ id }) => id === editor.receipt.id),
  )?.shipmentLineId;
  const unitPrice =
    workspace.source?.lines.find(({ id }) => id === shipmentLineId)?.unitPrice ?? null;
  const currency = editor.detail.currency;
  const intent: ReturnIntent | null =
    kind === ""
      ? null
      : {
          ...returnCaseVersion(editor.detail),
          type: "commercial",
          receiptId: editor.receipt.id,
          kind,
          amount: kind === "refund" ? (normalizeNumberInput(amount, locale) ?? "") : null,
          reference: reference.trim() === "" ? null : reference,
          reason,
        };
  return (
    <CommandDialog
      {...{ intent, dialog }}
      title={t.commercial}
      description={t.commercialDescription}
    >
      <CatalogField label={t.commercial}>
        <CatalogSelect
          ariaLabel={t.commercial}
          value={kind}
          options={returnCommercialKinds.map((value) => ({ value, label: t[value] }))}
          onChange={(next) => setKind(returnCommercialKinds.find((value) => value === next) ?? "")}
          disabled={dialog.pending}
        />
      </CatalogField>
      {kind === "refund" && (
        <>
          <ReturnInput
            label={t.amount}
            inputMode="decimal"
            value={amount}
            maxLength={32}
            onChange={(event) => setAmount(event.target.value)}
            required
            disabled={dialog.pending}
          />
          {unitPrice !== null && currency !== null && (
            <p className="text-sm text-muted-foreground">
              {t.refundLimit} <bdi>{f.amount(unitPrice, currency)}</bdi>
            </p>
          )}
        </>
      )}
      <ReturnInput
        label={t.commercialReference}
        value={reference}
        maxLength={80}
        onChange={(event) => setReference(event.target.value)}
        disabled={dialog.pending}
      />
      <ReturnTextarea
        label={t.reason}
        value={reason}
        rows={2}
        maxLength={400}
        onChange={(event) => setReason(event.target.value)}
        required
        disabled={dialog.pending}
      />
    </CommandDialog>
  );
}

export function ReturnActions({ editor, workspace, dialog, t }: EditorProps<ActionEditor["type"]>) {
  switch (editor.type) {
    case "receive":
      return <ReceiveDialog {...{ editor, workspace, dialog, t }} />;
    case "disposition":
      return <DispositionDialog {...{ editor, workspace, dialog, t }} />;
    case "commercial":
      return <CommercialDialog {...{ editor, workspace, dialog, t }} />;
    case "issue":
    case "hold":
    case "resume":
    case "duplicate":
    case "cancel":
    case "complete":
      return <LifecycleDialog {...{ editor, workspace, dialog, t }} />;
  }
}
