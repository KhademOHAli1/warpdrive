"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { CreatePipelineButton } from "./CreatePipelineButton";
import type { PipelineLifecycleInput, PipelineLifecycleResult } from "./lifecycleTypes";
import { PipelineDirectoryDialog } from "./PipelineDirectoryDialog";
import { PipelineDirectoryRowItem } from "./PipelineDirectoryRow";

export interface PipelineDirectoryRow {
  id: string;
  name: string;
  isArchived: boolean;
  updatedAt: string;
  stageCount: number;
  dealCount: number;
  visibility: "workspace" | "restricted";
}

export interface PipelineDirectoryProps {
  rows: PipelineDirectoryRow[];
  canManage: boolean;
  enabled: boolean;
  snapshotId?: string;
  onArchive: (input: PipelineLifecycleInput) => Promise<PipelineLifecycleResult>;
  onRestore: (input: PipelineLifecycleInput) => Promise<PipelineLifecycleResult>;
  onRefresh?: () => void;
}

export type PipelineDirectoryAction = "archive" | "restore";
export type PipelineDirectoryError =
  | Extract<PipelineLifecycleResult, { ok: false }>["error"]
  | "unconfirmed";
interface Selection {
  id: string;
  action: PipelineDirectoryAction;
}
interface LocalChange {
  updatedAt: string;
  isArchived: boolean;
}
interface Failure {
  code: PipelineDirectoryError;
  revision: string;
  snapshotId: string | null;
}

