"use client";

import { Plus, Search } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PILL_TAB, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { AssetsWorkspace } from "../../contracts";
import type { Kit } from "../contracts";
import { KitDefinitionDialog } from "./KitDefinitionDialog";
import { KitDetail } from "./KitDetail";
import type { KitEditor, KitEditorState, KitOpener } from "./KitDialog";
import { KitCheckoutDialog, KitMoveDialog, KitReturnDialog } from "./KitHandoverDialogs";
import { activeKitCheckout, kitErrorText, kitRemaining, kitStatus, kitsForAsset } from "./kitView";
import { type KitWords, kitMessages } from "./messages";
import type { useKitWorkspace } from "./useKitWorkspace";

function KitsTable({
  kits,
  chosen,
  workspace,
  locationLabels,
  select,
  words: t,
}: {
  kits: Kit[];
  chosen: Kit;
  workspace: AssetsWorkspace;
  locationLabels: ReadonlyMap<string, string>;
  select: (id: string) => void;
  words: KitWords;
}) {
  const sites = new Map(workspace.sites.map(({ id, name }) => [id, name]));
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={t.kits} className="w-full min-w-[26rem] border-collapse text-sm">
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="p-3 text-start font-medium">
              {t.kit}
            </th>
            <th scope="col" className="p-3 text-start font-medium">
              {t.location}
            </th>
            <th scope="col" className="p-3 text-start font-medium">
              {t.status}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {kits.map((kit) => {
            const active = activeKitCheckout(workspace, kit.id);
            const status = kitStatus(kit, active);
            return (
              <tr
                data-kit-row={kit.id}
                data-selected={kit.id === chosen.id}
                key={kit.id}
                className="hover:bg-muted/40 data-[selected=true]:bg-accent/75"
              >
                <th scope="row" className="max-w-60 p-3 text-start align-middle">
                  <button
                    type="button"
                    aria-controls="kit-details"
                    aria-pressed={kit.id === chosen.id}
                    className="block rounded text-start font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => select(kit.id)}
                  >
                    <bdi className="[overflow-wrap:anywhere]">{kit.name}</bdi>
                  </button>
                  <bdi className="block text-xs font-normal text-muted-foreground">{kit.code}</bdi>
                </th>
                <td className="max-w-52 p-3 [overflow-wrap:anywhere]">
                  <bdi>{locationLabels.get(kit.locationId) ?? "—"}</bdi>
                  <bdi className="block text-xs text-muted-foreground">{sites.get(kit.siteId)}</bdi>
                </td>
                <td className="p-3 align-middle">
                  <Badge variant="outline" data-kit-row-status={status}>
                    {t[status]}
                  </Badge>
                  {active !== undefined && (
                    <bdi className="mt-1 block text-xs text-muted-foreground">
                      {active.custodianName}
                    </bdi>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function selectedSiteManager(workspace: AssetsWorkspace, siteId: string) {
  return workspace.sites.find(({ id, canManage }) => id === siteId && canManage);
}

export function KitsRegister({
  workspace,
  siteId,
  siteFilter,
  selectedId,
  select,
  locationLabels,
  searchInput,
  busy,
  open,
}: {
  workspace: AssetsWorkspace;
  siteId: string;
  siteFilter: ReactNode;
  selectedId: string | null;
  select: (id: string) => void;
  locationLabels: ReadonlyMap<string, string>;
  searchInput: RefObject<HTMLInputElement | null>;
  busy: boolean;
  open?: KitOpener;
}) {
  const locale = useLocale();
  const t = kitMessages[locale];
  const searchId = useId();
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase(locale);
  const atSite =
    workspace.kits?.records.filter((kit) => siteId === "" || kit.siteId === siteId) ?? [];
  const kits = atSite.filter(({ code, name }) =>
    [code, name].some((value) => value.toLocaleLowerCase(locale).includes(query)),
  );
  const chosen = kits.find(({ id }) => id === selectedId) ?? kits[0];
  const canAdd = open !== undefined && selectedSiteManager(workspace, siteId) !== undefined;
  const detailOpen =
    chosen !== undefined && selectedSiteManager(workspace, chosen.siteId) !== undefined
      ? open
      : undefined;
  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="min-w-40 flex-1 sm:max-w-60">{siteFilter}</div>
        <div className="min-w-48 flex-1 space-y-1 sm:max-w-80">
          <label htmlFor={searchId} className="block text-xs font-medium text-muted-foreground">
            {t.search}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              size={14}
              className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              ref={searchInput}
              type="search"
              value={search}
              placeholder={t.searchHint}
              className="h-8 ps-8"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>
        </div>
        {canAdd && (
          <Button
            className="ms-auto"
            size="sm"
            disabled={busy}
            onClick={(event) => open(event.currentTarget, { type: "saveKit", siteId })}
          >
            <Plus size={15} aria-hidden="true" /> {t.add}
          </Button>
        )}
      </section>
      {chosen === undefined ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {atSite.length === 0 ? t.noKits : t.noMatchingKits}
        </p>
      ) : (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(20rem,5fr)]">
          <KitsTable {...{ kits, chosen, workspace, locationLabels, select, words: t }} />
          <KitDetail
            kit={chosen}
            {...{ workspace, locationLabels, locale, busy }}
            open={detailOpen}
            words={t}
          />
        </div>
      )}
    </div>
  );
}

export function KitEditorDialog({
  editor,
  workspace,
  state,
}: {
  editor: KitEditor;
  workspace: AssetsWorkspace;
  state: KitEditorState;
}) {
  const words = kitMessages[useLocale()];
  switch (editor.type) {
    case "saveKit":
      return <KitDefinitionDialog {...{ editor, workspace, state, words }} />;
    case "moveKit":
      return <KitMoveDialog {...{ editor, workspace, state, words }} />;
    case "checkoutKit":
      return <KitCheckoutDialog {...{ editor, workspace, state, words }} />;
    case "returnKit":
      return <KitReturnDialog {...{ editor, workspace, state, words }} />;
  }
}

export function scopedKitEditor(
  workspace: AssetsWorkspace,
  editor: KitEditor | null,
  submitEnabled: boolean,
) {
  if (editor === null || !submitEnabled || workspace.kits === undefined) return null;
  const siteId = editor.type === "saveKit" ? editor.siteId : editor.kit.siteId;
  return selectedSiteManager(workspace, siteId) === undefined ? null : editor;
}

export function KitAssociations({
  workspace,
  assetId,
}: {
  workspace: AssetsWorkspace;
  assetId: string;
}) {
  const t = kitMessages[useLocale()];
  const kits = kitsForAsset(workspace, assetId);
  if (kits.length === 0) return null;
  return (
    <section aria-label={t.managedBy} className="space-y-2 p-4">
      <h3 className="font-semibold">{t.managedBy}</h3>
      <ul className="space-y-1">
        {kits.map((kit) => {
          const active = activeKitCheckout(workspace, kit.id);
          const isHeld =
            active?.lines.some((line) => line.assetId === assetId && kitRemaining(line) > 0) ===
            true;
          return (
            <li
              key={kit.id}
              data-kit-asset-association={kit.id}
              className="flex flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]"
            >
              <bdi className="font-medium">{kit.name}</bdi>
              <bdi className="text-xs text-muted-foreground">{kit.code}</bdi>
              {isHeld && (
                <span className="text-xs text-muted-foreground">
                  {t.holder} <bdi>{active.custodianName}</bdi>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t.managedAssets}</p>
    </section>
  );
}

export function KitsTabTrigger({ available }: { available: boolean }) {
  const t = kitMessages[useLocale()];
  return available ? (
    <TabsTrigger className={PILL_TAB} value="kits">
      {t.kits}
    </TabsTrigger>
  ) : null;
}

export function KitsTab({
  workspace,
  siteId,
  siteFilter,
  locationLabels,
  searchInput,
  busy,
  kit,
  submitEnabled,
}: {
  workspace: AssetsWorkspace;
  siteId: string;
  siteFilter: ReactNode;
  locationLabels: ReadonlyMap<string, string>;
  searchInput: RefObject<HTMLInputElement | null>;
  busy: boolean;
  kit: ReturnType<typeof useKitWorkspace>;
  submitEnabled: boolean;
}) {
  const t = kitMessages[useLocale()];
  if (workspace.kits === undefined) return null;
  const editor = scopedKitEditor(workspace, kit.editor, submitEnabled);
  return (
    <TabsContent value="kits" className="space-y-3">
      {kit.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.saved}
        </p>
      )}
      <KitsRegister
        {...{ workspace, siteId, siteFilter, locationLabels, searchInput, busy }}
        selectedId={kit.selectedId}
        select={kit.select}
        open={submitEnabled ? kit.open : undefined}
      />
      {editor !== null && (
        <KitEditorDialog
          editor={editor}
          workspace={workspace}
          state={{
            pending: kit.pending,
            error: kit.error === null ? null : kitErrorText(kit.error, t),
            onClose: kit.close,
            onSubmit: (intent) => void kit.save(intent),
            restoreFocus: kit.restoreFocus,
          }}
        />
      )}
    </TabsContent>
  );
}
