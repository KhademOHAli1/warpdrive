"use client";

import { Archive, Building2, MapPin, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { useWorkspaceShell } from "@/components/shell/WorkspaceShellProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import type {
  LocationsCommand,
  LocationsError,
  LocationsIntent,
  LocationsResult,
  LocationsWorkspace,
} from "./contracts";
import { type LocationChange, type LocationDirectory, locationPath } from "./directory";
import { LocationAccessDialog } from "./LocationAccessDialog";
import { LocationEditor, type LocationEditorTarget } from "./LocationEditor";
import { locationsMessages } from "./locationsMessages";

export type LocationWriteError = LocationsError | "transport";

function useLocationSelection(
  initial: LocationsWorkspace,
  source: LocationsWorkspace,
  current: LocationsWorkspace,
  initialLocationId?: string,
) {
  const { directory } = source === initial ? current : initial;
  const requested = directory.locations.find(({ id }) => id === initialLocationId);
  const requestedSite = directory.sites.find(({ id }) => id === requested?.siteId);
  const requestedArchived = requested?.archived === true || requestedSite?.archived === true;
  const [visited, setVisited] = useState(initialLocationId);
  const [siteId, setSiteId] = useState(requestedSite?.id ?? directory.sites[0]?.id ?? "");
  const [locationId, setLocationId] = useState<string | null>(requested?.id ?? null);
  const [showArchived, setShowArchived] = useState(requestedArchived);
  const [search, setSearch] = useState("");
  if (visited !== initialLocationId) {
    setVisited(initialLocationId);
    if (requested !== undefined && requestedSite !== undefined) {
      setSiteId(requestedSite.id);
      setLocationId(requested.id);
      setShowArchived(requestedArchived);
      setSearch("");
    }
  }
  return {
    siteId,
    setSiteId,
    locationId,
    setLocationId,
    showArchived,
    setShowArchived,
    search,
    setSearch,
  };
}

function useLocationDetailFocus(requested: string | undefined, selected: string | undefined) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (requested === undefined) {
      focused.current = undefined;
      return;
    }
    const target = heading.current;
    if (target === null || requested !== selected || focused.current === requested) return;
    focused.current = requested;
    target.focus();
  }, [requested, selected]);
  return heading;
}

function matchingLocationPaths(
  directory: LocationDirectory,
  siteId: string | undefined,
  showArchived: boolean,
  search: string,
  locale: string,
) {
  const query = search.trim().toLocaleLowerCase(locale);
  return directory.locations
    .filter((location) => location.siteId === siteId && (showArchived || !location.archived))
    .map((location) => {
      const names = locationPath(directory.locations, location).map(({ name }) => name);
      return { location, path: names.join(" / "), parentPath: names.slice(0, -1).join(" / ") };
    })
    .filter(({ location, path }) =>
      `${path} ${location.code}`.toLocaleLowerCase(locale).includes(query),
    )
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path, locale) || a.location.code.localeCompare(b.location.code),
    );
}

