import type { ReactNode } from "react";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { getActorGmailMailboxStatus } from "@/features/email/mailboxOwnership";
import { getAppTranslations } from "@/features/i18n/server";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { IntegrationHub } from "@/features/integrations/IntegrationHub";
import { listServiceConnections } from "@/features/integrations/service";
import { slackConfiguration } from "@/features/integrations/slack";
import { resolveMcpEndpoint } from "@/features/oauth/mcpEndpoint";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";
import { EmailSyncClient } from "../email-sync/EmailSyncClient";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.connectedApps };
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const L = await getServerSettingsMessages();
  const t = await getAppTranslations("integrations");
  const S = L;

  const ctx = await createContext();
  if (ctx.actor === null) return <p className="text-sm text-red-600">{S.requiresAuth}</p>;

  const [connections, services, mailbox, query] = await Promise.all([
    createCaller(ctx).oauth.listConnections(),
    listServiceConnections(db),
    getActorGmailMailboxStatus(db, ctx.actor.id, AbortSignal.timeout(5000)),
    searchParams,
  ]);
  const mcpEndpoint = resolveMcpEndpoint({
    mcpEnabled: env.MCP_ENABLED,
    baseUrl: env.BASE_URL,
  });
  return (
    <SettingsPage className="max-w-5xl">
      <SettingsHeading scope="mixed" title={S.connectedApps} description={t("intro")} />
      <IntegrationHub
        endpoint={mcpEndpoint}
        serverOrigin={env.BASE_URL}
        isAdmin={ctx.actor.type === "admin"}
        slackConfigured={slackConfiguration() !== null}
        gmailConfigured={Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)}
        mailbox={mailbox === null ? null : { status: mailbox.status }}
        initialTab={typeof query.tab === "string" ? query.tab : undefined}
        callbackResult={
          query.result === "connected" &&
          services.some(
            (connection) => connection.provider === "slack" && connection.status === "connected",
          )
            ? "connected"
            : query.result === "failed"
              ? "failed"
              : undefined
        }
        serviceConnections={services.map((connection) => ({
          ...connection,
          connectedAt: connection.connectedAt.toISOString(),
          lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
        }))}
        gmail={
          <EmailSyncClient
            mailbox={
              mailbox === null
                ? null
                : {
                    id: mailbox.id,
                    emailAddress: mailbox.emailAddress,
                    status: mailbox.status,
                    lastSyncAtIso: mailbox.lastSyncAt?.toISOString() ?? null,
                    lastErrorId: mailbox.lastErrorId,
                  }
            }
          />
        }
        aiConnections={connections.map((row) => ({
          clientId: row.clientId,
          clientName: row.clientName,
          connectedAtIso: row.connectedAt?.toISOString() ?? null,
          lastUsedAtIso: row.lastUsedAt?.toISOString() ?? null,
        }))}
      />
    </SettingsPage>
  );
}
