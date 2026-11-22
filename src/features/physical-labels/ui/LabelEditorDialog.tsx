"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { EditorSelect } from "@/features/assets/ui/AssetEditorFields";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CatalogEditorDialog, CatalogField } from "@/features/inventory/catalog/ui/CatalogFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type LabelCommand,
  type LabelRecord,
  type LabelTarget,
  type LabelTargetKind,
  labelTargetKinds,
} from "../contracts";
import { type LabelFormat, labelFormats } from "../formats";
import type { LabelWords } from "./labelMessages";

type NoRequestId<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never;
export type LabelIntent = NoRequestId<LabelCommand>;
export type LabelEditor =
  | { type: "issue" | "registerExternal" }
  | { type: "retire"; label: LabelRecord };

export const formatNames: Record<LabelFormat, string> = {
  qr: "QR",
  code128: "Code 128",
  code39: "Code 39",
  ean13: "EAN-13",
  datamatrix: "Data Matrix",
  gs1_128: "GS1-128",
  gs1_datamatrix: "GS1 DataMatrix",
};

export function displayLabelCode(value: string) {
  return value.replaceAll("\u001d", "␝");
}

type EditorState = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  submit: (intent: LabelIntent) => void;
};

function RegisterLabelDialog({
  type,
  targets,
  state,
  words: t,
}: {
  type: "issue" | "registerExternal";
  targets: LabelTarget[];
  state: EditorState;
  words: LabelWords;
}) {
  const managed = targets.filter(({ canManage }) => canManage);
  const kinds = labelTargetKinds.filter((kind) => managed.some((target) => target.kind === kind));
  const [kind, setKind] = useState<LabelTargetKind>(() => kinds[0] ?? "asset");
  const [targetId, setTargetId] = useState("");
  const [format, setFormat] = useState<LabelFormat>("code128");
  const [value, setValue] = useState("");
  const codeId = useId();
  const eligible = managed.filter((target) => target.kind === kind);
  const chosen = eligible.find(({ id }) => id === targetId);
  const external = type === "registerExternal";

  function save() {
    if (chosen === undefined) return;
    const target = { kind: chosen.kind, id: chosen.id };
    state.submit(external ? { type: "registerExternal", target, format, value } : { type, target });
  }

  return (
    <CatalogEditorDialog
      title={external ? t.register : t.issue}
      description={external ? t.registerDescription : t.issueDescription}
      pending={state.pending}
      error={state.error}
      close={state.close}
      restoreFocus={state.restoreFocus}
      submitDisabled={chosen === undefined || (external && value.trim() === "")}
      submit={save}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <EditorSelect
          label={t.targetType}
          value={kind}
          disabled={state.pending || kinds.length === 0}
          options={kinds.map((item) => ({ value: item, label: t[item] }))}
          onChange={(raw) => {
            const next = kinds.find((item) => item === raw);
            if (next === undefined) return;
            setKind(next);
            setTargetId("");
          }}
        />
        <EditorSelect
          label={t.target}
          value={targetId}
          disabled={state.pending || eligible.length === 0}
          options={[
            { value: "", label: t.chooseTarget },
            ...eligible.map(({ id, title, subtitle }) => ({
              value: id,
              label: subtitle === null ? title : `${title} · ${subtitle}`,
            })),
          ]}
          onChange={setTargetId}
        />
      </div>
      {eligible.length === 0 && <p className="text-sm text-muted-foreground">{t.noTargets}</p>}
      {external && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <EditorSelect
            label={t.format}
            value={format}
            disabled={state.pending}
            options={labelFormats.map((item) => ({ value: item, label: formatNames[item] }))}
            onChange={(raw) => setFormat(labelFormats.find((item) => item === raw) ?? "code128")}
          />
          <CatalogField label={t.code} id={codeId}>
            <Input
              id={codeId}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              className="h-9 font-mono"
              value={value}
              disabled={state.pending}
              onChange={(event) => setValue(event.target.value)}
            />
          </CatalogField>
        </div>
      )}
    </CatalogEditorDialog>
  );
}

function RetireLabelDialog({
  label,
  state,
  words: t,
}: {
  label: LabelRecord;
  state: EditorState;
  words: LabelWords;
}) {
  const shared = useAppTranslations("shell.inline");
  return (
    <Dialog open onOpenChange={(next) => !next && !state.pending && state.close()}>
      <DialogContent
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          state.restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.retire}</DialogTitle>
          <DialogDescription>{t.retireDescription}</DialogDescription>
        </DialogHeader>
        <p className="rounded-md border bg-muted/30 p-3 text-sm [overflow-wrap:anywhere]">
          <bdi>{label.target.title}</bdi>
          <br />
          <bdi className="font-mono" dir="ltr">
            {displayLabelCode(label.value)}
          </bdi>
        </p>
        {state.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={state.pending}>
              {shared("cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={state.pending}
            onClick={() => state.submit({ type: "retire", labelId: label.id })}
          >
            {t.retire}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LabelEditorDialog({
  editor,
  targets,
  state,
  words,
}: {
  editor: LabelEditor;
  targets: LabelTarget[];
  state: EditorState;
  words: LabelWords;
}) {
  return editor.type === "retire" ? (
    <RetireLabelDialog label={editor.label} {...{ state, words }} />
  ) : (
    <RegisterLabelDialog type={editor.type} {...{ targets, state, words }} />
  );
}
