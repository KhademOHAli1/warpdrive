"use client";

import { Plus } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { CatalogCheckbox } from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { EditorSelect } from "../../ui/AssetEditorFields";
import type {
  EquipmentAuditAccess,
  EquipmentAuditDetail,
  EquipmentAuditError,
  EquipmentAuditIntent,
  EquipmentAuditRead,
  EquipmentAuditSite,
  EquipmentAuditSummary,
  EquipmentAuditWorkspace,
  EquipmentAuditWrite,
} from "../contracts";
import { AuditBulkCountDialog, AuditCountDialog, AuditUnexpectedDialog } from "./AuditCountDialogs";
import { AuditDetail, AuditStatus, type ScanResponse } from "./AuditDetail";
import type { AuditDialogState } from "./AuditDialog";
import { AuditTime } from "./AuditDocuments";
import { AuditAssignDialog, AuditDraftDialog } from "./AuditDraftDialog";
import { AuditPhotoDialog, AuditTaskDialog } from "./AuditTaskDialog";
import { type AuditEditor, auditErrorText, type OpenAuditEditor } from "./auditView";
import { type AuditWords, auditMessages } from "./messages";

type ReadResult = EquipmentAuditRead | { ok: false; error: "transport" };
type Selection = {
  id: string;
  version: number;
  reload: number;
  read: EquipmentAuditAccess["read"];
  result: ReadResult;
};

function useReadAudit(
  audit: EquipmentAuditSummary | undefined,
  read: EquipmentAuditAccess["read"],
) {
  const id = audit?.id;
  const version = audit?.version;
  const [selected, setSelected] = useState<Selection | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (id === undefined || version === undefined) return;
    let relevant = true;
    const accept = (result: ReadResult) => {
      if (!relevant) return;
      setSelected((current) => {
        if (
          current?.id === id &&
          current.read === read &&
          current.result.ok &&
          result.ok &&
          current.result.value.version > result.value.version
        )
          return current;
        return { id, version, reload, read, result };
      });
    };
    void read(id).then(accept, () => accept({ ok: false, error: "transport" }));
    return () => {
      relevant = false;
    };
  }, [id, version, read, reload]);
  const result =
    selected !== null &&
    selected.id === id &&
    selected.version === version &&
    selected.reload === reload &&
    selected.read === read
      ? selected.result
      : null;
  return {
    result,
    refresh: () => setReload((value) => value + 1),
    accept: (detail: EquipmentAuditDetail) => {
      setSelected({
        id: detail.id,
        version: detail.version,
        reload,
        read,
        result: { ok: true, value: detail },
      });
    },
  };
}

type CommandRetry = { type: "command"; key: string; id: string };
type PhotoRetry = { type: "photo"; key: string; id: string; file: File };
type Retry = CommandRetry | PhotoRetry;

