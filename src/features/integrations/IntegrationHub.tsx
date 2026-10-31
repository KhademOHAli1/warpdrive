"use client";

import { Check, Store } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  ConnectionsClient,
  type ConnectionView,
} from "@/app/(app)/settings/connections/ConnectionsClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";
import { ConnectionOverview } from "./ConnectionOverview";
import type { Integration } from "./catalog";
import { IntegrationDetails } from "./IntegrationDetails";
import { IntegrationDirectory } from "./IntegrationDirectory";
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
  gmailConfigured?: boolean;
  mailbox?: { status: string } | null;
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
  gmailConfigured = false,
  mailbox = null,
  initialTab,
  callbackResult,
}: IntegrationHubProps) {
  const t = useAppTranslations("integrations");
  const [selected, setSelected] = useState<Integration | null>(null);
  const hasConnections =
    serviceConnections.length > 0 || aiConnections.length > 0 || mailbox !== null;
  const [tab, setTab] = useState(
    ["browse", "connections", "ai", "marketplace"].includes(initialTab ?? "")
      ? initialTab
      : hasConnections
        ? "connections"
        : "browse",
  );
  const trigger = useRef<HTMLElement | null>(null);
  const services = serviceConnections.filter((row) => row.provider === "slack");
  const context = { endpoint, slackConfigured, gmailConfigured, mailbox, services };
  function open(integration: Integration) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(integration);
  }
  return (
    <div className="min-w-0 space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" aria-label={t("title")} className="w-max min-w-full gap-2">
            <TabsTrigger value="connections" className={TAB_STYLE}>
              {t("connections")}
              {hasConnections && (
                <span
                  aria-hidden="true"
                  className="ms-2 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                >
                  {services.length + aiConnections.length + (mailbox !== null ? 1 : 0)}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="browse" className={TAB_STYLE}>
              {t("browse")}
            </TabsTrigger>
            <TabsTrigger value="ai" className={TAB_STYLE}>
              {t("ai")}
            </TabsTrigger>
            <TabsTrigger value="marketplace" className={TAB_STYLE}>
              {t("marketplace")}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="browse" className="mt-6">
          <IntegrationDirectory
            context={context}
            onSelect={open}
            onManage={() => setTab("connections")}
          />
        </TabsContent>
        <TabsContent value="connections" className="mt-6 space-y-6">
          {callbackResult !== undefined && (
            <p
              role={callbackResult === "connected" ? "status" : "alert"}
              className={cn(
                "rounded-xl border p-4 text-sm",
                callbackResult === "connected"
                  ? "border-emerald-600/30 bg-emerald-600/5"
                  : "border-destructive/30 text-destructive",
              )}
            >
              {t(callbackResult === "connected" ? "callbackConnected" : "callbackFailed")}
            </p>
          )}
          <ConnectionOverview
            services={services}
            mailbox={mailbox}
            aiCount={aiConnections.length}
            onBrowse={() => setTab("browse")}
          />
          {services.map((connection) => (
            <div key={connection.id} id={`connection-${connection.id}`} className="scroll-mt-6">
              <SlackConnection connection={connection} isAdmin={isAdmin} />
            </div>
          ))}
          {mailbox !== null && (
            <div id="gmail-connection" className="scroll-mt-6">
              {gmail}
            </div>
          )}
          {aiConnections.length > 0 && <ConnectionsClient connections={aiConnections} />}
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
          endpoint={endpoint}
          serverOrigin={serverOrigin}
          slackConfigured={slackConfigured}
          isAdmin={isAdmin}
          gmailControls={gmail}
          gmailConfigured={gmailConfigured || mailbox !== null}
          returnFocus={trigger}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
