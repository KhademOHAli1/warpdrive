"use client";

import { ArrowUpRight, Check, Search, Store } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  ConnectionsClient,
  type ConnectionView,
} from "@/app/(app)/settings/connections/ConnectionsClient";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import {
  filterIntegrations,
  INTEGRATION_CATEGORIES,
  INTEGRATIONS,
  type Integration,
  type IntegrationCategory,
  type IntegrationId,
} from "./catalog";
import { IntegrationDetails } from "./IntegrationDetails";
import { IntegrationMark } from "./IntegrationMark";
import { McpSetup } from "./McpSetup";
import { type ServiceConnectionView, SlackConnection } from "./SlackConnection";

export interface IntegrationHubProps {
  endpoint: string | null;
  serverOrigin?: string;
  slackConfigured: boolean;
  isAdmin: boolean;
  serviceConnections: ServiceConnectionView[];
  aiConnections: ConnectionView[];
  gmail: ReactNode;
  initialTab?: string;
  callbackResult?: string;
}

const TAB_STYLE =
  "min-h-11 flex-none rounded-none border-0 px-3 py-2.5 text-muted-foreground data-active:bg-transparent data-active:shadow-none dark:data-active:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground after:bg-primary";

export function IntegrationHub({
  endpoint,
  serverOrigin,
  slackConfigured,
  isAdmin,
  serviceConnections,
  aiConnections,
  gmail,
  initialTab,
  callbackResult,
}: IntegrationHubProps) {
  const t = useAppTranslations("integrations");
  const [category, setCategory] = useState<IntegrationCategory>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Integration | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const descriptions = Object.fromEntries(
    INTEGRATIONS.map((item) => [item.id, t(`providers.${item.id}.description`)]),
  ) as Record<IntegrationId, string>;
  const searchText = Object.fromEntries(
    INTEGRATIONS.map((item) => [item.id, `${displayName(item)} ${descriptions[item.id]}`]),
  ) as Record<IntegrationId, string>;
  const visible = filterIntegrations(query, category, searchText);

  function open(integration: Integration) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(integration);
  }

  function displayName(item: Integration) {
    return item.name;
  }

  function availability(item: Integration) {
    if (item.delivery === "planned") return t("planned");
    if (item.delivery === "mcp" && endpoint === null) return t("disabled");
    if (item.delivery === "slack" && !slackConfigured) return t("needsSetup");
    return t("ready");
  }

  return (
    <div className="space-y-6">
      <Tabs
        defaultValue={
          ["browse", "connections", "ai", "marketplace"].includes(initialTab ?? "")
            ? initialTab
            : "browse"
        }
      >
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" aria-label={t("title")} className="w-max min-w-full gap-2">
            <TabsTrigger value="browse" className={TAB_STYLE}>
              {t("browse")}
            </TabsTrigger>
            <TabsTrigger value="connections" className={TAB_STYLE}>
              {t("connections")}
            </TabsTrigger>
            <TabsTrigger value="ai" className={TAB_STYLE}>
              {t("ai")}
            </TabsTrigger>
            <TabsTrigger value="marketplace" className={TAB_STYLE}>
              {t("marketplace")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="browse" className="mt-6 space-y-5">
          <div className="relative max-w-md">
            <Search
              aria-hidden="true"
              className="absolute start-3 top-3 size-4 text-muted-foreground"
            />
            <label htmlFor="integration-search" className="sr-only">
              {t("search")}
            </label>
            <Input
              id="integration-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              className="min-h-10 ps-9"
            />
          </div>
          <fieldset className="flex flex-wrap gap-1.5" aria-label={t("all")}>
            {INTEGRATION_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
                className={cn(
                  "min-h-9 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  category === item
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {t(item === "ai" ? "aiCategory" : item)}
              </button>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => (
              <article
                key={item.id}
                className="flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-muted-foreground/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <IntegrationMark integration={item} />
                  <span className="rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                    {availability(item)}
                  </span>
                </div>
                <h2 className="mt-4 text-sm font-semibold">
                  <bdi>{displayName(item)}</bdi>
                </h2>
                <p className="mb-4 mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {descriptions[item.id]}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  aria-label={`${t("details")}: ${displayName(item)}`}
                  onClick={() => open(item)}
                >
                  {t("details")}
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
                </Button>
              </article>
            ))}
          </div>
          {visible.length === 0 && (
            <p
              role="status"
              className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            >
              {t("emptySearch")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="connections" className="mt-6 space-y-5">
          {callbackResult !== undefined && (
            <p
              role={callbackResult === "connected" ? "status" : "alert"}
              className={cn(
                "rounded-lg border p-4 text-sm",
                callbackResult === "connected"
                  ? "border-emerald-600/30 bg-emerald-600/5"
                  : "border-destructive/30 text-destructive",
              )}
            >
              {t(callbackResult === "connected" ? "callbackConnected" : "callbackFailed")}
            </p>
          )}
          {serviceConnections
            .filter((connection) => connection.provider === "slack")
            .map((connection) => (
              <SlackConnection key={connection.id} connection={connection} isAdmin={isAdmin} />
            ))}
          {gmail}
          <ConnectionsClient connections={aiConnections} />
        </TabsContent>

        <TabsContent value="ai" className="mt-6 space-y-6">
          <McpSetup endpoint={endpoint} />
          <ConnectionsClient connections={aiConnections} />
        </TabsContent>

        <TabsContent value="marketplace" className="mt-6">
          <div className="rounded-lg border bg-card p-6 sm:p-8">
            <span className="inline-flex size-12 items-center justify-center rounded-xl bg-accent">
              <Store aria-hidden="true" className="size-6 text-muted-foreground" />
            </span>
            <p className="mt-5 text-xs font-medium text-muted-foreground">{t("planned")}</p>
            <h2 className="mt-1 text-lg font-semibold">{t("marketTitle")}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {t("marketBody")}
            </p>
            <ul className="my-6 grid gap-3 text-sm sm:grid-cols-2">
              {(
                ["marketFeature1", "marketFeature2", "marketFeature3", "marketFeature4"] as const
              ).map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {t(key)}
                </li>
              ))}
            </ul>
            <p className="border-t pt-4 text-sm text-muted-foreground">{t("marketStatus")}</p>
          </div>
        </TabsContent>
      </Tabs>

      {selected !== null && (
        <IntegrationDetails
          integration={selected}
          name={displayName(selected)}
          endpoint={endpoint}
          serverOrigin={serverOrigin}
          slackConfigured={slackConfigured}
          isAdmin={isAdmin}
          returnFocus={trigger}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
