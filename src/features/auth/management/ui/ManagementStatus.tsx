import { Badge } from "@/components/ui/Badge";
import type { ManagementMessages } from "../messages";

export function ManagementStatus({ state, L }: { state: string; L: ManagementMessages }) {
  const labels: Record<string, string> = {
    active: L.active,
    inactive: L.inactive,
    pending: L.pending,
    captured: L.captured,
    sent: L.sent,
    failed: L.failedState,
    sending: L.sendingState,
    cancelled: L.cancelled,
    revoked: L.revoked,
    approved: L.approved,
    rejected: L.rejected,
    resolved: L.resolved,
    success: L.success,
    failure: L.failure,
    denied: L.denied,
    expired: L.expired,
    accepted: L.accepted,
  };
  const variant = ["active", "sent", "resolved", "success", "accepted"].includes(state)
    ? "success"
    : ["inactive", "failed", "failure", "denied"].includes(state)
      ? "destructive"
      : "secondary";
  return (
    <Badge variant={variant} className="gap-1.5 rounded-md font-normal">
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
      {labels[state] ?? L.pending}
    </Badge>
  );
}
