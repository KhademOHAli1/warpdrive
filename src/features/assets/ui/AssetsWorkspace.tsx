"use client";

import { Plus, Search, X } from "lucide-react";
import { type MouseEvent, type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type AssetCommand,
  type AssetError,
  type AssetIntent,
  type AssetLocation,
  type AssetRecord,
  type AssetResult,
  type AssetsWorkspace,
  assetTrackingMethods,
} from "../contracts";
import { AssetDetail } from "./AssetDetail";
import { type AssetEditor, AssetEditorDialog } from "./AssetEditors";
import { AssetTable } from "./AssetTable";
import { type AssetWords, assetMessages } from "./assetMessages";

type RegisterTab = "register" | "categories" | "models";
type EditHandler = (event: MouseEvent<HTMLButtonElement>, editor: AssetEditor) => void;

type Filters = {
  site: string;
  search: string;
  category: string;
  tracking: string;
  status: "active" | "archived";
  location: string;
  includeSublocations: boolean;
};

function defaultFilters(site: string): Filters {
  return {
    site,
    search: "",
    category: "",
    tracking: "",
    status: "active",
    location: "",
    includeSublocations: false,
  };
}

function inScope(site: string, record: { siteId: string }) {
  return site === "" || site === record.siteId;
}

function locationTrail(locations: ReadonlyMap<string, AssetLocation>, location: AssetLocation) {
  const trail: AssetLocation[] = [];
  const visited = new Set<string>();
  let current: AssetLocation | undefined = location;
  while (current?.siteId === location.siteId && !visited.has(current.id)) {
    trail.unshift(current);
    visited.add(current.id);
    current = current.parentId === null ? undefined : locations.get(current.parentId);
  }
  return trail;
}

function matchesLocation(record: AssetRecord, filter: string, locationIds: ReadonlySet<string>) {
  if (filter === "") return true;
  if (filter === "unassigned")
    return record.tracking === "individual" && record.locationId === null;
  if (record.tracking === "individual") {
    return record.locationId !== null && locationIds.has(record.locationId);
  }
  return record.balances.some(
    ({ locationId, quantity }) => quantity > 0 && locationIds.has(locationId),
  );
}

function matchingRecords(workspace: AssetsWorkspace, filters: Filters, locale: string) {
  const query = filters.search.trim().toLocaleLowerCase(locale);
  const models = new Map(workspace.models.map((model) => [model.id, model]));
  const locations = new Map(workspace.locations.map((location) => [location.id, location]));
  const locationIds = new Set([filters.location]);
  if (filters.includeSublocations) {
    for (const location of workspace.locations) {
      if (locationTrail(locations, location).some(({ id }) => id === filters.location)) {
        locationIds.add(location.id);
      }
    }
  }
  return workspace.records.filter((record) => {
    if (!inScope(filters.site, record)) return false;
    if ((record.archivedAt !== null) !== (filters.status === "archived")) return false;
    if (filters.category !== "" && record.categoryId !== filters.category) return false;
    if (filters.tracking !== "" && record.tracking !== filters.tracking) return false;
    if (!matchesLocation(record, filters.location, locationIds)) return false;
    const model =
      record.tracking === "individual" && record.modelId !== null
        ? models.get(record.modelId)
        : undefined;
    return (
      query === "" ||
      [
        record.name,
        record.code,
        ...(record.tracking === "individual" && record.serial !== null ? [record.serial] : []),
        ...(model ? [model.name, model.code] : []),
        ...record.tags,
      ].some((value) => value.toLocaleLowerCase(locale).includes(query))
    );
  });
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <span aria-hidden="true" className="block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <Select
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
        triggerClassName="h-8 w-full bg-card"
        contentClassName={`${BLOCK_CLASS} ph-no-capture`}
      />
    </div>
  );
}

