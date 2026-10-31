"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { managedUserDetailsResponse } from "../clientSchemas";
import type { ManagedUserDetails } from "../contracts";
import type { ManagementMessages } from "../messages";
import type { AskManagementAction } from "./types";
import { useManagementFormat } from "./useManagementFormat";
export function UserSecurityDetails({
  L,
  userId,
  revision,
  ask,
  pending,
}: {
  L: ManagementMessages;
  userId: string;
  revision: string;
  ask: AskManagementAction;
  pending: boolean;
}) {
  const format = useManagementFormat();
  const [details, setDetails] = useState<ManagedUserDetails | null>(null);
  const [error, setError] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A completed action changes revision so revoked sessions refresh immediately.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/auth-management/user?id=${encodeURIComponent(userId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = managedUserDetailsResponse.safeParse(await response.json());
        controller.signal.throwIfAborted();
        if (!result.success || !result.data.ok) {
          setError(true);
          return;
        }
        setDetails(result.data.data);
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [userId, revision]);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {L.loadError}
      </p>
    );
  if (details === null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {L.loading}
      </p>
    );
  const providers: Record<string, string> = {
    credential: L.passwordLogin,
    google: "Google",
    microsoft: "Microsoft",
  };
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{L.securityDetails}</h3>
      <dl className="grid gap-x-6 gap-y-4 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{L.emailVerified}</dt>
          <dd className="mt-1 font-medium">{details.emailVerified ? L.enabled : L.notEnabled}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.authenticator}</dt>
          <dd className="mt-1 font-medium">
            {details.twoFactorEnabled ? L.enabled : L.notEnabled}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.passkeys}</dt>
          <dd className="mt-1 font-medium">{format.number(details.passkeyCount)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.linkedMethods}</dt>
          <dd className="mt-1 font-medium">
            {details.providers
              .map((provider) => providers[provider] ?? L.companyLogin)
              .join(" / ") || L.notAvailable}
          </dd>
        </div>
      </dl>
      <h3 className="text-sm font-medium">{L.sessions}</h3>
      <ul className="divide-y">
        {details.sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
          >
            <div>
              <p>
                <bdi className="line-clamp-1 break-all">{session.userAgent ?? L.unknownDevice}</bdi>
              </p>
              <p className="text-xs text-muted-foreground">
                {L.lastSeen}: {format.date(session.lastSeenAt)} · {L.expires}:{" "}
                {format.date(session.expiresAt)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => ask({ action: "revokeManagedSession", userId, sessionId: session.id })}
            >
              {L.revokeSession}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
