"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import type { EquipmentAuditDetail, EquipmentAuditIntent, EquipmentAuditRow } from "../contracts";
import { AuditCommandDialog, AuditDialog, type AuditDialogState } from "./AuditDialog";
import { type AuditEditor, auditPhotoAllowed, auditPhotoTypes, equipmentLabel } from "./auditView";
import type { AuditWords } from "./messages";

type Action =
  | Extract<AuditEditor, { type: "undo" }>
  | { type: "note"; row: EquipmentAuditRow | null }
  | { type: "start" | "complete" | "cancel" | "archive" | "review" };
type StateProps = { detail: EquipmentAuditDetail; state: AuditDialogState; words: AuditWords };

function task(action: Action, detail: EquipmentAuditDetail, text: string): EquipmentAuditIntent {
  const context = { auditId: detail.id, version: detail.version };
  const note = text.trim() || null;
  switch (action.type) {
    case "undo":
      return { ...context, type: "undo", rowId: action.row.id, reason: text.trim() };
    case "note":
      return { ...context, type: "note", rowId: action.row?.id ?? null, note: text.trim() };
    case "archive":
      return { ...context, type: "archive", archived: !detail.archived };
    case "start":
      return { ...context, type: "start" };
    case "cancel":
    case "complete":
    case "review":
      return { ...context, type: action.type, note };
  }
}

function prompt({ type }: Action, detail: EquipmentAuditDetail, t: AuditWords) {
  switch (type) {
    case "undo":
      return { title: t.undo, description: t.undoIntro, field: t.reason, required: true };
    case "note":
      return { title: t.addNote, description: t.noteIntro, field: t.note, required: true };
    case "start":
      return { title: t.start, description: t.startIntro, field: "" };
    case "complete":
      return { title: t.complete, description: t.completeIntro, field: t.optionalNote };
    case "cancel":
      return { title: t.cancelAudit, description: t.cancelIntro, field: t.optionalNote };
    case "archive":
      return {
        title: detail.archived ? t.restore : t.archive,
        description: t.archiveIntro,
        field: "",
      };
    case "review":
      return { title: t.review, description: t.reviewIntro, field: t.optionalNote };
  }
}

export function AuditTaskDialog({
  action,
  detail,
  state,
  words: t,
}: StateProps & { action: Action }) {
  const [text, setText] = useState("");
  const intent = task(action, detail, text);
  const { title, description, field, required } = prompt(action, detail, t);
  const row = "row" in action ? action.row : null;
  return (
    <AuditCommandDialog
      type={action.type}
      {...{ title, description, state, intent }}
      label={title}
      words={t}
    >
      {row !== null && (
        <p className="text-sm wrap-anywhere">
          <bdi>{equipmentLabel(row, t)}</bdi>
        </p>
      )}
      {action.type === "complete" && (
        <div data-audit-completion-preview className="space-y-2 rounded-md border p-3 text-sm">
          <p>{detail.progress.outstandingRows > 0 ? t.completeMissing : t.completeAll}</p>
          <div className="flex flex-wrap gap-3">
            <span>
              {t.found} <bdi>{detail.progress.foundRows}</bdi>
            </span>
            <span>
              {t.missing} <bdi>{detail.progress.outstandingRows}</bdi>
            </span>
            <span>
              {t.missingUnits}{" "}
              <bdi>{detail.progress.expectedUnits - detail.progress.foundUnits}</bdi>
            </span>
            <span>
              {t.unexpected} <bdi>{detail.progress.unexpectedRows}</bdi>
            </span>
          </div>
        </div>
      )}
      {field !== "" && (
        <SalesTextarea
          label={field}
          value={text}
          required={required}
          maxLength={800}
          rows={3}
          disabled={state.pending}
          onChange={(event) => setText(event.currentTarget.value)}
        />
      )}
    </AuditCommandDialog>
  );
}

export function AuditPhotoDialog({
  row,
  state,
  words: t,
}: Omit<StateProps, "detail"> & { row: EquipmentAuditRow | null }) {
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(
    () => () => {
      if (photo !== null) URL.revokeObjectURL(photo.preview);
    },
    [photo],
  );
  return (
    <AuditDialog
      type="attach"
      title={t.attach}
      description={t.attachIntro}
      label={t.attach}
      state={state}
      words={t}
      action={photo === null ? null : () => state.attach(photo.file, row?.id ?? null)}
    >
      {row !== null && (
        <p className="text-sm wrap-anywhere">
          <bdi>{equipmentLabel(row, t)}</bdi>
        </p>
      )}
      <SalesInput
        label={t.photoFile}
        data-audit-photo-input
        type="file"
        accept={auditPhotoTypes.join(",")}
        disabled={state.pending}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const allowed = file !== undefined && auditPhotoAllowed(file);
          setInvalid(file !== undefined && !allowed);
          setPhoto(allowed ? { file, preview: URL.createObjectURL(file) } : null);
        }}
      />
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t.photoTooLarge}
        </p>
      )}
      {photo !== null && (
        <div className="relative h-48 w-full rounded-md border bg-muted" data-audit-photo-preview>
          <Image
            unoptimized
            fill
            sizes="36rem"
            src={photo.preview}
            alt={t.photoPreview}
            className="object-contain"
          />
        </div>
      )}
    </AuditDialog>
  );
}