function RegisterFilters({
  searchInput,
  filters,
  siteFilter,
  categories,
  locationOptions,
  setFilters,
  words: t,
}: {
  searchInput: RefObject<HTMLInputElement | null>;
  filters: Filters;
  siteFilter: ReactNode;
  categories: AssetsWorkspace["categories"];
  locationOptions: SelectOption[];
  setFilters: (next: Filters) => void;
  words: AssetWords;
}) {
  const searchId = useId();
  const preciseLocation = filters.location !== "" && filters.location !== "unassigned";
  return (
    <section aria-label={t.filters} className="rounded-lg border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <label htmlFor={searchId} className="block text-xs font-medium text-muted-foreground">
            {t.search}
          </label>
          <div className="relative">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              ref={searchInput}
              type="search"
              value={filters.search}
              placeholder={t.searchHint}
              className="h-8 ps-8"
              onChange={(event) => setFilters({ ...filters, search: event.currentTarget.value })}
            />
          </div>
        </div>
        {siteFilter}
        <FilterSelect
          label={t.status}
          value={filters.status}
          options={[
            { value: "active", label: t.active },
            { value: "archived", label: t.archived },
          ]}
          onChange={(status) =>
            setFilters({
              ...filters,
              status: status === "archived" ? "archived" : "active",
            })
          }
        />
        <FilterSelect
          label={t.category}
          value={filters.category}
          options={[
            { value: "", label: t.allCategories },
            ...categories.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          onChange={(category) => setFilters({ ...filters, category })}
        />
        <FilterSelect
          label={t.tracking}
          value={filters.tracking}
          options={[
            { value: "", label: t.allTracking },
            ...assetTrackingMethods.map((tracking) => ({
              value: tracking,
              label: t[tracking],
            })),
          ]}
          onChange={(tracking) => setFilters({ ...filters, tracking })}
        />
        <div className={preciseLocation ? undefined : "sm:col-span-2"}>
          <FilterSelect
            label={t.location}
            value={filters.location}
            options={[
              { value: "", label: t.allLocations },
              { value: "unassigned", label: t.unassigned },
              ...locationOptions,
            ]}
            onChange={(location) =>
              setFilters({ ...filters, location, includeSublocations: false })
            }
          />
        </div>
        {preciseLocation && (
          <FilterSelect
            label={t.locationScope}
            value={filters.includeSublocations ? "descendants" : "exact"}
            options={[
              { value: "exact", label: t.exact },
              { value: "descendants", label: t.descendants },
            ]}
            onChange={(scope) =>
              setFilters({ ...filters, includeSublocations: scope === "descendants" })
            }
          />
        )}
      </div>
    </section>
  );
}

function AssetHeaderActions({
  manageSiteId,
  tab,
  fixture,
  pending,
  onEdit,
  words: t,
}: {
  manageSiteId: string | null;
  tab: RegisterTab;
  fixture: boolean;
  pending: boolean;
  onEdit: EditHandler;
  words: AssetWords;
}) {
  if (manageSiteId === null) return fixture ? <Badge variant="outline">{t.demo}</Badge> : null;
  const add: AssetEditor =
    tab === "register"
      ? { type: "create", siteId: manageSiteId }
      : {
          type: tab === "categories" ? "saveCategory" : "saveModel",
          siteId: manageSiteId,
        };
  const label = tab === "register" ? t.addAsset : tab === "categories" ? t.addCategory : t.addModel;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fixture && <Badge variant="outline">{t.demo}</Badge>}
      {tab === "register" && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={(event) => onEdit(event, { type: "createFleet", siteId: manageSiteId })}
        >
          {t.addFleet}
        </Button>
      )}
      <Button disabled={pending} onClick={(event) => onEdit(event, add)}>
        <Plus size={16} aria-hidden="true" />
        {label}
      </Button>
    </div>
  );
}

const configCell = "px-3 py-2.5 text-start align-top";
const configHeader = `${configCell} font-medium text-muted-foreground`;

function RegisterEmpty({
  matchingScope,
  archived,
  words: t,
}: {
  matchingScope: boolean;
  archived: boolean;
  words: AssetWords;
}) {
  let title = t.noAssets;
  let body = t.noAssetsBody;
  if (matchingScope) {
    title = t.noMatches;
    body = t.noMatchesBody;
  } else if (archived) {
    title = t.noArchived;
    body = t.noArchivedBody;
  }
  return <EmptyState className="rounded-lg border bg-card" title={title} body={body} />;
}

