"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { managedUserDetailsResponse } from "../clientSchemas";
import type { ManagedUserDetails } from "../contracts";
import type { ManagementMessages } from "../messages";
import type { AskManagementAction } from "./types";
import { useManagementFormat } from "./useManagementFormat";

type DetailsLoad = { userId: string; revision: string } & (
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; details: ManagedUserDetails }
);

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
  const [load, setLoad] = useState<DetailsLoad>({ userId, revision, status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const inFlight = useRef(false);
  const output = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision and Retry explicitly reload this read without changing the selected account.
  useEffect(() => {
    const controller = new AbortController();
    const lifetime = { current: true };
    inFlight.current = true;
    void (async () => {
      try {
        const response = await fetch(`/api/auth-management/user?id=${encodeURIComponent(userId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = managedUserDetailsResponse.safeParse(await response.json());
        controller.signal.throwIfAborted();
        if (!lifetime.current) return;
        if (!result.success || !result.data.ok || result.data.data.userId !== userId) {
          setLoad({ userId, revision, status: "error" });
          return;
        }
        setLoad({ userId, revision, status: "ready", details: result.data.data });
      } catch {
        if (lifetime.current && !controller.signal.aborted)
          setLoad({ userId, revision, status: "error" });
      } finally {
        if (lifetime.current) inFlight.current = false;
      }
    })();
    return () => {
      lifetime.current = false;
      controller.abort();
      inFlight.current = false;
    };
  }, [userId, revision, retryCount]);

  function retry(): void {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    output.current?.focus();
    setLoad({ userId, revision, status: "loading" });
    setRetryCount((value) => value + 1);
  }

  if (load.userId !== userId || load.revision !== revision || load.status === "loading")
    return (
      <section ref={output} aria-label={L.securityDetails} tabIndex={-1}>
        <p role="status" className="text-sm text-muted-foreground">
          {L.loading}
        </p>
      </section>
    );
  if (load.status === "error")
    return (
      <section ref={output} aria-label={L.securityDetails} tabIndex={-1} className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {L.loadError}
        </p>
        <Button size="sm" variant="outline" disabled={pending} onClick={retry}>
          {L.retry}
        </Button>
      </section>
    );
  const details = load.details;
  const providers: Record<string, string> = {
    credential: L.passwordLogin,
    google: "Google",
    microsoft: "Microsoft",
  };
  return (
    <section ref={output} aria-label={L.securityDetails} tabIndex={-1} className="space-y-4">
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
    </section>
  );
}
