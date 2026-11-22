"use client";

import { FileUp, Plus, Printer } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditorSelect } from "@/features/assets/ui/AssetEditorFields";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { CatalogField } from "@/features/inventory/catalog/ui/CatalogFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { encodeLabel } from "@/features/physical-labels/encodeLabel";
import {
  LabelPrintDialog,
  type LabelPrintItem,
} from "@/features/physical-labels/ui/LabelPrintDialog";
import {
  type AssetTagBatch,
  type AssetTagCommand,
  type AssetTagError,
  type AssetTagRecord,
  type AssetTagResult,
  assetTagCommand,
  type AssetTagWorkspace as TagWorkspace,
} from "../contracts";
import { assetTagLink, assetTagText } from "../tagCodes";
import {
  type AssetTagIntent,
  TagChangeDialog,
  type TagDialogState,
  type TagEditor,
} from "./TagEditors";
import { TagImportDialog } from "./TagImportDialog";
import { OwnerInbox, SiteScans, TagDetail, TagsTable } from "./TagPanels";
import { type AssetTagWords, assetTagWords } from "./tagMessages";

type Tab = "register" | "scans" | "messages";
type Filters = { query: string; batch: string; state: string };
const initialFilters: Filters = { query: "", batch: "", state: "" };
type Overlay = TagEditor | { type: "print"; items: LabelPrintItem[] };

function RegistryFilters({
  filters,
  batches,
  search,
  change,
  words: t,
}: {
  filters: Filters;
  batches: AssetTagBatch[];
  search: RefObject<HTMLInputElement | null>;
  change: (filters: Filters) => void;
  words: AssetTagWords;
}) {
  const searchId = useId();
  return (
    <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <CatalogField id={searchId} label={t.search}>
        <Input
          id={searchId}
          ref={search}
          type="search"
          className="h-9"
          value={filters.query}
          onChange={(event) => change({ ...filters, query: event.target.value })}
        />
      </CatalogField>
      <EditorSelect
        label={t.batch}
        value={filters.batch}
        options={[
          { value: "", label: t.allBatches },
          ...batches.map(({ id, title }) => ({ value: id, label: title })),
        ]}
        onChange={(batch) => change({ ...filters, batch })}
      />
      <EditorSelect
        label={t.stateFilter}
        value={filters.state}
        options={[
          { value: "", label: t.all },
          { value: "assigned", label: t.assigned },
          { value: "unassigned", label: t.unassigned },
        ]}
        onChange={(state) => change({ ...filters, state })}
      />
    </div>
  );
}

function filteredTags(
  tags: AssetTagRecord[],
  batches: ReadonlyMap<string, AssetTagBatch>,
  filters: Filters,
  locale: string,
) {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  return tags.filter((tag) => {
    const { assignment, batchId, legacy, token } = tag;
    if (filters.batch !== "" && filters.batch !== batchId) return false;
    const state = assignment === null ? "unassigned" : "assigned";
    if (filters.state !== "" && filters.state !== state) return false;
    return [
      assetTagText(token),
      legacy?.id,
      batches.get(batchId)?.title,
      assignment?.target.title,
      assignment?.target.subtitle,
    ].some((value) => value?.toLocaleLowerCase(locale).includes(query) === true);
  });
}

function toPrintItems(
  tags: AssetTagRecord[],
  batches: ReadonlyMap<string, AssetTagBatch>,
  origin: string,
): LabelPrintItem[] {
  return tags.flatMap((tag): LabelPrintItem[] => {
    const value = assetTagLink(origin, tag.token);
    if (value === null) return [];
    const { assignment, batchId, ordinal } = tag;
    return [
      {
        id: tag.id,
        title: assignment?.target.title ?? batches.get(batchId)?.title ?? assetTagText(tag.token),
        subtitle: assignment?.target.subtitle ?? String(ordinal),
        humanReadable: assetTagText(tag.token),
        symbology: "qr",
        value,
      },
    ];
  });
}

type Submit = (command: AssetTagCommand) => Promise<AssetTagResult>;