function useAuditEditor({
  access,
  onSaved,
  fallbackFocus,
}: {
  access: EquipmentAuditAccess;
  onSaved: (value: Extract<EquipmentAuditWrite, { ok: true }>) => void;
  fallbackFocus: RefObject<HTMLInputElement | null>;
}) {
  const [editor, setEditor] = useState<AuditEditor | null>(null);
  const [error, setError] = useState<EquipmentAuditError | "transport" | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);
  const ambiguous = useRef<Retry | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open: OpenAuditEditor = (element, next) => {
    if (inFlight.current) return;
    trigger.current = element;
    setEditor(next);
    setError(null);
    setSaved(false);
  };
  function close() {
    if (!inFlight.current) setEditor(null);
  }
  function restoreFocus() {
    if (trigger.current?.isConnected === true) trigger.current.focus();
    else fallbackFocus.current?.focus();
  }
  async function commit(operation: Retry, write: () => Promise<EquipmentAuditWrite>) {
    if (inFlight.current) return;
    inFlight.current = true;
    ambiguous.current = operation;
    setBusy(true);
    setError(null);
    try {
      const outcome = await write();
      if (!mounted.current) return;
      ambiguous.current = null;
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      onSaved(outcome);
      setSaved(true);
      setEditor(null);
    } catch {
      if (mounted.current) setError("transport");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function save(intent: EquipmentAuditIntent) {
    const key = JSON.stringify(intent);
    const prior = ambiguous.current;
    const id = prior?.type === "command" && prior.key === key ? prior.id : crypto.randomUUID();
    return commit({ key, id, type: "command" }, () => access.submit({ ...intent, requestId: id }));
  }
  function attach(detail: EquipmentAuditDetail, file: File, rowId: string | null) {
    const key = JSON.stringify([detail.id, detail.version, rowId]);
    const prior = ambiguous.current;
    const id =
      prior?.type === "photo" && prior.key === key && prior.file === file
        ? prior.id
        : crypto.randomUUID();
    return commit({ key, id, type: "photo", file }, () =>
      access.attach({
        auditId: detail.id,
        version: detail.version,
        rowId,
        file,
        requestId: id,
        source: "file",
      }),
    );
  }
  return { editor, error, busy, saved, open, close, save, attach, restoreFocus };
}

function AuditEditorView({
  editor,
  detail,
  site,
  state,
  words: t,
}: {
  editor: AuditEditor;
  detail: EquipmentAuditDetail | null;
  site: EquipmentAuditSite;
  state: AuditDialogState;
  words: AuditWords;
}) {
  const common = { state, words: t };
  if (editor.type === "create") return <AuditDraftDialog type="create" site={site} {...common} />;
  if (detail === null) return null;
  const props = { detail, ...common };
  switch (editor.type) {
    case "edit":
    case "duplicate":
      return <AuditDraftDialog type={editor.type} {...{ site, ...props }} />;
    case "assign":
      return <AuditAssignDialog {...{ site, ...props }} />;
    case "setCount":
      return <AuditCountDialog rows={editor.rows} scan={editor.scan} {...props} />;
    case "unexpected":
      return <AuditUnexpectedDialog scan={editor.scan} {...{ site, ...props }} />;
    case "bulkCount":
      return <AuditBulkCountDialog {...props} />;
    case "attach":
      return <AuditPhotoDialog row={editor.row} {...common} />;
    case "note":
      return <AuditTaskDialog action={{ type: "note", row: editor.row }} {...props} />;
    case "undo":
      return <AuditTaskDialog action={editor} {...props} />;
    case "start":
    case "complete":
    case "cancel":
    case "archive":
    case "review":
      return <AuditTaskDialog action={{ type: editor.type }} {...props} />;
  }
}

async function stageScan(
  detail: EquipmentAuditDetail | null,
  code: string,
  trigger: HTMLElement,
  { lookup }: EquipmentAuditAccess,
  open: OpenAuditEditor,
): Promise<ScanResponse> {
  if (detail?.canCount !== true || detail.status !== "active") return "unavailable";
  const outcome = await lookup(detail.id, code);
  if (!trigger.isConnected) return "unavailable";
  if (!outcome.ok) return outcome.error === "invalid" ? "invalid" : "unavailable";
  const rows = detail.rows.filter(({ id }) => outcome.rows.includes(id));
  const scan = { code, targetId: outcome.targetId, label: outcome.label };
  if (rows.length === 0) {
    open(trigger, { type: "unexpected", scan });
    return "scanPending";
  }
  const [first] = rows;
  if (rows.length === 1 && first?.quantityType === "single" && first.counted === 1)
    return "scanDuplicate";
  const proof = rows.every((row) => (row.target?.id ?? null) === outcome.targetId)
    ? scan
    : undefined;
  open(trigger, { type: "setCount", rows, scan: proof });
  return rows.length > 1 ? "scanChoose" : "scanPending";
}

type Filters = { site: string; search: string; archived: boolean };
const defaultFilters: Filters = { site: "", search: "", archived: false };

function AuditList({
  audits,
  sites,
  activeId,
  select,
  words: t,
}: {
  audits: EquipmentAuditSummary[];
  sites: EquipmentAuditSite[];
  activeId?: string;
  select: (id: string) => void;
  words: AuditWords;
}) {
  const bySite = new Map(sites.map(({ id, name }) => [id, name]));
  return (
    <ul aria-label={t.title} className="min-w-0 divide-y rounded-lg border bg-card">
      {audits.map((audit) => (
        <li
          key={audit.id}
          data-audit-row={audit.id}
          data-selected={activeId === audit.id}
          className="data-[selected=true]:bg-accent/70"
        >
          <button
            type="button"
            aria-pressed={activeId === audit.id}
            onClick={() => select(audit.id)}
            className="flex w-full min-w-0 items-start justify-between gap-2 p-3 text-start hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-inset"
          >
            <span className="min-w-0 flex-1 space-y-1 wrap-anywhere">
              <bdi className="block font-medium">{audit.title}</bdi>
              <bdi className="block text-xs text-muted-foreground">{bySite.get(audit.siteId)}</bdi>
              {audit.dueAt !== null && (
                <span className="block text-xs text-muted-foreground">
                  <AuditTime value={audit.dueAt} />
                </span>
              )}
            </span>
            <AuditStatus status={audit.status} archived={audit.archived} words={t} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AuditFilters({
  filters,
  change,
  sites,
  searchInput,
  words: t,
}: {
  filters: Filters;
  change: (value: Filters) => void;
  sites: EquipmentAuditSite[];
  searchInput: RefObject<HTMLInputElement | null>;
  words: AuditWords;
}) {
  const archivedId = useId();
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-44">
        <EditorSelect
          label={t.site}
          value={filters.site}
          options={[
            { value: "", label: t.allSites },
            ...sites.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(site) => change({ ...filters, site })}
        />
      </div>
      <div className="min-w-48 flex-1 sm:max-w-80">
        <SalesInput
          label={t.search}
          ref={searchInput}
          type="search"
          value={filters.search}
          onChange={(event) => change({ ...filters, search: event.currentTarget.value })}
        />
      </div>
      <CatalogCheckbox
        id={archivedId}
        label={t.showArchived}
        checked={filters.archived}
        change={(archived) => change({ ...filters, archived })}
      />
    </div>
  );
}

function matchesAudits(workspace: EquipmentAuditWorkspace, filters: Filters, locale: string) {
  const query = filters.search.trim().toLocaleLowerCase(locale);
  return workspace.audits.filter(
    (audit) =>
      audit.archived === filters.archived &&
      (filters.site === "" || audit.siteId === filters.site) &&
      audit.title.toLocaleLowerCase(locale).includes(query),
  );
}

function firstFilters(initial: EquipmentAuditWorkspace, id: string | undefined): Filters {
  const selected = initial.audits.find((audit) => audit.id === id);
  return selected === undefined
    ? defaultFilters
    : { ...defaultFilters, site: selected.siteId, archived: selected.archived };
}

export function EquipmentAuditsWorkspace({
  initial,
  access,
  fixture,
  initialAuditId,
  canBrowseAssets = true,
}: {
  initial: EquipmentAuditWorkspace;
  access: EquipmentAuditAccess;
  fixture: boolean;
  initialAuditId?: string;
  canBrowseAssets?: boolean;
}) {
  const { locale } = useLocalePreferences();
  const t = auditMessages[locale];
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [filters, setFilters] = useState(() => firstFilters(initial, initialAuditId));
  const [selected, setSelected] = useState(initialAuditId);
  if (source !== initial) {
    setSource(initial);
    if (JSON.stringify(initial) !== JSON.stringify(source)) setWorkspace(initial);
  }
  const visible = matchesAudits(workspace, filters, locale);
  const active = visible.find(({ id }) => id === selected) ?? visible[0];
  const reading = useReadAudit(active, access.read);
  const detail = reading.result?.ok === true ? reading.result.value : null;
  const managing = workspace.sites.find(
    ({ id, canManage }) => canManage && (filters.site === "" || id === filters.site),
  );
  const editor = useAuditEditor({
    access,
    fallbackFocus: searchInput,
    onSaved(outcome) {
      const next = outcome.detail;
      setWorkspace(outcome.workspace);
      setSelected(next.id);
      setFilters({ search: "", archived: next.archived, site: next.siteId });
      reading.accept(next);
    },
  });
  const dialog = editor.editor;
  const dialogSiteId = dialog?.type === "create" ? dialog.siteId : detail?.siteId;
  const dialogSite = workspace.sites.find(({ id }) => id === dialogSiteId);
  const state: AuditDialogState = {
    pending: editor.busy,
    error: editor.error === null ? null : auditErrorText(editor.error, t),
    close: editor.close,
    restoreFocus: editor.restoreFocus,
    save: (intent) => void editor.save(intent),
    attach: (file, rowId) => {
      if (detail !== null) void editor.attach(detail, file, rowId);
    },
  };
  return (
    <section data-audit-workspace className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-3`}>
      <PageHeading
        title={t.title}
        crumbs={
          canBrowseAssets ? [{ label: t.assets, href: "/assets" }, { label: t.title }] : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {fixture && <Badge variant="outline">{t.demo}</Badge>}
            {managing !== undefined && (
              <Button
                size="sm"
                data-audit-action="create"
                disabled={editor.busy}
                onClick={(event) =>
                  editor.open(event.currentTarget, { type: "create", siteId: managing.id })
                }
              >
                <Plus className="size-4" aria-hidden="true" /> {t.create}
              </Button>
            )}
          </div>
        }
      />
      <AuditFilters
        filters={filters}
        change={setFilters}
        sites={workspace.sites}
        searchInput={searchInput}
        words={t}
      />
      {editor.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.saved}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t.noAudits}</p>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(15rem,2fr)_minmax(0,5fr)]">
          <AuditList
            audits={visible}
            sites={workspace.sites}
            activeId={active?.id}
            select={setSelected}
            words={t}
          />
          {detail !== null ? (
            <AuditDetail
              key={detail.id}
              detail={detail}
              pending={editor.busy}
              open={editor.open}
              scan={(code, trigger) => stageScan(detail, code, trigger, access, editor.open)}
              words={t}
            />
          ) : (
            <div className="rounded-lg border bg-card p-4 text-sm">
              {reading.result?.ok === false ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert">{auditErrorText(reading.result.error, t)}</p>
                  <Button size="sm" variant="outline" onClick={reading.refresh}>
                    {t.refresh}
                  </Button>
                </div>
              ) : (
                <p role="status">{t.loading}</p>
              )}
            </div>
          )}
        </div>
      )}
      {dialog !== null && dialogSite !== undefined && (
        <AuditEditorView
          key={`${dialog.type}:${detail?.id ?? ""}`}
          editor={dialog}
          detail={detail}
          site={dialogSite}
          state={state}
          words={t}
        />
      )}
    </section>
  );
}
