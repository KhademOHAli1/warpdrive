"use client";

import { type RefObject, useRef, useState } from "react";
import { BulkActionBar } from "@/components/data-table/BulkActionBar";
import { Button } from "@/components/ui/Button";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import type { AssetRecord, AssetsWorkspace } from "../../contracts";
import { EditorSelect } from "../../ui/AssetEditorFields";
import type { AssetWords } from "../../ui/assetMessages";
import {
  type AssetRegisterBatchInput,
  type AssetRegisterBatchIntent,
  type AssetRegisterBatchOutcome,
  type AssetRegisterBatchResult,
  type AssetRegisterDiscoveryAccess,
  maxAssetRegisterSelection,
} from "../contracts";
import { DiscoveryDialog } from "./DiscoveryDialog";
import type { DiscoveryWords } from "./messages";

type BatchError = Extract<AssetRegisterBatchResult, { ok: false }>["error"] | "transport";
type Selection = AssetRegisterBatchInput["selection"];
type BatchEditor = { siteId: string; selection: Selection; codes: Record<string, string> };
const emptySelection = new Set<string>();
const operations = ["setModel", "setCategory", "addTags", "removeTags"] as const;
const clear = "clear";

export function useAssetRegisterBatch({
  access,
  siteId,
  inFlightRef,
  onWorkspace,
}: {
  access?: AssetRegisterDiscoveryAccess;
  siteId: string | null;
  inFlightRef: RefObject<boolean>;
  onWorkspace: (next: AssetsWorkspace) => void;
}) {
  const [mode, setMode] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(emptySelection);
  const [editor, setEditor] = useState<BatchEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BatchError | null>(null);
  const [results, setResults] = useState<{
    scope: string;
    outcomes: AssetRegisterBatchOutcome[];
    codes: Record<string, string>;
  } | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const permitted = access !== undefined && siteId !== null;
  const selecting = permitted && mode === siteId;

  function clearSelection() {
    setSelected(emptySelection);
    setResults(null);
  }

  function toggle() {
    if (!permitted || inFlightRef.current) return;
    setMode(selecting ? null : siteId);
    clearSelection();
  }

  function selectMany(ids: string[], checked: boolean) {
    if (!selecting || inFlightRef.current) return;
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (!checked) next.delete(id);
        else if (next.size < maxAssetRegisterSelection) next.add(id);
      }
      return next;
    });
    setResults(null);
  }

  function open(records: AssetRecord[]) {
    if (!selecting || inFlightRef.current) return;
    const selectedRows = records.filter(
      (record) => selected.has(record.id) && record.siteId === siteId && record.archivedAt === null,
    );
    if (selectedRows.length === 0) return;
    setError(null);
    setEditor({
      siteId,
      selection: selectedRows.map(({ id, version }) => ({ assetId: id, version })),
      codes: Object.fromEntries(selectedRows.map(({ id, code }) => [id, code])),
    });
  }

  async function save(intent: AssetRegisterBatchIntent) {
    if (access === undefined || editor === null || editor.siteId !== siteId || inFlightRef.current)
      return;
    const payload = { siteId: editor.siteId, selection: editor.selection, intent };
    const key = JSON.stringify(payload);
    const requestId = attempt.current?.key === key ? attempt.current.id : crypto.randomUUID();
    inFlightRef.current = true;
    attempt.current = { key, id: requestId };
    setPending(true);
    setError(null);
    try {
      const response = await access.batch({ ...payload, requestId });
      attempt.current = null;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      onWorkspace(response.workspace);
      setResults({ scope: editor.siteId, outcomes: response.outcomes, codes: editor.codes });
      setEditor(null);
    } catch {
      setError("transport");
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return {
    permitted,
    selecting,
    pending,
    error,
    toggle,
    selectMany,
    open,
    save,
    clearSelection,
    selected: selecting ? selected : emptySelection,
    editor: permitted && editor?.siteId === siteId ? editor : null,
    results: permitted && results?.scope === siteId ? results : null,
    close: () => {
      if (!inFlightRef.current) setEditor(null);
    },
  };
}

export type AssetRegisterBatchState = ReturnType<typeof useAssetRegisterBatch>;

function makeIntent(type: string, value: string): AssetRegisterBatchIntent | null {
  if (type === "setModel")
    return value === "" ? null : { type, modelId: value === clear ? null : value };
  if (type === "setCategory")
    return value === "" ? null : { type, categoryId: value === clear ? null : value };
  if (type !== "addTags" && type !== "removeTags") return null;
  const tags = [
    ...new Set(
      value
        .split(/[,،]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length === 0 || tags.length > 20 || tags.some((tag) => tag.length > 40)) return null;
  return { type, tags };
}

function BatchEditDialog({
  editor,
  state,
  workspace,
  restoreFocus,
  assetWords: a,
  words: t,
}: {
  editor: BatchEditor;
  state: AssetRegisterBatchState;
  workspace: AssetsWorkspace;
  restoreFocus: () => void;
  assetWords: AssetWords;
  words: DiscoveryWords;
}) {
  const [type, setType] = useState("");
  const [value, setValue] = useState("");
  const intent = makeIntent(type, value);
  const choice =
    type === "setModel"
      ? { values: workspace.models, label: a.model, clear: t.noModel }
      : type === "setCategory"
        ? { values: workspace.categories, label: a.category, clear: t.noCategory }
        : null;
  return (
    <DiscoveryDialog
      kind="batch"
      title={t.editSelected}
      description={t.batchDescription}
      pending={state.pending}
      disabled={intent === null}
      error={state.error === null ? null : t[state.error]}
      cancelLabel={t.cancel}
      submitLabel={t.apply}
      close={state.close}
      restoreFocus={restoreFocus}
      submit={() => {
        if (intent !== null) void state.save(intent);
      }}
    >
      <div className="space-y-3">
        <ul
          aria-label={a.register}
          className="max-h-24 space-y-1 overflow-y-auto rounded-md border p-2 text-sm"
        >
          {editor.selection.map(({ assetId }) => (
            <li key={assetId}>
              <bdi dir="auto">{editor.codes[assetId]}</bdi>
            </li>
          ))}
        </ul>
        <EditorSelect
          label={t.operation}
          value={type}
          disabled={state.pending}
          options={[
            { value: "", label: t.choose },
            ...operations.map((value) => ({ value, label: t[value] })),
          ]}
          onChange={(next) => {
            setType(next);
            setValue("");
          }}
        />
        {choice !== null && (
          <EditorSelect
            label={choice.label}
            value={value}
            disabled={state.pending}
            options={[
              { value: "", label: t.choose },
              { value: clear, label: choice.clear },
              ...choice.values
                .filter(({ siteId }) => siteId === editor.siteId)
                .map(({ id, name }) => ({ value: id, label: name })),
            ]}
            onChange={setValue}
          />
        )}
        {(type === "addTags" || type === "removeTags") && (
          <SalesInput
            data-asset-bulk-tags
            label={a.tags}
            placeholder={t.tagHelp}
            value={value}
            maxLength={830}
            disabled={state.pending}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        )}
      </div>
    </DiscoveryDialog>
  );
}

export function AssetRegisterBulkActions({
  state,
  records,
  workspace,
  busy,
  fallbackFocus,
  assetWords,
  words: t,
}: {
  state: AssetRegisterBatchState;
  records: AssetRecord[];
  workspace: AssetsWorkspace;
  busy: boolean;
  fallbackFocus: () => void;
  assetWords: AssetWords;
  words: DiscoveryWords;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedCount = records.filter(({ id }) => state.selected.has(id)).length;
  return (
    <>
      {state.selecting && selectedCount > 0 && (
        <BulkActionBar count={selectedCount} onClear={state.clearSelection}>
          <Button
            ref={trigger}
            size="sm"
            variant="outline"
            disabled={busy}
            data-asset-bulk-open
            onClick={() => state.open(records)}
          >
            {t.editSelected}
          </Button>
        </BulkActionBar>
      )}
      {state.results !== null && (
        <section
          aria-label={t.results}
          data-asset-bulk-outcomes
          className="min-w-0 rounded-lg border bg-card p-3"
        >
          <h3 className="text-sm font-semibold">{t.results}</h3>
          <ul className="mt-1 divide-y">
            {state.results.outcomes.map((outcome) => (
              <li
                key={outcome.assetId}
                data-asset-bulk-state={outcome.state}
                data-asset-bulk-reason={outcome.reason}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm"
              >
                <bdi dir="auto" className="font-medium">
                  {state.results?.codes[outcome.assetId]}
                </bdi>
                <span>{t[outcome.state]}</span>
                {outcome.state !== "unavailable" && (
                  <span className="text-muted-foreground">{t[outcome.reason]}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {state.editor !== null && (
        <BatchEditDialog
          editor={state.editor}
          state={state}
          workspace={workspace}
          assetWords={assetWords}
          words={t}
          restoreFocus={() => {
            if (trigger.current?.isConnected === true) trigger.current.focus();
            else fallbackFocus();
          }}
        />
      )}
    </>
  );
}