export function PipelineDirectory({
  rows,
  canManage,
  enabled,
  snapshotId,
  onArchive,
  onRestore,
  onRefresh,
}: PipelineDirectoryProps): ReactNode {
  const t = useAppTranslations("pipelineLifecycle");
  const locale = useLocale();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusTo = useRef<HTMLElement>(null);
  const outcomeSnapshot = useRef<string | null>(snapshotId ?? null);
  useEffect(() => {
    outcomeSnapshot.current = snapshotId ?? null;
  }, [snapshotId]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [changes, setChanges] = useState<Record<string, LocalChange>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [uncertain, setUncertain] = useState<Record<string, { snapshotId: string | null }>>({});
  const [notice, setNotice] = useState<{ action: PipelineDirectoryAction; name: string } | null>(
    null,
  );

  // A delayed query must not overwrite a more recent acknowledged mutation.
  const currentRows = rows.map((row) => {
    const change = changes[row.id];
    return change !== undefined && Date.parse(change.updatedAt) > Date.parse(row.updatedAt)
      ? { ...row, updatedAt: change.updatedAt, isArchived: change.isArchived }
      : row;
  });
  const selected = currentRows.find((row) => row.id === selection?.id);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visible = currentRows.filter(
    (row) =>
      row.isArchived === (status === "archived") &&
      row.name.toLocaleLowerCase(locale).includes(normalizedQuery),
  );
  const stateChanged =
    selected !== undefined &&
    selection !== null &&
    selected.isArchived !== (selection.action === "restore");
  const stale = failure?.code === "conflict" && selected?.updatedAt === failure.revision;
  const refreshed =
    failure !== null && snapshotId !== undefined && snapshotId !== failure.snapshotId;
  const unconfirmed = failure?.code === "unconfirmed" && !refreshed;
  const blocked =
    pending ||
    !canManage ||
    stateChanged ||
    stale ||
    unconfirmed ||
    (!refreshed &&
      (failure?.code === "denied" ||
        failure?.code === "unavailable" ||
        failure?.code === "last-active" ||
        failure?.code === "default-pipeline"));

  function choose(
    row: PipelineDirectoryRow,
    action: PipelineDirectoryAction,
    trigger: HTMLButtonElement,
  ): void {
    returnFocusTo.current = trigger;
    setSelection({ id: row.id, action });
    const hold = uncertain[row.id];
    setFailure(
      hold !== undefined && (snapshotId === undefined || snapshotId === hold.snapshotId)
        ? { code: "unconfirmed", revision: row.updatedAt, snapshotId: hold.snapshotId }
        : null,
    );
    setNotice(null);
  }

  function close(): void {
    if (pending) return;
    setSelection(null);
    setFailure(null);
  }

  async function submit(): Promise<void> {
    if (selected === undefined || selection === null || blocked) return;
    const target = selected;
    const action = selection.action;
    setPending(true);
    setFailure(null);
    try {
      const mutate = action === "archive" ? onArchive : onRestore;
      const result = await mutate({ pipelineId: target.id, expectedUpdatedAt: target.updatedAt });
      if (!result.ok) {
        setFailure({
          code: result.error,
          revision: target.updatedAt,
          snapshotId: outcomeSnapshot.current,
        });
        return;
      }
      setChanges((previous) => ({
        ...previous,
        [target.id]: {
          updatedAt: result.value.updatedAt,
          isArchived: action === "archive",
        },
      }));
      setNotice({ action, name: target.name });
      setUncertain((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([id]) => id !== target.id)),
      );
      setSelection(null);
      onRefresh?.();
    } catch {
      // A read received during the write cannot confirm its later unknown outcome.
      const snapshotAtOutcome = outcomeSnapshot.current;
      setUncertain((previous) => ({
        ...previous,
        [target.id]: { snapshotId: snapshotAtOutcome },
      }));
      setFailure({
        code: "unconfirmed",
        revision: target.updatedAt,
        snapshotId: snapshotAtOutcome,
      });
    } finally {
      setPending(false);
    }
  }

  if (!enabled) return null;
  const emptyText =
    normalizedQuery !== ""
      ? t("emptySearch")
      : status === "active"
        ? t("emptyActive")
        : t("emptyArchived");
  return (
    <div data-pipeline-directory dir={directionForLocale(locale)} className="space-y-3">
      <SettingsCard>
        <SettingsCardHeader
          title={t("title")}
          description={t("description")}
          actions={
            canManage ? (
              <CreatePipelineButton label={t("createPipeline")} onCreated="edit" />
            ) : undefined
          }
        />
        <SettingsCardBody className="space-y-3 border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor={searchId} className="mb-1 block text-sm font-medium">
                {t("searchLabel")}
              </label>
              <Input
                ref={searchRef}
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                maxLength={255}
              />
            </div>
            <Select
              value={status}
              onChange={(value) => setStatus(value === "archived" ? "archived" : "active")}
              ariaLabel={t("statusLabel")}
              options={[
                { value: "active", label: t("active") },
                { value: "archived", label: t("archived") },
              ]}
              triggerClassName="sm:w-52"
            />
          </div>
          <p className="text-xs text-pretty text-muted-foreground">{t("accessNote")}</p>
        </SettingsCardBody>
        {visible.length === 0 ? (
          <SettingsCardBody>
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          </SettingsCardBody>
        ) : (
          <ul className="divide-y">
            {visible.map((row) => (
              <PipelineDirectoryRowItem
                key={row.id}
                row={row}
                canManage={canManage}
                onSelect={choose}
              />
            ))}
          </ul>
        )}
      </SettingsCard>
      {notice !== null && (
        <p role="status" className="text-sm">
          <span>{notice.action === "archive" ? t("archiveSuccess") : t("restoreSuccess")} </span>
          <bdi dir="auto">{notice.name}</bdi>
        </p>
      )}
      {selected !== undefined && selection !== null && (
        <PipelineDirectoryDialog
          row={selected}
          action={selection.action}
          pending={pending}
          blocked={blocked}
          error={!canManage ? "denied" : (failure?.code ?? null)}
          stateChanged={stateChanged}
          onConfirm={() => {
            void submit();
          }}
          onCancel={close}
          onRefresh={onRefresh}
          returnFocusTo={returnFocusTo}
          fallbackFocusTo={searchRef}
        />
      )}
    </div>
  );
}
