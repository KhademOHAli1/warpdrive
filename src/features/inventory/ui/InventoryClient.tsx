"use client";

import { Archive, Boxes, ClipboardList, PackagePlus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import type { InventoryCommand, InventoryResult, InventoryWorkspace } from "../contracts";
import {
  InventoryNewItem,
  type InventoryProductReleases,
  InventorySelectedItem,
} from "./InventoryItemPanel";
import { InventoryOrderForm, InventoryOrderQueue } from "./InventoryOrderPanel";
import { inventoryMessages } from "./inventoryMessages";

type WithoutRequestId<Command> = Command extends unknown ? Omit<Command, "requestId"> : never;
export type InventoryIntent = WithoutRequestId<InventoryCommand>;
export type RunInventoryIntent = (intent: InventoryIntent) => Promise<InventoryWorkspace | null>;
export type FormatQuantity = (quantity: number) => string;

function workspaceArea(view: "items" | "orders", current: "items" | "orders") {
  return current === view
    ? "border-primary text-foreground"
    : "border-transparent text-muted-foreground";
}

export function InventoryClient({
  initial,
  submit,
  ProductReleases,
  openReleases = false,
  initialItemId,
}: {
  initial: InventoryWorkspace;
  submit: (command: InventoryCommand) => Promise<InventoryResult>;
  ProductReleases?: InventoryProductReleases;
  openReleases?: boolean;
  initialItemId?: string;
}) {
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const t = inventoryMessages[locale];
  const router = useRouter();
  const numbers = new Intl.NumberFormat(locale, { numberingSystem });
  const quantity = (count: number) => numbers.format(count);
  const [workspace, setWorkspace] = useState(initial);
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setWorkspace(initial);
  }
  const [view, setView] = useState<"items" | "orders">(initial.deal === null ? "items" : "orders");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initial.items.find(({ id }) => id === initialItemId)?.id ?? initial.items[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const [newItem, setNewItem] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const unconfirmedRequests = useRef(new Map<string, string>());
  const searchId = useId();

  async function run(intent: InventoryIntent): Promise<InventoryWorkspace | null> {
    if (inFlight.current || refreshing) return null;
    inFlight.current = true;
    setError(null);
    setNotice(null);
    setPending(true);
    const key = JSON.stringify(intent);
    const requestId = unconfirmedRequests.current.get(key) ?? crypto.randomUUID();
    unconfirmedRequests.current.set(key, requestId);
    try {
      const result = await submit({ ...intent, requestId });
      unconfirmedRequests.current.delete(key);
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      setWorkspace(result.value);
      setNotice(t[intent.type]);
      return result.value;
    } catch {
      setError(t.transport);
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const selected = workspace.items.find(({ id }) => id === selectedId);
  const query = search.trim().toLocaleLowerCase(locale);
  const items = workspace.items.filter(({ sku, name, revision }) =>
    `${sku} ${name} ${revision}`.toLocaleLowerCase(locale).includes(query),
  );
  const openOrders = workspace.orders.filter(
    ({ status }) => status !== "shipped" && status !== "cancelled",
  ).length;

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={pending || refreshing}>
      <PageHeading
        title={workspace.deal === null ? t.inventory : t.inventoryOrders}
        description={workspace.deal === null ? undefined : workspace.deal.name}
        actions={workspace.fixture ? <Badge variant="outline">{t.demo}</Badge> : undefined}
      />
      <nav aria-label={t.sections} className="mb-4 flex gap-4 border-b">
        <button
          type="button"
          aria-current={view === "items" ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 border-b-2 px-2 py-2 text-sm font-medium hover:text-foreground",
            workspaceArea(view, "items"),
          )}
          onClick={() => setView("items")}
        >
          <Boxes aria-hidden="true" className="size-4" /> {t.items}
        </button>
        <button
          type="button"
          aria-current={view === "orders" ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-2 border-b-2 px-2 py-2 text-sm font-medium hover:text-foreground",
            workspaceArea(view, "orders"),
          )}
          onClick={() => setView("orders")}
        >
          <ClipboardList aria-hidden="true" className="size-4" /> {t.orders}
          {openOrders > 0 && (
            <span aria-hidden="true" className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
              {quantity(openOrders)}
            </span>
          )}
        </button>
      </nav>
      {error !== null && !newItem && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p role="status" className="mb-3 rounded-md border bg-card p-3 text-sm">
          {notice}
        </p>
      )}
      {view === "items" ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
          <section
            className="min-w-0 overflow-hidden rounded-lg border bg-card"
            aria-labelledby={`${searchId}-items`}
          >
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <h2 id={`${searchId}-items`} className="me-auto text-sm font-semibold">
                {t.catalogue}
              </h2>
              <div className="relative min-w-48 grow sm:grow-0">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={searchId}
                  type="search"
                  aria-label={t.search}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.searchHint}
                  className="ps-8"
                />
              </div>
              {workspace.canManage && (
                <Button size="sm" onClick={() => setNewItem(true)} disabled={pending}>
                  <PackagePlus aria-hidden="true" className="size-4" /> {t.newItem}
                </Button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
                <Archive className="size-5" aria-hidden="true" />
                {query === "" ? t.empty : t.noMatches}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[33rem] text-sm">
                  <thead className="bg-muted/30 text-start text-xs text-muted-foreground">
                    <tr>
                      {[t.item, t.type, t.onHand, t.reserved, t.available].map((heading, index) => (
                        <th
                          key={heading}
                          scope="col"
                          className={cn(
                            "whitespace-nowrap px-4 py-2 font-medium",
                            index < 2 ? "text-start" : "text-end",
                          )}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        className={cn(
                          "hover:bg-muted/30",
                          item.id === selected?.id && "bg-muted/50",
                        )}
                      >
                        <td className="px-2 py-1">
                          <Button
                            aria-pressed={item.id === selected?.id}
                            className="h-auto max-w-full flex-col items-start gap-0 py-1.5 text-start"
                            variant="ghost"
                            onClick={() => setSelectedId(item.id)}
                          >
                            <bdi className="whitespace-normal">{item.name}</bdi>
                            <span className="text-xs font-normal text-muted-foreground">
                              <bdi dir="ltr">{item.sku}</bdi> · <bdi>{item.revision}</bdi>
                            </span>
                          </Button>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {item.kind === "product" ? t.product : t.component}
                        </td>
                        <td className="px-4 py-2 text-end tabular-nums">{quantity(item.onHand)}</td>
                        <td className="px-4 py-2 text-end tabular-nums">
                          {quantity(item.reserved)}
                        </td>
                        <td className="px-4 py-2 text-end font-semibold tabular-nums">
                          {quantity(item.onHand - item.reserved)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {selected !== undefined && (
            <InventorySelectedItem
              key={selected.id}
              item={selected}
              workspace={workspace}
              quantity={quantity}
              pending={pending}
              run={run}
              ProductReleases={ProductReleases}
              openReleases={openReleases}
            />
          )}
          {newItem && (
            <InventoryNewItem
              items={workspace.items}
              pending={pending}
              error={error}
              run={run}
              onClose={() => setNewItem(false)}
              onCreated={(id) => {
                setSelectedId(id);
                setSearch("");
              }}
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {workspace.deal !== null && workspace.canOrder && (
            <InventoryOrderForm
              key={workspace.deal.id}
              deal={workspace.deal}
              items={workspace.items}
              pending={pending || refreshing}
              run={run}
            />
          )}
          <InventoryOrderQueue
            workspace={workspace}
            quantity={quantity}
            pending={pending || refreshing}
            run={run}
            refresh={
              workspace.fixture
                ? undefined
                : () =>
                    startRefresh(() => {
                      setError(null);
                      setNotice(null);
                      router.refresh();
                    })
            }
          />
        </div>
      )}
    </section>
  );
}
