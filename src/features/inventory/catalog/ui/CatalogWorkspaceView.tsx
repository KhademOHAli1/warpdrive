"use client";

import { Plus, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type {
  CatalogCategory,
  CatalogCommand,
  CatalogPart,
  CatalogResult,
  CatalogState,
  CatalogWorkspace,
} from "../contracts";
import { CatalogCategoryEditor, CatalogStateEditor } from "./CatalogConfigurationEditors";
import { CatalogCheckbox, CatalogField, CatalogSelect } from "./CatalogFields";
import { CatalogPartDetails } from "./CatalogPartDetails";
import { CatalogPartEditor, type PartTarget } from "./CatalogPartEditor";
import {
  applicableParameters,
  catalogPartLabel,
  categoryOptions,
  categoryTrail,
  currentState,
  partType,
  partTypes,
  unitLabel,
} from "./catalogDisplay";
import { type CatalogWords, catalogMessages } from "./catalogMessages";
import type { CatalogIntent, CatalogSave, CatalogWriteError } from "./catalogTypes";

type Editor =
  | { kind: "part"; target: PartTarget }
  | { kind: "category"; category: CatalogCategory | null }
  | { kind: "state"; state: CatalogState | null };
type Filters = {
  search: string;
  category: string;
  state: string;
  type: string;
  showInactive: boolean;
};
const initialFilters: Filters = {
  search: "",
  category: "",
  state: "",
  type: "",
  showInactive: false,
};

function matchingParts(workspace: CatalogWorkspace, filters: Filters, locale: string) {
  const query = filters.search.trim().toLocaleLowerCase(locale);
  return workspace.parts.filter((part) => {
    if (!filters.showInactive && currentState(workspace, part)?.active === false) return false;
    if (filters.state !== "" && (part.profile.stateId ?? "default") !== filters.state) return false;
    if (filters.type !== "" && partType(part) !== filters.type) return false;
    if (
      filters.category !== "" &&
      !categoryTrail(workspace.categories, part.profile.categoryId).some(
        ({ id }) => id === filters.category,
      )
    )
      return false;
    return [
      part.code,
      part.sku,
      part.revision,
      part.name,
      part.profile.description,
      ...part.profile.tags,
    ].some((value) => value.toLocaleLowerCase(locale).includes(query));
  });
}

export function CatalogWorkspaceView({
  id,
  initial,
  submit,
  fixture,
  refresh,
  refreshing = false,
}: {
  id: string;
  initial: CatalogWorkspace;
  submit: (command: CatalogCommand) => Promise<CatalogResult>;
  fixture: boolean;
  refresh?: () => void;
  refreshing?: boolean;
}) {
  const locale = useLocale();
  const t = catalogMessages[locale];
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [tab, setTab] = useState("parts");
  const [filters, setFilters] = useState(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CatalogWriteError | null>(null);
  const [notice, setNotice] = useState(false);
  const attempts = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const focusTrigger = useRef<HTMLButtonElement | null>(null);

  if (source !== initial) {
    setSource(initial);
    setWorkspace(initial);
    setEditor(null);
    setError(null);
    setNotice(false);
  }

  const parts = matchingParts(workspace, filters, locale);
  const selected = parts.find((part) => part.id === selectedId) ?? parts[0];
  const busy = pending || refreshing;

  function showEditor(trigger: HTMLButtonElement, next: Editor) {
    focusTrigger.current = trigger;
    setError(null);
    setNotice(false);
    setEditor(next);
  }

  function choosePart(partId: string) {
    if (!parts.some((part) => part.id === partId))
      setFilters({ ...initialFilters, showInactive: true });
    setSelectedId(partId);
    setTab("parts");
  }

  const save: CatalogSave = async (intent: CatalogIntent) => {
    if (inFlight.current || refreshing) return { ok: false, error: "transport" };
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice(false);
    const intentKey = JSON.stringify(intent);
    const requestId = attempts.current.get(intentKey) ?? crypto.randomUUID();
    attempts.current.set(intentKey, requestId);
    try {
      const result = await submit({ ...intent, requestId });
      attempts.current.delete(intentKey);
      if (!result.ok) {
        setError(result.error);
        return result;
      }
      setWorkspace(result.value);
      setEditor(null);
      setNotice(true);
      if (
        result.focusId !== undefined &&
        (intent.type === "savePart" || intent.type === "setPartState")
      ) {
        setSelectedId(result.focusId);
        if (intent.type === "savePart" && intent.id === null)
          setFilters({ ...initialFilters, showInactive: true });
      }
      return result;
    } catch {
      setError("transport");
      return { ok: false, error: "transport" };
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const editorProps = {
    pending,
    error: error === null ? null : t[error],
    close: () => {
      setEditor(null);
      setError(null);
    },
    restoreFocus: () => focusTrigger.current?.focus(),
    save,
  };

  return (
    <main className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={busy}>
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          fixture ? (
            <Badge variant="outline">{t.demo}</Badge>
          ) : (
            refresh && (
              <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
                <RefreshCw aria-hidden="true" />
                {t.refresh}
              </Button>
            )
          )
        }
      />
      {notice && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {t.saved}
        </p>
      )}
      {error !== null && editor === null && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t[error]}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          aria-label={t.title}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
        >
          <TabsTrigger className={PILL_TAB} value="parts">
            {t.parts}
          </TabsTrigger>
          <TabsTrigger className={PILL_TAB} value="categories">
            {t.categories}
          </TabsTrigger>
          <TabsTrigger className={PILL_TAB} value="configuration">
            {t.configuration}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="parts">
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
            <CatalogPartsList
              id={id}
              workspace={workspace}
              parts={parts}
              selected={selected?.id}
              filters={filters}
              busy={busy}
              select={choosePart}
              change={setFilters}
              add={(trigger) => showEditor(trigger, { kind: "part", target: { mode: "create" } })}
            />
            {selected === undefined ? (
              <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                {t.nothingSelected}
              </p>
            ) : (
              <CatalogPartDetails
                key={`${selected.id}-${selected.profile.version}`}
                part={selected}
                workspace={workspace}
                pending={busy}
                fixture={fixture}
                choose={choosePart}
                saveState={save}
                openEditor={(trigger, target) => showEditor(trigger, { kind: "part", target })}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="categories">
          <CatalogCategories
            workspace={workspace}
            busy={busy}
            edit={(trigger, category) => showEditor(trigger, { kind: "category", category })}
            browse={(category) => {
              setFilters({ ...initialFilters, category: category.id });
              setTab("parts");
            }}
          />
        </TabsContent>
        <TabsContent value="configuration">
          <CatalogStates
            t={t}
            workspace={workspace}
            busy={busy}
            edit={(trigger, state) => showEditor(trigger, { kind: "state", state })}
          />
        </TabsContent>
      </Tabs>
      {editor?.kind === "part" && (
        <CatalogPartEditor
          {...editorProps}
          target={editor.target}
          workspace={workspace}
          initialCategoryId={filters.category || null}
        />
      )}
      {editor?.kind === "category" && (
        <CatalogCategoryEditor
          {...editorProps}
          category={editor.category}
          categories={workspace.categories}
        />
      )}
      {editor?.kind === "state" && <CatalogStateEditor {...editorProps} state={editor.state} />}
    </main>
  );
}

function CatalogPartsList({
  id,
  workspace,
  parts,
  selected,
  filters,
  busy,
  select,
  change,
  add,
}: {
  id: string;
  workspace: CatalogWorkspace;
  parts: CatalogPart[];
  selected?: string;
  filters: Filters;
  busy: boolean;
  select: (id: string) => void;
  change: (filters: Filters) => void;
  add: (trigger: HTMLButtonElement) => void;
}) {
  const locale = useLocale();
  const t = catalogMessages[locale];
  const labelId = useId();
  const [details, setDetails] = useCatalogListDetails(id);
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border bg-card"
      aria-labelledby={`${labelId}-parts`}
    >
      <div className="grid gap-3 border-b p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" id={`${labelId}-parts`}>
            {t.parts}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-expanded={optionsOpen}
              onClick={() => setOptionsOpen(!optionsOpen)}
            >
              <SlidersHorizontal aria-hidden="true" />
              {t.listOptions}
            </Button>
            {workspace.canManage && (
              <Button size="sm" disabled={busy} onClick={(event) => add(event.currentTarget)}>
                <Plus aria-hidden="true" />
                {t.addPart}
              </Button>
            )}
          </div>
        </div>
        {optionsOpen && (
          <CatalogCheckbox
            id={`${labelId}-list-details`}
            label={t.showDetails}
            checked={details}
            change={setDetails}
          />
        )}
        <div className="relative min-w-0">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={t.search}
            placeholder={t.searchHint}
            value={filters.search}
            onChange={(event) => change({ ...filters, search: event.target.value })}
            className="ps-8"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <CatalogField label={t.category}>
            <CatalogSelect
              ariaLabel={t.category}
              value={filters.category}
              options={[
                { value: "", label: t.allCategories },
                ...categoryOptions(workspace.categories, locale),
              ]}
              onChange={(category) => change({ ...filters, category })}
            />
          </CatalogField>
          <CatalogField label={t.state}>
            <CatalogSelect
              ariaLabel={t.state}
              value={filters.state}
              options={[
                { value: "", label: t.allStates },
                { value: "default", label: t.defaultState },
                ...workspace.states.map(({ id, name }) => ({ value: id, label: name })),
              ]}
              onChange={(state) =>
                change({
                  ...filters,
                  state,
                  showInactive: state === "" ? filters.showInactive : true,
                })
              }
            />
          </CatalogField>
          <CatalogField label={t.type}>
            <CatalogSelect
              ariaLabel={t.type}
              value={filters.type}
              options={[
                { value: "", label: t.allTypes },
                ...partTypes.map((type) => ({ value: type, label: t[type] })),
              ]}
              onChange={(type) => change({ ...filters, type })}
            />
          </CatalogField>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CatalogCheckbox
            id={`${labelId}-show-inactive`}
            label={t.showInactive}
            checked={filters.showInactive}
            change={(showInactive) => change({ ...filters, showInactive })}
          />
          {Object.entries(filters).some(
            ([key, value]) => initialFilters[key as keyof Filters] !== value,
          ) && (
            <Button size="sm" variant="ghost" onClick={() => change(initialFilters)}>
              {t.resetFilters}
            </Button>
          )}
        </div>
      </div>
      {parts.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">
          {workspace.parts.length === 0 ? t.emptyCatalog : t.noParts}
        </p>
      ) : (
        <ul className="divide-y">
          {parts.map((part) => (
            <li key={part.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-start justify-between gap-3 px-3 py-3 text-start text-sm hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/10"
                data-catalog-part-id={part.id}
                aria-label={catalogPartLabel(part)}
                aria-pressed={part.id === selected}
                onClick={() => select(part.id)}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words font-medium">
                    <bdi dir="auto">{part.name}</bdi>
                  </span>
                  <span className="break-words text-xs text-muted-foreground">
                    <bdi dir="ltr">{part.code}</bdi> · <bdi>{part.revision}</bdi>
                  </span>
                  {details && part.profile.description !== "" && (
                    <span className="line-clamp-2 break-words text-xs text-muted-foreground">
                      {part.profile.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{t[partType(part)]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CatalogCategories({
  workspace,
  busy,
  edit,
  browse,
}: {
  workspace: CatalogWorkspace;
  busy: boolean;
  edit: (trigger: HTMLButtonElement, category: CatalogCategory | null) => void;
  browse: (category: CatalogCategory) => void;
}) {
  const locale = useLocale();
  const t = catalogMessages[locale];
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <h2 className="text-sm font-semibold">{t.categories}</h2>
        {workspace.canManage && (
          <Button size="sm" disabled={busy} onClick={(event) => edit(event.currentTarget, null)}>
            <Plus aria-hidden="true" />
            {t.addCategory}
          </Button>
        )}
      </div>
      {workspace.categories.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{t.emptyCategories}</p>
      ) : (
        <ul className="divide-y">
          {categoryOptions(workspace.categories, locale).map((option) => {
            const category = workspace.categories.find(({ id }) => id === option.value);
            if (!category) return null;
            const parameters = applicableParameters(workspace.categories, category.id);
            const unit = categoryTrail(workspace.categories, category.id)
              .reverse()
              .find((entry) => entry.defaultUnit !== null)?.defaultUnit;
            return (
              <li
                key={category.id}
                className="flex flex-wrap items-start justify-between gap-2 p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <button
                    type="button"
                    className="break-words text-start text-sm font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => browse(category)}
                  >
                    <bdi>{option.label}</bdi>
                  </button>
                  <p className="break-words text-xs text-muted-foreground">
                    <bdi dir="ltr">{category.code}</bdi>
                    {unit != null && <> · {unitLabel(unit, t)}</>}
                  </p>
                  {parameters.length > 0 && (
                    <ul aria-label={t.parameters} className="flex flex-wrap gap-1">
                      {parameters.map((parameter) => (
                        <li key={parameter.key}>
                          <Badge variant="outline">
                            <bdi>{parameter.label}</bdi>
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {workspace.canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={(event) => edit(event.currentTarget, category)}
                  >
                    {t.editCategory}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CatalogStates({
  t,
  workspace,
  busy,
  edit,
}: {
  t: CatalogWords;
  workspace: CatalogWorkspace;
  busy: boolean;
  edit: (trigger: HTMLButtonElement, state: CatalogState | null) => void;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <h2 className="text-sm font-semibold">{t.state}</h2>
        {workspace.canManage && (
          <Button size="sm" disabled={busy} onClick={(event) => edit(event.currentTarget, null)}>
            <Plus aria-hidden="true" />
            {t.addState}
          </Button>
        )}
      </div>
      {workspace.states.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{t.emptyStates}</p>
      ) : (
        <ul className="divide-y">
          {workspace.states.map((state) => (
            <li key={state.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 grow">
                <p className="break-words text-sm font-medium">
                  <bdi>{state.name}</bdi>
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  <bdi dir="ltr">{state.code}</bdi>
                </p>
              </div>
              <Badge variant="outline">{state.active ? t.active : t.inactive}</Badge>
              {state.locked && <Badge variant="secondary">{t.locked}</Badge>}
              {workspace.canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={(event) => edit(event.currentTarget, state)}
                >
                  {t.editState}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const subscribeToListPreference = () => () => {};

function useCatalogListDetails(id: string): [boolean, (value: boolean) => void] {
  const key = `warpdrive:inventory:catalog:list:${id}`;
  const [override, setOverride] = useState<boolean | null>(null);
  const stored = useSyncExternalStore(
    subscribeToListPreference,
    () => {
      try {
        return sessionStorage.getItem(key) === "details";
      } catch {
        return false;
      }
    },
    () => false,
  );
  function change(value: boolean) {
    setOverride(value);
    try {
      sessionStorage.setItem(key, value ? "details" : "compact");
    } catch {
      // The active view still works when site storage is unavailable.
    }
  }
  return [override ?? stored, change];
}