export function LocationsDirectory({
  initial,
  initialLocationId,
  submit,
  fixture = false,
  refresh,
  refreshing = false,
}: {
  initial: LocationsWorkspace;
  initialLocationId?: string;
  submit: (command: LocationsCommand) => Promise<LocationsResult>;
} & (
  | { fixture: true; refresh?: undefined; refreshing?: false }
  | { fixture?: false; refresh: () => void; refreshing?: boolean }
)) {
  const locale = useLocale();
  const { canViewAssets } = useWorkspaceShell();
  const t = locationsMessages[locale];
  const [workspace, setWorkspace] = useState(initial);
  const [source, setSource] = useState(initial);
  const [context, setContext] = useState("inventory");
  const {
    siteId,
    setSiteId,
    locationId,
    setLocationId,
    showArchived,
    setShowArchived,
    search,
    setSearch,
  } = useLocationSelection(initial, source, workspace, initialLocationId);
  const [editor, setEditor] = useState<LocationEditorTarget | null>(null);
  const [accessSiteId, setAccessSiteId] = useState<string | null>(null);
  const [error, setError] = useState<LocationWriteError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const unconfirmed = useRef(new Map<string, string>());
  const archivedFilterId = useId();
  const listId = useId();
  if (source !== initial) {
    setSource(initial);
    setWorkspace(initial);
    setEditor(null);
    setAccessSiteId(null);
    setError(null);
    setSaved(false);
  }
  const { directory, canManageSites } = workspace;
  const sites = directory.sites.filter((site) => showArchived || !site.archived);
  const site = sites.find(({ id }) => id === siteId) ?? sites[0];
  const canManageLocations =
    site !== undefined && (canManageSites || workspace.managedSiteIds.includes(site.id));
  const accessSite = canManageSites
    ? directory.sites.find(({ id }) => id === accessSiteId)
    : undefined;
  const busy = pending || refreshing;
  const locations = matchingLocationPaths(directory, site?.id, showArchived, search, locale);
  const selected = locations.find(({ location }) => location.id === locationId) ?? locations[0];
  const detailHeading = useLocationDetailFocus(initialLocationId, selected?.location.id);

  function openEditor(button: HTMLButtonElement, target: LocationEditorTarget) {
    trigger.current = button;
    setError(null);
    setSaved(false);
    setEditor(target);
  }

  async function apply(change: LocationsIntent): Promise<LocationWriteError | null> {
    if (inFlight.current || refreshing) return "transport";
    inFlight.current = true;
    setPending(true);
    setError(null);
    setSaved(false);
    const key = JSON.stringify(change);
    const requestId = unconfirmed.current.get(key) ?? crypto.randomUUID();
    unconfirmed.current.set(key, requestId);
    try {
      const result = await submit({ ...change, requestId });
      unconfirmed.current.delete(key);
      if (!result.ok) return result.error;
      setWorkspace(result.value);
      if (result.siteId != null) setSiteId(result.siteId);
      if (result.locationId !== undefined) setLocationId(result.locationId);
      setSaved(true);
      return null;
    } catch {
      return "transport";
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function setArchive(change: LocationChange) {
    setError(await apply(change));
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={busy}>
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          fixture ? (
            <Badge variant="outline">{t.demo}</Badge>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
              <RefreshCw aria-hidden="true" /> {t.refreshDirectory}
            </Button>
          )
        }
      />
      <Tabs value={context} onValueChange={setContext}>
        <TabsList
          aria-label={t.contexts}
          className="inline-flex w-fit gap-1 rounded-lg border bg-card p-0.5"
        >
          <TabsTrigger value="inventory" className={PILL_TAB}>
            {t.inventory}
          </TabsTrigger>
          <TabsTrigger value="assets" className={PILL_TAB}>
            {t.assets}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={context} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {context === "assets" ? t.assetsContext : t.inventoryContext}
            </p>
            {(fixture || canViewAssets) && context === "assets" && (
              <Link href="/assets" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t.assetRegister}
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
            {site !== undefined && (
              <div className="grid w-full min-w-0 gap-1.5 sm:w-auto sm:max-w-64 sm:min-w-36 sm:flex-1">
                <span className="text-sm font-medium">{t.site}</span>
                <Select
                  ariaLabel={t.site}
                  value={site.id}
                  options={sites.map((entry) => ({
                    value: entry.id,
                    label: `${entry.name} · ${entry.code}`,
                  }))}
                  disabled={busy}
                  onChange={(id) => {
                    setSiteId(id);
                    setLocationId(null);
                    setError(null);
                    setSaved(false);
                  }}
                  triggerClassName="h-9 min-w-0 gap-2 [&>span]:min-w-0 [&>span]:truncate"
                  contentClassName={`${BLOCK_CLASS} ph-no-capture max-w-[min(28rem,90vw)]`}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              {canManageSites && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={busy}
                    onClick={(event) =>
                      openEditor(event.currentTarget, { kind: "site", record: null })
                    }
                  >
                    <Plus aria-hidden="true" /> {t.addSite}
                  </Button>
                  {site !== undefined && (
                    <>
                      {!site.archived && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9"
                          disabled={busy}
                          onClick={(event) =>
                            openEditor(event.currentTarget, { kind: "site", record: site })
                          }
                        >
                          {t.editSite}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        disabled={busy}
                        onClick={() =>
                          void setArchive({
                            type: "setSiteArchived",
                            id: site.id,
                            archived: !site.archived,
                          })
                        }
                      >
                        {site.archived ? t.restoreSite : t.archiveSite}
                      </Button>
                      {!fixture && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9"
                          disabled={busy}
                          onClick={(event) => {
                            trigger.current = event.currentTarget;
                            setAccessSiteId(site.id);
                          }}
                        >
                          {t.siteAccess}
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <label
              htmlFor={archivedFilterId}
              className="flex h-9 cursor-pointer items-center gap-2 px-2 text-sm sm:ms-auto"
            >
              <Checkbox
                id={archivedFilterId}
                label={t.showArchived}
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              {t.showArchived}
            </label>
          </div>
          {saved && (
            <p className="sr-only" role="status">
              {t.saved}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t[error]}
            </p>
          )}
          {site === undefined ? (
            <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              {!canManageSites && directory.sites.length === 0 ? t.noSharedSites : t.noSites}
            </p>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
              <section className="min-w-0 rounded-lg border bg-card" aria-labelledby={listId}>
                <div className="flex flex-wrap items-center gap-3 border-b p-3">
                  <h2 id={listId} className="me-auto flex items-center gap-2 text-sm font-semibold">
                    <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                    {t.locations}
                    <bdi
                      className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {site.code}
                    </bdi>
                    {site.archived && <Badge variant="outline">{t.archived}</Badge>}
                  </h2>
                  <Input
                    type="search"
                    aria-label={t.search}
                    placeholder={t.search}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-9 w-full sm:w-44"
                  />
                  {canManageLocations && !site.archived && (
                    <Button
                      disabled={busy}
                      onClick={(event) =>
                        openEditor(event.currentTarget, {
                          kind: "location",
                          record: null,
                          siteId: site.id,
                        })
                      }
                    >
                      <Plus aria-hidden="true" /> {t.addLocation}
                    </Button>
                  )}
                </div>
                {locations.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t.noLocations}
                  </p>
                ) : (
                  <ul className="divide-y">
                    {locations.map(({ location, parentPath }) => (
                      <li key={location.id}>
                        <Button
                          variant="ghost"
                          aria-pressed={location.id === selected?.location.id}
                          data-location-id={location.id}
                          className={cn(
                            "h-auto min-h-12 w-full justify-start gap-2.5 rounded-none px-3 py-2 text-start",
                            location.id === selected?.location.id && "bg-muted/60",
                          )}
                          onClick={() => {
                            setLocationId(location.id);
                            setError(null);
                          }}
                        >
                          {location.archived ? (
                            <Archive className="text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <MapPin className="text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="min-w-0 grow whitespace-normal [overflow-wrap:anywhere]">
                            <bdi className="block">{location.name}</bdi>
                            {parentPath !== "" && (
                              <bdi className="block text-xs font-normal text-muted-foreground">
                                {parentPath}
                              </bdi>
                            )}
                          </span>
                          <bdi
                            dir="ltr"
                            className="shrink-0 font-mono text-xs text-muted-foreground"
                          >
                            {location.code}
                          </bdi>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {selected !== undefined && (
                <section
                  aria-label={t.locationDetails}
                  data-location-detail={selected.location.id}
                  className="min-w-0 space-y-3 rounded-lg border bg-card p-4"
                >
                  <h2
                    ref={detailHeading}
                    tabIndex={-1}
                    aria-label={`${t.locationDetails} · ${selected.location.name}`}
                    data-location-detail-heading
                    className="text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {t.locationDetails}
                  </h2>
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    <bdi>{site.name}</bdi>
                    {" / "}
                    <bdi>{selected.path}</bdi>
                  </p>
                  {selected.location.archived && <Badge variant="outline">{t.archived}</Badge>}
                  {canManageLocations && !site.archived && (
                    <div className="flex flex-wrap gap-2">
                      {!selected.location.archived && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={(event) =>
                            openEditor(event.currentTarget, {
                              kind: "location",
                              record: selected.location,
                              siteId: site.id,
                            })
                          }
                        >
                          {t.editLocation}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void setArchive({
                            type: "setLocationArchived",
                            id: selected.location.id,
                            archived: !selected.location.archived,
                          })
                        }
                      >
                        {selected.location.archived ? t.restoreLocation : t.archiveLocation}
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
      {editor !== null && (
        <LocationEditor
          directory={directory}
          target={editor}
          pending={pending}
          close={() => setEditor(null)}
          focusTrigger={() => trigger.current?.focus()}
          submit={async (change) => {
            const issue = await apply(change);
            if (issue === null) {
              setSearch("");
              setEditor(null);
            }
            return issue;
          }}
        />
      )}
      {accessSite !== undefined && (
        <LocationAccessDialog
          site={accessSite}
          users={workspace.eligibleUsers}
          grants={workspace.grants.filter((entry) => entry.siteId === accessSite.id)}
          pending={pending}
          close={() => setAccessSiteId(null)}
          focusTrigger={() => trigger.current?.focus()}
          submit={apply}
        />
      )}
    </section>
  );
}
