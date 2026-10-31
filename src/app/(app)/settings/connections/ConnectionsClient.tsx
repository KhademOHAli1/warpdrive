"use client";
import { Plug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { revokeConnectionAction } from "@/features/oauth/revokeAction";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";

export interface ConnectionView {
  clientId: string;
  clientName: string;
  connectedAtIso: string | null;
  lastUsedAtIso: string | null;
}

export function ConnectionsClient({
  connections: initialConnections,
}: {
  connections: ConnectionView[];
}): React.ReactNode {
  const L = useSettingsMessages();
  const format = useFormatters();
  const S = L;
  function formatDate(iso: string | null): string {
    return iso === null ? S.connectedAppsNeverUsed : format.dateTime(iso);
  }

  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConnectionView | null>(null);
  const pending = useRef(false);

  async function revoke(clientId: string): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setConfirming(null);
    setPendingId(clientId);
    setError(null);
    try {
      const result = await revokeConnectionAction(clientId, readCsrfToken());
      if (!result.ok) {
        setError(S.connectedAppsRevokeError);
        return;
      }
      setConnections((current) => current.filter((row) => row.clientId !== clientId));
      router.refresh();
    } catch {
      setError(S.connectedAppsRevokeError);
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Plug className="size-4" aria-hidden="true" />}
        title={S.connectedAppsList}
        description={S.connectedAppsListDescription}
      />
      <SettingsCardBody className="p-0">
        {connections.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">{S.connectedAppsEmpty}</p>
        ) : (
          <ul className="divide-y">
            {connections.map((connection) => (
              <li key={connection.clientId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">
                    {connection.clientName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {S.connectedAppsConnected(formatDate(connection.connectedAtIso))}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {connection.lastUsedAtIso === null
                      ? S.connectedAppsNeverUsed
                      : S.connectedAppsLastUsed(formatDate(connection.lastUsedAtIso))}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendingId !== null}
                  aria-label={`${pendingId === connection.clientId ? S.connectedAppsRevoking : S.connectedAppsRevoke}: ${connection.clientName}`}
                  onClick={() => setConfirming(connection)}
                >
                  {pendingId === connection.clientId
                    ? S.connectedAppsRevoking
                    : S.connectedAppsRevoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error !== null ? (
          <p className="border-t px-5 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <p className="border-t px-5 py-4 text-sm text-muted-foreground">
          {L._extra.connectionJourney.mailboxHint}{" "}
          <Link href="/settings/email-sync" className="text-primary underline underline-offset-4">
            {L._extra.connectionJourney.mailboxLink}
          </Link>
        </p>
        {confirming !== null && (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setConfirming(null);
            }}
            title={L._extra.connectionJourney.revokeTitle(confirming.clientName)}
            description={L._extra.connectionJourney.revokeDescription(confirming.clientName)}
            confirmLabel={S.connectedAppsRevoke}
            destructive
            onConfirm={() => void revoke(confirming.clientId)}
          />
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}
