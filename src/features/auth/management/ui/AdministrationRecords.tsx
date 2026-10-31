"use client";
import { Button } from "@/components/ui/Button";
import type { ManagementSnapshot } from "../contracts";
import type { ManagementMessages } from "../messages";
import type { ManagementAction } from "../schemas";
import { ManagementStatus } from "./ManagementStatus";
import type { AskManagementAction } from "./types";
import { useManagementFormat } from "./useManagementFormat";

export function AdministrationRecords({
  L,
  snapshot,
  pending,
  send,
  ask,
  view,
}: {
  L: ManagementMessages;
  snapshot: ManagementSnapshot;
  pending: boolean;
  send: (command: ManagementAction) => Promise<boolean>;
  ask: AskManagementAction;
  view: "requests" | "delivery";
}) {
  const format = useManagementFormat();
  if (view === "requests")
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">{L.requestsTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{L.requestsHelp}</p>
        </div>
        {snapshot.requests.length === 0 ? (
          <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {L.noRequests}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card px-4">
            {snapshot.requests.map((request) => (
              <li key={request.id} className="space-y-3 py-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{request.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <bdi dir="ltr">{request.email}</bdi>
                    </p>
                  </div>
                  <ManagementStatus state={request.status} L={L} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {request.kind === "factor_recovery" ? L.factor_recovery : L.account_closure} ·{" "}
                  {format.date(request.createdAt)}
                </p>
                {request.reason !== null && (
                  <div className="rounded-md bg-muted/40 px-3 py-2">
                    <p className="text-xs font-medium">{L.requestReason}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {request.reason}
                    </p>
                  </div>
                )}
                {request.status === "approved" && request.kind === "factor_recovery" && (
                  <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {L.awaitingOperator}
                  </p>
                )}
                {(request.status === "pending" || request.status === "approved") && (
                  <div className="flex flex-wrap gap-2">
                    {request.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          ask(
                            { action: "reviewRecovery", id: request.id, status: "approved" },
                            L.requestsHelp,
                          )
                        }
                      >
                        {L.approve}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        ask({ action: "reviewRecovery", id: request.id, status: "rejected" })
                      }
                    >
                      {L.reject}
                    </Button>
                    {request.status === "approved" && request.kind === "account_closure" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          ask(
                            { action: "reviewRecovery", id: request.id, status: "resolved" },
                            L.suspendHelp,
                          )
                        }
                      >
                        {L.resolve}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">{L.mailTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{L.mailHelp}</p>
        </div>
        {snapshot.deliveries.length === 0 ? (
          <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {L.noDeliveries}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card px-4">
            {snapshot.deliveries.map((mail) => (
              <li
                key={mail.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3.5"
              >
                <div className="min-w-0 text-sm">
                  <p className="truncate">
                    <bdi dir="ltr">{mail.recipient}</bdi>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {format.date(mail.createdAt)} · {L.attempts}: {format.number(mail.attempts)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <ManagementStatus state={mail.status} L={L} />
                  {snapshot.viewerIsAdmin && mail.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        void send({ action: "retryDelivery", id: mail.id });
                      }}
                    >
                      {L.retryDelivery}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {snapshot.viewerIsAdmin && (
        <section className="space-y-3 border-t pt-6">
          <div>
            <h2 className="text-sm font-semibold">{L.revocationsTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{L.revocationsHelp}</p>
          </div>
          {snapshot.integrationRevocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{L.noRevocations}</p>
          ) : (
            <ul className="divide-y">
              {snapshot.integrationRevocations.map((revocation) => (
                <li
                  key={revocation.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p>{revocation.provider === "google" ? "Google" : L.provider}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {L.attempts}: {format.number(revocation.attempts)}
                    </p>
                  </div>
                  <ManagementStatus state={revocation.status} L={L} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