function useTagWrites({
  submit,
  onSaved,
}: {
  submit: Submit;
  onSaved: (value: Extract<AssetTagResult, { ok: true }>) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AssetTagError | "transport" | null>(null);
  const [notice, setNotice] = useState<"saved" | "imported" | null>(null);
  const running = useRef(false);
  const unconfirmed = useRef(new Map<string, string>());

  function clear() {
    setError(null);
    setNotice(null);
  }

  async function save(intent: AssetTagIntent) {
    if (running.current) return;
    clear();
    const key = JSON.stringify(intent);
    const requestId = unconfirmed.current.get(key) ?? crypto.randomUUID();
    const parsed = assetTagCommand.safeParse({ ...intent, requestId });
    if (!parsed.success) {
      setError("invalid");
      return;
    }
    running.current = true;
    unconfirmed.current.set(key, requestId);
    setPending(true);
    try {
      const result = await submit(parsed.data);
      unconfirmed.current.delete(key);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result);
      setNotice(intent.type === "importLegacy" ? "imported" : "saved");
    } catch {
      setError("transport");
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return { clear, error, notice, pending, save, setError };
}

export function AssetTagWorkspace({
  initial,
  submit,
  fixture,
}: {
  initial: TagWorkspace;
  submit: Submit;
  fixture: boolean;
}) {
  const locale = useLocale();
  const t = assetTagWords[locale];
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [siteId, setSiteId] = useState(initial.sites[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("register");
  const [filters, setFilters] = useState(initialFilters);
  const [activeId, setActive] = useState<string | null>(null);
  const [checked, setChecked] = useState(() => new Set<string>());
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  if (source !== initial) {
    setSource(initial);
    if (JSON.stringify(source) !== JSON.stringify(initial)) setWorkspace(initial);
  }

  function onSaved({ value, batchId, tagId }: Extract<AssetTagResult, { ok: true }>) {
    setWorkspace(value);
    setOverlay(null);
    if (batchId !== null) {
      const batchTags = value.tags.filter((tag) => tag.batchId === batchId);
      setFilters({ ...initialFilters, batch: batchId });
      setChecked(new Set(batchTags.map(({ id }) => id)));
      setActive(batchTags[0]?.id ?? null);
    } else if (tagId !== null) {
      setFilters(initialFilters);
      setChecked(new Set());
      setActive(tagId);
    }
  }

  const action = useTagWrites({ submit, onSaved });
  const site = workspace.sites.find(({ id }) => id === siteId) ?? workspace.sites[0];
  if (site === undefined) {
    return (
      <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`}>
        <PageHeading title={t.title} />
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t.noSites}</p>
      </section>
    );
  }

  const activeTab = tab === "messages" && !site.canManage ? "register" : tab;
  const tags = workspace.tags.filter((tag) => tag.siteId === site.id);
  const targets = workspace.targets.filter((target) => target.siteId === site.id);
  const batches = workspace.batches.filter((batch) => batch.siteId === site.id);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));
  const rows = filteredTags(tags, batchesById, filters, locale);
  const active = rows.find(({ id }) => id === activeId) ?? rows[0];
  const selected = rows.filter(({ id }) => checked.has(id));

  function open(from: HTMLElement, next: TagEditor) {
    action.clear();
    trigger.current = from;
    setOverlay(next);
  }

  function print(from: HTMLElement) {
    action.clear();
    const items = toPrintItems(selected, batchesById, window.location.origin);
    if (items.length === 0 || items.length !== selected.length) {
      action.setError("invalid");
      return;
    }
    trigger.current = from;
    setOverlay({ type: "print", items });
  }

  function restoreFocus() {
    const button = trigger.current;
    (button?.isConnected === true ? button : search.current)?.focus();
  }

  function select(ids: string[], next: boolean) {
    setChecked((previous) => {
      const result = new Set(previous);
      for (const id of ids) {
        if (next) result.add(id);
        else result.delete(id);
      }
      return result;
    });
  }

  const errorMessage = action.error === null ? null : t[action.error];
  const state: TagDialogState = {
    pending: action.pending,
    error: errorMessage,
    close: () => setOverlay(null),
    restoreFocus,
    save: (intent) => void action.save(intent),
  };

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={action.pending}>
      <PageHeading
        title={t.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {fixture && <Badge variant="outline">{t.demo}</Badge>}
            {site.canManage && activeTab === "register" && (
              <>
                <Button
                  variant="outline"
                  disabled={action.pending}
                  onClick={(event) => open(event.currentTarget, { type: "importLegacy" })}
                >
                  <FileUp size={16} aria-hidden="true" /> {t.import}
                </Button>
                <Button
                  disabled={action.pending}
                  onClick={(event) => open(event.currentTarget, { type: "createBatch" })}
                >
                  <Plus size={16} aria-hidden="true" /> {t.issue}
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="mb-3 w-64 max-w-full">
        <EditorSelect
          label={t.site}
          value={site.id}
          disabled={action.pending}
          options={workspace.sites.map(({ id, name }) => ({ value: id, label: name }))}
          onChange={(next) => {
            setSiteId(next);
            setFilters(initialFilters);
            setChecked(new Set());
            setActive(null);
            setTab("register");
            action.clear();
          }}
        />
      </div>
      {action.notice !== null && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {t[action.notice]}
        </p>
      )}
      {overlay === null && errorMessage !== null && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <Tabs
        value={activeTab}
        onValueChange={(next) => {
          if (next === "register" || next === "scans" || next === "messages") setTab(next);
        }}
      >
        <TabsList
          aria-label={t.title}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
        >
          <TabsTrigger className={PILL_TAB} value="register">
            {t.register}
          </TabsTrigger>
          <TabsTrigger className={PILL_TAB} value="scans">
            {t.scans}
          </TabsTrigger>
          {site.canManage && (
            <TabsTrigger className={PILL_TAB} value="messages">
              {t.messages}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="register" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-3">
            <div className="min-w-0 flex-1 basis-[28rem]">
              <RegistryFilters
                {...{ filters, batches, search }}
                words={t}
                change={(next) => {
                  setFilters(next);
                  setChecked(new Set());
                }}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={selected.length === 0 || action.pending}
              onClick={(event) => print(event.currentTarget)}
            >
              <Printer size={15} aria-hidden="true" />{" "}
              {t.print.replace("{count}", String(selected.length))}
            </Button>
          </div>
          <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(18rem,4fr)]">
            <TagsTable
              rows={rows}
              batches={batchesById}
              activeId={active?.id ?? null}
              selected={checked}
              choose={setActive}
              toggle={select}
              words={t}
            />
            {active !== undefined && (
              <TagDetail
                tag={active}
                batch={batchesById.get(active.batchId)}
                targets={targets}
                events={workspace.events.filter(({ tagId }) => tagId === active.id)}
                busy={action.pending}
                canManage={site.canManage}
                canSwap={tags.some(({ assignment }) => assignment === null)}
                open={open}
                words={t}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="scans">
          <SiteScans
            scans={workspace.scans.filter(({ tagId }) => tagsById.has(tagId))}
            tags={tagsById}
            canManage={site.canManage}
            words={t}
          />
        </TabsContent>
        {site.canManage && (
          <TabsContent value="messages">
            <OwnerInbox
              messages={workspace.messages.filter(({ tagId }) => tagsById.has(tagId))}
              tags={tagsById}
              busy={action.pending}
              mark={(messageId) => void action.save({ type: "markMessageRead", messageId })}
              words={t}
            />
          </TabsContent>
        )}
      </Tabs>
      {overlay?.type === "print" && (
        <LabelPrintDialog
          items={overlay.items}
          encode={encodeLabel}
          close={state.close}
          restoreFocus={restoreFocus}
        />
      )}
      {overlay?.type === "importLegacy" && site.canManage && (
        <TagImportDialog {...{ site, tags, targets, state }} words={t} />
      )}
      {overlay !== null && overlay.type !== "print" && overlay.type !== "importLegacy" && (
        <TagChangeDialog editor={overlay} {...{ site, tags, targets, state }} words={t} />
      )}
    </section>
  );
}