export function AssetsRegister({
  initial,
  submit,
  fixture,
}: {
  initial: AssetsWorkspace;
  submit: (command: AssetCommand) => Promise<AssetResult>;
  fixture: boolean;
}) {
  const locale = useLocale();
  const t = assetMessages[locale];
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [tab, setTab] = useState<RegisterTab>("register");
  const [filters, setFilters] = useState(() => defaultFilters(initial.sites[0]?.id ?? ""));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<AssetEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AssetError | "transport" | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const unconfirmed = useRef<{ intent: string; requestId: string } | null>(null);
  const focusTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  if (source !== initial) {
    setSource(initial);
    setWorkspace(initial);
    if (filters.site !== "" && !initial.sites.some(({ id }) => id === filters.site)) {
      setFilters(defaultFilters(initial.sites[0]?.id ?? ""));
    }
  }

  const records = matchingRecords(workspace, filters, locale);
  const chosen = records.find(({ id }) => id === selectedId) ?? records[0];
  const sites = new Map(workspace.sites.map((site) => [site.id, site]));
  const categories = workspace.categories.filter((category) => inScope(filters.site, category));
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const models = workspace.models.filter((model) => inScope(filters.site, model));
  const locations = new Map(workspace.locations.map((location) => [location.id, location]));
  const locationLabels = new Map(
    workspace.locations.map((location) => [
      location.id,
      locationTrail(locations, location)
        .map(({ name }) => name)
        .join(" / "),
    ]),
  );
  const locationOptions = workspace.locations
    .filter((location) => inScope(filters.site, location))
    .map(({ id, siteId, name, archivedAt }) => {
      const path = locationLabels.get(id) ?? name;
      const site = filters.site === "" && sites.size > 1 ? sites.get(siteId)?.name : undefined;
      const label = site !== undefined ? `${site} / ${path}` : path;
      return { value: id, label: archivedAt === null ? label : `${label} (${t.archived})` };
    });
  const siteOptions = [
    { value: "", label: t.allSites },
    ...workspace.sites.map(({ id, name }) => ({ value: id, label: name })),
  ];
  const createSite =
    filters.site === ""
      ? workspace.sites.find(({ canManage }) => canManage)
      : sites.get(filters.site);
  const manageSiteId = createSite?.canManage === true ? createSite.id : null;
  const hasMoreFilters =
    filters.status !== "active" ||
    filters.search !== "" ||
    filters.category !== "" ||
    filters.tracking !== "" ||
    filters.location !== "";
  const hasRecordsInScope = workspace.records.some(
    (record) =>
      inScope(filters.site, record) &&
      (record.archivedAt !== null) === (filters.status === "archived"),
  );

  function chooseSite(site: string) {
    setFilters((current) => ({
      ...current,
      site,
      category: "",
      location: "",
      includeSublocations: false,
    }));
    setSelectedId(null);
  }

  function showEditor(event: MouseEvent<HTMLButtonElement>, next: AssetEditor) {
    focusTrigger.current = event.currentTarget;
    setEditor(next);
    setSaved(false);
    setError(null);
  }

  function closeEditor() {
    if (inFlight.current) return;
    setEditor(null);
    setError(null);
  }

  async function save(intent: AssetIntent) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(intent);
    const lastAttempt = unconfirmed.current;
    const requestId = lastAttempt?.intent === key ? lastAttempt.requestId : crypto.randomUUID();
    unconfirmed.current = { intent: key, requestId };
    try {
      const result = await submit({ ...intent, requestId });
      unconfirmed.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWorkspace(result.value);
      setEditor(null);
      setSaved(true);
      const target = result.value.records.find(({ id }) => id === result.focusId);
      if (target !== undefined) {
        setSelectedId(target.id);
        setFilters((current) => {
          if (matchingRecords(result.value, current, locale).some(({ id }) => id === target.id)) {
            return current;
          }
          return {
            ...defaultFilters(inScope(current.site, target) ? current.site : target.siteId),
            status: target.archivedAt === null ? "active" : "archived",
          };
        });
      }
    } catch {
      setError("transport");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function renderSiteFilter() {
    return (
      <FilterSelect
        label={t.site}
        value={filters.site}
        options={siteOptions}
        onChange={chooseSite}
      />
    );
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={pending}>
      <PageHeading
        title={t.title}
        actions={
          <AssetHeaderActions
            manageSiteId={manageSiteId}
            tab={tab}
            fixture={fixture}
            pending={pending}
            onEdit={showEditor}
            words={t}
          />
        }
      />
      {saved && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {t.saved}
        </p>
      )}
      {workspace.sites.length === 0 ? (
        <EmptyState className="rounded-lg border bg-card" title={t.noSites} body={t.noSitesBody} />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(next) =>
            setTab(next === "categories" || next === "models" ? next : "register")
          }
        >
          <TabsList
            aria-label={t.title}
            className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
          >
            <TabsTrigger className={PILL_TAB} value="register">
              {t.register}
            </TabsTrigger>
            <TabsTrigger className={PILL_TAB} value="categories">
              {t.categories}
            </TabsTrigger>
            <TabsTrigger className={PILL_TAB} value="models">
              {t.models}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="register" className="space-y-3">
            <RegisterFilters
              searchInput={searchInput}
              filters={filters}
              siteFilter={renderSiteFilter()}
              categories={categories}
              locationOptions={locationOptions}
              setFilters={setFilters}
              words={t}
            />
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {t.results}{" "}
                <Badge variant="outline">
                  {new Intl.NumberFormat(locale).format(records.length)}
                </Badge>
              </p>
              {hasMoreFilters && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFilters(defaultFilters(filters.site))}
                >
                  <X size={15} aria-hidden="true" />
                  {t.clearFilters}
                </Button>
              )}
            </div>
            {chosen ? (
              <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(19rem,3fr)]">
                <AssetTable
                  records={records}
                  workspace={workspace}
                  locationLabels={locationLabels}
                  selectedId={chosen.id}
                  onSelect={setSelectedId}
                  locale={locale}
                  words={t}
                />
                <AssetDetail
                  record={chosen}
                  workspace={workspace}
                  locationLabels={locationLabels}
                  busy={pending}
                  onEdit={showEditor}
                  locale={locale}
                  words={t}
                />
              </div>
            ) : (
              <RegisterEmpty
                matchingScope={hasRecordsInScope}
                archived={filters.status === "archived"}
                words={t}
              />
            )}
          </TabsContent>

          <TabsContent value="categories" className="space-y-3">
            <div className="max-w-64">{renderSiteFilter()}</div>
            {categories.length === 0 ? (
              <EmptyState
                className="rounded-lg border bg-card"
                title={t.noCategories}
                body={t.noCategoriesBody}
              />
            ) : (
              <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
                <table
                  aria-label={t.categories}
                  className="w-full table-auto border-collapse text-sm"
                >
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th scope="col" className={configHeader}>
                        {t.category}
                      </th>
                      <th scope="col" className={configHeader}>
                        {t.site}
                      </th>
                      <th scope="col" className={configHeader}>
                        {t.fieldDefinitions}
                      </th>
                      <th scope="col" className="sr-only">
                        {t.actions}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {categories.map((category) => {
                      const site = sites.get(category.siteId);
                      return (
                        <tr key={category.id}>
                          <th scope="row" className={`${configCell} font-medium`}>
                            <bdi dir="auto">{category.name}</bdi>
                          </th>
                          <td className={configCell}>
                            <bdi dir="auto">{site?.name}</bdi>
                          </td>
                          <td className={configCell}>
                            {category.fields.length > 0 ? (
                              <ul className="flex flex-wrap gap-1">
                                {category.fields.map(({ id, label }) => (
                                  <li key={id}>
                                    <Badge variant="outline">
                                      <bdi dir="auto">{label}</bdi>
                                    </Badge>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-end">
                            {site?.canManage === true && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={(event) =>
                                  showEditor(event, {
                                    type: "saveCategory",
                                    siteId: site.id,
                                    category,
                                  })
                                }
                              >
                                {t.edit}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="models" className="space-y-3">
            <div className="max-w-64">{renderSiteFilter()}</div>
            {models.length === 0 ? (
              <EmptyState
                className="rounded-lg border bg-card"
                title={t.noModels}
                body={t.noModelsBody}
              />
            ) : (
              <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
                <table aria-label={t.models} className="w-full table-auto border-collapse text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th scope="col" className={configHeader}>
                        {t.model}
                      </th>
                      <th scope="col" className={configHeader}>
                        {t.site}
                      </th>
                      <th scope="col" className={configHeader}>
                        {t.category}
                      </th>
                      <th scope="col" className="sr-only">
                        {t.actions}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {models.map((model) => {
                      const site = sites.get(model.siteId);
                      return (
                        <tr key={model.id}>
                          <th scope="row" className={`${configCell} font-medium`}>
                            <bdi dir="auto">{model.name}</bdi>
                            <bdi
                              dir="auto"
                              className="block text-xs font-normal text-muted-foreground"
                            >
                              {model.code}
                            </bdi>
                          </th>
                          <td className={configCell}>
                            <bdi dir="auto">{site?.name}</bdi>
                          </td>
                          <td className={configCell}>
                            <bdi dir="auto">
                              {model.categoryId !== null
                                ? (categoryNames.get(model.categoryId) ?? "—")
                                : "—"}
                            </bdi>
                          </td>
                          <td className="px-3 py-2 text-end">
                            {site?.canManage === true && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={(event) =>
                                  showEditor(event, { type: "saveModel", siteId: site.id, model })
                                }
                              >
                                {t.edit}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
      {editor !== null && (
        <AssetEditorDialog
          editor={editor}
          workspace={workspace}
          pending={pending}
          error={error === null ? null : t[error]}
          onClose={closeEditor}
          onSubmit={(intent) => void save(intent)}
          restoreFocus={() => {
            if (focusTrigger.current?.isConnected === true) focusTrigger.current.focus();
            else searchInput.current?.focus();
          }}
        />
      )}
    </section>
  );
}
