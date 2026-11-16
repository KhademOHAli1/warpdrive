import type { ReactNode } from "react";
import { publicMailboxError } from "@/features/email/mailConnectionHttpView";
import { getAppTranslations } from "@/features/i18n/server";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { IntegrationHub } from "@/features/integrations/IntegrationHub";
import { resolveMcpEndpoint } from "@/features/oauth/mcpEndpoint";
import { createContext, getFrontendConfig } from "@/frontend/context";
import { getConnections } from "@/frontend/reads";
import { createCaller } from "@/frontend/trpc";
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
  const env = await getFrontendConfig();
  const L = await getServerSettingsMessages();
  const t = await getAppTranslations("integrations");
  const S = L;

  const ctx = await createContext();
  if (ctx.actor === null) return <p className="text-sm text-red-600">{S.requiresAuth}</p>;

  const [connections, connectionData, query] = await Promise.all([
    createCaller(ctx).oauth.listConnections(),
    getConnections(),
    searchParams,
  ]);
  const { services, mailbox, slackConfigured } = connectionData;
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
        slackConfigured={slackConfigured}
        gmailConfigured={env.GMAIL_CONFIGURED}
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
                    paused: mailbox.paused,
                    lastSyncAtIso: mailbox.lastSyncAt?.toISOString() ?? null,
                    lastCheckedAtIso: mailbox.lastCheckedAt?.toISOString() ?? null,
                    errorCode: publicMailboxError(mailbox.lastErrorId, null, mailbox.status),
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
