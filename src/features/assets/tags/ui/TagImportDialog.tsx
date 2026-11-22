"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { CatalogEditorDialog, CatalogField } from "@/features/inventory/catalog/ui/CatalogFields";
import type { AssetTagRecord, AssetTagSite, AssetTagTarget } from "../contracts";
import { parseLegacyTagIdentifier, previewLegacyTagCsv } from "../legacyImport";
import { type TagDialogState, targetKey } from "./TagEditors";
import type { AssetTagWords } from "./tagMessages";

const maximumCsvBytes = 64 * 1024;

export function TagImportDialog({
  site,
  tags,
  targets,
  state,
  words: t,
}: {
  site: AssetTagSite;
  tags: AssetTagRecord[];
  targets: AssetTagTarget[];
  state: TagDialogState;
  words: AssetTagWords;
}) {
  const titleId = useId();
  const originId = useId();
  const fileId = useId();
  const csvId = useId();
  const helpId = useId();
  const originHelp = useId();
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState("");
  const [raw, setRaw] = useState("");
  const [fileError, setFileError] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const reading = useRef(0);
  const [preview, setPreview] = useState<ReturnType<typeof previewLegacyTagCsv> | null>(null);
  const approvedLegacyOrigin = origin.trim() || null;
  const available = new Map(
    targets.filter(({ canManage }) => canManage).map((target) => [targetKey(target), target]),
  );
  const assigned = new Set(
    tags.flatMap(({ assignment }) => (assignment === null ? [] : [targetKey(assignment.target)])),
  );
  const imported = new Set(tags.flatMap(({ legacy }) => (legacy === null ? [] : [legacy.id])));
  const rows =
    preview?.ok === true
      ? preview.rows.map((row) => {
          const key = targetKey(row.target);
          const target = available.get(key);
          const id = parseLegacyTagIdentifier(row.identifier, approvedLegacyOrigin)?.id;
          let error = null;
          if (target === undefined) error = t.csvTarget;
          else if (assigned.has(key)) error = t.csvAssigned;
          else if (id !== undefined && imported.has(id)) error = t.csvDuplicate;
          return {
            ...row,
            targetDisplay: target,
            error,
          };
        })
      : [];
  const valid = title.trim() !== "" && rows.length > 0 && rows.every(({ error }) => error === null);
  const pending = state.pending || readingFile;

  async function readCsv(file: File) {
    const current = ++reading.current;
    setReadingFile(true);
    setFileError(false);
    setPreview(null);
    try {
      if (file.size > maximumCsvBytes) {
        setFileError(true);
        return;
      }
      const content = await file.text();
      if (reading.current === current) setRaw(content);
    } catch {
      if (reading.current === current) setFileError(true);
    } finally {
      if (reading.current === current) setReadingFile(false);
    }
  }

  function save() {
    if (!valid) return;
    state.save({
      type: "importLegacy",
      siteId: site.id,
      title: title.trim(),
      approvedLegacyOrigin,
      entries: rows.map(({ identifier, target }) => ({ identifier, target })),
    });
  }

  return (
    <CatalogEditorDialog
      title={t.import}
      description={t.importDescription}
      pending={pending}
      error={state.error}
      close={state.close}
      restoreFocus={state.restoreFocus}
      submit={save}
      submitDisabled={!valid}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField id={titleId} label={t.batchTitle}>
          <Input
            id={titleId}
            value={title}
            maxLength={100}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </CatalogField>
        <CatalogField id={originId} label={t.legacyOrigin}>
          <Input
            id={originId}
            value={origin}
            maxLength={240}
            dir="ltr"
            type="url"
            disabled={pending}
            aria-describedby={originHelp}
            onChange={(event) => {
              setOrigin(event.target.value);
              setPreview(null);
            }}
          />
          <p id={originHelp} className="text-xs text-muted-foreground">
            {t.legacyOriginHint}
          </p>
        </CatalogField>
      </div>
      <CatalogField id={fileId} label={t.csvFile}>
        <Input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void readCsv(file);
            event.target.value = "";
          }}
        />
        {fileError && (
          <p role="alert" className="text-sm text-destructive">
            {t.csvFileError}
          </p>
        )}
      </CatalogField>
      <CatalogField id={csvId} label={t.csvText}>
        <Textarea
          id={csvId}
          value={raw}
          dir="ltr"
          rows={5}
          maxLength={maximumCsvBytes}
          disabled={pending}
          aria-describedby={helpId}
          className="font-mono"
          onChange={(event) => {
            setRaw(event.target.value);
            setPreview(null);
            setFileError(false);
          }}
        />
        <p id={helpId} className="text-xs text-muted-foreground">
          {t.csvInstructions}
        </p>
      </CatalogField>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || raw.trim() === ""}
        onClick={() => setPreview(previewLegacyTagCsv(raw, approvedLegacyOrigin))}
      >
        {t.preview}
      </Button>
      {preview?.ok === false && (
        <ul
          role="alert"
          className="space-y-1 rounded-md border border-destructive/30 p-2.5 text-sm text-destructive"
        >
          {preview.errors.map(({ row, error }) => (
            <li key={`${row}:${error}`} data-tag-import-error={row}>
              {t.row} {row} · {t[error === "empty" ? "emptyCsv" : error]}
            </li>
          ))}
        </ul>
      )}
      {preview?.ok === true && (
        <div className="space-y-2">
          {rows.every(({ error }) => error === null) && (
            <p role="status" className="text-sm text-muted-foreground">
              {t.csvReady.replace("{count}", String(rows.length))}
            </p>
          )}
          <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
            {rows.map(({ row, identifier, targetDisplay, error }) => (
              <li
                key={row}
                data-tag-import-row={row}
                className="grid gap-1 p-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3"
              >
                <span className="text-muted-foreground">
                  {t.row} {row}
                </span>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <bdi dir="ltr" className="font-mono text-xs">
                    {identifier}
                  </bdi>
                  {targetDisplay !== undefined && (
                    <p>
                      <bdi>{targetDisplay.title}</bdi>
                    </p>
                  )}
                  {error !== null && (
                    <p role="alert" className="text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CatalogEditorDialog>
  );
}
